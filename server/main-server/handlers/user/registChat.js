/**
 * handlers/user/registChat.js — RegistChat Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: user/registChat
 * ============================================================
 *
 * Client call: processHandler({type:'user',action:'registChat',userId,version:'1.0'}, cb)
 *
 * v3 FIX:
 *   Chat server URL boleh _success:true karena index.js v3 sudah
 *   meng-intercept io.connect untuk :8002 (DummySocket).
 *   Tapi HAPUS _guildRoomId dan _teamChatRoom yang tidak pernah
 *   dikirim server asli (bukti dari HAR).
 *
 * HAR evidence (1 sample):
 *   Response fields: type, action, userId, version, _chatServerUrl,
 *                    _worldRoomId, _teamDungeonChatRoom, _success
 *   TIDAK ada: _guildRoomId, _teamChatRoom
 *
 * Client mapping (L114470):
 *   n._success               → if (n._success) { ... } else { retry }
 *   n._chatServerUrl         → ts.loginInfo.serverItem.chaturl
 *   n._worldRoomId           → ts.loginInfo.serverItem.worldRoomId
 *   n._guildRoomId           → (TIDAK di-read dari response, tapi dari enterGame)
 *   n._teamDungeonChatRoom   → ts.loginInfo.serverItem.teamDungeonChatRoom
 *   n._teamChatRoom          → (TIDAK di-read dari response)
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.user) {
        MainServer.handlers.user = {};
    }

    function handleRegistChat(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'registChat processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            if (!userId) {
                log.error('HANDLER', 'Missing userId in registChat request');
                callback({ _success: false });
                return;
            }

            var serverId = request.serverId || 1;

            // Room IDs — worldRoomId WAJIB non-empty (tanpa guard di chat join)
            // teamDungeonChatRoom ada guard → boleh empty
            var worldRoomId = 'world_' + serverId;
            var teamDungeonChatRoom = 'teamdungeon_' + serverId;

            // v3: response sesuai HAR — tidak kirim _guildRoomId dan _teamChatRoom
            var responseData = {
                type: request.type,
                action: request.action,
                userId: userId,
                version: request.version || '1.0',
                _success: true,
                _chatServerUrl: MainServer.config.chatServerUrl,
                _worldRoomId: worldRoomId,
                _teamDungeonChatRoom: teamDungeonChatRoom
            };

            log.info('HANDLER', 'registChat success');
            log.details('response', [
                ['_success', 'true'],
                ['_chatServerUrl', responseData._chatServerUrl],
                ['_worldRoomId', responseData._worldRoomId],
                ['_teamDungeonChatRoom', responseData._teamDungeonChatRoom]
            ]);

            callback(responseData);

        } catch (err) {
            log.error('HANDLER', 'registChat UNCAUGHT ERROR', err);
            callback({ _success: false });
        }
    }

    MainServer.registerHandler('user', 'registChat', handleRegistChat);

    window.MainServer = MainServer;
})();