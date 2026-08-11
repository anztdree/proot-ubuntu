/**
 * actions/loginAnnounce.js — Handle LoginAnnounce action
 * Super Warrior Z — LOGIN SERVER (100% IndexedDB)
 *
 * Evidence: main.min.js L138128-138148 (getNotice)
 *   Response: { data: Array of notice objects }
 *   Setiap notice: { text, title, version, orderNo, alwaysPopup }
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

    function handleLoginAnnounce(request, callback) {
        log.info('ACTION', '═══════════════ LoginAnnounce ══════════════');

        db.getAll('notices').then(function (allNotices) {
            // Filter active only, sort by orderNo
            var active = [];
            for (var i = 0; i < allNotices.length; i++) {
                if (allNotices[i].active) {
                    active.push({
                        text: allNotices[i].content || {},
                        title: allNotices[i].title || {},
                        version: allNotices[i].version || '1.0',
                        orderNo: allNotices[i].orderNo || 0,
                        alwaysPopup: !!allNotices[i].alwaysPopup
                    });
                }
            }
            active.sort(function (a, b) { return (a.orderNo || 0) - (b.orderNo || 0); });

            log.info('RESP', 'Sending response to client');
            log.details([
                ['data', 'Array(' + active.length + ')'],
                ['activeTotal', String(active.length)],
                ['totalInDB', String(allNotices.length)]
            ]);

            callback({ data: active });
        }).catch(function (err) {
            log.warn('ACTION', 'LoginAnnounce → DB error, FALLBACK empty');
            log.alwaysDetails([['reason', err.message || 'unknown']]);
            callback({ data: [] });
        });
    }

    LoginServer.handlers['LoginAnnounce'] = handleLoginAnnounce;
    if (LoginServer._handlerNames.indexOf('LoginAnnounce') === -1) {
        LoginServer._handlerNames.push('LoginAnnounce');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
