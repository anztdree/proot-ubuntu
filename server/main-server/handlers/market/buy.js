/**
 * draft/market/buy.js — Normal Market Buy Handler (v4 — BUG FIX)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * BUG YANG DIPERBAIKI (v3 → v4):
 * ============================================================
 *
 * BUG 1: "Item bertambah tapi tidak bisa digunakan, dipakai reset ke 0"
 *   ROOT CAUSE: Server HANYA kirim goodId di _changeInfo._items.
 *   Client openCommonItemGetTips (L56642-56644):
 *     for(var c in i) {
 *         var p = i[c]._id;
 *         e.getInstance().setItem(Number(v), t[v]._num);  // REPLACE!
 *     }
 *   setItem = REPLACE, bukan ADD. Tapi masalahnya:
 *     - Client setItem mengubah IN-MEMORY cache ItemsCommonSingleton
 *     - TAPI savedData di server TIDAK ter-sync dengan client cache
 *     - Saat client gunakan item → kirim request ke server → server baca
 *       savedData (yang BERBEDA dengan client cache) → RESET!
 *
 *   REAL ROOT CAUSE: Server TIDAK mengirim priceId (gold/diamond) di
 *   _changeInfo._items. Jadi setelah beli, client cache menunjukkan:
 *     - Item naik (goodId +N) → OK
 *     - Gold/diamond TIDAK berkurang → WRONG (client cache masih lama)
 *   Saat client pakai item, dia kirim request → server baca savedData
 *   (yang sudah di-deduct server-side) → response balik setItem → OVERWRITE
 *   client cache dengan savedData value → ITEM RESET KE 0.
 *
 *   FIX: Kirim priceId di _changeInfo._items JUGA. Format:
 *     _changeInfo._items = {
 *       "goodId":  { _id: goodId,  _num: newGoodTotal },
 *       "priceId": { _id: priceId, _num: newPriceTotal }
 *     }
 *
 * BUG 2: "gold & diamond tidak berkurang"
 *   ROOT CAUSE: Sama seperti BUG 1. Hanya karena priceId tidak dikirim
 *   di _changeInfo, client cache tidak ter-update. Tapi server-side
 *   savedData sudah benar. Jadi di server uang sudah berkurang,
 *   tapi di tampilan client tidak.
 *
 *   FIX: Sama — kirim priceId di _changeInfo.
 *
 * BUG 3: "refresh tidak berkurang" (di market/refresh.js)
 *   ROOT CAUSE: market/refresh.js v2 menggunakan in-memory state
 *   (MainServer.handlers.market._freeRefreshTimes) yang RESET
 *   setiap kali server restart. Plus, free refresh TIDAK kirim
 *   _changeInfo (tidak ada cost), tapi state TIDAK persistent.
 *
 *   FIX: Di refresh.js — pakai savedData untuk persistent state.
 *
 * BUG 4: Response _market salah
 *   L169305: n.refreshData(e._market)
 *   e = full response. Jadi e._market harus berisi:
 *     { _freeRefreshTimes, _refreshTimesStartRecoverTime,
 *       _market: { _items: {...} } }
 *   Kode v3 BENAR untuk nested _market._market._items.
 *   TETAPI _haveBought harus tetap di-currentItems.
 *
 * ============================================================
 * CLIENT CODE TRACE
 * ============================================================
 *
 * REQUEST — L169298-169303:
 *   { type: "market", action: "buy", userId, pos, version: "1.0" }
 *
 * RESPONSE callback — L169304-169305:
 *   UIWindowManager.openCongratulationObtain(e)
 *     → L56636-56651: proses e._changeInfo._items
 *       → setItem(Number(v), t[v]._num) = REPLACE untuk SETIAP item
 *   n.refreshData(e._market)
 *
 * IMPORTANT — L56642-56644 (openCongratulationObtain):
 *   for(var c in i) {          // i = _changeInfo._items
 *       var p = i[c]._id;      // → HANYA loop item yang DIKIRIM
 *       e.getInstance().setItem(Number(v), t[v]._num);
 *   }
 *   Jadi SETIAP item yang perlu di-update client cache HARUS ada
 *   di _changeInfo._items — baik gain MAUPUN cost!
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
    //  ITEM INVENTORY HELPERS — pola IDENTIK weapon-upgrade.js
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
        var state = MainServer.handlers.market;
        var currentItems = state._currentItems;

        log.info('HANDLER', 'market/buy processing');
        log.details('request', [['pos', pos], ['userId', String(userId)]]);

        // Validasi state
        if (!currentItems || !currentItems[pos]) {
            log.error('HANDLER', 'market/buy - state kosong atau pos invalid');
            callback({}, 1);
            return;
        }

        var item = currentItems[pos];

        if (item._haveBought) {
            log.warn('HANDLER', 'market/buy - sudah dibeli di pos ' + pos);
            callback({}, 1);
            return;
        }

        // Ekstrak goodId, goodNum, priceId, priceNum dari _goods._items & _price._items
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

        // ============================================================
        //  BACA & UPDATE savedData
        // ============================================================
        var key = 'user:' + userId;
        var savedData = db._get(key);

        if (!savedData) {
            log.error('HANDLER', 'market/buy - savedData tidak ditemukan: ' + key);
            callback({}, 1);
            return;
        }

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

        // Validasi saldo cukup
        if (currentPriceCount < priceNum) {
            log.warn('HANDLER', 'market/buy - saldo tidak cukup: have ' + currentPriceCount + ', need ' + priceNum);
            callback({}, 1);
            return;
        }

        // Hitung ABSOLUT TOTAL
        var newGoodTotal = currentGoodCount + goodNum;
        var newPriceTotal = currentPriceCount - priceNum;

        // Update savedData
        setItemNum(savedData, goodId, newGoodTotal);
        setItemNum(savedData, priceId, newPriceTotal);

        // Tandai sudah dibeli
        item._haveBought = true;

        // Simpan ke DB
        db._set(key, savedData);

        // ============================================================
        //  BUILD RESPONSE
        // ============================================================
        // FIX v4: KIRIM priceId JUGA di _changeInfo._items!
        // Client setItem = REPLACE → client cache sync dengan server
        // Tanpa ini, client cache menunjukkan gold/diamond tidak berkurang,
        // dan saat item dipakai → server response overwrite → RESET ke 0.
        var changeItems = {};
        changeItems[String(goodId)] = { _id: goodId, _num: newGoodTotal };
        changeItems[String(priceId)] = { _id: priceId, _num: newPriceTotal };

        var response = {
            _changeInfo: {
                _items: changeItems
            },
            _market: {
                _freeRefreshTimes: state._freeRefreshTimes !== undefined ? state._freeRefreshTimes : 5,
                _refreshTimesStartRecoverTime: state._refreshTimesStartRecoverTime || 0,
                _market: {
                    _items: currentItems
                }
            }
        };

        log.info('HANDLER', 'market/buy success');
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

    MainServer.registerHandler('market', 'buy', handleBuy);
    window.MainServer = MainServer;
})();