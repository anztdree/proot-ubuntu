/**
 * actions/loginGame.js — Handle loginGame action
 * Super Warrior Z — LOGIN SERVER (100% IndexedDB)
 *
 * Evidence: main.min.js L114369-114385
 *   clientLoginUser(username, password, fromChannel, callback)
 *   request = { type:'User', action:'loginGame', userId, password, fromChannel, ... }
 *
 *   Response fields (L138076-138082):
 *     userId, channelCode, nickName, securityCode
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
    var db = LoginServer.db;

    function handleLoginGame(request, callback) {
        log.info('ACTION', '═══════════════ loginGame ══════════════');

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

        // Cek user di IndexedDB
        db.get('users', userId).then(function (existing) {
            var now = LoginServer.nowSeconds();

            if (existing) {
                // User sudah ada — reuse loginToken + securityCode
                existing.lastLoginAt = now;
                if (nickName) existing.nickName = nickName;
                if (channelCode) existing.channelCode = channelCode;

                log.info('ACTION', 'loginGame → existing user found');
                log.details([
                    ['userId', existing.userId],
                    ['securityCode', existing.securityCode],
                    ['loginToken', existing.loginToken ? existing.loginToken.substring(0, 16) + '...' : '(empty)']
                ]);

                return db.put('users', existing).then(function () {
                    return existing;
                });
            } else {
                // User baru — generate loginToken + securityCode
                var loginToken = LoginServer.generateToken(64);
                var securityCode = LoginServer.generateToken(32);
                var sign = LoginServer.generateToken(32);
                var security = LoginServer.generateToken(32);

                var newUser = {
                    userId: userId,
                    nickName: nickName || userId,
                    channelCode: channelCode,
                    loginToken: loginToken,
                    securityCode: securityCode,
                    sign: sign,
                    security: security,
                    createdAt: now,
                    lastLoginAt: now
                };

                log.info('ACTION', 'loginGame → new user created');
                log.details([
                    ['userId', newUser.userId],
                    ['securityCode', newUser.securityCode],
                    ['loginToken', newUser.loginToken.substring(0, 16) + '...']
                ]);

                return db.put('users', newUser).then(function () {
                    return newUser;
                });
            }
        }).then(function (user) {
            var responseData = {
                userId: user.userId,
                channelCode: user.channelCode,
                nickName: user.nickName,
                securityCode: user.securityCode
            };

            log.info('RESP', 'Sending response to client');
            log.details([
                ['userId', responseData.userId],
                ['channelCode', responseData.channelCode],
                ['nickName', responseData.nickName || '(empty)'],
                ['securityCode', responseData.securityCode]
            ]);

            callback(responseData);
        }).catch(function (err) {
            log.warn('ACTION', 'loginGame → DB error, using FALLBACK');
            log.alwaysDetails([
                ['reason', err.message || 'unknown'],
                ['userId', userId]
            ]);

            callback({
                userId: userId,
                channelCode: channelCode,
                nickName: nickName,
                securityCode: LoginServer.generateToken(32)
            });
        });
    }

    LoginServer.handlers['loginGame'] = handleLoginGame;
    if (LoginServer._handlerNames.indexOf('loginGame') === -1) {
        LoginServer._handlerNames.push('loginGame');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
