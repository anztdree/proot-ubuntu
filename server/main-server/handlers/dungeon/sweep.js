/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: dungeon/sweep
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TUGAS UTAMA
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Menyediakan mekanisme "sweep" (扫荡) untuk dungeon yang sudah di-clear.
 *  Sweep memberikan reward SAMA seperti menang battle, TANPA pertempuran.
 *  Tidak meng-advance dungeon level — hanya mengonsumsi times dan memberi reward.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  CLIENT CALL SITE (1 total)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  BattleCallBack.dungeonSweep (L63553):
 *    var n = CounterpartSingleton.getInstance().getCounterPartBuyCount(e),
 *        a = constant[1].vipDungeonSweepNeeded,  // = 9
 *        r = UserInfoSingleton.getInstance().userVipLevel,
 *        i = r >= a ? n : 1;
 *    ts.processHandler({
 *        type: "dungeon", action: "sweep",
 *        times: i,
 *        userId: ...,
 *        dungeonType: e,
 *        dungeonLevel: t
 *    }, function(t) {
 *        UIWindowManager.openCongratulationObtain(t);
 *        n.setHaveTimes(e, t.times);   // subtracts t.times from local timer
 *    });
 *
 *  Triggered by 3 auto-sweep sites:
 *    - equipmentBattle (L63517): if maxLevel >= selectedLevel → sweep
 *    - resourceBattle (L63625): if maxLevel >= selectedLevel → sweep
 *    - signetBattle (L63704): if maxLevel >= selectedLevel → sweep
 *
 *  ══════════════════════════════════════════════════════════════════
 *  REQUEST FORMAT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  {
 *      type: "dungeon",
 *      action: "sweep",
 *      times: <int>,           // 1 for VIP<9, remaining times for VIP>=9
 *      userId: <string>,
 *      dungeonType: <int>,     // DUNGEON_TYPE enum (1-8, not 3/ENERGY)
 *      dungeonLevel: <int>     // level to sweep (must be <= max cleared)
 *  }
 *
 *  ══════════════════════════════════════════════════════════════════
 *  RESPONSE FORMAT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  {
 *      times: <int>,                    // swept count (= request.times)
 *      _changeInfo: {
 *          _items: { "itemId": {_id, _num}, ... }  // ABSOLUTE balances (OBJECT)
 *      },
 *      _addHeroes: [],                  // hero drops (empty for dungeons)
 *      _addSigns: [],                   // sign drops (SINGA only — full signs persisted to DB)
 *                                      // SINGB pieces go via _changeInfo._items
 *      _addWeapons: [],                 // weapon drops (EQUIP only)
 *      _addStones: [],                  // gemstone drops (empty)
 *      _addGenkis: []                   // genki drops (empty)
 *  }
 *
 *  ══════════════════════════════════════════════════════════════════
 *  KEY BEHAVIORS
 *  ══════════════════════════════════════════════════════════════════
 *
 *  - response.times = swept count (NOT remaining). Client subtracts this
 *    from local timer via battleCallBackSetTime(type, response.times).
 *  - Server decrements scheduleInfo._dungeonTimes[dungeonType] by swept count.
 *  - Server does NOT advance dungeon level.
 *  - Rewards per sweep iteration = same as checkBattleResult WIN:
 *      award1-num1 ... award5-num5 from dungeon config
 *      + random equip roll (EQUIP only)
 *      + random sign roll (SINGA only — full sign, persisted to imprint._items)
 *      + random signPiece roll (SINGB only — fragment, via _changeInfo._items)
 *  - EXP reward triggers level-up computation after all iterations.
 *  - Task processing: experienceDungeonVictory, breachDungeonVictory (main tasks)
 *    + daily task progress (same as startBattle).
 *
 *  ══════════════════════════════════════════════════════════════════
 *  ERROR CODES (from errorDefine.json)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  22009: ERROR_DUNGEON_SWEEP_LEVEL_NOT_PASSED ("关卡未通关，无法扫荡")
 *  22010: ERROR_DUNGEON_TIMES_MAX
 *
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADER
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
            log.error('DUNGEON_SWEEP', 'Failed to load ' + name + '.json: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var DUNGEON_TYPE = {
        NULL: 0, EXP: 1, EVOLVE: 2, ENERGY: 3, EQUIP: 4,
        SINGA: 5, SINGB: 6, METAL: 7, Z_STONE: 8
    };

    var DUNGEON_TYPE_NAMES = {
        1: 'EXP', 2: 'EVOLVE', 3: 'ENERGY', 4: 'EQUIP',
        5: 'SINGA', 6: 'SINGB', 7: 'METAL', 8: 'Z_STONE'
    };

    var DUNGEON_JSON_MAP = {
        1: 'expDungeon',
        2: 'evolveDungeon',
        3: 'energyDungeon',
        4: 'equipDungeon',
        5: 'signDungeonA',
        6: 'signDungeonB',
        7: 'metalDungeon',
        8: 'zStoneDungeon'
    };

    var DEFAULT_DUNGEON_TIMES = {
        1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2
    };

    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };

    // Daily task type mapping (same as startBattle)
    var DUNGEON_TO_DAILY_TASK = {
        1: 'resourceDungeon',
        2: 'resourceDungeon',
        4: 'equipDungeon',
        5: 'signDungeon',
        6: 'signDungeon',
        7: 'resourceDungeon',
        8: 'resourceDungeon'
    };

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
        if (!savedData.totalProps) savedData.totalProps = { _items: [] };
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        var found = false;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                found = true;
                break;
            }
        }
        if (!found) items.push({ _id: itemId, _num: newBalance });
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Compute level-up from EXP
    // ═══════════════════════════════════════════════════════════

    function computeLevelUp(savedData) {
        var curLevel = getItemBalance(savedData, 104) || 1;
        var totalExp = getItemBalance(savedData, 103) || 0;
        var upgradeTable = loadJson('userUpgrade');
        var maxLevel = 300;
        if (upgradeTable && totalExp > 0 && curLevel < maxLevel) {
            var oldLevel = curLevel;
            while (curLevel < maxLevel) {
                var entry = upgradeTable[String(curLevel)];
                if (!entry) break;
                var needed = Number(entry.expNeeded) || 0;
                if (needed <= 0 || totalExp < needed) break;
                totalExp -= needed;
                curLevel++;
            }
            if (curLevel > oldLevel) {
                setItemBalance(savedData, 103, totalExp);
                setItemBalance(savedData, 104, curLevel);
                log.info('DUNGEON_SWEEP', 'PLAYER LEVEL ' + oldLevel + ' -> ' + curLevel);
            }
        }
        return curLevel;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Add reward item to changeItems (ADDITIVE amount)
    // ═══════════════════════════════════════════════════════════

    function addRewardToChange(changeItems, itemId, amount) {
        if (!itemId || amount <= 0) return;
        itemId = Number(itemId);
        amount = Number(amount);
        if (!changeItems[String(itemId)]) {
            changeItems[String(itemId)] = { _id: itemId, _num: 0 };
        }
        changeItems[String(itemId)]._num += amount;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Random equip drop
    // ═══════════════════════════════════════════════════════════

    function rollRandomEquip(levelCfg) {
        var poolId = levelCfg.awardPool || levelCfg.awardID;
        if (!poolId) return null;
        var awardPoolCfg = loadJson('equipDungeonAward');
        if (!awardPoolCfg) return null;
        var pool = awardPoolCfg[String(poolId)];
        if (!pool || !Array.isArray(pool) || pool.length === 0) return null;

        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) totalWeight += Number(pool[i].random) || 0;
        if (totalWeight <= 0) return null;

        var roll = Math.random() * totalWeight;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += Number(pool[j].random) || 0;
            if (roll < cumulative) return Number(pool[j].award);
        }
        return Number(pool[pool.length - 1].award);
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Random sign drop
    // ═══════════════════════════════════════════════════════════

    function rollRandomSign(dungeonType, levelCfg) {
        var awardID = levelCfg.awardID;
        if (!awardID) return null;

        var awardPool, poolKey;
        if (dungeonType === DUNGEON_TYPE.SINGA) {
            awardPool = loadJson('signDungeonAward');
            poolKey = String(awardID);
        } else if (dungeonType === DUNGEON_TYPE.SINGB) {
            awardPool = loadJson('signDungeonAwardB');
            poolKey = String(levelCfg.id || 1);
        } else {
            return null;
        }

        if (!awardPool) return null;
        var pool = awardPool[poolKey];
        if (!pool || !Array.isArray(pool) || pool.length === 0) return null;

        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) totalWeight += Number(pool[i].random) || 0;
        if (totalWeight <= 0) return null;

        var roll = Math.random() * totalWeight;
        var cumulative = 0;
        var chosen = null;
        for (var j = 0; j < pool.length; j++) {
            cumulative += Number(pool[j].random) || 0;
            if (roll < cumulative) { chosen = pool[j]; break; }
        }
        if (!chosen) chosen = pool[pool.length - 1];
        return Number(chosen.award);
    }

    function buildSignEntry(displayId) {
        // ── VALIDASI: pastikan displayId ada di signEx.json ──
        var signEx = loadJson('signEx');
        var numDisplayId = Number(displayId);
        if (!signEx || !signEx[String(numDisplayId)]) {
            log.error('DUNGEON_SWEEP', 'buildSignEntry REJECTED — displayId=' + displayId
                + ' NOT found in signEx.json');
            return null;
        }

        var signId = 'sign_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        return {
            _signId: signId,
            _displayId: numDisplayId,
            _heroId: "",
            _level: 1,
            _star: 0,
            _mainAttr: { _items: [{ _id: 0, _num: 0 }] },
            _starAttr: { _items: [{ _id: 0, _num: 0 }] },
            _viceAttr: {},
            _addAttr: {},
            _totalCost: { _items: [] },
            _tmpViceAttr: {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Schedule info / dungeon times
    // ═══════════════════════════════════════════════════════════

    function ensureScheduleInfo(savedData) {
        if (!savedData.scheduleInfo) savedData.scheduleInfo = {};
        if (!savedData.scheduleInfo._dungeonTimes) savedData.scheduleInfo._dungeonTimes = {};
        if (!savedData.scheduleInfo._dungeonBuyTimesCount) savedData.scheduleInfo._dungeonBuyTimesCount = {};
    }

    function getDungeonTimes(savedData, dungeonType) {
        ensureScheduleInfo(savedData);
        var val = savedData.scheduleInfo._dungeonTimes[String(dungeonType)];
        if (val === undefined || val === null) {
            val = DEFAULT_DUNGEON_TIMES[dungeonType] || 2;
            savedData.scheduleInfo._dungeonTimes[String(dungeonType)] = val;
        }
        return val;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Daily task progress (same logic as startBattle)
    // ═══════════════════════════════════════════════════════════

    function advanceDailyTaskProgress(savedData, dungeonType, count) {
        var taskType = DUNGEON_TO_DAILY_TASK[dungeonType];
        if (!taskType) return;

        if (!savedData._dailyTaskProgress) savedData._dailyTaskProgress = {};
        savedData._dailyTaskProgress[taskType] =
            (savedData._dailyTaskProgress[taskType] || 0) + count;

        var curCount = savedData._dailyTaskProgress[taskType];
        log.details('DUNGEON_SWEEP', [
            ['dailyTask', taskType + ' → count=' + curCount + ' (+' + count + ')']
        ]);

        // Check against taskDaily config
        var taskDailyCfg = loadJson('taskDaily');
        if (!taskDailyCfg) return;

        var matchedTask = null;
        var matchedTaskId = null;
        for (var tid in taskDailyCfg) {
            if (taskDailyCfg[tid].taskType === taskType) {
                matchedTask = taskDailyCfg[tid];
                matchedTaskId = Number(tid);
                break;
            }
        }
        if (!matchedTask) return;

        var targetCount = Number(matchedTask.taskPara1) || 1;

        if (!savedData._dailyTaskStates) savedData._dailyTaskStates = {};
        var prevState = savedData._dailyTaskStates[matchedTaskId];
        if (prevState === undefined || prevState === null) {
            var levelNeeded = Number(matchedTask.levelNeeded) || 1;
            var playerLevel = getItemBalance(savedData, 104) || 1;
            prevState = (playerLevel >= levelNeeded) ? TASK_STATE.DOING : TASK_STATE.DEFAULT;
            savedData._dailyTaskStates[matchedTaskId] = prevState;
        }

        if (prevState === TASK_STATE.DOING && curCount >= targetCount) {
            savedData._dailyTaskStates[matchedTaskId] = TASK_STATE.COMPLETE;
            log.info('DUNGEON_SWEEP', 'Daily task ' + matchedTaskId + ' (' + taskType +
                ') DOING -> COMPLETE (cur=' + curCount + '>=' + targetCount + ')');
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Main task processing (victory-based)
    // ═══════════════════════════════════════════════════════════

    function processDungeonVictoryTask(savedData, dungeonType, sweepCount) {
        var victoryTaskType = null;
        if (dungeonType === DUNGEON_TYPE.EXP) victoryTaskType = 'experienceDungeonVictory';
        else if (dungeonType === DUNGEON_TYPE.EVOLVE) victoryTaskType = 'breachDungeonVictory';
        if (!victoryTaskType) return;

        var cmt = savedData.curMainTask;
        if (!cmt || !Array.isArray(cmt) || cmt.length === 0 || cmt[0]._state !== 1) return;

        var taskCfg = loadJson('task');
        var taskDef = taskCfg && taskCfg[String(cmt[0]._id)];
        if (!taskDef || taskDef.taskType !== victoryTaskType) return;

        if (!savedData._dungeonVictoryProgress) savedData._dungeonVictoryProgress = {};
        savedData._dungeonVictoryProgress[victoryTaskType] =
            (savedData._dungeonVictoryProgress[victoryTaskType] || 0) + sweepCount;

        var winCount = savedData._dungeonVictoryProgress[victoryTaskType];
        var needed = Number(taskDef.taskPara1) || 1;

        log.details('DUNGEON_SWEEP', [
            ['mainTask', victoryTaskType + ' wins=' + winCount + '/' + needed]
        ]);

        if (winCount >= needed) {
            cmt[0]._state = TASK_STATE.COMPLETE;
            log.info('DUNGEON_SWEEP', 'Main task ' + cmt[0]._id +
                ' (' + victoryTaskType + ') DOING -> COMPLETE');
            if (typeof MainServer.notify === 'function') {
                MainServer.notify({
                    action: 'mainTaskChange',
                    _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE.COMPLETE }]
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: BUG2 fix
    // ═══════════════════════════════════════════════════════════

    function bug2Fix(savedData) {
        try {
            var cmt = savedData.curMainTask;
            if (!cmt || !Array.isArray(cmt) || cmt.length === 0) return;
            if (cmt[0]._state !== TASK_STATE.DEFAULT) return;
            var tc = loadJson('task');
            var def = tc && tc[String(cmt[0]._id)];
            var levelNeeded = def ? (Number(def.levelNeeded) || 1) : 1;
            var currentLevel = getItemBalance(savedData, 104) || 1;
            if (currentLevel >= levelNeeded) {
                cmt[0]._state = TASK_STATE.DOING;
                log.info('DUNGEON_SWEEP', 'BUG2: task ' + cmt[0]._id + ' DEFAULT -> DOING');
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE.DOING }]
                    });
                }
            }
        } catch (err) {
            log.warn('DUNGEON_SWEEP', 'BUG2 error: ' + (err.message || err));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: dungeon/sweep
    // ═══════════════════════════════════════════════════════════

    function handleDungeonSweep(request, callback) {
        var userId = request.userId;
        var dungeonType = Number(request.dungeonType);
        var dungeonLevel = Number(request.dungeonLevel);
        var sweepTimes = Number(request.times) || 1;

        log.info('DUNGEON_SWEEP', 'Processing dungeon/sweep');
        log.details('DUNGEON_SWEEP', [
            ['userId', userId || '-'],
            ['dungeonType', String(dungeonType) + '(' + (DUNGEON_TYPE_NAMES[dungeonType] || 'UNKNOWN') + ')'],
            ['dungeonLevel', String(dungeonLevel)],
            ['sweepTimes', String(sweepTimes)]
        ]);

        // ── 1. Validate userId ──
        if (!userId) {
            log.warn('DUNGEON_SWEEP', 'Missing userId');
            callback({}, 1);
            return;
        }

        // ── 2. Validate dungeonType ──
        var jsonName = DUNGEON_JSON_MAP[dungeonType];
        if (!jsonName) {
            log.warn('DUNGEON_SWEEP', 'Invalid dungeonType=' + dungeonType);
            callback({}, 1);
            return;
        }

        // ── 3. Load savedData ──
        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('DUNGEON_SWEEP', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }

        // ── 4. Validate dungeon level exists in config ──
        var dungeonCfg = loadJson(jsonName);
        if (!dungeonCfg) {
            log.error('DUNGEON_SWEEP', jsonName + '.json not found');
            callback({}, 1);
            return;
        }

        var levelCfg = dungeonCfg[String(dungeonLevel)];
        if (!levelCfg) {
            log.error('DUNGEON_SWEEP', 'Level ' + dungeonLevel + ' not found in ' + jsonName);
            callback({}, 1);
            return;
        }

        // ── 5. Validate level is cleared (maxLevel >= dungeonLevel) ──
        // Client checks getMaxLesson(dungeonType) >= selectedLevel before sweeping.
        // Server should also validate: _dungeonProgress[dungeonType]._curMaxLevel >= dungeonLevel
        if (savedData._dungeonProgress && savedData._dungeonProgress[dungeonType]) {
            var maxLevel = savedData._dungeonProgress[dungeonType]._curMaxLevel || 1;
            if (dungeonLevel > maxLevel) {
                log.warn('DUNGEON_SWEEP', 'Level ' + dungeonLevel + ' not cleared (max=' + maxLevel + ')');
                callback({}, 22009);
                return;
            }
        }
        // If no _dungeonProgress exists, allow sweep (new user, level 1)

        // ── 6. Validate and consume dungeon times ──
        var currentTimes = getDungeonTimes(savedData, dungeonType);
        if (currentTimes < sweepTimes) {
            // Clamp to available times
            log.details('DUNGEON_SWEEP', [
                ['times', 'Requested ' + sweepTimes + ' but only ' + currentTimes + ' available, clamping']
            ]);
            sweepTimes = currentTimes;
        }

        if (sweepTimes <= 0) {
            log.warn('DUNGEON_SWEEP', 'No dungeon times remaining');
            callback({}, 22010);
            return;
        }

        // ── 7. Execute sweep loop ──
        var changeItems = {};       // accumulates rewards across all sweeps
        var addSigns = [];          // sign drops (SINGA only — full signs for response)
        var persistSigns = [];      // sign drops (SINGA only — to persist to DB after loop)
        var addWeapons = [];        // equip drops (EQUIP only)

        for (var sweep = 0; sweep < sweepTimes; sweep++) {
            // Add base rewards (award1-num1 ... award5-num5)
            for (var slot = 1; slot <= 5; slot++) {
                var awardId = levelCfg['award' + slot];
                var awardNum = levelCfg['num' + slot];
                if (awardId === undefined || awardId === null ||
                    awardNum === undefined || awardNum === null) continue;
                addRewardToChange(changeItems, awardId, awardNum);
            }

            // Random equip drop (EQUIP only)
            if (dungeonType === DUNGEON_TYPE.EQUIP) {
                var equipId = rollRandomEquip(levelCfg);
                if (equipId) {
                    addRewardToChange(changeItems, equipId, 1);
                    addWeapons.push({ _id: equipId, _num: 1 });
                }
            }

            // Random sign/signPiece drop (SINGA and SINGB are DIFFERENT)
            if (dungeonType === DUNGEON_TYPE.SINGA) {
                // SINGA: drop FULL SIGN (signEx IDs like 7301+)
                var signDisplayId = rollRandomSign(dungeonType, levelCfg);
                if (signDisplayId) {
                    var signEntry = buildSignEntry(signDisplayId);
                    if (signEntry) {
                        addSigns.push(signEntry);       // untuk response _addSigns
                        persistSigns.push(signEntry);   // untuk persist ke DB
                    }
                }
            } else if (dungeonType === DUNGEON_TYPE.SINGB) {
                // SINGB: drop SIGN PIECE (IDs 244-276), BUKAN full sign
                // Masuk changeItems sebagai item biasa — client tampilkan di popup
                var pieceId = rollRandomSign(dungeonType, levelCfg);
                if (pieceId) {
                    addRewardToChange(changeItems, pieceId, 1);
                }
            }
        }

        log.info('DUNGEON_SWEEP', 'Sweep loop done: ' + sweepTimes + ' iterations');

        // ── 8. Apply accumulated rewards to savedData ──
        for (var itemId in changeItems) {
            var id = Number(itemId);
            var amount = changeItems[itemId]._num;
            var current = getItemBalance(savedData, id);
            var newBalance = current + amount;
            setItemBalance(savedData, id, newBalance);
            // Update changeItems to ABSOLUTE balance
            changeItems[itemId]._num = newBalance;
        }

        // ── 9. Compute EXP level-up ──
        computeLevelUp(savedData);

        // Ensure player level/exp in response (absolute)
        var playerExp = getItemBalance(savedData, 103);
        var playerLevel = getItemBalance(savedData, 104);
        changeItems['103'] = { _id: 103, _num: playerExp };
        changeItems['104'] = { _id: 104, _num: playerLevel };

        // ── 10. Consume dungeon times ──
        ensureScheduleInfo(savedData);
        savedData.scheduleInfo._dungeonTimes[String(dungeonType)] = currentTimes - sweepTimes;

        // ── 11. Process daily task progress ──
        try {
            advanceDailyTaskProgress(savedData, dungeonType, sweepTimes);
        } catch (dtErr) {
            log.warn('DUNGEON_SWEEP', 'Daily task error: ' + (dtErr.message || dtErr));
        }

        // ── 12. Process main tasks ──
        try {
            processDungeonVictoryTask(savedData, dungeonType, sweepTimes);
        } catch (mtErr) {
            log.warn('DUNGEON_SWEEP', 'Main task error: ' + (mtErr.message || mtErr));
        }

        // ── 13. BUG2 fix ──
        try {
            bug2Fix(savedData);
        } catch (b2Err) {
            log.warn('DUNGEON_SWEEP', 'BUG2 error: ' + (b2Err.message || b2Err));
        }

        // ── 13. Persist SINGA signs to DB (before db._set) ──
        // Signs dikumpulkan selama loop, sekarang ditambahkan ke savedData.imprint._items
        // Client tidak mengirim imprint kembali ke server, jadi server WAJIB persist di sini.
        if (persistSigns.length > 0) {
            if (!savedData.imprint) savedData.imprint = { _items: [] };
            if (!savedData.imprint._items) savedData.imprint._items = [];
            for (var ps = 0; ps < persistSigns.length; ps++) {
                savedData.imprint._items.push(persistSigns[ps]);
            }
            log.info('DUNGEON_SWEEP', 'Persisted ' + persistSigns.length + ' SINGA signs to imprint._items'
                + ' (total=' + savedData.imprint._items.length + ')');
        }

        // ── 14. Save ──
        db._set(storageKey, savedData);

        // ── 15. Build response ──
        var resp = {
            times: sweepTimes,
            _changeInfo: {
                _items: changeItems
            },
            _addHeroes: [],
            _addSigns: addSigns,
            _addWeapons: addWeapons,
            _addStones: [],
            _addGenkis: []
        };

        log.info('DUNGEON_SWEEP', 'OK userId=' + userId +
            ' type=' + (DUNGEON_TYPE_NAMES[dungeonType] || dungeonType) +
            ' level=' + dungeonLevel +
            ' sweeps=' + sweepTimes +
            ' items=' + Object.keys(changeItems).length +
            ' signs=' + addSigns.length +
            ' weapons=' + addWeapons.length);

        callback(resp);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('dungeon', 'sweep', handleDungeonSweep);

    window.MainServer = MainServer;
})();