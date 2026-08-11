/**
 * actions/saveLanguage.js — Handle SaveLanguage action
 * Super Warrior Z — LOGIN SERVER (100% IndexedDB)
 *
 * Evidence: main.min.js L114279-114296 (saveLanguage)
 *   request = { type:'User', action:'SaveLanguage', userid, sdk, appid, language }
 *   Response: { errorCode: 0 }
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

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
            ['parsedLanguage', language]
        ]);

        db.put('languages', {
            userId: userId,
            language: language,
            updatedAt: LoginServer.nowSeconds()
        }).then(function () {
            log.info('RESP', 'Sending response to client');
            log.details([
                ['errorCode', '0'],
                ['language', language],
                ['storage', 'IndexedDB (languages store)']
            ]);

            callback({ errorCode: 0 });
        }).catch(function () {
            // Non-critical — client akan changeLanguage anyway
            log.warn('ACTION', 'SaveLanguage → DB error, SILENT SUCCESS');
            callback({ errorCode: 0 });
        });
    }

    LoginServer.handlers['SaveLanguage'] = handleSaveLanguage;
    if (LoginServer._handlerNames.indexOf('SaveLanguage') === -1) {
        LoginServer._handlerNames.push('SaveLanguage');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
