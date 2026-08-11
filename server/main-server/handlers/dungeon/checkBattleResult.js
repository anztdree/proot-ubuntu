/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: dungeon/checkBattleResult
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TUGAS UTAMA
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Menentukan hasil dungeon battle (WIN/LOSE), memberikan reward,
 *  meng-advance dungeon level progression, dan meng-processed task progress.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  CLIENT CALL SITES (3 total)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  1. EquipmentBattleEndCallBack (L63479-63516):
 *     { type:"dungeon", action:"checkBattleResult", userId, dungeonType:4,
 *       dungeonLevel, battleId, version:"1.0", super, checkResult, battleField:8 }
 *
 *  2. resourceBattleEndCallBack (L63661-63703):
 *     { type:"dungeon", action:"checkBattleResult", userId, dungeonType:o,
 *       dungeonLevel, battleId, version:"1.0", super, checkResult, battleField:c }
 *     Covers: EXP(1), EVOLVE(2), METAL(7), Z_STONE(8)
 *
 *  3. signetBattleEndCallBack (L63739-63795):
 *     { type:"dungeon", action:"checkBattleResult", userId, dungeonType:s,
 *       dungeonLevel, battleId, version:"1.0", super, checkResult,
 *       battleField:BattleLogic.GameFieldType.SIGNDUNGEON }
 *     Covers: SINGA(5), SINGB(6)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  RESPONSE FORMAT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  WIN (all dungeon types):
 *  {
 *      _battleResult: 0,
 *      _changeInfo: {
 *          _items: { "itemId": {_id, _num}, ... }   // ABSOLUTE balances
 *      },
 *      _lastLevel: <currentLevel>,
 *      _curMaxLevel: <maxUnlockedLevel>,
 *      _haveTimes: <remaining>,
 *      _buyTimes: <buyCount>
 *  }
 *
 *  WIN + SINGA (additional):
 *  {
 *      ...all above...,
 *      _signs: {
 *          "0": { _id, _signId, _displayId, _heroId:"", _level:1, _star:0,
 *                 _mainAttr:{_items:[{_id,_num}]}, _starAttr:{_items:[{_id,_num}]},
 *                 _viceAttr:{}, _addAttr:{}, _totalCost:{_items:[]},
 *                 _tmpViceAttr:{} },
 *          ...
 *      }
 *  }
 *  NOTE: _id is REQUIRED — client ImprintItem.deserialize() maps _id → this.id.
 *        signetBattleEndCallBack uses c.id for summary display (r[c.id] = c.id).
 *        Without _id, c.id stays "" and the sign won't appear in the summary.
 *
 *  LOSE (all types):
 *  { _battleResult: 1 }   — NO _changeInfo, NO _signs, NO level data
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DUNGEON REWARD STRUCTURE (from dungeon JSON configs)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  EXP/EVOLVE/METAL/Z_STONE:  award1/num1 + award2/num2 (direct items)
 *  EQUIP:                    award1/num1 + award2/num2 + random equip from
 *                             equipDungeonAward.json[awardID] (weight-based roll)
 *  SINGA:                    award1/num1 + award2/num2 + random sign from
 *                             signDungeonAward.json[awardID] (displayId 7301+)
 *  SINGB:                    award1/num1 + award2/num2 + random material from
 *                             signDungeonAwardB.json[pool] (material ID 244-276)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TASK PROCESSING
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Main tasks (on WIN):
 *    6017: experienceDungeonVictory (taskPara1=2, levelNeeded=16) — EXP dungeon wins
 *    6021: breachDungeonVictory    (taskPara1=2, levelNeeded=20) — EVOLVE dungeon wins
 *
 *  Daily tasks (on WIN):
 *    Tracked via savedData._dailyTaskProgress + _dailyTaskStates
 *    (counters already incremented in startBattle, states checked here)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DUNGEON LEVEL PROGRESSION
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Server tracks per-dungeon-type: _lastLevel, _curMaxLevel
 *  stored in savedData._dungeonProgress[dungeonType]
 *  On WIN at dungeonLevel == _curMaxLevel → advance _curMaxLevel to next level
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DUNGEON TIMES
 *  ══════════════════════════════════════════════════════════════════
 *
 *  scheduleInfo._dungeonTimes = { "1":2, "2":2, "4":2, "5":2, "7":2, "8":2 }
 *  Server decrements _dungeonTimes[dungeonType] by 1 on WIN only.
 *  Client also decrements locally via setHaveTimes(dungeonType, 1) on WIN only.
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
            log.error('DUNGEON_RESULT', 'Failed to load ' + name + '.json: ' + e.message);
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

    // dungeonType → JSON config filename
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

    // Default dungeon times from constant.json
    var DEFAULT_DUNGEON_TIMES = {
        1: 2,   // EXP
        2: 2,   // EVOLVE
        3: 2,   // ENERGY
        4: 2,   // EQUIP
        5: 2,   // SINGA
        6: 2,   // SINGB
        7: 2,   // METAL
        8: 2    // Z_STONE
    };

    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS (same pattern as hangup/checkBattleResult)
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
            items.push({ _id: itemId, _num: newBalance });
        }
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
                log.info('DUNGEON_RESULT', 'PLAYER LEVEL ' + oldLevel + ' -> ' + curLevel);
            }
        }
        return curLevel;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Build _changeInfo._items from award1-num1 ... award5-num5
    // ═══════════════════════════════════════════════════════════

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

        log.details('DUNGEON_REWARD', [
            ['item', String(itemId)],
            ['amount', String(amount)],
            ['oldBalance', String(currentBalance)],
            ['newBalance', String(newBalance)]
        ]);
    }

    function buildRewardItems(savedData, levelCfg) {
        var changeItems = {};
        for (var slot = 1; slot <= 5; slot++) {
            var awardId = levelCfg['award' + slot];
            var awardNum = levelCfg['num' + slot];
            if (awardId === undefined || awardId === null ||
                awardNum === undefined || awardNum === null) {
                continue;
            }
            addRewardItem(savedData, changeItems, awardId, awardNum);
        }
        return changeItems;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Random equip drop from equipDungeonAward.json
    // ═══════════════════════════════════════════════════════════
    //
    //  equipDungeonAward.json[poolId] = [{id, award(=equipId), name, num:1, random(weight)}, ...]
    //  One random equip item per battle (weighted roll).
    //

    function rollRandomEquip(levelCfg) {
        // equipDungeon.json has both awardID (25101+) and awardPool (1+).
        // equipDungeonAward.json is keyed by awardPool number: "1", "2", etc.
        var poolId = levelCfg.awardPool || levelCfg.awardID;
        if (!poolId) return null;

        var awardPoolCfg = loadJson('equipDungeonAward');
        if (!awardPoolCfg) {
            log.warn('DUNGEON_RESULT', 'equipDungeonAward.json not found');
            return null;
        }

        var pool = awardPoolCfg[String(poolId)];
        if (!pool || !Array.isArray(pool) || pool.length === 0) {
            log.warn('DUNGEON_RESULT', 'No equip award pool for poolId=' + poolId);
            return null;
        }

        // Weighted random roll
        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) {
            totalWeight += Number(pool[i].random) || 0;
        }
        if (totalWeight <= 0) return null;

        var roll = Math.random() * totalWeight;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += Number(pool[j].random) || 0;
            if (roll < cumulative) {
                var equipId = Number(pool[j].award);
                log.info('DUNGEON_RESULT', 'Equip drop: id=' + equipId +
                    ' name=' + (pool[j].name || '') +
                    ' (pool=' + poolId + ', weight=' + pool[j].random + ')');
                return equipId;
            }
        }

        // Fallback: last item
        return Number(pool[pool.length - 1].award);
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Random sign drop for SINGA/SINGB
    // ═══════════════════════════════════════════════════════════
    //
    //  SINGA: signDungeonA.json has awardID=25301-25330
    //         → signDungeonAward.json[25301] = [{dungeonPart, award(=signDisplayId), ...}, ...]
    //         Each entry has award = sign displayId (7301+), dungeonPart = slot position
    //         signEx.json[displayId] has {type, part, quality}
    //
    //  Response _signs format (ImprintItem serialized):
    //  {
    //      "0": {
    //          _signId: <uniqueId>,
    //          _displayId: 7301,
    //          _heroId: "",
    //          _level: 1,
    //          _star: 0,
    //          _mainAttr: { _items: [{ _id: <attrItemId>, _num: 0 }] },
    //          _starAttr: { _items: [{ _id: <attrItemId>, _num: 0 }] },
    //          _viceAttr: {},
    //          _addAttr: {},
    //          _totalCost: { _items: [] },
    //          _tmpViceAttr: {}
    //      }
    //  }
    //
    //  Client deserialize: ImprintItem.deserialize() reads _displayId → looks up
    //  ReadJsonSingleton.sign[displayId] for type/quality/part.
        // ═══════════════════════════════════════════════════════════
    //  HELPER: Weighted random roll from a pool array
    // ═══════════════════════════════════════════════════════════

    function weightedRoll(pool) {
        if (!pool || !Array.isArray(pool) || pool.length === 0) return null;

        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) {
            totalWeight += Number(pool[i].random) || 0;
        }
        if (totalWeight <= 0) return null;

        var roll = Math.random() * totalWeight;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += Number(pool[j].random) || 0;
            if (roll < cumulative) {
                return pool[j];
            }
        }
        return pool[pool.length - 1];
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Random SIGN drop for SINGA only
    // ═══════════════════════════════════════════════════════════
    //
    //  SINGA: signDungeonA.json has awardID=25301-25330
    //         -> signDungeonAward.json[25301] = [{dungeonPart, award(=signDisplayId), ...}]
    //         Each entry has award = sign displayId (7301+), dungeonPart = slot position
    //         signEx.json[displayId] has {type, part, quality}
    //
    //  signDungeonAward.json only has 8 pools (keys 25301-25308).
    //  signDungeonA.json has 30 levels (awardID 25301-25330).
    //  Levels 9-30 must map back to one of the 8 pools via modular arithmetic.
    //
    //  Pool pattern: odd pools -> dungeonPart 1, even pools -> dungeonPart 2
    //  Mapping: poolKey = 25301 + ((awardID - 25301) % 8)
    //
    //  Returns: sign displayId (e.g. 7301) or null

    function rollRandomSignSINGA(levelCfg) {
        var awardID = levelCfg.awardID;
        if (!awardID) return null;

        var awardPool = loadJson('signDungeonAward');
        if (!awardPool) {
            log.warn('DUNGEON_RESULT', 'signDungeonAward.json not found');
            return null;
        }

        // Modular mapping: 30 levels -> 8 pools
        // awardID 25301-25308 -> direct lookup
        // awardID 25309-25330 -> wrap around to 25301-25308
        var basePool = 25301;
        var poolCount = 8;
        var offset = (Number(awardID) - basePool) % poolCount;
        var poolKey = String(basePool + offset);

        var pool = awardPool[poolKey];
        if (!pool || !Array.isArray(pool) || pool.length === 0) {
            log.details('DUNGEON_RESULT', [
                ['signPool', 'No entries for key=' + poolKey +
                    ' (awardID=' + awardID + ')']
            ]);
            return null;
        }

        var chosen = weightedRoll(pool);
        if (!chosen) return null;

        var displayId = Number(chosen.award);
        log.info('DUNGEON_RESULT', 'SINGA sign drop: displayId=' + displayId +
            ' name=' + (chosen.name || '') +
            ' dungeonPart=' + (chosen.dungeonPart || '') +
            ' (poolKey=' + poolKey + ')');

        return displayId;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Random MATERIAL drop for SINGB only
    // ═══════════════════════════════════════════════════════════
    //
    //  SINGB: signDungeonB.json has 30 levels
    //         -> signDungeonAwardB.json has 4 groups (keys "1"-"4")
    //         Each entry has award = MATERIAL ID (244-276), NOT sign displayId
    //
    //  signDungeonAwardB.json pool mapping by level (from awardShow patterns):
    //    Levels 1-2:  pool "1" (materials 244,245,246)
    //    Levels 3-4:  pool "2" (materials 254,255,256)
    //    Levels 5-8:  pool "3" (materials 264,265,266)
    //    Levels 9-30: pool "4" (materials 274,275,276)
    //
    //  These materials go to INVENTORY (_changeInfo._items), NOT to _signs.
    //  Sending them as _signs would crash ImprintItem.deserialize()
    //  because signEx.json has no entries for material IDs.
    //
    //  Returns: { itemId: <materialId>, amount: <num> } or null

    function rollRandomMaterialSINGB(levelCfg) {
        var level = Number(levelCfg.id) || 1;

        var awardPool = loadJson('signDungeonAwardB');
        if (!awardPool) {
            log.warn('DUNGEON_RESULT', 'signDungeonAwardB.json not found');
            return null;
        }

        // Map level to pool key based on awardShow progression
        var poolKey;
        if (level <= 2) {
            poolKey = '1';
        } else if (level <= 4) {
            poolKey = '2';
        } else if (level <= 8) {
            poolKey = '3';
        } else {
            poolKey = '4';
        }

        var pool = awardPool[poolKey];
        if (!pool || !Array.isArray(pool) || pool.length === 0) {
            log.details('DUNGEON_RESULT', [
                ['materialPool', 'No entries for key=' + poolKey +
                    ' (level=' + level + ')']
            ]);
            return null;
        }

        var chosen = weightedRoll(pool);
        if (!chosen) return null;

        var itemId = Number(chosen.award);
        var amount = Number(chosen.num) || 1;

        log.info('DUNGEON_RESULT', 'SINGB material drop: itemId=' + itemId +
            ' amount=' + amount +
            ' (poolKey=' + poolKey + ', level=' + level + ')');

        return { itemId: itemId, amount: amount };
    }

    /**
     * buildSignEntry(displayId) — Build a serialized ImprintItem for _signs response.
     *
     * @param {number} displayId — sign display ID from signEx.json (e.g. 7301)
     * @returns {object} serialized ImprintItem
     */
    function buildSignEntry(displayId) {
        var signEx = loadJson('signEx');
        var signInfo = signEx ? signEx[String(displayId)] : null;

        // CRITICAL: Validate displayId exists in signEx.json.
        // Client ImprintItem.deserialize() does:
        //   var s = ReadJsonSingleton.sign[n];  // n = _displayId value
        //   this.signType = SIGN_TYPE_EX[s.type.toUpperCase()];  // CRASH if s is undefined
        // If displayId is not in signEx, we MUST NOT create this entry.
        if (!signInfo) {
            log.warn('DUNGEON_RESULT', 'buildSignEntry: displayId=' + displayId +
                ' NOT found in signEx.json — skipping to prevent client crash');
            return null;
        }

        // Generate unique sign ID
        var signId = 'sign_' + Date.now() + '_' + Math.floor(Math.random() * 100000);

        // Build mainAttr and starAttr with placeholder items
        // Client reads _mainAttr._items[0]._id and _mainAttr._items[0]._num
        // Using attrId 0, num 0 as default (no actual sub-attributes at level 1)
        var mainAttrItem = { _id: 0, _num: 0 };
        var starAttrItem = { _id: 0, _num: 0 };

        var entry = {
            _id: signId,
            _signId: signId,
            _displayId: displayId,
            _heroId: "",
            _level: 1,
            _star: 0,
            _mainAttr: { _items: [mainAttrItem] },
            _starAttr: { _items: [starAttrItem] },
            _viceAttr: {},
            _addAttr: {},
            _totalCost: { _items: [] },
            _tmpViceAttr: {}
        };

        return entry;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Dungeon level progression
    // ═══════════════════════════════════════════════════════════

    function ensureDungeonProgress(savedData) {
        if (!savedData._dungeonProgress) {
            savedData._dungeonProgress = {};
        }
    }

    function getDungeonProgress(savedData, dungeonType) {
        ensureDungeonProgress(savedData);
        if (!savedData._dungeonProgress[dungeonType]) {
            savedData._dungeonProgress[dungeonType] = {
                _lastLevel: 1,
                _curMaxLevel: 1
            };
        }
        return savedData._dungeonProgress[dungeonType];
    }

    function advanceDungeonLevel(savedData, dungeonType, dungeonLevel, dungeonCfg) {
        var progress = getDungeonProgress(savedData, dungeonType);
        progress._lastLevel = dungeonLevel;

        // If we just beat the current max level, try to advance
        if (dungeonLevel >= progress._curMaxLevel) {
            var nextLevel = dungeonLevel + 1;
            if (dungeonCfg && dungeonCfg[String(nextLevel)]) {
                progress._curMaxLevel = nextLevel;
                log.info('DUNGEON_RESULT', 'Level advanced: ' + dungeonType +
                    ' maxLevel ' + dungeonLevel + ' -> ' + nextLevel);
            } else {
                log.details('DUNGEON_RESULT', [
                    ['advance', 'No level ' + nextLevel + ' in config, max stays at ' + progress._curMaxLevel]
                ]);
            }
        }

        return {
            _lastLevel: progress._lastLevel,
            _curMaxLevel: progress._curMaxLevel
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Dungeon times management
    // ═══════════════════════════════════════════════════════════

    function ensureScheduleInfo(savedData) {
        if (!savedData.scheduleInfo) {
            savedData.scheduleInfo = {};
        }
        if (!savedData.scheduleInfo._dungeonTimes) {
            savedData.scheduleInfo._dungeonTimes = {};
        }
        if (!savedData.scheduleInfo._dungeonBuyTimesCount) {
            savedData.scheduleInfo._dungeonBuyTimesCount = {};
        }
    }

    function decrementDungeonTimes(savedData, dungeonType) {
        ensureScheduleInfo(savedData);
        var key = String(dungeonType);
        var current = savedData.scheduleInfo._dungeonTimes[key];

        // Initialize from defaults if not set
        if (current === undefined || current === null) {
            current = DEFAULT_DUNGEON_TIMES[dungeonType] || 2;
            savedData.scheduleInfo._dungeonTimes[key] = current;
        }

        var before = current;
        if (current > 0) {
            current--;
            savedData.scheduleInfo._dungeonTimes[key] = current;
        }

        log.details('DUNGEON_RESULT', [
            ['dungeonTimes', dungeonType + ': ' + before + ' -> ' + current]
        ]);

        return current;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: WIN/LOSE determination
    // ═══════════════════════════════════════════════════════════
    //
    //  Client battle engine determines WIN/LOSE. Server receives checkResult
    //  (hero HP map). Heuristic:
    //    - runaway=true → LOSE
    //    - checkResult empty/null → LOSE
    //    - all hero HP=0 → LOSE
    //    - else → WIN (trust client battle engine)
    //

    function determineWinLose(request) {
        // Explicit runaway
        if (request.runaway === true) {
            log.info('DUNGEON_RESULT', 'Result: LOSE (runaway)');
            return false;
        }

        var checkResult = request.checkResult;
        if (!checkResult || !Array.isArray(checkResult) || checkResult.length === 0) {
            log.info('DUNGEON_RESULT', 'Result: LOSE (no checkResult)');
            return false;
        }

        // Check if all heroes have 0 HP
        var allDead = true;
        for (var i = 0; i < checkResult.length; i++) {
            var hero = checkResult[i];
            // checkResult entries: {hero, hp} — field is "hero" not "heroId"
            var hp = hero.hp !== undefined ? Number(hero.hp) :
                     hero.HP !== undefined ? Number(hero.HP) : -1;
            if (hp > 0) {
                allDead = false;
                break;
            }
        }

        if (allDead) {
            log.info('DUNGEON_RESULT', 'Result: LOSE (all heroes dead)');
            return false;
        }

        log.info('DUNGEON_RESULT', 'Result: WIN');
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Main task processing (experienceDungeonVictory, breachDungeonVictory)
    // ═══════════════════════════════════════════════════════════
    //
    //  Task 6017: taskType="experienceDungeonVictory", taskPara1=2 (need 2 wins)
    //  Task 6021: taskType="breachDungeonVictory", taskPara1=2 (need 2 wins)
    //
    //  Pattern: curMainTask[0]._state === 1 (DOING), match taskType,
    //  track win count in savedData._dungeonVictoryProgress[taskType],
    //  if count >= taskPara1 → _state = 2 (COMPLETE), push mainTaskChange.
    //

    function processDungeonVictoryTask(savedData, dungeonType) {
        // Map dungeonType to main task taskType
        var victoryTaskType = null;
        if (dungeonType === DUNGEON_TYPE.EXP) {
            victoryTaskType = 'experienceDungeonVictory';
        } else if (dungeonType === DUNGEON_TYPE.EVOLVE) {
            victoryTaskType = 'breachDungeonVictory';
        }

        if (!victoryTaskType) return;

        var cmt = savedData.curMainTask;
        if (!cmt || !Array.isArray(cmt) || cmt.length === 0 || cmt[0]._state !== 1) {
            return;
        }

        var taskCfg = loadJson('task');
        var taskDef = taskCfg && taskCfg[String(cmt[0]._id)];
        if (!taskDef || taskDef.taskType !== victoryTaskType) return;

        // Initialize victory progress counter
        if (!savedData._dungeonVictoryProgress) {
            savedData._dungeonVictoryProgress = {};
        }
        savedData._dungeonVictoryProgress[victoryTaskType] =
            (savedData._dungeonVictoryProgress[victoryTaskType] || 0) + 1;

        var winCount = savedData._dungeonVictoryProgress[victoryTaskType];
        var needed = Number(taskDef.taskPara1) || 1;

        log.details('DUNGEON_RESULT', [
            ['mainTask', 'taskType=' + victoryTaskType +
                ' wins=' + winCount + '/' + needed]
        ]);

        if (winCount >= needed) {
            cmt[0]._state = TASK_STATE.COMPLETE;
            log.info('DUNGEON_RESULT', 'Main task ' + cmt[0]._id +
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
    //  HELPER: BUG2 fix — DEFAULT→DOING transition after level-up
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
                log.info('DUNGEON_RESULT', 'BUG2 fix: task ' + cmt[0]._id +
                    ' DEFAULT -> DOING (level ' + currentLevel + '>=' + levelNeeded + ')');
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE.DOING }]
                    });
                }
            }
        } catch (err) {
            log.warn('DUNGEON_RESULT', 'BUG2 fix error: ' + (err.message || err));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: dungeon/checkBattleResult
    // ═══════════════════════════════════════════════════════════

    function handleDungeonCheckBattleResult(request, callback) {
        var userId = request.userId;
        var dungeonType = Number(request.dungeonType);
        var dungeonLevel = Number(request.dungeonLevel);

        log.info('DUNGEON_RESULT', 'Processing dungeon/checkBattleResult');
        log.details('DUNGEON_RESULT', [
            ['userId', userId || '-'],
            ['dungeonType', String(dungeonType) + '(' + (DUNGEON_TYPE_NAMES[dungeonType] || 'UNKNOWN') + ')'],
            ['dungeonLevel', String(dungeonLevel)],
            ['battleId', request.battleId || '-'],
            ['checkResult', request.checkResult ? JSON.stringify(request.checkResult).substring(0, 300) : '-']
        ]);

        // ── 1. Validate userId ──
        if (!userId) {
            log.warn('DUNGEON_RESULT', 'Missing userId');
            callback({}, 1);
            return;
        }

        // ── 2. Load savedData ──
        var storageKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('DUNGEON_RESULT', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }

        // ── 3. Validate dungeonType ──
        var jsonName = DUNGEON_JSON_MAP[dungeonType];
        if (!jsonName) {
            log.warn('DUNGEON_RESULT', 'Invalid dungeonType=' + dungeonType);
            callback({}, 1);
            return;
        }

        // ── 4. Load dungeon config ──
        var dungeonCfg = loadJson(jsonName);
        if (!dungeonCfg) {
            log.error('DUNGEON_RESULT', jsonName + '.json not found');
            callback({}, 1);
            return;
        }

        var levelCfg = dungeonCfg[String(dungeonLevel)];
        if (!levelCfg) {
            log.error('DUNGEON_RESULT', 'Level ' + dungeonLevel + ' not found in ' + jsonName);
            callback({}, 1);
            return;
        }

        // ── 5. Determine WIN/LOSE ──
        var isWin = determineWinLose(request);

        // ── 6. Decrement dungeon times (only on WIN — client only decrements on WIN) ──
        // Client signetBattleEndCallBack ALWAYS calls setHaveTimes(DUNGEON_TYPE.SINGA, 1)
        // for BOTH SINGA and SINGB (constant.json has single signDungeonTimes).
        // Server must mirror: for sign dungeons, always decrement SINGA (type 5) times.
        var timesDungeonType = dungeonType;
        if (dungeonType === DUNGEON_TYPE.SINGA || dungeonType === DUNGEON_TYPE.SINGB) {
            timesDungeonType = DUNGEON_TYPE.SINGA;
        }

        var remainingTimes = 0;
        if (isWin) {
            remainingTimes = decrementDungeonTimes(savedData, timesDungeonType);
        } else {
            ensureScheduleInfo(savedData);
            remainingTimes = savedData.scheduleInfo._dungeonTimes[String(timesDungeonType)] ||
                DEFAULT_DUNGEON_TIMES[timesDungeonType] || 2;
        }

        // ── 7. LOSE — minimal response ──
        if (!isWin) {
            db._set(storageKey, savedData);
            log.info('DUNGEON_RESULT', 'LOSE userId=' + userId +
                ' type=' + (DUNGEON_TYPE_NAMES[dungeonType] || dungeonType) +
                ' level=' + dungeonLevel);
            callback({ _battleResult: 1 });
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  WIN PATH — give rewards, advance level, process tasks
        // ═══════════════════════════════════════════════════════

        log.info('DUNGEON_RESULT', 'WIN userId=' + userId +
            ' type=' + (DUNGEON_TYPE_NAMES[dungeonType] || dungeonType) +
            ' level=' + dungeonLevel);

        // ── 8. Build reward items from award1-num1 ... award5-num5 ──
        var changeItems = buildRewardItems(savedData, levelCfg);

        // ── 9. Random equip drop (EQUIP dungeon only) ──
        if (dungeonType === DUNGEON_TYPE.EQUIP) {
            var equipId = rollRandomEquip(levelCfg);
            if (equipId) {
                addRewardItem(savedData, changeItems, equipId, 1);
            }
        }

        // ── 10. Compute EXP level-up ──
        computeLevelUp(savedData);

        // ── 11. Ensure player level is in response ──
        var playerExp = getItemBalance(savedData, 103);
        var playerLevel = getItemBalance(savedData, 104);
        changeItems['103'] = { _id: 103, _num: playerExp };
        changeItems['104'] = { _id: 104, _num: playerLevel };

        // ── 12. Advance dungeon level ──
        var levelInfo = advanceDungeonLevel(savedData, dungeonType, dungeonLevel, dungeonCfg);

        // ── 13. SINGA: random SIGN drop -> _signs  |  SINGB: random MATERIAL drop -> inventory ──
        //
        //  SINGA (dungeonType 5):
        //    signDungeonAward.json contains sign displayIds (7301+).
        //    Client ImprintItem.deserialize() looks up signEx[displayId] - MUST be valid sign.
        //    Response: _signs = { "0": { _signId, _displayId, ... } }
        //
        //  SINGB (dungeonType 6):
        //    signDungeonAwardB.json contains MATERIAL IDs (244-276), NOT sign IDs.
        //    These MUST go to inventory (_changeInfo._items), NOT to _signs.
        //    Sending material IDs as _displayId in _signs -> signEx[244] = undefined -> CRASH.
        //    Response: material added to _changeInfo._items, NO _signs field.
        //
        var signs = null;

        if (dungeonType === DUNGEON_TYPE.SINGA) {
            // SINGA: roll a sign displayId and build ImprintItem entry for _signs
            var signDisplayId = rollRandomSignSINGA(levelCfg);
            if (signDisplayId) {
                var signEntry = buildSignEntry(signDisplayId);
                // buildSignEntry returns null if displayId not in signEx.json
                // (safety check — prevents ImprintItem.deserialize crash)
                if (signEntry) {
                    signs = {};  // Object format (client iterates with for...in)
                    signs["0"] = signEntry;
                    log.info('DUNGEON_RESULT', 'SINGA sign added to _signs: displayId=' + signDisplayId);
                } else {
                    log.warn('DUNGEON_RESULT', 'SINGA sign entry rejected (displayId=' +
                        signDisplayId + ' invalid in signEx.json)');
                }
            } else {
                log.details('DUNGEON_RESULT', ['signs', 'No SINGA sign dropped (pool empty or not found)']);
            }
            // signs stays null if no valid sign was created
            // Client signetBattleEndCallBack only accesses e._signs inside if(t) block,
            // so missing _signs field is safe (just no new signs added).

        } else if (dungeonType === DUNGEON_TYPE.SINGB) {
            // SINGB: roll a material and add to inventory - do NOT populate _signs
            var materialDrop = rollRandomMaterialSINGB(levelCfg);
            if (materialDrop) {
                addRewardItem(savedData, changeItems, materialDrop.itemId, materialDrop.amount);
                log.info('DUNGEON_RESULT', 'SINGB material added to inventory: itemId=' +
                    materialDrop.itemId + ' amount=' + materialDrop.amount);
            } else {
                log.details('DUNGEON_RESULT', ['material', 'No SINGB material dropped (pool empty or not found)']);
            }
            // SINGB does NOT send _signs - materials go to _changeInfo._items only
        }

        // ── 14. Process main tasks ──
        try {
            processDungeonVictoryTask(savedData, dungeonType);
        } catch (taskErr) {
            log.warn('DUNGEON_RESULT', 'Main task error: ' + (taskErr.message || taskErr));
        }

        // ── 15. BUG2 fix ──
        try {
            bug2Fix(savedData);
        } catch (bug2Err) {
            log.warn('DUNGEON_RESULT', 'BUG2 error: ' + (bug2Err.message || bug2Err));
        }

        // ── 16. Save all changes ──
        db._set(storageKey, savedData);

        // ── 17. Build response ──
        var resp = {
            _battleResult: 0,
            _changeInfo: {
                _items: changeItems
            },
            _lastLevel: levelInfo._lastLevel,
            _curMaxLevel: levelInfo._curMaxLevel,
            _haveTimes: remainingTimes,
            _buyTimes: savedData.scheduleInfo._dungeonBuyTimesCount[String(dungeonType)] || 0
        };

        // Add _signs for SINGA only (object format, keyed by "0", "1", etc.)
        // SINGB does NOT send _signs — its drops are materials in _changeInfo._items.
        // Only include _signs if there are actual sign entries with valid displayIds.
        // Sending _signs: {} (empty object) is technically safe but wasteful;
        // sending _signs with invalid displayId causes ImprintItem.deserialize crash.
        if (signs !== null && Object.keys(signs).length > 0) {
            resp._signs = signs;
            log.details('DUNGEON_RESULT', ['_signs', 'count=' + Object.keys(signs).length]);
        }

        log.info('DUNGEON_RESULT', 'OK WIN userId=' + userId +
            ' type=' + (DUNGEON_TYPE_NAMES[dungeonType] || dungeonType) +
            ' level=' + dungeonLevel +
            ' maxLevel=' + levelInfo._curMaxLevel +
            ' remaining=' + remainingTimes);

        callback(resp);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('dungeon', 'checkBattleResult', handleDungeonCheckBattleResult);

    window.MainServer = MainServer;
})();