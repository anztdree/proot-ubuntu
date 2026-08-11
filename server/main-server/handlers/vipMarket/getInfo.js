/**
 * handlers/draft/vipMarket/getInfo.js — VIP Market Info Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * CLIENT CODE TRACE (HANYA DARI MAIN.MIN.JS, BUKAN ASUMSI)
 * ============================================================
 *
 * REQUEST — L169205-169209:
 *   { type: "vipMarket", action: "getInfo",
 *     userId: UserInfoSingleton.getInstance().userId, version: "1.0" }
 *
 * RESPONSE callback — L169209-169212:
 *   t.marketType = MarketType.VIP,
 *   t.refreshData(n._market),           // n = response
 *   e.refreshAll(!0),
 *   e.marketBg.source = "shichangnew8_jpg",
 *   e.marketBtnGroup.getChildAt(0).visible = !1,
 *   e.vipMarketBtnGroup.getChildAt(0).visible = !0,
 *   e.judgeRed()
 *
 * refreshData(e) — L169395-169397:
 *   e = response._market
 *   t.setFreeRefreshTimes(e._freeRefreshTimes)
 *   t.setRefreshTimesStartRecoverTime(e._refreshTimesStartRecoverTime)
 *   t.setItems(e._market._items)              // DOUBLE-NESTED _market!
 *
 * setFreeRefreshTimes (L169371-169373):
 *   marketType == VIP -> TimesInfoSingleton.vipMarketRefreshTimes = e
 *
 * setRefreshTimesStartRecoverTime (L169377-169379):
 *   marketType == VIP -> TimesInfoSingleton.vipMarketRefreshTimesRecover = e
 *
 * getVipMarketRefreshTimes (L62209-62216):
 *   max = constant[1].vipMarketRefreshTimeMax (= 5)
 *   if(_vipMarketRefreshTimes >= max) return _vipMarketRefreshTimes
 *   n = (getServerTime() - _vipMarketRefreshTimesRecover) / 1e3
 *   interval = constant[1].vipMarketRefreshTime (= 43200 = 12 jam)
 *   a = _vipMarketRefreshTimes + floor(n / interval)
 *   return min(a, max)
 *   NOTE: TIDAK ada "if(recover == 0) return max" seperti normal market
 *         Jadi HARUS kirim _vipMarketRefreshTimes = max saat pertama kali
 *
 * MarketItem constructor (L169469-169480) — SAMA untuk VIP & normal:
 *   var n = e._goods._items;   // OBJECT
 *   for(o in n) t.goodId = n[o]._id, t.goodNum = n[o]._num
 *   var a = e._price._items;   // OBJECT
 *   for(o in a) t.priceId = a[o]._id, t.priceNum = a[o]._num
 *   t.haveBought = e._haveBought
 *   t.discount = getlanguage(e._discount)
 *
 * ============================================================
 * VIP MARKET SPECS (trace dari client):
 * ============================================================
 * - Diamond refresh DISABLED: L169409 -> o = void 0 -> max = true
 * - Item-card refresh DISABLED: L169416 guard: marketType == NORMAL
 * - Hanya refreshType: 1 (free refresh) yang bisa
 * - VIP Level gate: L169288 -> constant[1].vipMarketNeeded (= 8)
 * - VIP 0 -> L169184: showVip0() sembunyikan semua tombol
 * - constant[1].vipMarketRefreshTimeMax = 5
 * - constant[1].vipMarketRefreshTime = 43200 (12 jam)
 *
 * ============================================================
 * vipMarket.json — 118 entries, pos 1-8:
 *   Setiap pos punya beberapa entry dengan weight "random"
 *   Pilih satu weighted entry per pos
 * ============================================================
 * {
 *   id, goodsID, num, coinID, price, pos, random, discount
 * }
 * ============================================================
 *
 * RESPONSE STRUCTURE — double-nested _market (SAMA persis normal market):
 * {
 *   _market: {
 *     _freeRefreshTimes: 5,
 *     _refreshTimesStartRecoverTime: 0,
 *     _market: {
 *       _items: {
 *         "1": { _goods:{_items:{"0":{_id,_num}}}, _price:{_items:{"0":{_id,_num}}}, _haveBought:0, _discount:"..." },
 *         "2": { ... },
 *         ...
 *         "8": { ... }
 *       }
 *     }
 *   }
 * }
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;

    if (!MainServer.handlers.vipMarket) {
        MainServer.handlers.vipMarket = {};
    }

    // ============================================================
    //  RESOURCE CACHE
    // ============================================================

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

    // ============================================================
    //  WEIGHTED RANDOM — pola SAMA seperti market/getInfo.js
    // ============================================================

    function weightedRandomPick(pool) {
        if (!pool || pool.length === 0) return null;
        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) {
            totalWeight += (pool[i].weight || 1);
        }
        var rand = Math.random() * totalWeight;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += (pool[j].weight || 1);
            if (rand <= cumulative) return pool[j].entry;
        }
        return pool[pool.length - 1].entry;
    }

    // ============================================================
    //  GENERATE VIP MARKET ITEMS
    // ============================================================
    // vipMarket.json: 118 entries, pos 1-8
    // Berbeda dari market.json yang punya 21 goodsID groups:
    // - market.json: semua pos=1, group by goodsID, pick one per group, shuffle
    // - vipMarket.json: setiap entry punya pos spesifik (1-8),
    //   group by pos, pick one weighted entry per pos
    // ============================================================

    function generateVipMarketItems() {
        var vipMarket = loadJson('vipMarket');
        if (!vipMarket) {
            log.error('HANDLER', 'vipMarket/getInfo - vipMarket.json not loaded');
            return {};
        }

        // Group entries by pos (1-8)
        var groups = {};
        for (var id in vipMarket) {
            if (!vipMarket.hasOwnProperty(id)) continue;
            var entry = vipMarket[id];
            var pos = entry.pos;
            if (pos < 1 || pos > MARKET_SLOT_COUNT) continue;
            if (!groups[pos]) groups[pos] = [];
            groups[pos].push({ entry: entry, weight: entry.random || 1 });
        }

        // Pick one weighted entry per pos
        var items = {};
        for (var pos = 1; pos <= MARKET_SLOT_COUNT; pos++) {
            var pool = groups[pos];
            if (!pool || pool.length === 0) {
                log.warn('HANDLER', 'vipMarket/getInfo - no entries for pos ' + pos);
                continue;
            }
            var chosen = weightedRandomPick(pool);
            if (chosen) {
                items[String(pos)] = {
                    _goods: {
                        _items: {
                            "0": { _id: chosen.goodsID, _num: chosen.num }
                        }
                    },
                    _price: {
                        _items: {
                            "0": { _id: chosen.coinID, _num: chosen.price }
                        }
                    },
                    _haveBought: 0,
                    _discount: chosen.discount || ""
                };
            }
        }

        return items;
    }

    // ============================================================
    //  HANDLER
    // ============================================================

    function handleGetInfo(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'vipMarket/getInfo processing');
        log.details('request', [['userId', userId || '-']]);

        try {
            var constant = loadJson('constant');
            // L169383: constant[1].vipMarketRefreshTimeMax
            var refreshMax = (constant && constant[1]) ? (constant[1].vipMarketRefreshTimeMax || 5) : 5;

            // Cek apakah VIP market items sudah pernah di-generate
            var state = MainServer.handlers.vipMarket;
            var marketItems = state._currentItems;
            var freeRefreshTimes = state._freeRefreshTimes;
            var recoverTime = state._refreshTimesStartRecoverTime;

            if (!marketItems || Object.keys(marketItems).length === 0) {
                log.info('HANDLER', 'vipMarket/getInfo - generating NEW vip market items');
                marketItems = generateVipMarketItems();
                freeRefreshTimes = refreshMax;
                // recoverTime = 0 karena belum pernah refresh
                // Client getVipMarketRefreshTimes():
                //   if(_vipMarketRefreshTimes >= max) return (5 >= 5 = true) -> 5
                // Jadi recoverTime=0 tidak masalah saat pertama kali (full)
                recoverTime = 0;

                // Simpan state
                state._currentItems = marketItems;
                state._freeRefreshTimes = freeRefreshTimes;
                state._refreshTimesStartRecoverTime = recoverTime;
            } else {
                log.info('HANDLER', 'vipMarket/getInfo - returning EXISTING vip market items');
            }

            // ============================================================
            //  RESPONSE — double-nested _market (L169395-169397)
            // ============================================================
            // response._market -> e = response._market
            //   e._freeRefreshTimes -> setFreeRefreshTimes
            //   e._refreshTimesStartRecoverTime -> setRefreshTimesStartRecoverTime
            //   e._market._items -> setItems
            // Jadi NESTED 2 KALI, SAMA PERSIS normal market
            // ============================================================

            var response = {
                _market: {
                    _freeRefreshTimes: freeRefreshTimes,
                    _refreshTimesStartRecoverTime: recoverTime || 0,
                    _market: {
                        _items: marketItems
                    }
                }
            };

            log.info('HANDLER', 'vipMarket/getInfo success');
            log.details('response', [
                ['itemCount', String(Object.keys(marketItems).length)],
                ['freeRefreshTimes', String(freeRefreshTimes)],
                ['recoverTime', String(recoverTime)]
            ]);

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'vipMarket/getInfo UNCAUGHT ERROR', err);
            callback({});
        }
    }

    // ============================================================
    //  REGISTER
    // ============================================================

    MainServer.registerHandler('vipMarket', 'getInfo', handleGetInfo);

    window.MainServer = MainServer;
})();