/**
 * actions/saveHistory.js — Handle SaveHistory action
 * Super Warrior Z — LOGIN SERVER (100% IndexedDB)
 *
 * Evidence: main.min.js L137904-137925 (startBtnTap)
 *   request = { type:'User', action:'SaveHistory',
 *     accountToken, channelCode, serverId, securityCode, subChannel, version }
 *
 * Response (L137913-137919):
 *   e.loginToken      → ts.loginInfo.userInfo.loginToken
 *   e.todayLoginCount → cek: 4/6 → ReportToSdk
 *
 * TOKEN PERMANEN:
 *   1 user = 1 permanent token di users store.
 *   Generated sekali, reused selamanya.
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

    function handleSaveHistory(request, callback) {
        log.info('ACTION', '═══════════════ SaveHistory ══════════════');

        log.info('REQ', 'Request fields from client');
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
        var now = LoginServer.nowSeconds();
        var today = new Date().toISOString().slice(0, 10);

        log.details([
            ['parsedUserId', userId],
            ['parsedServerId', serverId],
            ['parsedSecurityCode', securityCode.length > 32 ? securityCode.substring(0, 32) + '...' : securityCode]
        ]);

        // Step 1: Get or create permanent token
        db.get('users', userId).then(function (user) {
            var loginToken;

            if (user && user.loginToken) {
                loginToken = user.loginToken;
                log.info('TOKEN', 'Reusing PERMANENT token from DB');
            } else {
                loginToken = LoginServer.generateToken(64);
                log.info('TOKEN', 'Generated NEW permanent token');

                if (user) {
                    user.loginToken = loginToken;
                    if (securityCode && !user.securityCode) user.securityCode = securityCode;
                    user.lastLoginAt = now;
                } else {
                    user = {
                        userId: userId,
                        nickName: userId,
                        channelCode: channelCode,
                        loginToken: loginToken,
                        securityCode: securityCode || LoginServer.generateToken(32),
                        sign: LoginServer.generateToken(32),
                        security: LoginServer.generateToken(32),
                        createdAt: now,
                        lastLoginAt: now
                    };
                }
                return db.put('users', user);
            }

            // Update lastLoginAt
            user.lastLoginAt = now;
            return db.put('users', user);
        }).then(function (user) {
            // Step 2: Upsert history (userId + serverId + loginDate)
            return db.getByIndex('history', 'idx_user_date', [userId, serverId, today]).then(function (existing) {
                if (existing && existing.length > 0) {
                    var row = existing[0];
                    row.loginCount = (row.loginCount || 0) + 1;
                    row.lastLoginAt = now;
                    return db.put('history', row).then(function () { return row.loginCount; });
                } else {
                    var newRow = {
                        userId: userId,
                        channelCode: channelCode,
                        serverId: serverId,
                        loginDate: today,
                        loginCount: 1,
                        lastLoginAt: now
                    };
                    return db.put('history', newRow).then(function () { return 1; });
                }
            });
        }).then(function (todayLoginCount) {
            log.info('RESP', 'Sending response to client');
            log.details([
                ['loginToken', loginToken.substring(0, 16) + '...'],
                ['loginTokenLength', String(loginToken.length) + ' chars'],
                ['todayLoginCount', String(todayLoginCount)],
                ['tokenStorage', 'IndexedDB (users store)']
            ]);

            callback({
                loginToken: loginToken,
                todayLoginCount: todayLoginCount
            });
        }).catch(function (err) {
            log.warn('ACTION', 'SaveHistory → DB error, using FALLBACK');
            log.alwaysDetails([
                ['reason', err.message || 'unknown'],
                ['fallback', 'Generate client-side token']
            ]);

            callback({
                loginToken: LoginServer.generateToken(64),
                todayLoginCount: 1
            });
        });
    }

    LoginServer.handlers['SaveHistory'] = handleSaveHistory;
    if (LoginServer._handlerNames.indexOf('SaveHistory') === -1) {
        LoginServer._handlerNames.push('SaveHistory');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
