/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: dungeon/startBattle
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TUGAS UTAMA
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Menyusun data tim musuh (enemy team) untuk pertempuran dungeon.
 *  Client mengirim dungeonType + dungeonLevel + team pemain,
 *  server membalas dengan data tim musuh (_rightTeam) dari dungeon config.
 *
 *  Handler ini TIDAK mengurangi kali tempur / memberikan reward.
 *  Semua itu ditangani oleh dungeon/checkBattleResult.
 *
 *  Handler ini MENG-TRACK daily task progress (resourceDungeon, equipDungeon,
 *  signDungeon) via savedData._dailyTaskProgress + _dailyTaskStates.
 *  Victory-based MAIN tasks (experienceDungeonVictory, breachDungeonVictory)
 *  diproses di dungeon/checkBattleResult, bukan di sini.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  CLIENT CALL SITES
 *  ══════════════════════════════════════════════════════════════════
 *
 *  1. EQUIP dungeon (L63534-63550):
 *     { type:"dungeon", action:"startBattle", userId, dungeonType:4,
 *       dungeonLevel, version:"1.0", team, super, battleField:8 }
 *     → callback reads: _battleId, _rightTeam, _rightSuper
 *
 *  2. EXP/EVOLVE/METAL/Z_STONE (L63642-63658):
 *     { type:"dungeon", action:"startBattle", userId, dungeonType:1|2|7|8,
 *       dungeonLevel, version:"1.0", team, super, battleField }
 *     → callback reads: _battleId, _rightTeam, _rightSuper
 *
 *  3. SIGN dungeon SINGA/SINGB (L63719-63736):
 *     { type:"dungeon", action:"startBattle", userId, dungeonType:5|6,
 *       dungeonLevel, version:"1.0", team, super, battleField:33 }
 *     → callback reads: _battleId, _rightTeam, _rightSuper
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DUNGEON_TYPE ENUM (L59060)
 *  ══════════════════════════════════════════════════════════════════
 *
 *    DT_NULL = 0  (unused)
 *    EXP     = 1  → expDungeon.json
 *    EVOLVE  = 2  → evolveDungeon.json
 *    ENERGY  = 3  → energyDungeon.json (client skip in buyCount, but config exists)
 *    EQUIP   = 4  → equipDungeon.json
 *    SINGA   = 5  → signDungeonA.json
 *    SINGB   = 6  → signDungeonB.json
 *    METAL   = 7  → metalDungeon.json
 *    Z_STONE = 8  → zStoneDungeon.json
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DUNGEON JSON STRUCTURE (per level)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Common fields (all dungeon types):
 *    id, name, levelNeeded, power, showHero, showHeroLevel,
 *    enemyList:     "1906,1906,1906,1906,1906"     (comma-separated hero IDs)
 *    enemyLevel:    "18,18,18,18,18"               (comma-separated levels)
 *    controlResist: ",,,,"                         (comma-separated, empty=0)
 *    difficultyHp:   "0.6,0.6,0.6,0.96,0.6"       (string or number!)
 *    difficultyAttack: "0.6,0.6,0.6,0.66,0.6"     (string or number!)
 *    difficultyArmor: "1,1,1,1,1"                  (string or number!)
 *    battleBackGround, battleMusic
 *
 *  ⚠️ energyDungeon.json anomaly:
 *    - difficultyHp/Attack/Armor are NUMBERS (not comma-separated strings)
 *    - No monsterType, no isBoss fields
 *    - Handler must handle both formats
 *
 *  ══════════════════════════════════════════════════════════════════
 *  RESPONSE FORMAT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  {
 *    type: "dungeon",
 *    action: "startBattle",
 *    userId: "...",
 *    version: "1.0",
 *    team: [...],              ← echo request
 *    super: [...],             ← echo request
 *    battleField: N,           ← echo request
 *    dungeonType: N,           ← echo request
 *    dungeonLevel: N,          ← echo request
 *    _battleId: "uuid",
 *    _rightTeam: {             ← OBJECT keyed by string position
 *      "0": { _heroDisplayId, _heroLevel, _heroStar, _skills, _attrs, _skinId, _weaponHaloId, _weaponHaloLevel },
 *      "1": { ... },
 *      ...
 *    },
 *    _rightSuper: []           ← always empty for dungeons
 *  }
 *
 *  ══════════════════════════════════════════════════════════════════
 *  ENEMY STAT COMPUTATION (same as hangup/startGeneral — HAR-VERIFIED)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  HP_base by type category:
 *    SKL (strength/skill/dot):  floor(LA.hp/2 - 240)
 *    ATK (critical/criticalSingle/hit): floor(LA.hp/2 - 14*level - 290)
 *    TANK (body/block/dodge/armor/armorS/bodyDamage): floor(LA.hp/2 + 412)
 *
 *  ATK_base by type category:
 *    SKL:  13*level + 47
 *    ATK:  round(12.25*level + 51)
 *    TANK: round(9*level + 1)
 *
 *  Final: HP = hpBase * difficultyHp, ATK = atkBase * difficultyAtk
 *         ARMOR = LA.armor - 21 (universal, NOT multiplied)
 *
 *  Sub-stats derived from level, NOT hero.json values.
 *  Speed directly from hero.json.
 *
 * ================================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADER (cached synchronous XHR)
    // ═══════════════════════════════════════════════════════════

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
            log.warn('DUNGEON_START', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('DUNGEON_START', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  UUID GENERATOR
    // ═══════════════════════════════════════════════════════════

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  DUNGEON TYPE → JSON FILE MAPPING
    // ═══════════════════════════════════════════════════════════

    var DUNGEON_JSON_MAP = {
        1: 'expDungeon',      // DUNGEON_TYPE.EXP
        2: 'evolveDungeon',   // DUNGEON_TYPE.EVOLVE
        3: 'energyDungeon',   // DUNGEON_TYPE.ENERGY
        4: 'equipDungeon',    // DUNGEON_TYPE.EQUIP
        5: 'signDungeonA',    // DUNGEON_TYPE.SINGA
        6: 'signDungeonB',    // DUNGEON_TYPE.SINGB
        7: 'metalDungeon',    // DUNGEON_TYPE.METAL
        8: 'zStoneDungeon'    // DUNGEON_TYPE.Z_STONE
    };

    var DUNGEON_TYPE_NAMES = {
        1: 'EXP', 2: 'EVOLVE', 3: 'ENERGY', 4: 'EQUIP',
        5: 'SINGA', 6: 'SINGB', 7: 'METAL', 8: 'Z_STONE'
    };

    // ═══════════════════════════════════════════════════════════
    //  COMPUTE ENEMY ATTRS — (same as hangup/startGeneral — HAR-VERIFIED)
    // ═══════════════════════════════════════════════════════════
    //
    //  Formula (for each enemy at position p):
    //
    //    baseHp     = type-dependent formula from heroLevelAttr[level].hp
    //    baseAttack = type-dependent formula from level
    //    baseArmor  = heroLevelAttr[level].armor - 21
    //
    //    finalHp    = baseHp * difficultyHp[p]
    //    finalAtk   = baseAttack * difficultyAttack[p]
    //    finalArmor = baseArmor (NOT multiplied — difficultyArmor always 1)
    //
    //  ATTR ID MAPPING (HERO_ATTRIBUTE enum L73674):
    //    0:hp, 1:attack, 2:armor, 3:speed, 4:hit, 5:dodge, 6:block,
    //    7:blockEffect, 8:skillDamage, 9:critical, 10:criticalResist,
    //    11:criticalDamage, 12:armorBreak, 13:damageReduce, 14:controlResist,
    //    15:trueDamage, 16:RemainEnergy, 21:Power, 22:FullHealth,
    //    23:superDamage, 24:healPlus, 25:healerPlus, 26:ExtraArmor,
    //    27:shielderPlus, 28:damageUp, 29:damageDown, 30:talent,
    //    31:superDamageResist, 36:criticalDamageResist, 37:blockThrough,
    //    41:energyMax

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, controlResist) {
        var levelAttr = loadJson('heroLevelAttr');
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('DUNGEON_START', 'Level ' + level + ' not found in heroLevelAttr, using level 1');
        }

        var laHp = Number(lvlData.hp) || 1240;
        var laAttack = Number(lvlData.attack) || 125;
        var laArmor = Number(lvlData.armor) || 205;

        // Determine type category
        var heroType = heroData.heroType || heroData.type || 'strength';
        var typeCategory;
        if (heroType === 'critical' || heroType === 'criticalSingle' || heroType === 'hit') {
            typeCategory = 'ATK';
        } else if (heroType === 'body' || heroType === 'block' || heroType === 'dodge' ||
                   heroType === 'armor' || heroType === 'armorS' || heroType === 'bodyDamage') {
            typeCategory = 'TANK';
        } else {
            typeCategory = 'SKL';
        }

        // HP_base
        var hpBase;
        if (typeCategory === 'SKL') {
            hpBase = Math.floor(laHp / 2 - 240);
        } else if (typeCategory === 'ATK') {
            hpBase = Math.floor(laHp / 2 - 14 * level - 290);
        } else {
            hpBase = Math.floor(laHp / 2 + 412);
        }

        // ATK_base
        var atkBase;
        if (typeCategory === 'SKL') {
            atkBase = 13 * level + 47;
        } else if (typeCategory === 'ATK') {
            atkBase = Math.round(12.25 * level + 51);
        } else {
            atkBase = Math.round(9 * level + 1);
        }

        // Apply difficulty multipliers
        var finalHp = hpBase * diffHp;
        var finalAtk = atkBase * diffAtk;
        var finalArmor = laArmor - 21;

        // Sub-stats
        var speed = Number(heroData.speed) || 180;
        var hit, crit, critDmg, dodge, block, blockEffect, critResist;
        var armorBreak = 0, damageReduce = 0, trueDamage = 0;
        var superDamage = 0, healPlus = 0, healerPlus = 0, shielderPlus = 0;
        var damageUp = 0, damageDown = 0;
        var superDamageResist = 0, criticalDamageResist = 0, blockThrough = 0;
        var ctrlResist = (controlResist > 0) ? controlResist : 0;

        if (typeCategory === 'SKL') {
            hit = level / 14000;
            crit = hit * 2.5;
            critDmg = crit * 1.5;
            dodge = 0; block = 0; blockEffect = 0; critResist = 0;
        } else if (typeCategory === 'ATK') {
            hit = level / 2000;
            crit = hit * 0.5;
            critDmg = 0.3;
            dodge = 0; block = 0; blockEffect = 0; critResist = 0;
        } else {
            hit = level / 3043;
            crit = hit * 0.5;
            critDmg = hit;
            dodge = level / 2500;
            block = level / 8000;
            blockEffect = 0;
            critResist = level / 6667;
        }

        // Power
        var balancePower = Number(heroData.balancePower) || 1;
        var ATK_WEIGHTS = {
            'critical': 20, 'criticalSingle': 20, 'hit': 20,
            'skill': 15, 'body': 15, 'block': 15, 'armor': 15,
            'armorDamage': 15, 'armorS': 15, 'bodyDamage': 15,
            'dodge': 15, 'strength': 15, 'dot': 15
        };
        var atkWeight = ATK_WEIGHTS[heroType] || 15;
        var power = Math.floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor);

        // Build _attrs._items
        var items = {};
        items['0'] = { _id: 0,  _num: finalHp };
        items['1'] = { _id: 1,  _num: finalAtk };
        items['2'] = { _id: 2,  _num: finalArmor };
        items['3'] = { _id: 3,  _num: speed };
        items['4'] = { _id: 4,  _num: hit };
        items['5'] = { _id: 5,  _num: dodge };
        items['6'] = { _id: 6,  _num: block };
        items['7'] = { _id: 7,  _num: blockEffect };
        items['8'] = { _id: 8,  _num: 0 };
        items['9'] = { _id: 9,  _num: crit };
        items['10'] = { _id: 10, _num: critResist };
        items['11'] = { _id: 11, _num: critDmg };
        items['12'] = { _id: 12, _num: armorBreak };
        items['13'] = { _id: 13, _num: damageReduce };
        items['14'] = { _id: 14, _num: ctrlResist };
        items['15'] = { _id: 15, _num: trueDamage };
        items['16'] = { _id: 16, _num: 50 };
        items['21'] = { _id: 21, _num: power };
        items['22'] = { _id: 22, _num: finalHp };
        items['23'] = { _id: 23, _num: superDamage };
        items['24'] = { _id: 24, _num: healPlus };
        items['25'] = { _id: 25, _num: healerPlus };
        items['26'] = { _id: 26, _num: 0 };
        items['28'] = { _id: 28, _num: damageUp };
        items['29'] = { _id: 29, _num: damageDown };
        items['31'] = { _id: 31, _num: superDamageResist };
        items['36'] = { _id: 36, _num: criticalDamageResist };
        items['37'] = { _id: 37, _num: blockThrough };
        items['41'] = { _id: 41, _num: Number(heroData.energyMax) || 100 };

        return { _items: items };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD ENEMY SKILLS
    // ═══════════════════════════════════════════════════════════
    //
    //  From hero.json: normal → _type:0 (MANDATORY!), skill → _type:1
    //  Official server TIDAK mengirim passive skills untuk enemy.

    function buildEnemySkills(heroData) {
        var skills = {};

        // Normal attack (_type: 0) — MANDATORY
        if (heroData.normal) {
            var nId = String(heroData.normal);
            skills[nId] = { _type: 0, _id: heroData.normal, _level: 1 };
        }

        // Proactive/Active skill (_type: 1) — always _level:1 per HAR
        if (heroData.skill) {
            var sId = String(heroData.skill);
            skills[sId] = { _type: 1, _id: heroData.skill, _level: 1 };
        }

        return skills;
    }

    // ═══════════════════════════════════════════════════════════
    //  PARSE DUNGEON ENEMY CONFIG
    // ═══════════════════════════════════════════════════════════
    //
    //  Handles both formats:
    //  - Standard: "0.6,0.6,0.6,0.96,0.6" (comma-separated string)
    //  - Energy:   1 (plain number, applied to all positions)

    function parseEnemyList(config) {
        var enemyStr = String(config.enemyList || '');
        var levelStr = String(config.enemyLevel || '');

        // Parse difficulty arrays — handle both string and number formats
        var hpRaw = config.difficultyHp;
        var atkRaw = config.difficultyAttack;
        var armorRaw = config.difficultyArmor;

        // If number, convert to 5-element array
        var hpArr, atkArr, armorArr;
        if (typeof hpRaw === 'number') {
            hpArr = [hpRaw, hpRaw, hpRaw, hpRaw, hpRaw];
        } else {
            hpArr = String(hpRaw || '1').split(',');
        }
        if (typeof atkRaw === 'number') {
            atkArr = [atkRaw, atkRaw, atkRaw, atkRaw, atkRaw];
        } else {
            atkArr = String(atkRaw || '1').split(',');
        }
        if (typeof armorRaw === 'number') {
            armorArr = [armorRaw, armorRaw, armorRaw, armorRaw, armorRaw];
        } else {
            armorArr = String(armorRaw || '1').split(',');
        }

        var ctrlStr = String(config.controlResist || '');
        var ctrls = ctrlStr.split(',');
        var bossIdx = Number(config.isBoss) || 0;

        var enemies = enemyStr.split(',');
        var levels = levelStr.split(',');

        var result = [];
        for (var i = 0; i < enemies.length && i < 5; i++) {
            var heroId = enemies[i].trim();
            if (!heroId || heroId === '') continue;

            result.push({
                position: i,
                heroId: Number(heroId),
                level: Number(levels[i] || 1),
                diffHp: Number(hpArr[i] || 1),
                diffAtk: Number(atkArr[i] || 1),
                diffArmor: Number(armorArr[i] || 1),
                ctrlResist: Number(ctrls[i] || 0),
                isBoss: (i === bossIdx)
            });
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD SINGLE ENEMY ENTRY (_rightTeam[position])
    // ═══════════════════════════════════════════════════════════

    function buildEnemyEntry(enemyInfo, heroesData) {
        var heroId = enemyInfo.heroId;

        // Lookup hero in hero.json
        var heroData = null;
        if (heroesData[String(heroId)]) {
            heroData = heroesData[String(heroId)];
        } else if (heroesData[heroId]) {
            heroData = heroesData[heroId];
        } else {
            var keys = Object.keys(heroesData);
            for (var k = 0; k < keys.length; k++) {
                if (Number(heroesData[keys[k]].id) === Number(heroId)) {
                    heroData = heroesData[keys[k]];
                    break;
                }
            }
        }

        if (!heroData) {
            log.warn('DUNGEON_START', 'Hero ' + heroId + ' not found in hero.json, using defaults');
            heroData = {
                id: heroId, heroType: 'strength', type: 'strength',
                balanceHp: 1, balanceAttack: 1, balanceArmor: 1,
                speed: 180, normal: 100191, skill: 100101, skillLevel: 1
            };
        }

        var heroDisplayId = Number(heroData.id) || heroId;
        var heroLevel = enemyInfo.level;

        var skills = buildEnemySkills(heroData);
        var attrs = computeEnemyAttrs(
            heroData, heroLevel,
            enemyInfo.diffHp, enemyInfo.diffAtk, enemyInfo.diffArmor,
            enemyInfo.ctrlResist
        );

        var entry = {
            _heroDisplayId: heroDisplayId,
            _heroLevel: heroLevel,
            _heroStar: 0,
            _skinId: 0,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: attrs
        };

        log.details('DUNGEON_START', [
            ['enemy', 'pos=' + enemyInfo.position + ' id=' + heroDisplayId + ' lv=' + heroLevel + (enemyInfo.isBoss ? ' BOSS' : '')],
            ['hp', attrs._items['0']._num.toFixed(2)],
            ['atk', attrs._items['1']._num.toFixed(2)],
            ['armor', attrs._items['2']._num.toFixed(2)],
            ['power', attrs._items['21']._num.toFixed(0)]
        ]);

        return entry;
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY TASK PROGRESS — DUNGEON TYPE → TASK TYPE MAPPING
    // ═══════════════════════════════════════════════════════════
    //
    //  taskDaily.json dungeon-related tasks:
    //    6110: taskType="resourceDungeon", taskPara1=6
    //          → EXP(1), EVOLVE(2), METAL(7), Z_STONE(8)
    //    6111: taskType="equipDungeon",    taskPara1=2
    //          → EQUIP(4)
    //    6115: taskType="signDungeon",     taskPara1=2
    //          → SINGA(5), SINGB(6)
    //    ENERGY(3) — no daily task
    //
    //  Progress stored in savedData._dailyTaskProgress = { taskType: count, ... }
    //  Used by future task/queryTask handler to return _curCount/_targetCount/_state.
    //
    //  TASK_STATE: 0=DEFAULT(locked), 1=DOING, 2=COMPLETE, 3=FINISH(claimed)
    //
    //  Note: Main task victory-based tasks (experienceDungeonVictory,
    //  breachDungeonVictory) are processed in dungeon/checkBattleResult,
    //  NOT here — they require winning, not just starting.

    var DUNGEON_TO_DAILY_TASK = {
        1: 'resourceDungeon',   // EXP
        2: 'resourceDungeon',   // EVOLVE
        4: 'equipDungeon',      // EQUIP
        5: 'signDungeon',       // SINGA
        6: 'signDungeon',       // SINGB
        7: 'resourceDungeon',   // METAL
        8: 'resourceDungeon'    // Z_STONE
    };

    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };

    /**
     * advanceDailyTaskProgress(savedData, dungeonType)
     *
     * Increment daily task progress counter for the given dungeonType.
     * Stores in savedData._dailyTaskProgress[taskType] and checks
     * against taskDaily.json config to auto-transition state.
     *
     * @param {object} savedData — user data (mutated + saved)
     * @param {number} dungeonType — DUNGEON_TYPE enum value
     * @returns {object|null} — { taskType, taskId, oldState, newState } or null
     */
    function advanceDailyTaskProgress(savedData, dungeonType) {
        var taskType = DUNGEON_TO_DAILY_TASK[dungeonType];
        if (!taskType) return null;

        // Initialize progress storage
        if (!savedData._dailyTaskProgress) {
            savedData._dailyTaskProgress = {};
        }

        // Increment counter
        savedData._dailyTaskProgress[taskType] = (savedData._dailyTaskProgress[taskType] || 0) + 1;
        var curCount = savedData._dailyTaskProgress[taskType];

        log.details('DUNGEON_START', [
            ['dailyTask', taskType + ' → count=' + curCount]
        ]);

        // Load daily task config to find matching task
        var taskDailyCfg = loadJson('taskDaily');
        if (!taskDailyCfg) {
            log.warn('DUNGEON_START', 'taskDaily.json not found, skipping task check');
            return null;
        }

        // Find the task entry matching this taskType
        var matchedTask = null;
        var matchedTaskId = null;
        for (var tid in taskDailyCfg) {
            if (taskDailyCfg[tid].taskType === taskType) {
                matchedTask = taskDailyCfg[tid];
                matchedTaskId = Number(tid);
                break;
            }
        }

        if (!matchedTask) {
            log.details('DUNGEON_START', ['dailyTask', 'No taskDaily entry for ' + taskType]);
            return null;
        }

        var targetCount = Number(matchedTask.taskPara1) || 1;

        // Log progress vs target
        log.details('DUNGEON_START', [
            ['dailyTask', 'taskId=' + matchedTaskId + ' type=' + taskType +
                ' cur=' + curCount + ' target=' + targetCount]
        ]);

        // Check if task should be marked COMPLETE
        // (stored in _dailyTaskStates for future task/queryTask handler)
        if (!savedData._dailyTaskStates) {
            savedData._dailyTaskStates = {};
        }

        var prevState = savedData._dailyTaskStates[matchedTaskId];
        if (prevState === undefined || prevState === null) {
            // Initialize state based on levelNeeded
            var levelNeeded = Number(matchedTask.levelNeeded) || 1;
            // Check player level — need to find player level from items
            var playerLevel = 1;
            if (savedData.totalProps && savedData.totalProps._items) {
                var items = savedData.totalProps._items;
                for (var k = 0; k < items.length; k++) {
                    if (items[k]._id === 101) { // PLAYERLEVELID = 101
                        playerLevel = items[k]._num || 1;
                        break;
                    }
                }
            }
            prevState = (playerLevel >= levelNeeded) ? TASK_STATE.DOING : TASK_STATE.DEFAULT;
            savedData._dailyTaskStates[matchedTaskId] = prevState;
        }

        // Transition DOING → COMPLETE if curCount >= targetCount
        if (prevState === TASK_STATE.DOING && curCount >= targetCount) {
            savedData._dailyTaskStates[matchedTaskId] = TASK_STATE.COMPLETE;
            log.info('DUNGEON_START', 'Daily task ' + matchedTaskId + ' (' + taskType +
                ') DOING → COMPLETE (cur=' + curCount + ' >= target=' + targetCount + ')');

            return {
                taskType: taskType,
                taskId: matchedTaskId,
                oldState: prevState,
                newState: TASK_STATE.COMPLETE
            };
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: dungeon/startBattle
    // ═══════════════════════════════════════════════════════════

    function handleDungeonStartBattle(request, callback) {
        var userId = request.userId;
        var dungeonType = Number(request.dungeonType);
        var dungeonLevel = Number(request.dungeonLevel);

        log.info('DUNGEON_START', 'Processing dungeon/startBattle request');
        log.details('DUNGEON_START', [
            ['userId', userId || '-'],
            ['dungeonType', String(dungeonType) + '(' + (DUNGEON_TYPE_NAMES[dungeonType] || 'UNKNOWN') + ')'],
            ['dungeonLevel', String(dungeonLevel)],
            ['team', request.team ? JSON.stringify(request.team).substring(0, 200) : '-'],
            ['super', request.super ? JSON.stringify(request.super).substring(0, 200) : '-'],
            ['battleField', String(request.battleField || '-')]
        ]);

        // ── 1. Validate userId ──
        if (!userId) {
            log.warn('DUNGEON_START', 'Missing userId');
            callback({}, 1);
            return;
        }

        // ── 2. Load savedData (needed for daily task progress) ──
        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('DUNGEON_START', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }

        // ── 3. Validate dungeonType ──
        var jsonName = DUNGEON_JSON_MAP[dungeonType];
        if (!jsonName) {
            log.warn('DUNGEON_START', 'Invalid dungeonType=' + dungeonType);
            callback({}, 1);
            return;
        }

        // ── 4. Validate dungeonLevel ──
        if (!dungeonLevel || dungeonLevel < 1) {
            log.warn('DUNGEON_START', 'Invalid dungeonLevel=' + dungeonLevel);
            callback({}, 1);
            return;
        }

        // ── 5. Load dungeon config ──
        var dungeonCfg = loadJson(jsonName);
        if (!dungeonCfg) {
            log.error('DUNGEON_START', jsonName + '.json not found');
            callback({}, 1);
            return;
        }

        var levelCfg = dungeonCfg[String(dungeonLevel)];
        if (!levelCfg) {
            log.error('DUNGEON_START', 'Level ' + dungeonLevel + ' not found in ' + jsonName + '.json');
            callback({}, 1);
            return;
        }

        log.details('DUNGEON_START', [
            ['config', jsonName + '[' + dungeonLevel + ']'],
            ['name', String(levelCfg.name || '-')],
            ['enemyList', String(levelCfg.enemyList)],
            ['enemyLevel', String(levelCfg.enemyLevel)],
            ['difficultyHp', String(levelCfg.difficultyHp)],
            ['difficultyAttack', String(levelCfg.difficultyAttack)],
            ['isBoss', String(levelCfg.isBoss || 'none')]
        ]);

        // ── 6. Load hero.json for hero data lookup ──
        var heroesData = loadJson('hero');
        if (!heroesData) {
            log.error('DUNGEON_START', 'hero.json not found');
            callback({}, 1);
            return;
        }

        // ── 7. Parse enemy list from dungeon config ──
        var enemies = parseEnemyList(levelCfg);

        if (enemies.length === 0) {
            log.error('DUNGEON_START', 'No enemies found in level config');
            callback({}, 1);
            return;
        }

        log.details('DUNGEON_START', [
            ['enemyCount', String(enemies.length)],
            ['positions', enemies.map(function (e) {
                return e.position + ':' + e.heroId + '(lv' + e.level + ')' + (e.isBoss ? '[BOSS]' : '');
            }).join(', ')]
        ]);

        // ── 8. Build _rightTeam ──
        var rightTeam = {};
        for (var i = 0; i < enemies.length; i++) {
            var enemy = enemies[i];
            var entry = buildEnemyEntry(enemy, heroesData);
            rightTeam[String(enemy.position)] = entry;
        }

        // ── 9. Generate battle ID ──
        var battleId = generateUUID();

        // ── 10. Daily Task Progress ──
        //
        //  Increment daily task counters for dungeon battles.
        //  taskDaily.json:
        //    6110: resourceDungeon (para1=6) → EXP/EVOLVE/METAL/Z_STONE
        //    6111: equipDungeon (para1=2)    → EQUIP
        //    6115: signDungeon (para1=2)     → SINGA/SINGB
        //
        //  Progress stored in savedData._dailyTaskProgress (count per taskType)
        //  State stored in savedData._dailyTaskStates (state per taskId)
        //  Ready for future task/queryTask handler to read.
        //
        //  Note: Victory-based MAIN tasks (experienceDungeonVictory,
        //  breachDungeonVictory) are processed in dungeon/checkBattleResult.

        var taskResult = null;
        try {
            taskResult = advanceDailyTaskProgress(savedData, dungeonType);
            if (taskResult || savedData._dailyTaskProgress) {
                db._set(storageKey, savedData);
                log.info('DUNGEON_START', 'Daily task progress saved');
            }
        } catch (taskErr) {
            log.warn('DUNGEON_START', 'Daily task error: ' + (taskErr.message || taskErr));
        }

        // ── 11. Build response ──
        var resp = {
            type: request.type || 'dungeon',
            action: request.action || 'startBattle',
            userId: userId,
            version: request.version || '1.0',
            team: request.team || [],
            super: request.super || [],
            battleField: request.battleField || 0,
            dungeonType: dungeonType,
            dungeonLevel: dungeonLevel,
            _battleId: battleId,
            _rightTeam: rightTeam,
            _rightSuper: []
        };

        log.info('DUNGEON_START', 'OK userId=' + userId +
            ' type=' + (DUNGEON_TYPE_NAMES[dungeonType] || dungeonType) +
            ' level=' + dungeonLevel +
            ' enemies=' + enemies.length +
            ' battleId=' + battleId);

        callback(resp);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('dungeon', 'startBattle', handleDungeonStartBattle);

    window.MainServer = MainServer;
})();