/**
 * draft/market/getInfo.js — Normal Market Info Handler (v3 — BUG FIX)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * BUG FIX (v2 → v3):
 * ============================================================
 *
 * BUG: _freeRefreshTimes & _diamondRefreshCount di in-memory (reset saat restart)
 *   FIX: Load dari savedData._marketState. Jika ada, pakai state tersimpan.
 *   Jika belum ada, init default. Ini sinkron dengan refresh.js v3.
 *
 * ============================================================
 * RESPONSE STRUCTURE — L169395-169397 refreshData:
 *   Client: t._market → e = response._market
 *   refreshData(e): e._freeRefreshTimes, e._refreshTimesStartRecoverTime, e._market._items
 *   Jadi response = { _market: { _freeRefreshTimes, _refreshTimesStartRecoverTime, _market: { _items } } }
 *   NESTED 2 KALI.
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.market) {
        MainServer.handlers.market = {};
    }

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                _cache[name] = data;
                return data;
            }
        } catch (e) {
            log.warn('RESOURCE', 'Failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    var MARKET_SLOT_COUNT = 8;

    function weightedRandomPick(pool) {
        if (!pool || pool.length === 0) return null;
        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) totalWeight += (pool[i].weight || 1);
        var rand = Math.random() * totalWeight;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += (pool[j].weight || 1);
            if (rand <= cumulative) return pool[j].entry;
        }
        return pool[pool.length - 1].entry;
    }

    function generateMarketItems() {
        var market = loadJson('market');
        if (!market) {
            log.error('HANDLER', 'market/getInfo — market.json not loaded');
            return {};
        }
        var groups = {};
        for (var id in market) {
            if (!market.hasOwnProperty(id)) continue;
            var entry = market[id];
            if (entry.pos !== 1) continue;
            var gid = entry.goodsID;
            if (!groups[gid]) groups[gid] = [];
            groups[gid].push({ entry: entry, weight: entry.random || 1 });
        }
        var picked = [];
        for (var gid in groups) {
            if (!groups.hasOwnProperty(gid)) continue;
            var chosen = weightedRandomPick(groups[gid]);
            if (chosen) picked.push(chosen);
        }
        for (var i = picked.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = picked[i]; picked[i] = picked[j]; picked[j] = tmp;
        }
        var count = Math.min(picked.length, MARKET_SLOT_COUNT);
        var items = {};
        for (var s = 0; s < count; s++) {
            var e = picked[s];
            items[String(s + 1)] = {
                _goods: { _items: { "0": { _id: e.goodsID, _num: e.num } } },
                _price: { _items: { "0": { _id: e.coinID, _num: e.price } } },
                _haveBought: 0,
                _discount: e.discount || ""
            };
        }
        return items;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetInfo(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'market/getInfo processing');
        log.details('request', [['userId', userId || '-']]);

        try {
            var constant = loadJson('constant');
            var refreshMax = (constant && constant[1]) ? (constant[1].marketRefreshMax || 5) : 5;
            var marketRefreshTime = (constant && constant[1]) ? (constant[1].marketRefreshTime || 7200) : 7200;

            // ═══ LOAD PERSISTENT STATE dari savedData ═══
            var key = 'user:' + userId;
            var savedData = db._get(key);

            var freeRefreshTimes = refreshMax;
            var recoverTime = 0;
            var diamondRefreshCount = 0;

            if (savedData && savedData._marketState) {
                var mState = savedData._marketState;
                freeRefreshTimes = mState._freeRefreshTimes !== undefined ? mState._freeRefreshTimes : refreshMax;
                recoverTime = mState._refreshTimesStartRecoverTime || 0;
                diamondRefreshCount = mState._diamondRefreshCount || 0;

                // Recovery: hitung free times yang pulih berdasarkan waktu
                if (recoverTime > 0 && freeRefreshTimes < refreshMax) {
                    var now = Date.now();
                    var elapsedSec = (now - recoverTime) / 1000;
                    var recovered = Math.floor(elapsedSec / marketRefreshTime);
                    if (recovered > 0) {
                        freeRefreshTimes = Math.min(freeRefreshTimes + recovered, refreshMax);
                        log.info('HANDLER', 'market/getInfo — recovered ' + recovered
                            + ' free times, now ' + freeRefreshTimes);
                    }
                }
            }

            // Cek apakah market items sudah ada di in-memory (dari refresh)
            var marketItems = MainServer.handlers.market._currentItems;
            if (!marketItems || Object.keys(marketItems).length === 0) {
                marketItems = generateMarketItems();
                log.info('HANDLER', 'market/getInfo — generated NEW market items');
            } else {
                log.info('HANDLER', 'market/getInfo — using EXISTING market items');
            }

            // Simpan state ke in-memory untuk buy/refresh handler
            MainServer.handlers.market._currentItems = marketItems;
            MainServer.handlers.market._freeRefreshTimes = freeRefreshTimes;
            MainServer.handlers.market._refreshTimesStartRecoverTime = recoverTime;

            // ═══ RESPONSE — nested _market x2 ═══
            var response = {
                _market: {
                    _freeRefreshTimes: freeRefreshTimes,
                    _refreshTimesStartRecoverTime: recoverTime || 0,
                    _market: {
                        _items: marketItems
                    }
                }
            };

            log.info('HANDLER', 'market/getInfo success');
            log.details('response', [
                ['itemCount', String(Object.keys(marketItems).length)],
                ['freeRefreshTimes', String(freeRefreshTimes)],
                ['diamondRefreshCount', String(diamondRefreshCount)]
            ]);

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'market/getInfo UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('market', 'getInfo', handleGetInfo);
    window.MainServer = MainServer;
})();