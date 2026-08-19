/**
 * ═══════════════════════════════════════════════════════════════════════
 *  handlers/draft/mine/startBattle.js — Mine StartBattle Handler
 *  Super Warrior Z — MAIN SERVER
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  TUGAS:
 *    1. Validasi request + load _mineModel
 *    2. Baca enemy config dari mine.json berdasarkan _enemyId di _map[x][y][1]
 *    3. Build _rightTeam (dungeon-style computeEnemyAttrs)
 *    4. _battleResult SELALU 0 (WIN) — tidak ada simulasi battle
 *    5. Jika WIN:
 *       a. ENEMY: kirim response map dengan enemy MASIH ADA (untuk client 5x5 fog reveal),
 *          lalu SIMPAN map TANPA enemy ke DB (persist). Update _curX/_curY ke target.
 *       b. BOSS: generate map baru level+1, kirim di response, simpan ke DB.
 *    6. Jika LOSE: kirim map apa adanya, tidak ada perubahan. Bisa coba lagi.
 *    7. WIN: advance main quest 6028 (taskType:"mine", taskPara1:1)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  EVIDENCE DARI main.min(unminfy).js:
 *  ══════════════════════════════════════════════════════════════════
 *
 *  CLIENT REQUEST (L64414-64423):
 *    { type:"mine", action:"startBattle", userId, targetX, targetY,
 *      version:"1.0", team:[...], super:[...],
 *      battleField: BattleLogic.GameFieldType.MINE }
 *
 *  CLIENT RESPONSE USAGE (L64424-64454):
 *    u._battleId       → battleId (L64425)
 *    u._rightTeam      → enemy team untuk battle animation (L64426)
 *    u._rightSuper     → enemy super skill (L64427)
 *    u._battleResult   → 0=menang, 1=kalah (L64430)
 *    u._rand           → random seed array untuk battle animation (L64454)
 *    u._map            → ENTIRE map, enemy MASIH ADA untuk ENEMY WIN (L64440)
 *    u._curX/_curY     → posisi player (L64440 changeMineModelInfo)
 *    u._curLevel       → level saat ini (L64440 changeMineModelInfo)
 *    u._leftStep       → sisa AP (L64440 changeMineModelInfo)
 *    u._stepRecoverTime→ waktu recover AP (L64440 changeMineModelInfo)
 *    u._changeInfo     → item rewards — TIDAK ADA untuk mine battle (L64442)
 *
 *  BATTLE RESULT — SELALU WIN:
 *    _battleResult: 0 → client L64430: isSuccess = (0 == u._battleResult)
 *    Client menjalankan battle animation menggunakan _rand + _rightTeam.
 *    Hasil akhir ditentukan oleh _battleResult dari server, bukan oleh animasi.
 *
 *  changeMineModelInfo (L79583):
 *    Dipanggil di DALAM battle-end callback d (L64440) — BAIK WIN MAUPUN LOSE.
 *    Replace seluruh _MineModel._map dari response.
 *    Update _curX, _curY, _curLevel, _leftStep, _stepRecoverTime jika != undefined.
 *    Client TIDAK punya _bossAttacked — field ini FABRIKASI, TIDAK ADA di code client.
 *
 *  ENEMY WIN (L105117-105143):
 *    showJoinLayerAnimation → !isBoss + isSuccess → playEnemyDeathEffect
 *    → changeCurrPos(targetX, targetY, true) + deleteDataInfo(targetX, targetY)
 *    Server HARUS kirim map dengan enemy MASIH ADA agar client:
 *      a) changeCurrPos cek cell[x][y][1]._type == ENEMY → reveal 5x5 (Chebyshev <= 2)
 *      b) Lalu deleteDataInfo splice(1,1) — no-op karena server sudah hapus
 *
 *  BOSS WIN (L105117-105119):
 *    showJoinLayerAnimation → isBoss + isSuccess → t()
 *    → joinLayer.text = _curLevel.toString() (animasi level number)
 *    → openAllGrassMap TIDAK dipanggil dari battle flow (hanya dari openAll handler)
 *    Server HARUS kirim map BARU level+1 + _curLevel = nextLevel.
 *
 *  LOSE (L105117-105121):
 *    showJoinLayerAnimation → !isSuccess → log "战斗失败", return
 *    TIDAK ada deleteDataInfo, TIDAK ada changeCurrPos.
 *    Boss/enemy tetap di map, player bisa coba lagi.
 *
 *  requestBattle (L105576-105613):
 *    Client TIDAK punya pengecekan apapun sebelum buka enemy info panel.
 *    Hanya cek isClick (animation lock). Tidak ada _bossAttacked.
 *
 *  TASK 6028 (main quest, taskType:"mine"):
 *    "Defeat boss in wild adventure" — advance di startBattle saat WIN.
 *    Pattern: arena/startBattle.js checkMainQuestAdvance.
 *    getChest.js advance dailyTask 6121 (mineChest), BUKAN mainQuest 6028.
 *
 *  STORAGE:
 *    _mineModel di db._get('user:'+userId+'')._mineModel
 *    Update: _map, _curX, _curY, _curLevel, _leftStep, _stepRecoverTime
 *    Task progress: savedData._mineBattleProgress.battle
 * ══════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var ITEM_TYPE = {
        UNKNOW: 0, DOOR: 1, ENEMY: 2,
        SILVER_CHEST: 3, GOLDEN_CHEST: 4, BOSS: 5
    };

    var MAP_COLS = 7;  // x: 0..6
    var MAP_ROWS = 8;  // y: 0..7
    var START_X = 6, START_Y = 7;
    var BOSS_X = 0,  BOSS_Y = 0;
    var MAX_LEVEL = 80;

    // Task & player level
    var PLAYERLEVELID = 104;
    var TASK_STATE_DEFAULT  = 0;
    var TASK_STATE_DOING    = 1;
    var TASK_STATE_COMPLETE = 2;
    var TASK_STATE_FINISH   = 3;

    // Enemy energy start (used in computeEnemyAttrs _attrs)
    var START_MANA = 50;

    // ATTR ID mapping — HERO_ATTRIBUTE enum L73674
    var ATTR = {
        HP: 0, ATTACK: 1, ARMOR: 2, SPEED: 3,
        HIT: 4, DODGE: 5, BLOCK: 6, BLOCK_EFFECT: 7,
        SKILL_DAMAGE: 8, CRITICAL: 9, CRIT_RESIST: 10,
        CRIT_DAMAGE: 11, ARMOR_BREAK: 12, DAMAGE_REDUCE: 13,
        CONTROL_RESIST: 14, TRUE_DAMAGE: 15, REMAIN_ENERGY: 16,
        POWER: 21, FULL_HP: 22, SUPER_DAMAGE: 23,
        HEAL_PLUS: 24, HEALER_PLUS: 25, EXTRA_ARMOR: 26,
        DAMAGE_UP: 28, DAMAGE_DOWN: 29,
        SUPER_DMG_RESIST: 31, CRIT_DMG_RESIST: 36,
        BLOCK_THROUGH: 37, ENERGY_MAX: 41
    };

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADERS (cached sync XHR)
    // ═══════════════════════════════════════════════════════════

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _cache[name] = data;
                return data;
            }
            log.error('MINE_SB', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('MINE_SB', 'loadJson ' + name + ': ' + e.message);
        }
        return null;
    }

    function loadHeroCfg()      { return loadJson('hero'); }
    function loadHeroLevelCfg() { return loadJson('heroLevelAttr'); }
    function loadMineCfg()      { return loadJson('mine'); }
    function loadTaskCfg()      { return loadJson('task'); }

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
    //  RANDOM ARRAY GENERATOR (for client battle animation)
    // ═══════════════════════════════════════════════════════════

    function generateRandArray(count) {
        var arr = [];
        for (var i = 0; i < count; i++) {
            arr.push(Math.round(1E5 * Math.random()) / 1E5);
        }
        return arr;
    }

    // ═══════════════════════════════════════════════════════════
    //  ATTR HELPER
    // ═══════════════════════════════════════════════════════════

    function getAttrNum(attrs, id) {
        if (!attrs || !attrs._items) return 0;
        var entry = attrs._items[String(id)];
        return entry ? (Number(entry._num) || 0) : 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  DETERMINE TYPE CATEGORY
    // ═══════════════════════════════════════════════════════════

    function getTypeCategory(heroType) {
        if (heroType === 'critical' || heroType === 'criticalSingle' || heroType === 'hit') {
            return 'ATK';
        }
        if (heroType === 'body' || heroType === 'block' || heroType === 'dodge' ||
            heroType === 'armor' || heroType === 'armorS' || heroType === 'bodyDamage') {
            return 'TANK';
        }
        return 'SKL';
    }

    // ═══════════════════════════════════════════════════════════
    //  COMPUTE ENEMY ATTRS — dungeon-style
    // ═══════════════════════════════════════════════════════════
    //
    //  Formula:
    //    SKL HP = floor(LA.hp/2 - 240) * diffHp
    //    ATK HP = floor(LA.hp/2 - 14*lv - 290) * diffHp
    //    TANK HP = floor(LA.hp/2 + 412) * diffHp
    //    SKL ATK = (13*lv + 47) * diffAtk
    //    ATK ATK = round(12.25*lv + 51) * diffAtk
    //    TANK ATK = round(9*lv + 1) * diffAtk
    //    Armor = LA.armor - 21 (NOT multiplied)

    function computeEnemyAttrs(heroData, level, diffHp, diffAtk, diffArmor, controlResist) {
        var levelAttr = loadHeroLevelCfg();
        var lvlData = levelAttr && levelAttr[String(level)];
        if (!lvlData) {
            lvlData = levelAttr && levelAttr['1'];
            if (!lvlData) lvlData = { hp: 1240, attack: 125, armor: 205 };
            log.warn('MINE_SB', 'heroLevelAttr level ' + level + ' not found, using level 1');
        }

        var laHp    = Number(lvlData.hp) || 1240;
        var laArmor = Number(lvlData.armor) || 205;

        var cat = getTypeCategory(heroData.heroType || heroData.type || 'strength');

        var hpBase;
        if (cat === 'SKL') {
            hpBase = Math.floor(laHp / 2 - 240);
        } else if (cat === 'ATK') {
            hpBase = Math.floor(laHp / 2 - 14 * level - 290);
        } else {
            hpBase = Math.floor(laHp / 2 + 412);
        }

        var atkBase;
        if (cat === 'SKL') {
            atkBase = 13 * level + 47;
        } else if (cat === 'ATK') {
            atkBase = Math.round(12.25 * level + 51);
        } else {
            atkBase = Math.round(9 * level + 1);
        }

        diffHp  = Number(diffHp)  || 1;
        diffAtk = Number(diffAtk) || 1;

        var finalHp    = hpBase * diffHp;
        var finalAtk   = atkBase * diffAtk;
        var finalArmor = laArmor - 21;

        var speed    = Number(heroData.speed) || 180;
        var energyMax = Number(heroData.energyMax) || 100;
        var hit, crit, critDmg, dodge, block, blockEffect, critResist;

        if (cat === 'SKL') {
            hit = level / 14000;
            crit = hit * 2.5;
            critDmg = crit * 1.5;
            dodge = 0; block = 0; blockEffect = 0; critResist = 0;
        } else if (cat === 'ATK') {
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

        var ctrlResist = (controlResist > 0) ? controlResist : 0;

        var balancePower = Number(heroData.balancePower) || 1;
        var ATK_WEIGHTS = {
            'critical': 20, 'criticalSingle': 20, 'hit': 20,
            'skill': 15, 'body': 15, 'block': 15, 'armor': 15,
            'armorDamage': 15, 'armorS': 15, 'bodyDamage': 15,
            'dodge': 15, 'strength': 15, 'dot': 15
        };
        var heroType = heroData.heroType || heroData.type || 'strength';
        var atkWeight = ATK_WEIGHTS[heroType] || 15;
        var power = Math.floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor);

        var items = {};
        items[String(ATTR.HP)]           = { _id: ATTR.HP,           _num: finalHp };
        items[String(ATTR.ATTACK)]       = { _id: ATTR.ATTACK,       _num: finalAtk };
        items[String(ATTR.ARMOR)]        = { _id: ATTR.ARMOR,        _num: finalArmor };
        items[String(ATTR.SPEED)]        = { _id: ATTR.SPEED,        _num: speed };
        items[String(ATTR.HIT)]          = { _id: ATTR.HIT,          _num: hit };
        items[String(ATTR.DODGE)]        = { _id: ATTR.DODGE,        _num: dodge };
        items[String(ATTR.BLOCK)]        = { _id: ATTR.BLOCK,        _num: block };
        items[String(ATTR.BLOCK_EFFECT)] = { _id: ATTR.BLOCK_EFFECT, _num: blockEffect };
        items[String(ATTR.SKILL_DAMAGE)] = { _id: ATTR.SKILL_DAMAGE, _num: 0 };
        items[String(ATTR.CRITICAL)]     = { _id: ATTR.CRITICAL,     _num: crit };
        items[String(ATTR.CRIT_RESIST)]  = { _id: ATTR.CRIT_RESIST,  _num: critResist };
        items[String(ATTR.CRIT_DAMAGE)]  = { _id: ATTR.CRIT_DAMAGE,  _num: critDmg };
        items[String(ATTR.ARMOR_BREAK)]  = { _id: ATTR.ARMOR_BREAK,  _num: 0 };
        items[String(ATTR.DAMAGE_REDUCE)] = { _id: ATTR.DAMAGE_REDUCE, _num: 0 };
        items[String(ATTR.CONTROL_RESIST)] = { _id: ATTR.CONTROL_RESIST, _num: ctrlResist };
        items[String(ATTR.TRUE_DAMAGE)]  = { _id: ATTR.TRUE_DAMAGE,  _num: 0 };
        items[String(ATTR.REMAIN_ENERGY)] = { _id: ATTR.REMAIN_ENERGY, _num: START_MANA };
        items[String(ATTR.POWER)]        = { _id: ATTR.POWER,        _num: power };
        items[String(ATTR.FULL_HP)]      = { _id: ATTR.FULL_HP,      _num: finalHp };
        items[String(ATTR.SUPER_DAMAGE)] = { _id: ATTR.SUPER_DAMAGE, _num: 0 };
        items[String(ATTR.HEAL_PLUS)]    = { _id: ATTR.HEAL_PLUS,    _num: 0 };
        items[String(ATTR.HEALER_PLUS)]  = { _id: ATTR.HEALER_PLUS,  _num: 0 };
        items[String(ATTR.EXTRA_ARMOR)]  = { _id: ATTR.EXTRA_ARMOR,  _num: 0 };
        items[String(ATTR.DAMAGE_UP)]    = { _id: ATTR.DAMAGE_UP,    _num: 0 };
        items[String(ATTR.DAMAGE_DOWN)]  = { _id: ATTR.DAMAGE_DOWN,  _num: 0 };
        items[String(ATTR.SUPER_DMG_RESIST)] = { _id: ATTR.SUPER_DMG_RESIST, _num: 0 };
        items[String(ATTR.CRIT_DMG_RESIST)] = { _id: ATTR.CRIT_DMG_RESIST, _num: 0 };
        items[String(ATTR.BLOCK_THROUGH)] = { _id: ATTR.BLOCK_THROUGH, _num: 0 };
        items[String(ATTR.ENERGY_MAX)]   = { _id: ATTR.ENERGY_MAX,   _num: energyMax };

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
    //  BUILD MINE ENEMY ENTRY (_rightTeam[position])
    // ═══════════════════════════════════════════════════════════

    function buildMineEnemyEntry(heroDisplayId, heroLevel, diffHp, diffAtk, diffArmor, ctrlResist) {
        heroDisplayId = Number(heroDisplayId) || 0;
        if (heroDisplayId <= 0) return null;
        heroLevel = Number(heroLevel) || 1;

        var heroCfg = loadHeroCfg();
        var heroData = heroCfg && heroCfg[String(heroDisplayId)];
        if (!heroData) {
            log.warn('MINE_SB', 'heroDisplayId ' + heroDisplayId + ' not in hero.json');
            return null;
        }

        var skills = buildEnemySkills(heroData);
        var attrs = computeEnemyAttrs(heroData, heroLevel, diffHp, diffAtk, diffArmor, ctrlResist);

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

        log.details('MINE_SB', [
            ['enemy', 'id=' + heroDisplayId + ' lv=' + heroLevel],
            ['hp', getAttrNum(attrs, ATTR.HP).toFixed(0)],
            ['atk', getAttrNum(attrs, ATTR.ATTACK).toFixed(0)],
            ['power', getAttrNum(attrs, ATTR.POWER).toFixed(0)]
        ]);

        return entry;
    }

    // ═══════════════════════════════════════════════════════════
    //  GENERATE MINE MAP
    // ═══════════════════════════════════════════════════════════
    //
    //  Hanya menghasilkan _map grid 7x8. Dipakai saat BOSS win
    //  → generate map baru level+1.
    //
    //  Cell HANYA boleh: [fog] atau [fog, { _type, _enemyId, _userId }]

    function generateMineMap(level) {
        var mineCfg = loadMineCfg();
        var cfg = mineCfg && mineCfg[String(level)];
        var silverNum = cfg ? Number(cfg.silverChestNum) : 4;
        var goldNum   = cfg ? Number(cfg.goldenChestNum) : 1;

        var map = [];
        for (var x = 0; x < MAP_COLS; x++) {
            map[x] = [];
            for (var y = 0; y < MAP_ROWS; y++) {
                map[x][y] = [0];
            }
        }

        map[START_X][START_Y] = [1];
        map[BOSS_X][BOSS_Y] = [1, { _type: ITEM_TYPE.BOSS, _enemyId: 0, _userId: "" }];

        var avail = [];
        for (var x = 0; x < MAP_COLS; x++) {
            for (var y = 0; y < MAP_ROWS; y++) {
                if (x === START_X && y === START_Y) continue;
                if (x === BOSS_X  && y === BOSS_Y)  continue;
                avail.push({ x: x, y: y });
            }
        }

        for (var i = avail.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = avail[i]; avail[i] = avail[j]; avail[j] = tmp;
        }

        var idx = 0;
        for (var e = 0; e < 4; e++) {
            var p = avail[idx++];
            map[p.x][p.y] = [0, { _type: ITEM_TYPE.ENEMY, _enemyId: e, _userId: "" }];
        }
        for (var s = 0; s < silverNum; s++) {
            var p = avail[idx++];
            map[p.x][p.y] = [0, { _type: ITEM_TYPE.SILVER_CHEST, _enemyId: 0, _userId: "" }];
        }
        for (var g = 0; g < goldNum; g++) {
            var p = avail[idx++];
            map[p.x][p.y] = [0, { _type: ITEM_TYPE.GOLDEN_CHEST, _enemyId: 0, _userId: "" }];
        }

        return map;
    }

    // ═══════════════════════════════════════════════════════════
    //  DEEP COPY MAP (response & DB independen)
    // ═══════════════════════════════════════════════════════════

    function deepCopyMap(map) {
        var copy = [];
        for (var x = 0; x < map.length; x++) {
            copy[x] = [];
            for (var y = 0; y < map[x].length; y++) {
                var cell = map[x][y];
                if (cell.length <= 1) {
                    copy[x][y] = [cell[0]];
                } else {
                    copy[x][y] = [cell[0], {
                        _type: cell[1]._type,
                        _enemyId: cell[1]._enemyId,
                        _userId: cell[1]._userId
                    }];
                }
            }
        }
        return copy;
    }

    // ═══════════════════════════════════════════════════════════
    //  TASK ADVANCE — Main Quest 6028 (taskType:"mine")
    // ═══════════════════════════════════════════════════════════
    //
    //  Pattern: arena/startBattle.js checkMainQuestAdvance
    //  Task 6028: { id:6028, taskType:"mine", taskPara1:1, levelNeeded:25 }
    //  → "Defeat boss in wild adventure" — 1x battle win.
    //  Progress disimpan di savedData._mineBattleProgress.battle

    function getPlayerLevel(savedData) {
        if (savedData.totalProps && savedData.totalProps._items) {
            var items = savedData.totalProps._items;
            for (var k = 0; k < items.length; k++) {
                if (items[k]._id === PLAYERLEVELID) {
                    return Number(items[k]._num) || 1;
                }
            }
        }
        return 1;
    }

    function checkMineBattleMainQuest(savedData) {
        try {
            var taskCfg = loadTaskCfg();
            var cmt = savedData.curMainTask;
            if (!cmt || !Array.isArray(cmt) || cmt.length === 0) return;
            if (!taskCfg) return;

            var currentState = Number(cmt[0]._state);

            // DEFAULT → DOING
            if (currentState === TASK_STATE_DEFAULT) {
                var def = taskCfg[String(cmt[0]._id)];
                var lvlNeeded = def ? (Number(def.levelNeeded) || 1) : 1;
                var plvl = getPlayerLevel(savedData);

                if (plvl >= lvlNeeded) {
                    cmt[0]._state = TASK_STATE_DOING;
                    log.info('MINE_SB', 'mainQuest — task ' + cmt[0]._id +
                        ' DEFAULT → DOING (level ' + plvl + '>=' + lvlNeeded + ')');
                    if (typeof MainServer.notify === 'function') {
                        MainServer.notify({
                            action: 'mainTaskChange',
                            _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_DOING }]
                        });
                    }
                    currentState = TASK_STATE_DOING;
                } else {
                    return;
                }
            }

            // Hanya proses DOING
            if (currentState !== TASK_STATE_DOING) return;

            var def = taskCfg[String(cmt[0]._id)];
            if (!def) return;

            // Match taskType === 'mine'
            if (def.taskType !== 'mine') return;

            // Track progress
            if (!savedData._mineBattleProgress) savedData._mineBattleProgress = {};
            savedData._mineBattleProgress['battle'] =
                (savedData._mineBattleProgress['battle'] || 0) + 1;

            var count = savedData._mineBattleProgress['battle'];
            var needed = Number(def.taskPara1) || 1;

            log.details('MINE_SB', [
                ['mainQuest', 'id=' + cmt[0]._id + ' type=mine' +
                    ' battles=' + count + '/' + needed]
            ]);

            if (count >= needed) {
                cmt[0]._state = TASK_STATE_COMPLETE;
                log.info('MINE_SB', 'mainQuest — task ' + cmt[0]._id +
                    ' DOING → COMPLETE');
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_COMPLETE }]
                    });
                }
            }
        } catch (e) {
            log.error('MINE_SB', 'mainQuest error: ' + e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(data, callback) {
        var userId   = data.userId;
        var targetX = Number(data.targetX);
        var targetY = Number(data.targetY);
        // data.team, data.super — tidak dipakai server-side

        // ── 1. VALIDASI ──
        if (!userId) {
            log.error('MINE_SB', 'missing userId');
            callback({}, 1);
            return;
        }
        if (isNaN(targetX) || isNaN(targetY)) {
            log.error('MINE_SB', 'invalid targetX/targetY — x=' + targetX + ' y=' + targetY);
            callback({}, 1);
            return;
        }

        // ── 2. LOAD USER DATA ──
        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('MINE_SB', 'no user data for ' + userId);
            callback({}, 1);
            return;
        }

        // ── 3. LOAD _mineModel ──
        var model = savedData._mineModel;
        if (!model || !model._map) {
            log.error('MINE_SB', 'no _mineModel for ' + userId);
            callback({}, 1);
            return;
        }

        // ── 4. VALIDASI TARGET CELL ──
        if (!model._map[targetX] || !model._map[targetX][targetY]) {
            log.error('MINE_SB', 'target out of bounds — x=' + targetX + ' y=' + targetY);
            callback({}, 1);
            return;
        }

        var cell = model._map[targetX][targetY];
        if (!cell[1]) {
            log.error('MINE_SB', 'no item at target — x=' + targetX + ' y=' + targetY);
            callback({}, 1);
            return;
        }

        var item = cell[1];
        var itemType = item._type;
        if (itemType !== ITEM_TYPE.ENEMY && itemType !== ITEM_TYPE.BOSS) {
            log.error('MINE_SB', 'target is not enemy/boss — type=' + itemType);
            callback({}, 1);
            return;
        }

        var isBoss = (itemType === ITEM_TYPE.BOSS);

        // ── 5. DETERMINE ENEMY SLOT → load mine.json config ──
        //    L105589: enemyId 0→enemyList1, 1→enemyList2, 2→enemyList3, 3→enemyList4
        //    BOSS: selalu enemyListBOSS (ignore _enemyId)
        var enemySlot;
        if (isBoss) {
            enemySlot = 'BOSS';
        } else {
            enemySlot = String(Number(item._enemyId) + 1);
        }

        var level = Number(model._curLevel) || 1;
        var mineCfg = loadMineCfg();
        var levelCfg = mineCfg && mineCfg[String(level)];
        if (!levelCfg) {
            log.error('MINE_SB', 'mine.json has no entry for level ' + level);
            callback({}, 1);
            return;
        }

        // Parse enemy config for this slot
        var enemyListStr  = String(levelCfg['enemyList' + enemySlot] || '');
        var enemyLevelStr = String(levelCfg['enemyLevel' + enemySlot] || '');
        var diffHpStr     = String(levelCfg['difficultyHp' + enemySlot] || '1');
        var diffAtkStr    = String(levelCfg['difficultyAttack' + enemySlot] || '1');
        var diffArmorStr  = String(levelCfg['difficultyArmor' + enemySlot] || '1');
        var ctrlResistStr = String(levelCfg['controlResist' + enemySlot] || '');

        var heroIds  = enemyListStr.split(',');
        var heroLvls = enemyLevelStr.split(',');
        var dHps     = diffHpStr.split(',');
        var dAtks    = diffAtkStr.split(',');
        var dArmors  = diffArmorStr.split(',');
        var dCtrls   = ctrlResistStr.split(',');

        // ── 6. BUILD _rightTeam (dungeon-style) ──
        var rightTeam = {};
        for (var ei = 0; ei < heroIds.length && ei < 5; ei++) {
            var hId  = heroIds[ei] ? Number(heroIds[ei].trim()) : 0;
            var hLvl = heroLvls[ei] ? Number(heroLvls[ei].trim()) : 1;
            var dHp  = dHps[ei] ? Number(dHps[ei].trim()) : 1;
            var dAtk = dAtks[ei] ? Number(dAtks[ei].trim()) : 1;
            var dAr  = dArmors[ei] ? Number(dArmors[ei].trim()) : 1;
            var dCr  = dCtrls[ei] ? Number(dCtrls[ei].trim()) : 0;

            if (hId <= 0) continue;

            var entry = buildMineEnemyEntry(hId, hLvl, dHp, dAtk, dAr, dCr);
            if (entry) {
                rightTeam[String(ei)] = entry;
            }
        }

        var enemyCount = Object.keys(rightTeam).length;
        if (enemyCount === 0) {
            log.error('MINE_SB', 'no valid enemies built for slot ' + enemySlot);
            callback({}, 1);
            return;
        }

        log.info('MINE_SB', 'Built ' + enemyCount + ' enemies for slot ' + enemySlot);

        // ── 7. BATTLE RESULT — SELALU WIN ──
        //    Tidak ada simulasi battle di server.
        //    Client menjalankan battle animation menggunakan _rand + _rightTeam.
        //    Hasil ditentukan oleh _battleResult, bukan oleh animasi.
        var battleResult = 0; // SELALU WIN

        // ── 8. POST-BATTLE STATE CHANGES ──
        var responseMap;

        if (battleResult === 0) {
            // ── WIN ──

            if (isBoss) {
                // ── BOSS WIN: generate map baru level+1 ──
                var nextLevel = Math.min(level + 1, MAX_LEVEL);
                var newMap = generateMineMap(nextLevel);

                model._map = newMap;
                model._curLevel = nextLevel;
                model._curX = START_X;
                model._curY = START_Y;

                responseMap = newMap;

                log.info('MINE_SB', 'BOSS defeated! Level ' + level + ' → ' + nextLevel);

            } else {
                // ── ENEMY WIN ──
                // Response map = map SEBELUM enemy dihapus (client butuh enemy
                // untuk changeCurrPos → r=2 → 5x5 Chebyshev reveal).
                responseMap = deepCopyMap(model._map);

                // Hapus enemy dari DB map (persist)
                var fogState = cell[0];
                model._map[targetX][targetY] = [fogState];

                // Update posisi player ke target
                model._curX = targetX;
                model._curY = targetY;

                log.info('MINE_SB', 'Enemy defeated at (' + targetX + ',' + targetY +
                    '). Response map has enemy (for 5x5 reveal), DB map removed.');
            }

            // Advance main quest 6028 (taskType:"mine")
            checkMineBattleMainQuest(savedData);

            // Simpan ke DB
            db._set(storageKey, savedData);
            log.info('MINE_SB', 'Saved updated _mineModel to DB');

        } else {
            // ── LOSE: tidak ada perubahan. Player bisa coba lagi. ──
            responseMap = model._map;
            log.info('MINE_SB', 'Battle lost. No state changes — can retry.');
        }

        // ── 9. BUILD RESPONSE ──
        var response = {
            _battleId:        generateUUID(),
            _battleResult:    battleResult,
            _rand:            generateRandArray(100),
            _rightTeam:       rightTeam,
            _rightSuper:      {},
            _map:             responseMap,
            _curX:            model._curX,
            _curY:            model._curY,
            _curLevel:        model._curLevel,
            _leftStep:        model._leftStep,
            _stepRecoverTime: model._stepRecoverTime
        };

        log.info('MINE_SB', 'Response ready — result=WIN' +
            ' level=' + model._curLevel +
            ' isBoss=' + isBoss);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('mine', 'startBattle', handle);

})();