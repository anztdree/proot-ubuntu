/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: hangup/startGeneral
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TUGAS UTAMA
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Menyusun data tim musuh (enemy team) untuk pertempuran hangup/idle.
 *  Client mengirim team pemain + super skills, server membalas dengan
 *  data tim musuh (_rightTeam) yang sudah dihitung dari lesson config.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  CLIENT FLOW (main.min.js ~L97739)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  1. Player tap "Battle" di hangup/idle screen
 *
 *  2. Client: setMyTeamByType(LAST_TEAM_TYPE.HANGUP, team, super)
 *     → Menyimpan team pemain ke _lastTeamInfo[9] di memory
 *
 *  3. Client: processHandler({
 *       type: 'hangup', action: 'startGeneral',
 *       userId, version: '1.0',
 *       team: [...],       // [{heroId:...}, null, ...]
 *       super: [...],      // skill IDs
 *       battleField: 20
 *     })
 *
 *  4. RESPONSE = {
 *       _rightSuper: [],                      // Super musuh (kosong untuk lesson biasa)
 *       _rightTeam: {                         // OBJECT keyed by string position
 *         "0": { _heroDisplayId, _heroLevel, _heroStar, _skills, _attrs },
 *         "1": { ... },
 *         "2": { ... },
 *         "3": { ... },  // Boss position
 *         "4": { ... }
 *       },
 *       _battleId: "uuid"
 *     }
 *
 *  5. Client sets enemy team dari response:
 *     BattleManager.setRightTeam(response._rightTeam)
 *     → Untuk setiap position, buat Hero objek dari _heroDisplayId + _heroLevel
 *     → Terapkan _attrs untuk stats
 *     → Set _skills untuk skill pasif
 *
 *  6. Battle dimulai → client battle engine
 *     → checkBattleFinishInner menentukan WIN/LOSE
 *     → Selesai → client call checkBattleResult
 *
 *  ══════════════════════════════════════════════════════════════════
 *  ENEMY HERO MODEL CREATION (client-side)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  _rightTeam dikirim ke RunSceneWithBattle.battleWithPVEAndTeamAndOnHookBattle()
 *  [L103607] → BattleSetStartParamSingleton.initTeamWithoutBoss(leftTeam, leftSuper,
 *  rightTeam, rightSuper, bossPos)
 *
 *  → getModelArray(rightTeam) [L102466]
 *    → new BattleLogic.HeroModel() for each position
 *    → getEnemySkill(r._skills) [L102518-102527] maps _type to skill slots:
 *       _type: 0 → skill.normal   (basic/normal attack)
 *       _type: 1 → skill.proactive (active skill)
 *       _type: 2 → skill.passive  (pushed to array)
 *       _type: 3 → skill.superSkill
 *       _type: 4 → skill.potentialSkill (pushed to array)
 *    → getEnemyAttributeModel(r._attrs._items) [L102528]
 *    → setLevelData(new HeroLevelModel(attrs))
 *
 *  ══════════════════════════════════════════════════════════════════
 *  BATTLE TURN FLOW (why _type:0 is MANDATORY)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  BattleRound.processRound() [L71811]:
 *    → resortBySpeed() → sort heroes by speed
 *    → doHeroProcess(0, aliveList) [L71913] → iterate ALL alive heroes
 *      → stepBeforeHero(hero) [L71979] → check death/freeze/control
 *      → heroStart(hero) [L72129]:
 *          → getNormalID() = Number(originHero.skill.normal) [L75118]
 *          → getProactiveID() = Number(originHero.skill.proactive) [L75115]
 *          → if energy >= maxEnergy → use proactive, else use normal
 *          → if (0 >= d) { return; }  ← **SKIPS TURN IF skill ID = 0!** [L72147]
 *          → startProactiveSkill(skillId, isNormal, hero) → hero acts!
 *
 *  CRITICAL: If _skills doesn't contain _type:0, then skill.normal = 0,
 *  getNormalID() returns 0, heroStart() skips the hero's turn entirely.
 *  Enemy stands still like a statue — no attack, no skill, nothing.
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DATA SOURCE CHAIN
 *  ══════════════════════════════════════════════════════════════════
 *
 *  savedData.hangup._curLess
 *       ↓
 *  lesson.json[curLess]
 *       ├── enemyList: ",,1906,55201,1906"     → hero IDs per position
 *       ├── enemyLevel: ",,4,4,4"              → level per position
 *       ├── difficultyHp: "1.45,1.45,1.45,2.32,1.45"
 *       ├── difficultyAttack: "1,1,1,1.1,1"
 *       ├── difficultyArmor: "1,1,1,1,1"
 *       ├── controlResist: ",,,,"
 *       ├── monsterType: ",,strength,skill,strength"
 *       ├── isBoss: 4                            → boss position index
 *       ├── battleBackGround: "haibian_jpg"
 *       └── battleMusic: "bgm_battle_mp3"
 *       ↓
 *  hero.json[heroId] → base stats per hero
 *       ├── id, name, heroType, type
 *       ├── normal: 100191        ← normal attack skill ID
 *       ├── skill: 100101         ← proactive/active skill ID
 *       ├── skillLevel: 1         ← proactive skill level
 *       ├── skillPassive1..3      ← passive skill IDs (optional)
 *       ├── speed, hit, dodge, block, critical, blockEffect, etc.
 *       ├── balanceHp, balanceAttack, balanceArmor
 *       └── energyMax
 *       ↓
 *  heroLevelAttr.json[level] → base hp/attack/armor per level
 *       ↓
 *  heroTypeParam.json[heroType] → type multipliers
 *       ↓
 *  FINAL: Apply difficultyHp/Attack/Armor multipliers from lesson
 *       ↓
 *  _rightTeam[position] = computed enemy data
 *
 *  ══════════════════════════════════════════════════════════════════
 *  ENEMY STAT COMPUTATION
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Formula (for each enemy at position p):
 *
 *    baseHp     = heroLevelAttr[level].hp
 *    baseAttack = heroLevelAttr[level].attack
 *    baseArmor  = heroLevelAttr[level].armor
 *
 *    typeParam  = heroTypeParam[hero.heroType]
 *
 *    rawHp      = baseHp * typeParam.hpParam * hero.balanceHp + typeParam.hpBais
 *    rawAttack  = baseAttack * typeParam.attackParam * hero.balanceAttack + typeParam.attackBais
 *    rawArmor   = baseArmor * typeParam.armorParam * hero.balanceArmor + typeParam.armorBais
 *
 *    finalHp    = rawHp * difficultyHp[p]
 *    finalAtk   = rawAttack * difficultyAttack[p]
 *    finalArmor = rawArmor * difficultyArmor[p]
 *
 *  Sub-stats (from hero.json, NOT scaled by difficulty):
 *    speed, hit, dodge, block, critical, blockEffect, criticalResist,
 *    criticalDamage, skillDamage, armorBreak, damageReduce, controlResist,
 *    trueDamage
 *
 *  ══════════════════════════════════════════════════════════════════
 *  _attrs._items FORMAT (ATTR ID mapping — MUST MATCH CLIENT ENUM!)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Referensi: HERO_ATTRIBUTE enum (main.min.js L73674)
 *
 *  _id: 0  → hp (Health)
 *  _id: 1  → attack (Attack)
 *  _id: 2  → armor (Armor)
 *  _id: 3  → speed (Speed)
 *  _id: 4  → hit (Accuracy)
 *  _id: 5  → dodge (Dodge)
 *  _id: 6  → block (Block)
 *  _id: 7  → blockEffect (Blockeffect)
 *  _id: 8  → skillDamage (Skilldamage)
 *  _id: 9  → critical (Criticalratio)
 *  _id: 10 → criticalResist (Criticalresist)
 *  _id: 11 → criticalDamage (Criticaldamage)
 *  _id: 12 → armorBreak (Armorbreak)
 *  _id: 13 → damageReduce (Damagereduce)
 *  _id: 14 → controlResist (Controlresist)
 *  _id: 15 → trueDamage (Truedamage)
 *  _id: 16 → RemainEnery (0 for enemy)
 *  _id: 22 → FullHealth (= finalHp, for health bar init)
 *  _id: 23 → superDamage
 *  _id: 24 → healPlus
 *  _id: 25 → healerPlus
 *  _id: 27 → shielderPlus
 *  _id: 28 → damageUp
 *  _id: 29 → damageDown
 *  _id: 30 → talent
 *  _id: 31 → superDamageResist
 *  _id: 36 → criticalDamageResist
 *  _id: 37 → blockThrough
 *
 *  ══════════════════════════════════════════════════════════════════
 *  _skills FORMAT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Per hero, build from hero.json fields:
 *    hero.normal        → { _type: 0, _id: normal, _level: 1 }       ← MANDATORY!
 *    hero.skill         → { _type: 1, _id: skill, _level: skillLevel } ← proactive
 *    hero.skillPassive1 → { _type: 2, _id: id, _level: 1 }           ← optional
 *    hero.skillPassive2 → { _type: 2, _id: id, _level: 1 }           ← optional
 *    hero.skillPassive3 → { _type: 2, _id: id, _level: 1 }           ← optional
 *
 *  Key = string skill ID, value = skill object
 *
 *  CRITICAL: _type: 0 (normal attack) is MANDATORY. Without it,
 *  BattleLogic HeroModel.getNormalID() returns 0, and heroStart()
 *  skips the hero's turn (L72147). Enemy stands still like a statue!
 *
 *  ══════════════════════════════════════════════════════════════════
 *  IMPORTANT NOTES
 *  ══════════════════════════════════════════════════════════════════
 *
 *  - _rightSuper selalu kosong [] untuk lesson biasa (bukan dungeon)
 *  - _battleId adalah UUID unik untuk setiap battle instance
 *  - battleField dari request di-echo kembali
 *  - Client TIDAK memvalidasi _attrs secara ketat — battle engine
 *    bisa menghitung ulang dari _heroDisplayId + _heroLevel
 *  - NULL positions dalam enemyList → TIDAK masuk ke _rightTeam
 *  - heroStar selalu 0 untuk musuh (tidak ada sistem star untuk enemy)
 *  - hero.json field names: "normal" (NOT skillID!), "skill" (NOT skillID!)
 *    Ini adalah perbaikan dari bug awal yang menyebabkan musuh diem.
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
            log.warn('STARTGENERAL', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('STARTGENERAL', 'loadJson ' + name + ' error: ' + e.message);
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
    //  ATTR ID MAPPING — HARUS SAMA PERSIS DENGAN CLIENT ENUM!
    // ═══════════════════════════════════════════════════════════
    //
    //  Referensi: HERO_ATTRIBUTE enum di main.min.js (L73674):
    //    0:Health, 1:Attack, 2:Armor, 3:Speed, 4:Accuracy(hit),
    //    5:Dodge, 6:Block, 7:Blockeffect, 8:Skilldamage, 9:Criticalratio,
    //    10:Criticalresit, 11:Criticaldamage, 12:Armorbreak, 13:Damagereduce,
    //    14:Controlresist, 15:Truedamage, 16:RemainEnery, 17:HpPercent,
    //    18:ArmorPercent, 19:AttackPercent, 20:SpeedPercent, 21:Power,
    //    22:FullHealth, 23:SuperDamage, 24:HealPlus, 25:HealerPlus,
    //    26:ExtraArmor, 27:ShielderPlus, 28:DamageUp, 29:DamageDown,
    //    30:Talent, 31:SUPERDAMAGERESIST, 32:DRAGONBALLWARDAMAGEUP,
    //    33:DRAGONBALLWARDAMAGEDOWN, 34:BLOODDAMAGE, 35:NORMALATTACK,
    //    36:CRITICALDAMAGERESIST, 37:BLOCKTHROUGH, 38:CONTROLADD,
    //    39:BLOODRESIST, 40:EXTRAARMORBREAK, 41:ENERGYMAX
    //
    //  ⚠️ BUG FIX v2: Mapping ID 7-11 SALAH di versi sebelumnya!
    //    Versi lama mengirim critical di ID 7 (seharusnya Blockeffect),
    //    blockEffect di ID 8 (seharusnya Skilldamage), dll.
    //    Akibatnya: enemy punya blockEffect 70% (seharusnya critical),
    //    skillDamage 0 (padahal 10%), criticalDamage 0 (padahal 104%).
    //
    //  ⚠️ BUG FIX v2: Versi lama hanya mengirim 16 atribut (ID 0-15).
    //    Client membutuhkan ID 16-41 juga (setidaknya 16, 23, 28, 29, 31, 36, 37).
    //    DamageUp(28), DamageDown(29), superDamageResist(31),
    //    criticalDamageResist(36), blockThrough(37) ada di hero.json enemy!
    // ═══════════════════════════════════════════════════════════
    //
    //  FORMAT: Setiap entry = { attrId: {_id, _num} }
    //  ID 0-15: Core stats, ID 16-22: Extended, ID 23-41: Additional
    //  Hanya ID yang punya data dari hero.json atau perlu dihitung.
    //  ID lainnya TIDAK dikirim (client baca undefined → default 0).
    //
    //  Referensi lengkap:
    //    0:Health, 1:Attack, 2:Armor, 3:Speed, 4:Accuracy(hit),
    //    5:Dodge, 6:Block, 7:Blockeffect, 8:Skilldamage, 9:Criticalratio,
    //    10:Criticalresit, 11:Criticaldamage, 12:Armorbreak, 13:Damagereduce,
    //    14:Controlresist, 15:Truedamage, 16:RemainEnery, 17:HpPercent,
    //    18:ArmorPercent, 19:AttackPercent, 20:SpeedPercent, 21:Power,
    //    22:FullHealth, 23:SuperDamage, 24:HealPlus, 25:HealerPlus,
    //    26:ExtraArmor, 27:ShielderPlus, 28:DamageUp, 29:DamageDown,
    //    30:Talent, 31:SUPERDAMAGERESIST, 32:DRAGONBALLWARDAMAGEUP,
    //    33:DRAGONBALLWARDAMAGEDOWN, 34:BLOODDAMAGE, 35:NORMALATTACK,
    //    36:CRITICALDAMAGERESIST, 37:BLOCKTHROUGH, 38:CONTROLADD,
    //    39:BLOODRESIST, 40:EXTRAARMORBREAK, 41:ENERGYMAX

    // ═══════════════════════════════════════════════════════════
    //  COMPUTE ENEMY ATTRS — v4 (HAR-VERIFIED with mathematical proof)
    // ═══════════════════════════════════════════════════════════
    //
    //  PROVEN FROM 4 HAR RESPONSES (10 heroes, 3 levels, 3 types):
    //
    //  ════════════════════════════════════════════════════════════════
    //  FORMULA 1: HP = HP_base × difficultyHp        (10/10 EXACT integer)
    //  FORMULA 2: ATK = ATK_base × difficultyAtk      (10/10 EXACT integer)
    //  FORMULA 3: ARM = heroLevelAttr[level].armor - 21  (10/10 EXACT)
    //  ════════════════════════════════════════════════════════════════
    //
    //  HP_base per type (reverse-engineered from HAR):
    //    SKL (strength/skill/dot):
    //      floor(heroLevelAttr[level].hp / 2 - 240)
    //      Proven: L8=968✅, L12=1306✅, L14=1476✅, L15=1561✅
    //      Constants D=2, E=240 derived from L12→L14 pair:
    //        340/D = 170 → D=2; 3092/2-E=1306 → E=240
    //
    //    ATK (critical/criticalSingle/hit):
    //      floor(heroLevelAttr[level].hp / 2 - 14×level - 290)
    //      Proven: L8=806✅, L12=1088✅, L15=1301✅ (ALL 3 EXACT)
    //      Derived from 3 linear equations: A=0.5, B=-14, C=-290
    //
    //    TANK (body/block/dodge/armor/armorS/bodyDamage):
    //      floor(heroLevelAttr[level].hp / 2 + 412)
    //      UNVERIFIED: only 1 data point (55105 lv12 → 1958)
    //      Also valid: floor((LA.hp + 1400)/2 - 288)
    //
    //  ATK_base per type (reverse-engineered from HAR):
    //    SKL:  13 × level + 47           (L12=203✅, L14=229✅, L15=242✅)
    //    ATK:  round(12.25 × level + 51) (L8=149✅, L12=198✅, L15=235✅)
    //    TANK: round(9 × level + 1)        (L12=109✅, unverified other levels)
    //
    //  Sub-stats per type (from HAR, NOT hero.json):
    //    SKL:  hit = level/14000, crit = hit×2.5, critDmg = crit×1.5
    //          (ratios 2.5 and 1.5 match hero.json crit/hit and critDmg/crit)
    //    ATK:  hit = level/2000,  crit = hit×0.5, critDmg = 0.3 (constant!)
    //    TANK: hit = level/3043, crit = hit×0.5, critDmg = hit
    //          + dodge = level/2500, block = level/8000
    //          + critResist = level/6667  (all from 55105 lv12)
    //
    //  Speed: directly from hero.json[heroId].speed  (9/9 EXACT)
    //
    // ═══════════════════════════════════════════════════════════
    //  BUKTI KUNCI: difficultyHp/Attack ADALAH multiplier langsung!
    //  HP ÷ difficultyHp = integer EXACT untuk semua 10 hero
    //  ATK ÷ difficultyAtk = integer EXACT untuk semua 10 hero
    //  Contoh: 55202 lv8 HP=2437.344, diffHp=3.024 → 2437.344/3.024=806
    // ═══════════════════════════════════════════════════════════

    /**
     * computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, controlResist)
     *
     * @param {object} heroData — entry from hero.json
     * @param {number} level — enemy level (from lesson.enemyLevel)
     * @param {number} diffHp — difficultyHp from lesson (DIRECT multiplier on HP_base)
     * @param {number} diffAtk — difficultyAttack from lesson (DIRECT multiplier on ATK_base)
     * @param {number} diffArmor — difficultyArmor from lesson (unused: always 1 in lesson.json)
     * @param {number} controlResist — controlResist override for this position (0 if empty)
     * @returns {object} _attrs: { _items: { "0": {_id:0, _num:...}, ... } }
     */
    function computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, controlResist) {
        // ── Load base level stats ──
        var levelAttr = loadJson('heroLevelAttr');
        var lvlData = levelAttr ? levelAttr[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttr ? levelAttr['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('STARTGENERAL', 'Level ' + level + ' not found in heroLevelAttr, using level 1');
        }

        var laHp = Number(lvlData.hp) || 1240;
        var laAttack = Number(lvlData.attack) || 125;
        var laArmor = Number(lvlData.armor) || 205;

        // ── Determine effective type category ──
        // Map all heroType values to 3 categories: SKL, ATK, TANK
        var heroType = heroData.heroType || heroData.type || 'strength';
        var typeCategory;
        if (heroType === 'critical' || heroType === 'criticalSingle' || heroType === 'hit') {
            typeCategory = 'ATK';
        } else if (heroType === 'body' || heroType === 'block' || heroType === 'dodge' ||
                   heroType === 'armor' || heroType === 'armorS' || heroType === 'bodyDamage') {
            typeCategory = 'TANK';
        } else {
            // strength, skill, dot, and any unknown → SKL
            typeCategory = 'SKL';
        }

        // ══════════════════════════════════════════════════════
        //  COMPUTE HP_base (integer, before difficulty multiplier)
        // ══════════════════════════════════════════════════════
        var hpBase;
        if (typeCategory === 'SKL') {
            // PROVEN: floor(LA.hp/2 - 240), exact at L8/L12/L14/L15
            hpBase = Math.floor(laHp / 2 - 240);
        } else if (typeCategory === 'ATK') {
            // PROVEN: floor(LA.hp/2 - 14×level - 290), exact at L8/L12/L15
            hpBase = Math.floor(laHp / 2 - 14 * level - 290);
        } else {
            // TANK: floor(LA.hp/2 + 412), UNVERIFIED (1 data point: 55105 lv12=1958)
            hpBase = Math.floor(laHp / 2 + 412);
        }

        // ══════════════════════════════════════════════════════
        //  COMPUTE ATK_base (integer, before difficulty multiplier)
        // ══════════════════════════════════════════════════════
        var atkBase;
        if (typeCategory === 'SKL') {
            // PROVEN: 13×level + 47, exact at L12/L14/L15
            atkBase = 13 * level + 47;
        } else if (typeCategory === 'ATK') {
            // PROVEN: round(12.25×level + 51), exact at L8/L12/L15
            atkBase = Math.round(12.25 * level + 51);
        } else {
            // TANK: round(9×level + 1), UNVERIFIED (1 data point: 55105 lv12=109)
            atkBase = Math.round(9 * level + 1);
        }

        // ══════════════════════════════════════════════════════
        //  APPLY DIFFICULTY MULTIPLIERS (PROVEN: direct multiplication)
        //  HP = hpBase × difficultyHp        (10/10 EXACT integer proof)
        //  ATK = atkBase × difficultyAtk    (10/10 EXACT integer proof)
        // ══════════════════════════════════════════════════════
        var finalHp = hpBase * diffHp;
        var finalAtk = atkBase * diffAtk;

        // ARMOR: universal formula, NOT multiplied by difficultyArmor (always 1)
        // PROVEN: LA.armor - 21, exact for ALL 10 heroes regardless of type
        var finalArmor = laArmor - 21;

        // ══════════════════════════════════════════════════════
        //  SUB-STATS (derived from level, NOT from hero.json values)
        // ══════════════════════════════════════════════════════
        var speed = Number(heroData.speed) || 180;
        var hit, crit, critDmg, dodge, block, blockEffect, critResist;
        var armorBreak = 0, damageReduce = 0, trueDamage = 0;
        var superDamage = 0, healPlus = 0, healerPlus = 0, shielderPlus = 0;
        var damageUp = 0, damageDown = 0;
        var superDamageResist = 0, criticalDamageResist = 0, blockThrough = 0;
        var ctrlResist = (controlResist > 0) ? controlResist : 0;

        if (typeCategory === 'SKL') {
            // PROVEN: hit=level/14000, crit=hit×2.5, critDmg=crit×1.5
            // 2.5 = hero.json critical/hit (0.6986/0.2794)
            // 1.5 = hero.json criticalDamage/critical (1.0479/0.6986)
            hit = level / 14000;
            crit = hit * 2.5;
            critDmg = crit * 1.5;
            dodge = 0;
            block = 0;
            blockEffect = 0;
            critResist = 0;
        } else if (typeCategory === 'ATK') {
            // PROVEN: hit=level/2000, crit=hit×0.5, critDmg=0.3 (constant)
            hit = level / 2000;
            crit = hit * 0.5;
            critDmg = 0.3;
            dodge = 0;
            block = 0;
            blockEffect = 0;
            critResist = 0;
        } else {
            // TANK: UNVERIFIED (1 data point: 55105 lv12)
            // hit ≈ level/3043, dodge ≈ level/2500, block ≈ level/8000
            hit = level / 3043;
            crit = hit * 0.5;
            critDmg = hit;
            dodge = level / 2500;
            block = level / 8000;
            blockEffect = 0;
            critResist = level / 6667;
        }

        // ══════════════════════════════════════════════════════
        //  COMPUTE POWER (ID 21)
        // ══════════════════════════════════════════════════════
        // HAR data shows: power ≈ HP×balPower + ATK×atkWeight + ARM
        // Weights from client code (BattleLogic)
        var balancePower = Number(heroData.balancePower) || 1;
        var ATK_WEIGHTS = {
            'critical': 20, 'criticalSingle': 20, 'hit': 20,
            'skill': 15, 'body': 15, 'block': 15, 'armor': 15,
            'armorDamage': 15, 'armorS': 15, 'bodyDamage': 15,
            'dodge': 15, 'strength': 15, 'dot': 15
        };
        var atkWeight = ATK_WEIGHTS[heroType] || 15;
        var power = Math.floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor);

        // ══════════════════════════════════════════════════════
        //  BUILD _attrs._items
        // ══════════════════════════════════════════════════════
        // HAR-VERIFIED: official sends these IDs: 0-16, 21-26, 28-29, 31, 36-37, 41
        var items = {};

        // ID 0-16: Core stats + RemainEnergy
        items['0'] = { _id: 0,  _num: finalHp };
        items['1'] = { _id: 1,  _num: finalAtk };
        items['2'] = { _id: 2,  _num: finalArmor };
        items['3'] = { _id: 3,  _num: speed };
        items['4'] = { _id: 4,  _num: hit };
        items['5'] = { _id: 5,  _num: dodge };
        items['6'] = { _id: 6,  _num: block };
        items['7'] = { _id: 7,  _num: blockEffect };
        items['8'] = { _id: 8,  _num: 0 };              // skillDamage
        items['9'] = { _id: 9,  _num: crit };
        items['10'] = { _id: 10, _num: critResist };
        items['11'] = { _id: 11, _num: critDmg };
        items['12'] = { _id: 12, _num: armorBreak };
        items['13'] = { _id: 13, _num: damageReduce };
        items['14'] = { _id: 14, _num: ctrlResist };
        items['15'] = { _id: 15, _num: trueDamage };
        items['16'] = { _id: 16, _num: 50 };             // RemainEnergy (HAR: always 50)

        // ID 21-26: Power, FullHealth, SuperDamage, HealPlus, HealerPlus, ExtraArmor
        items['21'] = { _id: 21, _num: power };
        items['22'] = { _id: 22, _num: finalHp };        // FullHealth = HP
        items['23'] = { _id: 23, _num: superDamage };
        items['24'] = { _id: 24, _num: healPlus };
        items['25'] = { _id: 25, _num: healerPlus };
        items['26'] = { _id: 26, _num: 0 };              // ExtraArmor

        // ID 28-29, 31, 36-37, 41
        items['28'] = { _id: 28, _num: damageUp };
        items['29'] = { _id: 29, _num: damageDown };
        items['31'] = { _id: 31, _num: superDamageResist };
        items['36'] = { _id: 36, _num: criticalDamageResist };
        items['37'] = { _id: 37, _num: blockThrough };
        items['41'] = { _id: 41, _num: Number(heroData.energyMax) || 100 };

        return {
            _items: items
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD ENEMY SKILLS
    // ═══════════════════════════════════════════════════════════
    //
    //  From hero.json entry:
    //    hero.normal        → normal attack skill ID (_type: 0) — MANDATORY
    //    hero.skill         → proactive/active skill ID (_type: 1)
    //    hero.skillLevel    → proactive skill level
    //    hero.skillPassive1 → passive skill ID (_type: 2, optional)
    //    hero.skillPassive2 → passive skill ID (_type: 2, optional)
    //    hero.skillPassive3 → passive skill ID (_type: 2, optional)
    //
    //  Client consumes via BattleStatic.getEnemySkill() [L102518-102527]:
    //    _type: 0 → skill.normal   (basic/normal attack)
    //    _type: 1 → skill.proactive (active skill)
    //    _type: 2 → skill.passive  (pushed to array)
    //    _type: 3 → skill.superSkill
    //    _type: 4 → skill.potentialSkill (pushed to array)
    //
    //  Key = string skill ID, value = {_type, _id, _level}
    //
    //  ⚠️ CRITICAL BUG FIX:
    //  Versi lama menggunakan field "skillID" (TIDAK ADA di hero.json!).
    //  Field yang benar adalah "normal" dan "skill".
    //  Tanpa _type:0, getNormalID() return 0, heroStart() skip turn,
    //  dan musuh berdiri diam seperti patung selama pertempuran!

    /**
     * buildEnemySkills(heroData) — Build _skills object for an enemy.
     * @param {object} heroData — entry from hero.json
     * @returns {object} _skills: { "skillId": {_type, _id, _level}, ... }
     */
    function buildEnemySkills(heroData) {
        var skills = {};

        // Normal attack (_type: 0) — MANDATORY!
        // Without this, heroStart() sees getNormalID()=0 → skips hero turn
        // → enemy stands still like a statue during battle!
        if (heroData.normal) {
            var nId = String(heroData.normal);
            skills[nId] = {
                _type: 0,
                _id: heroData.normal,
                _level: 1
            };
        }

        // Proactive/Active skill (_type: 1)
        // ⚠️ HAR-VERIFIED: official server selalu kirim _level=1 untuk proactive,
        //    BUKAN hero.json skillLevel! (hero 55202 skillLevel=2, official kirim _level=1)
        if (heroData.skill) {
            var sId = String(heroData.skill);
            skills[sId] = {
                _type: 1,
                _id: heroData.skill,
                _level: 1
            };
        }

        // ⚠️ HAR-VERIFIED: official server TIDAK mengirim passive skills untuk enemy!
        //    hero 55202 punya skillPassive1=120211, tapi official TIDAK mengirimnya.
        //    Enemy hanya punya normal attack + proactive skill, tanpa passive.

        return skills;
    }

    // ═══════════════════════════════════════════════════════════
    //  PARSE LESSON ENEMY CONFIG
    // ═══════════════════════════════════════════════════════════
    //
    //  lesson.json fields (comma-separated, position-ordered):
    //    enemyList:      ",,1906,55201,1906"     → hero ID per position (empty = no enemy)
    //    enemyLevel:     ",,4,4,4"                → level per position
    //    difficultyHp:   "1.45,1.45,1.45,2.32,1.45"
    //    difficultyAttack: "1,1,1,1.1,1"
    //    difficultyArmor: "1,1,1,1,1"
    //    controlResist:  ",,,,10000"              → control resist override (empty = use default)
    //    monsterType:    ",,strength,skill,strength"  → type hint (informational, not used for stat calc)
    //    isBoss:         4                        → which position is the boss (0-indexed)

    /**
     * parseEnemyList(lesson) — Parse enemy config arrays from lesson data.
     *
     * @param {object} lesson — lesson entry from lesson.json
     * @returns {object} { enemies: [{heroId, level, diffHp, diffAtk, diffArmor, ctrlResist, isBoss}], ... }
     */
    function parseEnemyList(lesson) {
        var enemyStr = String(lesson.enemyList || '');
        var levelStr = String(lesson.enemyLevel || '');
        var hpStr = String(lesson.difficultyHp || '');
        var atkStr = String(lesson.difficultyAttack || '');
        var armorStr = String(lesson.difficultyArmor || '');
        var ctrlStr = String(lesson.controlResist || '');
        var bossIdx = Number(lesson.isBoss) || 0;

        var enemies = enemyStr.split(',');
        var levels = levelStr.split(',');
        var hps = hpStr.split(',');
        var atks = atkStr.split(',');
        var armors = armorStr.split(',');
        var ctrls = ctrlStr.split(',');

        var result = [];

        for (var i = 0; i < enemies.length && i < 5; i++) {
            var heroId = enemies[i].trim();
            if (!heroId || heroId === '') continue; // empty position

            result.push({
                position: i,
                heroId: Number(heroId),
                level: Number(levels[i] || 1),
                diffHp: Number(hps[i] || 1),
                diffAtk: Number(atks[i] || 1),
                diffArmor: Number(armors[i] || 1),
                ctrlResist: Number(ctrls[i] || 0),
                isBoss: (i === bossIdx)
            });
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD SINGLE ENEMY ENTRY (_rightTeam[position])
    // ═══════════════════════════════════════════════════════════

    /**
     * buildEnemyEntry(enemyInfo, heroesData) — Build one _rightTeam entry.
     *
     * @param {object} enemyInfo — parsed enemy config {heroId, level, diffHp, diffAtk, diffArmor, ctrlResist, isBoss}
     * @param {object} heroesData — hero.json data
     * @returns {object} { _heroDisplayId, _heroLevel, _heroStar, _skills, _attrs }
     */
    function buildEnemyEntry(enemyInfo, heroesData) {
        var heroId = enemyInfo.heroId;

        // ── Lookup hero in hero.json ──
        var heroData = null;

        // hero.json keys can be string or number
        if (heroesData[String(heroId)]) {
            heroData = heroesData[String(heroId)];
        } else if (heroesData[heroId]) {
            heroData = heroesData[heroId];
        } else {
            // Search by id field
            var keys = Object.keys(heroesData);
            for (var k = 0; k < keys.length; k++) {
                if (Number(heroesData[keys[k]].id) === Number(heroId)) {
                    heroData = heroesData[keys[k]];
                    break;
                }
            }
        }

        if (!heroData) {
            log.warn('STARTGENERAL', 'Hero ' + heroId + ' not found in hero.json, using defaults');
            heroData = {
                id: heroId,
                heroType: 'strength',
                type: 'strength',
                balanceHp: 1,
                balanceAttack: 1,
                balanceArmor: 1,
                speed: 180,
                hit: 0,
                dodge: 0,
                block: 0,
                critical: 0,
                blockEffect: 0,
                criticalResist: 0,
                criticalDamage: 0,
                skillDamage: 0,
                armorBreak: 0,
                damageReduce: 0,
                controlResist: 0,
                trueDamage: 0,
                normal: 100191,    // default normal attack skill (hero 1001's normal)
                skill: 100101,     // default proactive skill (hero 1001's skill)
                skillLevel: 1
            };
        }

        var heroDisplayId = Number(heroData.id) || heroId;
        var heroLevel = enemyInfo.level;
        var heroStar = 0; // Enemies don't have star level

        // ── Build skills ──
        var skills = buildEnemySkills(heroData);

        // ── Build attrs ──
        var attrs = computeEnemyAttrs(
            heroData,
            heroLevel,
            enemyInfo.diffHp,
            enemyInfo.diffAtk,
            enemyInfo.diffArmor,
            enemyInfo.ctrlResist
        );

        // ── Build entry ──
        // ⚠️ HAR-VERIFIED: official juga mengirim _skinId, _weaponHaloId, _weaponHaloLevel
        var entry = {
            _heroDisplayId: heroDisplayId,
            _heroLevel: heroLevel,
            _heroStar: heroStar,
            _skinId: 0,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: attrs
        };

        log.details('STARTGENERAL', [
            ['enemy', 'pos=' + enemyInfo.position + ' id=' + heroDisplayId + ' lv=' + heroLevel + (enemyInfo.isBoss ? ' BOSS' : '')],
            ['hp', attrs._items['0']._num.toFixed(2)],
            ['atk', attrs._items['1']._num.toFixed(2)],
            ['armor', attrs._items['2']._num.toFixed(2)],
            ['crit', attrs._items['9']._num.toFixed(4)],
            ['critDmg', attrs._items['11']._num.toFixed(4)],
            ['block', attrs._items['6']._num.toFixed(4)],
            ['blockEff', attrs._items['7']._num.toFixed(4)],
            ['skillDmg', attrs._items['8']._num.toFixed(4)],
            ['power', attrs._items['21']._num.toFixed(0)],
            ['dmgUp', attrs._items['28']._num.toFixed(4)],
            ['dmgDown', attrs._items['29']._num.toFixed(4)],
            ['normalAtk', String(heroData.normal || 'NONE')],
            ['activeSkill', String(heroData.skill || 'NONE')],
            ['passiveSkills', 'NONE (HAR: official no passives)'],
            ['diffHpApplied', 'v4: HP_base × diffHp'],
            ['diffAtkApplied', 'v4: ATK_base × diffAtk']
        ]);

        return entry;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hangup/startGeneral
    // ═══════════════════════════════════════════════════════════

    function handleStartGeneral(request, callback) {
        var userId = request.userId;

        log.info('STARTGENERAL', 'Processing startGeneral request');
        log.details('STARTGENERAL', [
            ['userId', userId || '-'],
            ['team', request.team ? JSON.stringify(request.team).substring(0, 200) : '-'],
            ['super', request.super ? JSON.stringify(request.super).substring(0, 200) : '-'],
            ['battleField', String(request.battleField || 20)]
        ]);

        // ── 1. Validate userId ──
        if (!userId) {
            log.warn('STARTGENERAL', 'Missing userId');
            callback({}, 1);
            return;
        }

        // ── 2. Load savedData ──
        var key = 'user:' + userId;
        var sd = db._get(key);
        if (!sd) {
            log.warn('STARTGENERAL', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }
        if (!sd.hangup) sd.hangup = {};

        // ── 3. Read current lesson ──
        var curLess = sd.hangup._curLess || 10101;

        log.details('STARTGENERAL', [
            ['userId', userId],
            ['curLess', String(curLess)]
        ]);

        // ── 4. Load lesson config ──
        var lessonCfg = loadJson('lesson');
        if (!lessonCfg) {
            log.error('STARTGENERAL', 'lesson.json not found');
            callback({}, 1);
            return;
        }

        var les = lessonCfg[String(curLess)] || lessonCfg['10101'];
        if (!les) {
            log.error('STARTGENERAL', 'Lesson ' + curLess + ' not found in config');
            callback({}, 1);
            return;
        }

        log.details('STARTGENERAL', [
            ['lessonId', String(les.id)],
            ['lessonName', String(les.lessonName)],
            ['enemyList', les.enemyList],
            ['enemyLevel', les.enemyLevel],
            ['difficultyHp', les.difficultyHp],
            ['isBoss', String(les.isBoss)]
        ]);

        // ── 5. Load hero.json for hero data lookup ──
        var heroesData = loadJson('hero');
        if (!heroesData) {
            log.error('STARTGENERAL', 'hero.json not found');
            callback({}, 1);
            return;
        }

        // ── 6. Parse enemy list from lesson config ──
        var enemies = parseEnemyList(les);

        log.details('STARTGENERAL', [
            ['enemyCount', String(enemies.length)],
            ['positions', enemies.map(function (e) {
                return e.position + ':' + e.heroId + '(lv' + e.level + ')' + (e.isBoss ? '[BOSS]' : '');
            }).join(', ')]
        ]);

        // ── 7. Build _rightTeam ──
        var rightTeam = {};

        for (var i = 0; i < enemies.length; i++) {
            var enemy = enemies[i];
            var entry = buildEnemyEntry(enemy, heroesData);
            rightTeam[String(enemy.position)] = entry;
        }

        // ── 8. Generate battle ID ──
        var battleId = generateUUID();

        // ── 9. Build response ──
        //
        //  Response format:
        //  {
        //    type: "hangup",
        //    action: "startGeneral",
        //    userId: "...",
        //    version: "1.0",
        //    team: [...],           ← echo request
        //    super: [...],          ← echo request
        //    battleField: 20,       ← echo request
        //    _rightSuper: [],       ← always empty for normal lessons
        //    _rightTeam: { ... },   ← enemy team data
        //    _battleId: "uuid"      ← unique battle identifier
        //  }

        var resp = {
            type: request.type || 'hangup',
            action: request.action || 'startGeneral',
            userId: userId,
            version: request.version || '1.0',
            team: request.team || [],
            super: request.super || [],
            battleField: request.battleField || 20,
            _rightSuper: [],
            _rightTeam: rightTeam,
            _battleId: battleId
        };

        log.info('STARTGENERAL', 'OK userId=' + userId +
            ' lesson=' + curLess +
            ' enemies=' + enemies.length +
            ' battleId=' + battleId);

        log.details('STARTGENERAL', [
            ['response.rightTeamKeys', Object.keys(rightTeam).join(', ')],
            ['response.battleId', battleId]
        ]);

        callback(resp);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hangup', 'startGeneral', handleStartGeneral);

    window.MainServer = MainServer;
})();
