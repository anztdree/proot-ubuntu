/**
 * handlers/draft/vipMarket/buy.js — VIP Market Buy Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * CLIENT CODE TRACE (HANYA DARI MAIN.MIN.JS, BUKAN ASUMSI)
 * ============================================================
 *
 * REQUEST — L169282-169303 (priceBtnEvent):
 *   Client-side VIP check dulu (L169288-169289):
 *     if(userVipLevel < constant[1].vipMarketNeeded(=8))
 *       return openNormal(...)  // client block, server tidak perlu check
 *
 *   getItemsPrice() (L169443-169464) → r[e] = { index, icon, countStr, id, haveBought, count, goodId, goodNum }
 *     index = Number(o) dimana o = loop key "1"-"8" dari marketItem
 *
 *   { type: "vipMarket", action: "buy", userId, pos: i, version: "1.0" }
 *   pos = r[e].index = 1-based slot (1-8)
 *
 * RESPONSE callback — L169304-169306 (SAMA untuk normal & VIP!):
 *   UIWindowManager.openCongratulationObtain(e),
 *     -> L56637: if(!(t._changeInfo || ...)) return
 *     -> L56639: i = t._changeInfo._items
 *     -> L56651: openCommonItemGetTips(i, ...)
 *       -> for(v in t):
 *            S = Number(t[v]._num) - getItemNum(Number(T))
 *            S > 0 -> tampilkan popup gain
 *            setItem(Number(v), t[v]._num)  // REPLACE!
 *   n.refreshData(e._market),        // ← _market DIBUTUHKAN!
 *     -> L169395-169397:
 *        setFreeRefreshTimes(e._freeRefreshTimes)
 *        setRefreshTimesStartRecoverTime(e._refreshTimesStartRecoverTime)
 *        setItems(e._market._items)   // update marketItem → haveBought state
 *   t.initTop(!0),                   // re-render currency display
 *   t.initItemsValue(!0),            // re-render item icons
 *   t.initItemsPrice(!0)             // re-render buy buttons
 *     -> L169272: t.lastBuyItem(o[n].index-1, o[n].haveBought)
 *     -> L169311: if(0 != t) disable button
 *
 * JADI _market HARUS dikirim karena:
 *   1. refreshData() butuh _market untuk update haveBought
 *   2. initItemsPrice() butuh data terbaru untuk disable tombol
 *   3. Tanpa _market, tombol tetap aktif setelah beli!
 *
 * ============================================================
 * INVENTORY PATTERN — pola weapon-upgrade.js L489-518, L810-811
 * ============================================================
 *   var db = window.MainServerDB;
 *   var key = 'user:' + userId;
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
    //  HANDLER
    // ============================================================

    function handleBuy(request, callback) {
        var pos = String(request.pos);
        var userId = request.userId;
        var state = MainServer.handlers.vipMarket;
        var currentItems = state._currentItems;

        log.info('HANDLER', 'vipMarket/buy processing');
        log.details('request', [['pos', pos], ['userId', String(userId)]]);

        // Validasi state
        if (!currentItems || !currentItems[pos]) {
            log.error('HANDLER', 'vipMarket/buy - state kosong atau pos invalid');
            callback({});
            return;
        }

        var item = currentItems[pos];

        if (item._haveBought) {
            log.warn('HANDLER', 'vipMarket/buy - sudah dibeli di pos ' + pos);
            callback({});
            return;
        }

        // Ekstrak goodId dan goodNum dari _goods._items
        // MarketItem constructor (L169469-169476): for...in _goods._items
        var goodId = 0, goodNum = 0, priceId = 0, priceNum = 0;
        for (var k in item._goods._items) {
            if (item._goods._items.hasOwnProperty(k)) {
                goodId = Number(item._goods._items[k]._id);
                goodNum = Number(item._goods._items[k]._num);
                break;
            }
        }
        for (var k in item._price._items) {
            if (item._price._items.hasOwnProperty(k)) {
                priceId = Number(item._price._items[k]._id);
                priceNum = Number(item._price._items[k]._num);
                break;
            }
        }

        // Tandai sudah dibeli - L169311: if(0 != t) disable button
        item._haveBought = 1;

        // ============================================================
        //  BACA & UPDATE savedData — pola weapon-upgrade.js
        // ============================================================
        var key = 'user:' + userId;
        var savedData = db._get(key);

        if (!savedData) {
            log.error('HANDLER', 'vipMarket/buy - savedData tidak ditemukan: ' + key);
            callback({});
            return;
        }

        // Baca jumlah SEKARANG dari savedData (BUKAN ItemsCommonSingleton!)
        var currentGoodCount = getItemNum(savedData, goodId);
        var currentPriceCount = getItemNum(savedData, priceId);

        log.details('BEFORE', [
            ['goodId', String(goodId)],
            ['currentGoodCount', String(currentGoodCount)],
            ['goodNum (buying)', String(goodNum)],
            ['priceId', String(priceId)],
            ['currentPriceCount', String(currentPriceCount)],
            ['priceNum (cost)', String(priceNum)]
        ]);

        // Hitung ABSOLUT TOTAL
        var newGoodTotal = Number(currentGoodCount) + Number(goodNum);
        var newPriceTotal = Number(currentPriceCount) - Number(priceNum);

        // Update savedData
        setItemNum(savedData, goodId, newGoodTotal);
        setItemNum(savedData, priceId, newPriceTotal);

        // Simpan balik ke DB — pola weapon-upgrade.js L1092
        db._set(key, savedData);

        // Build _changeInfo._items
        // KEY = String(itemId) — bukti: weapon-upgrade.js L888
        // _num = ABSOLUT TOTAL — bukti: setItem = REPLACE
        var changeItems = {};
        changeItems[String(goodId)] = { _id: goodId, _num: newGoodTotal };
        changeItems[String(priceId)] = { _id: priceId, _num: newPriceTotal };

        // ============================================================
        //  RESPONSE
        // ============================================================
        // L169305: n.refreshData(e._market) → BUTUH _market!
        //   refreshData: setItems(e._market._items) → update haveBought
        //   initItemsPrice → lastBuyItem → disable tombol pos ini
        // L169305: openCongratulationObtain(e) → BUTUH _changeInfo!
        //   openCommonItemGetTips → setItem(Number(v), _num) → update inventory
        // ============================================================

        var response = {
            _changeInfo: {
                _items: changeItems
            },
            _market: {
                _freeRefreshTimes: state._freeRefreshTimes || 5,
                _refreshTimesStartRecoverTime: state._refreshTimesStartRecoverTime || 0,
                _market: {
                    _items: currentItems
                }
            }
        };

        log.info('HANDLER', 'vipMarket/buy success');
        log.details('AFTER', [
            ['goodId', String(goodId)],
            ['newGoodTotal', String(newGoodTotal)],
            ['priceId', String(priceId)],
            ['newPriceTotal', String(newPriceTotal)]
        ]);

        callback(response);
    }

    // ============================================================
    //  REGISTER
    // ============================================================

    MainServer.registerHandler('vipMarket', 'buy', handleBuy);

    window.MainServer = MainServer;
})();