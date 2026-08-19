/**
 * actions/getServerList.js — Handle GetServerList action
 * Super Warrior Z — LOGIN SERVER
 *
 * Evidence: main.min.js L114402-114410
 *   request = { type:'User', action:'GetServerList', userId, subChannel, channel }
 *
 * Response fields yang client BACA:
 *   serverList: Array of { serverId, name, url, online, hot, new }
 *   history: Array of serverId strings (distinct, ordered by lastLoginAt DESC)
 *   offlineReason: string
 *
 * Data source: IndexedDB (login-server / loginInfo)
 *   servers → __config__ record
 *   history → user record.history array
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

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
            if (v.length > 120) v = v.substring(0, 120) + '... (truncated)';
            log.detail(k, v);
        }

        var userId = request.userId || '';

        log.details([
            ['parsedUserId', userId],
            ['subChannel', request.subChannel || '(empty)'],
            ['channel', request.channel || '(empty)'],
            ['source', 'IndexedDB (__config__ + user record)']
        ]);

        // Read servers from __config__ and history from user record
        var configPromise = db.get('__config__');
        var userPromise = userId ? db.get(userId) : Promise.resolve(null);

        Promise.all([configPromise, userPromise]).then(function (results) {
            var config = results[0];
            var user = results[1];

            var servers = (config && config.servers) ? config.servers : [];
            var history = (user && user.history) ? user.history : [];

            // Ensure at least 1 server exists
            if (servers.length === 0) {
                log.warn('ACTION', 'No servers in __config__, using hardcoded fallback');
                servers = [
                    {
                        serverId: '1',
                        name: 'Local 1',
                        url: LoginServer.config.mainServerUrl,
                        online: true,
                        hot: false,
                        'new': true
                    }
                ];
            }

            log.info('ACTION', 'GetServerList → SUCCESS (from IndexedDB)');
            log.details([
                ['serverCount', String(servers.length)],
                ['historyLength', String(history.length)],
                ['offlineReason', '']
            ]);

            // Log DETAIL setiap server
            for (var s = 0; s < servers.length; s++) {
                var srv = servers[s];
                log.details([
                    ['server[' + s + '].serverId', srv.serverId],
                    ['server[' + s + '].name', srv.name],
                    ['server[' + s + '].url', srv.url],
                    ['server[' + s + '].online', String(srv.online)],
                    ['server[' + s + '].hot', String(srv.hot)],
                    ['server[' + s + '].new', String(srv['new'])]
                ]);
            }

            // Log DETAIL history
            if (history.length > 0) {
                log.info('RESP', 'History detail (' + history.length + ' entries)');
                for (var h = 0; h < history.length; h++) {
                    log.detail('history[' + h + ']', String(history[h]));
                }
            }

            log.info('RESP', 'Sending response to client');

            callback({
                serverList: servers,
                history: history,
                offlineReason: ''
            });
        }).catch(function (e) {
            log.error('STORAGE', 'IndexedDB error in GetServerList');
            log.alwaysDetails([
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)]
            ]);

            // Fallback
            callback({
                serverList: [
                    {
                        serverId: '1',
                        name: 'Local 1',
                        url: LoginServer.config.mainServerUrl,
                        online: true,
                        hot: false,
                        'new': true
                    }
                ],
                history: [],
                offlineReason: ''
            });
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
