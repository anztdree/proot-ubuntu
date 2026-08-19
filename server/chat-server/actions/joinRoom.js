/**
 * actions/joinRoom.js — Handle joinRoom action
 * Super Warrior Z — CHAT SERVER
 *
 * Evidence: L114612-114621
 *   chatJoinRequest → processHandlerWithChat({type:'chat', action:'joinRoom',
 *     userId, roomId, version:'1.0'}, cb)
 *   cb(e) → chatJoinRecord(e) → iterates e._record with for-in
 *
 * L114632-114640: chatJoinRecord iterates _record:
 *   for (var o in t) {
 *       var a = t[o];
 *       ts.chatData[a._kind] || (ts.chatData[a._kind] = []);
 *       var r = ChatDataBaseClass.getData(a);
 *       r && (ts.chatNotifyData(r), n.push(r));
 *   }
 *
 * L114566-114568: worldRoomId join has NO guard → MUST always succeed
 * L114568, L114579, L114590: guild/teamDungeon/team have guards → can fail gracefully
 *
 * Data source: IndexedDB (chat-server: chat)
 *   1. Register socket in in-memory room (for Notify broadcast)
 *   2. Query recent messages from IndexedDB
 *   3. Return {_record: [...]}
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;
    var db = ChatServer.db;
    var MAX_RECORDS = ChatServer.config.maxRecordPerRoom || 50;

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: joinRoom
    // ═══════════════════════════════════════════════════════════════════

    function handleJoinRoom(request, callback) {
        log.info('ACTION', 'joinRoom ══════════════');

        var roomId = request.roomId || '';
        var userId = request.userId || '';
        var socket = ChatServer.currentSocket;

        if (!roomId) {
            log.error('ACTION', 'joinRoom — missing roomId');
            callback({ _record: [] });
            return;
        }

        log.details([
            ['userId', userId || '-'],
            ['roomId', roomId],
            ['socketId', socket ? socket.id : '(none)'],
            ['maxRecords', String(MAX_RECORDS)]
        ]);

        // Register this socket in the room (in-memory, for Notify broadcast)
        if (socket && socket.connected) {
            ChatServer.socketJoinRoom(socket, roomId);
            log.details([
                ['roomAction', 'JOINED'],
                ['roomSize', String(ChatServer.getRoomSize(roomId))]
            ]);
        } else {
            log.warn('ACTION', 'No active socket — room NOT registered for Notify');
        }

        // Query recent messages dari IndexedDB
        // chat: keyPath = auto-increment id, indexed by roomId
        db.getAllByIndex('chat', 'roomId', roomId).then(function (allMsgs) {
            // Take last MAX_RECORDS messages (newest first in storage, reverse for chronological)
            var record = allMsgs.slice(-MAX_RECORDS);

            log.info('RESP', 'joinRoom → ' + record.length + ' messages loaded');
            log.details([
                ['roomId', roomId],
                ['totalInDB', String(allMsgs.length)],
                ['returned', String(record.length)]
            ]);

            // Log first few records for verification
            if (record.length > 0) {
                for (var i = 0; i < Math.min(3, record.length); i++) {
                    var msg = record[i];
                    log.details([
                        ['record[' + i + ']._id', msg._id || '-'],
                        ['record[' + i + ']._kind', String(msg._kind)],
                        ['record[' + i + ']._name', msg._name || '(no name)'],
                        ['record[' + i + ']._content', (msg._content || '').substring(0, 40)],
                        ['record[' + i + ']._time', String(msg._time)]
                    ]);
                }
            }

            callback({ _record: record });
        }).catch(function (e) {
            log.error('DB', 'joinRoom → IndexedDB FAILED, returning empty record');
            log.alwaysDetails([
                ['roomId', roomId],
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)],
                ['fallback', '_record: [] — no chat history loaded']
            ]);
            callback({ _record: [] });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    ChatServer.handlers['joinRoom'] = handleJoinRoom;
    if (ChatServer._handlerNames.indexOf('joinRoom') === -1) {
        ChatServer._handlerNames.push('joinRoom');
    }
    ChatServer._handlerCount = ChatServer._handlerNames.length;

    window.ChatServer = ChatServer;
})();
