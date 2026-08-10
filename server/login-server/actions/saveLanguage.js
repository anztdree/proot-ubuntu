/**
 * actions/saveLanguage.js — Handle SaveLanguage action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L114279-114296 (saveLanguage)
 *   Dipanggil saat user ganti bahasa di login screen
 *
 *   request = {
 *     type: 'User',
 *     action: 'SaveLanguage',
 *     userid: ts.loginUserInfo.userId,
 *     sdk: ts.loginUserInfo.sdk,
 *     appid: getAppId() || '',
 *     language: e ← bahasa yang dipilih
 *   }
 *
 *   Success callback (L114289-114290):
 *     0 === t.errorCode → ts.closeWindow('LanguageList'), TSBrowser.executeFunction('changeLanguage', e)
 *   Error callback (L114291-114293):
 *     console.log('failed save language'), ts.closeWindow('LanguageList'), window.changeLanguage(e)
 *
 * Response: { errorCode: 0 }
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;

    function apiCall(action, data, onSuccess, onError) {
        var url = LoginServer.config.apiBase + '?action=' + action;
        var startTime = Date.now();

        log.info('API', 'POST → ' + action);
        log.details([['url', url], ['method', 'POST'], ['contentType', 'application/json'], ['timeout', LoginServer.config.apiTimeout + 'ms']]);

        var payloadKeys = Object.keys(data || {});
        if (payloadKeys.length > 0) {
            var payloadDetails = [];
            for (var i = 0; i < payloadKeys.length; i++) { var pk = payloadKeys[i]; var pv = String(data[pk]); if (pv.length > 80) pv = pv.substring(0, 80) + '...'; payloadDetails.push([pk, pv]); }
            log.details(payloadDetails);
        }

        var payload = JSON.stringify(data || {});
        log.detail('payloadSize', payload.length + ' chars');

        try { var xhr = new XMLHttpRequest(); } catch (xhrErr) {
            log.error('API', 'XMLHttpRequest creation FAILED'); log.alwaysDetails([['errorName', xhrErr.name], ['errorMessage', xhrErr.message]]);
            if (typeof onError === 'function') onError({ error: 'XHR creation failed' }); return;
        }
        try { xhr.open('POST', url, true); xhr.setRequestHeader('Content-Type', 'application/json'); xhr.timeout = LoginServer.config.apiTimeout; } catch (openErr) {
            log.error('API', 'xhr.open() FAILED'); log.alwaysDetails([['errorName', openErr.name], ['errorMessage', openErr.message]]);
            if (typeof onError === 'function') onError({ error: 'xhr.open failed' }); return;
        }

        xhr.onload = function () {
            var duration = Date.now() - startTime;
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var resp = JSON.parse(xhr.responseText);
                    if (resp.error) { log.error('API', 'API business error'); log.alwaysDetails([['action', action], ['apiError', String(resp.error)], ['duration', duration + 'ms']]); if (typeof onError === 'function') onError(resp); return; }
                    log.info('API', 'API success — ' + action);
                    log.details([['httpStatus', xhr.status + ' OK'], ['duration', duration + 'ms'], ['respSize', xhr.responseText.length + ' chars']]);
                    var respKeys = Object.keys(resp || {}); if (respKeys.length > 0) { var rd = []; for (var r = 0; r < respKeys.length; r++) { var rk = respKeys[r]; var rv = JSON.stringify(resp[rk]); if (rv.length > 80) rv = rv.substring(0, 80) + '...'; rd.push([rk, rv]); } log.details(rd); }
                    if (typeof onSuccess === 'function') onSuccess(resp);
                } catch (parseErr) { log.error('API', 'JSON parse FAILED'); log.alwaysDetails([['rawResponse', (xhr.responseText || '').substring(0, 300)], ['duration', duration + 'ms']]); if (typeof onError === 'function') onError({ error: parseErr.message }); }
            } else { log.error('API', 'HTTP error'); log.alwaysDetails([['httpStatus', xhr.status], ['responseBody', (xhr.responseText || '').substring(0, 300)], ['duration', duration + 'ms']]); if (typeof onError === 'function') onError({ error: 'HTTP ' + xhr.status }); }
        };
        xhr.onerror = function () { var d = Date.now() - startTime; log.error('API', 'NETWORK ERROR'); log.alwaysDetails([['action', action], ['url', url], ['elapsed', d + 'ms']]); if (typeof onError === 'function') onError({ error: 'Network error' }); };
        xhr.ontimeout = function () { log.error('API', 'TIMEOUT'); log.alwaysDetails([['timeout', LoginServer.config.apiTimeout + 'ms']]); if (typeof onError === 'function') onError({ error: 'Timeout' }); };
        try { xhr.send(payload); } catch (sendErr) { log.error('API', 'xhr.send() FAILED'); log.alwaysDetails([['errorName', sendErr.name], ['errorMessage', sendErr.message]]); if (typeof onError === 'function') onError({ error: 'xhr.send failed' }); }
    }

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
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated, total ' + String(request[k]).length + ' chars)';
            log.detail(k, v);
        }

        var userId = request.userid || '';
        var sdk = request.sdk || '';
        var appid = request.appid || '';
        var language = request.language || '';

        log.details([
            ['parsedUserId', userId || '(empty)'],
            ['parsedSdk', sdk || '(empty)'],
            ['parsedAppid', appid || '(empty)'],
            ['parsedLanguage', language || '(empty)']
        ]);

        apiCall('saveLanguage', {
            userid: userId,
            sdk: sdk,
            appid: appid,
            language: language
        }, function (resp) {
            log.info('ACTION', 'SaveLanguage → SUCCESS');
            log.details([
                ['apiResponse', JSON.stringify(resp)],
                ['savedLanguage', language]
            ]);

            log.info('RESP', 'Sending response to client');
            log.details([
                ['errorCode', '0'],
                ['language', language],
                ['note', 'client will close LanguageList and apply language change']
            ]);

            callback({ errorCode: 0 });
        }, function (err) {
            log.warn('ACTION', 'SaveLanguage → DB error, SILENT SUCCESS');
            log.alwaysDetails([
                ['reason', err.error || 'unknown'],
                ['language', language],
                ['fallback', 'Return errorCode:0 anyway (client will changeLanguage anyway)']
            ]);

            log.info('RESP', 'Sending SILENT SUCCESS response');
            log.details([
                ['errorCode', '0'],
                ['language', language],
                ['source', 'SILENT FALLBACK (language non-critical)'],
                ['originalError', err.error || 'unknown']
            ]);

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
