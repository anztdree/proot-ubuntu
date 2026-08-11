/**
 * handlers/dungeon/buyCount.js
 *
 * Request:  { type:"dungeon", action:"buyCount", userId, dungeonType:Number, times?:Number, version:"1.0" }
 *   - times: optional, default 1 (multi-buy from panel sends it; single-buy tip does NOT)
 *   - dungeonType: DUNGEON_TYPE enum (1=EXP,2=EVOLVE,3=ENERGY,4=EQUIP,5=SINGA,6=SINGB,7=METAL,8=Z_STONE)
 *
 * Response: {
 *   times: <Number — delta purchased>,
 *   _changeInfo: { _items: { "101": { _id:101, _num:<ABSOLUTE_BALANCE_AFTER_DEDUCTION> } } }
 * }
 *
 * Error: callback({}, 1)
 *
 * ============================================================
 * ANALYSIS EVIDENCE:
 * ============================================================
 *
 * [CALL SITE 1] ChangeBuyTimesPanelViewData.prototype.counterpartBuyRequest (L150666):
 *   ts.processHandler({type:"dungeon",action:"buyCount", times:t, userId, dungeonType:e, version:"1.0"},
 *     function(t){
 *       n.callBack(t, e);  → ItemsCommonSingleton.resetTtemsCallBack(t), CounterpartSingleton.setBuyCallBack(e, t.times)
 *       var o = n.params.updateUI; o()
 *     })
 *   → Sends times in request (multi-buy panel)
 *
 * [CALL SITE 2] CounterpartBuyTips.prototype.buyRequest (L160911):
 *   ts.processHandler({type:"dungeon",action:"buyCount", userId, dungeonType:e, version:"1.0"},
 *     function(o){
 *       n.callBack(o, e);  → ItemsCommonSingleton.resetTtemsCallBack(o), CounterpartSingleton.setBuyCallBack(e, o.times)
 *       t()
 *     })
 *   → Does NOT send times (single-buy)
 *
 * [CALLBACK — resetTtemsCallBack]:
 *   function(e) {
 *     if (e._changeInfo) {
 *       var n = e._changeInfo._items;
 *       for (var o in n) t.setItem(n[o]._id, n[o]._num);  // ABSOLUTE value
 *       ts.refreshNodeResource();
 *     }
 *   }
 *
 * [CALLBACK — setBuyCallBack(dungeonType, response.times)]:
 *   e == DUNGEON_TYPE.EQUIP ? (n._equipmentBuyCount += t, n._equipmentTimer += t) :
 *   e == DUNGEON_TYPE.EVOLVE ? (n._evolveBuyCount += t, n._evolveTimer += t) :
 *   e == DUNGEON_TYPE.EXP ? (n._expBuyCount += t, n._expTimer += t) :
 *   e == DUNGEON_TYPE.SINGA || e == DUNGEON_TYPE.SINGB ? (n._signetBuyCount += t, n._signetTimer += t) :
 *   e == DUNGEON_TYPE.METAL ? (n._metalBuyCount += t, n._metalTimer += t) :
 *   e == DUNGEON_TYPE.Z_STONE && (n._zStoneBuyCount += t, n._zStoneTimer += t)
 *   → response.times is the DELTA (amount just purchased), added to both buyCount AND timer
 *
 * [DUNGEON_TYPE enum] (L59058):
 *   0=DT_NULL, 1=EXP, 2=EVOLVE, 3=ENERGY, 4=EQUIP, 5=SINGA, 6=SINGB, 7=METAL, 8=Z_STONE
 *
 * [COST CALCULATION — multi-buy panel] (L150608-150661):
 *   u = CounterpartSingleton.getInstance().equipmentBuyCount;  // current buy count
 *   v = ReadJsonSingleton.getInstance().dungeonTimesBuy;
 *   // Count VIP-eligible tiers:
 *   for(var d in v) if(v[d].equipDungeonVIPNeeded <= vipLevel) l++;
 *   curMaxCount = l - u;
 *   u = u + 1;  // START at buyCount + 1
 *   for(var g = 0; times > g; g++) totalCost += v[u].equipDungeonPrice, u++;
 *   → Tier index = buyCount + 1 + i (for i-th purchase in batch)
 *
 * [ENERGY dungeon] (L59050, L160866):
 *   setBuyCallBack: e == DUNGEON_TYPE.ENERGY || (...) — SKIPS energy (no buy support)
 *   CounterpartBuyTips: if(e == DUNGEON_TYPE.ENERGY); — empty, no cost display
 *   → Server should REJECT dungeonType == 3 (ENERGY)
 *
 * [dungeonTimesBuy.json] (12 entries, keys "1"-"12"):
 *   Each tier has per-dungeon-type fields:
 *     { expDungeonCostID, expDungeonPrice, expDungeonVIPNeeded,
 *       evolveDungeonCostID, evolveDungeonPrice, evolveDungeonVIPNeeded,
 *       energyDungeonCostID, energyDungeonPrice, energyDungeonVIPNeeded,
 *       metalDungeonCostID, metalDungeonPrice, metalDungeonVIPNeeded,
 *       zStoneDungeonCostID, zStoneDungeonPrice, zStoneDungeonVIPNeeded,
 *       equipDungeonCostID, equipDungeonPrice, equipDungeonVIPNeeded,
 *       signDungeonCostID, signDungeonPrice, signDungeonVIPNeeded }
 *   Tiers 11-12 only have signDungeon fields.
 *   All costID = 101 (diamonds).
 *   Prices increase at thresholds (30→60→90→120).
 *   VIP requirements increase per tier (0,0,1,2,3,4,5,6,7,8,9,10,11,12,...).
 *
 * [DATA STORAGE] (enterGame.js L1581-1582, L58006):
 *   savedData.scheduleInfo._dungeonBuyTimesCount[dungeonType] = cumulative buy count (reset daily)
 *   savedData.scheduleInfo._dungeonTimes[dungeonType] = remaining available times (base + bought - used)
 *   Both initialized as {} for new users.
 *   Client: setCounterPartBuyCount(e) → for-in e, set buyCount by dungeon type number
 *   Client: setCounterPartTime(e) → for-in e, set timer by dungeon type number
 *
 * [VIP LEVEL] (enterGame.js L234):
 *   VIP_LEVEL_ID = 106, stored in savedData.totalProps._items as { _id:106, _num:<vipLevel> }
 *   Client: UserInfoSingleton.getInstance().userVipLevel
 *
 * [ITEM STORAGE]:
 *   savedData.totalProps._items = [{_id, _num}, ...] (ARRAY)
 *
 * [TASK PROGRESS]:
 *   No task.json entries for dungeon buyCount. No quest processing needed.
 *
 * [CONFIG FIELD MAPPING — dungeonType → costID/price/vipNeeded]:
 *   1 (EXP)   → expDungeonCostID, expDungeonPrice, expDungeonVIPNeeded
 *   2 (EVOLVE) → evolveDungeonCostID, evolveDungeonPrice, evolveDungeonVIPNeeded
 *   4 (EQUIP)  → equipDungeonCostID, equipDungeonPrice, equipDungeonVIPNeeded
 *   5/6 (SIGN) → signDungeonCostID, signDungeonPrice, signDungeonVIPNeeded
 *   7 (METAL)  → metalDungeonCostID, metalDungeonPrice, metalDungeonVIPNeeded
 *   8 (Z_STONE)→ zStoneDungeonCostID, zStoneDungeonPrice, zStoneDungeonVIPNeeded
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.dungeon) {
        MainServer.handlers.dungeon = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var DUNGEON_TYPE = {
        DT_NULL: 0, EXP: 1, EVOLVE: 2, ENERGY: 3, EQUIP: 4,
        SINGA: 5, SINGB: 6, METAL: 7, Z_STONE: 8
    };

    var DIAMOND_ID = 101;
    var VIP_LEVEL_ID = 106;

    // Config field name mapping per dungeon type
    var COST_FIELDS = {};
    COST_FIELDS[DUNGEON_TYPE.EXP]    = { costID: 'expDungeonCostID',    price: 'expDungeonPrice',    vip: 'expDungeonVIPNeeded' };
    COST_FIELDS[DUNGEON_TYPE.EVOLVE] = { costID: 'evolveDungeonCostID', price: 'evolveDungeonPrice', vip: 'evolveDungeonVIPNeeded' };
    COST_FIELDS[DUNGEON_TYPE.EQUIP]  = { costID: 'equipDungeonCostID',  price: 'equipDungeonPrice',  vip: 'equipDungeonVIPNeeded' };
    COST_FIELDS[DUNGEON_TYPE.SINGA]  = { costID: 'signDungeonCostID',   price: 'signDungeonPrice',   vip: 'signDungeonVIPNeeded' };
    COST_FIELDS[DUNGEON_TYPE.SINGB]  = { costID: 'signDungeonCostID',   price: 'signDungeonPrice',   vip: 'signDungeonVIPNeeded' };
    COST_FIELDS[DUNGEON_TYPE.METAL]  = { costID: 'metalDungeonCostID',  price: 'metalDungeonPrice',  vip: 'metalDungeonVIPNeeded' };
    COST_FIELDS[DUNGEON_TYPE.Z_STONE]= { costID: 'zStoneDungeonCostID', price: 'zStoneDungeonPrice', vip: 'zStoneDungeonVIPNeeded' };

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    // ── Config loader (sync, cached) ──

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
            log.error('RESOURCE', 'dungeon/buyCount failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'dungeon/buyCount failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    // ── Item balance helpers (same pattern as other handlers) ──

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

    function handleBuyCount(request, callback) {
        var userId = request.userId;
        var dungeonType = Number(request.dungeonType);
        var times = request.times ? Number(request.times) : 1;

        log.info('HANDLER', 'dungeon/buyCount — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['dungeonType', dungeonType],
            ['times', String(times)],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'dungeon/buyCount — missing userId');
            callback({}, 1);
            return;
        }

        if (!dungeonType || dungeonType === DUNGEON_TYPE.DT_NULL) {
            log.error('HANDLER', 'dungeon/buyCount — invalid dungeonType: ' + dungeonType);
            callback({}, 1);
            return;
        }

        if (dungeonType === DUNGEON_TYPE.ENERGY) {
            log.error('HANDLER', 'dungeon/buyCount — ENERGY dungeon does not support buyCount');
            callback({}, 1);
            return;
        }

        if (!COST_FIELDS[dungeonType]) {
            log.error('HANDLER', 'dungeon/buyCount — unsupported dungeonType: ' + dungeonType);
            callback({}, 1);
            return;
        }

        if (times < 1) {
            log.error('HANDLER', 'dungeon/buyCount — times must be >= 1, got: ' + times);
            callback({}, 1);
            return;
        }

        // ── LOAD CONFIG ──
        var dungeonTimesBuyConfig = loadJson('dungeonTimesBuy');
        if (!dungeonTimesBuyConfig) {
            log.error('HANDLER', 'dungeon/buyCount — failed to load dungeonTimesBuy.json');
            callback({}, 1);
            return;
        }

        var fields = COST_FIELDS[dungeonType];

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HANDLER', 'dungeon/buyCount — user data not found: ' + key);
            callback({}, 1);
            return;
        }

        // ── GET VIP LEVEL ──
        var vipLevel = Number(getItemBalance(savedData, VIP_LEVEL_ID)) || 0;

        // ── GET CURRENT BUY COUNT ──
        if (!savedData.scheduleInfo) savedData.scheduleInfo = {};
        if (!savedData.scheduleInfo._dungeonBuyTimesCount) savedData.scheduleInfo._dungeonBuyTimesCount = {};
        if (!savedData.scheduleInfo._dungeonTimes) savedData.scheduleInfo._dungeonTimes = {};

        var currentBuyCount = Number(savedData.scheduleInfo._dungeonBuyTimesCount[dungeonType]) || 0;

        log.info('HANDLER', 'dungeon/buyCount — currentBuyCount=' + currentBuyCount + ', vipLevel=' + vipLevel + ', requested times=' + times);

        // ── CALCULATE COST FOR EACH PURCHASE ──
        // Tier index = buyCount + 1 + i  (matches client L150614: u = buyCount + 1)
        var totalCost = 0;
        var costItemId = DIAMOND_ID;
        var actualTimes = 0;

        for (var i = 0; i < times; i++) {
            var tierKey = String(currentBuyCount + 1 + i);
            var tierEntry = dungeonTimesBuyConfig[tierKey];

            if (!tierEntry) {
                // No more config entries — all tiers exhausted
                log.info('HANDLER', 'dungeon/buyCount — no more buy tiers at tier ' + tierKey);
                break;
            }

            var tierCostId = Number(tierEntry[fields.costID]) || 0;
            var tierPrice = Number(tierEntry[fields.price]) || 0;
            var tierVipNeeded = Number(tierEntry[fields.vip]) || 0;

            if (!tierCostId) {
                // This tier doesn't have cost data for this dungeon type
                // (e.g., tiers 11-12 only have signDungeon fields)
                log.info('HANDLER', 'dungeon/buyCount — tier ' + tierKey + ' has no cost data for dungeonType ' + dungeonType);
                break;
            }

            if (vipLevel < tierVipNeeded) {
                // VIP level too low for this tier
                log.info('HANDLER', 'dungeon/buyCount — VIP too low for tier ' + tierKey + ': need ' + tierVipNeeded + ', have ' + vipLevel);
                break;
            }

            costItemId = tierCostId;
            totalCost += tierPrice;
            actualTimes++;
        }

        if (actualTimes === 0) {
            log.error('HANDLER', 'dungeon/buyCount — cannot buy: no valid tiers available (VIP=' + vipLevel + ', buyCount=' + currentBuyCount + ')');
            callback({}, 1);
            return;
        }

        log.info('HANDLER', 'dungeon/buyCount — actualTimes=' + actualTimes + ', totalCost=' + totalCost + ' (item ' + costItemId + ')');

        // ── CHECK ITEM BALANCE ──
        var currentBalance = getItemBalance(savedData, costItemId);
        if (currentBalance < totalCost) {
            log.error('HANDLER', 'dungeon/buyCount — not enough items: have ' + currentBalance + ', need ' + totalCost + ' (item ' + costItemId + ')');
            callback({}, 1);
            return;
        }

        // ── DEDUCT COST ──
        var newBalance = currentBalance - totalCost;
        setItemBalance(savedData, costItemId, newBalance);

        // ── UPDATE DUNGEON DATA ──
        var newBuyCount = currentBuyCount + actualTimes;
        savedData.scheduleInfo._dungeonBuyTimesCount[dungeonType] = newBuyCount;

        // SINGA(5) and SINGB(6) share buyCount/timer on client side.
        // Client setCounterPartBuyCount/setCounterPartTime: for-in loop,
        //   (Number(n)==5 || Number(n)==6) → last key wins.
        // Must store under BOTH keys with same value to be safe.
        if (dungeonType === DUNGEON_TYPE.SINGA) {
            savedData.scheduleInfo._dungeonBuyTimesCount[DUNGEON_TYPE.SINGB] = newBuyCount;
        } else if (dungeonType === DUNGEON_TYPE.SINGB) {
            savedData.scheduleInfo._dungeonBuyTimesCount[DUNGEON_TYPE.SINGA] = newBuyCount;
        }

        var currentTimer = Number(savedData.scheduleInfo._dungeonTimes[dungeonType]) || 0;
        var newTimer = currentTimer + actualTimes;
        savedData.scheduleInfo._dungeonTimes[dungeonType] = newTimer;

        if (dungeonType === DUNGEON_TYPE.SINGA) {
            savedData.scheduleInfo._dungeonTimes[DUNGEON_TYPE.SINGB] = newTimer;
        } else if (dungeonType === DUNGEON_TYPE.SINGB) {
            savedData.scheduleInfo._dungeonTimes[DUNGEON_TYPE.SINGA] = newTimer;
        }

        log.info('HANDLER', 'dungeon/buyCount — buyCount ' + currentBuyCount + ' → ' + newBuyCount + ', timer ' + currentTimer + ' → ' + newTimer);

        // ── SAVE USER DATA ──
        db._set(key, savedData);
        log.info('HANDLER', 'dungeon/buyCount — user data saved.');

        // ── BUILD RESPONSE ──
        var response = {
            times: actualTimes,
            _changeInfo: {
                _items: {}
            }
        };

        // _changeInfo._items: ABSOLUTE balance after deduction
        response._changeInfo._items[String(costItemId)] = {
            _id: costItemId,
            _num: newBalance
        };

        log.details('response', [
            ['times', String(actualTimes)],
            ['_changeInfo._items', JSON.stringify(response._changeInfo._items)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('dungeon', 'buyCount', handleBuyCount);

})();