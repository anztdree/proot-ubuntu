/**
 * handlers.js — Chat Server Action Handlers (MySQL via api.php)
 * Super Warrior Z — CHAT SERVER
 *
 * 5 actions — ALL use MySQL via api.php HTTP calls:
 *   1. login     — user login ke chat-server (mark online + sync profile to MySQL)
 *   2. joinRoom  — join room, register socket, return _record (recent messages)
 *   3. leaveRoom — leave room, unregister socket
 *   4. sendMsg   — save message to MySQL, return _time, broadcast Notify to room
 *   5. getRecord — ambil history pesan sejak startTime
 *
 * Architecture:
 *   Browser (handlers.js) → HTTP POST → api.php → MySQL (database: chat)
 *
 * User profile bridge:
 *   Client does NOT send nickName/headImage/headEffect/headBox in login or
 *   sendMsg payloads (evidence: L114551-114556, L83836-83845).
 *   Server must know these. Our mock: handlers.js reads user profile from
 *   main-server's localStorage (saved during enterGame) and passes to api.php.
 *
 * Room/socket management:
 *   In-memory via ChatServer._rooms / ChatServer._socketRooms (in config.js).
 *   This is for real-time Notify broadcast — can't be done via MySQL.
 *   Message persistence is in MySQL via api.php.
 *
 * Evidence:
 *   L114550-114611: chatLoginRequest → chat.login → join 4 rooms in parallel
 *   L114612-114621: chatJoinRequest → chat.joinRoom → callback({_record:[...]})
 *   L83831-83856:   sendMsg → callback({_time}) → client createLocalData
 *   L114240-114261: listenNotify → socket.on('Notify') → {ret:'SUCCESS', data:{_msg:...}}
 *   L114632-114640: chatJoinRecord iterates _record with for-in → _kind grouping
 *   L92098-92110:   ChatDataBaseClass.getData: _id = userId, _headBox → _headBoxId
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;
    var MAX_MESSAGES = ChatServer.config.maxRecordPerRoom || 50;

    // =================================================================
    // apiCall — HTTP POST to api.php (MySQL backend)
    // =================================================================
    //
    // All chat operations go through api.php which connects to MySQL.
    // apiBase from config.js points to './server/chat-server/api.php'
    // URL format: apiBase?action=chatLogin (GET param) + JSON body (POST)
    //
    // Returns Promise → .then(function(response)) or .catch(function(error))

    function apiCall(action, data) {
        return new Promise(function (resolve, reject) {
            var url = ChatServer.config.apiBase + '?action=' + action;
            var payload = Object.assign({ action: action }, data);

            log.debug('API', 'apiCall → ' + action);
            log.detail('url', url);
            log.detail('payload', JSON.stringify(payload).substring(0, 200));

            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            xhr.timeout = 10000; // 10 second timeout

            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;

                if (xhr.status === 200) {
                    try {
                        var response = JSON.parse(xhr.responseText);

                        if (response.error) {
                            log.error('API', 'apiCall error response: ' + action);
                            log.importantDetails('error', [
                                ['action', action],
                                ['error', response.error]
                            ]);
                            reject(new Error(response.error));
                            return;
                        }

                        log.debug('API', 'apiCall OK: ' + action);
                        resolve(response);
                    } catch (parseErr) {
                        log.error('API', 'apiCall parse error: ' + action, parseErr);
                        reject(parseErr);
                    }
                } else {
                    log.error('API', 'apiCall HTTP error: ' + action);
                    log.importantDetails('error', [
                        ['action', action],
                        ['httpStatus', String(xhr.status)],
                        ['statusText', xhr.statusText || '(none)']
                    ]);
                    reject(new Error('HTTP ' + xhr.status));
                }
            };

            xhr.ontimeout = function () {
                log.error('API', 'apiCall timeout: ' + action);
                log.importantDetails('error', [
                    ['action', action],
                    ['timeout', '10000ms']
                ]);
                reject(new Error('Timeout'));
            };

            xhr.onerror = function () {
                log.error('API', 'apiCall network error: ' + action);
                log.importantDetails('error', [
                    ['action', action],
                    ['hint', 'api.php may not be accessible. Check server is running.']
                ]);
                reject(new Error('Network error'));
            };

            try {
                xhr.send(JSON.stringify(payload));
            } catch (sendErr) {
                log.error('API', 'apiCall send error: ' + action, sendErr);
                reject(sendErr);
            }
        });
    }

    // =================================================================
    // getUserInfo — Read user profile from main-server's localStorage
    // =================================================================
    //
    // Main-server saves user data during enterGame at key:
    //   'ms_user_{userId}_{serverId}'
    //
    // Used to bridge user profile (nickName, headImage, etc.) to api.php
    // since the client doesn't send these in chat payloads.
    // Evidence: L114551-114556 (login) and L83836-83845 (sendMsg) —
    //   neither payload includes nickName/headImage/headEffect/headBox.

    function getUserInfo(userId, serverId) {
        try {
            var key = 'ms_user_' + userId + '_' + (serverId || 1);
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            log.error('DB', 'getUserInfo failed for userId: ' + userId, e);
            return null;
        }
    }

    /**
     * extractUserProfile(userInfo)
     * Extract chat-relevant fields from main-server user data.
     * Returns {nickName, headImage, headEffect, headBox} with defaults.
     */
    function extractUserProfile(userInfo) {
        if (!userInfo) {
            return { nickName: '', headImage: '', headEffect: '0', headBox: '0' };
        }

        var user = userInfo.user || {};
        var headEffect = userInfo.headEffect || {};

        return {
            nickName:   user._nickName || '',
            headImage:  user._headImage || '',
            headEffect: String(headEffect._curEffect || 0),
            headBox:    String(headEffect._curBox || 0)
        };
    }

    // =================================================================
    // 1. login — User login ke chat-server
    // =================================================================
    //
    // Evidence: L114550-114611
    //   chatLoginRequest → processHandlerWithChat({type:'chat', action:'login',
    //     userId, serverId, version:'1.0'}, cb)
    //   Response: empty {} — client only checks ret:0
    //
    // After login success, client joins 4 rooms in parallel (L114558-114609):
    //   1. worldRoomId — ALWAYS (no guard)
    //   2. guildRoomId — guarded: if (ts.loginInfo.serverItem.guildRoomId)
    //   3. teamDungeonChatRoom — guarded
    //   4. teamChatRoomId — guarded
    //
    // Our mock:
    //   1. Read user profile from main-server localStorage
    //   2. Send to api.php → upsert chat_users (online + profile)
    //   3. Return {} (ret:0 from envelope is sufficient)

    function handleLogin(request, callback) {
        var userId = request.userId;
        var serverId = request.serverId || '1';

        log.info('AUTH', 'handleLogin — chat login');
        log.details('request', [
            ['userId', userId || '-'],
            ['serverId', serverId],
            ['version', request.version || '-']
        ]);

        if (!userId) {
            log.error('AUTH', 'handleLogin — missing userId');
            callback({});
            return;
        }

        // Read user profile from main-server localStorage for MySQL sync
        var userInfo = getUserInfo(userId, serverId);
        var profile = extractUserProfile(userInfo);

        log.debug('AUTH', 'User profile for MySQL sync');
        log.details('profile', [
            ['nickName', profile.nickName || '(empty)'],
            ['headImage', profile.headImage ? '(set)' : '(empty)'],
            ['headEffect', profile.headEffect],
            ['headBox', profile.headBox]
        ]);

        // Send to api.php → MySQL
        apiCall('chatLogin', {
            userId:     userId,
            serverId:   serverId,
            version:    request.version || '1.0',
            nickName:   profile.nickName,
            headImage:  profile.headImage,
            headEffect: profile.headEffect,
            headBox:    profile.headBox
        }).then(function (result) {
            log.info('AUTH', 'handleLogin → success (user online in MySQL)');
            log.details('response', [
                ['userId', userId],
                ['serverId', serverId],
                ['status', 'ONLINE'],
                ['nickName', profile.nickName || '(no name)']
            ]);
            callback({});
        }).catch(function (err) {
            // MySQL failed — fallback to empty response
            // Chat login is not critical, main flow continues
            log.error('AUTH', 'handleLogin → MySQL FAILED, returning empty fallback');
            log.importantDetails('error', [
                ['userId', userId],
                ['error', err.message || String(err)],
                ['fallback', 'ret:0 with empty data — client continues']
            ]);
            callback({});
        });
    }

    // =================================================================
    // 2. joinRoom — Join room, register socket, return recent messages
    // =================================================================
    //
    // Evidence: L114612-114621
    //   chatJoinRequest → processHandlerWithChat({type:'chat', action:'joinRoom',
    //     userId, roomId, version:'1.0'}, cb)
    //   cb(e) → chatJoinRecord(e) → iterates e._record with for-in
    //
    // L114632-114640: chatJoinRecord iterates _record:
    //   for (var o in t) {
    //       var a = t[o];
    //       ts.chatData[a._kind] || (ts.chatData[a._kind] = []);
    //       var r = ChatDataBaseClass.getData(a);
    //       r && (ts.chatNotifyData(r), n.push(r));
    //   }
    //
    // _record must be array of message objects. Each has _kind (MESSAGE_KIND).
    // for-in on array works (iterates indices as strings).
    //
    // L114566-114568: worldRoomId join has NO guard → MUST always succeed
    // L114568, L114579, L114590: guild/teamDungeon/team have guards → can fail gracefully
    //
    // After joining, register socket in ChatServer._rooms for Notify broadcast.

    function handleJoinRoom(request, callback) {
        var roomId = request.roomId;
        var userId = request.userId;
        var socket = ChatServer.currentSocket;

        log.info('JOIN', 'handleJoinRoom');
        log.details('request', [
            ['userId', userId || '-'],
            ['roomId', roomId || '-'],
            ['socketId', socket ? socket.id : '(none)']
        ]);

        if (!roomId) {
            log.error('JOIN', 'handleJoinRoom — missing roomId');
            callback({ _record: [] });
            return;
        }

        // Register this socket in the room (for Notify broadcast)
        if (socket && socket.connected) {
            ChatServer.socketJoinRoom(socket, roomId);
            log.details('room', [
                ['action', 'JOINED'],
                ['roomId', roomId],
                ['socketId', socket.id],
                ['roomSize', String(ChatServer.getRoomSize(roomId))]
            ]);
        } else {
            log.warn('JOIN', 'No active socket for joinRoom — room not registered for Notify');
        }

        // Get recent messages from MySQL via api.php
        apiCall('chatJoinRoom', {
            userId: userId,
            roomId: roomId
        }).then(function (result) {
            var record = result._record || [];

            log.info('JOIN', 'handleJoinRoom → success');
            log.details('response', [
                ['roomId', roomId],
                ['recordCount', String(record.length)]
            ]);

            // Log first few records for verification
            if (record.length > 0) {
                for (var i = 0; i < Math.min(3, record.length); i++) {
                    var msg = record[i];
                    log.debug('JOIN', 'record[' + i + ']:');
                    log.details('message', [
                        ['_id', msg._id || '-'],
                        ['_kind', String(msg._kind)],
                        ['_name', msg._name || '(no name)'],
                        ['_content', (msg._content || '').substring(0, 40)],
                        ['_time', String(msg._time)]
                    ]);
                }
            }

            callback({ _record: record });
        }).catch(function (err) {
            // MySQL failed — return empty record (graceful degradation)
            log.error('JOIN', 'handleJoinRoom → MySQL FAILED, returning empty record');
            log.importantDetails('error', [
                ['roomId', roomId],
                ['error', err.message || String(err)],
                ['fallback', '_record: [] — no chat history loaded']
            ]);
            callback({ _record: [] });
        });
    }

    // =================================================================
    // 3. leaveRoom — Leave room, unregister socket
    // =================================================================
    //
    // Evidence: L114622-114631
    //   Payload: {type:'chat', action:'leaveRoom', userId, roomId, version}
    //   Response: {} — client only checks ret:0
    //
    // Remove socket from room registry so it stops receiving Notify events.
    // Also remove membership from MySQL.

    function handleLeaveRoom(request, callback) {
        var roomId = request.roomId;
        var userId = request.userId;
        var socket = ChatServer.currentSocket;

        log.info('LEAVE', 'handleLeaveRoom');
        log.details('request', [
            ['userId', userId || '-'],
            ['roomId', roomId || '-'],
            ['socketId', socket ? socket.id : '(none)']
        ]);

        // Unregister this socket from the room (in-memory)
        if (socket) {
            ChatServer.socketLeaveRoom(socket, roomId);
            log.details('room', [
                ['action', 'LEFT'],
                ['roomId', roomId],
                ['socketId', socket.id],
                ['roomSize', String(ChatServer.getRoomSize(roomId))]
            ]);
        }

        // Remove membership from MySQL via api.php
        apiCall('chatLeaveRoom', {
            userId: userId,
            roomId: roomId
        }).then(function () {
            log.info('LEAVE', 'handleLeaveRoom → success (MySQL + in-memory)');
            callback({});
        }).catch(function (err) {
            // MySQL failed but in-memory cleanup done — still succeed
            log.error('LEAVE', 'handleLeaveRoom → MySQL FAILED (in-memory cleanup done)');
            log.importantDetails('error', [
                ['roomId', roomId],
                ['error', err.message || String(err)]
            ]);
            callback({});
        });
    }

    // =================================================================
    // 4. sendMsg — Kirim pesan ke room
    // =================================================================
    //
    // Evidence: L83831-83856
    //   ToolCommon.sendMsg → processHandlerWithChat({type:'chat',
    //     action:'sendMsg', userId, kind, content, msgType, param,
    //     roomId, version:'1.0'}, cb)
    //
    //   Room selection by kind (L83835):
    //     WORLD       → worldRoomId
    //     GUILD       → guildRoomId
    //     WORLD_TEAM  → teamDungeonChatRoom
    //     TEAM        → teamChatRoomId
    //
    //   Response (L83846-83848):
    //     callback(e) → ts.createLocalData(t, n, e._time, a, r)
    //     e._time = Unix timestamp (seconds) for client-side local data
    //
    //   Error handling (L83851-83855):
    //     ret 36001 → "chat cooldown" bar tip
    //
    // After response, broadcast Notify to all OTHER sockets in same room.
    //
    // Notify envelope (L114242-114245):
    //   {ret: 'SUCCESS', data: JSON.stringify({_msg: msgObj}), compress: false}
    //
    // Message object structure (ChatDataBaseClass.getData, L92098-92110):
    //   _id (= userId), _type, _time, _kind, _name, _content, _image, _param,
    //   _headEffect, _headBox, _oriServerId, _serverId, _showMain

    function handleSendMsg(request, callback) {
        var userId  = request.userId;
        var roomId  = request.roomId;
        var kind    = request.kind;
        var content = request.content || '';
        var msgType = request.msgType || 0;
        var param   = request.param || '';
        var serverId = request.serverId || '1';
        var socket  = ChatServer.currentSocket;

        // Kind name for logging
        var kindName = '(unknown)';
        var kindMap = ChatServer.MESSAGE_KIND || {};
        for (var k in kindMap) {
            if (kindMap.hasOwnProperty(k) && kindMap[k] === kind) {
                kindName = k;
                break;
            }
        }

        log.info('MSG', 'handleSendMsg');
        log.details('request', [
            ['userId', userId || '-'],
            ['roomId', roomId || '-'],
            ['kind', String(kind) + ' (' + kindName + ')'],
            ['content', content.substring(0, 60)],
            ['msgType', String(msgType)],
            ['param', param ? String(param).substring(0, 40) : '-']
        ]);

        // Read user profile from main-server localStorage for MySQL sync
        var userInfo = getUserInfo(userId, serverId);
        var profile = extractUserProfile(userInfo);

        // Send to api.php → MySQL
        apiCall('chatSendMsg', {
            userId:     userId,
            roomId:     roomId,
            kind:       kind,
            content:    content,
            msgType:    msgType,
            param:      param,
            serverId:   serverId,
            nickName:   profile.nickName,
            headImage:  profile.headImage,
            headEffect: profile.headEffect,
            headBox:    profile.headBox
        }).then(function (result) {
            var now = result._time || ChatServer.nowTimestamp();

            log.info('MSG', 'handleSendMsg → saved to MySQL & responding');
            log.details('response', [
                ['_time', String(now)],
                ['_id', result._id || userId],
                ['sender', result._name || profile.nickName || ('User_' + userId)]
            ]);

            // Respond with timestamp — client uses this for createLocalData (L83847)
            callback({ _time: now });

            // Broadcast Notify to all OTHER sockets in the same room
            // (exclude sender — client already created local data via sendMsg callback)
            if (socket) {
                // Build message object for Notify broadcast
                // Matches ChatDataBaseClass.getData format (L92098-92110)
                var notifyMsg = {
                    _id:          userId,                       // sender userId (blacklist check)
                    _type:        msgType,                      // message type (required)
                    _time:        now,                          // Unix timestamp
                    _kind:        kind,                         // MESSAGE_KIND
                    _name:        result._name || profile.nickName || ('User_' + userId),
                    _content:     content,
                    _image:       result._image || profile.headImage || '',
                    _param:       param,
                    _headEffect:  result._headEffect || profile.headEffect || '0',
                    _headBox:     result._headBox || profile.headBox || '0',
                    _oriServerId: result._serverId || serverId,
                    _serverId:    result._serverId || serverId,
                    _showMain:    false
                };

                ChatServer.emitNotifyToRoom(roomId, notifyMsg, socket);
            }
        }).catch(function (err) {
            // MySQL failed — respond with current timestamp anyway
            // so client doesn't hang, but message won't be persisted or broadcast
            var fallbackTime = ChatServer.nowTimestamp();

            log.error('MSG', 'handleSendMsg → MySQL FAILED, fallback response');
            log.importantDetails('error', [
                ['userId', userId],
                ['roomId', roomId],
                ['error', err.message || String(err)],
                ['fallback', '_time: ' + fallbackTime + ' (NOT persisted, NOT broadcast)']
            ]);

            callback({ _time: fallbackTime });
        });
    }

    // =================================================================
    // 5. getRecord — Ambil history pesan since startTime
    // =================================================================
    //
    // Evidence: L114612-114621 pattern
    //   Payload: {type:'chat', action:'getRecord', userId, roomId, startTime, version}
    //   Response: {_record: [...]} — array of message objects
    //
    // Used by client to load older messages when scrolling chat history.

    function handleGetRecord(request, callback) {
        var roomId    = request.roomId;
        var startTime = request.startTime || 0;

        log.info('RECORD', 'handleGetRecord');
        log.details('request', [
            ['userId', request.userId || '-'],
            ['roomId', roomId || '-'],
            ['startTime', String(startTime)]
        ]);

        if (!roomId) {
            log.error('RECORD', 'handleGetRecord — missing roomId');
            callback({ _record: [] });
            return;
        }

        // Get messages from MySQL via api.php
        apiCall('chatGetRecord', {
            userId:    request.userId,
            roomId:    roomId,
            startTime: startTime
        }).then(function (result) {
            var record = result._record || [];

            log.info('RECORD', 'handleGetRecord → success');
            log.details('response', [
                ['roomId', roomId],
                ['startTime', String(startTime)],
                ['recordCount', String(record.length)]
            ]);

            callback({ _record: record });
        }).catch(function (err) {
            log.error('RECORD', 'handleGetRecord → MySQL FAILED');
            log.importantDetails('error', [
                ['roomId', roomId],
                ['error', err.message || String(err)],
                ['fallback', '_record: []']
            ]);
            callback({ _record: [] });
        });
    }

    // =================================================================
    // Export
    // =================================================================

    ChatServer.handlers = {
        login:     handleLogin,
        joinRoom:  handleJoinRoom,
        leaveRoom: handleLeaveRoom,
        sendMsg:   handleSendMsg,
        getRecord: handleGetRecord
    };

    ChatServer._handlerNames = Object.keys(ChatServer.handlers);
    ChatServer._handlerCount = ChatServer._handlerNames.length;

    window.ChatServer = ChatServer;
})();
