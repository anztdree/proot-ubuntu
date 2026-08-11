/**
 * handlers/monthCard/getReward.js
 *
 * Request:  { type:"monthCard", action:"getReward", userId, cardType:1-4, version:"1.0" }
 * Response: { _changeInfo: { _items: { "itemId": { _id, _num: ABSOLUTE_BALANCE } } } }
 *
 * ============================================================
 * ANALYSIS EVIDENCE:
 * ============================================================
 *
 * [CALL SITE] L155774-155787:
 *   clickReceiveAward(cardType) → processHandler({type:"monthCard",action:"getReward",userId,cardType,version:"1.0"}, cb)
 *   Success cb:
 *     1. UIWindowManager.openCongratulationObtain(n)   ← reads n._changeInfo._items
 *     2. WelfareInfoManager.changeMonthCardHaveGotReward(e)  ← sets _monthCardHaveGotReward[cardType]=true
 *     3. t.myData.executeUpdataUIFunc()                 ← refresh UI
 *     4. t.initMonthCard()                             ← re-init card display
 *   Error cb: Logger.serverDebugLog("领取月卡钻石失败！！！")
 *
 * [openCongratulationObtain] L56636-56651:
 *   Reads t._changeInfo._items → OBJECT keyed by STRING item ID, each {_id, _num: ABSOLUTE}
 *   saveGainWithOutItems(t) — no _addHeroes needed (daily rewards are items only)
 *
 * [changeMonthCardHaveGotReward] (WelfareInfoManager):
 *   this._monthCardHaveGotReward[e] = true
 *
 * [getMonthCardHaveGotReward] — used by UI to enable/disable claim button:
 *   L155654: var d = WelfareInfoManager.getInstance().getMonthCardHaveGotReward(MONTH_CARD_TYPE.SHORT);
 *   L155655: ToolCommon.anyIsEnableOrNotColor(!d, e.receiveAwardBtn1)
 *   → If !d (not claimed today), button is enabled.
 *
 * [UI BUTTONS per card] L155768-155773:
 *   receiveAwardBtn1 → SHORT (1)
 *   receiveAwardBtn2 → EVO_MONTHCARD (4)
 *   receiveAwardBtn3 → NO_LIMIT (3)
 *   LONG (2) has NO receive button in UI.
 *
 * [monthCard.json DAILY REWARDS (award1ID/num1)]:
 *   Card 1 (SHORT):       award1ID=101 (diamond), num1=100
 *   Card 2 (LONG):        award1ID=101 (diamond), num1=300  ← no UI button, but handler accepts
 *   Card 3 (NO_LIMIT):    award1ID=101 (diamond), num1=200
 *   Card 4 (EVO_MONTHCARD): award1ID=499 (usable),  num1=1
 *
 *   ⚠️ NO heroes in daily rewards. All are regular items → _changeInfo._items only.
 *   ⚠️ Only award1ID/num1 exists for daily. No award2 for daily.
 *
 * [Card active check — same logic as buyCard]:
 *   MonthCardPanel L155648-155656:
 *     if(o._card[a.id]) { var c = o._card[a.id]._endTime; if(c > u) { active } }
 *   → Card must have _endTime > now to claim daily reward.
 *
 * [SERVER-SIDE DAILY CLAIM TRACKING]:
 *   _monthCardHaveGotReward is CLIENT-SIDE only (AllRefreshCount, reset on enterGame).
 *   Server needs its own tracking. Using savedData.monthCard._dailyClaim:
 *     { "1": "2026-06-19", "3": "2026-06-19", ... }
 *   If _dailyClaim[cardType] === today's date string → already claimed → reject.
 *   Otherwise → give reward → set _dailyClaim[cardType] = today.
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.monthCard) {
        MainServer.handlers.monthCard = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var VALID_CARD_TYPES = [1, 2, 3, 4];

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    /**
     * Get today's date string in UTC (YYYY-MM-DD).
     * Used for daily claim tracking — same calendar day = already claimed.
     */
    function getTodayStr() {
        var d = new Date();
        var yyyy = d.getUTCFullYear();
        var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(d.getUTCDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _cache[name] = data;
                return data;
            }
            log.error('RESOURCE', 'monthCard/getReward failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'monthCard/getReward failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getMonthCardConfig(cardType) {
        var data = loadJson('monthCard');
        return data ? data[String(cardType)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  USER DATA HELPERS
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

    function addItems(savedData, itemId, amount) {
        var old = getItemBalance(savedData, itemId);
        var newVal = old + amount;
        setItemBalance(savedData, itemId, newVal);
        return newVal;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetReward(request, callback) {
        var userId = request.userId;
        var cardType = Number(request.cardType);

        log.info('HANDLER', 'monthCard/getReward — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['cardType', String(cardType)],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'monthCard/getReward — missing userId');
            callback({}, 1);
            return;
        }
        if (VALID_CARD_TYPES.indexOf(cardType) === -1) {
            log.error('HANDLER', 'monthCard/getReward — invalid cardType: ' + cardType);
            callback({}, 1);
            return;
        }

        // ── LOAD CONFIG ──
        var cardConfig = getMonthCardConfig(cardType);
        if (!cardConfig) {
            log.error('HANDLER', 'monthCard/getReward — cardType ' + cardType + ' not found in monthCard.json');
            callback({}, 1);
            return;
        }

        var awardID = Number(cardConfig.award1ID) || 0;
        var awardNum = Number(cardConfig.num1) || 0;

        log.details('DAILY_REWARD', [
            ['cardType', String(cardType)],
            ['awardID', String(awardID)],
            ['awardNum', String(awardNum)]
        ]);

        if (awardID <= 0 || awardNum <= 0) {
            log.error('HANDLER', 'monthCard/getReward — no daily reward configured for card ' + cardType);
            callback({}, 1);
            return;
        }

        // ── LOAD USER DATA ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.error('HANDLER', 'monthCard/getReward — user data not found: ' + storageKey);
            callback({}, 1);
            return;
        }

        // ── CHECK CARD IS ACTIVE (endTime > now) ──
        var now = Date.now();
        if (!savedData.monthCard || !savedData.monthCard._card) {
            log.warn('HANDLER', 'monthCard/getReward — no monthCard data, card ' + cardType + ' never purchased');
            callback({}, 1);
            return;
        }

        var cardData = savedData.monthCard._card[String(cardType)];
        if (!cardData || !cardData._endTime || cardData._endTime <= now) {
            log.warn('HANDLER', 'monthCard/getReward — card ' + cardType + ' not active (endTime=' +
                (cardData ? cardData._endTime : 'none') + ', now=' + now + ')');
            callback({}, 1);
            return;
        }

        // ── CHECK DAILY CLAIM (server-side tracking) ──
        if (!savedData.monthCard._dailyClaim) {
            savedData.monthCard._dailyClaim = {};
        }

        var todayStr = getTodayStr();
        var lastClaimDate = savedData.monthCard._dailyClaim[String(cardType)];

        if (lastClaimDate === todayStr) {
            log.warn('HANDLER', 'monthCard/getReward — already claimed today for card ' + cardType +
                ' (lastClaim=' + lastClaimDate + ', today=' + todayStr + ')');
            callback({}, 1);
            return;
        }

        // ══════════════════════════════════════════════════════════
        //  PROCESS DAILY REWARD
        // ============================================================
        // All daily rewards are regular items (no heroes).
        // Card 1: 101 (diamond) x100
        // Card 2: 101 (diamond) x300
        // Card 3: 101 (diamond) x200
        // Card 4: 499 (usable)  x1
        // ============================================================

        var newBalance = addItems(savedData, awardID, awardNum);

        log.info('REWARD', 'Daily reward: item ' + awardID + ' +' + awardNum + ' → total=' + newBalance);

        // ── MARK AS CLAIMED TODAY ──
        savedData.monthCard._dailyClaim[String(cardType)] = todayStr;

        // ── SAVE USER DATA ──
        db._set(storageKey, savedData);
        log.info('DB', 'User data saved');

        // ══════════════════════════════════════════════════════════
        //  BUILD RESPONSE
        // ============================================================
        // Client (L155783-155784):
        //   UIWindowManager.openCongratulationObtain(n)
        //   → reads n._changeInfo._items → OBJECT keyed by STRING itemId
        //   → each {_id, _num: ABSOLUTE_BALANCE}
        // ============================================================

        var response = {
            _changeInfo: {
                _items: {}
            }
        };
        response._changeInfo._items[String(awardID)] = { _id: awardID, _num: newBalance };

        log.info('HANDLER', 'monthCard/getReward — SUCCESS');
        log.details('response', [
            ['awardID', String(awardID)],
            ['awardNum', String(awardNum)],
            ['newBalance', String(newBalance)],
            ['cardType', String(cardType)],
            ['today', todayStr],
            ['endTime', String(cardData._endTime)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('monthCard', 'getReward', handleGetReward);

    window.MainServer = MainServer;
})();