/**
 * handlers/friend/friendServerAction.js — Friend Server Action Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DRAFT — Review dulu sebelum upload                            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Client call: processHandler({type:'friend', action:'friendServerAction',
 *               relayAction:'...', userId, version:'1.0', ...extraFields}, cb)
 *
 * Semua relayAction masuk ke 1 handler ini, lalu di-dispatch internally
 * berdasarkan request.relayAction.
 *
 * ═══════════════════════════════════════════════════════════════════
 * RELAY ACTIONS (15 unique):
 * ═══════════════════════════════════════════════════════════════════
 *
 * ┌───────────────────┬───────────────────┬───────────────────────────┐
 * │ relayAction       │ Extra Req Fields  │ Response Fields           │
 * ├───────────────────┼───────────────────┼───────────────────────────┤
 * │ queryFriends      │ (none)            │ { users: {[id]: FSUser} }  │
 * │ queryBlackList    │ (none)            │ { users: {[id]: FSUser} }  │
 * │ queryApplyList    │ (none)            │ { users: {[id]: FSUser} }  │
 * │ apply             │ friendIds:[]      │ (ack only)                │
 * │ handleApply       │ agree, friendId   │ (ack only)                │
 * │ delFriend         │ friendId          │ (ack only)                │
 * │ addToBlacklist    │ friendId          │ (ack only)                │
 * │ removeBalcklist   │ friendId          │ (ack only)                │
 * │ chat              │ friendId,msgType,  │ (ack only)                │
 * │                   │   params           │                           │
 * │ sendMsg           │ friendId, msg      │ (ack only, local build)   │
 * │ getMsg            │ friendId, time    │ { _msgs: [{_time,_isSelf,  │
 * │                   │                   │   _context,_type}] }      │
 * │ getMsgList        │ (none)            │ { _brief: {[friendId]: {   │
 * │                   │                   │   lastMsgTime,lastReadTime,│
 * │                   │                   │   msg}} }                 │
 * │ readMsg           │ friendId          │ { _readTime: timestamp }   │
 * │ getChatMsg        │ time              │ { _msgs: [{_type,_from,    │
 * │                   │                   │   _time,teamExist}] }     │
 * │ delMsg            │ friendId          │ (ack only)                │
 * └───────────────────┴───────────────────┴───────────────────────────┘
 *
 * ⚠️ NOTE: removeBalcklist = TYPO dari client (huruf 'c' kelebihan).
 *    Server HARUS match exact spelling ini.
 *
 * ═══════════════════════════════════════════════════════════════════
 * DATA SOURCE: localStorage (prefix friend:)
 * ═══════════════════════════════════════════════════════════════════
 *
 * friend:{userId}        → { friends:[], blacklist:[], applyList:[], messages:{}, inviteMessages:[] }
 * friend:profile:{userId} → { _nickName, _headImage, _level, _serverId, ... }
 *
 * FSUser fields (TeamUserItem + state):
 *   _id, _nickName, _headImage, _headEffect, _headBox,
 *   _guildName, _level, _vip, _oriServerId, _serverId,
 *   _superSkill, _teams, _totalPower, state (0=OFFLINE,1=ONLINE,2=IN_TEAM)
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.friend) {
        MainServer.handlers.friend = {};
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPER: Data Access
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get friend data for a user.
     * Initialize if not exists.
     */
    function getFriendData(userId) {
        var key = 'friend:' + userId;
        var data = db._get(key);

        if (!data) {
            data = {
                friends: [],
                blacklist: [],
                applyList: [],
                messages: {},       // { [friendId]: [{_time,_isSelf,_context,_type}] }
                inviteMessages: []  // [{_type,_from,_time,teamExist,_params}]
            };
            db._set(key, data);
        }

        return data;
    }

    /**
     * Save friend data.
     */
    function saveFriendData(userId, data) {
        var key = 'friend:' + userId;
        db._set(key, data);
    }

    /**
     * Get user profile (baca dari saved user data di main-server).
     * Mengambil data user yang sudah disimpan saat enterGame.
     */
    function getUserProfile(userId) {
        // Coba baca dari user:{userId}
        var storageKey = 'user:' + userId;
        var userData = db._get(storageKey);

        if (userData && userData.user) {
            return {
                _id: userData.user._id,
                _nickName: userData.user._nickName,
                _headImage: userData.user._headImage,
                _headEffect: (userData.user._headEffect || 0),
                _headBox: (userData.user._headBox || 0),
                _guildName: '',
                _level: (userData.level || 1),
                _vip: (userData.vip || 0),
                _oriServerId: (userData.user._oriServerId || 1),
                _serverId: 1,
                _totalPower: 0,
                _superSkill: [],
                state: 1  // ONLINE by default (single-server, semua online)
            };
        }

        return {
            _id: userId,
            _nickName: 'Player',
            _headImage: 'hero_icon_1205',
            _headEffect: 0,
            _headBox: 0,
            _guildName: '',
            _level: 1,
            _vip: 0,
            _oriServerId: 1,
            _serverId: 1,
            _totalPower: 0,
            _superSkill: [],
            state: 1
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN HANDLER: friendServerAction
    // ═══════════════════════════════════════════════════════════════

    /**
     * handleFriendServerAction(request, callback)
     *
     * Router internal berdasarkan request.relayAction.
     *
     * @param {object} request  — { type:'friend', action:'friendServerAction',
     *                              relayAction, userId, version, ...extraFields }
     * @param {function} callback — callback(responseData)
     */
    function handleFriendServerAction(request, callback) {
        var userId = request.userId;
        var relayAction = request.relayAction;

        log.info('HANDLER', 'friendServerAction processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['relayAction', relayAction || '-']
        ]);

        if (!userId) {
            log.error('HANDLER', 'Missing userId in friendServerAction');
            callback({ _error: 'missing_userId' });
            return;
        }

        if (!relayAction) {
            log.error('HANDLER', 'Missing relayAction in friendServerAction');
            callback({ _error: 'missing_relayAction' });
            return;
        }

        // Dispatch ke relayAction handler
        switch (relayAction) {

            // ─── FRIEND LIST ────────────────────────────────────
            case 'queryFriends':
                handleQueryFriends(userId, callback);
                break;

            // ─── BLACKLIST ─────────────────────────────────────
            case 'queryBlackList':
                handleQueryBlackList(userId, callback);
                break;

            // ─── APPLY LIST ────────────────────────────────────
            case 'queryApplyList':
                handleQueryApplyList(userId, callback);
                break;

            // ─── SEND FRIEND REQUEST ────────────────────────────
            case 'apply':
                handleApply(userId, request.friendIds, callback);
                break;

            // ─── ACCEPT/REJECT APPLICATION ─────────────────────
            case 'handleApply':
                handleAcceptApply(userId, request.friendId, request.agree, callback);
                break;

            // ─── DELETE FRIEND ─────────────────────────────────
            case 'delFriend':
                handleDelFriend(userId, request.friendId, callback);
                break;

            // ─── BLACKLIST ACTIONS ─────────────────────────────
            case 'addToBlacklist':
                handleAddToBlacklist(userId, request.friendId, callback);
                break;

            // ⚠️ TYPO from client — must match exact spelling
            case 'removeBalcklist':
                handleRemoveFromBlacklist(userId, request.friendId, callback);
                break;

            // ─── CHAT / INVITE ─────────────────────────────────
            case 'chat':
                handleChat(userId, request.friendId, request.msgType, request.params, callback);
                break;

            // ─── SEND MESSAGE ──────────────────────────────────
            case 'sendMsg':
                handleSendMsg(userId, request.friendId, request.msg, callback);
                break;

            // ─── GET MESSAGES ───────────────────────────────────
            case 'getMsg':
                handleGetMsg(userId, request.friendId, request.time, callback);
                break;

            // ─── GET MESSAGE LIST (BRIEF) ──────────────────────
            case 'getMsgList':
                handleGetMsgList(userId, callback);
                break;

            // ─── READ MESSAGES ─────────────────────────────────
            case 'readMsg':
                handleReadMsg(userId, request.friendId, callback);
                break;

            // ─── GET CHAT/INVITE MESSAGES ──────────────────────
            case 'getChatMsg':
                handleGetChatMsg(userId, request.time, callback);
                break;

            // ─── DELETE MESSAGES ────────────────────────────────
            case 'delMsg':
                handleDelMsg(userId, request.friendId, callback);
                break;

            default:
                log.warn('HANDLER', 'Unknown relayAction: ' + relayAction);
                callback({ _error: 'unknown_relayAction' });
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // RELAY ACTION HANDLERS
    // ═══════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────
    // queryFriends — Fetch friend list
    // Response: { users: { [userId]: FSUser } }
    // ───────────────────────────────────────────────────────────
    function handleQueryFriends(userId, callback) {
        var data = getFriendData(userId);
        var users = {};

        for (var i = 0; i < data.friends.length; i++) {
            var friendId = data.friends[i];
            // Ambil profile teman (atau buat placeholder)
            var profile = getUserProfile(friendId);
            users[friendId] = profile;
        }

        log.info('HANDLER', 'queryFriends → ' + Object.keys(users).length + ' friends');
        callback({ users: users });
    }

    // ───────────────────────────────────────────────────────────
    // queryBlackList — Fetch blacklist
    // Response: { users: { [userId]: FSUser } }
    // ───────────────────────────────────────────────────────────
    function handleQueryBlackList(userId, callback) {
        var data = getFriendData(userId);
        var users = {};

        for (var i = 0; i < data.blacklist.length; i++) {
            var blockedId = data.blacklist[i];
            var profile = getUserProfile(blockedId);
            users[blockedId] = profile;
        }

        log.info('HANDLER', 'queryBlackList → ' + Object.keys(users).length + ' blocked');
        callback({ users: users });
    }

    // ───────────────────────────────────────────────────────────
    // queryApplyList — Fetch pending friend applications
    // Response: { users: { [userId]: FSUser } }
    // ───────────────────────────────────────────────────────────
    function handleQueryApplyList(userId, callback) {
        var data = getFriendData(userId);
        var users = {};

        for (var i = 0; i < data.applyList.length; i++) {
            var applicantId = data.applyList[i];
            var profile = getUserProfile(applicantId);
            users[applicantId] = profile;
        }

        log.info('HANDLER', 'queryApplyList → ' + Object.keys(users).length + ' pending');
        callback({ users: users });
    }

    // ───────────────────────────────────────────────────────────
    // apply — Send friend request(s)
    // Extra req: friendIds (array of userIds)
    // Response: ack only
    // ───────────────────────────────────────────────────────────
    function handleApply(userId, friendIds, callback) {
        if (!friendIds || !Array.isArray(friendIds) || friendIds.length === 0) {
            log.warn('HANDLER', 'apply — no friendIds provided');
            callback({});
            return;
        }

        for (var i = 0; i < friendIds.length; i++) {
            var targetId = String(friendIds[i]);
            var targetData = getFriendData(targetId);

            // Cek apakah sudah ada di friend list
            var alreadyFriend = targetData.friends.indexOf(userId) !== -1;
            var alreadyApplied = targetData.applyList.indexOf(userId) !== -1;

            if (!alreadyFriend && !alreadyApplied) {
                targetData.applyList.push(userId);
                saveFriendData(targetId, targetData);

                log.info('HANDLER', 'apply → request added for user: ' + targetId);
            } else {
                log.info('HANDLER', 'apply → already friend/applied: ' + targetId);
            }
        }

        callback({});
    }

    // ───────────────────────────────────────────────────────────
    // handleApply — Accept/reject friend application
    // Extra req: friendId (applicant), agree (boolean)
    // Response: ack only
    // ───────────────────────────────────────────────────────────
    function handleAcceptApply(userId, friendId, agree, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'handleApply — no friendId');
            callback({});
            return;
        }

        friendId = String(friendId);
        var data = getFriendData(userId);

        // Hapus dari apply list
        var idx = data.applyList.indexOf(friendId);
        if (idx !== -1) {
            data.applyList.splice(idx, 1);
        }

        if (agree) {
            // Tambahkan ke friend list (dua arah)
            if (data.friends.indexOf(friendId) === -1) {
                data.friends.push(friendId);
            }

            // Tambahkan user juga ke friend list target
            var targetData = getFriendData(friendId);
            if (targetData.friends.indexOf(userId) === -1) {
                targetData.friends.push(userId);
            }
            saveFriendData(friendId, targetData);

            log.info('HANDLER', 'handleApply → ACCEPTED friend: ' + friendId);
        } else {
            log.info('HANDLER', 'handleApply → REJECTED friend: ' + friendId);
        }

        saveFriendData(userId, data);
        callback({});
    }

    // ───────────────────────────────────────────────────────────
    // delFriend — Remove friend
    // Extra req: friendId
    // Response: ack only
    // ───────────────────────────────────────────────────────────
    function handleDelFriend(userId, friendId, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'delFriend — no friendId');
            callback({});
            return;
        }

        friendId = String(friendId);

        // Hapus dari friend list user
        var data = getFriendData(userId);
        var idx = data.friends.indexOf(friendId);
        if (idx !== -1) {
            data.friends.splice(idx, 1);
        }

        // Hapus dari friend list target juga (dua arah)
        var targetData = getFriendData(friendId);
        var tIdx = targetData.friends.indexOf(userId);
        if (tIdx !== -1) {
            targetData.friends.splice(tIdx, 1);
        }
        saveFriendData(friendId, targetData);

        // Hapus juga messages
        delete data.messages[friendId];
        saveFriendData(userId, data);

        log.info('HANDLER', 'delFriend → removed: ' + friendId);
        callback({});
    }

    // ───────────────────────────────────────────────────────────
    // addToBlacklist — Add to blacklist (implicit remove friend)
    // Extra req: friendId
    // Response: ack only
    // ───────────────────────────────────────────────────────────
    function handleAddToBlacklist(userId, friendId, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'addToBlacklist — no friendId');
            callback({});
            return;
        }

        friendId = String(friendId);
        var data = getFriendData(userId);

        // Hapus dari friend list
        var fIdx = data.friends.indexOf(friendId);
        if (fIdx !== -1) {
            data.friends.splice(fIdx, 1);
        }

        // Hapus dari apply list
        var aIdx = data.applyList.indexOf(friendId);
        if (aIdx !== -1) {
            data.applyList.splice(aIdx, 1);
        }

        // Tambahkan ke blacklist
        if (data.blacklist.indexOf(friendId) === -1) {
            data.blacklist.push(friendId);
        }

        // Hapus messages
        delete data.messages[friendId];
        saveFriendData(userId, data);

        log.info('HANDLER', 'addToBlacklist → blocked: ' + friendId);
        callback({});
    }

    // ───────────────────────────────────────────────────────────
    // removeBalcklist — ⚠️ TYPO from client, must match exactly
    // Extra req: friendId
    // Response: ack only
    // ───────────────────────────────────────────────────────────
    function handleRemoveFromBlacklist(userId, friendId, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'removeBalcklist — no friendId');
            callback({});
            return;
        }

        friendId = String(friendId);
        var data = getFriendData(userId);

        var idx = data.blacklist.indexOf(friendId);
        if (idx !== -1) {
            data.blacklist.splice(idx, 1);
        }

        saveFriendData(userId, data);

        log.info('HANDLER', 'removeBalcklist → unblocked: ' + friendId);
        callback({});
    }

    // ───────────────────────────────────────────────────────────
    // chat — Send structured invite (e.g. team dungeon)
    // Extra req: friendId, msgType, params
    // Response: ack only
    // ───────────────────────────────────────────────────────────
    function handleChat(userId, friendId, msgType, params, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'chat — no friendId');
            callback({});
            return;
        }

        friendId = String(friendId);

        // Simpan sebagai invite message di target
        var targetData = getFriendData(friendId);
        if (!targetData.inviteMessages) {
            targetData.inviteMessages = [];
        }

        targetData.inviteMessages.push({
            _type: msgType,
            _from: userId,
            _time: Date.now(),
            _params: params || {},
            teamExist: true  // Default true
        });

        saveFriendData(friendId, targetData);

        log.info('HANDLER', 'chat → invite sent to: ' + friendId + ', type: ' + msgType);
        callback({});
    }

    // ───────────────────────────────────────────────────────────
    // sendMsg — Send free-text message
    // Extra req: friendId, msg (string)
    // Response: ack only (client builds local message object)
    // ───────────────────────────────────────────────────────────
    function handleSendMsg(userId, friendId, msg, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'sendMsg — no friendId');
            callback({});
            return;
        }

        friendId = String(friendId);
        var now = Date.now();

        var messageObj = {
            _time: now,
            _isSelf: true,
            _context: msg,
            _type: 0
        };

        // Simpan di pengirim
        var senderData = getFriendData(userId);
        if (!senderData.messages[friendId]) {
            senderData.messages[friendId] = [];
        }
        senderData.messages[friendId].push(messageObj);
        saveFriendData(userId, senderData);

        // Simpan juga di penerima (dengan _isSelf = false)
        var targetData = getFriendData(friendId);
        if (!targetData.messages[userId]) {
            targetData.messages[userId] = [];
        }
        targetData.messages[userId].push({
            _time: now,
            _isSelf: false,
            _context: msg,
            _type: 0
        });
        saveFriendData(friendId, targetData);

        log.info('HANDLER', 'sendMsg → to: ' + friendId);
        callback({});
    }

    // ───────────────────────────────────────────────────────────
    // getMsg — Get message history with friend
    // Extra req: friendId, time (timestamp for pagination)
    // Response: { _msgs: [{_time, _isSelf, _context, _type}] }
    // ───────────────────────────────────────────────────────────
    function handleGetMsg(userId, friendId, time, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'getMsg — no friendId');
            callback({ _msgs: [] });
            return;
        }

        friendId = String(friendId);
        var data = getFriendData(userId);
        var msgs = data.messages[friendId] || [];

        // Filter: kirim semua message, client yang handle pagination
        // Client pakai `time` untuk load-older (kirim semua, client sort by time)
        var response = [];

        for (var i = 0; i < msgs.length; i++) {
            response.push({
                _time: msgs[i]._time,
                _isSelf: msgs[i]._isSelf,
                _context: msgs[i]._context,
                _type: msgs[i]._type || 0
            });
        }

        log.info('HANDLER', 'getMsg → ' + response.length + ' messages with: ' + friendId);
        callback({ _msgs: response });
    }

    // ───────────────────────────────────────────────────────────
    // getMsgList — Get conversation summaries
    // Response: { _brief: { [friendId]: { lastMsgTime, lastReadTime, msg } } }
    // ───────────────────────────────────────────────────────────
    function handleGetMsgList(userId, callback) {
        var data = getFriendData(userId);
        var messages = data.messages || {};
        var brief = {};

        for (var friendId in messages) {
            var msgs = messages[friendId];
            if (msgs.length > 0) {
                var lastMsg = msgs[msgs.length - 1];
                var preview = lastMsg._context || '';
                if (preview.length > 20) {
                    preview = preview.substring(0, 20) + '...';
                }

                brief[friendId] = {
                    lastMsgTime: lastMsg._time,
                    lastReadTime: 0,  // Single-server, simplified
                    msg: preview
                };
            }
        }

        log.info('HANDLER', 'getMsgList → ' + Object.keys(brief).length + ' conversations');
        callback({ _brief: brief });
    }

    // ───────────────────────────────────────────────────────────
    // readMsg — Mark messages as read
    // Extra req: friendId
    // Response: { _readTime: timestamp }
    // ───────────────────────────────────────────────────────────
    function handleReadMsg(userId, friendId, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'readMsg — no friendId');
            callback({ _readTime: 0 });
            return;
        }

        friendId = String(friendId);
        var readTime = Date.now();

        // Update lastReadTime di message list
        var data = getFriendData(userId);
        var brief = data.messages[friendId] || [];
        // Untuk single-server, readTime cukup dikembalikan
        // Client akan simpan local via TeamworkMailInfoManager

        log.info('HANDLER', 'readMsg → friend: ' + friendId + ', readTime: ' + readTime);
        callback({ _readTime: readTime });
    }

    // ───────────────────────────────────────────────────────────
    // getChatMsg — Get invite messages (team dungeon etc.)
    // Extra req: time (current server time)
    // Response: { _msgs: [{_type, _from, _time, teamExist}] }
    // ───────────────────────────────────────────────────────────
    function handleGetChatMsg(userId, time, callback) {
        var data = getFriendData(userId);
        var invites = data.inviteMessages || [];

        var response = [];
        for (var i = 0; i < invites.length; i++) {
            response.push({
                _type: invites[i]._type,
                _from: invites[i]._from,
                _time: invites[i]._time,
                teamExist: invites[i].teamExist || false
            });
        }

        log.info('HANDLER', 'getChatMsg → ' + response.length + ' invites');
        callback({ _msgs: response });
    }

    // ───────────────────────────────────────────────────────────
    // delMsg — Delete conversation with friend
    // Extra req: friendId
    // Response: ack only
    // ───────────────────────────────────────────────────────────
    function handleDelMsg(userId, friendId, callback) {
        if (!friendId) {
            log.warn('HANDLER', 'delMsg — no friendId');
            callback({});
            return;
        }

        friendId = String(friendId);
        var data = getFriendData(userId);

        delete data.messages[friendId];
        saveFriendData(userId, data);

        log.info('HANDLER', 'delMsg → cleared messages with: ' + friendId);
        callback({});
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS (via console)
    // ═══════════════════════════════════════════════════════════════

    /**
     * MainServer.admin.getFriendData(userId)
     * Lihat semua friend data user.
     *
     * Contoh: MainServer.admin.getFriendData('guest_xxx')
     */
    MainServer.admin.getFriendData = function (userId) {
        var data = getFriendData(userId);
        log.info('ADMIN', 'Friend data for: ' + userId);
        log.details('friends', [String(data.friends.length)]);
        log.details('blacklist', [String(data.blacklist.length)]);
        log.details('applyList', [String(data.applyList.length)]);

        var convCount = Object.keys(data.messages || {}).length;
        log.details('conversations', [String(convCount)]);
        log.details('inviteMessages', [String((data.inviteMessages || []).length)]);

        return data;
    };

    /**
     * MainServer.admin.clearFriendData(userId)
     * Reset semua friend data user.
     *
     * Contoh: MainServer.admin.clearFriendData('guest_xxx')
     */
    MainServer.admin.clearFriendData = function (userId) {
        var key = 'friend:' + userId;
        db._set(key, {
            friends: [],
            blacklist: [],
            applyList: [],
            messages: {},
            inviteMessages: []
        });
        log.info('ADMIN', 'Friend data cleared for: ' + userId);
    };

    // ═══════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════

    MainServer.registerHandler('friend', 'friendServerAction', handleFriendServerAction);

    window.MainServer = MainServer;
})();
