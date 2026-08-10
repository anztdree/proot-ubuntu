/**
 * router.js — Chat Server Action Router
 * Super Warrior Z — CHAT SERVER
 *
 * Routes request.action → handler. Hanya menerima type='chat'.
 * NO silent errors.
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;

    var _stats = {
        totalRouted: 0,
        totalUnknown: 0,
        totalNoAction: 0,
        totalWrongType: 0,
        lastAction: null
    };

    function handle(request, callback) {
        var action = request.action || '';
        var type = request.type || '';

        _stats.totalRouted++;
        _stats.lastAction = action;

        log.info('ROUTE', 'Incoming request #' + _stats.totalRouted);
        log.details('request', [
            ['action', action || '(EMPTY)'],
            ['type', type || '(EMPTY)'],
            ['totalSoFar', String(_stats.totalRouted)]
        ]);

        // Validasi type harus 'chat'
        if (type !== 'chat') {
            _stats.totalWrongType++;
            log.error('ROUTE', 'Wrong type — expected "chat"');
            log.importantDetails('error', [
                ['receivedType', type || '(empty)'],
                ['expectedType', 'chat'],
                ['totalWrongType', String(_stats.totalWrongType)]
            ]);
            callback({});
            return;
        }

        if (!action) {
            _stats.totalNoAction++;
            log.error('ROUTE', 'No action field in request!');
            log.importantDetails('error', [
                ['requestKeys', Object.keys(request || {}).join(', ')],
                ['requestDump', JSON.stringify(request || {}).substring(0, 200)],
                ['totalNoAction', String(_stats.totalNoAction)]
            ]);
            callback({});
            return;
        }

        var handler = ChatServer.handlers && ChatServer.handlers[action];

        if (typeof handler === 'function') {
            log.info('ROUTE', 'Dispatching → ' + action);
            try {
                handler(request, callback);
            } catch (handlerErr) {
                log.error('ROUTE', 'Handler "' + action + '" threw UNCAUGHT ERROR', handlerErr);
                callback({});
            }
        } else {
            _stats.totalUnknown++;
            log.error('ROUTE', 'Unknown action: "' + action + '"');
            log.importantDetails('error', [
                ['requested', action],
                ['totalUnknown', String(_stats.totalUnknown)]
            ]);

            var available = ChatServer._handlerNames || [];
            log.importantDetails('important', [
                ['availableHandlers', '[' + available.join(', ') + ']'],
                ['totalHandlers', String(available.length)]
            ]);

            callback({});
        }
    }

    function getStats() {
        return {
            totalRouted: _stats.totalRouted,
            totalUnknown: _stats.totalUnknown,
            totalNoAction: _stats.totalNoAction,
            totalWrongType: _stats.totalWrongType,
            lastAction: _stats.lastAction
        };
    }

    ChatServer.router = { handle: handle, getStats: getStats };
    window.ChatServer = ChatServer;
})();
