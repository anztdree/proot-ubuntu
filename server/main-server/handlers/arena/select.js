/**
 * handlers/arena/select.js — Arena Select Handler (v3 — ENEMY FORMULA)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  RESPONSIBILITIES OF THIS FILE:
 * ============================================================
 *
 *  This handler generates a list of 5 enemy robots for the player
 *  to choose from in the Arena Battle screen.
 *
 *  Called when:
 *    1. User taps "Battle" button on Arena main page → opens ArenaBattleChoose
 *    2. User taps "Change Enemy" → refreshes the enemy list
 *
 *  PRIMARY TASKS:
 *    1. VALIDATE request (userId)
 *    2. DETERMINE the appropriate robot pool tier based on player rank
 *    3. PICK 5 random robots from the tier pool (shuffle + first 5)
 *    4. ASSIGN ranks using negative offsets [-1, -2, -3, -5, -8]
 *    5. BUILD full enemy entries: _basic, _lastDenfenceTeam, _lastDenfenceSuperSkill
 *    6. RESPONSE: { _rank: [enemy1, enemy2, ..., enemy5] } (sorted by _rank asc)
 *
 * ============================================================
 *  V3 — ENEMY FORMULA (same as dungeon/hangup/join v3):
 * ============================================================
 *
 *  Robot = musuh polos: star=0, no equip, no evolve, no wakeup.
 *  Stats & power dihitung dengan formula SAMA persis seperti
 *  dungeon/startBattle.js dan hangup/startGeneral.js.
 *
 *  Config JSON yang dipakai:
 *    1. arenaRobot.json    — maps rank ranges ke robot IDs
 *    2. robotPlayer.json   — detail robot (hero team, level, difficulty)
 *    3. hero.json          — hero metadata (heroType, balancePower, speed, skill, normal)
 *    4. heroLevelAttr.json — base HP/ATK/Armor per level
 *    5. language.json      — localized hero names
 *
 *  Config JSON yang TIDAK dipakai (karena musuh polos):
 *    - zPowerQualityPara.json  (star-based, musuh star=0)
 *    - constant.json           (formula A+B^exp, bukan formula enemy)
 *
 * ============================================================
 *  CLIENT FLOW:
 * ============================================================
 *
 *  CALL SITE 1 — battleBtnTap (L157355-157377):
 *    User taps "Battle" on ArenaMain
 *    1. SEND: processHandler({ type:"arena", action:"select", userId, version:"1.0" })
 *    2. RESPONSE: ts.openWindow("ArenaBattleChoose", { value: e, rank: t._rank, ... })
 *       → `e` (the response) is passed as `value` to the window
 *
 *  CALL SITE 2 — changeEnemyBtnTap (L157500-157511):
 *    User taps "Change Enemy" to refresh
 *    1. Same request
 *    2. RESPONSE: re-renders enemy list
 *
 *  CLIENT USAGE — ArenaOtherTeam.init():
 *    Reads: e._basic._nickName, _level, _headImage, _vip, _headEffect, _headBox, _guildName
 *    Reads: e._rank, e._id
 *    Reads: e._lastDenfenceTeam[pos]._heroDisplayId, _attrs._items[21]._num (power)
 *    Sum all hero powers → t._power
 *
 * ============================================================
 *  REQUEST FORMAT:
 * ============================================================
 *    { type: "arena", action: "select", userId: string, version: "1.0" }
 *
 * ============================================================
 *  RESPONSE FORMAT:
 * ============================================================
 *    {
 *      _rank: [                    // 5 enemies, sorted by _rank ascending
 *        {
 *          _id: "5001",            // robot ID (becomes selUser in startBattle)
 *          _rank: 1996,            // assigned arena rank
 *          _basic: { ... },
 *          _lastDenfenceTeam: {    // OBJECT, key = position "0","1","2","3","4"
 *            "0": {
 *              _id: "1503",
 *              _heroDisplayId: 1503,
 *              _heroStar: 0,        // ← MUSUH POLOS, star selalu 0
 *              _heroLevel: 60,
 *              _skills: { ... },   // ← dari hero.json (normal + skill)
 *              _attrs: { _items: {  // ← object-keyed, enemy formula
 *                "0": {_id:0, _num:hp},
 *                "1": {_id:1, _num:atk},
 *                "2": {_id:2, _num:armor},
 *                ...
 *                "21": {_id:21, _num:power}
 *              }},
 *              _skinId: 0,
 *              _weaponHaloId: 0,
 *              _weaponHaloLevel: 0
 *            },
 *            ...
 *          },
 *          _lastDenfenceSuperSkill: {}
 *        },
 *        ...
 *      ]
 *    }
 *
 * ============================================================
 *  TIER-BASED ENEMY GENERATION:
 * ============================================================
 *
 *  arenaRobot.json maps rank ranges to pools of robot IDs:
 *    Rank 1-9:     1 robot each   (IDs 5078→5070), keys "1"-"9"
 *    Rank 10-50:   5 robots       (IDs 5065-5069), arenaRobot.json key "10"
 *    Rank 51-100:  10 robots      (IDs 5055-5064), arenaRobot.json key "11"
 *    Rank 101-500: 21 robots      (IDs 5034-5054), arenaRobot.json key "12"
 *    Rank 501-2000: 32 robots     (IDs 5001-5033), arenaRobot.json key "13"
 *
 *  Player rank → tier pool selection:
 *    Rank 2001+      → use 501-2000 pool (weakest tier)
 *    Rank 501-2000   → use 501-2000 pool (same tier as player)
 *    Rank 101-500    → use 101-500 pool
 *    Rank 51-100     → use 51-100 pool
 *    Rank 10-50      → use 10-50 pool
 *    Rank 1-9        → use 10-50 pool (ranks 1-9 are fixed/single, no pool)
 *
 *  Rank assignment — negative offsets from player rank:
 *    [-1, -2, -3, -5, -8] → produces 5 distinct ranks near the player
 *
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    //  STANDARD SERVER VARIABLES
    // ═══════════════════════════════════════════════════════════

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var RET_CODES = {
        OK: 0,
        MISSING_USERID: 10001,
        USER_NOT_FOUND: 10003,
        NO_ENEMIES_AVAILABLE: 10004,
        SERVER_ERROR: 99999
    };

    var INITIAL_RANK = 2001;
    var HERO_SLOTS = 5;
    var ENEMY_COUNT = 5;
    var RANK_OFFSETS = [-1, -2, -3, -5, -8];
    var MAX_ROBOT_RANK = 2000;

    var TIER_DEFS = [
        { minRank: 10,   maxRank: 50,   tierKey: '10'  },
        { minRank: 51,   maxRank: 100,  tierKey: '11'  },
        { minRank: 101,  maxRank: 500,  tierKey: '12' },
        { minRank: 501,  maxRank: 2000, tierKey: '13' }
    ];

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADING — Sync XHR with in-memory cache
    // ═══════════════════════════════════════════════════════════

    var _arenaRobotCfg = null;
    var _robotPlayerCfg = null;
    var _heroCfg = null;
    var _heroLevelAttrCfg = null;
    var _languageCfg = null;

    function loadJsonConfig(url, name) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                return JSON.parse(xhr.responseText);
            }
        } catch (e) {
            log.warn('ARENA_SELECT', 'Failed to load ' + name + ' — ' + e.message);
        }
        log.warn('ARENA_SELECT', name + ' unavailable, using empty object');
        return {};
    }

    function getArenaRobotCfg() {
        if (!_arenaRobotCfg) {
            _arenaRobotCfg = loadJsonConfig('./resource/json/arenaRobot.json', 'arenaRobot.json');
        }
        return _arenaRobotCfg;
    }

    function getRobotPlayerCfg() {
        if (!_robotPlayerCfg) {
            _robotPlayerCfg = loadJsonConfig('./resource/json/robotPlayer.json', 'robotPlayer.json');
        }
        return _robotPlayerCfg;
    }

    function getHeroCfg() {
        if (!_heroCfg) {
            _heroCfg = loadJsonConfig('./resource/json/hero.json', 'hero.json');
        }
        return _heroCfg;
    }

    function getHeroLevelAttrCfg() {
        if (!_heroLevelAttrCfg) {
            _heroLevelAttrCfg = loadJsonConfig('./resource/json/heroLevelAttr.json', 'heroLevelAttr.json');
        }
        return _heroLevelAttrCfg;
    }

    function getLanguageCfg() {
        if (!_languageCfg) {
            _languageCfg = loadJsonConfig('./resource/json/language.json', 'language.json');
        }
        return _languageCfg;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO NAME RESOLUTION
    // ═══════════════════════════════════════════════════════════

    function getHeroName(heroDisplayId) {
        var heroCfg = getHeroCfg();
        var hero = heroCfg[String(heroDisplayId)];
        if (!hero || !hero.name) {
            return 'Hero_' + heroDisplayId;
        }

        var langCfg = getLanguageCfg();
        var langEntry = langCfg[hero.name];
        if (langEntry && langEntry.cn) {
            return langEntry.cn;
        }

        return hero.name;
    }

    // ═══════════════════════════════════════════════════════════
    //  COMPUTE ENEMY ATTRS — (same as dungeon/startBattle + hangup/startGeneral)
    // ═══════════════════════════════════════════════════════════
    //
    //  Formula (for each enemy/bot hero):
    //
    //    baseHp     = type-dependent formula from heroLevelAttr[level].hp
    //    baseAttack = type-dependent formula from level
    //    baseArmor  = heroLevelAttr[level].armor - 21
    //
    //    finalHp    = baseHp * difficultyHp
    //    finalAtk   = baseAttack * difficultyAttack
    //    finalArmor = baseArmor (NOT multiplied)
    //
    //    power = floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor)

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk) {
        var levelAttr = getHeroLevelAttrCfg();
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('ARENA_SELECT', 'Level ' + level + ' not found in heroLevelAttr, using level 1');
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
        var finalHp = hpBase * (diffHp || 1);
        var finalAtk = atkBase * (diffAtk || 1);
        var finalArmor = laArmor - 21;

        // Sub-stats (same as dungeon)
        var speed = Number(heroData.speed) || 180;
        var hit, crit, critDmg, dodge, block, blockEffect, critResist;
        var armorBreak = 0, damageReduce = 0, trueDamage = 0;
        var superDamage = 0, healPlus = 0, healerPlus = 0, shielderPlus = 0;
        var damageUp = 0, damageDown = 0;
        var superDamageResist = 0, criticalDamageResist = 0, blockThrough = 0;

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

        // Power — same 3-component formula as dungeon/hangup
        var balancePower = Number(heroData.balancePower) || 1;
        var ATK_WEIGHTS = {
            'critical': 20, 'criticalSingle': 20, 'hit': 20,
            'skill': 15, 'body': 15, 'block': 15, 'armor': 15,
            'armorDamage': 15, 'armorS': 15, 'bodyDamage': 15,
            'dodge': 15, 'strength': 15, 'dot': 15
        };
        var atkWeight = ATK_WEIGHTS[heroType] || 15;
        var power = Math.floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor);

        // Build _attrs._items (object-keyed, same as dungeon)
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
        items['14'] = { _id: 14, _num: 0 };
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

    function buildEnemySkills(heroData) {
        var skills = {};

        if (heroData.normal) {
            var nId = String(heroData.normal);
            skills[nId] = { _type: 0, _id: heroData.normal, _level: 1 };
        }

        if (heroData.skill) {
            var sId = String(heroData.skill);
            skills[sId] = { _type: 1, _id: heroData.skill, _level: 1 };
        }

        return skills;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO LOOKUP HELPER
    // ═══════════════════════════════════════════════════════════

    function lookupHero(heroDisplayId) {
        var heroCfg = getHeroCfg();
        var hero = heroCfg[String(heroDisplayId)];
        if (hero) return hero;

        hero = heroCfg[heroDisplayId];
        if (hero) return hero;

        var keys = Object.keys(heroCfg);
        for (var k = 0; k < keys.length; k++) {
            if (Number(heroCfg[keys[k]].id) === Number(heroDisplayId)) {
                return heroCfg[keys[k]];
            }
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  TIER POOL RESOLUTION
    // ═══════════════════════════════════════════════════════════

    function getTierKey(playerRank) {
        if (playerRank >= 1 && playerRank <= 9) {
            return '10';
        }

        for (var i = 0; i < TIER_DEFS.length; i++) {
            var tier = TIER_DEFS[i];
            if (playerRank >= tier.minRank && playerRank <= tier.maxRank) {
                return tier.tierKey;
            }
        }

        return '13';
    }

    function getRobotPool(tierKey) {
        var arenaRobotCfg = getArenaRobotCfg();
        var tierEntry = arenaRobotCfg[tierKey];

        if (!tierEntry || !tierEntry.robotID) {
            log.warn('ARENA_SELECT', 'No robot pool for tier key: ' + tierKey);
            return [];
        }

        var ids = tierEntry.robotID.split(',');
        var pool = [];
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i].replace(/\s+/g, '');
            if (id) {
                pool.push(id);
            }
        }

        return pool;
    }

    // ═══════════════════════════════════════════════════════════
    //  ARRAY SHUFFLE (Fisher-Yates)
    // ═══════════════════════════════════════════════════════════

    function shuffleArray(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = arr[i];
            arr[i] = arr[j];
            arr[j] = temp;
        }
        return arr;
    }

    // ═══════════════════════════════════════════════════════════
    //  RANK ASSIGNMENT
    // ═══════════════════════════════════════════════════════════

    function assignEnemyRanks(playerRank) {
        var ranks = [];
        var usedRanks = {};

        for (var i = 0; i < RANK_OFFSETS.length; i++) {
            var rank = playerRank + RANK_OFFSETS[i];

            if (rank < 1) {
                rank = 1;
            }

            if (rank >= playerRank) {
                continue;
            }

            if (playerRank > MAX_ROBOT_RANK && rank > MAX_ROBOT_RANK) {
                rank = MAX_ROBOT_RANK;
            }

            while (usedRanks[rank] && rank > 1) {
                rank--;
            }
            if (usedRanks[rank]) {
                continue;
            }

            usedRanks[rank] = true;
            ranks.push(rank);
        }

        return ranks;
    }

    // ═══════════════════════════════════════════════════════════
    //  ROBOT DEFENSE TEAM BUILDER (ENEMY FORMULA)
    // ═══════════════════════════════════════════════════════════

    /**
     * Build a single robot hero entry (enemy formula).
     * Star selalu 0, stats dari enemy formula (dungeon style).
     */
    function buildRobotHeroEntry(heroDisplayId, level, diffHp, diffAtk) {
        if (!heroDisplayId || heroDisplayId <= 0) return null;

        var heroData = lookupHero(heroDisplayId);
        if (!heroData) {
            log.warn('ARENA_SELECT', 'heroDisplayId ' + heroDisplayId + ' not in hero.json');
            return null;
        }

        var attrs = computeEnemyAttrs(heroData, level, diffHp, diffAtk);
        var skills = buildEnemySkills(heroData);

        return {
            _id: String(heroDisplayId),
            _heroDisplayId: heroDisplayId,
            _heroStar: 0,              // Robot = musuh polos, star selalu 0
            _heroLevel: level,
            _skinId: 0,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: attrs
        };
    }

    /**
     * Build the complete _lastDenfenceTeam for a robot from robotPlayer.json.
     */
    function buildRobotDefenseTeam(robotData) {
        var team = {};
        if (!robotData) return team;

        var heroIds = (robotData.enemyList || '').split(',');
        var levels = (robotData.enemyLevel || '').split(',');
        var diffHps = (robotData.difficultyHp || '').split(',');
        var diffAtks = (robotData.difficultyAttack || '').split(',');

        for (var i = 0; i < heroIds.length && i < HERO_SLOTS; i++) {
            var displayId = parseInt(heroIds[i], 10);
            var level = parseInt(levels[i], 10) || 1;
            var diffHp = parseFloat(diffHps[i]) || 1;
            var diffAtk = parseFloat(diffAtks[i]) || 1;

            // Robot star selalu 0 — TIDAK perlu qualityToStar
            var entry = buildRobotHeroEntry(displayId, level, diffHp, diffAtk);
            if (entry) {
                team[String(i)] = entry;
            }
        }

        return team;
    }

    // ═══════════════════════════════════════════════════════════
    //  FULL ENEMY ROBOT BUILDER
    // ═══════════════════════════════════════════════════════════

    function buildEnemyEntry(robotId, rank) {
        var robotPlayerCfg = getRobotPlayerCfg();
        var robotData = robotPlayerCfg[robotId];

        if (!robotData) {
            log.warn('ARENA_SELECT', 'Robot ' + robotId + ' not found in robotPlayer.json');
            return null;
        }

        var firstHeroId = 0;
        var heroIds = (robotData.enemyList || '').split(',');
        if (heroIds.length > 0) {
            firstHeroId = parseInt(heroIds[0], 10);
        }

        var robotName = getHeroName(firstHeroId);
        var headImage = 'hero_icon_' + firstHeroId;

        var defenseTeam = buildRobotDefenseTeam(robotData);

        return {
            _id: String(robotId),
            _rank: rank,
            _basic: {
                _nickName: robotName,
                _level: robotData.userLevel || 60,
                _headImage: headImage,
                _vip: 0,
                _headEffect: 0,
                _headBox: 0,
                _guildName: '',
                _oriServerId: 0
            },
            _lastDenfenceTeam: defenseTeam,
            _lastDenfenceSuperSkill: {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  ARENA STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    function ensureArenaState(userId) {
        if (!MainServer._arenaStates) {
            MainServer._arenaStates = {};
        }
        if (!MainServer._arenaStates[userId]) {
            var savedData = db._get('ms_user_' + userId + '_1');
            var persistedRank = (savedData && typeof savedData._arenaRank === 'number') ? savedData._arenaRank : INITIAL_RANK;
            var persistedTopRank = (savedData && typeof savedData._arenaTopRank === 'number') ? savedData._arenaTopRank : persistedRank;

            MainServer._arenaStates[userId] = {
                _rank: persistedRank,
                _topRank: persistedTopRank,
                _dailyRank: persistedRank,
                _dailyRewardTag: '',
                _rewardTags: [],
                _attackTimes: 5,
                _buyTimesCount: 0,
                _lastDailyReset: Date.now(),
                _defenseTeam: null,
                _defenseSuper: null,
                _defenseTeamFull: null,
                _defenseSuperFull: null
            };
            log.info('ARENA_SELECT', 'Restored arena state for userId=' + userId +
                ' (rank=' + persistedRank + ' topRank=' + persistedTopRank + ')');
        }
        return MainServer._arenaStates[userId];
    }

    // ═══════════════════════════════════════════════════════════
    //  ERROR RESPONSE BUILDER
    // ═══════════════════════════════════════════════════════════

    function buildError(code, msg) {
        return {
            ret: code,
            msg: msg || 'Error'
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER — handleArenaSelect
    // ═══════════════════════════════════════════════════════════

    function handleArenaSelect(request, callback) {
        var userId = request.userId;

        log.info('ARENA_SELECT', 'arena/select processing (v3 enemy-formula)');
        log.details('ARENA_SELECT request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {

            // ═══ STEP 1: VALIDATE ═══
            if (!userId) {
                log.error('ARENA_SELECT', 'Missing userId');
                callback(buildError(RET_CODES.MISSING_USERID, 'userId is required'),
                    RET_CODES.MISSING_USERID);
                return;
            }

            // ═══ STEP 2: ENSURE ARENA STATE ═══
            var arenaState = ensureArenaState(userId);
            var playerRank = arenaState._rank || INITIAL_RANK;

            log.info('ARENA_SELECT', 'Player rank: ' + playerRank);

            // ═══ STEP 3: DETERMINE TIER POOL ═══
            var tierKey = getTierKey(playerRank);
            var pool = getRobotPool(tierKey);

            log.info('ARENA_SELECT', 'Tier key: ' + tierKey +
                ', pool size: ' + pool.length);

            if (pool.length === 0) {
                log.error('ARENA_SELECT', 'Empty robot pool for tier: ' + tierKey);
                callback(buildError(RET_CODES.NO_ENEMIES_AVAILABLE,
                    'No enemies available'), RET_CODES.NO_ENEMIES_AVAILABLE);
                return;
            }

            // ═══ STEP 4: SHUFFLE & PICK 5 ═══
            var shuffled = shuffleArray(pool.slice());
            var selectedIds = shuffled.slice(0, ENEMY_COUNT);

            if (selectedIds.length < ENEMY_COUNT) {
                log.warn('ARENA_SELECT', 'Pool has only ' + selectedIds.length +
                    ' robots, need ' + ENEMY_COUNT + ' — cycling');
                while (selectedIds.length < ENEMY_COUNT) {
                    selectedIds.push(shuffled[selectedIds.length % shuffled.length]);
                }
            }

            log.info('ARENA_SELECT', 'Selected robot IDs: [' + selectedIds.join(', ') + ']');

            // ═══ STEP 5: ASSIGN RANKS ═══
            var ranks = assignEnemyRanks(playerRank);

            while (ranks.length < selectedIds.length) {
                var fallbackRank = Math.max(1, playerRank - ranks.length - 1);
                var isDup = false;
                for (var r = 0; r < ranks.length; r++) {
                    if (ranks[r] === fallbackRank) { isDup = true; break; }
                }
                if (!isDup) {
                    ranks.push(fallbackRank);
                } else {
                    for (var tryRank = fallbackRank - 1; tryRank >= 1; tryRank--) {
                        var tryDup = false;
                        for (var r2 = 0; r2 < ranks.length; r2++) {
                            if (ranks[r2] === tryRank) { tryDup = true; break; }
                        }
                        if (!tryDup) {
                            ranks.push(tryRank);
                            break;
                        }
                    }
                }
            }

            log.info('ARENA_SELECT', 'Assigned ranks: [' + ranks.join(', ') + ']');

            // ═══ STEP 6: BUILD ENEMY ENTRIES ═══
            var enemies = [];
            for (var i = 0; i < selectedIds.length; i++) {
                var enemy = buildEnemyEntry(selectedIds[i], ranks[i]);
                if (enemy) {
                    enemies.push(enemy);
                } else {
                    log.warn('ARENA_SELECT', 'Failed to build enemy for robot ' +
                        selectedIds[i] + ', skipping');
                }
            }

            if (enemies.length === 0) {
                log.error('ARENA_SELECT', 'No valid enemies could be built');
                callback(buildError(RET_CODES.NO_ENEMIES_AVAILABLE,
                    'Failed to generate enemies'), RET_CODES.NO_ENEMIES_AVAILABLE);
                return;
            }

            // ═══ STEP 7: SORT BY _RANK ASCENDING ═══
            enemies.sort(function (a, b) {
                return a._rank - b._rank;
            });

            // ═══ STEP 8: ASSEMBLE & SEND RESPONSE ═══
            var response = {
                _rank: enemies
            };

            log.info('ARENA_SELECT', 'Response ready — ' + enemies.length + ' enemies, ' +
                'ranks: [' + enemies.map(function (e) { return e._rank; }).join(', ') + ']');

            callback(response);

        } catch (err) {
            log.error('ARENA_SELECT', 'UNCAUGHT ERROR', err);
            callback(buildError(RET_CODES.SERVER_ERROR, err.message || 'Unknown error'),
                RET_CODES.SERVER_ERROR);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('arena', 'select', handleArenaSelect);

    window.MainServer = MainServer;

})();