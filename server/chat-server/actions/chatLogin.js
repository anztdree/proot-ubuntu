/**
 * actions/chatLogin.js — Handle chatLogin action
 * Super Warrior Z — CHAT SERVER
 *
 * Evidence: main.min.js
 *   chatLoginRequest → processHandlerWithChat({type:'chat', action:'login',
 *     userId, serverId, version:'1.0'}, cb)
 *   Response: empty {} — client only checks ret:0
 *
 * After login success, client joins 4 rooms in parallel:
 *   1. worldRoomId — ALWAYS (no guard)
 *   2. guildRoomId — guarded: if (ts.loginInfo.serverItem.guildRoomId)
 *   3. teamDungeonChatRoom — guarded
 *   4. teamChatRoomId — guarded
 *
 * Data source: login-server IndexedDB (last_game_server / loginInfo)
 *   Game asli pakai in-memory ts.loginInfo — kita baca dari IndexedDB.
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;

    // ══════════════════════════════════════════════════════════════════════════════
    // HANDLER: login
    // ══════════════════════════════════════════════════════════════════════════════

    function handleLogin(request, callback) {
        log.info('ACTION', 'chatLogin ═══════════');

        var userId = request.userId || '';
        var serverId = request.serverId || '1';

        if (!userId) {
            log.error('ACTION', 'chatLogin — missing userId');
            callback({});
            return;
        }

        // Baca profil dari login-server IndexedDB (async)
        ChatServer.getUserInfo(userId, serverId).then(function (profile) {
            var profileData = ChatServer.extractUserProfile(profile);

            log.details([
                ['userId', userId],
                ['serverId', serverId],
                ['nickName', profileData.nickName || '(empty)'],
                ['headImage', profileData.headImage ? '(set)' : '(default)'],
                ['headEffect', profileData.headEffect],
                ['headBox', profileData.headBox],
                ['source', 'IndexedDB (last_game_server/loginInfo)']
            ]);

            log.info('RESP', 'chatLogin → success');
            callback({});
        }).catch(function (e) {
            // IndexedDB gagal — tetap sukses, client tidak terpengaruh
            log.error('DB', 'chatLogin → getUserInfo failed, continuing');
            log.alwaysDetails([
                ['userId', userId],
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)],
                ['fallback', 'ret:0 — client continues']
            ]);
            callback({});
        });
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // REGISTER
    // ══════════════════════════════════════════════════════════════════════════════

    ChatServer.handlers['login'] = handleLogin;
    if (ChatServer._handlerNames.indexOf('login') === -1) {
        ChatServer._handlerNames.push('login');
    }
    ChatServer._handlerCount = ChatServer._handlerNames.length;

    window.ChatServer = ChatServer;
})();
