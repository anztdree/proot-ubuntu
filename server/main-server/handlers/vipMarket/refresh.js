/**
 * handlers/draft/vipMarket/refresh.js — VIP Market Refresh Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * CLIENT CODE TRACE (HANYA DARI MAIN.MIN.JS, BUKAN ASUMSI)
 * ============================================================
 *
 * REQUEST — L169328-169336 (freshRequest):
 *   { type: "vipMarket", action: "refresh", userId, refreshType: e }
 *   refreshType: 1 = free, 2 = diamond, 3 = item card (MARKETREFRESHID=141)
 *
 * RESPONSE callback — L169337-169338 (SAMA untuk normal & VIP!):
 *   ItemsCommonSingleton.getInstance().resetTtemsCallBack(o)
 *     -> proses o._changeInfo._items -> setItem(_id, _num) = REPLACE
 *   2 == e && (n.marketType == VIP
 *     ? AllRefreshCount.getInstance().vipMarketDiamondRefreshCount++
 *     : AllRefreshCount.getInstance().marketDiamondRefreshCount++)
 *   n.refreshData(o._market)       // double-nested _market
 *   t.refreshAll(!0)
 *   t.judgeRed()
 *
 * ============================================================
 * VIP MARKET REFRESH — HANYA FREE YANG BISA DARI UI
 * ============================================================
 *
 * refreshType 2 (diamond) — DISABLED:
 *   getRefreshConsume (L169404-169416):
 *     L169409: e.marketType == VIP && (o = void 0)
 *     L169411: if(!o) return { price: langKey, vip:0, id:0, max: true }
 *     -> tombol disabled, client TIDAK AKAN kirim refreshType 2
 *
 * refreshType 3 (item card) — DISABLED:
 *   setShowRefreshGroup (L169237-169240):
 *     L169238: marketType == VIP -> showRefreshGroup.visible = !1
 *   getRefreshConsume (L169416):
 *     guard: marketType == NORMAL (VIP tidak masuk branch ini)
 *     -> tombol hidden, client TIDAK AKAN kirim refreshType 3
 *
 * refreshType 1 (free) — SATU-SATUNYA YANG AKTIF:
 *   freeRefreshBtnTap (L169325-169327): freshRequest(1)
 *   setFreeRefreshTimes (L169371-169373):
 *     marketType == VIP -> TimesInfoSingleton.vipMarketRefreshTimes = e
 *   setRefreshTimesStartRecoverTime (L169377-169379):
 *     marketType == VIP -> TimesInfoSingleton.vipMarketRefreshTimesRecover = e
 *   getVipMarketRefreshTimes (L62209-62216):
 *     max = constant[1].vipMarketRefreshTimeMax (= 5)
 *     recovery = constant[1].vipMarketRefreshTime (= 43200 = 12 jam)
 *     n = (getServerTime() - recover) / 1e3
 *     a = stored + floor(n / recovery)
 *     return min(a, max)
 *     NOTE: getServerTime() return MS → recover HARUS MS
 *
 * ============================================================
 * INVENTORY PATTERN — pola weapon-upgrade.js L489-518, L810-811
 * ============================================================
 *   var db = window.MainServerDB;
 *   var key = 'ms_user_' + userId + '_1';
 *   var savedData = db._get(key);
 *   getItemNum(savedData, itemId) / setItemNum(savedData, itemId, num)
 *   db._set(key, savedData)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.vipMarket) {
        MainServer.handlers.vipMarket = {};
    }

    // ============================================================
    //  ITEM INVENTORY HELPERS — pola IDENTIK weapon-upgrade.js L489-518
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
    //  VIP MARKET ITEM GENERATION — pola SAMA seperti vipMarket/getInfo.js
    // ============================================================
    // vipMarket.json: 118 entries, pos 1-8
    // Group by pos, pick one weighted entry per pos
    // ============================================================

    var MARKET_SLOT_COUNT = 8;

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

    function generateVipMarketItems() {
        var vipMarket = loadJson('vipMarket');
        if (!vipMarket) return {};

        var groups = {};
        for (var id in vipMarket) {
            if (!vipMarket.hasOwnProperty(id)) continue;
            var entry = vipMarket[id];
            var pos = entry.pos;
            if (pos < 1 || pos > MARKET_SLOT_COUNT) continue;
            if (!groups[pos]) groups[pos] = [];
            groups[pos].push({ entry: entry, weight: entry.random || 1 });
        }

        var items = {};
        for (var pos = 1; pos <= MARKET_SLOT_COUNT; pos++) {
            var pool = groups[pos];
            if (!pool || pool.length === 0) continue;
            var chosen = weightedRandomPick(pool);
            if (chosen) {
                items[String(pos)] = {
                    _goods: { _items: { "0": { _id: chosen.goodsID, _num: chosen.num } } },
                    _price: { _items: { "0": { _id: chosen.coinID, _num: chosen.price } } },
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

    function handleRefresh(request, callback) {
        var refreshType = request.refreshType;
        var userId = request.userId;
        var state = MainServer.handlers.vipMarket;

        log.info('HANDLER', 'vipMarket/refresh processing');
        log.details('request', [['refreshType', String(refreshType)], ['userId', String(userId)]]);

        try {
            var constant = loadJson('constant');
            // L169383: constant[1].vipMarketRefreshTimeMax
            var refreshMax = (constant && constant[1]) ? (constant[1].vipMarketRefreshTimeMax || 5) : 5;

            // Init state kalau belum ada
            if (!state._diamondRefreshCount) state._diamondRefreshCount = 0;
            if (!state._freeRefreshTimes) state._freeRefreshTimes = refreshMax;

            var newItems = generateVipMarketItems();
            var changeInfoItems = {};

            // ============================================================
            //  BACA savedData — pola weapon-upgrade.js
            // Hanya dibutuhkan kalau ada biaya (refreshType 2 atau 3)
            // ============================================================
            var savedData = null;
            var key = 'ms_user_' + userId + '_1';

            if (refreshType === 2 || refreshType === 3) {
                savedData = db._get(key);
                if (!savedData) {
                    log.error('HANDLER', 'vipMarket/refresh - savedData tidak ditemukan: ' + key);
                    callback({});
                    return;
                }
            }

            // ============================================================
            //  refreshType 1 = FREE REFRESH (satu-satunya yang bisa dari UI)
            // ============================================================
            if (refreshType === 1) {
                if (state._freeRefreshTimes <= 0) {
                    log.warn('HANDLER', 'vipMarket/refresh - no free times left');
                    callback({});
                    return;
                }
                state._freeRefreshTimes--;
                // Client getVipMarketRefreshTimes (L62213):
                //   n = (getServerTime() - recover) / 1e3
                // getServerTime() return MS → recover HARUS MS
                state._refreshTimesStartRecoverTime = Date.now();
            }

            // ============================================================
            //  refreshType 2 = DIAMOND (DISABLED di UI untuk VIP)
            // Client getRefreshConsume L169409: o = void 0 -> max = true
            // Tombol disabled, client TIDAK AKAN kirim ini
            // Tapi handle anyway untuk robustness
            // ============================================================
            if (refreshType === 2) {
                var marketRefreshData = loadJson('marketRefresh');
                var costEntry = marketRefreshData && marketRefreshData[String(state._diamondRefreshCount + 1)];
                if (!costEntry) {
                    log.warn('HANDLER', 'vipMarket/refresh - diamond refresh exhausted');
                    callback({});
                    return;
                }
                var costId = Number(costEntry.marketRefreshCostID);  // 101 = diamond
                var costPrice = Number(costEntry.marketRefreshPrice);

                var currentCount = getItemNum(savedData, costId);
                var newTotal = currentCount - costPrice;

                log.details('DIAMOND', [
                    ['costId', String(costId)],
                    ['currentCount', String(currentCount)],
                    ['costPrice', String(costPrice)],
                    ['newTotal', String(newTotal)]
                ]);

                setItemNum(savedData, costId, newTotal);
                changeInfoItems[String(costId)] = { _id: costId, _num: newTotal };
                state._diamondRefreshCount++;

                db._set(key, savedData);
            }

            // ============================================================
            //  refreshType 3 = ITEM CARD (DISABLED di UI untuk VIP)
            // Client setShowRefreshGroup L169238: VIP -> visible = !1
            // Client getRefreshConsume L169416: guard marketType == NORMAL
            // Tombol hidden, client TIDAK AKAN kirim ini
            // Tapi handle anyway untuk robustness
            // ============================================================
            if (refreshType === 3) {
                var cardId = 141;  // MARKETREFRESHID

                var currentCards = getItemNum(savedData, cardId);
                var newCardTotal = currentCards - 1;

                log.details('CARD', [
                    ['cardId', String(cardId)],
                    ['currentCards', String(currentCards)],
                    ['newCardTotal', String(newCardTotal)]
                ]);

                setItemNum(savedData, cardId, newCardTotal);
                changeInfoItems[String(cardId)] = { _id: cardId, _num: newCardTotal };

                db._set(key, savedData);
            }

            // Simpan market state
            state._currentItems = newItems;

            // Build response
            var response = {};

            // _changeInfo hanya kalau ada biaya (refreshType 2 atau 3)
            // L169337: resetTtemsCallBack(o) dipanggil dengan response
            var hasCost = Object.keys(changeInfoItems).length > 0;
            if (hasCost) {
                response._changeInfo = { _items: changeInfoItems };
            }

            // _market — nested 2x, L169395-169397:
            //   e = response._market
            //   setFreeRefreshTimes(e._freeRefreshTimes)
            //   setRefreshTimesStartRecoverTime(e._refreshTimesStartRecoverTime)
            //   setItems(e._market._items)
            response._market = {
                _freeRefreshTimes: state._freeRefreshTimes,
                _refreshTimesStartRecoverTime: state._refreshTimesStartRecoverTime || 0,
                _market: {
                    _items: newItems
                }
            };

            log.info('HANDLER', 'vipMarket/refresh success');
            log.details('response', [
                ['refreshType', String(refreshType)],
                ['freeRefreshTimes', String(state._freeRefreshTimes)],
                ['diamondRefreshCount', String(state._diamondRefreshCount)],
                ['hasCost', String(hasCost)]
            ]);

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'vipMarket/refresh UNCAUGHT ERROR', err);
            callback({});
        }
    }

    // ============================================================
    //  REGISTER
    // ============================================================

    MainServer.registerHandler('vipMarket', 'refresh', handleRefresh);

    window.MainServer = MainServer;
})();