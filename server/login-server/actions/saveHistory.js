/**
 * actions/saveHistory.js — Handle SaveHistory action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L137904-137925 (startBtnTap)
 *   request = {
 *     type: 'User', action: 'SaveHistory',
 *     accountToken: ts.loginInfo.userInfo.userId,
 *     channelCode: ts.loginInfo.userInfo.channelCode,
 *     serverId: ts.loginInfo.serverItem.serverId,
 *     securityCode: ts.loginInfo.userInfo.securityCode,
 *     subChannel: getAppId() || '',
 *     version: '1.0'
 *   }
 *
 * Response: { loginToken, todayLoginCount }
 *
 * Token permanen: 1 user = 1 token, generated ONCE, reused FOREVER.
 * Data source: IndexedDB (login-server / loginInfo)
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

    function getTodayStr() {
        var d = new Date();
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: SaveHistory
    // ═══════════════════════════════════════════════════════════════════

    function handleSaveHistory(request, callback) {
        log.info('ACTION', '═══════════════ SaveHistory ══════════════');

        log.info('request', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated)';
            log.detail(k, v);
        }

        var userId = request.accountToken || '';
        var channelCode = request.channelCode || 'ppgame';
        var serverId = request.serverId || '';
        var securityCode = request.securityCode || '';

        log.details([
            ['parsedUserId', userId],
            ['parsedChannelCode', channelCode],
            ['parsedServerId', serverId],
            ['parsedSecurityCode', securityCode.length > 32 ? securityCode.substring(0, 32) + '...' : securityCode],
            ['source', 'IndexedDB (login-server/loginInfo)'],
            ['tokenPolicy', '1 user = 1 permanent token']
        ]);

        db.get(userId).then(function (acc) {
            var now = LoginServer.nowSeconds();
            var today = getTodayStr();

            if (!acc) {
                // User belum ada (langka — seharusnya sudah dari loginGame)
                acc = {
                    userId: userId,
                    password: '',
                    channelCode: channelCode,
                    nickName: '',
                    securityCode: securityCode,
                    loginToken: LoginServer.generateToken(),
                    createTime: now,
                    lastLoginTime: now,
                    todayLoginCount: 1,
                    loginDate: today,
                    language: 'en',
                    history: [serverId]
                };
                log.info('STORAGE', 'User not found — creating record with token');
            } else {
                // Token permanen: generate sekali jika belum ada
                if (!acc.loginToken) {
                    acc.loginToken = LoginServer.generateToken();
                    log.info('TOKEN', 'Generated permanent token for existing user');
                }

                // todayLoginCount: reset jika hari berganti
                if (acc.loginDate !== today) {
                    acc.todayLoginCount = 1;
                    acc.loginDate = today;
                } else {
                    acc.todayLoginCount = (acc.todayLoginCount || 0) + 1;
                }

                acc.lastLoginTime = now;

                // Update history: tambah serverId ke depan, dedup
                if (serverId) {
                    acc.history = acc.history || [];
                    var idx = acc.history.indexOf(serverId);
                    if (idx !== -1) acc.history.splice(idx, 1);
                    acc.history.unshift(serverId);
                    if (acc.history.length > 10) acc.history = acc.history.slice(0, 10);
                }
            }

            return db.put(acc).then(function () {
                return acc;
            });
        }).then(function (acc) {
            log.info('ACTION', 'SaveHistory → SUCCESS (permanent token from IndexedDB)');
            log.details([
                ['loginToken', acc.loginToken],
                ['loginTokenLength', String(acc.loginToken.length) + ' chars'],
                ['todayLoginCount', String(acc.todayLoginCount)],
                ['tokenPersistence', 'PERMANENT (same token every time for this user)']
            ]);

            log.info('response', 'Sending response to client');

            callback({
                loginToken: acc.loginToken,
                todayLoginCount: acc.todayLoginCount
            });
        }).catch(function (e) {
            log.error('STORAGE', 'IndexedDB error in SaveHistory');
            log.alwaysDetails([
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)]
            ]);

            var fallbackToken = LoginServer.generateToken();
            log.warn('ACTION', 'SaveHistory → DB error, using FALLBACK');
            callback({
                loginToken: fallbackToken,
                todayLoginCount: 1
            });
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
