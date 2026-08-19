/**
 * handlers/timeMachine/checkBattleResult.js — Time Machine Boss Battle Result Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  TUGAS & TANGGUNG JAWAB FILE INI:
 * ============================================================
 *
 *  Handler ini menangani HASIL boss battle setelah client selesai simulasi.
 *  Server menentukan WIN/LOSE dan memberikan battle rewards.
 *
 *  TUGAS UTAMA:
 *    1. VALIDASI request (userId, machineId, battleId)
 *    2. LOAD slot data dari DB → ambil level → resolve rewards
 *    3. ALWAYS WIN (server)
 *    4. RESOLVE rewards dari timeTravel[level].award1-4 → timeTravelAward.json
 *    5. UPDATE user item balances (totalProps._items)
 *    6. SAVE ke DB (shard update totalProps)
 *    7. RESPONSE: { _battleResult: 0, _changeInfo: { _items: { itemId: {_id, _num} } } }
 *
 *  TUGAS YANG BUKAN MILIK FILE INI:
 *    - Start time travel (itu tugas timeMachine/start)
 *    - Start boss battle (itu tugas timeMachine/startBoss)
 *    - Get reward / clear slot (itu tugas timeMachine/getReward)
 *    - Simulasi battle (client-side)
 *
 * ============================================================
 *  TRACE EVIDENCE (main.min.js):
 * ============================================================
 *
 *  CLIENT REQUEST — L64713-64722:
 *    ts.processHandler({
 *      type: "timeMachine",
 *      action: "checkBattleResult",
 *      userId: UserInfoSingleton.getInstance().userId,
 *      machineId: n,                          // 1|2|3
 *      battleId: UserInfoSingleton.getInstance().battleId,
 *      version: "1.0",
 *      "super": t,                           // super skills array
 *      checkResult: o,                       // battle result from client sim
 *      battleField: BattleLogic.GameFieldType.TIMETRAVEL
 *    }, callback)
 *
 *  CLIENT CALLBACK — L64723-64734:
 *    function(t) {
 *      var n = e.getBattleAwardItems(t),
 *          o = OpenGotoBattlePage.getBattleTypeWithResult(!0, !0, t._battleResult),
 *          r = { parent:"summary", endType:o, items:n, close:l,
 *                combatStatisticsTeam:a, superCombatStatisticsList:i };
 *      ViewCommon.setSummaryPage(o, r)
 *    }
 *
 *  getBattleAwardItems — L63394-63412:
 *    - Reads t._changeInfo._items
 *    - For each item: computes delta (newBalance - oldLocalBalance)
 *    - Returns object { itemId: deltaAmount, ... } for summary page
 *    - Also updates ItemsCommonSingleton local cache
 *
 *  openCongratulationObtain — L56636-56651:
 *    - Reads t._changeInfo._items
 *    - Updates ItemsCommonSingleton with new absolute balances
 *    - Opens item get tips popup
 *
 *  RESPONSE FORMAT:
 *    WIN: { _battleResult: 0, _changeInfo: { _items: { "itemId": {_id, _num}, ... } } }
 *         → _num = ABSOLUTE balance (not delta!)
 *    LOSE: { _battleResult: 1 }  (no _changeInfo)
 *
 *  timeTravel.json — 10 lessons:
 *    Setiap entry: award1, award2, award3, award4
 *    Contoh level 1: award1=1001, award2=1101, award3=1201, award4=1501
 *
 *  timeTravelAward.json:
 *    Object type: { id, name, goodsID1: 131, num1: 50, random: 1000 }
 *    Array type:  [{ id, name, goodsID1: 122, num1: 1, random: 1000 },
 *                  { id, name, goodsID1: 122, num1: 0, random: 9000 }]
 *    → Array type: weighted random roll based on "random" field
 *
 *  getMachineReward (UI preview — L150223-150234):
 *    t.push(ToolCommon.getPieceIdWithHeroId(heroDisplayId));
 *    for(r=1; 6>r; r++) {
 *      i = "award" + r;
 *      if(!o[i]) break;
 *      s = o[i];
 *      Array.isArray(a[s]) ? t.push(a[s][0].goodsID1) : t.push(a[s].goodsID1)
 *    }
 *    → This is just UI preview. ACTUAL rewards come from server handlers.
 *
 * ============================================================
 *  DAILY TASK TRACKING:
 * ============================================================
 *
 *  taskDaily.json ID 6122:
 *    { id:6122, type:"daily", taskType:"timeTravelEnd", taskPara1:2,
 *      levelNeeded:44, reward1:102, num1:10000, linkTo:"linkTimeTravel" }
 *    → Complete 2 time travels per day → 10000 gold reward
 *
 *  Task state storage: task:<userId>_2 (taskClass=2=DAILY)
 *    { "6122": { _state:1, _curCount:0 }, ... }
 *
 *  TASK_STATE: DEFAULT=0, DOING=1, COMPLETE=2, FINISH=3
 *
 *  queryTask.js reads from task:<userId>_2 → builds response with
 *  _id, _curCount, _targetCount, _state per task.
 *
 *  This handler increments _curCount on WIN and sets _state=2 when done.
 *
 * ============================================================
 *  ITEM BALANCE SYSTEM:
 * ============================================================
 *
 *  savedData.totalProps._items = [{_id, _num}, ...]  (ARRAY format in DB)
 *  Response _changeInfo._items = { "itemId": {_id, _num}, ... }  (OBJECT, ABSOLUTE)
 *
 *  getItemBalance(savedData, itemId) → current number
 *  setItemBalance(savedData, itemId, newBalance) → update in array
 *  addRewardItem(savedData, changeItems, itemId, amount) → add + record change
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ── Resource Loader (cached sync XHR — sama dengan dungeon/startBattle.js) ──

    var _resCache = {};

    function loadJson(name) {
        if (_resCache[name]) return _resCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resCache[name] = data;
                return data;
            }
            log.warn('TM_RESULT', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('TM_RESULT', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS
    // ═══════════════════════════════════════════════════════════
    //
    //  savedData.totalProps._items = [{_id, _num}, ...] (ARRAY)
    //  Response _changeInfo._items = { "itemId": {_id, _num}, ... } (OBJECT, ABSOLUTE)
    //

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
            items.push({ _id: Number(itemId), _num: newBalance });
        }
    }

    function addRewardItem(savedData, changeItems, itemId, amount) {
        if (!itemId || amount <= 0) return;
        itemId = Number(itemId);
        amount = Number(amount);

        var currentBalance = getItemBalance(savedData, itemId);
        var newBalance = currentBalance + amount;
        setItemBalance(savedData, itemId, newBalance);

        changeItems[String(itemId)] = {
            _id: itemId,
            _num: newBalance
        };

        log.details('TM_REWARD', [
            ['item', String(itemId)],
            ['amount', String(amount)],
            ['oldBalance', String(currentBalance)],
            ['newBalance', String(newBalance)]
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY TASK TRACKING
    // ═══════════════════════════════════════════════════════════
    //
    //  Daily task 6122: taskType="timeTravelEnd", taskPara1=2
    //  Storage: task:<userId>_2
    //  On WIN: increment _curCount, set _state=2 if >= target
    //

    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };
    var TASK_CLASS_DAILY = 2;
    var DAILY_TASK_ID = '6122';

    function processDailyTaskTimeTravelEnd(userId) {
        try {
            var taskKey = 'task:' + userId + '_' + TASK_CLASS_DAILY;
            var taskState = db._get(taskKey);
            if (!taskState || typeof taskState !== 'object') {
                taskState = {};
            }

            var entry = taskState[DAILY_TASK_ID];
            var curState = entry ? Number(entry._state) : TASK_STATE.DEFAULT;
            var curCount = entry ? Number(entry._curCount) || 0 : 0;

            // Already FINISH → skip
            if (curState === TASK_STATE.FINISH) {
                log.details('TM_TASK', ['dailyTask', '6122 already FINISH, skip']);
                return;
            }

            // Increment progress
            curCount++;
            var targetCount = 2;  // taskPara1=2

            if (curCount >= targetCount) {
                taskState[DAILY_TASK_ID] = {
                    _state: TASK_STATE.COMPLETE,
                    _curCount: curCount
                };
                log.info('TM_TASK', 'Daily task 6122 (timeTravelEnd) → COMPLETE (' + curCount + '/' + targetCount + ')');
            } else {
                taskState[DAILY_TASK_ID] = {
                    _state: TASK_STATE.DOING,
                    _curCount: curCount
                };
                log.info('TM_TASK', 'Daily task 6122 progress: ' + curCount + '/' + targetCount);
            }

            db._set(taskKey, taskState);
        } catch (taskErr) {
            log.warn('TM_TASK', 'Daily task error: ' + (taskErr.message || taskErr));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REWARD RESOLVER
    // ═══════════════════════════════════════════════════════════
    //
    //  timeTravel[level].award1-4 → timeTravelAward[awardId]
    //  Object type: { goodsID1, num1 } → direct add
    //  Array type:  [{ goodsID1, num1, random }, ...] → weighted roll
    //

    function resolveAward(awardId, awardConfig) {
        if (!awardConfig) return null;

        if (Array.isArray(awardConfig)) {
            // Weighted random roll
            var totalWeight = 0;
            for (var i = 0; i < awardConfig.length; i++) {
                totalWeight += Number(awardConfig[i].random) || 0;
            }
            if (totalWeight <= 0) return null;

            var roll = Math.random() * totalWeight;
            var cumulative = 0;
            for (var j = 0; j < awardConfig.length; j++) {
                cumulative += Number(awardConfig[j].random) || 0;
                if (roll < cumulative) {
                    return {
                        goodsID: Number(awardConfig[j].goodsID1),
                        num: Number(awardConfig[j].num1) || 0
                    };
                }
            }
            // Fallback: last entry
            var last = awardConfig[awardConfig.length - 1];
            return {
                goodsID: Number(last.goodsID1),
                num: Number(last.num1) || 0
            };
        }

        // Object type (direct)
        return {
            goodsID: Number(awardConfig.goodsID1),
            num: Number(awardConfig.num1) || 0
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('timeMachine', 'checkBattleResult', function (request, callback) {

        var userId     = request.userId || '';
        var machineId  = request.machineId;
        var battleId   = request.battleId;
        var version    = request.version;
        var checkResult = request.checkResult;
        var superSkills = request.super;

        // ═══════════════════════════════════════════════════════
        //  1. VALIDASI REQUEST
        // ═══════════════════════════════════════════════════════

        if (!userId) {
            log.warn('TM_RESULT', 'missing userId');
            callback({}, 1);
            return;
        }

        if (machineId === undefined || machineId === null) {
            log.warn('TM_RESULT', 'missing machineId');
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  2. LOAD USER DATA
        // ═══════════════════════════════════════════════════════

        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('TM_RESULT', 'user data not found: ' + storageKey);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  3. LOAD SLOT DATA → ambil level
        // ═══════════════════════════════════════════════════════

        var slotKey = String(machineId);
        var slotLevel = 0;

        if (savedData.timeMachine && savedData.timeMachine._items) {
            var slot = savedData.timeMachine._items[slotKey];
            if (slot && slot._level !== undefined) {
                slotLevel = Number(slot._level) || 0;
            }
        }

        if (slotLevel < 1 || slotLevel > 10) {
            log.warn('TM_RESULT', 'invalid slot level=' + slotLevel + ' for machineId=' + machineId);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  4. LOAD CONFIGS
        // ═══════════════════════════════════════════════════════

        var timeTravelConfig = loadJson('timeTravel');
        if (!timeTravelConfig || !timeTravelConfig[String(slotLevel)]) {
            log.warn('TM_RESULT', 'timeTravel config not found for level=' + slotLevel);
            callback({}, 1);
            return;
        }

        var travelEntry = timeTravelConfig[String(slotLevel)];
        var awardConfig = loadJson('timeTravelAward');
        if (!awardConfig) {
            log.warn('TM_RESULT', 'timeTravelAward.json not found');
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  5. AUTO WIN → ALWAYS WIN
        // ═══════════════════════════════════════════════════════

        var battleResult = 0;  // 0 = WIN
        var changeItems = {};

        // ═══════════════════════════════════════════════════════
        //  6. RESOLVE & GIVE REWARDS (award1-4)
        // ═══════════════════════════════════════════════════════

        for (var slot = 1; slot <= 5; slot++) {
            var awardKey = 'award' + slot;
            var awardId = travelEntry[awardKey];
            if (awardId === undefined || awardId === null) break;

            var awardEntry = awardConfig[String(awardId)];
            if (!awardEntry) {
                log.warn('TM_RESULT', 'award entry not found: ' + awardId);
                continue;
            }

            var resolved = resolveAward(awardId, awardEntry);
            if (resolved && resolved.goodsID && resolved.num > 0) {
                addRewardItem(savedData, changeItems, resolved.goodsID, resolved.num);
            }
        }

        // ═══════════════════════════════════════════════════════
        //  7. SAVE TO DB (shard update totalProps)
        // ═══════════════════════════════════════════════════════

        db._set(storageKey, savedData);

        // ═══════════════════════════════════════════════════════
        //  8. DAILY TASK — timeTravelEnd (ID 6122, need 2)
        // ═══════════════════════════════════════════════════════

        processDailyTaskTimeTravelEnd(userId);

        // ═══════════════════════════════════════════════════════
        //  9. RESPONSE
        // ═══════════════════════════════════════════════════════

        var response = {
            _battleResult: battleResult,
            _changeInfo: {
                _items: changeItems
            }
        };

        log.info('TM_RESULT', 'WIN userId=' + userId +
            ' machineId=' + machineId +
            ' level=' + slotLevel +
            ' battleId=' + (battleId || '-') +
            ' rewards=' + Object.keys(changeItems).length);

        log.details('TM_RESULT', [
            ['userId', userId],
            ['machineId', String(machineId)],
            ['slotLevel', String(slotLevel)],
            ['battleResult', String(battleResult)],
            ['battleId', battleId || '-'],
            ['checkResult', String(checkResult)],
            ['rewardCount', String(Object.keys(changeItems).length)]
        ]);

        callback(response);
    });

})();