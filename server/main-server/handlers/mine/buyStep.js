/**
 * buyStep.js — Mine Buy Step (Action Point) Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS (1 file, 1 action):
 *   Request:  { type:"mine", action:"buyStep", userId, version:"1.0" }
 *   Response: { _leftStep, _stepRecoverTime, _mineBuyStepCount,
 *               _changeInfo: { _items: { [itemId]: { _id, _num } } } }
 *
 *   1. Lookup mineActionBuy.json[BuyStepCount + 1] → cost & VIP
 *   2. Validasi VIP level & cukup currency
 *   3. Deduct cost, tambah AP (mineActionPointTimesBuy = 10)
 *   4. Increment _mineBuyStepCount
 *   5. Sync timesInfo, simpan, return response
 *
 *   Client L105813 successCb:
 *     BuyStepCount += 1
 *     changeLeftStep(t._leftStep)
 *     changeStepRecoverTime(t._stepRecoverTime)
 *     resetTtemsCallBack(t)  → setItem dari _changeInfo._items (ABSOLUTE)
 *     initTheWildAdventureUI()
 * ============================================================
 *
 * EVIDENCE DARI main.min(unminfy).js:
 *
 *   [PEMANGGILAN] L105795-105819 addcountBtnTap():
 *     var o = TheWildAdventureManager.getInstance().BuyStepCount + 1;
 *     var a = mineActionBuy[o];   ← key = BuyStepCount + 1 (1-based, bukan 0-based)
 *     if (!a) → "tidak bisa beli lagi" tip
 *
 *     buyTips(text, vipNeeded, price, costID, confirmCb):
 *       confirmCb = function() {
 *         ts.processHandler({
 *           type:"mine", action:"buyStep", userId, version:"1.0"
 *         }, successCb, failCb)
 *       }
 *
 *     Request TIDAK mengirim info tier/price — server tentukan sendiri
 *     dari _mineBuyStepCount yang tersimpan.
 *
 *   [SUCCESS CALLBACK] L105813:
 *     BuyStepCount += 1                    ← client increment SENDIRI
 *     changeLeftStep(t._leftStep)          ← dari response
 *     changeStepRecoverTime(t._stepRecoverTime) ← dari response
 *     resetTtemsCallBack(t)                ← baca t._changeInfo._items (ABSOLUTE)
 *     initTheWildAdventureUI()             ← refresh UI
 *
 *   [ENTERGAME INIT] L58006:
 *     void 0 != e._mineBuyStepCount && (BuyStepCount = e._mineBuyStepCount)
 *     → Client constructor: this._buyStepCount = 0
 *     → Di-reset oleh enterGame response.
 *     → PERTANYAAN: apakah daily reset? Lihat di bawah.
 *
 *   [mineActionBuy.json]:
 *     14 tier (key "1"-"14"), SEMUA:
 *       mineActionBuyCostID: 101 (diamonds)
 *       mineActionBuyPrice: 20
 *       vipNeeded: 1,3,4,5,6,7,9,11,13,14,15,16,17,18
 *     Key = BuyStepCount + 1 (sama pola mineRestartBuy.json)
 *
 *   [constant.json[1]]:
 *     mineActionPointTimesBuy: 10  → jumlah AP per beli
 *     mineActionPointMax: 50        → AP cap
 *
 *   [AP LOGIC]:
 *     effectiveAP = min(leftStep + recovered, 50)
 *     newLeftStep = min(effectiveAP + 10, 50)
 *     Reset stepRecoverTime ke now → hindari double-count recovery
 *
 *   [_mineBuyStepCount STORAGE]:
 *     savedData.scheduleInfo._mineBuyStepCount (BUKAN top-level!)
 *     Client L58006: initData(e) where e = scheduleInfo → reads e._mineBuyStepCount
 *     enterGame L1792: daily reset → scheduleInfo = buildDefaultScheduleInfo() → _mineBuyStepCount: 0
 *     Server TIDAK reset di sini (enterGame handle reset via scheduleInfo rebuild).
 *
 *   [VIP LEVEL ITEM ID]:
 *     Client L78642: PLAYERVIPLEVELID = 106
 *     Client L62394: userVipLevel getter = getItemNum(PLAYERVIPLEVELID)
 *     BUKAN 105 (itu PLAYERVIPEXPERIENCEID).
 *
 *   [COST DEDUCTION PATTERN] dari shop/buy.js:
 *     getItemBalance / setItemBalance → savedData.totalProps._items[]
 *     Response _changeInfo._items = ABSOLUTE balance, key = String(itemId)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  JSON LOADING
    // ═══════════════════════════════════════════════════════════

    var _jsonCache = {};

    function loadJson(name) {
        if (_jsonCache[name]) return _jsonCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _jsonCache[name] = data;
                return data;
            }
            log.error('MINE', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('MINE', 'loadJson ' + name + ': ' + e.message);
        }
        return null;
    }

    var constantJson = loadJson('constant');
    var mineActionBuyJson = loadJson('mineActionBuy');

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var MAX_STEPS = (constantJson && constantJson['1'])
        ? Number(constantJson['1'].mineActionPointMax) : 50;

    var REFRESH_SEC = (constantJson && constantJson['1'])
        ? Number(constantJson['1'].mineActionPointRefreshTime) : 1800;

    var REFRESH_MS = REFRESH_SEC * 1000;

    var STEPS_PER_BUY = (constantJson && constantJson['1'])
        ? Number(constantJson['1'].mineActionPointTimesBuy) : 10;

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS (sama dengan shop/buy.js)
    // ═══════════════════════════════════════════════════════════

    function getItemBalance(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                return;
            }
        }
        items.push({ _id: Number(itemId), _num: newBalance });
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(data, callback) {
        var userId = data.userId;

        if (!userId) {
            log.error('MINE', 'buyStep — missing userId');
            callback({}, 1);
            return;
        }

        // ── 1. LOAD USER DATA ──
        var savedData = db._get('ms_user_' + userId + '_1');
        if (!savedData) {
            log.error('MINE', 'buyStep — no user data for ' + userId);
            callback({}, 1);
            return;
        }

        var model = savedData._mineModel;
        if (!model) {
            log.error('MINE', 'buyStep — no mineModel for ' + userId);
            callback({}, 1);
            return;
        }

        // ── 2. LOOKUP TIER CONFIG ──
        // Client L105799: key = BuyStepCount + 1 (1-based next tier)
        // BACA dari scheduleInfo — client L58006 baca dari scheduleInfo object
        var buyStepCount = (savedData.scheduleInfo && savedData.scheduleInfo._mineBuyStepCount !== undefined)
            ? Number(savedData.scheduleInfo._mineBuyStepCount) : 0;
        var tierKey = String(buyStepCount + 1);
        var tierConfig = mineActionBuyJson ? mineActionBuyJson[tierKey] : null;

        if (!tierConfig) {
            log.warn('MINE', 'buyStep — no buy config for tier ' + tierKey +
                ' user=' + userId + ' (max purchases reached)');
            callback({}, 1);
            return;
        }

        var costID = Number(tierConfig.mineActionBuyCostID);
        var price = Number(tierConfig.mineActionBuyPrice);
        var vipNeeded = Number(tierConfig.vipNeeded);

        // ── 3. VALIDASI VIP LEVEL ──
        // Client buyTips sudah cek VIP sebelum kirim request,
        // tapi server HARUS validasi juga (anti-cheat).
        var playerVipLevel = 0;
        if (savedData.totalProps && savedData.totalProps._items) {
            var items = savedData.totalProps._items;
            for (var v = 0; v < items.length; v++) {
                if (Number(items[v]._id) === 106) { // PLAYERVIPLEVELID (L78642)
                    playerVipLevel = Number(items[v]._num) || 0;
                    break;
                }
            }
        }

        if (playerVipLevel < vipNeeded) {
            log.warn('MINE', 'buyStep — VIP too low. vip=' + playerVipLevel +
                ' needed=' + vipNeeded + ' user=' + userId);
            callback({}, 1);
            return;
        }

        // ── 4. VALIDASI & DEDUCT COST ──
        var currentBalance = getItemBalance(savedData, costID);
        if (currentBalance < price) {
            log.warn('MINE', 'buyStep — not enough currency. item=' + costID +
                ' have=' + currentBalance + ' need=' + price + ' user=' + userId);
            callback({}, 1);
            return;
        }

        var newBalance = currentBalance - price;
        setItemBalance(savedData, costID, newBalance);

        // Build _changeInfo dengan ABSOLUTE balance
        var changeItems = {};
        changeItems[String(costID)] = { _id: costID, _num: newBalance };

        // ── 5. HITUNG & TAMBAH AP ──
        var now = Date.now();
        var elapsed = Math.max(now - model._stepRecoverTime, 0);
        var recovered = Math.floor(elapsed / REFRESH_MS);
        var effectiveAP = Math.min(model._leftStep + recovered, MAX_STEPS);

        // Tambah AP, cap di MAX_STEPS
        model._leftStep = Math.min(effectiveAP + STEPS_PER_BUY, MAX_STEPS);
        model._stepRecoverTime = now;

        // ── 6. INCREMENT BUY COUNT ──
        buyStepCount += 1;
        // SIMPAN ke scheduleInfo — BUKAN top-level!
        // Client L58006 baca dari initData(e) where e = scheduleInfo.
        // enterGame L1792 daily reset rebuild scheduleInfo → otomatis reset ke 0.
        if (!savedData.scheduleInfo) savedData.scheduleInfo = {};
        savedData.scheduleInfo._mineBuyStepCount = buyStepCount;

        // ── 7. SIMPAN ──
        savedData._mineModel = model;

        // Sync timesInfo
        if (!savedData.timesInfo) savedData.timesInfo = {};
        savedData.timesInfo.mineSteps = model._leftStep;
        savedData.timesInfo.mineStepsRecover = model._stepRecoverTime;

        db._set('ms_user_' + userId + '_1', savedData);

        // ── 8. LOG ──
        log.details('MINE', [
            ['action', 'buyStep'],
            ['userId', userId],
            ['tier', tierKey + '/' + '14'],
            ['cost', 'item=' + costID + ' x' + price + ' → balance=' + newBalance],
            ['AP', model._leftStep + '/' + MAX_STEPS + ' (+' + STEPS_PER_BUY + ')'],
            ['buyStepCount', String(buyStepCount)]
        ]);

        // ── 9. RESPONSE ──
        // Client L105813:
        //   changeLeftStep(t._leftStep)
        //   changeStepRecoverTime(t._stepRecoverTime)
        //   resetTtemsCallBack(t) → _changeInfo._items (ABSOLUTE)
        callback({
            _leftStep: model._leftStep,
            _stepRecoverTime: model._stepRecoverTime,
            _mineBuyStepCount: buyStepCount,
            _changeInfo: { _items: changeItems }
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('mine', 'buyStep', handle);
})();