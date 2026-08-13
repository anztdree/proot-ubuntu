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
 *   Response fields yang client baca (L138076-138082):
 *     userId, channelCode(=sdk), nickName, securityCode
 *
 *   loginToken: NOT dari loginGame — comes from SaveHistory (L137914)
 *
 *   Data source: IndexedDB (last_game_server / loginInfo)
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

    // ═══════════════════════════════════════════════════════════════════
    // HANDLER: loginGame
    // ═══════════════════════════════════════════════════════════════════

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
        var password = request.password || '';
        var channelCode = request.fromChannel || 'ppgame';
        var nickName = request.nickName || '';

        log.details([
            ['parsedUserId', userId],
            ['parsedChannelCode', channelCode],
            ['parsedNickName', nickName || '(empty)'],
            ['source', 'IndexedDB (last_game_server/loginInfo)']
        ]);

        db.get(userId).then(function (acc) {
            var now = LoginServer.nowSeconds();

            if (!acc) {
                // New user — create record
                var securityCode = 'sec_' + Math.random().toString(36).substr(2, 6);
                acc = {
                    userId: userId,
                    password: password,
                    channelCode: channelCode,
                    nickName: nickName,
                    securityCode: securityCode,
                    loginToken: '',
                    createTime: now,
                    lastLoginTime: now,
                    todayLoginCount: 0,
                    loginDate: '',
                    language: 'en',
                    history: []
                };

                log.info('STORAGE', 'New user — creating record');
                log.details([
                    ['userId', acc.userId],
                    ['securityCode', acc.securityCode],
                    ['channelCode', acc.channelCode]
                ]);

                db.put(acc).then(function () {
                    log.info('RESP', 'Sending response to client (new user)');
                    log.details([
                        ['userId', acc.userId],
                        ['channelCode', acc.channelCode],
                        ['nickName', acc.nickName || '(empty)'],
                        ['securityCode', acc.securityCode]
                    ]);
                    callback({
                        userId: acc.userId,
                        channelCode: acc.channelCode,
                        nickName: acc.nickName,
                        securityCode: acc.securityCode
                    });
                });
            } else {
                // Existing user — check password
                log.info('STORAGE', 'Existing user found');
                var _sp = String(acc.password || '');
                var _rp = String(password || '');
                log.details([
                    ['storedPassword', _sp.length > 20 ? _sp.substring(0, 20) + '...' : _sp],
                    ['requestPassword', _rp.length > 20 ? _rp.substring(0, 20) + '...' : _rp],
                    ['match', String(_sp === _rp)]
                ]);

                if (_sp !== _rp) {
                    log.error('ACTION', 'Password mismatch');
                    callback({ error: 'password_mismatch' }, 1);
                    return;
                }

                // Update lastLoginTime
                acc.lastLoginTime = now;
                if (!acc.securityCode) {
                    acc.securityCode = 'sec_' + Math.random().toString(36).substr(2, 6);
                }
                if (!acc.loginToken) {
                    acc.loginToken = LoginServer.generateToken();
                }

                db.put(acc).then(function () {
                    log.info('RESP', 'Sending response to client (existing user)');
                    log.details([
                        ['userId', acc.userId],
                        ['channelCode', acc.channelCode],
                        ['nickName', acc.nickName || '(empty)'],
                        ['securityCode', acc.securityCode]
                    ]);
                    callback({
                        userId: acc.userId,
                        channelCode: acc.channelCode,
                        nickName: acc.nickName,
                        securityCode: acc.securityCode
                    });
                });
            }
        }).catch(function (e) {
            log.error('STORAGE', 'IndexedDB error in loginGame');
            log.alwaysDetails([
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)]
            ]);

            // Fallback — generate client-side
            var fallbackSecurityCode = 'sec_' + Math.random().toString(36).substr(2, 6);
            log.warn('ACTION', 'loginGame → DB error, using FALLBACK');
            callback({
                userId: userId,
                channelCode: channelCode,
                nickName: nickName,
                securityCode: fallbackSecurityCode
            });
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
