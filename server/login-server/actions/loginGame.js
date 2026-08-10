/**
 * actions/loginGame.js — Handle loginGame action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L114369-114385
 *   clientLoginUser(username, password, fromChannel, callback)
 *   request = {
 *     type: 'User',
 *     action: 'loginGame',
 *     userId: username,
 *     password: password,
 *     fromChannel: fromChannel,
 *     channelName: '',
 *     headImageUrl: '',
 *     nickName: '',
 *     subChannel: getAppId() || '',
 *     version: '1.0'
 *   }
 *
 *   Response: client reads callback result via processHandlerWithLogin → JSON.parse(e.data)
 *   Fields yang client baca dari response:
 *     L138076-138082 (sdkLoginSuccess pattern — same fields expected):
 *       userId, channelCode, nickName, securityCode
 *     L137907-137910 (SaveHistory uses):
 *       ts.loginInfo.userInfo.securityCode → from loginGame response
 *
 *   loginToken: NOT from loginGame — comes from SaveHistory (L137914)
 *
 *   Dipanggil saat: origin login (username + password)
 *   TIDAK dipanggil saat: SDK login (getSdkLoginInfo → langsung clientRequestServerList)
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;

    /**
     * apiCall(action, data, onSuccess, onError) — POST ke api.php
     * Shared helper. Setiap action butuh ini untuk komunikasi ke MySQL.
     */
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

        // Log semua field payload
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

        try {
            var xhr = new XMLHttpRequest();
        } catch (xhrErr) {
            log.error('API', 'XMLHttpRequest creation FAILED for: ' + action);
            log.alwaysDetails([
                ['errorName', xhrErr.name || '(unknown)'],
                ['errorMessage', xhrErr.message || String(xhrErr)]
            ]);
            if (typeof onError === 'function') onError({ error: 'XHR creation failed' });
            return;
        }

        try {
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = LoginServer.config.apiTimeout;
        } catch (openErr) {
            log.error('API', 'xhr.open() FAILED for: ' + action);
            log.alwaysDetails([
                ['errorName', openErr.name || '(unknown)'],
                ['errorMessage', openErr.message || String(openErr)]
            ]);
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
                        log.alwaysDetails([
                            ['action', action],
                            ['apiError', String(resp.error)],
                            ['httpStatus', xhr.status + ' ' + xhr.statusText],
                            ['duration', duration + 'ms']
                        ]);
                        if (typeof onError === 'function') onError(resp);
                        return;
                    }

                    log.info('API', 'API success — ' + action);
                    log.details([
                        ['httpStatus', xhr.status + ' OK'],
                        ['duration', duration + 'ms'],
                        ['respSize', xhr.responseText.length + ' chars']
                    ]);

                    // Log semua field response
                    var respKeys = Object.keys(resp || {});
                    if (respKeys.length > 0) {
                        var respDetails = [];
                        for (var r = 0; r < respKeys.length; r++) {
                            var rk = respKeys[r];
                            var rv = JSON.stringify(resp[rk]);
                            if (rv.length > 80) rv = rv.substring(0, 80) + '... (truncated)';
                            respDetails.push([rk, rv]);
                        }
                        log.details(respDetails);
                    }

                    if (typeof onSuccess === 'function') onSuccess(resp);

                } catch (parseErr) {
                    log.error('API', 'JSON parse FAILED for: ' + action);
                    log.alwaysDetails([
                        ['errorName', parseErr.name || '(unknown)'],
                        ['errorMessage', parseErr.message || String(parseErr)],
                        ['rawResponse', (xhr.responseText || '').substring(0, 300)],
                        ['rawLength', (xhr.responseText || '').length + ' chars'],
                        ['duration', duration + 'ms']
                    ]);
                    if (typeof onError === 'function') onError({ error: parseErr.message });
                }
            } else {
                log.error('API', 'HTTP error response');
                log.alwaysDetails([
                    ['action', action],
                    ['httpStatus', xhr.status + ' ' + xhr.statusText],
                    ['responseBody', (xhr.responseText || '').substring(0, 300)],
                    ['responseLength', (xhr.responseText || '').length + ' chars'],
                    ['duration', duration + 'ms']
                ]);
                if (typeof onError === 'function') onError({ error: 'HTTP ' + xhr.status });
            }
        };

        xhr.onerror = function () {
            var duration = Date.now() - startTime;
            log.error('API', 'NETWORK ERROR — api.php UNREACHABLE');
            log.alwaysDetails([
                ['action', action],
                ['url', url],
                ['elapsed', duration + 'ms (no response)'],
                ['hint', 'Is KSWEB running?'],
                ['hint2', 'Check nginx port 8080'],
                ['hint3', 'Check PHP is enabled'],
                ['hint4', 'Check file permissions for api.php']
            ]);
            if (typeof onError === 'function') onError({ error: 'Network error' });
        };

        xhr.ontimeout = function () {
            log.error('API', 'Request TIMEOUT: ' + action);
            log.alwaysDetails([
                ['action', action],
                ['timeout', LoginServer.config.apiTimeout + 'ms'],
                ['url', url],
                ['hint', 'Server may be overloaded or api.php is hanging']
            ]);
            if (typeof onError === 'function') onError({ error: 'Timeout' });
        };

        try {
            xhr.send(payload);
        } catch (sendErr) {
            log.error('API', 'xhr.send() FAILED for: ' + action);
            log.alwaysDetails([
                ['errorName', sendErr.name || '(unknown)'],
                ['errorMessage', sendErr.message || String(sendErr)],
                ['payloadSize', payload.length + ' chars']
            ]);
            if (typeof onError === 'function') onError({ error: 'xhr.send failed' });
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: loginGame
    // ═══════════════════════════════════════════════════════════════════

    function handleLoginGame(request, callback) {
        log.info('ACTION', '═══════════════ loginGame ══════════════');

        // Log SEMUA field request — no truncate
        log.info('REQ', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated, total ' + String(request[k]).length + ' chars)';
            log.detail(k, v);
        }

        var userId = request.userId || '';
        var channelCode = request.fromChannel || 'ppgame';
        var nickName = request.nickName || '';

        log.details([
            ['parsedUserId', userId],
            ['parsedChannelCode', channelCode],
            ['parsedNickName', nickName || '(empty)']
        ]);

        // Simpan user ke MySQL via api.php?action=saveUser
        apiCall('saveUser', {
            userId: userId,
            channelCode: channelCode,
            nickName: nickName
        }, function (resp) {
            // ═══════════════════════════════════════════════════════════════
            // Response fields — evidence:
            //   L138076-138082: ts.loginInfo.userInfo = {
            //     loginToken, userId, nickName, channelCode, securityCode
            //   }
            //   L137907-137910: SaveHistory uses ts.loginInfo.userInfo.securityCode
            //   → loginGame response MUST include securityCode!
            //
            //   Note: loginToken comes from SaveHistory (L137914), NOT from loginGame.
            //   loginGame sets userId, channelCode, nickName, securityCode.
            // ═══════════════════════════════════════════════════════════════
            var securityCode = resp.securityCode || LoginServer.generateToken(32);

            log.info('ACTION', 'loginGame → SUCCESS (saved to DB)');
            log.details([
                ['apiResponse', JSON.stringify(resp)],
                ['userId', userId],
                ['channelCode', channelCode],
                ['securityCode', securityCode],
                ['securityCodeLength', String(securityCode.length) + ' chars'],
                ['evidence', 'L138081: securityCode stored to ts.loginInfo.userInfo.securityCode'],
                ['evidence2', 'L137910: securityCode sent in SaveHistory request']
            ]);

            // Response: client baca userId, channelCode, nickName, securityCode
            var responseData = {
                userId: userId,
                channelCode: channelCode,
                nickName: nickName,
                securityCode: securityCode
            };

            log.info('RESP', 'Sending response to client');
            log.details([
                ['userId', responseData.userId],
                ['channelCode', responseData.channelCode],
                ['nickName', responseData.nickName || '(empty)'],
                ['securityCode', responseData.securityCode],
                ['note', 'Client stores to ts.loginInfo.userInfo (L138076-138082 pattern)']
            ]);

            callback(responseData);
        }, function (err) {
            log.warn('ACTION', 'loginGame → DB error, using FALLBACK');
            log.alwaysDetails([
                ['reason', err.error || 'unknown'],
                ['fallback', 'Generate securityCode client-side, return all fields (non-blocking)'],
                ['userId', userId],
                ['channelCode', channelCode]
            ]);

            // Fallback: generate securityCode locally (NOT saved to DB — permanence LOST)
            var fallbackSecurityCode = LoginServer.generateToken(32);

            // Fallback tetap kembalikan semua field — login tetap bisa lanjut
            var responseData = {
                userId: userId,
                channelCode: channelCode,
                nickName: nickName,
                securityCode: fallbackSecurityCode
            };

            log.info('RESP', 'Sending FALLBACK response to client');
            log.details([
                ['userId', responseData.userId],
                ['channelCode', responseData.channelCode],
                ['nickName', responseData.nickName || '(empty)'],
                ['securityCode', responseData.securityCode],
                ['securityCodeLength', String(fallbackSecurityCode.length) + ' chars'],
                ['source', 'FALLBACK (api error: ' + (err.error || 'unknown') + ')']
            ]);

            callback(responseData);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    LoginServer.handlers['loginGame'] = handleLoginGame;
    if (LoginServer._handlerNames.indexOf('loginGame') === -1) {
        LoginServer._handlerNames.push('loginGame');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
