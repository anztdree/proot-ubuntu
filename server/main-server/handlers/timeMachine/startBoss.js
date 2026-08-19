/**
 * handlers/timeMachine/startBoss.js — Time Machine Boss Battle Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  TUGAS & TANGGUNG JAWAB FILE INI:
 * ============================================================
 *
 *  Handler ini menangani START boss battle setelah time travel selesai.
 *  User sudah menyelesaikan countdown → boss muncul → user pilih team →
 *  server kembalikan enemy team (boss) + battle ID.
 *
 *  TUGAS UTAMA:
 *    1. VALIDASI request (userId, machineId, team, super)
 *    2. LOAD timeMachine state dari DB → ambil _bossId dari slot
 *    3. LOAD boss config dari timeTravelBOSS.json
 *    4. BUILD enemy team (_rightTeam) dari boss config (sama formula dungeon)
 *    5. GENERATE battle ID (UUID)
 *    6. RESPONSE: { _battleId, _rightTeam, _rightSuper }
 *
 *  TUGAS YANG BUKAN MILIK FILE INI:
 *    - Start time travel (itu tugas timeMachine/start)
 *    - Check battle result (itu tugas timeMachine/checkBattleResult)
 *    - Get reward (itu tugas timeMachine/getReward)
 *    - Simulasi battle (client-side)
 *
 * ============================================================
 *  TRACE EVIDENCE (main.min.js):
 * ============================================================
 *
 *  CLIENT REQUEST — L64739-64747:
 *    ts.processHandler({
 *      type: "timeMachine",
 *      action: "startBoss",
 *      userId: UserInfoSingleton.getInstance().userId,
 *      machineId: n,          // 1|2|3
 *      team: e,               // array of { _heroId, _position }
 *      "super": r,            // array of super skill IDs
 *      battleField: BattleLogic.GameFieldType.TIMETRAVEL
 *    }, callback)
 *
 *  CLIENT CALLBACK — L64748-64752:
 *    function(n) {
 *      UserInfoSingleton.getInstance().battleId = n._battleId,
 *      UserInfoSingleton.getInstance().setMyTeamByType(LAST_TEAM_TYPE.TIME_MACHINE, e, r);
 *      var i = n._rightTeam,
 *          l = n._rightSuper;
 *      RunSceneWithBattle.battleWithPVEAndTeamAndBattle(
 *        e, r, u, t, i, l, o, !0, a,
 *        BattleLogic.GameFieldType.TIMETRAVEL, !1, 0, !1, s)
 *    }
 *
 *  Response fields yang dibaca client:
 *    n._battleId    → UserInfoSingleton.battleId (string UUID)
 *    n._rightTeam   → enemy team object { "0": {...}, "3": {...} }
 *    n._rightSuper  → enemy super skills (array)
 *
 *  NOTE: Tidak ada _leftTeam, _rand, _battleResult di response startBoss.
 *  Battle result ditentukan di checkBattleResult (L64712-64737).
 *
 *  timeTravelBOSS.json format:
 *    "101": {
 *      id, awardID, showHero, level, power, battleBackGround, battleMusic,
 *      enemyList: ",,,55404,",        (comma-separated, empty = no hero)
 *      enemyLevel: ",,,30,",
 *      controlResist: ",,,10000,",
 *      monsterType: ",,,strength,",
 *      isBoss: 4,                       (position index of boss)
 *      difficultyHp: "2,2,2,2.8,2",
 *      difficultyAttack: "1.2,1.2,1.2,1.44,1.2",
 *      difficultyArmor: "1,1,1,1,1",
 *      name: "timeTravelBOSS_name_1"
 *    }
 *
 *  checkBattleResult request — L64713-64722:
 *    { type:"timeMachine", action:"checkBattleResult",
 *      userId, machineId, battleId, version:"1.0",
 *      "super": team, checkResult: result, battleField: TIMETRAVEL }
 *
 *  checkBattleResult callback — L64723-64734:
 *    → e.getBattleAwardItems(t)        → items array
 *    → t._battleResult                  → 0=lose, 1=win
 *    → ViewCommon.setSummaryPage(...)
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ── Resource Loader (cached sync XHR) ──

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
            log.warn('TM_BOSS', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('TM_BOSS', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    // ── UUID Generator ──

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  ENEMY FORMULA (copy dari dungeon/startBattle.js — HAR-VERIFIED)
    // ═══════════════════════════════════════════════════════════

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, controlResist) {
        var levelAttr = loadJson('heroLevelAttr');
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('TM_BOSS', 'Level ' + level + ' not found in heroLevelAttr, using level 1');
        }

        var laHp = Number(lvlData.hp) || 1240;
        var laAttack = Number(lvlData.attack) || 125;
        var laArmor = Number(lvlData.armor) || 205;

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

        var hpBase;
        if (typeCategory === 'SKL') {
            hpBase = Math.floor(laHp / 2 - 240);
        } else if (typeCategory === 'ATK') {
            hpBase = Math.floor(laHp / 2 - 14 * level - 290);
        } else {
            hpBase = Math.floor(laHp / 2 + 412);
        }

        var atkBase;
        if (typeCategory === 'SKL') {
            atkBase = 13 * level + 47;
        } else if (typeCategory === 'ATK') {
            atkBase = Math.round(12.25 * level + 51);
        } else {
            atkBase = Math.round(9 * level + 1);
        }

        var finalHp = hpBase * diffHp;
        var finalAtk = atkBase * diffAtk;
        var finalArmor = laArmor - 21;

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

        var balancePower = Number(heroData.balancePower) || 1;
        var ATK_WEIGHTS = {
            'critical': 20, 'criticalSingle': 20, 'hit': 20,
            'skill': 15, 'body': 15, 'block': 15, 'armor': 15,
            'armorDamage': 15, 'armorS': 15, 'bodyDamage': 15,
            'dodge': 15, 'strength': 15, 'dot': 15
        };
        var atkWeight = ATK_WEIGHTS[heroType] || 15;
        var power = Math.floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor);

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

    function parseEnemyList(config) {
        var enemyStr = String(config.enemyList || '');
        var levelStr = String(config.enemyLevel || '');

        var hpRaw = config.difficultyHp;
        var atkRaw = config.difficultyAttack;
        var armorRaw = config.difficultyArmor;

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

    function buildEnemyEntry(enemyInfo, heroesData) {
        var heroId = enemyInfo.heroId;

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
            log.warn('TM_BOSS', 'Hero ' + heroId + ' not found in hero.json, using defaults');
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

        return {
            _heroDisplayId: heroDisplayId,
            _heroLevel: heroLevel,
            _heroStar: 0,
            _skinId: 0,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: attrs
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('timeMachine', 'startBoss', function (request, callback) {

        var userId    = request.userId || '';
        var machineId = request.machineId;
        var team      = request.team;
        var superSkill = request.super;

        // ── 1. VALIDASI ──

        if (!userId) {
            log.warn('TM_BOSS', 'missing userId');
            callback({}, 1);
            return;
        }

        if (machineId === undefined || machineId === null) {
            log.warn('TM_BOSS', 'missing machineId');
            callback({}, 1);
            return;
        }

        // ── 2. LOAD USER DATA ──

        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('TM_BOSS', 'user data not found: ' + storageKey);
            callback({}, 1);
            return;
        }

        // ── 3. AMBIL bossId DARI SLOT timeMachine ──

        var slotKey = String(machineId);
        var bossId = 0;

        if (savedData.timeMachine && savedData.timeMachine._items) {
            var slot = savedData.timeMachine._items[slotKey];
            if (slot && slot._bossId) {
                bossId = Number(slot._bossId) || 0;
            }
        }

        if (bossId === 0) {
            log.warn('TM_BOSS', 'no bossId found for machineId=' + machineId);
            callback({}, 1);
            return;
        }

        // ── 4. LOAD BOSS CONFIG ──

        var bossConfig = loadJson('timeTravelBOSS');
        if (!bossConfig || !bossConfig[String(bossId)]) {
            log.warn('TM_BOSS', 'boss config not found for bossId=' + bossId);
            callback({}, 1);
            return;
        }

        var bossCfg = bossConfig[String(bossId)];
        log.details('TM_BOSS', [
            ['userId', userId],
            ['machineId', String(machineId)],
            ['bossId', String(bossId)],
            ['bossName', bossCfg.name || '-'],
            ['showHero', String(bossCfg.showHero || 0)]
        ]);

        // ── 5. LOAD hero.json ──

        var heroesData = loadJson('hero');
        if (!heroesData) {
            log.error('TM_BOSS', 'hero.json not found');
            callback({}, 1);
            return;
        }

        // ── 6. PARSE ENEMY LIST & BUILD RIGHT TEAM ──

        var enemies = parseEnemyList(bossCfg);
        if (enemies.length === 0) {
            log.error('TM_BOSS', 'No enemies in boss config bossId=' + bossId);
            callback({}, 1);
            return;
        }

        var rightTeam = {};
        for (var i = 0; i < enemies.length; i++) {
            var enemy = enemies[i];
            var entry = buildEnemyEntry(enemy, heroesData);
            rightTeam[String(enemy.position)] = entry;
        }

        // ── 7. GENERATE BATTLE ID ──

        var battleId = generateUUID();

        // ── 8. RESPONSE ──

        var resp = {
            _battleId: battleId,
            _rightTeam: rightTeam,
            _rightSuper: []
        };

        log.info('TM_BOSS', 'OK userId=' + userId +
            ' machineId=' + machineId +
            ' bossId=' + bossId +
            ' enemies=' + enemies.length +
            ' battleId=' + battleId);

        callback(resp);
    });

    window.MainServer = MainServer;
})();