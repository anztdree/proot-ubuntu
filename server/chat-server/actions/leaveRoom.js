/**
 * actions/leaveRoom.js — Handle leaveRoom action
 * Super Warrior Z — CHAT SERVER
 *
 * Evidence: main.min.js
 *   Payload: {type:'chat', action:'leaveRoom', userId, roomId, version}
 *   Response: {} — client only checks ret:0
 *
 * Hanya unregister socket dari in-memory room.
 * TIDAK ada IndexedDB cleanup — game asli juga tidak track membership di DB.
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: leaveRoom
    // ═══════════════════════════════════════════════════════════════════

    function handleLeaveRoom(request, callback) {
        log.info('ACTION', 'leaveRoom ═══════════');

        var roomId = request.roomId || '';
        var userId = request.userId || '';
        var socket = ChatServer.currentSocket;

        log.details([
            ['userId', userId || '-'],
            ['roomId', roomId],
            ['socketId', socket ? socket.id : '(none)']
        ]);

        // Unregister socket dari in-memory room (satu-satunya yang diperlukan)
        if (socket) {
            ChatServer.socketLeaveRoom(socket, roomId);
            log.details([
                ['roomAction', 'LEFT'],
                ['roomSize', String(ChatServer.getRoomSize(roomId))]
            ]);
        }

        log.info('RESP', 'leaveRoom → success (in-memory only)');
        callback({});
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    ChatServer.handlers['leaveRoom'] = handleLeaveRoom;
    if (ChatServer._handlerNames.indexOf('leaveRoom') === -1) {
        ChatServer._handlerNames.push('leaveRoom');
    }
    ChatServer._handlerCount = ChatServer._handlerNames.length;

    window.ChatServer = ChatServer;
})();
