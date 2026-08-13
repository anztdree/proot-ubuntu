/**
 * actions/saveUserEnterInfo.js - Handle SaveUserEnterInfo action
 * Super Warrior Z - LOGIN SERVER
 *
 * Evidence: main.min.js L114448-114461 (reportToLoginEnterInfo)
 *   Dipanggil SETELAH clientEnterGame berhasil
 *   Callback: ts.loginClient.destroy() - disconnect login socket
 *
 *   request = { type:'User', action:'SaveUserEnterInfo', accountToken, channelCode, subChannel, createTime, userLevel, version }
 *   Response: {} (empty - analytics non-critical)
 *
 * Data source: NONE - analytics, langsung return
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;

    // HANDLER: SaveUserEnterInfo

    function handleSaveUserEnterInfo(request, callback) {
        log.info('ACTION', 'SaveUserEnterInfo');

        log.info('REQ', 'Request fields from client');
        var keys = Object.keys(request || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = String(request[k]);
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated)';
            log.detail(k, v);
        }

        log.details([
            ['parsedUserId', request.accountToken || '(empty)'],
            ['parsedChannelCode', request.channelCode || '(empty)'],
            ['parsedUserLevel', String(request.userLevel || 1)],
            ['note', 'Analytics event - non-critical, no storage']
        ]);

        log.info('RESP', 'Sending empty response (analytics discarded)');
        callback({});
    }

    // REGISTER

    LoginServer.handlers['SaveUserEnterInfo'] = handleSaveUserEnterInfo;
    if (LoginServer._handlerNames.indexOf('SaveUserEnterInfo') === -1) {
        LoginServer._handlerNames.push('SaveUserEnterInfo');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
