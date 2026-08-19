/**
 * handlers/cellGame/getInfo.js — Cell Game (ShaLu Game) Info Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: cellGame/getInfo
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Return Cell Game (沙鲁游戏 / ShaLu Game) state user — current level,
 *   current enemy index, hero team state, dan 8 enemies di level saat ini.
 *
 *   Cell Game = dungeon 65 level (cellGame.json), setiap level ada 7 small
 *   bosses + 1 final boss (enemy 8). User battle stage by stage. Hero HP
 *   persistent antar stage.
 *
 *   Client routing logic (L57019-57027):
 *     - Kalau _heroes kosong → ShaLuStartBattle (user harus set team)
 *     - Kalau _heroes ada → ShaLuGame (battle scene)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITE (main.min(unminfy).js L57011-57030)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Dipanggil dari openShaLuGame → getCellGameInfo:
 *     ts.processHandler({
 *         type: "cellGame",
 *         action: "getInfo",
 *         userId: <userId>,
 *         version: "1.0"
 *     }, function(t) {
 *         BossPartManager.getInstance().setCellGameModelData(t._info);
 *         var o = BossPartManager.getInstance().getTeamHeroCount();
 *         0 == o ? ts.runScene("ShaLuStartBattle", { parent:"Boss" })
 *                : ts.runScene("ShaLuGame", { parent:"Boss", isSuccess:e })
 *     })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EVIDENCE: BUKTI BUKAN ASUMSI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * [CellGameModel class] L82579-82606:
 *   Constructor defaults:
 *     id="", heroes={}, enemies={}, curEnemy=1, passLevel=0,
 *     curLevel=1, lastHeroes={}, yesterdayLevel=0,
 *     haveBeatLastLessonToday=false
 *   deserialize reads:
 *     _heroes → dict of CellGameHero (deserialize each)
 *     _enemies → dict of CellGameEnemy (deserialize each)
 *     _lastHeroes → dict (raw copy)
 *     common fields: _id, _curEnemy, _curLevel, _passLevel,
 *       _yesterdayLevel, _haveBeatLastLessonToday, _buyTimes
 *
 * [CellGameHero class] L82533-82555:
 *   deserialize reads:
 *     _hero → BattleTeam instance
 *     common fields stripped (no extra fields needed)
 *   getCurrntHp() → attrItems[id=ATTR_HR=0].num
 *   getTotalHp() → attrItems[id=ATTR_ORGHP=22].num
 *
 * [CellGameEnemy class] L82557-82577:
 *   Constructor defaults: teamInfo={}, super=[], curHp=0, totalHp=0
 *   deserialize reads:
 *     _teamInfo → dict of BattleTeam (deserialize each)
 *     _super → array (copy)
 *     common fields: _curHp, _totalHp
 *
 * [BattleTeam class] L86635-86704:
 *   Constructor reads from input object:
 *     _heroDisplayId, _superSkillLevel, _fixSkillLevel, _fixPassiveLevel,
 *     _potentialLevel, _heroStar, _evolveLevel, _attrs:{_items:[{_id,_num}]}
 *   Also reads common fields → teamHeroItem:
 *     _heroId, _position, _heroIcon, _heroType, _heroBg, _heroLevel,
 *     _skinId, _weaponHaloId, _weaponHaloLevel, _power
 *   ATTR items indexed by HERO_ATTR_TYPE:
 *     ATTR_HR=0 (current HP), ATTR_ATTACK=1, ATTR_ARMOR=2, ATTR_SPEED=3,
 *     ..., ATTR_ORGHP=22 (total/original HP)
 *
 * [setCellGameModelData] L82487-82489:
 *   t.CellGameModelData.deserialize(e)  // e = t._info dari response
 *   t.bossTimesBuy = e._buyTimes
 *   if (yesterdayLevel == 0) → cellGameHaveGotReward = true
 *
 * [getTeamHeroCount] L82479-82484:
 *   for(var o in t.heroes) n++;
 *   return n;
 *   → Jika _heroes kosong → return 0 → client buka ShaLuStartBattle
 *
 * [Client enemy access] L108417-108439:
 *   o = bossPartManager.getCellGameModelData()
 *   a = o.curEnemy                       // current enemy index (1-8)
 *   setProgressAndSkill(a):
 *     n = bossPartManager.getCellGameModelData()
 *     enemy = n.enemies[e]               // CellGameEnemy at index e
 *     for(r in enemy.teamInfo):
 *       if enemy.teamInfo[r]: curEnemyData = enemy.teamInfo[r]; break
 *
 * [cellGame.json config] (65 levels):
 *   Setiap level punya:
 *     enemyList1-7 = hero displayId musuh kecil (2501, 2503, 2507, dst)
 *     enemyLevel1-7 = level musuh
 *     isBoss1-7 = "1" (flag)
 *     hpNum1-7 = 5 (HP multiplier)
 *     bossBattleIcon1-7 = "boss_combat_big_XXXX_png"
 *     enemyListFinal, enemyLevelFinal, bossBattleIconFinal, hpNumFinal
 *
 * [Hero 2501, 2503, 2507] (verified dari hero.json):
 *   clientType: "enemy", system: "沙鲁游戏"
 *   quality: "white", defaultSkin: 2501000 (etc)
 *   Ini musuh khusus cellGame, BUKAN hero playable.
 *
 * [enterGame default scheduleInfo] (L1691-1693):
 *   _cellGameHaveGotReward: true   (new user = sudah dapat reward)
 *   _cellGameHaveTimes: 0
 *   _cellgameHaveSetHero: false
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TASK INVOLVEMENT?
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ❌ TIDAK ADA TASK yang di-update di getInfo.
 *   - task.json id=6040: taskType="cellGameBattle" — di-handle di
 *     cellGame/checkBattleResult (saat user menang battle), BUKAN di getInfo
 *   - getInfo hanya return state, tidak trigger task progress
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _info: {
 *           _id: <string>,
 *           _curEnemy: 1,                    // enemy 1-8 dalam level
 *           _curLevel: 1,                    // level 1-65
 *           _passLevel: 0,                   // highest level passed
 *           _yesterdayLevel: 0,              // untuk daily reward
 *           _haveBeatLastLessonToday: false,
 *           _buyTimes: 0,                    // bossTimesBuy
 *           _heroes: { "<pos>": <CellGameHero> },   // team user
 *           _enemies: { "1"-"8": <CellGameEnemy> }, // 8 enemies di curLevel
 *           _lastHeroes: {}
 *       }
 *   })
 *
 *   CellGameHero format:
 *     { _hero: <BattleTeam>, ... }
 *
 *   CellGameEnemy format:
 *     { _teamInfo: { "1": <BattleTeam> }, _super: [], _curHp: 0, _totalHp: 0 }
 *
 *   BattleTeam format (minimal untuk display):
 *     {
 *       _heroDisplayId: <number>,
 *       _heroStar: 0,
 *       _heroLevel: <number>,
 *       _heroId: "<string>",
 *       _position: 1,
 *       _skinId: <number>,
 *       _attrs: { _items: [ { _id:0, _num:<hp> }, { _id:22, _num:<hp> }, ... ] }
 *     }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STORAGE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   User data key: user:{userId}
 *   Field: savedData.cellGameState = {
 *     _curLevel: 1,
 *     _curEnemy: 1,
 *     _passLevel: 0,
 *     _yesterdayLevel: 0,
 *     _haveBeatLastLessonToday: false,
 *     _buyTimes: 0,
 *     _heroes: {},          // populated by cellGame/setTeam
 *     _lastHeroes: {}
 *   }
 *
 *   Enemies TIDAK disimpan — di-build dinamis dari cellGame.json[curLevel]
 *   setiap kali getInfo dipanggil. Karena enemies hanya untuk display,
 *   dan battle actual di-handle cellGame/startBattle.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT ERROR HANDLING
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Callback (L57019) MEMBACA t._info → ret=1 + empty response akan crash
 *   client (setCellGameModelData(undefined)).
 *   Semua validation failure → return ret=0 dengan default new-user state.
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.cellGame) {
        MainServer.handlers.cellGame = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS — verified dari main.min.js
    // ═══════════════════════════════════════════════════════════

    // HERO_ATTR_TYPE enum (L53212)
    var ATTR_HR = 0;        // current HP
    var ATTR_ATTACK = 1;
    var ATTR_ARMOR = 2;
    var ATTR_SPEED = 3;
    var ATTR_ENERGY = 16;
    var ATTR_ORGHP = 22;    // original/total HP

    // cellGame.json: 7 small enemies + 1 final boss = 8 enemies per level
    var ENEMY_COUNT = 8;

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
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
            log.error('RESOURCE', 'cellGame/getInfo failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'cellGame/getInfo failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getCellGameConfig() {
        return loadJson('cellGame');
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJson('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getHeroLevelAttr(level) {
        var la = loadJson('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  DEFAULT STATE (new user)
    // ═══════════════════════════════════════════════════════════

    function buildDefaultState() {
        return {
            _curLevel: 1,
            _curEnemy: 1,
            _passLevel: 0,
            _yesterdayLevel: 0,
            _haveBeatLastLessonToday: false,
            _buyTimes: 0,
            _heroes: {},          // empty → client routes to ShaLuStartBattle
            _lastHeroes: {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  ENEMY BUILDER (IDENTIK dungeon/startBattle.js + cellGame difficulty)
    // ═══════════════════════════════════════════════════════════
    //
    //  Build 8 enemies untuk level curLevel dari cellGame.json:
    //    Enemy 1-7: small bosses (enemyList1-7, enemyLevel1-7, difficultyHp/Attack/Armor)
    //    Enemy 8: final boss (enemyListFinal, enemyLevelFinal, difficultyHpFinal/AttackFinal/ArmorFinal)
    //
    //  Setiap enemy = CellGameEnemy:
    //    { _teamInfo: { "1": <BattleTeam> }, _super: [], _curHp: 0, _totalHp: 0 }
    //
    //  BattleTeam format (IDENTIK startBattle.js — full 27 attrs + skills):
    //    { _heroDisplayId, _heroLevel, _heroStar:0, _skinId,
    //      _weaponHaloId:0, _weaponHaloLevel:0,
    //      _skills: { "<skillId>": { _type, _id, _level } },
    //      _attrs: { _items: { "<attrId>": { _id, _num }, ... } } }
    //

    // HERO_ATTR_TYPE enum (L53212)
    var ATTR_HR = 0;
    var ATTR_ATTACK = 1;
    var ATTR_ARMOR = 2;
    var ATTR_SPEED = 3;
    var ATTR_HIT = 4;
    var ATTR_DODGE = 5;
    var ATTR_BLOCK = 6;
    var ATTR_BLOCKEFFECT = 7;
    var ATTR_SKILLDAMAGE = 8;
    var ATTR_CRITICAL = 9;
    var ATTR_CRITICALRESIST = 10;
    var ATTR_CRITICALDAMAGE = 11;
    var ATTR_ARMORBREAK = 12;
    var ATTR_DAMAGEREDUCE = 13;
    var ATTR_CONTROLRESIST = 14;
    var ATTR_TRUEDAMAGE = 15;
    var ATTR_ENERGY = 16;
    var ATTR_POWER = 21;
    var ATTR_ORGHP = 22;
    var ATTR_SUPERDAMAGE = 23;
    var ATTR_HEALPLUS = 24;
    var ATTR_HEALERPLUS = 25;
    var ATTR_DAMAGEUP = 28;
    var ATTR_DAMAGEDOWN = 29;
    var ATTR_SUPERDAMAGERESIST = 31;
    var ATTR_CRITICALDAMAGERESIST = 36;
    var ATTR_BLOCKTHROUGH = 37;
    var ATTR_ENERGYMAX = 41;

    // _skills builder — WAJIB untuk battle engine (getModelArray L67335)
    // Format: { "<skillId>": { _type, _id, _level } }
    // _type: 0=normal, 1=proactive(skill), 2=passive, 3=superSkill, 4=potentialSkill
    // getEnemySkill (L67366-67376) baca ini untuk build HeroSkill object.
    // Kalau kosong → enemy tidak punya normal attack → DIEM PATUNG!
    function buildEnemySkills(heroData) {
        var skills = {};
        if (heroData.normal) {
            skills[String(heroData.normal)] = { _type: 0, _id: Number(heroData.normal), _level: 1 };
        }
        if (heroData.skill) {
            skills[String(heroData.skill)] = { _type: 1, _id: Number(heroData.skill), _level: Number(heroData.skillLevel) || 1 };
        }
        if (heroData.skillPassive1) {
            skills[String(heroData.skillPassive1)] = { _type: 2, _id: Number(heroData.skillPassive1), _level: Number(heroData.passiveLevel1) || 1 };
        }
        if (heroData.skillPassive2) {
            skills[String(heroData.skillPassive2)] = { _type: 2, _id: Number(heroData.skillPassive2), _level: Number(heroData.passiveLevel2) || 1 };
        }
        if (heroData.skillPassive3) {
            skills[String(heroData.skillPassive3)] = { _type: 2, _id: Number(heroData.skillPassive3), _level: Number(heroData.passiveLevel3) || 1 };
        }
        if (heroData.potential1) {
            skills[String(heroData.potential1)] = { _type: 4, _id: Number(heroData.potential1), _level: 1 };
        }
        return skills;
    }

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, isFinal) {
        var levelAttr = loadJson('heroLevelAttr');
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('CELLGAME', 'getInfo — Level ' + level + ' not found in heroLevelAttr, using level 1');
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

        // Apply difficulty multipliers
        // Enemy 1-7 = enemy biasa (LEMAH), Enemy 8 = final boss (sedikit lebih kuat)
        // Enemy biasa: HP/ATK dikali 0.2, armor rendah (50)
        // Final boss: HP/ATK dikali 0.25/0.4, armor 80 (lebih kuat dari enemy biasa, tapi tidak terlalu kuat)
        var finalHp, finalAtk, finalArmor;
        if (isFinal) {
            // FINAL BOSS (enemy 8) — lebih kuat dari enemy biasa, tapi tidak terlalu kuat
            finalHp = hpBase * diffHp * 0.25;
            finalAtk = atkBase * diffAtk * 0.4;
            finalArmor = 80;
        } else {
            // ENEMY BIASA (1-7) — jauh lebih lemah agar user bisa menang
            finalHp = hpBase * diffHp * 0.2;
            finalAtk = atkBase * diffAtk * 0.3;
            finalArmor = 50;
        }

        var speed = Number(heroData.speed) || 180;
        var hit, crit, critDmg, dodge, block, blockEffect, critResist;

        if (typeCategory === 'SKL') {
            hit = level / 14000; crit = hit * 2.5; critDmg = crit * 1.5;
            dodge = 0; block = 0; blockEffect = 0; critResist = 0;
        } else if (typeCategory === 'ATK') {
            hit = level / 2000; crit = hit * 0.5; critDmg = 0.3;
            dodge = 0; block = 0; blockEffect = 0; critResist = 0;
        } else {
            hit = level / 3043; crit = hit * 0.5; critDmg = hit;
            dodge = level / 2500; block = level / 8000; blockEffect = 0;
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

        // Build _attrs._items (OBJECT keyed by string attr ID — IDENTIK startBattle)
        var items = {};
        items[String(ATTR_HR)] = { _id: ATTR_HR, _num: finalHp };
        items[String(ATTR_ATTACK)] = { _id: ATTR_ATTACK, _num: finalAtk };
        items[String(ATTR_ARMOR)] = { _id: ATTR_ARMOR, _num: finalArmor };
        items[String(ATTR_SPEED)] = { _id: ATTR_SPEED, _num: speed };
        items[String(ATTR_HIT)] = { _id: ATTR_HIT, _num: hit };
        items[String(ATTR_DODGE)] = { _id: ATTR_DODGE, _num: dodge };
        items[String(ATTR_BLOCK)] = { _id: ATTR_BLOCK, _num: block };
        items[String(ATTR_BLOCKEFFECT)] = { _id: ATTR_BLOCKEFFECT, _num: blockEffect };
        items[String(ATTR_SKILLDAMAGE)] = { _id: ATTR_SKILLDAMAGE, _num: 0 };
        items[String(ATTR_CRITICAL)] = { _id: ATTR_CRITICAL, _num: crit };
        items[String(ATTR_CRITICALRESIST)] = { _id: ATTR_CRITICALRESIST, _num: critResist };
        items[String(ATTR_CRITICALDAMAGE)] = { _id: ATTR_CRITICALDAMAGE, _num: critDmg };
        items[String(ATTR_ARMORBREAK)] = { _id: ATTR_ARMORBREAK, _num: 0 };
        items[String(ATTR_DAMAGEREDUCE)] = { _id: ATTR_DAMAGEREDUCE, _num: 0 };
        items[String(ATTR_CONTROLRESIST)] = { _id: ATTR_CONTROLRESIST, _num: 0 };
        items[String(ATTR_TRUEDAMAGE)] = { _id: ATTR_TRUEDAMAGE, _num: 0 };
        items[String(ATTR_ENERGY)] = { _id: ATTR_ENERGY, _num: 50 };
        items[String(ATTR_POWER)] = { _id: ATTR_POWER, _num: power };
        items[String(ATTR_ORGHP)] = { _id: ATTR_ORGHP, _num: finalHp };
        items[String(ATTR_SUPERDAMAGE)] = { _id: ATTR_SUPERDAMAGE, _num: 0 };
        items[String(ATTR_HEALPLUS)] = { _id: ATTR_HEALPLUS, _num: 0 };
        items[String(ATTR_HEALERPLUS)] = { _id: ATTR_HEALERPLUS, _num: 0 };
        items[String(ATTR_DAMAGEUP)] = { _id: ATTR_DAMAGEUP, _num: 0 };
        items[String(ATTR_DAMAGEDOWN)] = { _id: ATTR_DAMAGEDOWN, _num: 0 };
        items[String(ATTR_SUPERDAMAGERESIST)] = { _id: ATTR_SUPERDAMAGERESIST, _num: 0 };
        items[String(ATTR_CRITICALDAMAGERESIST)] = { _id: ATTR_CRITICALDAMAGERESIST, _num: 0 };
        items[String(ATTR_BLOCKTHROUGH)] = { _id: ATTR_BLOCKTHROUGH, _num: 0 };
        items[String(ATTR_ENERGYMAX)] = { _id: ATTR_ENERGYMAX, _num: Number(heroData.energyMax) || 100 };

        return { _items: items };
    }

    function buildBattleTeam(heroDisplayId, heroLevel, instanceId, diffHp, diffAtk, diffArmor, isFinal) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) return null;

        var skinId = Number(hc.defaultSkin) || 0;
        var attrs = computeEnemyAttrs(hc, heroLevel, diffHp, diffAtk, diffArmor, isFinal);
        var skills = buildEnemySkills(hc);

        // BattleTeam format — IDENTIK dengan BattleTeam constructor (L86635-86704)
        // + getModelArray (L67322-67342) untuk battle engine
        //
        // Field yang DIBACA:
        //   BattleTeam constructor (L86635-86704):
        //     _heroDisplayId, _heroStar, _evolveLevel, _attrs._items, common fields
        //     _fixSkillLevel (L86641), _fixPassiveLevel (L86642)
        //   getModelArray (L67322-67342) — battle engine:
        //     _skills (L67335) → getEnemySkillLevel + getEnemySkill
        //     ⚠️ WAJIB kirim! Kalau kosong → enemy tidak punya normal attack → DIEM PATUNG!
        //
        // _skills format (L67355-67376):
        //   { "<skillId>": { _type, _id, _level } }
        //   _type: 0=normal, 1=proactive(skill), 2=passive, 3=superSkill, 4=potentialSkill
        var fixPassiveLevel = [
            Number(hc.passiveLevel1) || 0,
            Number(hc.passiveLevel2) || 0,
            Number(hc.passiveLevel3) || 0,
            Number(hc.redPassiveLevel1) || 0,
            Number(hc.redPassiveLevel2) || 0,
            Number(hc.redPassiveLevel3) || 0
        ];

        return {
            _heroDisplayId: Number(heroDisplayId),
            _heroStar: 0,
            _evolveLevel: 0,
            _fixSkillLevel: Number(hc.skillLevel) || 1,
            _fixPassiveLevel: fixPassiveLevel,
            _heroLevel: Number(heroLevel) || 1,
            _heroId: String(instanceId),
            _position: 1,
            _skinId: skinId,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: attrs
        };
    }

    function buildEnemy(enemyIndex, levelConfig) {
        // enemyIndex: 1-7 = small boss, 8 = final boss
        var enemyListKey, enemyLevelKey, isFinal, diffHp, diffAtk, diffArmor;

        if (enemyIndex <= 7) {
            enemyListKey = 'enemyList' + enemyIndex;
            enemyLevelKey = 'enemyLevel' + enemyIndex;
            isFinal = false;
            diffHp = Number(levelConfig.difficultyHp) || 1;
            diffAtk = Number(levelConfig.difficultyAttack) || 1;
            diffArmor = Number(levelConfig.difficultyArmor) || 1;
        } else {
            enemyListKey = 'enemyListFinal';
            enemyLevelKey = 'enemyLevelFinal';
            isFinal = true;
            diffHp = Number(levelConfig.difficultyHpFinal) || 1;
            diffAtk = Number(levelConfig.difficultyAttackFinal) || 1;
            diffArmor = Number(levelConfig.difficultyArmorFinal) || 1;
        }

        var heroDisplayId = Number(levelConfig[enemyListKey]);
        var heroLevel = Number(levelConfig[enemyLevelKey]) || 1;

        if (!heroDisplayId) {
            log.warn('CELLGAME', 'getInfo — missing ' + enemyListKey + ' in cellGame.json level ' + levelConfig.id);
            return null;
        }

        // Build BattleTeam for this enemy (IDENTIK startBattle — full attrs + difficulty + skills)
        var instanceId = 'cellgame_enemy_' + levelConfig.id + '_' + enemyIndex;
        var battleTeam = buildBattleTeam(heroDisplayId, heroLevel, instanceId, diffHp, diffAtk, diffArmor, isFinal);

        if (!battleTeam) {
            log.warn('CELLGAME', 'getInfo — failed to build BattleTeam for hero ' + heroDisplayId);
            return null;
        }

        // CellGameEnemy format
        return {
            _teamInfo: {
                "1": battleTeam
            },
            _super: [],
            _curHp: 0,
            _totalHp: 0
        };
    }

    function buildEnemiesForLevel(curLevel) {
        var config = getCellGameConfig();
        if (!config) {
            log.error('CELLGAME', 'getInfo — cellGame.json not found');
            return {};
        }

        var levelConfig = config[String(curLevel)];
        if (!levelConfig) {
            log.error('CELLGAME', 'getInfo — level ' + curLevel + ' not found in cellGame.json');
            return {};
        }

        var enemies = {};
        for (var i = 1; i <= ENEMY_COUNT; i++) {
            var enemy = buildEnemy(i, levelConfig);
            if (enemy) {
                enemies[String(i)] = enemy;
            }
        }

        log.info('CELLGAME', 'getInfo — built ' + Object.keys(enemies).length
            + ' enemies for level ' + curLevel);
        return enemies;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetInfo(request, callback) {
        // OUTER SAFETY NET — client callback BACA t._info,
        // ret=1 + empty akan crash. Wrap agar aman.
        try {
            _handleGetInfoImpl(request, callback);
        } catch (err) {
            log.error('CELLGAME', 'getInfo — UNCAUGHT EXCEPTION: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            // Return default new-user state agar client tidak crash
            var fallbackState = buildDefaultState();
            callback({ _info: buildResponseInfo(fallbackState) });
        }
    }

    function buildResponseInfo(state) {
        // Build enemies dinamis dari cellGame.json[curLevel]
        var enemies = buildEnemiesForLevel(state._curLevel || 1);

        return {
            _id: 'cellgame_' + Date.now(),
            _curEnemy: Number(state._curEnemy) || 1,
            _curLevel: Number(state._curLevel) || 1,
            _passLevel: Number(state._passLevel) || 0,
            _yesterdayLevel: Number(state._yesterdayLevel) || 0,
            _haveBeatLastLessonToday: false,  // ⚠️ FORCE false! L108427: true = tombol battle DISABLED = STUCK
            _buyTimes: Number(state._buyTimes) || 0,
            _heroes: state._heroes || {},
            _enemies: enemies,
            _lastHeroes: state._lastHeroes || {}
        };
    }

    function _handleGetInfoImpl(request, callback) {
        var userId = request && request.userId;

        log.info('CELLGAME', 'getInfo — START (userId=' + (userId || '-') + ')');

        // ── VALIDATION ──
        // Client callback BACA t._info — ret=1 crash.
        // Return default state kalau validation fail.
        if (!userId) {
            log.error('CELLGAME', 'getInfo — missing userId, returning default state');
            callback({ _info: buildResponseInfo(buildDefaultState()) });
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.warn('CELLGAME', 'getInfo — user data not found: ' + key + ', returning default state');
            callback({ _info: buildResponseInfo(buildDefaultState()) });
            return;
        }

        // ── LOAD OR INIT CELL GAME STATE ──
        if (!savedData.cellGameState) {
            savedData.cellGameState = buildDefaultState();
            db._set(key, savedData);
            log.info('CELLGAME', 'getInfo — initialized default cellGameState for new user');
        }

        var state = savedData.cellGameState;

        // ── BUILD RESPONSE ──
        var info = buildResponseInfo(state);

        var heroCount = Object.keys(info._heroes).length;
        var enemyCount = Object.keys(info._enemies).length;

        log.info('CELLGAME', 'getInfo SUCCESS — '
            + 'curLevel=' + info._curLevel
            + ', curEnemy=' + info._curEnemy
            + ', passLevel=' + info._passLevel
            + ', heroes=' + heroCount
            + ', enemies=' + enemyCount
            + ' → routes to ' + (heroCount === 0 ? 'ShaLuStartBattle' : 'ShaLuGame'));
        log.details('response', [
            ['userId', userId],
            ['_curLevel', String(info._curLevel)],
            ['_curEnemy', String(info._curEnemy)],
            ['_passLevel', String(info._passLevel)],
            ['_yesterdayLevel', String(info._yesterdayLevel)],
            ['_haveBeatLastLessonToday', String(info._haveBeatLastLessonToday)],
            ['_buyTimes', String(info._buyTimes)],
            ['_heroes.count', String(heroCount)],
            ['_enemies.count', String(enemyCount)],
            ['routing', heroCount === 0 ? 'ShaLuStartBattle (set team)' : 'ShaLuGame (battle)']
        ]);

        callback({ _info: info });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('cellGame', 'getInfo', handleGetInfo);

})();
