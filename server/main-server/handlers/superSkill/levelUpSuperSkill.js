/**
 * handlers/superSkill/levelUpSuperSkill.js
 *
 * Request:  { type:"superSkill", action:"levelUpSuperSkill", userId, skillId:"1120561", version:"1.0" }
 * Response: {
 *   _changeInfo: { _items: { "134": { _id:134, _num:<ABSOLUTE_BALANCE> } } },
 *   _skill: { _skillId, _level, _needEvolve, _totalCost: { _items: { "134": {_id:134, _num:<CUMULATIVE>} } } }
 * }
 *
 * ============================================================
 * ANALYSIS EVIDENCE:
 * ============================================================
 *
 * [CALL SITE] levelUpBtnTap:
 *   var t = e.myData.superSkillData;   // current SuperSkillData
 *   var n = e.myData.superSkillInfo;   // HeroSuperSkill (config + state)
 *   var o = n.superConfig;             // superSkill.json entry
 *   var r = SuperSkillSingleton.getInstance().getSuperLevelUP(n.superConfig.quality, t.superskillLevel);
 *   if(!r) return;  // no config for this level
 *   if(t.superskillLevel >= getSuperSkillMaxLevel(o.quality)) return;  // max level
 *   ts.processHandler({type:"superSkill",action:"levelUpSuperSkill",userId,skillId:n.superSkillID,version:"1.0"},
 *     function(t){
 *       if(t._openType==...?...:t._openType==...&&openMoneyNotEnough(...),t._changeInfo){
 *         UIWindowManager.openCongratulationObtain(t);
 *         var n=SuperSkillSingleton.getInstance().changeSuperSkill(t._skill);
 *         e.myData.changeSuperSkillData(n);
 *         e.loadSuperSkillMainUI();
 *         e.showSkillUpEffect(e.skillIcon);
 *       }
 *     })
 *   → Comma operator: (check _openType for tips, then check _changeInfo)
 *   → If _changeInfo is truthy: show rewards, update skill via changeSuperSkill(t._skill)
 *   → If _changeInfo is absent: do nothing (silent fail for insufficient items)
 *
 * [getSuperLevelUP(quality, level)]:
 *   Iterates superLevelUp.json, returns entry where quality==quality && superLevel==level
 *   → { id, quality, superLevel, costID, costNum }
 *
 * [superLevelUp.json]: 1200 entries (4 qualities × 300 levels)
 *   quality: "green"/"blue"/"purple"/"orange"
 *   superLevel: 1-300
 *   costID: always 134
 *   costNum: varies (10, 15, 20, 25, 30, 40, 55, ...) — increases at level thresholds
 *
 * [superEvolve.json]: 100 entries (4 qualities × 25 thresholds)
 *   quality: "green"/"blue"/"purple"/"orange"
 *   evolveLevel: [20,40,60,80,100,110,120,130,140,150,160,170,180,190,200,210,220,230,240,250,260,270,280,290,300]
 *   costID: always 133
 *   costNum: varies (80, 150, 225, ...)
 *
 * [changeSuperSkill(t._skill)]:
 *   Reads t._skillId, t._level, t._needEvolve, t._totalCost
 *   Updates existing SuperSkillData or creates new one
 *   Calls changeSuperSkillLevel(level, needEvolve, totalCost)
 *
 * [changeSuperSkillLevel(level, needEvolve, totalCost)]:
 *   o.superskillLevel = level
 *   o.needEvolve = needEvolve
 *   o.totalCost ? o.totalCost.changeItems(totalCost) : o.totalCost = new ServerAttrItems(totalCost)
 *
 * [ServerAttrItems(totalCost)]:
 *   Expects totalCost = { _items: { "134": {_id:134, _num:totalSpent}, ... } }
 *   changeItems() REPLACES items by id (not additive)
 *   → Server must send FULL cumulative _totalCost, not delta
 *
 * [_needEvolve logic]:
 *   - When _needEvolve is true, UI shows EVOLVE button, not level-up button
 *   - Server should REJECT levelUpSuperSkill if current _needEvolve is true
 *   - After leveling up, check if new level is in superEvolve.json → set _needEvolve=true
 *
 * [getSuperSkillMaxLevel(quality)]:
 *   Iterates superLevelUp.json, tracks max superLevel per quality → 300 for all
 *
 * [Error pattern]: callback({}, 1) for errors, callback({}) for silent fail (no items)
 * [Item storage]: savedData.totalProps._items = [{_id, _num}, ...] (ARRAY)
 * [_changeInfo._items]: ABSOLUTE balance after deduction
 *
 * [TASK PROGRESS] (same pattern as summonOne.js / checkBattleResult.js):
 *   After successful level-up, checks savedData.curMainTask.
 *   If current task.taskType === "superLevelUp" → set _state=COMPLETE (2).
 *   Push Notify "mainTaskChange" → client setMianTask(e._curMainTask).
 *   Task entry: task.json #6016, taskType="superLevelUp", taskPara1=1
 *   TASK_STATE: DEFAULT=0, DOING=1, COMPLETE=2, FINISH=3
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.superSkill) {
        MainServer.handlers.superSkill = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS & HELPERS
    // ═══════════════════════════════════════════════════════════

    // TASK_STATE enum (main.min.js L62602-62605):
    //   DEFAULT=0, DOING=1, COMPLETE=2, FINISH=3
    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
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
            log.error('RESOURCE', 'superSkill/levelUpSuperSkill failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'superSkill/levelUpSuperSkill failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS (same pattern as resolve.js)
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
    //  FIND SKILL IN USER DATA
    //  Keys in _skills are arbitrary — must iterate all entries.
    // ═══════════════════════════════════════════════════════════

    function findSkillInStorage(savedData, skillId) {
        if (!savedData || !savedData.superSkill || !savedData.superSkill._skills) return null;
        var skills = savedData.superSkill._skills;
        var numSkillId = Number(skillId);
        for (var k in skills) {
            if (!skills.hasOwnProperty(k)) continue;
            var entry = skills[k];
            if (entry._skillId === numSkillId || entry._skillId === skillId ||
                String(entry._skillId) === String(skillId)) {
                return { data: entry, key: k };
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  LOOKUP HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * getSuperLevelUP(quality, level) — matches client's getSuperLevelUP
     * Iterates superLevelUp.json, returns entry where quality==quality && superLevel==level
     */
    function getSuperLevelUP(superLevelUpConfig, quality, level) {
        for (var k in superLevelUpConfig) {
            if (!superLevelUpConfig.hasOwnProperty(k)) continue;
            var entry = superLevelUpConfig[k];
            if (entry.quality === quality && entry.superLevel === level) {
                return entry;
            }
        }
        return null;
    }

    /**
     * getSuperEvolevel(quality, level) — matches client's getSuperEvolevel
     * Iterates superEvolve.json, returns entry where quality==quality && evolveLevel==level
     */
    function getSuperEvolveLevel(superEvolveConfig, quality, level) {
        for (var k in superEvolveConfig) {
            if (!superEvolveConfig.hasOwnProperty(k)) continue;
            var entry = superEvolveConfig[k];
            if (entry.quality === quality && entry.evolveLevel === level) {
                return entry;
            }
        }
        return null;
    }

    /**
     * getSuperSkillMaxLevel(quality) — matches client's getSuperSkillMaxLevel
     * Returns the highest superLevel for a given quality in superLevelUp.json
     */
    function getSuperSkillMaxLevel(superLevelUpConfig, quality) {
        var max = 0;
        for (var k in superLevelUpConfig) {
            if (!superLevelUpConfig.hasOwnProperty(k)) continue;
            var entry = superLevelUpConfig[k];
            if (entry.quality === quality && entry.superLevel > max) {
                max = entry.superLevel;
            }
        }
        return max;
    }

    // ═══════════════════════════════════════════════════════════
    //  TASK PROGRESS (same pattern as summonOne.js / checkBattleResult.js)
    // ═══════════════════════════════════════════════════════════
    //
    //  Client contract (main.min.js L77080):
    //    Notify "mainTaskChange" → setMianTask(e._curMainTask)
    //    _curMainTask: array [{_id, _state}]
    //
    //  Task superSkill-related (task.json):
    //    6016: taskType="superLevelUp", taskPara1=1
    //
    //  MainTask class: fields _id, _state, _levelEnough (NO count field).
    //  taskPara1=1 → 1x trigger langsung COMPLETE.
    // ═══════════════════════════════════════════════════════════

    function getTaskConfig(taskId) {
        var t = loadJson('task');
        return t ? t[String(taskId)] : null;
    }

    /**
     * checkAndCompleteTask(savedData)
     *
     * Checks if current main task is superLevelUp type.
     * If match → set _state=COMPLETE (2).
     *
     * @param {object} savedData — user data (mutated if task completed)
     * @returns {boolean} true if task state changed (notify needed)
     */
    function checkAndCompleteTask(savedData) {
        if (!savedData.curMainTask || !Array.isArray(savedData.curMainTask) || savedData.curMainTask.length === 0) {
            return false;
        }

        var currentTask = savedData.curMainTask[0];
        if (!currentTask || typeof currentTask._id === 'undefined') {
            return false;
        }

        // Skip if already COMPLETE or FINISH
        if (currentTask._state === TASK_STATE.COMPLETE || currentTask._state === TASK_STATE.FINISH) {
            return false;
        }

        // Load task config
        var taskData = getTaskConfig(currentTask._id);
        if (!taskData) {
            log.warn('TASK', 'checkAndCompleteTask — task config not found for id=' + currentTask._id);
            return false;
        }

        // Check if taskType matches superLevelUp
        if (taskData.taskType !== 'superLevelUp') {
            return false;
        }

        // Task match! Set state to COMPLETE
        currentTask._state = TASK_STATE.COMPLETE;
        savedData.curMainTask = [currentTask];

        log.info('TASK', 'Task ' + currentTask._id + ' (' + taskData.taskType + ') → COMPLETE (triggered by superSkill levelUp)');

        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleLevelUpSuperSkill(request, callback) {
        var userId = request.userId;
        var skillId = request.skillId;

        log.info('HANDLER', 'superSkill/levelUpSuperSkill — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['skillId', skillId || '(null)'],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — missing userId');
            callback({}, 1);
            return;
        }

        if (!skillId) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — missing skillId');
            callback({}, 1);
            return;
        }

        // ── LOAD CONFIGS ──
        var superSkillConfig = loadJson('superSkill');
        if (!superSkillConfig) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — failed to load superSkill.json');
            callback({}, 1);
            return;
        }

        var superLevelUpConfig = loadJson('superLevelUp');
        if (!superLevelUpConfig) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — failed to load superLevelUp.json');
            callback({}, 1);
            return;
        }

        var superEvolveConfig = loadJson('superEvolve');
        if (!superEvolveConfig) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — failed to load superEvolve.json');
            callback({}, 1);
            return;
        }

        // Validate skillId exists in superSkill.json
        var skillEntry = superSkillConfig[String(skillId)];
        if (!skillEntry) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — skillId not in superSkill.json: ' + skillId);
            callback({}, 1);
            return;
        }

        var quality = skillEntry.quality; // "green", "blue", "purple", "orange"

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — user data not found: ' + key);
            callback({}, 1);
            return;
        }

        // ── FIND SKILL IN USER DATA ──
        var found = findSkillInStorage(savedData, skillId);
        if (!found) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — skill not found in user data: ' + skillId);
            callback({}, 1);
            return;
        }

        var skillData = found.data;
        var currentLevel = Number(skillData._level) || 1;
        var currentNeedEvolve = !!skillData._needEvolve;

        log.info('HANDLER', 'superSkill/levelUpSuperSkill — found skill at key "' + found.key + '", currentLevel=' + currentLevel + ', needEvolve=' + currentNeedEvolve);

        // ── CHECK: needEvolve blocks level up ──
        if (currentNeedEvolve) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — skill needs evolve first (level=' + currentLevel + ')');
            callback({}, 1);
            return;
        }

        // ── LOOKUP COST for current level ──
        var levelUpEntry = getSuperLevelUP(superLevelUpConfig, quality, currentLevel);
        if (!levelUpEntry) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — no levelUp config for quality=' + quality + ' level=' + currentLevel);
            callback({}, 1);
            return;
        }

        var costId = Number(levelUpEntry.costID);
        var costNum = Number(levelUpEntry.costNum);

        log.info('HANDLER', 'superSkill/levelUpSuperSkill — cost: item ' + costId + ' x' + costNum);

        // ── CHECK MAX LEVEL ──
        var maxLevel = getSuperSkillMaxLevel(superLevelUpConfig, quality);
        if (currentLevel >= maxLevel) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — already at max level ' + currentLevel + '/' + maxLevel);
            callback({}, 1);
            return;
        }

        // ── CHECK ITEM BALANCE ──
        var currentBalance = getItemBalance(savedData, costId);
        if (currentBalance < costNum) {
            log.error('HANDLER', 'superSkill/levelUpSuperSkill — not enough items: have ' + currentBalance + ', need ' + costNum + ' (item ' + costId + ')');
            // Return without _changeInfo → client silently does nothing
            callback({});
            return;
        }

        // ── DEDUCT COST ──
        var newBalance = currentBalance - costNum;
        setItemBalance(savedData, costId, newBalance);

        // ── UPDATE SKILL LEVEL ──
        var newLevel = currentLevel + 1;
        skillData._level = newLevel;

        // ── CHECK IF NEW LEVEL HITS EVOLVE THRESHOLD ──
        var evolveEntry = getSuperEvolveLevel(superEvolveConfig, quality, newLevel);
        var newNeedEvolve = !!evolveEntry; // true if evolve config exists for this level

        // CRITICAL: must persist needEvolve to savedData so it survives re-login
        skillData._needEvolve = newNeedEvolve;

        if (newNeedEvolve) {
            log.info('HANDLER', 'superSkill/levelUpSuperSkill — hit evolve threshold at level ' + newLevel + ', needEvolve=true (must evolve before further level-ups)');
        }

        // ── UPDATE _totalCost (cumulative) ──
        // _totalCost format: { _items: { "134": { _id:134, _num:<cumulative> } } }
        var oldTotalCost = skillData._totalCost ? skillData._totalCost._items : {};
        var oldCostForItem = 0;
        if (oldTotalCost[String(costId)]) {
            oldCostForItem = Number(oldTotalCost[String(costId)]._num) || 0;
        }
        var newTotalForItem = oldCostForItem + costNum;

        skillData._totalCost = {
            _items: {}
        };
        skillData._totalCost._items[String(costId)] = {
            _id: costId,
            _num: newTotalForItem
        };

        // Also preserve any other items in old _totalCost (e.g. from evolve costs if mixed)
        for (var oldKey in oldTotalCost) {
            if (!oldTotalCost.hasOwnProperty(oldKey)) continue;
            if (oldKey === String(costId)) continue; // already updated above
            skillData._totalCost._items[oldKey] = oldTotalCost[oldKey];
        }

        log.info('HANDLER', 'superSkill/levelUpSuperSkill — level ' + currentLevel + ' → ' + newLevel + ', needEvolve=' + newNeedEvolve + ', totalCost item ' + costId + '=' + newTotalForItem);

        // ── TASK PROGRESS UPDATE ──
        var taskUpdated = checkAndCompleteTask(savedData);

        // ── SAVE USER DATA ──
        db._set(key, savedData);
        log.info('HANDLER', 'superSkill/levelUpSuperSkill — user data saved.');

        if (taskUpdated) {
            // Push mainTaskChange notify to client
            // Client L77080: Notify "mainTaskChange" → setMianTask(e._curMainTask)
            MainServer.log.notify('mainTaskChange', {
                _curMainTask: savedData.curMainTask
            });

            log.info('TASK', 'Notify mainTaskChange sent — task ' +
                savedData.curMainTask[0]._id + ' state=' +
                savedData.curMainTask[0]._state);
        }

        // ── BUILD RESPONSE ──
        var response = {
            _changeInfo: {
                _items: {}
            },
            _skill: {
                _skillId: Number(skillId),
                _level: newLevel,
                _needEvolve: newNeedEvolve,
                _totalCost: skillData._totalCost
            }
        };

        // _changeInfo._items: ABSOLUTE balance after deduction
        response._changeInfo._items[String(costId)] = {
            _id: costId,
            _num: newBalance
        };

        log.details('response', [
            ['_changeInfo._items', JSON.stringify(response._changeInfo._items)],
            ['_skill._level', String(newLevel)],
            ['_skill._needEvolve', String(newNeedEvolve)],
            ['_skill._totalCost', JSON.stringify(response._skill._totalCost)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('superSkill', 'levelUpSuperSkill', handleLevelUpSuperSkill);

})();