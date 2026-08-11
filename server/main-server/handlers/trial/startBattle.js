/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: trial/startBattle
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TUGAS UTAMA
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Menyusun data tim musuh (enemy team) untuk pertempuran Temple Trial.
 *  Client TIDAK mengirim trialID/floor — server infer dari
 *  savedData.trialState._lastLess + 1.
 *
 *  Handler ini JUGA:
 *  - Mengecek & melakukan daily reset (UTC+8)
 *  - Menghitung waktu recovery times
 *  - Mengurangi 1x battle times
 *  - Menolak jika times = 0 atau floor >= 900
 *  - Meng-advance daily task templeTestBattle (taskDaily #6112)
 *
 *  Handler ini TIDAK:
 *  - Grant reward (→ trial/checkBattleResult)
 *  - Advance floor / update _lastLess (→ trial/checkBattleResult)
 *  - Buy times (→ trial/vipBuy)
 *  - Daily reward (→ trial/getDailyReward)
 *  - Main quest advance (→ trial/checkBattleResult)
 *  - Buy/get fund (→ trial/buyFund, trial/getFundReward)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  CLIENT CALL SITE (main.min.js L64284-64298)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  BattleCallBack.templeTrialBattle(battleBg, getBossPos, sound, team, super)
 *    ↓
 *  OpenGotoBattlePage.openBattleStartPageWithBattle(closeFn, startFn, ...)
 *    ↓ startFn(team, super)
 *  ts.processHandler({
 *    type: "trial",
 *    action: "startBattle",
 *    userId: UserInfoSingleton.getInstance().userId,
 *    version: "1.0",
 *    team: e,                ← array of hero IDs
 *    "super": a,             ← array of super skill IDs
 *    battleField: BattleLogic.GameFieldType.TEMPLETEST  // = 7
 *  }, function(r) {
 *    UserInfoSingleton.getInstance().setMyTeamByType(LAST_TEAM_TYPE.TEMPLE, e, a);
 *    UserInfoSingleton.getInstance().battleId = r._battleId;
 *    var i = r._rightTeam, l = r._rightSuper;
 *    RunSceneWithBattle.battleWithPVEAndTeamAndBattle(e, a, s, t, i, l, n,
 *      true, o, BattleLogic.GameFieldType.TEMPLETEST, false, 0, true);
 *  })
 *
 *  ⚠️ Client TIDAK mengirim trialID/floor — di-infer server dari _lastLess.
 *  ⚠️ Client TIDAK punya error callback — hanya success callback.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  RESPONSE FORMAT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Success:
 *  {
 *    _battleId: "uuid",
 *    _rightTeam: {                    ← OBJECT keyed by string position
 *      "0": { _heroDisplayId, _heroLevel, _heroStar, _skills, _attrs,
 *              _skinId, _weaponHaloId, _weaponHaloLevel },
 *      "1": { ... },
 *      "2": { ... },
 *      "3": { ... },
 *      "4": { ... }
 *    },
 *    _rightSuper: []                  ← SELALU empty (trial enemy tanpa super skill)
 *  }
 *
 *  Error:  callback({}, 1)  ← empty object + error code
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TEMPLE TEST JSON STRUCTURE (templeTest.json per floor)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Fields yang DIPAKAI startBattle:
 *    id, enemyList, enemyLevel, controlResist, monsterType, isBoss,
 *    difficultyHp, difficultyAttack, difficultyArmor
 *
 *  Fields yang TIDAK dipakai startBattle (dipakai client atau checkBattleResult):
 *    name, power, showHero, showNum, battleBackGround, battleMusic,
 *    nextID, awardNum, award1-4, num1-4, awardShow
 *
 *  Format:
 *    enemyList:     "1904,1906,55001,55105,55001"  (comma-separated hero IDs)
 *    enemyLevel:    "20,20,22,22,22"                (comma-separated levels)
 *    controlResist: ",,,10000,"                    (comma-separated, empty=0)
 *    monsterType:   "strength,strength,skill,skill,body"  ← PER-POSITION override!
 *    isBoss:        4                              (index of boss position, 0-based)
 *    difficultyHp:   "1,1,1,1.6,1"                (comma-separated multipliers)
 *    difficultyAttack: "1,1,1,1.1,1"
 *    difficultyArmor: "1,1,1,1,1"
 *
 *  Total: 900 floors (id 1-900)
 *  MAXTEMPLELESS = 900 (client constant L78752)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  MONSTERTYPE OVERRIDE — PERBEDAAN UTAMA DARI DUNGEON
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Di dungeon/startBattle: hero type diambil dari hero.json (heroType field).
 *  Di trial/startBattle:   hero type di-OVERRIDE oleh templeTest.json
 *                          (monsterType field per-position).
 *
 *  Ini KRTIS karena monsterType menentukan type category (SKL/ATK/TANK)
 *  yang mempengaruhi formula HP_base dan ATK_base.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  ENEMY STAT COMPUTATION (identik dungeon/startBattle — HAR-VERIFIED)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  HP_base by type category:
 *    SKL (strength/skill/dot):         floor(LA.hp/2 - 240)
 *    ATK (critical/criticalSingle/hit): floor(LA.hp/2 - 14*level - 290)
 *    TANK (body/block/dodge/armor/armorS/bodyDamage): floor(LA.hp/2 + 412)
 *
 *  ATK_base by type category:
 *    SKL:  13*level + 47
 *    ATK:  round(12.25*level + 51)
 *    TANK: round(9*level + 1)
 *
 *  Final: HP = hpBase * difficultyHp,  ATK = atkBase * difficultyAtk
 *         ARMOR = LA.armor - 21 (NOT multiplied)
 *
 *  Sub-stats derived from level, NOT hero.json values.
 *  Speed directly from hero.json.
 *  energyMax from hero.json.
 *  Power computed from stats.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DAILY TASK
 *  ══════════════════════════════════════════════════════════════════
 *
 *  taskDaily #6112:
 *    taskType: "templeTestBattle",  taskPara1: 1,  levelNeeded: 23
 *    → "Lakukan 1x Temple Trial battle per hari"
 *    → START-based (bukan victory-based)
 *    → Advance di sini (startBattle), bukan checkBattleResult
 *
 *  Progress: savedData._dailyTaskProgress["templeTestBattle"] = count
 *  State:   savedData._dailyTaskStates[6112] = TASK_STATE
 *  TASK_STATE: DEFAULT(0), DOING(1), COMPLETE(2), FINISH(3)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  JSON RESOURCE YANG DI-LOAD
 *  ══════════════════════════════════════════════════════════════════
 *
 *  ✅ templeTest.json     — enemy config per floor (900 entries)
 *  ✅ hero.json           — hero data lookup (speed, type, normal/skill)
 *  ✅ heroLevelAttr.json  — base HP/ATK/Armor per level
 *  ✅ constant.json       — templeTestTimes(10), templeTestTimesRefresh(1800)
 *  ✅ taskDaily.json      — task #6112 (templeTestBattle)
 *
 *  ❌ TIDAK DI-LOAD:
 *    templeDaily.json        → untuk trial/getDailyReward
 *    templePrivilege.json    → untuk trial/getFundReward
 *    templePrivilegeBuy.json → untuk trial/buyFund
 *    dungeonTimesBuy.json    → untuk trial/vipBuy
 *    task.json               → untuk trial/checkBattleResult (main quest)
 *    taskAchievement.json    → untuk task system (handler lain)
 *    open.json               → level check sudah di client-side
 *
 *  ══════════════════════════════════════════════════════════════════
 *  BATTLE TIMES MANAGEMENT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Max times:       constant.json → templeTestTimes = 10
 *  Recovery:        1 time per templeTestTimesRefresh = 1800 detik (30 menit)
 *  Buy max:         templeTestTimesCanBuy = 6 (→ trial/vipBuy)
 *  Daily reset:     times reset ke 10, buyCount reset ke 0
 *
 *  Alur di startBattle:
 *  1. Daily reset check (jika hari berganti UTC+8)
 *  2. computeTimeRecovery (tambahkan recovered times ke _haveTimes)
 *  3. Jika _haveTimes <= 0 → REJECT
 *  4. _haveTimes -= 1
 *  5. _timesStartRecover = Date.now() (mulai recovery dari sekarang)
 *  6. Save ke DB
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TRIAL FLOW (Lengkap)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  [Client] openTempleTrial()
 *    → trial/getState → { _model: { _haveTimes, _lastLess, ... } }
 *    → trialID = _lastLess + 1 (atau 1 jika 0)
 *
 *  [Client] challengeBtnTap()
 *    → cek trialTimes > 0 (client-side recovery)
 *    → BattleCallBack.templeTrialBattle()
 *    → trial/startBattle { team, super, battleField:7 }
 *
 *  [SERVER] trial/startBattle  ← INI
 *    → validasi, daily reset, recovery, cek times
 *    → deduct 1 time
 *    → floor = _lastLess + 1
 *    → load templeTest.json[floor]
 *    → build _rightTeam
 *    → advance daily task
 *    → response { _battleId, _rightTeam, _rightSuper: [] }
 *
 *  [Client] battle berjalan lokal (PVE)
 *
 *  [Client] → trial/checkBattleResult { battleId, checkResult, super, ... }
 *    → grant reward, advance floor, main quest, etc.
 *
 * ================================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.trial) {
        MainServer.handlers.trial = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var MAXTEMPLELESS = 900;   // client L78752: MAXTEMPLELESS = 900
    var PLAYERLEVELID = 101;   // item ID untuk player level

    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };

    // Daily task untuk trial startBattle
    var TRIAL_DAILY_TASK_TYPE = 'templeTestBattle';  // taskDaily #6112

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
            log.warn('TRIAL_START', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('TRIAL_START', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    function getConstant(key) {
        var c = loadJson('constant');
        return (c && c[1]) ? c[1][key] : null;
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
    //  UTC+8 (CST) DATE HELPERS
    //  Identik dengan getState.js dan enterGame.js generateRetrieveDay
    // ═══════════════════════════════════════════════════════════

    function getCSTNow() {
        var now = new Date();
        return new Date(now.getTime() + (8 * 60 * 60 * 1000) + now.getTimezoneOffset() * 60 * 1000);
    }

    function getTodayStrCST() {
        var d = getCSTNow();
        var yyyy = d.getUTCFullYear();
        var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(d.getUTCDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY RESET
    //  Identik dengan getState.js checkDailyReset
    // ═══════════════════════════════════════════════════════════

    /**
     * Check and perform daily reset based on UTC+8 date.
     * MUTATES trialState in place.
     *
     * 1. Save _lastLess → _yesterdayFloor (untuk getDailyReward)
     * 2. Reset _haveTimes ke max
     * 3. Reset _timesStartRecover ke now
     * 4. Reset _buyCount ke 0
     * 5. Set _dailyDate ke today
     * 6. Set _dailyRewardClaimed ke false
     *
     * @param {Object} ts - trialState from savedData.trialState
     * @returns {boolean} true jika reset dilakukan
     */
    function checkDailyReset(ts) {
        var today = getTodayStrCST();
        if (ts._dailyDate === today) {
            return false;
        }

        log.info('TRIAL_START', 'Daily reset (was ' + (ts._dailyDate || 'none') + ', now ' + today + ')');

        ts._yesterdayFloor = ts._lastLess || 0;

        var maxTimes = Number(getConstant('templeTestTimes')) || 10;
        ts._haveTimes = maxTimes;
        ts._timesStartRecover = Date.now();
        ts._buyCount = 0;
        ts._dailyRewardClaimed = false;
        ts._dailyDate = today;

        log.details('daily_reset', [
            ['yesterdayFloor', String(ts._yesterdayFloor)],
            ['newHaveTimes', String(ts._haveTimes)],
            ['newDailyDate', ts._dailyDate]
        ]);

        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  TIME RECOVERY COMPUTATION
    //  Identik dengan getState.js computeTimeRecovery
    // ═══════════════════════════════════════════════════════════

    /**
     * Hitung recovered times dan update trialState.
     * MUTATES ts in place.
     *
     * Client formula (getTrialCount):
     *   elapsed = (now - _timesStartRecover) / 1000
     *   recovered = Math.floor(elapsed / templeTestTimesRefresh)
     *   finalCount = Math.min(_haveTimes + recovered, maxTimes)
     *
     * Server-side update agar DB konsisten dan tidak double-count.
     *
     * @param {Object} ts - trialState (MUTATED)
     */
    function computeTimeRecovery(ts) {
        var maxTimes = Number(getConstant('templeTestTimes')) || 10;
        var refreshSeconds = Number(getConstant('templeTestTimesRefresh')) || 1800;
        var refreshMs = refreshSeconds * 1000;

        if (ts._haveTimes >= maxTimes) {
            if (!ts._timesStartRecover || ts._timesStartRecover <= 0) {
                ts._timesStartRecover = Date.now();
            }
            return;
        }

        var nowMs = Date.now();
        var startRecover = ts._timesStartRecover || nowMs;

        if (startRecover > nowMs) {
            ts._timesStartRecover = nowMs;
            return;
        }

        var elapsedMs = nowMs - startRecover;
        var recoveredTimes = Math.floor(elapsedMs / refreshMs);

        if (recoveredTimes <= 0) return;

        var oldHaveTimes = ts._haveTimes;
        var newHaveTimes = Math.min(oldHaveTimes + recoveredTimes, maxTimes);
        var actualRecovered = newHaveTimes - oldHaveTimes;

        ts._timesStartRecover = startRecover + (actualRecovered * refreshMs);
        ts._haveTimes = newHaveTimes;

        log.details('recovery', [
            ['oldHaveTimes', String(oldHaveTimes)],
            ['recovered', String(actualRecovered)],
            ['newHaveTimes', String(newHaveTimes)],
            ['maxTimes', String(maxTimes)]
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  COMPUTE ENEMY ATTRS
    //  Identik dungeon/startBattle — HAR-VERIFIED
    //  DITAMBAH: monsterType parameter yang OVERRIDE hero.json type
    // ═══════════════════════════════════════════════════════════
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

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, controlResist, monsterType) {
        var levelAttr = loadJson('heroLevelAttr');
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('TRIAL_START', 'Level ' + level + ' not found in heroLevelAttr, using level 1');
        }

        var laHp = Number(lvlData.hp) || 1240;
        var laAttack = Number(lvlData.attack) || 125;
        var laArmor = Number(lvlData.armor) || 205;

        // ⚠️ PERBEDAAN DARI DUNGEON:
        // Gunakan monsterType dari templeTest.json jika ada,
        // JIKA TIDAK fallback ke hero.json heroType.
        // Ini KRTIS karena templeTest.json meng-override type per-position.
        var heroType = monsterType || heroData.heroType || heroData.type || 'strength';
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

        // Sub-stats derived from level, NOT hero.json
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

        // Build _attrs._items (42 entries, 0-41)
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
    //  Identik dungeon/startBattle
    //  Normal → _type:0 (MANDATORY!), Skill → _type:1, _level:1
    //  Official server TIDAK mengirim passive skills untuk enemy.
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
    //  PARSE TEMPLE ENEMY LIST
    //  Sama seperti dungeon parseEnemyList + TAMBAHAN monsterType
    // ═══════════════════════════════════════════════════════════

    function parseTempleEnemyList(config) {
        var enemyStr = String(config.enemyList || '');
        var levelStr = String(config.enemyLevel || '');
        var monsterTypeStr = String(config.monsterType || '');

        // Parse difficulty arrays — selalu string di templeTest.json
        var hpArr = String(config.difficultyHp || '1').split(',');
        var atkArr = String(config.difficultyAttack || '1').split(',');
        var armorArr = String(config.difficultyArmor || '1').split(',');
        var ctrlStr = String(config.controlResist || '');
        var ctrls = ctrlStr.split(',');
        var bossIdx = Number(config.isBoss) || 0;

        var enemies = enemyStr.split(',');
        var levels = levelStr.split(',');
        var monsterTypes = monsterTypeStr.split(',');

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
                monsterType: (monsterTypes[i] || '').trim(),
                isBoss: (i === bossIdx)
            });
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD SINGLE ENEMY ENTRY (_rightTeam[position])
    //  Identik dungeon/startBattle + pass monsterType ke computeEnemyAttrs
    // ═══════════════════════════════════════════════════════════

    function buildEnemyEntry(enemyInfo, heroesData) {
        var heroId = enemyInfo.heroId;

        // Lookup hero di hero.json — coba 3 cara (string key, numeric key, id match)
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
            log.warn('TRIAL_START', 'Hero ' + heroId + ' not found in hero.json, using defaults');
            heroData = {
                id: heroId, heroType: 'strength', type: 'strength',
                balanceHp: 1, balanceAttack: 1, balanceArmor: 1,
                speed: 180, normal: 100191, skill: 100101, skillLevel: 1
            };
        }

        var heroDisplayId = Number(heroData.id) || heroId;
        var heroLevel = enemyInfo.level;

        var skills = buildEnemySkills(heroData);
        // ⚠️ PASS monsterType — ini override hero.json type untuk stat computation
        var attrs = computeEnemyAttrs(
            heroData, heroLevel,
            enemyInfo.diffHp, enemyInfo.diffAtk, enemyInfo.diffArmor,
            enemyInfo.ctrlResist,
            enemyInfo.monsterType
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

        log.details('TRIAL_START', [
            ['enemy', 'pos=' + enemyInfo.position + ' id=' + heroDisplayId + ' lv=' + heroLevel +
                ' type=' + (enemyInfo.monsterType || heroData.heroType || '?') +
                (enemyInfo.isBoss ? ' BOSS' : '')],
            ['hp', attrs._items['0']._num.toFixed(2)],
            ['atk', attrs._items['1']._num.toFixed(2)],
            ['armor', attrs._items['2']._num.toFixed(2)],
            ['power', attrs._items['21']._num.toFixed(0)]
        ]);

        return entry;
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY TASK ADVANCE — templeTestBattle
    //  Pattern identik dungeon/startBattle advanceDailyTaskProgress
    // ═══════════════════════════════════════════════════════════
    //
    //  taskDaily #6112: taskType="templeTestBattle", taskPara1=1
    //  START-based: advance setiap kali startBattle dipanggil
    //
    //  Progress: savedData._dailyTaskProgress["templeTestBattle"] = count
    //  State:   savedData._dailyTaskStates[6112] = TASK_STATE

    /**
     * Advance daily task progress for templeTestBattle.
     * Mutates savedData in place.
     *
     * @param {Object} savedData — user data (MUTATED)
     * @returns {Object|null} — { taskType, taskId, oldState, newState } or null
     */
    function advanceTempleDailyTask(savedData) {
        var taskType = TRIAL_DAILY_TASK_TYPE;

        // Init progress storage
        if (!savedData._dailyTaskProgress) {
            savedData._dailyTaskProgress = {};
        }

        // Increment counter
        savedData._dailyTaskProgress[taskType] = (savedData._dailyTaskProgress[taskType] || 0) + 1;
        var curCount = savedData._dailyTaskProgress[taskType];

        log.details('TRIAL_START', [
            ['dailyTask', taskType + ' → count=' + curCount]
        ]);

        // Load daily task config
        var taskDailyCfg = loadJson('taskDaily');
        if (!taskDailyCfg) {
            log.warn('TRIAL_START', 'taskDaily.json not found, skipping daily task');
            return null;
        }

        // Find matching task entry
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
            log.details('TRIAL_START', ['dailyTask', 'No taskDaily entry for ' + taskType]);
            return null;
        }

        var targetCount = Number(matchedTask.taskPara1) || 1;

        log.details('TRIAL_START', [
            ['dailyTask', 'taskId=' + matchedTaskId + ' type=' + taskType +
                ' cur=' + curCount + ' target=' + targetCount]
        ]);

        // Init state storage
        if (!savedData._dailyTaskStates) {
            savedData._dailyTaskStates = {};
        }

        var prevState = savedData._dailyTaskStates[matchedTaskId];
        if (prevState === undefined || prevState === null) {
            // Check player level vs levelNeeded
            var levelNeeded = Number(matchedTask.levelNeeded) || 1;
            var playerLevel = 1;
            if (savedData.totalProps && savedData.totalProps._items) {
                var items = savedData.totalProps._items;
                for (var k = 0; k < items.length; k++) {
                    if (items[k]._id === PLAYERLEVELID) {
                        playerLevel = items[k]._num || 1;
                        break;
                    }
                }
            }
            prevState = (playerLevel >= levelNeeded) ? TASK_STATE.DOING : TASK_STATE.DEFAULT;
            savedData._dailyTaskStates[matchedTaskId] = prevState;
        }

        // Transition DOING → COMPLETE
        if (prevState === TASK_STATE.DOING && curCount >= targetCount) {
            savedData._dailyTaskStates[matchedTaskId] = TASK_STATE.COMPLETE;
            log.info('TRIAL_START', 'Daily task ' + matchedTaskId + ' (' + taskType +
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
    //  ENSURE TRIAL STATE
    //  Jika trialState belum ada, buat default.
    //  Seharusnya sudah ada dari getState, tapi handle graceful.
    // ═══════════════════════════════════════════════════════════

    function ensureTrialState(savedData, userId) {
        if (!savedData.trialState) {
            log.info('TRIAL_START', 'trialState missing, initializing default for: ' + userId);
            var today = getTodayStrCST();
            var maxTimes = Number(getConstant('templeTestTimes')) || 10;
            savedData.trialState = {
                _id: userId,
                _haveTimes: maxTimes,
                _timesStartRecover: Date.now(),
                _lastLess: 0,
                _lastTime: 0,
                _buyFund: false,
                _haveGotFundReward: {},
                _buyCount: 0,
                _dailyDate: today,
                _yesterdayFloor: 0,
                _dailyRewardClaimed: false
            };
        }
        return savedData.trialState;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: trial/startBattle
    // ═══════════════════════════════════════════════════════════

    function handleTrialStartBattle(request, callback) {
        var userId = request.userId;

        log.info('TRIAL_START', 'Processing trial/startBattle');
        log.details('TRIAL_START', [
            ['userId', userId || '-'],
            ['version', request.version || '-'],
            ['battleField', String(request.battleField || '-')]
        ]);

        // ── STEP 1: Validate userId ──
        if (!userId) {
            log.warn('TRIAL_START', 'Missing userId');
            callback({}, 1);
            return;
        }

        // ── STEP 2: Read savedData from DB ──
        var storageKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('TRIAL_START', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }

        // ── STEP 3: Ensure trialState exists ──
        var ts = ensureTrialState(savedData, userId);

        // ── STEP 4: Daily reset check (UTC+8) ──
        var didReset = checkDailyReset(ts);

        // ── STEP 5: Compute time recovery ──
        computeTimeRecovery(ts);

        // ── STEP 6: Check battle times ──
        if (ts._haveTimes <= 0) {
            log.warn('TRIAL_START', 'No battle times left (haveTimes=' + ts._haveTimes + ')');
            // Save recovery state sebelum reject
            db._set(storageKey, savedData);
            callback({}, 1);
            return;
        }

        // ── STEP 7: Check max floor ──
        if (ts._lastLess >= MAXTEMPLELESS) {
            log.warn('TRIAL_START', 'Already at max floor (lastLess=' + ts._lastLess + ' >= ' + MAXTEMPLELESS + ')');
            callback({}, 1);
            return;
        }

        // ── STEP 8: Determine target floor ──
        var lastLess = Number(ts._lastLess) || 0;
        var floorId = (lastLess === 0) ? 1 : lastLess + 1;

        log.details('TRIAL_START', [
            ['lastLess', String(ts._lastLess)],
            ['targetFloor', String(floorId)],
            ['haveTimes (before)', String(ts._haveTimes)]
        ]);

        // ── STEP 9: Deduct 1 battle time ──
        ts._haveTimes -= 1;
        ts._timesStartRecover = Date.now();
        ts._lastTime = Date.now();

        log.details('TRIAL_START', [
            ['haveTimes (after)', String(ts._haveTimes)]
        ]);

        // ── STEP 10: Load templeTest.json ──
        var templeTestCfg = loadJson('templeTest');
        if (!templeTestCfg) {
            log.error('TRIAL_START', 'templeTest.json not found');
            db._set(storageKey, savedData);
            callback({}, 1);
            return;
        }

        var floorCfg = templeTestCfg[String(floorId)];
        if (!floorCfg) {
            log.error('TRIAL_START', 'Floor ' + floorId + ' not found in templeTest.json');
            db._set(storageKey, savedData);
            callback({}, 1);
            return;
        }

        log.details('TRIAL_START', [
            ['config', 'templeTest[' + floorId + ']'],
            ['name', String(floorCfg.name || '-')],
            ['enemyList', String(floorCfg.enemyList)],
            ['enemyLevel', String(floorCfg.enemyLevel)],
            ['monsterType', String(floorCfg.monsterType)],
            ['difficultyHp', String(floorCfg.difficultyHp)],
            ['difficultyAttack', String(floorCfg.difficultyAttack)],
            ['isBoss', String(floorCfg.isBoss || 'none')]
        ]);

        // ── STEP 11: Load hero.json ──
        var heroesData = loadJson('hero');
        if (!heroesData) {
            log.error('TRIAL_START', 'hero.json not found');
            db._set(storageKey, savedData);
            callback({}, 1);
            return;
        }

        // ── STEP 12: Parse enemy list & build _rightTeam ──
        var enemies = parseTempleEnemyList(floorCfg);

        if (enemies.length === 0) {
            log.error('TRIAL_START', 'No enemies found in floor ' + floorId + ' config');
            db._set(storageKey, savedData);
            callback({}, 1);
            return;
        }

        log.details('TRIAL_START', [
            ['enemyCount', String(enemies.length)],
            ['positions', enemies.map(function (e) {
                return e.position + ':' + e.heroId + '(lv' + e.level + ')' +
                    (e.monsterType ? '[' + e.monsterType + ']' : '') +
                    (e.isBoss ? '[BOSS]' : '');
            }).join(', ')]
        ]);

        var rightTeam = {};
        for (var i = 0; i < enemies.length; i++) {
            var enemy = enemies[i];
            var entry = buildEnemyEntry(enemy, heroesData);
            rightTeam[String(enemy.position)] = entry;
        }

        // ── STEP 13: Advance daily task (templeTestBattle) ──
        var taskResult = null;
        try {
            taskResult = advanceTempleDailyTask(savedData);
        } catch (taskErr) {
            log.warn('TRIAL_START', 'Daily task error: ' + (taskErr.message || taskErr));
        }

        // ── STEP 14: Generate battle ID ──
        var battleId = generateUUID();

        // ── STEP 15: Save savedData to DB ──
        // (deducted times + daily task progress)
        db._set(storageKey, savedData);

        // ── STEP 16: Build & return response ──
        var resp = {
            _battleId: battleId,
            _rightTeam: rightTeam,
            _rightSuper: []
        };

        log.info('TRIAL_START', 'OK userId=' + userId +
            ' floor=' + floorId +
            ' enemies=' + enemies.length +
            ' timesLeft=' + ts._haveTimes +
            ' battleId=' + battleId +
            (taskResult ? ' TASK_COMPLETE=' + taskResult.taskId : ''));

        callback(resp);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('trial', 'startBattle', handleTrialStartBattle);

    window.MainServer = MainServer;
})();