/**
 * actions/getRecord.js — Handle getRecord action
 * Super Warrior Z — CHAT SERVER
 *
 * Evidence: L114612-114621 pattern
 *   Payload: {type:'chat', action:'getRecord', userId, roomId, startTime, version}
 *   Response: {_record: [...]} — array of message objects
 *
 * Used by client to load older messages when scrolling chat history.
 * startTime = 0 → return all recent messages
 * startTime > 0 → return messages with _time >= startTime
 *
 * Data source: IndexedDB (chatData / chatData)
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;
    var db = ChatServer.db;

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: getRecord
    // ═══════════════════════════════════════════════════════════════════

    function handleGetRecord(request, callback) {
        log.info('ACTION', 'getRecord ══════════════');

        var roomId    = request.roomId || '';
        var startTime = request.startTime || 0;
        var userId    = request.userId || '';

        log.details([
            ['userId', userId || '-'],
            ['roomId', roomId],
            ['startTime', String(startTime)]
        ]);

        if (!roomId) {
            log.error('ACTION', 'getRecord — missing roomId');
            callback({ _record: [] });
            return;
        }

        // Query messages dari IndexedDB by roomId
        db.getAllByIndex('chatData', 'roomId', roomId).then(function (allMsgs) {
            var record;

            if (startTime > 0) {
                // Filter messages with _time >= startTime
                record = [];
                for (var i = 0; i < allMsgs.length; i++) {
                    if (allMsgs[i]._time >= startTime) {
                        record.push(allMsgs[i]);
                    }
                }
            } else {
                record = allMsgs;
            }

            log.info('RESP', 'getRecord → ' + record.length + ' messages');
            log.details([
                ['roomId', roomId],
                ['startTime', String(startTime)],
                ['totalInDB', String(allMsgs.length)],
                ['returned', String(record.length)]
            ]);

            callback({ _record: record });
        }).catch(function (e) {
            log.error('DB', 'getRecord → IndexedDB FAILED');
            log.alwaysDetails([
                ['roomId', roomId],
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)],
                ['fallback', '_record: []']
            ]);
            callback({ _record: [] });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    ChatServer.handlers['getRecord'] = handleGetRecord;
    if (ChatServer._handlerNames.indexOf('getRecord') === -1) {
        ChatServer._handlerNames.push('getRecord');
    }
    ChatServer._handlerCount = ChatServer._handlerNames.length;

    window.ChatServer = ChatServer;
})();
