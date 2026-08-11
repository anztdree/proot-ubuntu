/**
 * handlers/trial/vipBuy.js — Temple Trial VipBuy Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS HANDLER INI:
 * ============================================================
 * 1. Validasi request (userId)
 * 2. Load savedData + trialState
 * 3. Validasi: _buyCount < templeTestTimesCanBuy (6)
 * 4. Lookup dungeonTimesBuy[_buyCount + 1] → cek VIP & harga
 * 5. Validasi: VIP level cukup
 * 6. Validasi: balance item 101 (diamond) >= harga
 * 7. Deduct item 101, tambah _haveTimes, increment _buyCount
 * 8. Save + response { _model, _changeInfo._items }
 *
 * ============================================================
 * YANG TIDAK DILAKUKAN:
 * ============================================================
 * - Tidak daily reset (sudah di getState/startBattle)
 * - Tidak advance quest/task
 * - Tidak build enemy team
 * - Tidak grant reward
 *
 * ============================================================
 * CLIENT CALL SITE (main.min.js L148631-148659):
 * ============================================================
 *
 *   addCountBtnTap():
 *     buyCount = templeTrialInfo._buyCount + 1
 *     config = dungeonTimesBuy[buyCount]
 *     if (!config || !config.templeTestCostID) → show tips
 *     UIWindowManager.buyTips(msg, vipNeeded, price, costId, confirmCb)
 *       → cek VIP & uang di client
 *       → confirmCb:
 *         ts.processHandler({
 *           type: "trial",
 *           action: "vipBuy",
 *           userId: ...,
 *           version: "1.0"
 *         }, function(t) {
 *           ItemsCommonSingleton.getInstance().resetTtemsCallBack(t)  ← _changeInfo._items
 *           TrialManager.getInstance().setTempleTrialInfo(t)          ← _model
 *           TrialManager.getInstance().setTempleBuyCount(a)           ← a = buyCount (client-side)
 *           e.showTrialCount()
 *         })
 *
 * ============================================================
 * RESPONSE FORMAT (WAJIB):
 * ============================================================
 * {
 *   _model: {
 *     _id: string,
 *     _haveTimes: number,          ← SUDAH ditambah 5
 *     _timesStartRecover: number,
 *     _lastLess: number,
 *     _lastTime: number,
 *     _buyFund: boolean,
 *     _haveGotFundReward: object
 *   },
 *   _changeInfo: {
 *     _items: {
 *       "101": { _id: 101, _num: <newBalance> }   ← diamond setelah dikurangi
 *     }
 *   }
 * }
 *
 * ============================================================
 * CONFIG YANG DI-LOAD:
 * ============================================================
 *   constant.json         ✅ templeTestTimesBuy (5), templeTestTimesCanBuy (6)
 *   dungeonTimesBuy.json  ✅ templeTestCostID, templeTestPrice, templeTestVIPNeeded
 * ============================================================
 *
 * ============================================================
 * STORAGE:
 * ============================================================
 *   DB key: ms_user_{userId}_1
 *   savedData.trialState._buyCount   ← increment
 *   savedData.trialState._haveTimes  ← +templeTestTimesBuy
 *   savedData.totalProps._items      ← deduct item 101
 *   VIP level = item 106 balance (PLAYERVIPLEVELID)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var DIAMOND_ID = 101;
    var VIP_LEVEL_ID = 106;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE & CONFIG LOADER
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJson(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
        } catch (e) {
            log.error('TRIAL_VIPBUY', 'Failed to load ' + name + '.json: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS
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
        if (!savedData.totalProps) {
            savedData.totalProps = { _items: [] };
        }
        if (!savedData.totalProps._items) {
            savedData.totalProps._items = [];
        }
        var items = savedData.totalProps._items;
        var found = false;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                found = true;
                break;
            }
        }
        if (!found) {
            items.push({ _id: itemId, _num: newBalance });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: trial/vipBuy
    // ═══════════════════════════════════════════════════════════

    function handleTrialVipBuy(request, callback) {
        var userId = request.userId;

        log.info('TRIAL_VIPBUY', 'Processing trial/vipBuy');
        log.details('TRIAL_VIPBUY', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        // ── STEP 1: Validate userId ──
        if (!userId) {
            log.warn('TRIAL_VIPBUY', 'Missing userId');
            callback({}, 1);
            return;
        }

        // ── STEP 2: Load savedData ──
        var storageKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('TRIAL_VIPBUY', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }

        // ── STEP 3: Ensure trialState exists ──
        if (!savedData.trialState) {
            log.warn('TRIAL_VIPBUY', 'trialState not found for userId=' + userId);
            callback({}, 1);
            return;
        }

        var ts = savedData.trialState;
        var buyIndex = (ts._buyCount || 0) + 1;

        // ── STEP 4: Load configs ──
        var constant = loadJson('constant');
        if (!constant || !constant[1]) {
            log.error('TRIAL_VIPBUY', 'constant.json not found');
            callback({}, 1);
            return;
        }

        var maxBuyCount = Number(constant[1].templeTestTimesCanBuy) || 6;
        var timesPerBuy = Number(constant[1].templeTestTimesBuy) || 5;

        var dungeonTimesBuy = loadJson('dungeonTimesBuy');
        if (!dungeonTimesBuy) {
            log.error('TRIAL_VIPBUY', 'dungeonTimesBuy.json not found');
            callback({}, 1);
            return;
        }

        // ── STEP 5: Validate buy count ──
        if (ts._buyCount >= maxBuyCount) {
            log.warn('TRIAL_VIPBUY', 'Buy limit reached: buyCount=' + ts._buyCount + ' max=' + maxBuyCount);
            callback({}, 1);
            return;
        }

        var buyConfig = dungeonTimesBuy[String(buyIndex)];
        if (!buyConfig || !buyConfig.templeTestCostID) {
            log.warn('TRIAL_VIPBUY', 'No buy config for index=' + buyIndex + ' (buyCount=' + ts._buyCount + ')');
            callback({}, 1);
            return;
        }

        var costItemId = Number(buyConfig.templeTestCostID);
        var price = Number(buyConfig.templeTestPrice) || 0;
        var vipNeeded = Number(buyConfig.templeTestVIPNeeded) || 0;

        log.details('TRIAL_VIPBUY', [
            ['buyIndex', String(buyIndex)],
            ['costItemId', String(costItemId)],
            ['price', String(price)],
            ['vipNeeded', String(vipNeeded)]
        ]);

        // ── STEP 6: Validate VIP level ──
        var userVipLevel = getItemBalance(savedData, VIP_LEVEL_ID) || 0;
        if (userVipLevel < vipNeeded) {
            log.warn('TRIAL_VIPBUY', 'VIP not enough: user=' + userVipLevel + ' needed=' + vipNeeded);
            callback({}, 1);
            return;
        }

        // ── STEP 7: Validate diamond balance ──
        var currentDiamond = getItemBalance(savedData, costItemId);
        if (currentDiamond < price) {
            log.warn('TRIAL_VIPBUY', 'Diamond not enough: have=' + currentDiamond + ' need=' + price);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  ALL VALIDATIONS PASSED — EXECUTE BUY
        // ═══════════════════════════════════════════════════════

        // Deduct diamond
        var newDiamond = currentDiamond - price;
        setItemBalance(savedData, costItemId, newDiamond);

        // Add times
        ts._haveTimes = (ts._haveTimes || 0) + timesPerBuy;

        // Increment buy count
        ts._buyCount = buyIndex;

        log.info('TRIAL_VIPBUY', 'Buy success userId=' + userId +
            ' buyIndex=' + buyIndex +
            ' price=' + price +
            ' diamond ' + currentDiamond + '->' + newDiamond +
            ' haveTimes+=' + timesPerBuy + ' -> ' + ts._haveTimes);

        // ── STEP 8: Save ──
        db._set(storageKey, savedData);

        // ── STEP 9: Build response ──
        var resp = {
            _model: {
                _id: ts._id || userId,
                _haveTimes: ts._haveTimes,
                _timesStartRecover: ts._timesStartRecover || 0,
                _lastLess: ts._lastLess || 0,
                _lastTime: ts._lastTime || 0,
                _buyFund: !!ts._buyFund,
                _haveGotFundReward: ts._haveGotFundReward || {}
            },
            _changeInfo: {
                _items: {}
            }
        };

        // Diamond balance (absolute) for resetTtemsCallBack
        resp._changeInfo._items[String(costItemId)] = {
            _id: costItemId,
            _num: newDiamond
        };

        callback(resp);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('trial', 'vipBuy', handleTrialVipBuy);

    window.MainServer = MainServer;
})();