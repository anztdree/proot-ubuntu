/**
 * handlers/arena/join.js — Arena Join Handler (DRAFT v3 — ENEMY FORMULA)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  TUGAS & TANGGUNG JAWAB FILE INI:
 * ============================================================
 *
 *  Handler ini menangani BUKA halaman Arena.
 *  User menekan tombol Arena → client kirim request →
 *  server kembalikan data user + top 6 rank → client buka scene ArenaMain.
 *
 *  TUGAS UTAMA:
 *    1. VALIDASI request (userId)
 *    2. INIT/ENSURE arena state untuk user
 *    3. BUILD _arena: data arena user sendiri
 *       - _rank, _topRank, _dailyRewardTag, _haveGotTopReward
 *       - _lastDenfenceTeam (team bertahan, format penuh)
 *       - _lastDenfenceSuperSkill
 *    4. BUILD _rank: top 6 pemain (robot dari arenaRobot.json + robotPlayer.json)
 *    5. BUILD _dailyRank: rank kemarin
 *    6. BUILD _rewardTag: tag reward harian
 *    7. RESPONSE: { _arena, _rank, _dailyRank, _rewardTag }
 *
 *  TUGAS YANG BUKAN MILIK FILE INI:
 *    - Simpan defense team (itu tugas arena/setTeam)
 *    - Mulai battle (itu tugas arena/startBattle)
 *    - Generate daftar musuh (itu tugas arena/select)
 *    - Beli extra serangan (itu tugas arena/buy)
 *    - Get rank list lengkap (itu tugas arena/getRank)
 *    - Get battle record (itu tugas arena/getRecord)
 *
 * ============================================================
 *  V3 — ENEMY FORMULA (same as dungeon/hangup):
 * ============================================================
 *
 *  Robot/Enemy stats dan power dihitung dengan formula yang SAMA
 *  persis seperti dungeon/startBattle.js dan hangup/startGeneral.js.
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
 *    - heroTypeParam.json      (player-only, weighted power)
 *    - heroPower.json          (player-only, weighted power)
 *    - heroQualityParam.json   (semua param=1, no effect)
 *    - heroQualityPower.json   (semua powerParam=1, no effect)
 *
 *  Robot = musuh polos:
 *    - star selalu 0
 *    - tidak ada equip, evolve, wakeup
 *    - stats & power = formula enemy (dungeon style)
 *    - Player defense team = data player sendiri dari save data
 *
 * ============================================================
 *  FLOW LENGKAP (dari client perspective):
 * ============================================================
 *
 *  CLIENT L57166-57188: UIWindowManager.gotoArenaPage(rankUp, isRecord)
 *    1. OpenLimit.checkArenaLimit() → cek level user
 *    2. SEND: processHandler({ type:"arena", action:"join", userId, version:"1.0" })
 *    3. RESPONSE callback:
 *       var o = response._arena;        // ArenaMainViewData.initMyData(o)
 *       var a = response._rank;         // ArenaMainViewData.initTopData(a)
 *       var r = response._dailyRank;    // e._dailyRank = r
 *       var i = response._rewardTag;    // e._rankReawardTag = i
 *    4. ts.runScene("ArenaMain", { parent, userInfo:o, top:a, dailyRank:r, rewardTag:i, rankUp, isRecord })
 *
 * ============================================================
 *  REQUEST FORMAT:
 * ============================================================
 *    { type: "arena", action: "join", userId: string, version: "1.0" }
 *
 * ============================================================
 *  RESPONSE FORMAT:
 * ============================================================
 *    {
 *      _arena: {
 *        _rank: number,                  // current rank (2001 = belum ranked)
 *        _topRank: number,               // best rank ever
 *        _dailyRewardTag: string,        // tag reward harian (date-based)
 *        _haveGotTopReward: {},          // reward top yang sudah di-claim
 *        _lastDenfenceTeam: {            // OBJECT (bukan array!), key = position string
 *          "0": { _id, _heroDisplayId, _heroStar, _heroLevel,
 *                 _attrs: { _items: { "0":{_id:0,_num:hp}, ... } },
 *                 _skills: { skillId: {_type:0,_id:skillId,_level:1}, ... },
 *                 _skinId, _weaponHaloId, _weaponHaloLevel },
 *          "1": { ... }, ...
 *        },
 *        _lastDenfenceSuperSkill: {      // OBJECT, key = position string
 *          "0": { _id: skillId, _level: 1 },
 *          "1": { _id: skillId, _level: 1 }
 *        }
 *      },
 *      _rank: [                          // Array 6 top players (robot)
 *        {
 *          _id: string,                  // robot ID (e.g., "5078")
 *          _rank: number,                // their arena rank (1-6)
 *          _basic: {
 *            _nickName: string,          // from language.json (first hero name)
 *            _level: number,             // from robotPlayer.json userLevel
 *            _headImage: string,         // "hero_icon_XXXX"
 *            _vip: 0,
 *            _headEffect: 0,
 *            _headBox: 0,
 *            _guildName: ""
 *          },
 *          _lastDenfenceTeam: { ... },   // same format as _arena._lastDenfenceTeam
 *          _lastDenfenceSuperSkill: { ... }
 *        },
 *        ... (6 entries, ranks 1-6)
 *      ],
 *      _dailyRank: number,               // rank kemarin
 *      _rewardTag: []                    // array tag reward
 *    }
 *
 * ============================================================
 *  ARENA STATE (in-memory, di MainServer._arenaStates[userId]):
 * ============================================================
 *  Setiap user punya state:
 *    _rank: 2001,            // current rank (V2: 2001, NOT 99999)
 *    _topRank: 2001,         // best rank
 *    _dailyRank: 2001,       // yesterday's rank
 *    _dailyRewardTag: '',    // daily reward tag
 *    _rewardTags: [],        // collected reward tags
 *    _attackTimes: 5,        // sisa serangan hari ini
 *    _buyTimesCount: 0,      // berapa kali beli extra
 *    _lastDailyReset: Date.now(),
 *    _defenseTeam: null,     // simple team [{heroId}, null, ...]
 *    _defenseSuper: null,    // simple super [skillId, ...]
 *    _defenseTeamFull: null, // full team (position-keyed object)
 *    _defenseSuperFull: null // full super (position-keyed object)
 *
 * ============================================================
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
        SERVER_ERROR: 99999
    };

    /** Initial rank for new players — beyond all robot-filled ranks (1-2000) */
    var INITIAL_RANK = 2001;

    /** Number of top players to show in leaderboard */
    var TOP_RANK_COUNT = 6;

    /** Number of heroes per defense team */
    var HERO_SLOTS = 5;

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADING — Sync XHR with in-memory cache
    // ═══════════════════════════════════════════════════════════

    var _arenaRobotCfg = null;      // arenaRobot.json
    var _robotPlayerCfg = null;     // robotPlayer.json
    var _heroCfg = null;            // hero.json
    var _heroLevelAttrCfg = null;   // heroLevelAttr.json
    var _languageCfg = null;        // language.json

    /**
     * Generic sync XHR loader with JSON parse and cache.
     */
    function loadJsonConfig(url, cache, name) {
        if (cache) return cache;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);  // false = synchronous
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                return JSON.parse(xhr.responseText);
            }
        } catch (e) {
            log.warn('ARENA_JOIN', 'Failed to load ' + name + ' — ' + e.message);
        }
        log.warn('ARENA_JOIN', name + ' unavailable, using empty object');
        return {};
    }

    function getArenaRobotCfg() {
        if (!_arenaRobotCfg) {
            _arenaRobotCfg = loadJsonConfig(
                './resource/json/arenaRobot.json', null, 'arenaRobot.json'
            );
        }
        return _arenaRobotCfg;
    }

    function getRobotPlayerCfg() {
        if (!_robotPlayerCfg) {
            _robotPlayerCfg = loadJsonConfig(
                './resource/json/robotPlayer.json', null, 'robotPlayer.json'
            );
        }
        return _robotPlayerCfg;
    }

    function getHeroCfg() {
        if (!_heroCfg) {
            _heroCfg = loadJsonConfig(
                './resource/json/hero.json', null, 'hero.json'
            );
        }
        return _heroCfg;
    }

    function getHeroLevelAttrCfg() {
        if (!_heroLevelAttrCfg) {
            _heroLevelAttrCfg = loadJsonConfig(
                './resource/json/heroLevelAttr.json', null, 'heroLevelAttr.json'
            );
        }
        return _heroLevelAttrCfg;
    }

    function getLanguageCfg() {
        if (!_languageCfg) {
            _languageCfg = loadJsonConfig(
                './resource/json/language.json', null, 'language.json'
            );
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
    //    finalArmor = baseArmor (NOT multiplied — difficultyArmor always 1)
    //
    //    power = floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor)
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

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk) {
        var levelAttr = getHeroLevelAttrCfg();
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('ARENA_JOIN', 'Level ' + level + ' not found in heroLevelAttr, using level 1');
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
    //
    //  From hero.json: normal → _type:0 (MANDATORY!), skill → _type:1
    //  Official server TIDAK mengirim passive skills untuk enemy.

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
        // Try string key first
        var hero = heroCfg[String(heroDisplayId)];
        if (hero) return hero;

        // Try numeric key
        hero = heroCfg[heroDisplayId];
        if (hero) return hero;

        // Search by id field
        var keys = Object.keys(heroCfg);
        for (var k = 0; k < keys.length; k++) {
            if (Number(heroCfg[keys[k]].id) === Number(heroDisplayId)) {
                return heroCfg[keys[k]];
            }
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ROBOT DEFENSE TEAM BUILDER (ENEMY FORMULA)
    // ═══════════════════════════════════════════════════════════
    //
    //  Builds _lastDenfenceTeam for robot from robotPlayer.json.
    //  Robot = musuh polos: star=0, no equip, no evolve, no wakeup.
    //  Stats & power dihitung sama persis seperti dungeon enemy.

    /**
     * Build a single robot hero entry (enemy formula).
     *
     * @param {number} heroDisplayId - Hero display ID
     * @param {number} level - Hero level
     * @param {number} diffHp - Difficulty HP multiplier (from robotPlayer.json)
     * @param {number} diffAtk - Difficulty Attack multiplier (from robotPlayer.json)
     * @returns {Object|null} Hero entry for _lastDenfenceTeam
     */
    function buildRobotHeroEntry(heroDisplayId, level, diffHp, diffAtk) {
        if (!heroDisplayId || heroDisplayId <= 0) return null;

        var heroData = lookupHero(heroDisplayId);
        if (!heroData) {
            log.warn('ARENA_JOIN', 'heroDisplayId ' + heroDisplayId + ' not in hero.json');
            return null;
        }

        // Compute attrs using ENEMY formula (same as dungeon/hangup)
        var attrs = computeEnemyAttrs(heroData, level, diffHp, diffAtk);

        // Build skills from hero.json
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
     *
     * @param {Object} robotData - Entry from robotPlayer.json
     *   { id, userLevel, enemyList, enemyLevel, difficultyHp, difficultyAttack, difficultyArmor }
     * @returns {Object} Position-keyed team object { "0": entry, "1": entry, ... }
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

    /**
     * Build a complete robot entry for the _rank leaderboard array.
     *
     * @param {string} robotId - Robot ID from arenaRobot.json (e.g., "5078")
     * @param {number} rank - Arena rank (1-6)
     * @returns {Object|null} Full robot entry for _rank array, or null
     */
    function buildRobotLeaderboardEntry(robotId, rank) {
        var robotPlayerCfg = getRobotPlayerCfg();
        var robotData = robotPlayerCfg[robotId];

        if (!robotData) {
            log.warn('ARENA_JOIN', 'Robot ' + robotId + ' not found in robotPlayer.json');
            return null;
        }

        // Parse the first hero's displayId for naming and headImage
        var firstHeroId = 0;
        var heroIds = (robotData.enemyList || '').split(',');
        if (heroIds.length > 0) {
            firstHeroId = parseInt(heroIds[0], 10);
        }

        var robotName = getHeroName(firstHeroId);
        var headImage = 'hero_icon_' + firstHeroId;

        // Build the defense team with ENEMY formula
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
                _guildName: ''
            },
            _lastDenfenceTeam: defenseTeam,
            _lastDenfenceSuperSkill: {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  TOP 6 LEADERBOARD BUILDER
    // ═══════════════════════════════════════════════════════════

    function buildTopRankLeaderboard() {
        var arenaRobotCfg = getArenaRobotCfg();
        var topRank = [];

        for (var rank = 1; rank <= TOP_RANK_COUNT; rank++) {
            var rankEntry = arenaRobotCfg[String(rank)];
            if (!rankEntry) {
                log.warn('ARENA_JOIN', 'arenaRobot.json missing rank ' + rank);
                continue;
            }

            var robotId = rankEntry.robotID;
            if (!robotId) continue;

            var robotEntry = buildRobotLeaderboardEntry(robotId, rank);
            if (robotEntry) {
                topRank.push(robotEntry);
            }
        }

        return topRank;
    }

    // ═══════════════════════════════════════════════════════════
    //  PLAYER DEFENSE TEAM BUILDER
    // ═══════════════════════════════════════════════════════════
    //
    //  Player defense team menggunakan data hero player sendiri
    //  dari save data (stats sudah benar dari autoLevelUp).
    //  TIDAK menggunakan enemy formula — ini data player asli.

    /**
     * Build a hero entry for the player's defense team.
     * Uses the hero's existing _attrs from save data (stats already
     * calculated correctly by autoLevelUp). No recalculation needed.
     *
     * @param {Object} heroDef - Hero data from player's saved collection
     * @returns {Object|null} Full hero entry for _lastDenfenceTeam
     */
    function buildPlayerHeroEntry(heroDef) {
        if (!heroDef) return null;

        var displayId = Number(heroDef._heroDisplayId || heroDef._heroId) || 0;
        if (displayId <= 0) return null;

        var heroCfg = getHeroCfg();
        if (!heroCfg || !heroCfg[String(displayId)]) {
            log.warn('ARENA_JOIN', 'heroDisplayId ' + displayId + ' not in hero.json');
            return null;
        }

        var heroId = heroDef._id ? String(heroDef._id) : String(displayId);
        var star = Number(heroDef._heroStar) || 0;
        var level = Number(heroDef._heroLevel) || 1;

        // Player hero stats dari save data — sudah benar dari autoLevelUp
        // Gunakan _attrs yang sudah ada, jangan hitung ulang
        var attrs;
        if (heroDef._attrs && heroDef._attrs._items) {
            attrs = heroDef._attrs;
        } else {
            // Fallback: build minimal attrs dari data yang tersimpan
            // Ini seharusnya jarang terjadi karena autoLevelUp selalu set _attrs
            attrs = {
                _items: {
                    '0': { _id: 0, _num: Number(heroDef._hp) || 0 },
                    '1': { _id: 1, _num: Number(heroDef._attack) || 0 },
                    '2': { _id: 2, _num: Number(heroDef._armor) || 0 },
                    '3': { _id: 3, _num: 0 },
                    '21': { _id: 21, _num: Number(heroDef._power) || 0 }
                }
            };
            log.warn('ARENA_JOIN', 'Hero ' + displayId + ' missing _attrs in save data, using fallback');
        }

        return {
            _id: heroId,
            _heroId: heroId,
            _heroDisplayId: displayId,
            _heroStar: star,
            _heroLevel: level,
            _skinId: heroDef._skinId || 0,
            _weaponHaloId: heroDef._weaponHaloId || 0,
            _weaponHaloLevel: heroDef._weaponHaloLevel || 0,
            _attrs: attrs
        };
    }

    /**
     * Build the player's defense team for _arena response.
     *
     * Priority:
     *   1. Cached full team from setTeam handler (MainServer._arenaStates)
     *   2. Rebuild from savedData._arenaTeam + hero collection
     *   3. Empty team {}
     *
     * @param {string} userId - The user's ID
     * @param {Object} savedData - The user's saved data from DB
     * @returns {Object} Position-keyed team object
     */
    function buildPlayerDefenseTeam(userId, savedData) {
        // Priority 1: Cached full team from setTeam handler
        var arenaStates = MainServer._arenaStates;
        if (arenaStates && arenaStates[userId] && arenaStates[userId]._defenseTeamFull) {
            var full = arenaStates[userId]._defenseTeamFull;
            var hasEntries = false;
            for (var k in full) { if (full.hasOwnProperty(k)) { hasEntries = true; break; } }
            if (hasEntries) return full;
        }

        // Priority 2: Rebuild from saved _arenaTeam + hero collection
        var arenaTeam = savedData._arenaTeam;
        if (arenaTeam && Array.isArray(arenaTeam) && arenaTeam.length > 0) {
            var heros = (savedData.heros && savedData.heros._heros) || savedData._heros;
            if (heros) {
                var team = {};
                for (var i = 0; i < arenaTeam.length; i++) {
                    var slot = arenaTeam[i];
                    if (!slot || !slot._id) continue;

                    var heroId = String(slot._id);
                    var found = null;

                    // Search hero collection for matching hero
                    for (var hk in heros) {
                        if (!heros.hasOwnProperty(hk)) continue;
                        var h = heros[hk];
                        if (!h) continue;
                        var hDefId = String(h._heroId || '');
                        var hInstId = String(h._id || '');
                        if (hDefId === heroId || hInstId === heroId) {
                            found = h;
                            break;
                        }
                    }

                    if (found) {
                        var entry = buildPlayerHeroEntry(found);
                        if (entry) {
                            team[String(i)] = entry;
                        }
                    }
                }
                var hasTeamEntries = false;
                for (var tk in team) { if (team.hasOwnProperty(tk)) { hasTeamEntries = true; break; } }
                if (hasTeamEntries) return team;
            }
        }

        // Priority 3: Empty team (no heroes set yet)
        return {};
    }

    /**
     * Build the player's defense super skills for _arena response.
     *
     * @param {string} userId - The user's ID
     * @param {Object} savedData - The user's saved data from DB
     * @returns {Object} Position-keyed super skill object
     */
    function buildPlayerDefenseSuper(userId, savedData) {
        // Priority 1: Cached full super from setTeam handler
        var arenaStates = MainServer._arenaStates;
        if (arenaStates && arenaStates[userId] && arenaStates[userId]._defenseSuperFull) {
            var full = arenaStates[userId]._defenseSuperFull;
            var hasEntries = false;
            for (var k in full) { if (full.hasOwnProperty(k)) { hasEntries = true; break; } }
            if (hasEntries) return full;
        }

        // Priority 2: Rebuild from saved _arenaSuper
        var arenaSuper = savedData._arenaSuper;
        if (arenaSuper && Array.isArray(arenaSuper) && arenaSuper.length > 0) {
            var supers = {};
            for (var i = 0; i < arenaSuper.length; i++) {
                if (arenaSuper[i] && arenaSuper[i]._id) {
                    supers[String(i)] = { _id: String(arenaSuper[i]._id), _level: 1 };
                }
            }
            return supers;
        }

        return {};
    }

    // ═══════════════════════════════════════════════════════════
    //  ARENA STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════
    //  DAILY RESET — sama logic arena/getDailyReward.js v3
    //  Game daily reset pukul 22:00. Jika jam < 22 → game day = kemarin.
    // ═══════════════════════════════════════════════════════════

    var DAILY_RESET_HOUR = 22;

    function generateDailyTag() {
        var d = new Date();
        if (d.getHours() < DAILY_RESET_HOUR) {
            d.setDate(d.getDate() - 1);
        }
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return 'arena_daily_' + y + m + day;
    }

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

            // ═══ FIX: Restore daily reward claim state dari DB ═══
            // getDailyReward.js v3 persist savedData._arenaLastDailyClaim.
            // Jika match game-day tag saat ini → user sudah klaim periode ini
            // → restore _dailyRewardTag & _rewardTags supaya client
            //   hasGotReward()=true → tombol DISABLE.
            // Jika tidak match → periode baru → tombol VISIBLE (bisa klaim).
            var todayTag = generateDailyTag();
            var arenaState = MainServer._arenaStates[userId];
            if (savedData && savedData._arenaLastDailyClaim === todayTag) {
                arenaState._dailyRewardTag = todayTag;
                arenaState._rewardTags = [todayTag];
                log.info('ARENA_JOIN', 'Restored daily claim from DB — userId=' + userId +
                    ' tag=' + todayTag + ' (button DISABLED)');
            } else {
                log.info('ARENA_JOIN', 'Daily reward NOT claimed this period — userId=' + userId +
                    ' gameDayTag=' + todayTag + ' (button VISIBLE)');
            }

            log.info('ARENA_JOIN', 'Restored arena state for userId=' + userId +
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
    //  MAIN HANDLER — handleArenaJoin
    // ═══════════════════════════════════════════════════════════

    function handleArenaJoin(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'arena/join processing (v3 enemy-formula)');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {

            // ═══ STEP 1: VALIDASI — userId wajib ada ═══
            if (!userId) {
                log.error('HANDLER', 'Missing userId');
                callback(buildError(RET_CODES.MISSING_USERID, 'userId tidak boleh kosong'), RET_CODES.MISSING_USERID);
                return;
            }

            // ═══ STEP 2: LOAD USER DATA dari DB ═══
            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.error('HANDLER', 'User data not found for userId: ' + userId);
                callback(buildError(RET_CODES.USER_NOT_FOUND, 'User tidak ditemukan'), RET_CODES.USER_NOT_FOUND);
                return;
            }

            // ═══ STEP 3: ENSURE ARENA STATE (init jika belum ada) ═══
            var arenaState = ensureArenaState(userId);

            // ═══ STEP 4: BUILD _arena — data player sendiri ═══
            var defenseTeam = buildPlayerDefenseTeam(userId, savedData);
            var defenseSuper = buildPlayerDefenseSuper(userId, savedData);

            var arenaData = {
                _rank: arenaState._rank,
                _topRank: arenaState._topRank,
                _dailyRewardTag: arenaState._dailyRewardTag || '',
                _haveGotTopReward: arenaState._haveGotTopReward || {},
                _lastDenfenceTeam: defenseTeam,
                _lastDenfenceSuperSkill: defenseSuper
            };

            log.info('HANDLER', 'player arena data built — rank:' + arenaState._rank +
                ' topRank:' + arenaState._topRank +
                ' defenseHeroes:' + Object.keys(defenseTeam).length);

            // ═══ STEP 5: BUILD _rank — top 6 leaderboard dari config ═══
            var topRank = buildTopRankLeaderboard();

            // ═══ STEP 6: BUILD _dailyRank & _rewardTag ═══
            var dailyRank = arenaState._dailyRank || INITIAL_RANK;
            var rewardTag = arenaState._rewardTags || [];

            // ═══ STEP 7: ASSEMBLE & SEND RESPONSE ═══
            var response = {
                _arena: arenaData,
                _rank: topRank,
                _dailyRank: dailyRank,
                _rewardTag: rewardTag
            };

            log.info('HANDLER', 'arena/join response ready — topPlayers:' + topRank.length +
                ' dailyRank:' + dailyRank);

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'arena/join UNCAUGHT ERROR', err);
            callback(buildError(RET_CODES.SERVER_ERROR, err.message || 'Unknown error'), RET_CODES.SERVER_ERROR);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('arena', 'join', handleArenaJoin);

    window.MainServer = MainServer;

})();