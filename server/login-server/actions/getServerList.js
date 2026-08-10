/**
 * actions/getServerList.js — Handle GetServerList action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L114402-114410
 *   clientRequestServerList(userId, channel, callback)
 *   request = {
 *     type: 'User',
 *     action: 'GetServerList',
 *     userId: e,          ← userId dari login
 *     subChannel: o,      ← getAppId() || ''
 *     channel: t           ← channelCode dari login
 *   }
 *
 * Response fields yang client BACA:
 *   serverList: Array of {
 *     serverId, name, url, online, hot, new
 *   }
 *   history: Array of serverId strings (distinct, ordered by lastLoginAt DESC)
 *   offlineReason: string
 *
 * Evidence: main.min.js L138094-138003 (selectNewServer)
 *   a = t.history.length > 0 ? t.history[0] : t.serverList[0].serverId
 *   → history[] = serverId strings, bukan objects!
 *
 * Evidence: main.min.js L138056-138058 (filterByWhiteList / changeServerInfo)
 *   e.serverList[i].offlineReason = e.offlineReason
 *   e.serverList[i].new && (e.serverList[i].new = false, e.serverList[i].hot = true)
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
    // HANDLER: GetServerList
    // ═══════════════════════════════════════════════════════════════════

    function handleGetServerList(request, callback) {
        log.info('ACTION', '═══════════════ GetServerList ══════════════');

        log.info('REQ', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated, total ' + String(request[k]).length + ' chars)';
            log.detail(k, v);
        }

        var userId = request.userId || '';

        log.details([
            ['parsedUserId', userId],
            ['subChannel', request.subChannel || '(empty)'],
            ['channel', request.channel || '(empty)']
        ]);

        apiCall('getServerList', {
            userId: userId
        }, function (resp) {
            var serverCount = resp.serverList ? resp.serverList.length : 0;
            var histLen = resp.history ? resp.history.length : 0;

            log.info('ACTION', 'GetServerList → SUCCESS (from DB)');
            log.details([
                ['serverCount', String(serverCount)],
                ['historyLength', String(histLen)],
                ['offlineReason', resp.offlineReason || '(empty)']
            ]);

            // Log DETAIL setiap server
            if (resp.serverList && resp.serverList.length > 0) {
                log.info('RESP', 'Server list detail');
                for (var s = 0; s < resp.serverList.length; s++) {
                    var srv = resp.serverList[s];
                    log.details([
                        ['server[' + s + '].serverId', srv.serverId],
                        ['server[' + s + '].name', srv.name],
                        ['server[' + s + '].url', srv.url],
                        ['server[' + s + '].online', String(srv.online)],
                        ['server[' + s + '].hot', String(srv.hot)],
                        ['server[' + s + '].new', String(srv.new)]
                    ]);
                }
            } else {
                log.warn('RESP', 'serverList is EMPTY — no servers in database!');
            }

            // Log DETAIL history
            if (histLen > 0) {
                log.info('RESP', 'History detail (' + histLen + ' entries)');
                for (var h = 0; h < resp.history.length; h++) {
                    log.detail('history[' + h + ']', String(resp.history[h]));
                }
            } else {
                log.debug('RESP', 'history is EMPTY — no previous login');
            }

            log.info('RESP', 'Sending response to client');
            log.details([
                ['serverList', 'Array(' + serverCount + ')'],
                ['history', 'Array(' + histLen + ')'],
                ['offlineReason', resp.offlineReason || '(empty)']
            ]);

            callback(resp);
        }, function (err) {
            log.warn('ACTION', 'GetServerList → API failed, using FALLBACK');
            log.alwaysDetails([
                ['reason', err.error || 'unknown'],
                ['fallback', 'Return hardcoded local server']
            ]);

            // Fallback: 1 local server
            var fallbackData = {
                serverList: [
                    {
                        serverId: '1',
                        name: 'Local 1',
                        url: LoginServer.config.mainServerUrl,
                        online: true,
                        hot: false,
                        new: true
                    }
                ],
                history: [],
                offlineReason: ''
            };

            log.info('RESP', 'Sending FALLBACK response to client');
            log.details([
                ['serverCount', '1 (hardcoded)'],
                ['historyLength', '0 (empty)'],
                ['fallbackServerId', '1'],
                ['fallbackServerName', 'Local 1'],
                ['fallbackServerUrl', LoginServer.config.mainServerUrl],
                ['source', 'FALLBACK (api error)']
            ]);

            callback(fallbackData);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════════

    LoginServer.handlers['GetServerList'] = handleGetServerList;
    if (LoginServer._handlerNames.indexOf('GetServerList') === -1) {
        LoginServer._handlerNames.push('GetServerList');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
