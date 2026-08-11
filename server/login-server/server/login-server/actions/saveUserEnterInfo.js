/**
 * actions/saveUserEnterInfo.js — Handle SaveUserEnterInfo action
 * Super Warrior Z — LOGIN SERVER (100% IndexedDB)
 *
 * Evidence: main.min.js L114448-114461 (reportToLoginEnterInfo)
 *   Dipanggil SETELAH clientEnterGame berhasil
 *   Callback → ts.loginClient.destroy()
 *   Response: { errorCode: 0 }
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

    function handleSaveUserEnterInfo(request, callback) {
        log.info('ACTION', '═══════════════ SaveUserEnterInfo ══════════════');

        log.info('REQ', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated)';
            log.detail(k, v);
        }

        // Analytics — simpan ke IndexedDB (non-blocking)
        var userId = request.accountToken || '';
        var channelCode = request.channelCode || 'ppgame';

        db.put('analytics', {
            userId: userId,
            eventType: 'saveUserEnterInfo',
            eventData: {
                channelCode: channelCode,
                subChannel: request.subChannel || '',
                userLevel: request.userLevel || 1,
                createTime: request.createTime || ''
            },
            createdAt: LoginServer.nowSeconds()
        }).catch(function () {
            // Analytics gagal — silent
        });

        log.info('RESP', 'Sending response to client');
        log.details([
            ['errorCode', '0'],
            ['note', 'client will call ts.loginClient.destroy()']
        ]);

        callback({ errorCode: 0 });
    }

    LoginServer.handlers['SaveUserEnterInfo'] = handleSaveUserEnterInfo;
    if (LoginServer._handlerNames.indexOf('SaveUserEnterInfo') === -1) {
        LoginServer._handlerNames.push('SaveUserEnterInfo');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
