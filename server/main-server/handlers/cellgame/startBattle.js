/**
 * handlers/cellGame/startBattle.js — Cell Game Start Battle Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: cellGame/startBattle
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Generate battle ID + return enemy boss team (1 hero) untuk Cell Game
 *   (ShaLu Game) battle. Client simulate battle locally (PVE boss mode),
 *   lalu kirim hasil ke cellGame/checkBattleResult.
 *
 *   Cell Game = PVE Boss Battle (sama seperti GuildBoss, MergeBoss, BossAttack).
 *   8 enemies per level (7 small bosses + 1 final boss). User fight satu per
 *   satu (curEnemy 1-8). Hero HP persistent antar enemy.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITE (main.min(unminfy).js L64975-65032)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Dipanggil dari shaLuGameBattle (L64975):
 *     var a = {};  // { pos: heroId }
 *     for (var r in t) t[r] && (a[r] = t[r].hero.teamHeroItem._id);
 *
 *     T = BossPartManager.getInstance().getCellGameModelData();
 *     // Determine enemy dari cellGame.json[curLevel] berdasarkan curEnemy
 *     if (T.curEnemy <= 7) {
 *         u = cellGame[T.curLevel]["hpNum" + T.curEnemy];
 *         c = cellGame[T.curLevel]["bossBattleIcon" + T.curEnemy];
 *         p = cellGame[T.curLevel]["isBoss" + T.curEnemy];
 *     } else {
 *         u = cellGame[T.curLevel].hpNumFinal;
 *         c = cellGame[T.curLevel].bossBattleIconFinal;
 *         p = cellGame[T.curLevel].isBossFinal;
 *     }
 *
 *     ts.processHandler({
 *         type: "cellGame",
 *         action: "startBattle",
 *         userId, version: "1.0",
 *         team: a,           // { pos: heroId }
 *         "super": []
 *     }, function(e) {
 *         UserInfoSingleton.getInstance().battleId = e._battleId;
 *         var t = e._rightTeam, o = e._rightSuper;
 *         RunSceneWithBattle.shaLuBattleWithPVEAndLeftTeam(
 *             i,              // leftTeam (primaryData — built LOCAL)
 *             g,              // battleEndFnc → calls checkBattleResult
 *             f[v],           // battleBg
 *             t,              // rightTeam (dari server)
 *             o,              // rightSuper (dari server)
 *             !1, l, u, e._totalDamage, c, p, n
 *         );
 *     })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EVIDENCE: BUKTI BUKAN ASUMSI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * [shaLuBattleWithPVEAndLeftTeam] L68411-68434:
 *   function(e, t, n, o, a, r, i, s, l, u, c, p) {
 *       BattleSetStartParamSingleton.getInstance().initLeftTeam(e, [], o, a, l, c);
 *       // o = rightTeam (dari server _rightTeam)
 *       // a = rightSuper (dari server _rightSuper)
 *       // l = totalDamageToBoss (dari server _totalDamage)
 *       // c = bossPos (dari config isBoss)
 *       // s = totalCount = hpNum (dari config, client-side)
 *       ...
 *   }
 *
 * [initLeftTeam] L66701-66703:
 *   i.leftTeam = e, i.leftSuper = t, i.rightTeam = n, i.rightSuper = o,
 *   i.totalDamageToBoss = a, i.enemyTeamBossPos = r, i.isBossModel = true
 *   → a = totalDamageToBoss = _totalDamage dari server
 *
 * [setBossMode] L43969-43972:
 *   e.prototype.setBossMode = function(a, b) {
 *       this.bossMode = a;        // true
 *       this.bossDamage = b;      // = totalDamageToBoss = _totalDamage
 *   }
 *
 * [BossBattleObserver.checkBossDeath] L44082-44084:
 *   return 0 >= this.totalHealth;
 *   → Boss mati ketika totalHealth <= 0
 *
 * [showTeamStatus] L43982:
 *   this.BossMode && (f += h, d += m)
 *   → f = sum FullHealth (bossTotalHp), d = sum Health (bossCurrentHp)
 *
 * [bossHpInit] L68100-68102:
 *   n.bossTotalHp = t, n.bossHp = e
 *   → bossTotalHp dari sum enemy hero _attrs._items[ATTR_ORGHP=22]
 *
 * [initBossHp] L107766-107770:
 *   e.battleUIData.bossTotalCount = t.params.totalCount;  // = hpNum dari config
 *   var n = e.battleUIData.bossTotalHp / e.battleUIData.bossTotalCount;
 *   e.battleUIData.lastCount = Math.ceil(e.battleUIData.bossTotalHp / n);
 *   → hpNum = jumlah bar HP (visual UI), BUKAN damage pool
 *
 * [cellGame.json config] (verified):
 *   Per level (1-65):
 *     enemyList1-7 = hero displayId musuh kecil (2501, 2502, 2503, 2504, 2505, 2506, 2507)
 *     enemyLevel1-7 = level musuh
 *     isBoss1-7 = "1"
 *     hpNum1-7 = 5 (jumlah bar HP UI)
 *     bossBattleIcon1-7 = "boss_combat_big_XXXX_png"
 *     enemyListFinal = "2601" / "2604" (final boss hero displayId)
 *     enemyLevelFinal = level final boss
 *     isBossFinal = "1"
 *     hpNumFinal = 5
 *     bossBattleIconFinal = "boss_combat_big_1503_png"
 *     difficultyHp = 0.7 - 1.5 (small boss HP multiplier)
 *     difficultyAttack = 0.2 - 1 (small boss ATK multiplier)
 *     difficultyArmor = 1 (small boss armor multiplier)
 *     difficultyHpFinal = 1.4 - 3 (final boss HP multiplier)
 *     difficultyAttackFinal = 0.4 - 1 (final boss ATK multiplier)
 *     difficultyArmorFinal = 1 (final boss armor multiplier)
 *
 * [Hero 2501-2507] (verified dari hero.json):
 *   clientType: "enemy", system: "沙鲁游戏"
 *   quality: "white", heroType: "strength"
 *   Musuh khusus cellGame, BUKAN hero playable.
 *
 * [Hero 2601, 2604] (final boss — verified):
 *   Final boss heroes (Cell form final).
 *
 * [dungeon/startBattle.js pattern] (existing handler):
 *   computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, controlResist)
 *   → Build _attrs._items dengan 18 attr items
 *   buildEnemySkills(heroData) → _skills object
 *   buildEnemyEntry(enemyInfo, heroesData) → full BattleTeam
 *
 *   Formula HP_base by type:
 *     SKL (strength/skill/dot):         floor(LA.hp/2 - 240)
 *     ATK (critical/criticalSingle/hit): floor(LA.hp/2 - 14*level - 290)
 *     TANK (body/block/dodge/armor/armorS/bodyDamage): floor(LA.hp/2 + 412)
 *   Final: HP = hpBase × diffHp, ATK = atkBase × diffAtk, Armor = LA.armor - 21
 *
 * [PVE Boss Battle response pattern] (GuildBoss L64098, MergeBoss L64154,
 *  BossAttack L63972, BossSnatch L64879):
 *   Response WAJIB: { _battleId, _rightTeam, _rightSuper, _totalDamage }
 *   → _totalDamage dipass ke bossBattleWithPVEAndTeam sebagai param ke-10
 *
 * [getTeamHeroCount] L82479-82484:
 *   for(var o in t.heroes) n++;
 *   → Client cek _heroes count untuk routing ShaLuStartBattle vs ShaLuGame
 *
 * [cellGame/setTeam.js] (sibling handler):
 *   State stored di savedData.cellGameState = {
 *     _curLevel, _curEnemy, _passLevel, _yesterdayLevel,
 *     _haveBeatLastLessonToday, _buyTimes, _heroes, _lastHeroes
 *   }
 *   startBattle BACA curLevel + curEnemy untuk determine enemy.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TASK INVOLVEMENT?
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ❌ TIDAK ADA TASK yang di-update di startBattle.
 *   - task.json id=6040: taskType="cellGameBattle" — di-handle di
 *     cellGame/checkBattleResult (saat user menang), BUKAN di startBattle
 *   - startBattle hanya return enemy team, tidak trigger task progress
 *
 * ═══════════════════════════════════════════════════════════════════════
 * _totalDamage CALCULATION
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Berdasarkan bukti:
 *   - bossObserver.totalHealth di-init dari enemy hero HP (ATTR_ORGHP=22)
 *   - checkBossDeath() = totalHealth <= 0
 *   - _totalDamage di-pass ke setBossMode(true, bossDamage) sebagai marker
 *
 *   KESIMPULAN: _totalDamage = enemy max HP (sama dengan ATTR_ORGHP=22)
 *   Boss mati ketika semua damage di-deal (= enemy HP habis).
 *   hpNum (dari config) = visual UI bar count, BUKAN damage pool.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REQUEST FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   {
 *     type: "cellGame",
 *     action: "startBattle",
 *     userId: <string>,
 *     version: "1.0",
 *     team: { "<pos>": "<heroInstanceId>", ... },  // hero IDs (client build leftTeam local)
 *     "super": []
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   {
 *     _battleId: <string>,                    // unique battle ID
 *     _rightTeam: { "1": <BattleTeam> },      // 1 enemy boss
 *     _rightSuper: [],                         // empty (enemy no super skill)
 *     _totalDamage: <number>                   // boss damage pool = enemy max HP
 *   }
 *
 *   BattleTeam format (sama dengan dungeon/startBattle.js):
 *   {
 *     _heroDisplayId, _heroLevel, _heroStar:0, _skinId:0,
 *     _weaponHaloId:0, _weaponHaloLevel:0,
 *     _skills: { "<skillId>": { _type, _id, _level } },
 *     _attrs: { _items: { "<attrId>": { _id, _num }, ... } }
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STORAGE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   User data key: user:{userId}
 *   Field: savedData.cellGameState._currentBattle = {
 *     battleId: <string>,
 *     enemyDisplayId: <number>,
 *     enemyLevel: <number>,
 *     curLevel: <number>,
 *     curEnemy: <number>,
 *     timestamp: <number>
 *   }
 *   → Dipakai cellGame/checkBattleResult untuk validasi & reward.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT ERROR HANDLING
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Callback BACA e._battleId, e._rightTeam, e._rightSuper, e._totalDamage.
 *   ret=1 + empty akan crash. Semua validation failure → return ret=0
 *   dengan minimal valid response.
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
    //  CONSTANTS — verified dari main.min.js L53212
    // ═══════════════════════════════════════════════════════════

    // HERO_ATTR_TYPE enum (L53212)
    var ATTR_HR = 0;        // current HP
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
    var ATTR_ORGHP = 22;    // original/total HP
    var ATTR_SUPERDAMAGE = 23;
    var ATTR_HEALPLUS = 24;
    var ATTR_HEALERPLUS = 25;
    var ATTR_DAMAGEUP = 28;
    var ATTR_DAMAGEDOWN = 29;
    var ATTR_SUPERDAMAGERESIST = 31;
    var ATTR_CRITICALDAMAGERESIST = 36;
    var ATTR_BLOCKTHROUGH = 37;
    var ATTR_ENERGYMAX = 41;

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    function generateBattleId(userId) {
        return 'cellgame_battle_' + userId + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached) — pattern dari dungeon/startBattle.js
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
            log.error('RESOURCE', 'cellGame/startBattle failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'cellGame/startBattle failed to load: ' + name + '.json — ' + e.message);
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
    //  DEFAULT STATE (new user — sama dengan getInfo.js)
    // ═══════════════════════════════════════════════════════════

    function buildDefaultState() {
        return {
            _curLevel: 1,
            _curEnemy: 1,
            _passLevel: 0,
            _yesterdayLevel: 0,
            _haveBeatLastLessonToday: false,
            _buyTimes: 0,
            _heroes: {},
            _lastHeroes: {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  ENEMY CONFIG EXTRACTOR
    // ═══════════════════════════════════════════════════════════
    //
    //  Dari cellGame.json[curLevel], determine enemy berdasarkan curEnemy:
    //    curEnemy 1-7: small boss (enemyList1-7, enemyLevel1-7, difficultyHp/Attack/Armor)
    //    curEnemy 8:   final boss (enemyListFinal, enemyLevelFinal, difficultyHpFinal/AttackFinal/ArmorFinal)
    //
    //  Verified dari L65020:
    //    T.curEnemy <= 7 ? (u = I[T.curLevel]["hpNum" + T.curEnemy], ...) : (u = I[T.curLevel].hpNumFinal, ...)
    //

    function extractEnemyConfig(levelCfg, curEnemy) {
        if (!levelCfg) return null;

        var isFinal = (Number(curEnemy) > 7);
        var enemyListKey, enemyLevelKey, diffHp, diffAtk, diffArmor;

        if (isFinal) {
            enemyListKey = 'enemyListFinal';
            enemyLevelKey = 'enemyLevelFinal';
            diffHp = Number(levelCfg.difficultyHpFinal) || 1;
            diffAtk = Number(levelCfg.difficultyAttackFinal) || 1;
            diffArmor = Number(levelCfg.difficultyArmorFinal) || 1;
        } else {
            enemyListKey = 'enemyList' + curEnemy;
            enemyLevelKey = 'enemyLevel' + curEnemy;
            diffHp = Number(levelCfg.difficultyHp) || 1;
            diffAtk = Number(levelCfg.difficultyAttack) || 1;
            diffArmor = Number(levelCfg.difficultyArmor) || 1;
        }

        var heroDisplayId = Number(levelCfg[enemyListKey]);
        var heroLevel = Number(levelCfg[enemyLevelKey]) || 1;

        if (!heroDisplayId) {
            log.error('CELLGAME_START', 'Missing ' + enemyListKey + ' in cellGame.json level ' + levelCfg.id);
            return null;
        }

        // ════════════════════════════════════════════════════════
        //  EXTRACT REWARD FIELDS (for checkBattleResult)
        // ════════════════════════════════════════════════════════
        //
        //  cellGame.json reward structure (verified dari config):
        //    Small boss 1-7: award<enemy>A + num<enemy>A, award<enemy>B + num<enemy>B
        //      e.g. award1A=4199, num1A=2, award1B=140, num1B=6
        //    Final boss: awardFinalA + numFinalA, awardFinalB + numFinalB, awardFinalC + numFinalC
        //      e.g. awardFinalA=140, numFinalA=30, awardFinalB=4199, numFinalB=4, awardFinalC=4299, numFinalC=2
        //
        //  These rewards are given by checkBattleResult when user wins.
        //  Save in _currentBattle state for checkBattleResult to use.
        //
        var rewards = [];
        if (isFinal) {
            // Final boss: up to 3 reward slots (A, B, C)
            if (levelCfg.awardFinalA && Number(levelCfg.awardFinalA) > 0) {
                rewards.push({ itemId: Number(levelCfg.awardFinalA), num: Number(levelCfg.numFinalA) || 0 });
            }
            if (levelCfg.awardFinalB && Number(levelCfg.awardFinalB) > 0) {
                rewards.push({ itemId: Number(levelCfg.awardFinalB), num: Number(levelCfg.numFinalB) || 0 });
            }
            if (levelCfg.awardFinalC && Number(levelCfg.awardFinalC) > 0) {
                rewards.push({ itemId: Number(levelCfg.awardFinalC), num: Number(levelCfg.numFinalC) || 0 });
            }
        } else {
            // Small boss: up to 2 reward slots (A, B)
            var awardAKey = 'award' + curEnemy + 'A';
            var numAKey = 'num' + curEnemy + 'A';
            var awardBKey = 'award' + curEnemy + 'B';
            var numBKey = 'num' + curEnemy + 'B';
            if (levelCfg[awardAKey] && Number(levelCfg[awardAKey]) > 0) {
                rewards.push({ itemId: Number(levelCfg[awardAKey]), num: Number(levelCfg[numAKey]) || 0 });
            }
            if (levelCfg[awardBKey] && Number(levelCfg[awardBKey]) > 0) {
                rewards.push({ itemId: Number(levelCfg[awardBKey]), num: Number(levelCfg[numBKey]) || 0 });
            }
        }

        return {
            heroDisplayId: heroDisplayId,
            heroLevel: heroLevel,
            diffHp: diffHp,
            diffAtk: diffAtk,
            diffArmor: diffArmor,
            isFinal: isFinal,
            rewards: rewards
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  ENEMY ATTRS COMPUTATION (identik dungeon/startBattle.js)
    // ═══════════════════════════════════════════════════════════
    //
    //  Formula HP_base by type category:
    //    SKL (strength/skill/dot):         floor(LA.hp/2 - 240)
    //    ATK (critical/criticalSingle/hit): floor(LA.hp/2 - 14*level - 290)
    //    TANK (body/block/dodge/armor/armorS/bodyDamage): floor(LA.hp/2 + 412)
    //
    //  Final: HP = hpBase × diffHp, ATK = atkBase × diffAtk, Armor = LA.armor - 21
    //  Sub-stats derived dari level (sama persis dungeon).
    //

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, isFinal) {
        var levelAttr = loadJson('heroLevelAttr');
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('CELLGAME_START', 'Level ' + level + ' not found in heroLevelAttr, using level 1');
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
        // Enemy 1-7 = enemy biasa (LEMAH), Enemy 8 = final boss (sedikit lebih kuat)
        // Enemy biasa: HP/ATK dikali 0.2, armor rendah (50)
        // Final boss: HP/ATK dikali 0.25/0.4, armor 80 (lebih kuat dari enemy biasa, tapi tidak terlalu kuat)
        var finalHp, finalAtk, finalArmor;
        if (isFinal) {
            // FINAL BOSS (enemy 8) — lebih kuat dari enemy biasa, tapi tidak terlalu kuat
            // Sebelum: hpBase × diffHpFinal = 7480 (terlalu kuat, 7.4x user hero)
            // Sekarang: × 0.25 = 1870 (1.85x user hero — reasonable untuk boss)
            finalHp = hpBase * diffHp * 0.25;
            finalAtk = atkBase * diffAtk * 0.4;
            finalArmor = 80;  // lebih tinggi dari enemy biasa (50), tapi masih bisa di-damage
        } else {
            // ENEMY BIASA (1-7) — jauh lebih lemah agar user bisa menang
            finalHp = hpBase * diffHp * 0.2;   // HP 5x lebih tipis
            finalAtk = atkBase * diffAtk * 0.3; // ATK 3x lebih lemah
            finalArmor = 50;                   // armor rendah, user bisa damage
        }

        // Sub-stats
        var speed = Number(heroData.speed) || 180;
        var hit, crit, critDmg, dodge, block, blockEffect, critResist;
        var armorBreak = 0, damageReduce = 0, trueDamage = 0;
        var superDamage = 0, healPlus = 0, healerPlus = 0, shielderPlus = 0;
        var damageUp = 0, damageDown = 0;
        var superDamageResist = 0, criticalDamageResist = 0, blockThrough = 0;
        var ctrlResist = 0;

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

        // Build _attrs._items (OBJECT keyed by string attr ID)
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
        items[String(ATTR_ARMORBREAK)] = { _id: ATTR_ARMORBREAK, _num: armorBreak };
        items[String(ATTR_DAMAGEREDUCE)] = { _id: ATTR_DAMAGEREDUCE, _num: damageReduce };
        items[String(ATTR_CONTROLRESIST)] = { _id: ATTR_CONTROLRESIST, _num: ctrlResist };
        items[String(ATTR_TRUEDAMAGE)] = { _id: ATTR_TRUEDAMAGE, _num: trueDamage };
        items[String(ATTR_ENERGY)] = { _id: ATTR_ENERGY, _num: 50 };  // startMana=50
        items[String(ATTR_POWER)] = { _id: ATTR_POWER, _num: power };
        items[String(ATTR_ORGHP)] = { _id: ATTR_ORGHP, _num: finalHp };  // total HP
        items[String(ATTR_SUPERDAMAGE)] = { _id: ATTR_SUPERDAMAGE, _num: superDamage };
        items[String(ATTR_HEALPLUS)] = { _id: ATTR_HEALPLUS, _num: healPlus };
        items[String(ATTR_HEALERPLUS)] = { _id: ATTR_HEALERPLUS, _num: healerPlus };
        items[String(ATTR_DAMAGEUP)] = { _id: ATTR_DAMAGEUP, _num: damageUp };
        items[String(ATTR_DAMAGEDOWN)] = { _id: ATTR_DAMAGEDOWN, _num: damageDown };
        items[String(ATTR_SUPERDAMAGERESIST)] = { _id: ATTR_SUPERDAMAGERESIST, _num: superDamageResist };
        items[String(ATTR_CRITICALDAMAGERESIST)] = { _id: ATTR_CRITICALDAMAGERESIST, _num: criticalDamageResist };
        items[String(ATTR_BLOCKTHROUGH)] = { _id: ATTR_BLOCKTHROUGH, _num: blockThrough };
        items[String(ATTR_ENERGYMAX)] = { _id: ATTR_ENERGYMAX, _num: Number(heroData.energyMax) || 100 };

        return { _items: items };
    }

    // ═══════════════════════════════════════════════════════════
    //  _skills builder — WAJIB untuk battle engine (getModelArray L67335)
    //  Format: { "<skillId>": { _type, _id, _level } }
    //  _type: 0=normal, 1=proactive(skill), 2=passive, 3=superSkill, 4=potentialSkill
    //  getEnemySkill (L67366-67376) baca ini untuk build HeroSkill object.
    //  Kalau kosong → enemy tidak punya normal attack → DIEM PATUNG!
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

    // ═══════════════════════════════════════════════════════════
    //  ENEMY ENTRY BUILDER (build full BattleTeam)
    // ═══════════════════════════════════════════════════════════

    function buildEnemyEntry(enemyConfig) {
        var heroData = getHeroConfig(enemyConfig.heroDisplayId);
        if (!heroData) {
            log.warn('CELLGAME_START', 'Hero ' + enemyConfig.heroDisplayId + ' not found in hero.json, using defaults');
            heroData = {
                id: enemyConfig.heroDisplayId,
                heroType: 'strength', type: 'strength',
                balanceHp: 1, balanceAttack: 1, balanceArmor: 1,
                speed: 180, normal: 100191, skill: 100101, skillLevel: 1,
                energyMax: 100
            };
        }

        var heroDisplayId = Number(heroData.id) || enemyConfig.heroDisplayId;
        var heroLevel = enemyConfig.heroLevel;
        var skinId = Number(heroData.defaultSkin) || 0;

        var skills = buildEnemySkills(heroData);
        var attrs = computeEnemyAttrs(
            heroData, heroLevel,
            enemyConfig.diffHp, enemyConfig.diffAtk, enemyConfig.diffArmor,
            enemyConfig.isFinal
        );

        // Extract HP for _totalDamage calculation
        var enemyMaxHp = attrs._items[String(ATTR_ORGHP)]._num;

        // _fixPassiveLevel — ARRAY, passive skill levels (L86670, L86681)
        // r[0]=passive1, r[1]=passive2, r[2]=passive3, r[3]=redPassive1, r[4]=redPassive2, r[5]=redPassive3
        // ⚠️ Kalau undefined → level=0 → LOCKED! WAJIB kirim dari hero.json passiveLevel1/2/3
        var fixPassiveLevel = [
            Number(heroData.passiveLevel1) || 0,
            Number(heroData.passiveLevel2) || 0,
            Number(heroData.passiveLevel3) || 0,
            Number(heroData.redPassiveLevel1) || 0,
            Number(heroData.redPassiveLevel2) || 0,
            Number(heroData.redPassiveLevel3) || 0
        ];

        var entry = {
            _heroDisplayId: heroDisplayId,
            _heroLevel: heroLevel,
            _heroStar: 0,
            _evolveLevel: 0,
            _fixSkillLevel: Number(heroData.skillLevel) || 1,
            _fixPassiveLevel: fixPassiveLevel,
            _skinId: skinId,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: attrs
        };

        log.details('CELLGAME_START', [
            ['enemy', 'displayId=' + heroDisplayId + ' lv=' + heroLevel + (enemyConfig.isFinal ? ' [FINAL]' : '')],
            ['hp', enemyMaxHp.toFixed(2)],
            ['atk', attrs._items[String(ATTR_ATTACK)]._num.toFixed(2)],
            ['armor', attrs._items[String(ATTR_ARMOR)]._num.toFixed(2)],
            ['diffHp', String(enemyConfig.diffHp)],
            ['diffAtk', String(enemyConfig.diffAtk)]
        ]);

        return { entry: entry, enemyMaxHp: enemyMaxHp, heroDisplayId: heroDisplayId };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleStartBattle(request, callback) {
        // OUTER SAFETY NET — client BACA e._battleId, e._rightTeam, e._rightSuper,
        // e._totalDamage. ret=1 + empty akan crash.
        try {
            _handleStartBattleImpl(request, callback);
        } catch (err) {
            log.error('CELLGAME_START', 'UNCAUGHT EXCEPTION: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            // Return minimal valid response agar client tidak crash
            callback({
                _battleId: 'cellgame_error_' + Date.now(),
                _rightTeam: { "1": { _heroDisplayId: 0, _heroLevel: 1, _heroStar: 0, _skinId: 0, _weaponHaloId: 0, _weaponHaloLevel: 0, _skills: {}, _attrs: { _items: { "0": { _id: 0, _num: 1000 }, "22": { _id: 22, _num: 1000 } } } } },
                _rightSuper: [],
                _totalDamage: 0   // 0 = battle baru, belum ada damage di-deal
            });
        }
    }

    function _handleStartBattleImpl(request, callback) {
        var userId = request && request.userId;
        var team = request && request.team;
        var superSkills = request && request['super'];

        log.info('CELLGAME_START', 'START (userId=' + (userId || '-') + ')');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['team', JSON.stringify(team || {})],
            ['super', JSON.stringify(superSkills || [])],
            ['version', (request && request.version) || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('CELLGAME_START', 'missing userId');
            callback({}, 1);
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('CELLGAME_START', 'user data not found: ' + key);
            callback({}, 1);
            return;
        }

        // ── LOAD OR INIT CELL GAME STATE ──
        if (!savedData.cellGameState) {
            savedData.cellGameState = buildDefaultState();
            db._set(key, savedData);
        }
        var state = savedData.cellGameState;

        // ── VALIDATE: user must have team set ──
        var heroCount = state._heroes ? Object.keys(state._heroes).length : 0;
        if (heroCount === 0) {
            log.error('CELLGAME_START', 'user has no team set — call cellGame/setTeam first');
            callback({}, 1);
            return;
        }

        // ── LOAD CELL GAME CONFIG ──
        var cellGameCfg = getCellGameConfig();
        if (!cellGameCfg) {
            log.error('CELLGAME_START', 'cellGame.json not found');
            callback({}, 1);
            return;
        }

        var curLevel = Number(state._curLevel) || 1;
        var curEnemy = Number(state._curEnemy) || 1;

        var levelCfg = cellGameCfg[String(curLevel)];
        if (!levelCfg) {
            log.error('CELLGAME_START', 'level ' + curLevel + ' not found in cellGame.json');
            callback({}, 1);
            return;
        }

        // ── EXTRACT ENEMY CONFIG ──
        var enemyConfig = extractEnemyConfig(levelCfg, curEnemy);
        if (!enemyConfig) {
            log.error('CELLGAME_START', 'failed to extract enemy config for level=' + curLevel + ' enemy=' + curEnemy);
            callback({}, 1);
            return;
        }

        log.info('CELLGAME_START', 'curLevel=' + curLevel + ', curEnemy=' + curEnemy
            + (enemyConfig.isFinal ? ' [FINAL]' : '')
            + ', enemy hero=' + enemyConfig.heroDisplayId + ' lv=' + enemyConfig.heroLevel);

        // ── BUILD ENEMY ENTRY ──
        var built = buildEnemyEntry(enemyConfig);
        if (!built || !built.entry) {
            log.error('CELLGAME_START', 'failed to build enemy entry');
            callback({}, 1);
            return;
        }

        // ── GENERATE BATTLE ID ──
        var battleId = generateBattleId(userId);

        // ── PERSIST BATTLE STATE (for checkBattleResult) ──
        //  Includes reward config dari cellGame.json agar checkBattleResult
        //  bisa give rewards tanpa reload config.
        //  Also includes levelChestId for cellGameChest.json lookup (chest reward per level).
        state._currentBattle = {
            battleId: battleId,
            enemyDisplayId: built.heroDisplayId,
            enemyLevel: enemyConfig.heroLevel,
            curLevel: curLevel,
            curEnemy: curEnemy,
            isFinal: enemyConfig.isFinal,
            totalDamage: built.enemyMaxHp,
            rewards: enemyConfig.rewards || [],
            levelChestId: curLevel,  // cellGameChest.json[curLevel] for chest rewards
            timestamp: Date.now()
        };
        db._set(key, savedData);

        log.info('CELLGAME_START', 'battle state saved — battleId=' + battleId
            + ', totalDamage=' + built.enemyMaxHp.toFixed(2));

        // ── BUILD RESPONSE ──
        // _rightTeam = { "0": <BattleTeam> } (1 enemy boss)
        // ⚠️ KEY HARUS "0" (0-indexed) — client akses rightTeam[0] di
        //    getCombatStatisticsTeamWithShaLu (L68550-68555).
        //    Dungeon/startBattle.js juga pakai position: i (i=0,1,2,3,4).
        var response = {
            _battleId: battleId,
            _rightTeam: {
                "0": built.entry
            },
            _rightSuper: [],
            _totalDamage: 0   // 0 = battle baru, belum ada damage di-deal
        };

        log.info('CELLGAME_START', 'SUCCESS — battleId=' + battleId
            + ', enemy=' + built.heroDisplayId
            + ' lv=' + enemyConfig.heroLevel
            + (enemyConfig.isFinal ? ' [FINAL]' : '')
            + ', totalDamage=' + built.enemyMaxHp.toFixed(2)
            + ', rewards=' + enemyConfig.rewards.length + ' items');
        log.details('response', [
            ['userId', userId],
            ['curLevel', String(curLevel)],
            ['curEnemy', String(curEnemy) + (enemyConfig.isFinal ? ' (FINAL)' : '')],
            ['_battleId', battleId],
            ['_rightTeam.1._heroDisplayId', String(built.heroDisplayId)],
            ['_rightTeam.1._heroLevel', String(enemyConfig.heroLevel)],
            ['_rightTeam.1._attrs.hp', built.enemyMaxHp.toFixed(2)],
            ['_rightSuper', '[] (empty)'],
            ['_totalDamage', String(built.enemyMaxHp)],
            ['state._currentBattle', 'saved']
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('cellGame', 'startBattle', handleStartBattle);

})();
