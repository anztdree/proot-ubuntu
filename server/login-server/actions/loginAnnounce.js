/**
 * actions/loginAnnounce.js — Handle LoginAnnounce action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L138128-138148 (getNotice)
 *   Client reads: t.data[i].text[lang], t.data[i].title[lang],
 *     t.data[i].version, t.data[i].orderNo, t.data[i].alwaysPopup
 *
 * Response: { data: Array of notice objects }
 *
 * Data source: IndexedDB (last_game_server / loginInfo → __config__.notices)
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: LoginAnnounce
    // ═══════════════════════════════════════════════════════════════════

    function handleLoginAnnounce(request, callback) {
        log.info('ACTION', '═══════════════ LoginAnnounce ══════════════');

        log.info('REQ', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated)';
            log.detail(k, v);
        }

        log.details([
            ['source', 'IndexedDB (__config__.notices)']
        ]);

        db.get('__config__').then(function (config) {
            var notices = (config && config.notices) ? config.notices : [];
            var noticeCount = notices.length;

            log.info('ACTION', 'LoginAnnounce → SUCCESS');
            log.details([
                ['noticeCount', String(noticeCount)]
            ]);

            // Log DETAIL setiap notice
            for (var n = 0; n < noticeCount; n++) {
                var notice = notices[n];
                log.details([
                    ['notice[' + n + '].title', JSON.stringify(notice.title)],
                    ['notice[' + n + '].text', JSON.stringify(notice.text || '').substring(0, 100)],
                    ['notice[' + n + '].version', String(notice.version)],
                    ['notice[' + n + '].orderNo', String(notice.orderNo)],
                    ['notice[' + n + '].alwaysPopup', String(notice.alwaysPopup)]
                ]);
            }

            log.info('RESP', 'Sending response to client');
            callback({ data: notices });
        }).catch(function (e) {
            log.error('STORAGE', 'IndexedDB error in LoginAnnounce');
            log.alwaysDetails([
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)]
            ]);

            log.warn('ACTION', 'LoginAnnounce → DB error, returning empty');
            callback({ data: [] });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    LoginServer.handlers['LoginAnnounce'] = handleLoginAnnounce;
    if (LoginServer._handlerNames.indexOf('LoginAnnounce') === -1) {
        LoginServer._handlerNames.push('LoginAnnounce');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
