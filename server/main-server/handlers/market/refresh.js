/**
 * draft/market/refresh.js — Normal Market Refresh Handler (v3 — BUG FIX)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * BUG YANG DIPERBAIKI (v2 → v3):
 * ============================================================
 *
 * BUG: "Refresh tidak berkurang" + state hilang saat re-login
 *   ROOT CAUSE: v2 pakai MainServer.handlers.market (IN-MEMORY) untuk
 *   _freeRefreshTimes, _diamondRefreshCount, dll. Ini RESET setiap
 *   server restart. Plus free refresh TIDAK deduct apapun dari user.
 *
 *   FIX: Pakai savedData (IndexedDB ms_user_{userId}_1) untuk
 *   persistent state. Simpan _marketState di savedData.
 *
 * CLIENT CODE TRACE:
 *   L169328-169339 freshRequest(e):
 *     ts.processHandler({
 *       type: o,  // "market" or "vipMarket"
 *       action: "refresh",
 *       userId: ..., refreshType: e
 *     }, function(o) {
 *       ItemsCommonSingleton.getInstance().resetTtemsCallBack(o)  // proses _changeInfo
 *       2 == e && (diamondRefreshCount++)  // client-side increment
 *       n.refreshData(o._market)           // update UI
 *       t.refreshAll(!0)
 *       t.judgeRed()
 *     })
 *
 *   L169316-169324 refreshBtnTap():
 *     var n = t.data.getRefreshConsume();
 *     if(n.id != DIAMONDID) return void e.freshRequest(3);  // item card
 *     // else: diamond — show confirm dialog
 *     UIWindowManager.buyTips(message, vip, price, id, confirmFunc)
 *
 * refreshType: 1=free, 2=diamond, 3=item card (id=141)
 *
 * Client L62195-62203 getMarketRefreshTimes():
 *   n = (getServerTime() - _marketRefreshTimesRecover) / 1e3
 *   a = _marketRefreshTimes + floor(n / marketRefreshTime)
 *   marketRefreshTime = 7200 (constant.json)
 *
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

    // ============================================================
    //  ITEM INVENTORY HELPERS
    // ============================================================

    function getItemNum(savedData, itemId) {
        var items = savedData && savedData.totalProps && savedData.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    function setItemNum(savedData, itemId, num) {
        if (!savedData.totalProps) savedData.totalProps = { _items: [] };
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = num;
                return;
            }
        }
        items.push({ _id: Number(itemId), _num: num });
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

    // ============================================================
    //  MARKET ITEM GENERATION (sama seperti getInfo)
    // ============================================================

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
        if (!market) return {};
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

    // ============================================================
    //  HANDLER
    // ============================================================

    function handleRefresh(request, callback) {
        var refreshType = Number(request.refreshType);
        var userId = request.userId;

        log.info('HANDLER', 'market/refresh processing');
        log.details('request', [
            ['refreshType', String(refreshType)],
            ['userId', String(userId)]
        ]);

        try {
            var constant = loadJson('constant');
            var refreshMax = (constant && constant[1]) ? (constant[1].marketRefreshMax || 5) : 5;

            // ═══ LOAD PERSISTENT STATE dari savedData ═══
            var key = 'ms_user_' + userId + '_1';
            var savedData = db._get(key);

            if (!savedData) {
                log.error('HANDLER', 'market/refresh - savedData tidak ditemukan: ' + key);
                callback({}, 1);
                return;
            }

            // Init _marketState kalau belum ada
            if (!savedData._marketState) {
                savedData._marketState = {
                    _freeRefreshTimes: refreshMax,
                    _diamondRefreshCount: 0,
                    _refreshTimesStartRecoverTime: 0
                };
            }

            var mState = savedData._marketState;

            // ═══ GENERATE NEW ITEMS ═══
            var newItems = generateMarketItems();
            var changeInfoItems = {};

            // ═══ FREE REFRESH (type=1) ═══
            if (refreshType === 1) {
                // Cek recovery: client L62195-62203
                // getMarketRefreshTimes() = freeTimes + floor((serverTime - recoverTime) / 1e3 / interval)
                // Jadi server bisa tambah freeTimes berdasarkan waktu yang lewat
                var marketRefreshTime = (constant && constant[1]) ? (constant[1].marketRefreshTime || 7200) : 7200;
                var now = Date.now();
                var recoverTime = mState._refreshTimesStartRecoverTime || 0;

                if (recoverTime > 0) {
                    var elapsedSec = (now - recoverTime) / 1000;
                    var recovered = Math.floor(elapsedSec / marketRefreshTime);
                    if (recovered > 0) {
                        mState._freeRefreshTimes = Math.min(
                            mState._freeRefreshTimes + recovered,
                            refreshMax
                        );
                        log.info('HANDLER', 'market/refresh — recovered ' + recovered
                            + ' free times, now ' + mState._freeRefreshTimes);
                    }
                }

                if (mState._freeRefreshTimes <= 0) {
                    log.warn('HANDLER', 'market/refresh - no free times left');
                    callback({}, 1);
                    return;
                }

                mState._freeRefreshTimes--;
                mState._refreshTimesStartRecoverTime = now;
            }

            // ═══ DIAMOND REFRESH (type=2) ═══
            if (refreshType === 2) {
                var marketRefreshData = loadJson('marketRefresh');
                var costEntry = marketRefreshData && marketRefreshData[String(mState._diamondRefreshCount + 1)];
                if (!costEntry) {
                    log.warn('HANDLER', 'market/refresh - diamond refresh exhausted (count=' + mState._diamondRefreshCount + ')');
                    callback({}, 1);
                    return;
                }

                var costId = Number(costEntry.marketRefreshCostID);  // 101 = diamond
                var costPrice = Number(costEntry.marketRefreshPrice);

                var currentDiamonds = getItemNum(savedData, costId);
                if (currentDiamonds < costPrice) {
                    log.warn('HANDLER', 'market/refresh - not enough diamonds: have ' + currentDiamonds + ', need ' + costPrice);
                    callback({}, 1);
                    return;
                }

                var newDiamondTotal = currentDiamonds - costPrice;
                setItemNum(savedData, costId, newDiamondTotal);

                // KIRIM diamond di _changeInfo agar client cache sync!
                changeInfoItems[String(costId)] = { _id: costId, _num: newDiamondTotal };
                mState._diamondRefreshCount++;
            }

            // ═══ ITEM CARD REFRESH (type=3) ═══
            if (refreshType === 3) {
                var cardId = 141; // MARKETREFRESHID

                var currentCards = getItemNum(savedData, cardId);
                if (currentCards < 1) {
                    log.warn('HANDLER', 'market/refresh - no refresh cards: have ' + currentCards);
                    callback({}, 1);
                    return;
                }

                var newCardTotal = currentCards - 1;
                setItemNum(savedData, cardId, newCardTotal);

                // KIRIM card di _changeInfo agar client cache sync!
                changeInfoItems[String(cardId)] = { _id: cardId, _num: newCardTotal };
            }

            // ═══ SIMPAN ═══
            db._set(key, savedData);

            // Simpan juga ke in-memory state untuk buy handler
            MainServer.handlers.market._currentItems = newItems;
            MainServer.handlers.market._freeRefreshTimes = mState._freeRefreshTimes;
            MainServer.handlers.market._refreshTimesStartRecoverTime = mState._refreshTimesStartRecoverTime || 0;

            // ═══ BUILD RESPONSE ═══
            var response = {};

            // FIX v3: SELALU kirim _changeInfo kalau ada cost
            // Client resetTtemsCallBack memproses _changeInfo._items → setItem = REPLACE
            var hasCost = Object.keys(changeInfoItems).length > 0;
            if (hasCost) {
                response._changeInfo = { _items: changeInfoItems };
            }

            // Nested _market x2 — L169338: n.refreshData(o._market)
            // refreshData(e): e._freeRefreshTimes, e._refreshTimesStartRecoverTime, e._market._items
            response._market = {
                _freeRefreshTimes: mState._freeRefreshTimes,
                _refreshTimesStartRecoverTime: mState._refreshTimesStartRecoverTime || 0,
                _market: {
                    _items: newItems
                }
            };

            log.info('HANDLER', 'market/refresh success');
            log.details('response', [
                ['refreshType', String(refreshType)],
                ['freeRefreshTimes', String(mState._freeRefreshTimes)],
                ['diamondRefreshCount', String(mState._diamondRefreshCount)],
                ['hasCost', String(hasCost)]
            ]);

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'market/refresh UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    // ============================================================
    //  REGISTER
    // ============================================================

    MainServer.registerHandler('market', 'refresh', handleRefresh);
    window.MainServer = MainServer;
})();