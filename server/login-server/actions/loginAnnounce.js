/**
 * actions/loginAnnounce.js — Handle LoginAnnounce action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L138128-138148 (getNotice)
 *   ts.processHandlerWithLogin(t, true, function(t) {
 *     e.notice = {};
 *     var n = ToolCommon.getLanguage(), o = false, a = false, r = t.data;
 *     for (var i in r) {
 *       var s = r[i].text[n] || '',    ← text = object {en: "...", cn: "..."}
 *           l = r[i].title[n] || '',   ← title = object {en: "...", cn: "..."}
 *           u = r[i].version,           ← version string
 *           c = r[i].orderNo,           ← order number
 *       r[i].alwaysPopup && (o = true); ← boolean
 *       e.notice[i] = {
 *         bulletin: s,
 *         bulletinVersion: u,
 *         bulletinTitle: l,
 *         order: c
 *       };
 *       a = true;
 *     }
 *     e.noticeBtn.visible = e.noticeBtn.includeInLayout = a;
 *     o && e.noticeBtnTap();
 *   });
 *
 * NOTE: Di minified code, `t` (request object) tidak terdefinisi lokal.
 * Handler ini menggunakan action = 'LoginAnnounce' berdasarkan handler lama.
 *
 * Response: { data: Array of notice objects }
 *   Setiap notice: {
 *     text: { en: "...", cn: "..." },
 *     title: { en: "...", cn: "..." },
 *     version: "1.0",
 *     orderNo: 1,
 *     alwaysPopup: false
 *   }
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
            log.error('API', 'XMLHttpRequest creation FAILED for: ' + action);
            log.alwaysDetails([['errorName', xhrErr.name || '(unknown)'], ['errorMessage', xhrErr.message || String(xhrErr)]]);
            if (typeof onError === 'function') onError({ error: 'XHR creation failed' });
            return;
        }
        try { xhr.open('POST', url, true); xhr.setRequestHeader('Content-Type', 'application/json'); xhr.timeout = LoginServer.config.apiTimeout; } catch (openErr) {
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
                    if (resp.error) { log.error('API', 'API returned business error'); log.alwaysDetails([['action', action], ['apiError', String(resp.error)], ['duration', duration + 'ms']]); if (typeof onError === 'function') onError(resp); return; }
                    log.info('API', 'API success — ' + action);
                    log.details([['httpStatus', xhr.status + ' OK'], ['duration', duration + 'ms'], ['respSize', xhr.responseText.length + ' chars']]);
                    var respKeys = Object.keys(resp || {}); if (respKeys.length > 0) { var rd = []; for (var r = 0; r < respKeys.length; r++) { var rk = respKeys[r]; var rv = JSON.stringify(resp[rk]); if (rv.length > 80) rv = rv.substring(0, 80) + '...'; rd.push([rk, rv]); } log.details(rd); }
                    if (typeof onSuccess === 'function') onSuccess(resp);
                } catch (parseErr) { log.error('API', 'JSON parse FAILED'); log.alwaysDetails([['rawResponse', (xhr.responseText || '').substring(0, 300)], ['duration', duration + 'ms']]); if (typeof onError === 'function') onError({ error: parseErr.message }); }
            } else { log.error('API', 'HTTP error'); log.alwaysDetails([['httpStatus', xhr.status], ['responseBody', (xhr.responseText || '').substring(0, 300)], ['duration', duration + 'ms']]); if (typeof onError === 'function') onError({ error: 'HTTP ' + xhr.status }); }
        };
        xhr.onerror = function () { var duration = Date.now() - startTime; log.error('API', 'NETWORK ERROR'); log.alwaysDetails([['action', action], ['url', url], ['elapsed', duration + 'ms']]); if (typeof onError === 'function') onError({ error: 'Network error' }); };
        xhr.ontimeout = function () { log.error('API', 'TIMEOUT: ' + action); log.alwaysDetails([['timeout', LoginServer.config.apiTimeout + 'ms']]); if (typeof onError === 'function') onError({ error: 'Timeout' }); };
        try { xhr.send(payload); } catch (sendErr) { log.error('API', 'xhr.send() FAILED'); log.alwaysDetails([['errorName', sendErr.name], ['errorMessage', sendErr.message]]); if (typeof onError === 'function') onError({ error: 'xhr.send failed' }); }
    }

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
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated, total ' + String(request[k]).length + ' chars)';
            log.detail(k, v);
        }

        apiCall('getNotice', {}, function (resp) {
            var noticeCount = resp.data ? resp.data.length : 0;

            log.info('ACTION', 'LoginAnnounce → SUCCESS');
            log.details([
                ['noticeCount', String(noticeCount)]
            ]);

            // Log DETAIL setiap notice
            if (noticeCount > 0) {
                log.info('RESP', 'Notice detail');
                for (var n = 0; n < resp.data.length; n++) {
                    var notice = resp.data[n];
                    log.details([
                        ['notice[' + n + '].title', JSON.stringify(notice.title)],
                        ['notice[' + n + '].text', JSON.stringify(notice.text || '').substring(0, 100) + (JSON.stringify(notice.text || '').length > 100 ? '...' : '')],
                        ['notice[' + n + '].version', String(notice.version)],
                        ['notice[' + n + '].orderNo', String(notice.orderNo)],
                        ['notice[' + n + '].alwaysPopup', String(notice.alwaysPopup)]
                    ]);
                }
            } else {
                log.debug('RESP', 'No notices returned');
            }

            log.info('RESP', 'Sending response to client');
            log.details([
                ['data', 'Array(' + noticeCount + ')'],
                ['noticeCount', String(noticeCount)]
            ]);

            callback(resp);
        }, function (err) {
            log.warn('ACTION', 'LoginAnnounce → API failed, using FALLBACK');
            log.alwaysDetails([
                ['reason', err.error || 'unknown'],
                ['fallback', 'Return empty notice array']
            ]);

            log.info('RESP', 'Sending FALLBACK response to client');
            log.details([
                ['data', 'Array(0)'],
                ['source', 'FALLBACK (api error: ' + (err.error || 'unknown') + ')']
            ]);

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
