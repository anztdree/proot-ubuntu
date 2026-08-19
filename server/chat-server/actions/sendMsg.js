/**
 * actions/sendMsg.js — Handle sendMsg action
 * Super Warrior Z — CHAT SERVER
 *
 * Evidence: L83831-83856
 *   ToolCommon.sendMsg → processHandlerWithChat({type:'chat',
 *     action:'sendMsg', userId, kind, content, msgType, param,
 *     roomId, version:'1.0'}, cb)
 *
 *   Room selection by kind (L83835):
 *     WORLD       → worldRoomId
 *     GUILD       → guildRoomId
 *     WORLD_TEAM  → teamDungeonChatRoom
 *     TEAM        → teamChatRoomId
 *
 *   Response (L83846-83848):
 *     callback(e) → ts.createLocalData(t, n, e._time, a, r)
 *     e._time = Unix timestamp (seconds) for client-side local data
 *
 *   Error handling (L83851-83855):
 *     ret 36001 → "chat cooldown" bar tip
 *
 * After response, broadcast Notify to all OTHER sockets in same room.
 *
 * Notify envelope (L114242-114245):
 *   {ret: 'SUCCESS', data: JSON.stringify({_msg: msgObj}), compress: false}
 *
 * Message object structure (ChatDataBaseClass.getData, L92098-92110):
 *   _id (= userId), _type, _time, _kind, _name, _content, _image, _param,
 *   _headEffect, _headBox, _oriServerId, _serverId, _showMain
 *
 * Data source: IndexedDB (chat-server: chat)
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;
    var db = ChatServer.db;

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: sendMsg
    // ═══════════════════════════════════════════════════════════════════

    function handleSendMsg(request, callback) {
        log.info('ACTION', 'sendMsg ══════════════');

        var userId   = request.userId || '';
        var roomId   = request.roomId || '';
        var kind     = request.kind || 2;
        var content  = request.content || '';
        var msgType  = request.msgType || 0;
        var param    = request.param || '';
        var serverId = request.serverId || '1';
        var socket   = ChatServer.currentSocket;

        // Kind name for logging
        var kindName = '(unknown)';
        var kindMap = ChatServer.MESSAGE_KIND || {};
        for (var k in kindMap) {
            if (kindMap.hasOwnProperty(k) && kindMap[k] === kind) {
                kindName = k;
                break;
            }
        }

        log.details([
            ['userId', userId || '-'],
            ['roomId', roomId || '-'],
            ['kind', String(kind) + ' (' + kindName + ')'],
            ['content', content.substring(0, 60)],
            ['msgType', String(msgType)],
            ['param', param ? String(param).substring(0, 40) : '-']
        ]);

        // Baca profil dari login-server IndexedDB (async)
        ChatServer.getUserInfo(userId, serverId).then(function (profile) {
            var profileData = ChatServer.extractUserProfile(profile);
            var now = ChatServer.nowTimestamp();

            // Build message object for IndexedDB storage + Notify broadcast
            // Matches ChatDataBaseClass.getData format (L92098-92110)
            var msgObj = {
                _id:          userId,
                _type:        msgType,
                _time:        now,
                _kind:        kind,
                _name:        profileData.nickName || ('User_' + userId),
                _content:     content,
                _image:       profileData.headImage || '',
                _param:       param,
                _headEffect:  profileData.headEffect || '0',
                _headBox:     profileData.headBox || '0',
                _oriServerId: serverId,
                _serverId:    serverId,
                _showMain:    false,
                // Internal IndexedDB fields (not sent to client)
                roomId:       roomId
            };

            // Save ke IndexedDB (chat store)
            return db.put('chat', msgObj).then(function () {
                return { msgObj: msgObj, now: now };
            });
        }).then(function (result) {
            var msgObj = result.msgObj;
            var now = result.now;

            log.info('RESP', 'sendMsg → saved to IndexedDB & responding');
            log.details([
                ['_time', String(now)],
                ['_id', userId],
                ['_name', msgObj._name]
            ]);

            // Respond with timestamp — client uses for createLocalData (L83847)
            callback({ _time: now });

            // Broadcast Notify to all OTHER sockets in the same room
            if (socket) {
                // Build clean message for Notify (strip internal fields)
                var notifyMsg = {
                    _id:          msgObj._id,
                    _type:        msgObj._type,
                    _time:        msgObj._time,
                    _kind:        msgObj._kind,
                    _name:        msgObj._name,
                    _content:     msgObj._content,
                    _image:       msgObj._image,
                    _param:       msgObj._param,
                    _headEffect:  msgObj._headEffect,
                    _headBox:     msgObj._headBox,
                    _oriServerId: msgObj._oriServerId,
                    _serverId:    msgObj._serverId,
                    _showMain:    msgObj._showMain
                };
                ChatServer.emitNotifyToRoom(roomId, notifyMsg, socket);
            }
        }).catch(function (e) {
            // IndexedDB/getUserInfo gagal — respond dengan timestamp anyway
            log.error('DB', 'sendMsg → error, fallback response');
            log.alwaysDetails([
                ['userId', userId],
                ['roomId', roomId],
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)],
                ['fallback', '_time response sent (may not be persisted)']
            ]);
            callback({ _time: ChatServer.nowTimestamp() });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    ChatServer.handlers['sendMsg'] = handleSendMsg;
    if (ChatServer._handlerNames.indexOf('sendMsg') === -1) {
        ChatServer._handlerNames.push('sendMsg');
    }
    ChatServer._handlerCount = ChatServer._handlerNames.length;

    window.ChatServer = ChatServer;
})();
