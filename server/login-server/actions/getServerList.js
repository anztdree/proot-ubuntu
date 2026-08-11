/**
 * actions/getServerList.js — Handle GetServerList action
 * Super Warrior Z — LOGIN SERVER (100% IndexedDB)
 *
 * Evidence: main.min.js L114402-114410
 *   clientRequestServerList(userId, channel, callback)
 *   request = { type:'User', action:'GetServerList', userId, subChannel, channel }
 *
 * Response: { serverList: [...], history: [...], offlineReason: '' }
 */

(function () {
    'use strict';

    var LoginServer = window.LoginServer;
    var log = LoginServer.log;
    var db = LoginServer.db;

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
            ['channel', request.channel || '(empty)']
        ]);

        // Ambil servers dari IndexedDB
        db.getAll('servers').then(function (servers) {
            // Sort by sortOrder, then serverId
            servers.sort(function (a, b) {
                var sa = a.sortOrder || 0, sb = b.sortOrder || 0;
                if (sa !== sb) return sa - sb;
                return (a.serverId || '').localeCompare(b.serverId || '');
            });

            log.info('DB', 'Servers loaded: ' + servers.length);
            for (var s = 0; s < servers.length; s++) {
                log.details([
                    ['server[' + s + '].serverId', servers[s].serverId],
                    ['server[' + s + '].name', servers[s].name],
                    ['server[' + s + '].url', servers[s].url],
                    ['server[' + s + '].online', String(servers[s].online)]
                ]);
            }

            // Ambil history user — server terakhir dimainkan
            var history = [];
            if (userId) {
                return db.getByIndex('history', 'idx_userId', userId).then(function (histRows) {
                    // Dedup per serverId, sort by lastLoginAt DESC
                    var seen = {};
                    for (var h = 0; h < histRows.length; h++) {
                        var sid = histRows[h].serverId;
                        if (!seen[sid]) {
                            seen[sid] = histRows[h];
                        } else if (histRows[h].lastLoginAt > seen[sid].lastLoginAt) {
                            seen[sid] = histRows[h];
                        }
                    }

                    var sorted = Object.values(seen).sort(function (a, b) {
                        return (b.lastLoginAt || 0) - (a.lastLoginAt || 0);
                    });

                    for (var j = 0; j < Math.min(sorted.length, 10); j++) {
                        history.push(sorted[j].serverId);
                    }

                    log.details([
                        ['historyCount', String(history.length)]
                    ]);

                    return { serverList: servers, history: history, offlineReason: '' };
                });
            }

            return { serverList: servers, history: history, offlineReason: '' };
        }).then(function (result) {
            log.info('RESP', 'Sending response to client');
            log.details([
                ['serverList', 'Array(' + result.serverList.length + ')'],
                ['history', 'Array(' + result.history.length + ')']
            ]);

            callback(result);
        }).catch(function (err) {
            log.warn('ACTION', 'GetServerList → DB error, using FALLBACK');
            log.alwaysDetails([
                ['reason', err.message || 'unknown'],
                ['fallback', 'Return hardcoded local server']
            ]);

            callback({
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
            });
        });
    }

    LoginServer.handlers['GetServerList'] = handleGetServerList;
    if (LoginServer._handlerNames.indexOf('GetServerList') === -1) {
        LoginServer._handlerNames.push('GetServerList');
    }
    LoginServer._handlerCount = LoginServer._handlerNames.length;

    window.LoginServer = LoginServer;
})();
