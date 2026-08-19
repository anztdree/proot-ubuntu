/**
 * handlers/arena/startBattle.js — Arena Start Battle Handler (FIXED v6 — QUEST FIX)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  STUDI MENDALAM DARI main.min.js — FINDINGS:
 * ============================================================
 *
 *  CLIENT REQUEST (L63581-63591):
 *    { type:"arena", action:"startBattle", userId, selUser,
 *      version:"1.0", team:[...], selfRank, enemyRank,
 *      super:[...], battleField: GameFieldType.ARENA }
 *
 *  CLIENT RESPONSE USAGE:
 *    t._battleId          → UserInfoSingleton.getInstance().battleId (L63593)
 *    t._battleResult      → 0=menang, 1=kalah (L63594)
 *    t._rightTeam         → musuh team untuk battle sim (L63617)
 *    t._rightSuper        → musuh super skill (L63618)
 *    t._rand              → random seed array untuk battle (L63619)
 *    t._arena._rank       → rank baru setelah battle (L63609)
 *    t._changeInfo._items → getBattleAwardItems(t) (L63394-63412)
 *
 *  CRITICAL: getBattleAwardItems (L63394-63412):
 *    - Baca e._changeInfo._items (Object keyed by STRING item ID)
 *    - _num = ABSOLUTE NEW BALANCE (bukan delta!)
 *    - Item 103 (EXP): trigger EXP gain animation
 *    - Item 104 (Level): trigger level-up check
 *    - Lainnya: tampilkan di summary page + update local cache
 *    - Jika _changeInfo tidak ada → return {} → summary kosong
 *
 *  ARENA REWARD (arenaEveryBattleAward.json):
 *    Setiap battle: item 112 (+20 arena medal) + item 102 (+5000 gold)
 *    Client: setItem(id, absoluteNum) → harus ABSOLUTE balance
 *
 *  TASK SYSTEM (L174012-174083):
 *    queryTask response: { _tasks: { "6109": {_id,_curCount,_targetCount,_state}, ... } }
 *    getReward response: { _finishTasks:[], _nextTasks:[], _changeInfo:{_items} }
 *    Task 6109: taskType="arena", taskPara1=5, levelNeeded=18, reward1=123/num1=1
 *    Task state: DEFAULT(0)→DOING(1)→COMPLETE(2)→FINISH(3)
 *    Client L174055: levelNeeded > getUserLevel() → force state=0 (locked)
 *    Client L173779: state==2 → task siap di-claim
 *
 *  AllRefreshCount (L58000):
 *    _arenaAttackTimes = 5 (initial), decremented CLIENT-SIDE (L63595)
 *    Server arenaState._attackTimes = mirror, decremented SERVER-SIDE (BUG 4 fix)
 *
 * ============================================================
 *  BUG YANG DIFIX (10 bug total):
 * ============================================================
 *
 *  BUG 1 (CRITICAL): Task progress DISCONNECT
 *    OLD: tulis ke _dailyTaskProgress + _dailyTaskStates (tidak ada yang baca)
 *    FIX: tulis ke _taskProgress._daily["6109"] (sama format dengan getReward.js)
 *
 *  BUG 2 (CRITICAL): Task DEFAULT state stuck forever
 *    OLD: init state hanya sekali, tidak re-check levelNeeded
 *    FIX: re-check levelNeeded vs playerLevel (item 104) setiap battle
 *
 *  BUG 3 (CRITICAL): Tidak ada daily reset
 *    OLD: counter & state tidak pernah reset saat hari berganti
 *    FIX: cek _dailyDate, full reset + override 6109 ke DOING/0
 *
 *  BUG 4: _attackTimes tidak divalidasi server-side
 *    OLD: server tidak cek sisa serangan
 *    FIX: validasi _attackTimes > 0, reject kalau habis
 *
 *  BUG 5: Double DB write ke key yang sama
 *    OLD: db._set (rank) → db._get → db._set (task) = 2x write
 *    FIX: 1x read → modify semua → 1x write
 *
 *  BUG 6: computePower() dipanggil 2x per hero player
 *    OLD: computePower untuk hitung + untuk log
 *    FIX: simpan hasil di variable, pakai ulang
 *
 *  BUG 7: Error response double `ret` field
 *    OLD: callback({ret:code, msg:...}, code)
 *    FIX: callback({}, retCode) → clean
 *
 *  BUG 8 (NEW v4): Daily reset hanya reset task 6109
 *    OLD: kalau startBattle jalan SEBELUM getReward di hari baru,
 *         task lain TIDAK ke-reset (getReward cek _dailyDate === today → skip)
 *    FIX: Full daily reset identik getReward.js initDailyProgress(),
 *         lalu override 6109 → DOING/0 untuk real tracking
 *
 *  BUG 9 (NEW v4): Response TIDAK punya _changeInfo._items
 *    OLD: client getBattleAwardItems(t) return {} → summary page kosong
 *    FIX: Baca arenaEveryBattleAward.json, grant item 112 + 102,
 *         return _changeInfo._items dengan ABSOLUTE balance
 *
 *  BUG 10 (NEW v4): Item balance format salah
 *    OLD: (tidak ada reward sama sekali)
 *    FIX: _num = ABSOLUTE NEW BALANCE (L63406: setItem(c, n[u]._num))
 *         Update savedData.totalProps._items juga (persistent)
 *
 *  BUG 11 (NEW v5): STALE REFERENCE — daily reset override HILANG
 *    OLD: var dailyTasks = _daily di-capture SEBELUM initAllDailyTasksFromConfig()
 *         yang reassign _daily = {} (new object). dailyTasks masih menunjuk
 *         OLD object. Override 6109 → DOING/0 menulis ke OLD object yang sudah
 *         terputus dari savedData._taskProgress._daily. AKIBATNYA: task 6109
 *         tetap COMPLETE (dari init), override DOING HILANG, task TIDAK pernah
 *         di-track.
 *    FIX: Setelah initAllDailyTasksFromConfig(), baca ULANG _daily dari
 *         savedData._taskProgress._daily. Jangan pakai cached reference.
 *
 *  BUG 12 (NEW v5): startBattle buat _taskProgress → getReward skip initAchievement
 *    OLD: startBattle create _taskProgress = { _daily:{}, _achievements:{} }
 *         getReward.ensureTaskProgress() cek _taskProgress exists → true →
 *         return EARLY tanpa initAchievementProgress(). _achievements tetap {}
 *         → player tidak bisa claim achievement sama sekali.
 *    FIX: Jangan buat _taskProgress di startBattle. Jika belum ada, skip
 *         task tracking (return false). Biarkan getReward yang init pertama kali.
 *
 *  BUG 13 (NEW v5): Daily reset set 6109 → DOING tanpa cek player level
 *    OLD: Setiap daily reset, 6109 langsung DOING tanpa cek levelNeeded.
 *         Jika player level < 18, task seharusnya DEFAULT (locked).
 *         Client L174055: levelNeeded > getUserLevel() → force state=0.
 *    FIX: Cek getPlayerLevel() sebelum tentukan initial state saat reset.
 *
 *  BUG 14 (QUEST BUG — ROOT CAUSE): Main quest TIDAK di-advance
 *    OLD: arena/startBattle TIDAK punya logic cek & advance main quest.
 *         Semua handler lain (wearAuto, autoLevelUp, dungeon/checkBattleResult,
 *         friend/applyFriend, summonOne, dll) punya pattern:
 *           1. Cek curMainTask[0]._state === 1 (DOING)
 *           2. Match taskType dari task.json
 *           3. Jika kondisi terpenuhi → _state = 2 (COMPLETE)
 *           4. Push mainTaskChange notification ke client
 *         Akibatnya task 6018 (taskType="arena", taskPara1=1) tidak pernah
 *         COMPLETE, quest chain STUCK di 6018.
 *    FIX: Tambahkan checkMainQuestAdvance() identik pattern dari
 *         dungeon/checkBattleResult.js L602-648 + wearAuto.js L836-884.
 *         Termasuk BUG2 fix: DEFAULT→DOING transition saat level cukup.
 *         Track win count di savedData._arenaVictoryProgress (reset per-quest).
 *
 * ============================================================
 *  TUGAS UTAMA:
 * ============================================================
 *    1. VALIDASI request (userId, selUser, attackTimes)
 *    2. LOOKUP musuh dari robotPlayer.json
 *    3. BUILD _rightTeam: hero entry musuh dengan BATTLE ATTRS + SKILLS
 *    4. DETERMINE _battleResult (0=menang, 1=kalah)
 *    5. COMPUTE _arena._rank: rank baru player
 *    6. GENERATE _rand: array random untuk battle simulation
 *    7. GRANT REWARDS: arenaEveryBattleAward.json → _changeInfo._items
 *    8. UPDATE daily task progress (compatible 100% dengan getReward.js)
 *    9. CHECK & ADVANCE main quest (task 6018 arena, identik pattern handler lain)
 *   10. RESPONSE: { _battleId, _battleResult, _rand, _rightTeam, _rightSuper, _arena, _changeInfo }
 *
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var RET_CODES = {
        OK: 0,
        MISSING_USERID: 10001,
        MISSING_SELUSER: 10002,
        ENEMY_NOT_FOUND: 10003,
        NO_ATTACK_TIMES: 10004,
        SERVER_ERROR: 99999
    };

    // State constants — SAMA PERSIS dengan getReward.js L130-133 + main.min.js L62604
    var TASK_STATE_DEFAULT  = 0;
    var TASK_STATE_DOING    = 1;
    var TASK_STATE_COMPLETE = 2;
    var TASK_STATE_FINISH   = 3;

    // Item ID constants — SAMA dengan getReward.js L138-140
    var PLAYEREXPERIENCEID = 103;
    var PLAYERLEVELID      = 104;
    // Item 102 = Gold, Item 112 = Arena Medal (arenaShopRefreshID)
    var GOLD_ID       = 102;
    var ARENA_MEDAL_ID = 112;

    // ═══════════════════════════════════════════════════════════
    //  QUALITY → STAR MAPPING
    // ═══════════════════════════════════════════════════════════

    var QUALITY_TO_STAR = {
        'white':          1,
        'green':          2,
        'blue':           3,
        'purple':         4,
        'orange':         5,
        'flickerOrange':  6,
        'superOrange':    7
    };

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADERS (cached sync XHR)
    // ═══════════════════════════════════════════════════════════

    var _configCache = {};

    function _loadJson(url, label) {
        if (_configCache[url]) return _configCache[url];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _configCache[url] = JSON.parse(xhr.responseText);
            }
        } catch (e) {
            log.warn('ARENA_START', 'Failed to load ' + label + ' — ' + e.message);
        }
        return _configCache[url] || {};
    }

    function loadRobotPlayerCfg() {
        return _loadJson('./resource/json/robotPlayer.json', 'robotPlayer.json');
    }

    function loadHeroCfg() {
        return _loadJson('./resource/json/hero.json', 'hero.json');
    }

    function loadHeroLevelAttrCfg() {
        return _loadJson('./resource/json/heroLevelAttr.json', 'heroLevelAttr.json');
    }

    function loadZPowerQualityParaCfg() {
        return _loadJson('./resource/json/zPowerQualityPara.json', 'zPowerQualityPara.json');
    }

    function loadConstantCfg() {
        return _loadJson('./resource/json/constant.json', 'constant.json');
    }

    function loadTaskDailyCfg() {
        return _loadJson('./resource/json/taskDaily.json', 'taskDaily.json');
    }

    function loadArenaEveryBattleAwardCfg() {
        return _loadJson('./resource/json/arenaEveryBattleAward.json', 'arenaEveryBattleAward.json');
    }

    function loadTaskCfg() {
        return _loadJson('./resource/json/task.json', 'task.json');
    }

    function loadSkillCfg() {
        return _loadJson('./resource/json/skill.json', 'skill.json');
    }

    function loadSkillEffectInstantCfg() {
        return _loadJson('./resource/json/skillEffectInstant.json', 'skillEffectInstant.json');
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Get quality para for a given star level
    // ═══════════════════════════════════════════════════════════

    function getQualityPara(star) {
        var cfg = loadZPowerQualityParaCfg();
        var entry = cfg ? cfg[String(star)] : null;
        return entry ? (Number(entry.para) || 0.2) : 0.2;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Compute Power from real formula
    // ═══════════════════════════════════════════════════════════

    function computePower(level, star) {
        var cfg = loadConstantCfg();
        var c = cfg ? cfg['1'] : null;

        var A = (c && Number(c.zPowerFormulaParaA)) || 100;
        var B = (c && Number(c.zPowerFormulaParaB)) || 5;
        var D = (c && Number(c.zPowerFormulaParaD)) || 35;

        var qualityPara = getQualityPara(star);

        var exponent = 1 + Math.ceil(level / 10) / D;
        var power = (A + level * Math.pow(B, exponent)) * qualityPara;
        return Math.floor(power);
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Infer star from hero.json quality
    // ═══════════════════════════════════════════════════════════

    function inferStarFromQuality(quality) {
        return QUALITY_TO_STAR[quality] || 1;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS
    //  Sama pattern dengan getReward.js L183-204
    //  Server storage: savedData.totalProps._items = [{_id, _num}, ...]
    // ═══════════════════════════════════════════════════════════

    /**
     * Get current balance of an item from savedData.
     * @param {Object} savedData
     * @param {number} id — item ID
     * @returns {number}
     */
    function getBal(sd, id) {
        var items = sd && sd.totalProps && sd.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    /**
     * Set absolute balance of an item in savedData.
     * @param {Object} savedData
     * @param {number} id — item ID
     * @param {number} val — new ABSOLUTE balance
     * @returns {number} the new balance
     */
    function setBal(sd, id, val) {
        if (!sd.totalProps) sd.totalProps = { _items: [] };
        if (!sd.totalProps._items) sd.totalProps._items = [];
        var items = sd.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) {
                items[i]._num = val;
                return val;
            }
        }
        items.push({ _id: id, _num: val });
        return val;
    }

    /**
     * Grant reward: add amount to item balance, record in changeItems for response.
     * @param {Object} savedData — user data (MUTATED)
     * @param {Object} changeItems — response _changeInfo._items accumulator
     * @param {number} itemId — item ID dari config
     * @param {number} amount — jumlah yang ditambahkan (delta)
     * @returns {number} new absolute balance
     *
     * CRITICAL (BUG 10 FIX): _num di response = ABSOLUTE NEW BALANCE.
     * Client L63406: ItemsCommonSingleton.getInstance().setItem(c, n[u]._num)
     * → setItem set lokal cache ke nilai ABSOLUTE dari server.
     */
    function grantReward(savedData, changeItems, itemId, amount) {
        if (!itemId || itemId <= 0 || !amount || amount <= 0) return 0;
        var oldBal = getBal(savedData, itemId);
        var newBal = oldBal + amount;
        setBal(savedData, itemId, newBal);
        changeItems[String(itemId)] = { _id: itemId, _num: newBal };
        log.details('REWARD', ['item', String(itemId), '+' + String(amount), '=' + String(newBal)]);
        return newBal;
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
    //  BUILD BATTLE HERO ENTRY — Full hero with skills + 42 attrs
    // ═══════════════════════════════════════════════════════════

    function buildBattleHeroEntry(heroDisplayId, heroLevel, difficultyHp, difficultyAttack) {
        heroDisplayId = Number(heroDisplayId) || 0;
        if (heroDisplayId <= 0) return null;
        heroLevel = Number(heroLevel) || 1;

        var hc = loadHeroCfg();
        var heroData = hc ? hc[String(heroDisplayId)] : null;
        if (!heroData) {
            log.warn('ARENA_START', 'heroDisplayId ' + heroDisplayId + ' not in hero.json');
            return null;
        }

        // Robot = musuh polos: star SELALU 0, TIDAK di-infer dari quality
        var star = 0;

        // Build skills — sama persis dengan dungeon/hangup/select/join
        var skills = {};
        if (heroData.normal) {
            var nId = String(heroData.normal);
            skills[nId] = { _type: 0, _id: heroData.normal, _level: 1 };
        }
        if (heroData.skill) {
            var sId = String(heroData.skill);
            skills[sId] = { _type: 1, _id: heroData.skill, _level: 1 };
        }

        // ═══ STATS: Dungeon-style enemy formula ═══
        // IDENTIK dengan computeEnemyAttrs di select.js / join.js / dungeon/startBattle.js
        var levelAttrCfg = loadHeroLevelAttrCfg();
        var lvlData = levelAttrCfg ? levelAttrCfg[String(heroLevel)] : null;
        if (!lvlData) {
            lvlData = levelAttrCfg ? levelAttrCfg['1'] : { hp: 1240, attack: 125, armor: 205 };
            log.warn('ARENA_START', 'heroLevelAttr level ' + heroLevel + ' not found, using level 1');
        }

        var laHp     = Number(lvlData.hp) || 1240;
        var laAttack = Number(lvlData.attack) || 125;
        var laArmor  = Number(lvlData.armor) || 205;

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

        // HP_base — type dependent
        var hpBase;
        if (typeCategory === 'SKL') {
            hpBase = Math.floor(laHp / 2 - 240);
        } else if (typeCategory === 'ATK') {
            hpBase = Math.floor(laHp / 2 - 14 * heroLevel - 290);
        } else {
            hpBase = Math.floor(laHp / 2 + 412);
        }

        // ATK_base — type dependent
        var atkBase;
        if (typeCategory === 'SKL') {
            atkBase = 13 * heroLevel + 47;
        } else if (typeCategory === 'ATK') {
            atkBase = Math.round(12.25 * heroLevel + 51);
        } else {
            atkBase = Math.round(9 * heroLevel + 1);
        }

        // Apply difficulty multipliers (armor TIDAK dikali difficulty)
        difficultyHp     = Number(difficultyHp) || 1;
        difficultyAttack = Number(difficultyAttack) || 1;

        var finalHp    = hpBase * difficultyHp;
        var finalAtk   = atkBase * difficultyAttack;
        var finalArmor = laArmor - 21;

        // Sub-stats — type dependent (sama persis dungeon)
        var speed = Number(heroData.speed) || 180;
        var energyMax = Number(heroData.energyMax) || 100;
        var hit, crit, critDmg, dodge, block, blockEffect, critResist;
        var armorBreak = 0, damageReduce = 0, trueDamage = 0;
        var superDamage = 0, healPlus = 0, healerPlus = 0, shielderPlus = 0;
        var damageUp = 0, damageDown = 0;
        var superDamageResist = 0, criticalDamageResist = 0, blockThrough = 0;

        if (typeCategory === 'SKL') {
            hit = heroLevel / 14000;
            crit = hit * 2.5;
            critDmg = crit * 1.5;
            dodge = 0; block = 0; blockEffect = 0; critResist = 0;
        } else if (typeCategory === 'ATK') {
            hit = heroLevel / 2000;
            crit = hit * 0.5;
            critDmg = 0.3;
            dodge = 0; block = 0; blockEffect = 0; critResist = 0;
        } else {
            hit = heroLevel / 3043;
            crit = hit * 0.5;
            critDmg = hit;
            dodge = heroLevel / 2500;
            block = heroLevel / 8000;
            blockEffect = 0;
            critResist = heroLevel / 6667;
        }

        // Power — dungeon-style 3-component formula
        var balancePower = Number(heroData.balancePower) || 1;
        var ATK_WEIGHTS = {
            'critical': 20, 'criticalSingle': 20, 'hit': 20,
            'skill': 15, 'body': 15, 'block': 15, 'armor': 15,
            'armorDamage': 15, 'armorS': 15, 'bodyDamage': 15,
            'dodge': 15, 'strength': 15, 'dot': 15
        };
        var atkWeight = ATK_WEIGHTS[heroType] || 15;
        var power = Math.floor(finalHp * balancePower + finalAtk * atkWeight + finalArmor);

        var talent = Number(heroData.talent) || 0;

        // Build _attrs._items — IDENTIK dengan select.js/join.js/dungeon
        var items = {};
        items['0']  = { _id: 0,  _num: finalHp };
        items['1']  = { _id: 1,  _num: finalAtk };
        items['2']  = { _id: 2,  _num: finalArmor };
        items['3']  = { _id: 3,  _num: speed };
        items['4']  = { _id: 4,  _num: hit };
        items['5']  = { _id: 5,  _num: dodge };
        items['6']  = { _id: 6,  _num: block };
        items['7']  = { _id: 7,  _num: blockEffect };
        items['8']  = { _id: 8,  _num: 0 };
        items['9']  = { _id: 9,  _num: crit };
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
        items['41'] = { _id: 41, _num: energyMax };

        return {
            _heroDisplayId: heroDisplayId,
            _heroLevel: heroLevel,
            _heroStar: 0,
            _skinId: 0,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: { _items: items }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  GENERATE RANDOM ARRAY
    // ═══════════════════════════════════════════════════════════

    function generateRandArray(count) {
        var arr = [];
        for (var i = 0; i < count; i++) {
            arr.push(Math.round(1E5 * Math.random()) / 1E5);
        }
        return arr;
    }

    // ═══════════════════════════════════════════════════════════
    //  BATTLE SIMULATION HELPERS (Bug 2 Fix)
    // ═══════════════════════════════════════════════════════════
    //
    //  Ganti powerRatio + Math.random() dengan simulasi battle.
    //  Server menjalankan battle simulation menggunakan _rand + team stats,
    //  menentukan pemenang: "siapa yang semua hero mati duluan".
    //  Pola: samakan dengan dungeon (tidak terlalu kompleks).
    //  Bot polos: star 0, no equip, no passive, no awakening, skill level 1.
    //
    //  Random consumption per target (polos = 3 randoms):
    //    1. getOneRandom() → dodge check
    //    2. getOneRandom() → block check
    //    3. getOneRandom() → critical check
    //
    //  References:
    //    Client BattleLogic (main.min.js L4550-4865)
    //    constant.json: normalMana=50, beHitMana=10, beCriticalMana=20,
    //                   maxMana=100, startMana=50
    //    skill.json + skillEffectInstant.json: damage multipliers
    //    C_DEFUALT_ROUND_TOTAL=15, C_criticalDouble=1.3 (client L4648)
    //
    // ═══════════════════════════════════════════════════════════

    /**
     * Get damage multiplier for a skill at given level.
     * skill.json → eventTrigger → effectInstant → skillEffectInstant.json → keyValue2
     * keyValue2 format: "level:multiplier,level:multiplier,..."
     *
     * @param {number} skillId
     * @param {number} skillLevel
     * @returns {number} damage multiplier (e.g. 1.0 = 100% ATK, 1.38 = 138% ATK)
     */
    function getDamageMultiplier(skillId, skillLevel) {
        if (!skillId) return 1.0;
        var skillCfg = loadSkillCfg();
        var skillData = skillCfg && skillCfg[String(skillId)];
        if (!skillData || !skillData.eventTrigger) return 1.0;

        for (var g = 0; g < skillData.eventTrigger.length; g++) {
            var group = skillData.eventTrigger[g];
            if (!Array.isArray(group)) continue;
            for (var a = 0; a < group.length; a++) {
                var action = group[a];
                if (action && action.effectInstant) {
                    var effCfg = loadSkillEffectInstantCfg();
                    var eff = effCfg && effCfg[String(action.effectInstant)];
                    if (eff && eff.effect === 'damageAttack' && eff.keyValue2) {
                        var parts = String(eff.keyValue2).split(',');
                        for (var p = 0; p < parts.length; p++) {
                            var kv = parts[p].split(':');
                            if (Number(kv[0]) === skillLevel) {
                                return Number(kv[1]) || 1.0;
                            }
                        }
                        // Fallback: use first entry
                        if (parts.length > 0) {
                            var first = parts[0].split(':');
                            return Number(first[1]) || 1.0;
                        }
                    }
                }
            }
        }
        return 1.0;
    }

    /**
     * Extract battle stat from _attrs._items by attr ID.
     * @param {Object} attrs — hero._attrs object
     * @param {number} id — attr ID (0=HP, 1=ATK, 2=Armor, etc.)
     * @returns {number}
     */
    function getAttrNum(attrs, id) {
        if (!attrs || !attrs._items) return 0;
        var entry = attrs._items[String(id)];
        return entry ? (Number(entry._num) || 0) : 0;
    }

    /**
     * Build player hero battle data for simulation.
     * Tries to use pre-computed _attrs from savedData (most accurate).
     * Falls back to dungeon-style formula with player's actual star.
     *
     * @param {Object} foundHero — hero entry from savedData.heros._heros
     * @param {number} pos — team position index
     * @returns {Object|null} battle hero data for simulation
     */
    function buildPlayerHeroBattleData(foundHero, pos) {
        var heroCfg = loadHeroCfg();
        var lvlAttrCfg = loadHeroLevelAttrCfg();

        var displayId = Number(foundHero._heroDisplayId || foundHero.heroDisplayId
                          || foundHero._heroId || foundHero.heroId) || 0;
        var level = Number((foundHero._heroBaseAttr && foundHero._heroBaseAttr._level)
                           || foundHero._heroLevel || foundHero.level) || 1;
        var star = Number(foundHero._heroStar || foundHero.star) || 0;

        var heroData = heroCfg && heroCfg[String(displayId)];
        if (!heroData) {
            log.warn('SIM', 'Player hero displayId ' + displayId + ' not in hero.json');
            return null;
        }
        // Try pre-computed _attrs (includes equipment, awakening, etc.)
        var attrs = foundHero._attrs;
        var hasAttrs = attrs && attrs._items && Object.keys(attrs._items).length > 0;

        var hp, atk, armor, speed, hit, dodge, block, blockEffect;
        var crit, critDmg, critResist, critDmgResist, blockThrough, energyMax;

        if (hasAttrs) {
            // Pre-computed attrs — most accurate (includes equipment bonuses)
            hp = getAttrNum(attrs, 0);
            atk = getAttrNum(attrs, 1);
            armor = getAttrNum(attrs, 2);
            speed = getAttrNum(attrs, 3);
            hit = getAttrNum(attrs, 4);
            dodge = getAttrNum(attrs, 5);
            block = getAttrNum(attrs, 6);
            blockEffect = getAttrNum(attrs, 7);
            crit = getAttrNum(attrs, 9);
            critResist = getAttrNum(attrs, 10);
            critDmg = getAttrNum(attrs, 11);
            critDmgResist = getAttrNum(attrs, 36);
            blockThrough = getAttrNum(attrs, 37);
            energyMax = getAttrNum(attrs, 41) || 100;
        } else if (foundHero._heroBaseAttr) {
            // Use _heroBaseAttr (computed by enterGame.js makeHeroBasicAttr)
            // Includes correct evolve, star, and type formulas
            var ba = foundHero._heroBaseAttr;
            hp = Number(ba._hp) || 0;
            atk = Number(ba._attack) || 0;
            armor = Number(ba._armor) || 0;
            speed = Number(ba._speed) || 180;
            hit = Number(ba._hit) || 0;
            dodge = Number(ba._dodge) || 0;
            block = Number(ba._block) || 0;
            blockEffect = Number(ba._blockEffect) || 0;
            crit = Number(ba._critical) || 0;
            critResist = Number(ba._criticalResist) || 0;
            critDmg = Number(ba._criticalDamage) || 0;
            critDmgResist = 0;
            blockThrough = 0;
            energyMax = Number(ba._energy) || 100;
            level = Number(ba._level) || 1;
        } else {
            // Fallback: dungeon-style formula with player's actual star
            var lvlData = lvlAttrCfg && lvlAttrCfg[String(level)];
            if (!lvlData) {
                lvlData = lvlAttrCfg && lvlAttrCfg['1'];
                if (!lvlData) return null;
            }

            var laHp = Number(lvlData.hp) || 1240;
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

            var qualityPara = getQualityPara(star > 0 ? star : 1);

            if (typeCategory === 'SKL') {
                hp = Math.floor(laHp / 2 - 240) * qualityPara;
                atk = (13 * level + 47) * qualityPara;
                hit = level / 14000;
                crit = hit * 2.5;
                critDmg = crit * 1.5;
                dodge = 0; block = 0; blockEffect = 0; critResist = 0;
            } else if (typeCategory === 'ATK') {
                hp = Math.floor(laHp / 2 - 14 * level - 290) * qualityPara;
                atk = Math.round(12.25 * level + 51) * qualityPara;
                hit = level / 2000;
                crit = hit * 0.5;
                critDmg = 0.3;
                dodge = 0; block = 0; blockEffect = 0; critResist = 0;
            } else {
                hp = Math.floor(laHp / 2 + 412) * qualityPara;
                atk = Math.round(9 * level + 1) * qualityPara;
                hit = level / 3043;
                crit = hit * 0.5;
                critDmg = hit;
                dodge = level / 2500;
                block = level / 8000;
                blockEffect = 0;
                critResist = level / 6667;
            }

            armor = laArmor - 21;
            speed = Number(heroData.speed) || 180;
            critDmgResist = 0;
            blockThrough = 0;
            energyMax = Number(heroData.energyMax) || 100;
        }
        // Get skill damage multipliers from skill.json chain
        var normalDmgMult = 1.0;
        var skillDmgMult = 1.3;

        if (heroData.normal) {
            normalDmgMult = getDamageMultiplier(Number(heroData.normal), 1);
        }
        if (heroData.skill) {
            skillDmgMult = getDamageMultiplier(Number(heroData.skill), 1);
        }

        // Skill accuracy (from skill.json)
        var normalSkillData = heroData.normal && (loadSkillCfg() || {})[String(heroData.normal)];
        var accuracy = (normalSkillData && Number(normalSkillData.accuracy)) || 1;

        return {
            pos: pos,
            hp: hp,
            maxHp: hp,
            atk: atk,
            armor: armor,
            speed: speed,
            hit: hit,
            dodge: dodge,
            block: block,
            blockEffect: blockEffect,
            crit: crit,
            critDmg: critDmg,
            critResist: critResist,
            critDmgResist: critDmgResist,
            blockThrough: blockThrough,
            level: level,
            energy: 50,   // startMana
            maxEnergy: 100, // maxMana
            normalDmgMult: normalDmgMult,
            skillDmgMult: skillDmgMult,
            accuracy: accuracy,
            alive: true
        };
    }

    /**
     * Build enemy (bot) hero battle data from _rightTeam entry.
     * Enemy data already computed by buildBattleHeroEntry (dungeon-style).
     *
     * @param {Object} rightTeamEntry — from rightTeam[pos]
     * @param {number} pos — team position
     * @returns {Object|null} battle hero data for simulation
     */
    function buildEnemyHeroBattleData(rightTeamEntry, pos) {
        if (!rightTeamEntry || !rightTeamEntry._attrs || !rightTeamEntry._attrs._items) {
            return null;
        }

        var displayId = rightTeamEntry._heroDisplayId;
        var heroCfg = loadHeroCfg();
        var heroData = heroCfg && heroCfg[String(displayId)];

        // Get skill damage multipliers
        var normalDmgMult = 1.0;
        var skillDmgMult = 1.3;
        var accuracy = 1;

        if (heroData) {
            if (heroData.normal) {
                normalDmgMult = getDamageMultiplier(Number(heroData.normal), 1);
            }
            if (heroData.skill) {
                skillDmgMult = getDamageMultiplier(Number(heroData.skill), 1);
            }
            var normalSkillData = heroData.normal && (loadSkillCfg() || {})[String(heroData.normal)];
            accuracy = (normalSkillData && Number(normalSkillData.accuracy)) || 1;
        }

        return {
            pos: pos,
            hp: getAttrNum(rightTeamEntry._attrs, 0),
            maxHp: getAttrNum(rightTeamEntry._attrs, 22) || getAttrNum(rightTeamEntry._attrs, 0),
            atk: getAttrNum(rightTeamEntry._attrs, 1),
            armor: getAttrNum(rightTeamEntry._attrs, 2),
            speed: getAttrNum(rightTeamEntry._attrs, 3),
            hit: getAttrNum(rightTeamEntry._attrs, 4),
            dodge: getAttrNum(rightTeamEntry._attrs, 5),
            block: getAttrNum(rightTeamEntry._attrs, 6),
            blockEffect: getAttrNum(rightTeamEntry._attrs, 7),
            crit: getAttrNum(rightTeamEntry._attrs, 9),
            critResist: getAttrNum(rightTeamEntry._attrs, 10),
            critDmg: getAttrNum(rightTeamEntry._attrs, 11),
            critDmgResist: getAttrNum(rightTeamEntry._attrs, 36),
            blockThrough: getAttrNum(rightTeamEntry._attrs, 37),
            level: rightTeamEntry._heroLevel || 1,
            energy: 50,
            maxEnergy: 100,
            normalDmgMult: normalDmgMult,
            skillDmgMult: skillDmgMult,
            accuracy: accuracy,
            alive: true
        };
    }

    /**
     * Server-side battle simulation.
     * "Samakan dengan dungeon, tidak terlalu kompleks" — bot polos.
     *
     * @param {Array} playerHeroes — battle data from buildPlayerHeroBattleData
     * @param {Array} enemyHeroes  — battle data from buildEnemyHeroBattleData
     * @param {Array} randArray    — 100 random floats 0-1 (SAME array sent to client)
     * @returns {number} 0 = player WIN, 1 = player LOSE
     */
    function simulateBattle(playerHeroes, enemyHeroes, randArray) {
        var MAX_ROUND = 15;
        var CRIT_DOUBLE = 1.3;
        var START_MANA = 50;
        var MAX_MANA = 100;
        var NORMAL_MANA_GAIN = 50;
        var BE_HIT_MANA = 10;
        var BE_CRIT_MANA = 20;

        var randIdx = 0;
        var RAND_SIZE = randArray.length;

        function nextRand() {
            var r = randArray[randIdx % RAND_SIZE];
            randIdx++;
            return r;
        }

        // Merge all heroes with team tags
        var allHeroes = [];
        for (var i = 0; i < playerHeroes.length; i++) {
            if (!playerHeroes[i]) continue;
            playerHeroes[i].team = 'player';
            allHeroes.push(playerHeroes[i]);
        }
        for (var j = 0; j < enemyHeroes.length; j++) {
            if (!enemyHeroes[j]) continue;
            enemyHeroes[j].team = 'enemy';
            allHeroes.push(enemyHeroes[j]);
        }

        function getAliveOfTeam(teamTag) {
            var alive = [];
            for (var i = 0; i < allHeroes.length; i++) {
                if (allHeroes[i].team === teamTag && allHeroes[i].alive) alive.push(allHeroes[i]);
            }
            return alive;
        }

        function teamAllDead(teamTag) {
            for (var i = 0; i < allHeroes.length; i++) {
                if (allHeroes[i].team === teamTag && allHeroes[i].alive) return false;
            }
            return true;
        }

        function sortBySpeed() {
            allHeroes.sort(function (a, b) {
                if (!a.alive && !b.alive) return 0;
                if (!a.alive) return 1;
                if (!b.alive) return -1;
                return b.speed - a.speed;
            });
        }

        // ═══ Main battle loop ═══
        for (var round = 1; round <= MAX_ROUND; round++) {
            sortBySpeed();

            // Check finish before round
            if (teamAllDead('player')) return 1;
            if (teamAllDead('enemy')) return 0;

            // Each hero acts in speed order
            for (var h = 0; h < allHeroes.length; h++) {
                var hero = allHeroes[h];
                if (!hero.alive) continue;

                // Get alive enemies
                var targets = (hero.team === 'player')
                    ? getAliveOfTeam('enemy')
                    : getAliveOfTeam('player');
                if (targets.length === 0) break;

                // Pick first alive target (front target, no random consumed)
                var target = targets[0];

                // Determine action: skill or normal attack?
                var dmgMult;
                if (hero.energy >= MAX_MANA && hero.skillDmgMult > 0) {
                    dmgMult = hero.skillDmgMult;
                    hero.energy = 0;
                } else {
                    dmgMult = hero.normalDmgMult;
                    hero.energy = Math.min(hero.energy + NORMAL_MANA_GAIN, MAX_MANA);
                }

                // ═══ CONSUME 3 RANDOMS PER TARGET ═══

                // Random 1: DODGE check (client L4463 checkNormalDodge)
                var dodgeRand = nextRand();
                var accuracy = Math.min(Math.max(1 + hero.hit - target.dodge, 0.2), 1) * hero.accuracy;
                if (dodgeRand > accuracy) {
                    // DODGED — consume block + crit randoms to keep index aligned
                    nextRand(); // block
                    nextRand(); // crit
                    continue;
                }

                // Random 2: BLOCK check (client L4313 checkTargetBlock)
                var blockRand = nextRand();
                var blockRate = Math.max(target.block - hero.blockThrough, 0);
                var isBlocked = (blockRand <= blockRate);

                // Random 3: CRITICAL check (client L4847 checkTargetCritical)
                var critRand = nextRand();
                var critRate = Math.max(hero.crit - target.critResist, 0);
                var isCrit = (critRand <= critRate);

                // ═══ CALCULATE DAMAGE ═══

                // Armor reduction (client L4264 getHeroArmor)
                var lvlDiff = Math.max(0, target.level - 200);
                var levelFactor = 1500 + (550 + Math.pow(lvlDiff, 1.25)) * target.level;
                var armorReduction = target.armor / levelFactor;
                armorReduction = Math.min(armorReduction, 0.7);

                // Core damage
                var damage = hero.atk * dmgMult;
                damage = damage * (1 - armorReduction);

                // Critical multiplier (client L4260)
                if (isCrit) {
                    var critMult = Math.max(CRIT_DOUBLE + hero.critDmg - target.critDmgResist, 1);
                    damage *= critMult;
                }

                // Block reduction (client L4306)
                if (isBlocked) {
                    damage *= Math.max(0.7 - target.blockEffect, 0);
                }

                damage = Math.max(Math.floor(damage), 1);

                // Apply damage
                target.hp -= damage;

                // Target gains energy (client L4362)
                var energyGain = isCrit ? BE_CRIT_MANA : BE_HIT_MANA;
                target.energy = Math.min(target.energy + energyGain, MAX_MANA);

                // Check death
                if (target.hp <= 0) {
                    target.hp = 0;
                    target.alive = false;
                }

                // Check battle finish
                if (teamAllDead('player')) return 1;
                if (teamAllDead('enemy')) return 0;
            }
        }

        // Timeout after 15 rounds → LOSE
        return 1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //
    //  ██████╗  █████╗ ████████╗ █████╗
    //  ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗
    //  ██║  ██║███████║   ██║   ███████║    FIXED v4 — Task System
    //  ██║  ██║██╔══██║   ██║   ██╔══██║    (Studi mendalam dari main.min.js)
    //  ██████╔╝██║  ██║   ██║   ██║  ██║
    //
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  REFERENCES:
    //    getReward.js L346-388: ensureTaskProgress + initDailyProgress
    //    main.min.js L62604: TASK_STATE enum
    //    main.min.js L174012-174083: TaskMainViewData (client reads _tasks)
    //    main.min.js L56829-56840: queryTask call → { _tasks: {...} }
    //    main.min.js L173783-173792: getReward call → { _finishTasks, _nextTasks, _changeInfo }
    //
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get today's date string (UTC), SAMA PERSIS format dengan getReward.js L331-337.
     * @returns {string} "YYYY-MM-DD"
     */
    function getTodayStr() {
        var d = new Date();
        var yyyy = d.getUTCFullYear();
        var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(d.getUTCDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }

    /**
     * Get player's current level from savedData.totalProps._items.
     *
     * main.min.js L62464: getUserLevel() = getItemNum(PLAYERLEVELID)
     * PLAYERLEVELID = 104 (bukan 101!)
     *
     * @param {Object} savedData
     * @returns {number}
     */
    function getPlayerLevel(savedData) {
        if (savedData.totalProps && savedData.totalProps._items) {
            var items = savedData.totalProps._items;
            for (var k = 0; k < items.length; k++) {
                if (items[k]._id === 104) {
                    return Number(items[k]._num) || 1;
                }
            }
        }
        return 1;
    }

    /**
     * Inisialisasi SEMUA daily task dari taskDaily.json.
     * IDENTIK dengan getReward.js L370-388 (initDailyProgress).
     *
     * Semua task di-set COMPLETE (state=2) dengan curCount=targetCount.
     * Ini adalah auto behavior — player bisa langsung claim semua task.
     *
     * @param {Object} savedData — user data (MUTATED)
     */
    function initAllDailyTasksFromConfig(savedData) {
        var dailyConfig = loadTaskDailyCfg();
        if (!dailyConfig) return;

        savedData._taskProgress._daily = {};
        for (var id in dailyConfig) {
            var cfg = dailyConfig[id];
            var target = Number(cfg.taskPara1) || 1;
            savedData._taskProgress._daily[id] = {
                _id: Number(id),
                _curCount: target,
                _targetCount: target,
                _state: TASK_STATE_COMPLETE
            };
        }

        log.info('ARENA_TASK', 'All daily tasks initialized from config: ' +
            Object.keys(savedData._taskProgress._daily).length + ' tasks (COMPLETE)');
    }

    /**
     * Ensure _taskProgress exists and task 6109 (arena) is ready.
     *
     * FIX BUG 8:  FULL daily reset, bukan hanya task 6109.
     * FIX BUG 11: Re-read _daily reference setelah initAllDailyTasksFromConfig.
     * FIX BUG 12: Jangan buat _taskProgress — biarkan getReward init.
     * FIX BUG 13: Cek player level saat daily reset override.
     *
     * @param {Object} savedData — user data from DB (MUTATED)
     * @param {number} arenaTaskId — task ID untuk arena (6109)
     * @param {number} targetCount — target dari taskDaily.json (5)
     * @param {number} levelNeeded — level minimum untuk unlock (18)
     * @returns {boolean} true = task tracking available, false = skip
     */
    function ensureArenaTaskEntry(savedData, arenaTaskId, targetCount, levelNeeded) {
        var today = getTodayStr();
        var taskIdStr = String(arenaTaskId);

        // ═══ FIX BUG 12: JANGAN buat _taskProgress ═══
        // WHY: getReward.ensureTaskProgress() L346-364:
        //   if (_taskProgress exists) → return early (skip initAchievementProgress)
        //   if (_taskProgress not exists) → create + initDailyProgress + initAchievementProgress
        //
        // Kalau startBattle buat _taskProgress dengan _achievements: {},
        // getReward akan skip initAchievementProgress → achievement RUSAK.
        //
        // FIX: Jika _taskProgress belum ada, SKIP task tracking.
        // Biarkan getReward yang init pertama kali (termasuk achievements).
        // Arena battles sebelum getReward pertama tidak akan di-track,
        // tapi ini acceptable — player biasanya buka task panel dulu.
        if (!savedData._taskProgress) {
            log.details('ARENA_TASK', '_taskProgress not exists yet — ' +
                'skipping task tracking (getReward will initialize on first access)');
            return false;
        }

        // ═══ FIX BUG 8 + 11: FULL daily reset + FIX STALE REFERENCE ═══
        //
        // BUG 11 (STALE REFERENCE):
        //   var dailyTasks = _daily         ← capture reference ke OLD object
        //   initAllDailyTasksFromConfig()  ← _daily = {} (NEW object!)
        //   dailyTasks[id] = DOING          ← MENULIS KE OLD OBJECT! HILANG!
        //
        // FIX: Setelah init, BACA ULANG _daily dari savedData.
        if (savedData._taskProgress._dailyDate !== today) {
            log.info('ARENA_TASK', 'Daily reset detected (was ' +
                savedData._taskProgress._dailyDate + ', now ' + today + ')');

            // Step A: Re-init ALL daily tasks from config (identik getReward.js)
            // WARNING: ini reassign savedData._taskProgress._daily = {} (NEW object)
            initAllDailyTasksFromConfig(savedData);

            // FIX BUG 11: BACA ULANG reference setelah reset!
            // _daily sekarang adalah NEW object dari initAllDailyTasksFromConfig.
            var dailyAfterReset = savedData._taskProgress._daily;

            // FIX BUG 13: Cek player level sebelum tentukan initial state
            var playerLevel = getPlayerLevel(savedData);
            var resetState = (playerLevel >= levelNeeded)
                ? TASK_STATE_DOING
                : TASK_STATE_DEFAULT;

            // Step B: Override task 6109 → real tracking
            dailyAfterReset[taskIdStr] = {
                _id: arenaTaskId,
                _curCount: 0,
                _targetCount: targetCount,
                _state: resetState
            };

            // Step C: Update date
            savedData._taskProgress._dailyDate = today;

            log.info('ARENA_TASK', 'Daily reset complete — all tasks auto-COMPLETE, ' +
                'task ' + arenaTaskId + ' → ' +
                (resetState === TASK_STATE_DOING ? 'DOING' : 'DEFAULT') +
                '/0 (level ' + playerLevel + ' vs needed ' + levelNeeded + ')');
        }

        // ═══ Ensure task 6109 entry exists (no daily reset) ═══
        // BACA CURRENT reference — bukan cached variable dari atas!
        var dailyTasks = savedData._taskProgress._daily;
        if (!dailyTasks[taskIdStr]) {
            var playerLevel = getPlayerLevel(savedData);
            var initialState = (playerLevel >= levelNeeded)
                ? TASK_STATE_DOING
                : TASK_STATE_DEFAULT;

            dailyTasks[taskIdStr] = {
                _id: arenaTaskId,
                _curCount: 0,
                _targetCount: targetCount,
                _state: initialState
            };
            log.info('ARENA_TASK', 'Created arena task ' + arenaTaskId +
                ' state=' + initialState + ' (level ' + playerLevel +
                ' vs needed ' + levelNeeded + ')');
        }

        return true;
    }

    /**
     * Advance arena daily task progress — FIXED v4.
     *
     * Storage: savedData._taskProgress._daily["6109"] = {
     *   _id: 6109,
     *   _curCount: number,
     *   _targetCount: number,
     *   _state: 0|1|2|3
     * }
     *
     * Format ini dibaca oleh:
     *   - Client L174024: t[a]._id, t[a]._curCount, t[a]._targetCount, t[a]._state
     *   - getReward.js L569: daily[taskId]._state, L576-577, L596
     *
     * State transitions:
     *   FINISH(3)  → skip (sudah di-claim, tidak bisa di-progress lagi hari ini)
     *   COMPLETE(2) → skip (sudah selesai, menunggu claim)
     *                NOTE: COMPLETE bisa datang dari getReward.js auto-init.
     *                Kita HORMATI state ini — jangan overwrite.
     *   DEFAULT(0) → cek level → DOING(1) jika level cukup
     *   DOING(1)   → increment curCount → COMPLETE(2) jika curCount >= targetCount
     *
     * @param {Object} savedData — user data from DB (MUTATED)
     * @returns {Object|null} task change info, or null if no state change
     */
    function advanceArenaDailyTask(savedData) {
        var taskType = 'arena';

        // Load daily task config
        var taskDailyCfg = loadTaskDailyCfg();
        if (!taskDailyCfg) {
            log.warn('ARENA_START', 'taskDaily.json not found, skipping task check');
            return null;
        }

        // Find task entry matching taskType='arena' (task 6109)
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
            log.details('ARENA_START', ['dailyTask', 'No taskDaily entry for ' + taskType]);
            return null;
        }

        var targetCount = Number(matchedTask.taskPara1) || 1;
        var taskIdStr = String(matchedTaskId);
        var levelNeeded = Number(matchedTask.levelNeeded) || 1;

        // ═══ Ensure task entry exists & daily reset (FIX BUG 8/11/12/13) ═══
        var taskReady = ensureArenaTaskEntry(savedData, matchedTaskId, targetCount, levelNeeded);
        if (taskReady === false) {
            log.details('ARENA_START', ['dailyTask', 'Task tracking not available (_taskProgress not initialized)']);
            return null;
        }

        var dailyTasks = savedData._taskProgress._daily;
        var taskEntry = dailyTasks[taskIdStr];
        var prevState = taskEntry._state;

        // ═══ FIX BUG 2: Selalu re-check levelNeeded ═══
        // main.min.js L174055: levelNeeded > getUserLevel() → force state=0
        // Di sisi server, kita UNLOCK task jika level sudah cukup.
        if (prevState === TASK_STATE_DEFAULT) {
            var playerLevel = getPlayerLevel(savedData);
            if (playerLevel >= levelNeeded) {
                taskEntry._state = TASK_STATE_DOING;
                taskEntry._curCount = 0; // reset count saat unlock
                prevState = TASK_STATE_DOING;
                log.info('ARENA_TASK', 'Task ' + matchedTaskId + ' DEFAULT → DOING (level ' +
                    playerLevel + ' >= needed ' + levelNeeded + ')');
            } else {
                log.details('ARENA_START', ['dailyTask', 'Task ' + matchedTaskId +
                    ' still DEFAULT (level ' + playerLevel + ' < needed ' + levelNeeded + ')']);
                return null;
            }
        }

        // ═══ Skip kalau sudah COMPLETE atau FINISH ═══
        // Hormati state dari getReward.js (auto COMPLETE) atau dari claim (FINISH)
        if (prevState === TASK_STATE_COMPLETE) {
            log.details('ARENA_START', ['dailyTask', 'Task ' + matchedTaskId +
                ' already COMPLETE (possibly from getReward auto-init), waiting for claim']);
            return null;
        }
        if (prevState === TASK_STATE_FINISH) {
            log.details('ARENA_START', ['dailyTask', 'Task ' + matchedTaskId +
                ' already FINISH (claimed today)']);
            return null;
        }

        // ═══ Increment progress (hanya dari DOING state) ═══
        taskEntry._curCount = (taskEntry._curCount || 0) + 1;
        var curCount = taskEntry._curCount;

        log.details('ARENA_START', [
            ['dailyTask', 'taskId=' + matchedTaskId + ' type=' + taskType +
                ' cur=' + curCount + '/' + targetCount + ' state=' + taskEntry._state]
        ]);

        // ═══ Transition DOING → COMPLETE ═══
        if (taskEntry._state === TASK_STATE_DOING && curCount >= targetCount) {
            taskEntry._state = TASK_STATE_COMPLETE;
            log.info('ARENA_TASK', 'Task ' + matchedTaskId + ' (' + taskType +
                ') DOING → COMPLETE (cur=' + curCount + ' >= target=' + targetCount + ')');

            return {
                taskType: taskType,
                taskId: matchedTaskId,
                oldState: TASK_STATE_DOING,
                newState: TASK_STATE_COMPLETE
            };
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD ERROR RESPONSE
    // ═══════════════════════════════════════════════════════════
    //
    //  FIX BUG 7: Return empty object, let buildEnvelope set ret code.

    function buildError(code, msg) {
        if (msg) {
            log.warn('ARENA_START', 'Error ' + code + ': ' + msg);
        }
        return {};
    }

    // ═══════════════════════════════════════════════════════════
    //  GRANT ARENA BATTLE REWARDS
    // ═══════════════════════════════════════════════════════════
    //
    //  FIX BUG 9 & 10: Grant rewards dari arenaEveryBattleAward.json
    //
    //  Config (arenaEveryBattleAward.json):
    //    "1": { everyBattleAward1: 112, num1: 20, everyBattleAward2: 102, num2: 5000 }
    //    → Setiap battle: +20 arena medal (112) + +5000 gold (102)
    //
    //  Client (main.min.js L63394-63412 getBattleAwardItems):
    //    - Baca e._changeInfo._items → Object keyed by STRING item ID
    //    - _num = ABSOLUTE NEW BALANCE (L63406: setItem(c, n[u]._num))
    //    - Update local cache + tampilkan di summary page
    //
    //  Pattern: sama dengan getReward.js L214-222 (grantReward function)
    //

    /**
     * Grant arena every-battle rewards.
     * Updates savedData.totalProps._items (persistent) AND builds response _changeInfo._items.
     *
     * @param {Object} savedData — user data (MUTATED)
     * @param {Object} changeItems — response accumulator { "itemId": { _id, _num: ABSOLUTE } }
     * @returns {boolean} true if rewards were granted
     */
    function grantArenaBattleRewards(savedData, changeItems) {
        var awardCfg = loadArenaEveryBattleAwardCfg();
        if (!awardCfg || !awardCfg['1']) {
            log.warn('ARENA_START', 'arenaEveryBattleAward.json not found or empty, no rewards');
            return false;
        }

        var award = awardCfg['1'];
        var granted = 0;

        // Slot 1: arena medal (112)
        var itemId1 = Number(award.everyBattleAward1);
        var amount1 = Number(award.num1);
        if (itemId1 > 0 && amount1 > 0) {
            grantReward(savedData, changeItems, itemId1, amount1);
            granted++;
        }

        // Slot 2: gold (102)
        var itemId2 = Number(award.everyBattleAward2);
        var amount2 = Number(award.num2);
        if (itemId2 > 0 && amount2 > 0) {
            grantReward(savedData, changeItems, itemId2, amount2);
            granted++;
        }

        log.info('ARENA_START', 'Arena battle rewards granted: ' + granted + ' items');
        return granted > 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  ██████╗  █████╗ ████████╗ █████╗     ███╗   ███╗
    //  ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗    ████╗ ████║  BUG 14 FIX
    //  ██║  ██║███████║   ██║   ███████║    ██╔████╔██║  Main Quest
    //  ██║  ██║██╔══██║   ██║   ██╔══██║    ██║╚██╔╝██║  Advance
    //  ██████╔╝██║  ██║   ██║   ██║  ██║    ██║ ╚═╝ ██║
    //
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  REFERENCES:
    //    dungeon/checkBattleResult.js L602-648 (processDungeonVictoryTask)
    //    equip/wearAuto.js L836-884 (getOnAllEquip check)
    //    friend/applyFriend.js L81-91 (friendApply check)
    //    main.min.js L77080: "mainTaskChange" → setMianTask(e._curMainTask)
    //    main.min.js L62521-62529: setMianTask / setMainTaskWithComplete
    //    task.json 6018: { taskType:"arena", taskPara1:1, levelNeeded:18 }
    //
    //  PATTERN (identik semua handler lain):
    //    1. Cek curMainTask[0]._state === 1 (DOING)
    //    2. Baca task.json untuk curMainTask[0]._id
    //    3. Match taskType === "arena"
    //    4. Track progress di savedData._arenaVictoryProgress
    //    5. Jika count >= taskPara1 → _state = 2 (COMPLETE)
    //    6. Push mainTaskChange notification via MainServer.notify()
    //    7. DEFAULT→DOING fix jika level sudah cukup (bug2 fix pattern)
    //
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Check & advance main quest for arena battle.
     * Identik pattern: dungeon/checkBattleResult.js L602-648
     *
     * Task 6018: taskType="arena", taskPara1=1 (need 1 arena battle)
     * Progress di-track di savedData._arenaVictoryProgress["arena"]
     * Counter reset otomatis saat quest ID berubah (chain advance).
     *
     * @param {Object} savedData — user data (MUTATED)
     */
    function checkMainQuestAdvance(savedData) {
        try {
            var cmt = savedData.curMainTask;
            if (!cmt || !Array.isArray(cmt) || cmt.length === 0) {
                log.details('QUEST', 'curMainTask not available');
                return;
            }

            var currentState = Number(cmt[0]._state);

            // ═══ BUG2 FIX: DEFAULT→DOING transition ═══
            // Identik pattern: dungeon/checkBattleResult.js L655-680 (bug2Fix)
            // Client L168013: state==DEFAULT || levelEnough==0 → show "level not enough"
            // Server harus unlock otomatis saat level cukup.
            if (currentState === TASK_STATE_DEFAULT) {
                var taskCfgForBug2 = loadTaskCfg();
                var defForBug2 = taskCfgForBug2 && taskCfgForBug2[String(cmt[0]._id)];
                var levelNeededBug2 = defForBug2 ? (Number(defForBug2.levelNeeded) || 1) : 1;
                var currentLevelBug2 = getPlayerLevel(savedData);

                if (currentLevelBug2 >= levelNeededBug2) {
                    cmt[0]._state = TASK_STATE_DOING;
                    log.info('QUEST', 'BUG2 fix: task ' + cmt[0]._id +
                        ' DEFAULT → DOING (level ' + currentLevelBug2 +
                        ' >= needed ' + levelNeededBug2 + ')');

                    // Notify client about state change
                    if (typeof MainServer.notify === 'function') {
                        MainServer.notify({
                            action: 'mainTaskChange',
                            _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_DOING }]
                        });
                        log.info('QUEST', 'Pushed mainTaskChange state=1 (DEFAULT→DOING)');
                    }
                    currentState = TASK_STATE_DOING; // update local variable
                } else {
                    log.details('QUEST', 'Task ' + cmt[0]._id +
                        ' still DEFAULT (level ' + currentLevelBug2 +
                        ' < needed ' + levelNeededBug2 + ')');
                    return;
                }
            }

            // ═══ Hanya proses DOING state ═══
            if (currentState !== TASK_STATE_DOING) {
                log.details('QUEST', 'Task ' + cmt[0]._id +
                    ' state=' + currentState + ' (not DOING), skip');
                return;
            }

            // ═══ Load task config untuk current main quest ═══
            var taskCfg = loadTaskCfg();
            var taskDef = taskCfg && taskCfg[String(cmt[0]._id)];

            if (!taskDef) {
                log.warn('QUEST', 'Task config not found for id=' + cmt[0]._id);
                return;
            }

            // ═══ Match taskType === "arena" ═══
            if (taskDef.taskType !== 'arena') {
                log.details('QUEST', 'Current task ' + cmt[0]._id +
                    ' taskType=' + taskDef.taskType + ' (not arena), skip');
                return;
            }

            // ═══ Track arena victory progress ═══
            // Pattern: dungeon/checkBattleResult.js L623-627
            // savedData._arenaVictoryProgress["arena"] = win count
            // Counter reset otomatis saat quest ID berubah.
            if (!savedData._arenaVictoryProgress) {
                savedData._arenaVictoryProgress = {};
            }

            var progressKey = 'arena';
            savedData._arenaVictoryProgress[progressKey] =
                (savedData._arenaVictoryProgress[progressKey] || 0) + 1;

            var winCount = savedData._arenaVictoryProgress[progressKey];
            var needed = Number(taskDef.taskPara1) || 1;

            log.details('QUEST', [
                ['mainTask', 'id=' + cmt[0]._id + ' type=arena' +
                    ' wins=' + winCount + '/' + needed]
            ]);

            // ═══ Cek jika quest COMPLETE ═══
            if (winCount >= needed) {
                cmt[0]._state = TASK_STATE_COMPLETE;

                log.info('QUEST', 'Main task ' + cmt[0]._id +
                    ' (arena) DOING → COMPLETE (wins=' + winCount +
                    ' >= needed=' + needed + ')');

                // ═══ Push mainTaskChange ke client ═══
                // main.min.js L77080:
                //   "mainTaskChange" == n && UserInfoSingleton.getInstance().setMianTask(e._curMainTask)
                // Format: { action:'mainTaskChange', _curMainTask:[{_id, _state}] }
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_COMPLETE }]
                    });
                    log.info('QUEST', 'Pushed mainTaskChange state=2 (COMPLETE)');
                } else {
                    log.warn('QUEST', 'MainServer.notify not available, cannot push mainTaskChange');
                }
            }
        } catch (questErr) {
            log.warn('QUEST', 'Main quest check error: ' + (questErr.message || questErr));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER — handleArenaStartBattle
    // ═══════════════════════════════════════════════════════════

    function handleArenaStartBattle(request, callback) {
        var userId = request.userId;
        var selUser = request.selUser;
        var enemyRank = Number(request.enemyRank) || 0;

        // ═══ Ensure arena state ═══
        var arenaState = (MainServer._arenaStates && MainServer._arenaStates[userId]) || null;
        if (!arenaState) {
            if (!MainServer._arenaStates) MainServer._arenaStates = {};
            MainServer._arenaStates[userId] = {
                _rank: 2001, _topRank: 2001, _dailyRank: 2001,
                _dailyRewardTag: '', _rewardTags: [],
                _attackTimes: 5, _buyTimesCount: 0, _lastDailyReset: Date.now(),
                _defenseTeam: null, _defenseSuper: null,
                _defenseTeamFull: null, _defenseSuperFull: null
            };
            arenaState = MainServer._arenaStates[userId];
        }
        var selfRank = arenaState._rank || 2001;

        log.info('HANDLER', 'arena/startBattle processing (FIXED v4)');
        log.details('request', [
            ['userId', userId || '-'],
            ['selUser', selUser || '-'],
            ['selfRank (server)', String(selfRank)],
            ['enemyRank (client)', String(enemyRank)],
            ['teamCount', request.team ? String(request.team.length) : '0'],
            ['superCount', request.super ? String(request.super.length) : '0']
        ]);

        try {

            // ═══ VALIDASI 1: userId wajib ═══
            if (!userId) {
                log.error('HANDLER', 'Missing userId');
                callback(buildError(RET_CODES.MISSING_USERID, 'userId tidak boleh kosong'), RET_CODES.MISSING_USERID);
                return;
            }

            // ═══ VALIDASI 2: selUser wajib ═══
            if (!selUser) {
                log.error('HANDLER', 'Missing selUser');
                callback(buildError(RET_CODES.MISSING_SELUSER, 'selUser tidak boleh kosong'), RET_CODES.MISSING_SELUSER);
                return;
            }

            // ═══ FIX BUG 4: VALIDASI 3 — cek _attackTimes server-side ═══
            var attackTimes = arenaState._attackTimes || 0;
            if (attackTimes <= 0) {
                log.warn('HANDLER', 'No attack times left for userId=' + userId);
                callback(buildError(RET_CODES.NO_ATTACK_TIMES, 'Sisa serangan habis'), RET_CODES.NO_ATTACK_TIMES);
                return;
            }

            // ═══ LOOKUP ENEMY dari robotPlayer.json ═══
            var robotPlayerCfg = loadRobotPlayerCfg();
            var robot = robotPlayerCfg[String(selUser)];
            if (!robot) {
                log.error('HANDLER', 'Enemy not found in robotPlayer.json: ' + selUser);
                callback(buildError(RET_CODES.ENEMY_NOT_FOUND, 'Musuh tidak ditemukan: ' + selUser), RET_CODES.ENEMY_NOT_FOUND);
                return;
            }

            // ═══ PARSE ROBOT DATA ═══
            var heroIds      = String(robot.enemyList).split(',');
            var heroLevels   = String(robot.enemyLevel).split(',');
            var diffHpArr    = String(robot.difficultyHp).split(',');
            var diffAtkArr   = String(robot.difficultyAttack).split(',');

            // ═══ BUILD _rightTeam ═══
            var rightTeam = {};
            var heroCount = 0;

            for (var i = 0; i < heroIds.length; i++) {
                var hId = Number(heroIds[i]) || 0;
                var hLvl = Number(heroLevels[i]) || 1;
                var dHp = Number(diffHpArr[i]) || 1;
                var dAtk = Number(diffAtkArr[i]) || 1;

                var entry = buildBattleHeroEntry(hId, hLvl, dHp, dAtk);
                if (entry) {
                    rightTeam[String(i)] = entry;
                    heroCount++;
                }
            }

            log.info('HANDLER', 'Built rightTeam — ' + heroCount + ' heroes for robot ' + selUser +
                ' (userLevel=' + robot.userLevel + ')');

            // ═══ BATTLE SIMULATION — Server-side (Bug 2 Fix) ═══
            // Ganti powerRatio + Math.random() dengan simulasi battle.
            // Server menjalankan battle simulation menggunakan _rand + team stats,
            // menentukan pemenang: "siapa yang semua hero mati duluan".
            // Pola: samakan dengan dungeon (tidak terlalu kompleks).
            // Bot polos: star 0, no equip, no passive, no awakening, skill level 1.

            // Read savedData (needed for player hero data + rewards + tasks)
            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);

            // Generate _rand array FIRST (used by BOTH simulation AND client)
            var randArray = generateRandArray(100);

            // --- Build ENEMY battle data from _rightTeam ---
            var enemyBattleHeroes = [];
            for (var ep = 0; ep < 5; ep++) {
                var eEntry = rightTeam[String(ep)];
                if (!eEntry) continue;
                var ebData = buildEnemyHeroBattleData(eEntry, ep);
                if (ebData) {
                    enemyBattleHeroes.push(ebData);
                    log.details('SIM', ['enemyHero', 'pos=' + ep +
                        ' hp=' + ebData.hp.toFixed(0) +
                        ' atk=' + ebData.atk.toFixed(0) +
                        ' spd=' + ebData.speed.toFixed(0) +
                        ' nDmg=' + ebData.normalDmgMult.toFixed(2) +
                        ' sDmg=' + ebData.skillDmgMult.toFixed(2)]);
                }
            }

            // --- Build PLAYER battle data from savedData ---
            var playerBattleHeroes = [];
            var playerHeros = (savedData && savedData.heros && savedData.heros._heros)
                            || (savedData && savedData._heros) || null;

            if (request.team && Array.isArray(request.team) && playerHeros) {
                for (var pi = 0; pi < request.team.length; pi++) {
                    var pSlot = request.team[pi];
                    if (!pSlot || !pSlot.heroId) continue;

                    var pInstId = String(pSlot.heroId);
                    var pFound = null;
                    for (var phk in playerHeros) {
                        if (!playerHeros.hasOwnProperty(phk)) continue;
                        var pH = playerHeros[phk];
                        if (!pH) continue;
                        if (phk === pInstId) {
                            pFound = pH;
                            break;
                        }
                    }

                    if (pFound) {
                        var pbData = buildPlayerHeroBattleData(pFound, pi);
                        if (pbData) {
                            playerBattleHeroes.push(pbData);
                            log.details('SIM', ['playerHero', 'pos=' + pi +
                                ' hp=' + pbData.hp.toFixed(0) +
                                ' atk=' + pbData.atk.toFixed(0) +
                                ' spd=' + pbData.speed.toFixed(0) +
                                ' nDmg=' + pbData.normalDmgMult.toFixed(2) +
                                ' sDmg=' + pbData.skillDmgMult.toFixed(2)]);
                        }
                    } else {
                        log.warn('SIM', 'Hero instance ' + pInstId + ' not found in player inventory');
                    }
                }
            } else if (request.team && Array.isArray(request.team)) {
                log.warn('SIM', 'playerHeros not found in savedData, cannot build player battle data');
            }

            // --- BYPASS: Selalu MENANG (server) ---
            // ROOT CAUSE: simulateBattle terlalu sederhana vs client Egret battle engine
            //   → hasil sering beda (visual menang tapi server bilang kalah).
            //   Client L63594: var c = t._battleResult → pakai nilai server SEBELUM battle animation.
            // FIX: Hardcode WIN. Rank naik/tetap ditangani logic di bawah.
            var battleResult = 0;

            log.info('SIM', 'BYPASS — always WIN (server)');

            // ═══ COMPUTE NEW RANK + UPDATE SERVER STATE ═══
            var newRank;
            // FIX BUG 3: Max rank gain = 8 positions (matches select.js offsets -1,-2,-3,-5,-8)
            var MAX_RANK_GAIN = 8;
            var isRankGainReasonable = (selfRank - enemyRank) <= MAX_RANK_GAIN;
            if (battleResult === 0 && selfRank > enemyRank && enemyRank > 0 && isRankGainReasonable) {
                newRank = enemyRank;
                log.info('HANDLER', 'RANK UP: ' + selfRank + ' → ' + newRank);
            } else {
                newRank = selfRank;
                log.info('HANDLER', 'Rank unchanged: ' + newRank);
            }

            // Update server-side arena state
            arenaState._rank = newRank;
            if (newRank < (arenaState._topRank || 99999)) {
                arenaState._topRank = newRank;
            }
            // Decrement attack times (server-side, FIX BUG 4)
            arenaState._attackTimes = attackTimes - 1;

            log.info('HANDLER', 'State updated — rank=' + newRank +
                ' topRank=' + arenaState._topRank +
                ' attacksLeft=' + arenaState._attackTimes);

            // ═══ FIX BUG 5: SINGLE DB WRITE — modify savedData once, save once ═══
            // FIX BUG 9 & 10: Grant rewards + build _changeInfo
            var changeItems = {};

            if (savedData) {
                // Persist rank
                savedData._arenaRank = newRank;
                savedData._arenaTopRank = arenaState._topRank || newRank;

                // ═══ FIX BUG 9 & 10: Grant arena battle rewards ═══
                // arenaEveryBattleAward.json: item 112 (+20) + item 102 (+5000)
                // Client L63397: e._changeInfo && (n = e._changeInfo._items)
                // Client L63406: ItemsCommonSingleton.getInstance().setItem(c, n[u]._num)
                // → _num MUST be ABSOLUTE new balance
                try {
                    grantArenaBattleRewards(savedData, changeItems);
                } catch (rewardErr) {
                    log.warn('HANDLER', 'Reward grant error: ' + (rewardErr.message || rewardErr));
                }

                // ═══ Advance daily task (FIX BUG 1/2/3/8) ═══
                try {
                    var taskResult = advanceArenaDailyTask(savedData);
                    if (taskResult) {
                        log.info('HANDLER', 'Daily task updated — taskId=' + taskResult.taskId +
                            ' ' + taskResult.oldState + ' → ' + taskResult.newState);
                    } else {
                        log.details('HANDLER', ['dailyTask', 'Progress updated, no state change']);
                    }
                } catch (taskErr) {
                    log.warn('HANDLER', 'Daily task error: ' + (taskErr.message || taskErr));
                }

                // ═══ FIX BUG 14: Check & advance main quest (arena) ═══
                // Pattern identik: dungeon/checkBattleResult.js, wearAuto.js, dll
                // Task 6018: taskType="arena", taskPara1=1 → need 1 arena battle
                // Jika COMPLETE → push mainTaskChange ke client (L77080)
                try {
                    checkMainQuestAdvance(savedData);
                } catch (questErr) {
                    log.warn('HANDLER', 'Main quest check error: ' + (questErr.message || questErr));
                }

                // FIX BUG 5: ONE db._set instead of TWO
                db._set(storageKey, savedData);
                log.info('HANDLER', 'Saved rank + rewards + task progress + quest progress in single DB write');
            } else {
                log.warn('HANDLER', 'savedData not found, skip rank persist, rewards, and task tracking');
            }

            // ═══ GENERATE RESPONSE ═══
            var response = {
                _battleId: generateUUID(),
                _battleResult: battleResult,
                _rand: randArray,  // SAME array used by simulation — client uses this
                _rightTeam: rightTeam,
                _rightSuper: [],
                _arena: {
                    _rank: newRank
                }
            };

            // ═══ FIX BUG 9: Attach _changeInfo jika ada rewards ═══
            // Client L63397: e._changeInfo && (n = e._changeInfo._items)
            // Jika _changeInfo tidak ada → getBattleAwardItems returns {} → aman
            if (Object.keys(changeItems).length > 0) {
                response._changeInfo = { _items: changeItems };
                log.details('HANDLER', ['response', '_changeInfo._items keys: ' +
                    Object.keys(changeItems).join(', ')]);
            }

            log.info('HANDLER', 'arena/startBattle response ready — ' +
                'result=' + (battleResult === 0 ? 'WIN' : 'LOSE') +
                ' newRank=' + newRank +
                ' enemies=' + heroCount +
                ' attacksLeft=' + arenaState._attackTimes +
                ' rewards=' + Object.keys(changeItems).length + ' items');

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'arena/startBattle UNCAUGHT ERROR', err);
            callback(buildError(RET_CODES.SERVER_ERROR, err.message || 'Unknown error'), RET_CODES.SERVER_ERROR);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('arena', 'startBattle', handleArenaStartBattle);

    window.MainServer = MainServer;
})();