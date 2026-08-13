/**
 * actions/saveLanguage.js — Handle SaveLanguage action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L114279-114296 (saveLanguage)
 *   request = { type:'User', action:'SaveLanguage', userid, sdk, appid, language }
 *
 *   Success: 0 === t.errorCode → close LanguageList, apply language
 *   Error: close LanguageList anyway, apply language
 *
 * Response: { errorCode: 0 }
 *
 * Data source: IndexedDB (last_game_server / loginInfo)
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: SaveLanguage
    // ═══════════════════════════════════════════════════════════════════

    function handleSaveLanguage(request, callback) {
        log.info('ACTION', '═══════════════ SaveLanguage ══════════════');

        log.info('REQ', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated)';
            log.detail(k, v);
        }

        var userId = request.userid || '';
        var language = request.language || 'en';

        log.details([
            ['parsedUserId', userId || '(empty)'],
            ['parsedLanguage', language],
            ['source', 'IndexedDB (last_game_server/loginInfo)']
        ]);

        db.get(userId).then(function (acc) {
            if (acc) {
                acc.language = language;
                return db.put(acc);
            }
            return acc;
        }).then(function () {
            log.info('ACTION', 'SaveLanguage → SUCCESS');
            log.details([
                ['savedLanguage', language],
                ['note', 'client will close LanguageList and apply language change']
            ]);

            log.info('RESP', 'Sending response to client');
            callback({ errorCode: 0 });
        }).catch(function (e) {
            log.error('STORAGE', 'IndexedDB error in SaveLanguage');
            log.alwaysDetails([
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)],
                ['fallback', 'Return errorCode:0 anyway (language non-critical)']
            ]);

            // Non-critical — always succeed
            callback({ errorCode: 0 });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    LoginServer.handlers['SaveLanguage'] = handleSaveLanguage;
    if (LoginServer._handlerNames.indexOf('SaveLanguage') === -1) {
        LoginServer._handlerNames.push('SaveLanguage');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
