/**
 * actions/saveHistory.js — Handle SaveHistory action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L137904-137925 (startBtnTap)
 *   request = {
 *     type: 'User',
 *     action: 'SaveHistory',
 *     accountToken: ts.loginInfo.userInfo.userId,
 *     channelCode: ts.loginInfo.userInfo.channelCode,
 *     serverId: ts.loginInfo.serverItem.serverId,
 *     securityCode: ts.loginInfo.userInfo.securityCode,
 *     subChannel: getAppId() || '',
 *     version: '1.0'
 *   }
 *
 * Response fields yang client BACA (L137913-137919):
 *   e.loginToken      → ts.loginInfo.userInfo.loginToken = e.loginToken
 *   e.todayLoginCount → cek: 4 === t → ReportToSdk, 6 === t → ReportToSdk
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TOKEN PERMANEN — SOURCE OF TRUTH: DATABASE
 * ═══════════════════════════════════════════════════════════════════════
 *   Setiap user mendapat 1 token PERMANEN di login_users.loginToken
 *   Token di-generate SEKALI saat pertama kali, lalu di-reuse SELAMANYA.
 *   Tidak ada localStorage. Tidak ada token sementara. Tidak ada regenerasi.
 *
 *   api.php?action=saveHistory:
 *     1. Cek login_users.loginToken untuk userId ini
 *     2. Kalau sudah ada → REUSE (token permanen, sama persis setiap kali)
 *     3. Kalau belum ada → GENERATE baru, simpan ke login_users.loginToken
 *     4. Upsert login_history + return token + todayLoginCount
 *
 *   api.php?action=getToken (endpoint validasi):
 *     GET permanent token by userId — untuk main-server, dll
 *
 * Evidence: main.min.js L137914
 *   e && e.loginToken && (ts.loginInfo.userInfo.loginToken = e.loginToken)
 *
 * Evidence: main.min.js L114424-114425 (clientEnterGame)
 *   loginToken: t   → t = ts.loginInfo.userInfo.loginToken (dari SaveHistory response)
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;

    function apiCall(action, data, onSuccess, onError) {
        var url = LoginServer.config.apiBase + '?action=' + action;
        var startTime = Date.now();

        log.info('API', 'POST → ' + action);
        log.details([
            ['url', url],
            ['method', 'POST'],
            ['contentType', 'application/json'],
            ['timeout', LoginServer.config.apiTimeout + 'ms']
        ]);

        var payloadKeys = Object.keys(data || {});
        if (payloadKeys.length > 0) {
            var payloadDetails = [];
            for (var i = 0; i < payloadKeys.length; i++) {
                var pk = payloadKeys[i];
                var pv = String(data[pk]);
                if (pv.length > 80) pv = pv.substring(0, 80) + '... (truncated, total ' + String(data[pk]).length + ' chars)';
                payloadDetails.push([pk, pv]);
            }
            log.details(payloadDetails);
        }

        var payload = JSON.stringify(data || {});
        log.detail('payloadSize', payload.length + ' chars');

        try { var xhr = new XMLHttpRequest(); } catch (xhrErr) {
            log.error('API', 'XMLHttpRequest creation FAILED for: ' + action);
            log.alwaysDetails([['errorName', xhrErr.name || '(unknown)'], ['errorMessage', xhrErr.message || String(xhrErr)]]);
            if (typeof onError === 'function') onError({ error: 'XHR creation failed' });
            return;
        }
        try {
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = LoginServer.config.apiTimeout;
        } catch (openErr) {
            log.error('API', 'xhr.open() FAILED for: ' + action);
            log.alwaysDetails([['errorName', openErr.name || '(unknown)'], ['errorMessage', openErr.message || String(openErr)]]);
            if (typeof onError === 'function') onError({ error: 'xhr.open failed' });
            return;
        }

        xhr.onload = function () {
            var duration = Date.now() - startTime;
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var resp = JSON.parse(xhr.responseText);
                    if (resp.error) {
                        log.error('API', 'API returned business error');
                        log.alwaysDetails([['action', action], ['apiError', String(resp.error)], ['httpStatus', xhr.status], ['duration', duration + 'ms']]);
                        if (typeof onError === 'function') onError(resp);
                        return;
                    }
                    log.info('API', 'API success — ' + action);
                    log.details([['httpStatus', xhr.status + ' OK'], ['duration', duration + 'ms'], ['respSize', xhr.responseText.length + ' chars']]);
                    var respKeys = Object.keys(resp || {});
                    if (respKeys.length > 0) {
                        var respDetails = [];
                        for (var r = 0; r < respKeys.length; r++) { var rk = respKeys[r]; var rv = JSON.stringify(resp[rk]); if (rv.length > 80) rv = rv.substring(0, 80) + '...'; respDetails.push([rk, rv]); }
                        log.details(respDetails);
                    }
                    if (typeof onSuccess === 'function') onSuccess(resp);
                } catch (parseErr) {
                    log.error('API', 'JSON parse FAILED for: ' + action);
                    log.alwaysDetails([['errorName', parseErr.name || '(unknown)'], ['errorMessage', parseErr.message || String(parseErr)], ['rawResponse', (xhr.responseText || '').substring(0, 300)], ['duration', duration + 'ms']]);
                    if (typeof onError === 'function') onError({ error: parseErr.message });
                }
            } else {
                log.error('API', 'HTTP error response');
                log.alwaysDetails([['action', action], ['httpStatus', xhr.status + ' ' + xhr.statusText], ['responseBody', (xhr.responseText || '').substring(0, 300)], ['duration', duration + 'ms']]);
                if (typeof onError === 'function') onError({ error: 'HTTP ' + xhr.status });
            }
        };
        xhr.onerror = function () {
            var duration = Date.now() - startTime;
            log.error('API', 'NETWORK ERROR — api.php UNREACHABLE');
            log.alwaysDetails([['action', action], ['url', url], ['elapsed', duration + 'ms (no response)'], ['hint', 'Is KSWEB running?'], ['hint2', 'Check nginx port 8080']]);
            if (typeof onError === 'function') onError({ error: 'Network error' });
        };
        xhr.ontimeout = function () {
            log.error('API', 'Request TIMEOUT: ' + action);
            log.alwaysDetails([['action', action], ['timeout', LoginServer.config.apiTimeout + 'ms'], ['url', url]]);
            if (typeof onError === 'function') onError({ error: 'Timeout' });
        };
        try { xhr.send(payload); } catch (sendErr) {
            log.error('API', 'xhr.send() FAILED for: ' + action);
            log.alwaysDetails([['errorName', sendErr.name || '(unknown)'], ['errorMessage', sendErr.message || String(sendErr)]]);
            if (typeof onError === 'function') onError({ error: 'xhr.send failed' });
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: SaveHistory
    // ═══════════════════════════════════════════════════════════════════

    function handleSaveHistory(request, callback) {
        log.info('ACTION', '═══════════════ SaveHistory ══════════════');

        log.info('REQ', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated, total ' + String(request[k]).length + ' chars)';
            log.detail(k, v);
        }

        var userId = request.accountToken || '';
        var channelCode = request.channelCode || 'ppgame';
        var serverId = request.serverId || '';
        var securityCode = request.securityCode || '';
        var subChannel = request.subChannel || '';
        var version = request.version || '1.0';

        log.details([
            ['parsedUserId', userId],
            ['parsedChannelCode', channelCode],
            ['parsedServerId', serverId],
            ['parsedSecurityCode', securityCode.length > 32 ? securityCode.substring(0, 32) + '...' : securityCode],
            ['parsedSubChannel', subChannel || '(empty)'],
            ['parsedVersion', version]
        ]);

        // ═══════════════════════════════════════════════════════════════
        // Token permanen — dari DATABASE, bukan localStorage
        // ═══════════════════════════════════════════════════════════════

        log.info('TOKEN', 'Requesting PERMANENT token from database');
        log.details([
            ['tokenPolicy', '1 user = 1 permanent token'],
            ['tokenSource', 'login_users.loginToken (MySQL)'],
            ['tokenLifecycle', 'Generated ONCE, reused FOREVER'],
            ['noLocalStorage', 'true — token TIDAK disimpan ke localStorage']
        ]);

        apiCall('saveHistory', {
            accountToken: userId,
            channelCode: channelCode,
            serverId: serverId,
            securityCode: securityCode,
            subChannel: subChannel,
            version: version
        }, function (resp) {
            var token = resp.loginToken || '';
            var todayCount = resp.todayLoginCount || 1;

            log.info('ACTION', 'SaveHistory → SUCCESS (PERMANENT token from DB)');
            log.details([
                ['loginToken', token],
                ['loginTokenFull', token],
                ['loginTokenLength', String(token.length) + ' chars'],
                ['todayLoginCount', String(todayCount)],
                ['tokenStorage', 'DATABASE — login_users.loginToken'],
                ['tokenPersistence', 'PERMANENT (same token every time for this user)']
            ]);

            log.info('RESP', 'Sending response to client');
            log.details([
                ['loginToken', token],
                ['loginTokenLength', String(token.length) + ' chars'],
                ['todayLoginCount', String(todayCount)],
                ['note', 'Client will store to ts.loginInfo.userInfo.loginToken']
            ]);

            callback(resp);
        }, function (err) {
            log.warn('ACTION', 'SaveHistory → DB error, using FALLBACK');
            log.alwaysDetails([
                ['reason', err.error || 'unknown'],
                ['fallback', 'Generate client-side token (NOT saved to DB)']
            ]);

            var fallbackToken = LoginServer.generateToken();

            log.info('FALLBACK', 'Generating client-side loginToken');
            log.details([
                ['generateMethod', 'LoginServer.generateToken()'],
                ['tokenLength', LoginServer.config.loginTokenLength + ' chars'],
                ['charset', 'abcdef0123456789'],
                ['generatedToken', fallbackToken],
                ['generatedTokenFull', fallbackToken],
                ['warning', 'Fallback token NOT saved to DB — permanence LOST'],
                ['warning2', 'Token akan beda dari DB token saat api.php kembali normal'],
                ['noLocalStorage', 'true — fallback token juga TIDAK ke localStorage']
            ]);

            var fallbackResp = {
                loginToken: fallbackToken,
                todayLoginCount: 1
            };

            log.info('RESP', 'Sending FALLBACK response to client');
            log.details([
                ['loginToken', fallbackToken],
                ['loginTokenLength', String(fallbackToken.length) + ' chars'],
                ['todayLoginCount', '1'],
                ['source', 'FALLBACK (client-side, api.php error: ' + (err.error || 'unknown') + ')']
            ]);

            callback(fallbackResp);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    LoginServer.handlers['SaveHistory'] = handleSaveHistory;
    if (LoginServer._handlerNames.indexOf('SaveHistory') === -1) {
        LoginServer._handlerNames.push('SaveHistory');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
