/**
 * config.js — Chat Server Configuration
 * Super Warrior Z — CHAT SERVER
 *
 * Menggunakan ChatServerLog dari logger.js (folder yang sama).
 */

var ChatServer = window.ChatServer || {};

ChatServer.config = {
    apiBase: './server/chat-server/api.php',
    chatServerUrl: 'http://127.0.0.1:8002',
    teaKey: 'verification',
    verifyEnable: true,
    delayMin: 30,
    delayMax: 120,
    maxRecordPerRoom: 50,
    maxMessagesPerRequest: 30,
    maxReconnectWaitTime: 600000,
    reconnectionAttempts: 10,
    verbose: true
};

// Logger instance dari logger.js (harus load sebelum ini)
ChatServer.log = window.ChatServerLog;

// ═══════════════════════════════════════════
// MESSAGE_KIND constants (dari main.min.js)
// ═══════════════════════════════════════════
ChatServer.MESSAGE_KIND = {
    MK_NULL: 0,
    SYSTEM: 1,
    WORLD: 2,
    GUILD: 3,
    PRIVATE: 4,
    WORLD_TEAM: 5,
    TEAM: 6
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

ChatServer.randomDelay = function () {
    return Math.floor(Math.random() * (ChatServer.config.delayMax - ChatServer.config.delayMin + 1)) + ChatServer.config.delayMin;
};

ChatServer.generateChallenge = function () {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var result = '';
    for (var i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

ChatServer.nowTimestamp = function () {
    return Math.floor(Date.now() / 1000);
};

// ═══════════════════════════════════════════════════════════
// ROOM & NOTIFY MANAGEMENT
// ═══════════════════════════════════════════════════════════
//
// In-memory room registry. Socket references stored for Notify emission.
// Message persistence uses MySQL via api.php (handled in handlers.js).
// User profile synced from main-server localStorage during chatLogin.
//
// Evidence:
//   L114240-114261: listenNotify → socket.on('Notify', fn)
//     Notify envelope: {ret:'SUCCESS', data:JSON.stringify({_msg:...})}
//   L114632-114640: chatJoinRecord iterates _record → ChatDataBaseClass.getData
//   L83831-83856: sendMsg → callback({_time}) then broadcast to room
//   L82522: socket.on('Notify', e) — client listens for push events
//
// Room lifecycle:
//   joinRoom handler  → socketJoinRoom(socket, roomId)
//   leaveRoom handler → socketLeaveRoom(socket, roomId)
//   disconnect/destroy → socketLeaveAllRooms(socket)
//   sendMsg handler   → emitNotifyToRoom(roomId, msg, excludeSocket)
//
// _rooms:       roomId → [socketRef, socketRef, ...] (actual objects for _fire)
// _socketRooms: socketId → [roomId, roomId, ...] (for cleanup)

ChatServer._rooms = {};
ChatServer._socketRooms = {};

/**
 * socketJoinRoom(socket, roomId)
 * Register a socket in a room. Prevents duplicates.
 * Called from handleJoinRoom in handlers.js.
 */
ChatServer.socketJoinRoom = function (socket, roomId) {
    if (!ChatServer._rooms[roomId]) {
        ChatServer._rooms[roomId] = [];
    }
    var room = ChatServer._rooms[roomId];
    // Prevent duplicate registration
    for (var i = 0; i < room.length; i++) {
        if (room[i].id === socket.id) return;
    }
    room.push(socket);

    if (!ChatServer._socketRooms[socket.id]) {
        ChatServer._socketRooms[socket.id] = [];
    }
    var srooms = ChatServer._socketRooms[socket.id];
    if (srooms.indexOf(roomId) === -1) {
        srooms.push(roomId);
    }
};

/**
 * socketLeaveRoom(socket, roomId)
 * Unregister a socket from a room. Cleans up empty rooms.
 * Called from handleLeaveRoom in handlers.js.
 */
ChatServer.socketLeaveRoom = function (socket, roomId) {
    var room = ChatServer._rooms[roomId];
    if (room) {
        for (var i = room.length - 1; i >= 0; i--) {
            if (room[i].id === socket.id) {
                room.splice(i, 1);
                break;
            }
        }
        if (room.length === 0) {
            delete ChatServer._rooms[roomId];
        }
    }
    var srooms = ChatServer._socketRooms[socket.id];
    if (srooms) {
        var idx = srooms.indexOf(roomId);
        if (idx !== -1) srooms.splice(idx, 1);
    }
};

/**
 * socketLeaveAllRooms(socket)
 * Remove socket from ALL rooms. Called on disconnect/destroy.
 * Cleans up _socketRooms entry entirely.
 */
ChatServer.socketLeaveAllRooms = function (socket) {
    var rooms = ChatServer._socketRooms[socket.id] || [];
    for (var i = 0; i < rooms.length; i++) {
        ChatServer.socketLeaveRoom(socket, rooms[i]);
    }
    delete ChatServer._socketRooms[socket.id];
};

/**
 * getRoomSize(roomId)
 * Return number of sockets currently in a room.
 */
ChatServer.getRoomSize = function (roomId) {
    return (ChatServer._rooms[roomId] || []).length;
};

/**
 * emitNotifyToRoom(roomId, msg, excludeSocket)
 * Broadcast a Notify event to all sockets in a room EXCEPT the sender.
 *
 * Evidence: L114240-114261
 *   listenNotify callback receives: {ret:'SUCCESS', data:...}
 *   L114242: if ('SUCCESS' == e.ret)
 *   L114244: e.compress && (t = LZString.decompressFromUTF16(t))
 *   L114245: var n = JSON.parse(t), o = ChatDataBaseClass.getData(n._msg)
 *
 * Notify envelope:
 *   {
 *     ret: 'SUCCESS',
 *     data: JSON.stringify({ _msg: messageObject }),
 *     compress: false
 *   }
 *
 * The _msg object must match ChatDataBaseClass.getData format (L92098-92110):
 *   _id, _type, _time, _kind, _name, _content, _image, _param,
 *   _headEffect, _headBox, _oriServerId, _serverId, _showMain
 */
ChatServer.emitNotifyToRoom = function (roomId, msg, excludeSocket) {
    var room = ChatServer._rooms[roomId] || [];
    var log = ChatServer.log;

    if (room.length === 0) {
        log.debug('NOTIFY', 'No sockets in room: ' + roomId);
        return;
    }

    var notifyEnvelope = {
        ret: 'SUCCESS',
        data: JSON.stringify({ _msg: msg }),
        compress: false
    };

    var sentCount = 0;

    for (var i = 0; i < room.length; i++) {
        var targetSocket = room[i];

        // Don't send back to sender (client already has local data via sendMsg callback)
        if (excludeSocket && targetSocket.id === excludeSocket.id) continue;

        // Only send to connected sockets
        if (!targetSocket.connected) continue;

        try {
            targetSocket._fire('Notify', notifyEnvelope);
            sentCount++;
        } catch (fireErr) {
            log.error('NOTIFY', 'Failed to send Notify to ' + targetSocket.id, fireErr);
        }
    }

    log.debug('NOTIFY', 'Broadcast complete');
    log.details('notify', [
        ['roomId', roomId],
        ['roomSize', String(room.length)],
        ['sentTo', String(sentCount)],
        ['excluded', excludeSocket ? excludeSocket.id : '(none)']
    ]);
};

window.ChatServer = ChatServer;
