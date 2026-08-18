/**
 * handlers/summon/summonOne.js — Paid Single Summon Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: summon/summonOne
 * ============================================================
 *
 * Client call — 4 call sites:
 *
 * ── CALL SITE 1: highSummonOnceBtnClick (Super Summon) L95515-95525
 *   Trigger: Player tap "Summon" pada Super/High banner (NOT free)
 *   Condition: HIGHSUMMONPAPER (item 123) >= cost1
 *   Fallback: If no paper → check DIAMONDID (item 101) >= cost1
 *   Request:
 *     { type:'summon', action:'summonOne',
 *       userId, sType: SummonType.SUPER (=3), version:'1.0' }
 *     OR sType: SummonType.SUPER_DIAMOND (=4) when using diamonds
 *
 * ── CALL SITE 2: friendSummonOnceBtnClick (Friend Summon)
 *   Trigger: Player tap "Summon" pada Friend banner
 *   Request:
 *     { type:'summon', action:'summonOne',
 *       userId, sType: SummonType.FRIEND (=2), version:'1.0' }
 *
 * ── CALL SITE 3: commonSummonOnceBtnClick (Normal Summon) L95597
 *   Trigger: Player tap "Summon" pada Normal/Common banner (NOT free)
 *   Request:
 *     { type:'summon', action:'summonOne',
 *       userId, sType: SummonType.COMMON (=1), version:'1.0' }
 *
 * ============================================================
 * RESPONSE FORMAT (L95432-95469 requestCallBackCheck):
 * ============================================================
 *
 * CRITICAL FIELDS:
 *   _addTotal      — Array<HeroData>: hero results dari summon (1 hero)
 *                    Client: s = e._addTotal || e._addHeroes
 *   _changeInfo    — { _items: { "itemId": { _id, _num }, ... } }
 *                    ItemsCommonSingleton.resetTtemsCallBack (L118412-118419)
 *                    _num = ABSOLUTE balance (SET, not delta)
 *   _energy        — number: updated summon energy value
 *   _canFreeTime   — number: timestamp ms kapan free summon available lagi
 *                    sType=SUPER → canSuperFreeTime = _canFreeTime
 *                    sType=COMMON → canCommonFreeTime = _canFreeTime
 *                    sType=FRIEND/SUPER_DIAMOND → client juga baca ini
 *   actId          — string: empty string
 *
 * ============================================================
 * SUMMON CONFIG (summon.json):
 * ============================================================
 *   ID=1 (summonSuper, sType=3):         costID=123, cost1=1, energy=+10
 *   ID=2 (summonSuperDiamond, sType=4):  costID=101, cost1=250, energy=+10
 *   ID=3 (summonNormal, sType=1):        costID=122, cost1=1, energy=+0
 *   ID=4 (summonFriend, sType=2):         costID=121, cost1=10, energy=+0
 *
 * ============================================================
 * RANDOM POOL ALGORITHM (2-step):
 * ============================================================
 * Step 1: Roll quality tier dari summonRandom.json (individual rates, hero-only)
 *   Piece tiers (orangePiece, flickerOrangePiece, superOrangePiece) di-skip.
 *   Rate di-normalize agar total hero-only = 1.0.
 *
 * Step 2: Pick random hero dari summonPool.json
 *   type="hero", quality=rolled tier, weight > 0 for pool column
 *   Weighted random by hero weight value
 *
 * ============================================================
 * ENERGY MECHANICS:
 * ============================================================
 * summon.json summonEnergy field:
 *   sType=3 (SUPER):         +10 energy
 *   sType=4 (SUPER_DIAMOND): +10 energy
 *   sType=1 (COMMON):        +0 energy
 *   sType=2 (FRIEND):        +0 energy
 * Energy stored: savedData.summon._energy
 * Max threshold: 800 (from summonEnergy.json)
 *
 * ============================================================
 * FREE SUMMON COOLDOWN (TIDAK direset oleh paid summon):
 * ============================================================
 * Paid summon does NOT touch _canCommonFreeTime or _canSuperFreeTime.
 * Those are managed separately by summonOneFree handler.
 * Response _canFreeTime = current saved value (unchanged).
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.summon) {
        MainServer.handlers.summon = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    /** SummonType enum (L95175-95186) */
    var SUMMON_TYPE = {
        INVALID: 0,
        COMMON: 1,
        FRIEND: 2,
        SUPER: 3,
        SUPER_DIAMOND: 4,
        ENERGY: 5,
        NormalLuckPool: 6,
        SuperLuckPool: 7
    };

    /**
     * summon.json config ID per sType.
     * summon.json keys: "1"=summonSuper, "2"=summonSuperDiamond,
     *                   "3"=summonNormal, "4"=summonFriend
     */
    var SUMMON_CONFIG_ID = {
        1: '3',    // COMMON    → summon.json["3"] (summonNormal)
        2: '4',    // FRIEND    → summon.json["4"] (summonFriend)
        3: '1',    // SUPER     → summon.json["1"] (summonSuper)
        4: '2'     // SUPER_DIAMOND → summon.json["2"] (summonSuperDiamond)
    };

    /**
     * Energy gain per summon — dari summon.json summonEnergy field.
     */
    var SUMMON_ENERGY_GAIN = {
        1: 0,     // COMMON:    summonNormal summonEnergy = 0
        2: 0,     // FRIEND:    summonFriend summonEnergy = 0
        3: 10,    // SUPER:     summonSuper summonEnergy = 10
        4: 10     // SUPER_DIAMOND: summonSuperDiamond summonEnergy = 10
    };

    /** summonRandom.json quality type → column name per sType */
    var QUALITY_RATE_COL = {
        1: 'randomNormal',   // COMMON
        2: 'randomFriend',   // FRIEND
        3: 'randomHigh',     // SUPER
        4: 'randomHigh'      // SUPER_DIAMOND (uses same pool as SUPER)
    };

    /** summonPool.json hero weight → column name per sType */
    var POOL_WEIGHT_COL = {
        1: 'randomNormal',   // COMMON
        2: 'randomFriend',   // FRIEND
        3: 'randomHigh',     // SUPER
        4: 'randomHigh'      // SUPER_DIAMOND (uses same pool as SUPER)
    };

    // ═══════════════════════════════════════════════════════════
    //  TASK PROGRESS CONSTANTS (General Solution)
    // ═══════════════════════════════════════════════════════════
    //
    //  TASK_STATE enum (main.min.js L62602-62605):
    //    DEFAULT=0, DOING=1, COMPLETE=2, FINISH=3
    //
    //  MainTask class (main.min.js L62595-62601):
    //    Fields: _id, _state, _levelEnough
    //    NOTE: TIDAK ada field _curCount/_progress.
    //    Jadi untuk task dengan taskPara1=1, 1x trigger langsung COMPLETE.
    //
    //  Task summon-related di task.json:
    //    6011: taskType=summonFriend, taskPara1=1, taskTime=now
    //    6013: taskType=summon,       taskPara1=1, taskTime=now
    //
    //  Map sType ke taskType yang relevant:
    //    sType=FRIEND (2)         → 'summon', 'summonFriend'
    //    sType=SUPER (3)          → 'summon', 'summonSuper'
    //    sType=SUPER_DIAMOND (4)  → 'summon', 'summonSuper'
    //    sType=COMMON (1)         → 'summon', 'summonNormal'
    //
    //  Client contract (main.min.js L77080):
    //    Notify "mainTaskChange" → setMianTask(e._curMainTask)
    //    _curMainTask: array [{_id, _state}]
    // ===============================================================

    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };

    var SUMMON_TASK_TYPE_MAP = {
        1: ['summon', 'summonNormal'],           // COMMON
        2: ['summon', 'summonFriend'],           // FRIEND
        3: ['summon', 'summonSuper'],            // SUPER
        4: ['summon', 'summonSuper']             // SUPER_DIAMOND
    };

    /**
     * Load task config (sync, cached).
     */
    function getTaskConfig(taskId) {
        var t = loadJsonSync('task');
        return t ? t[String(taskId)] : null;
    }

    /**
     * checkAndCompleteTask(savedData, sType)
     *
     * General solution untuk task progress setelah summon sukses.
     *
     * Logic:
     *   1. Cek curMainTask user (array [{_id, _state}])
     *   2. Jika task sudah COMPLETE/FINISH → skip
     *   3. Load task config untuk task._id
     *   4. Cek apakah taskType relevant dengan sType (via SUMMON_TASK_TYPE_MAP)
     *   5. Jika match → set _state=COMPLETE
     *   6. Return true jika ada perubahan (untuk trigger Notify)
     *
     * Untuk task dengan taskPara1=1 (semua task summon saat ini):
     *   1x trigger langsung COMPLETE.
     *
     * Untuk task dengan taskPara1>1 (jika ada di masa depan):
     *   MainTask tidak punya field count, jadi untuk MVP langsung COMPLETE.
     *   Bisa di-extend dengan track count di field terpisah.
     *
     * @param {object} savedData — user data (will be mutated if task completed)
     * @param {number} sType — summon type yang baru dilakukan
     * @returns {boolean} true jika task state berubah (Notify harus dikirim)
     */
    function checkAndCompleteTask(savedData, sType) {
        // Validate curMainTask structure
        if (!savedData.curMainTask || !Array.isArray(savedData.curMainTask) || savedData.curMainTask.length === 0) {
            return false;
        }

        var currentTask = savedData.curMainTask[0];
        if (!currentTask || typeof currentTask._id === 'undefined') {
            return false;
        }

        // Skip jika task sudah COMPLETE atau FINISH
        if (currentTask._state === TASK_STATE.COMPLETE || currentTask._state === TASK_STATE.FINISH) {
            return false;
        }

        // Load task config
        var taskData = getTaskConfig(currentTask._id);
        if (!taskData) {
            log.warn('TASK', 'checkAndCompleteTask — task config not found for id=' + currentTask._id);
            return false;
        }

        // Cek apakah taskType relevant dengan sType
        var relevantTaskTypes = SUMMON_TASK_TYPE_MAP[sType] || [];
        if (relevantTaskTypes.indexOf(taskData.taskType) === -1) {
            // Task saat ini bukan summon-related dengan sType ini, skip
            return false;
        }

        // Task match! Update state ke COMPLETE
        currentTask._state = TASK_STATE.COMPLETE;
        savedData.curMainTask = [currentTask];

        log.info('TASK', 'Task ' + currentTask._id + ' (' + taskData.taskType + ') → COMPLETE (triggered by summon sType=' + sType + ')');

        return true;
    }

    /** Storage key format — sama dengan enterGame.js */
    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJsonSync(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
            log.error('RESOURCE', 'summonOne failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'summonOne failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJsonSync('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getHeroLevelAttr(level) {
        var la = loadJsonSync('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    function getHeroQualityParam(quality) {
        var qp = loadJsonSync('heroQualityParam');
        return qp ? qp[quality] : null;
    }

    function getHeroTypeParam(heroType) {
        var tp = loadJsonSync('heroTypeParam');
        return tp ? tp[heroType] : null;
    }

    function getHeroEvolve(heroId) {
        var ev = loadJsonSync('heroEvolve');
        return ev ? ev[String(heroId)] : null;
    }

    function getHeroWakeUp(heroId) {
        var wu = loadJsonSync('heroWakeUp');
        return wu ? wu[String(heroId)] : null;
    }

    function getSummonConfig() {
        return loadJsonSync('summon');
    }

    function getSummonRandom() {
        return loadJsonSync('summonRandom');
    }

    function getSummonPool() {
        return loadJsonSync('summonPool');
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * getItemBalance(savedData, itemId)
     * Get current item balance from totalProps._items.
     * totalProps._items = ARRAY format [{_id, _num}, ...]
     * Client reads as ABSOLUTE (SET, not +=)
     *
     * @returns {number} current balance, 0 if not found
     */
    function getItemBalance(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    /**
     * setItemBalance(savedData, itemId, newBalance)
     * Set item balance to absolute value in totalProps._items.
     * If item exists → update _num. If not → add new entry.
     *
     * @returns {number} the new balance
     */
    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];

        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                items[i]._num = newBalance;
                return newBalance;
            }
        }
        // Item not found — add new entry
        items.push({ _id: itemId, _num: newBalance });
        return newBalance;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO BASE ATTR COMPUTATION
    // ═══════════════════════════════════════════════════════════

    /**
     * makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel)
     *
     * Compute base stats untuk hero. Formula sama dengan getAttrs.js:
     *
     *   raw_hp   = (levelAttr.hp   * typeParam.hpParam   + typeParam.hpBais)   * qualityParam * balanceHp
     *   raw_atk  = (levelAttr.atk  * typeParam.attackParam + typeParam.attackBais) * qualityParam * balanceAtk
     *   raw_arm  = (levelAttr.arm  * typeParam.armorParam  + typeParam.armBais)  * qualityParam * balanceArm
     *
     * Flat stats dari hero config (speed, hit, dodge, dll).
     * Talent, evolve, wakeUp bonuses added if applicable.
     *
     * @returns {object} base attribute object
     */
    function makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel) {
        level = level || 1;
        evolveLevel = evolveLevel || 0;
        starLevel = starLevel || 0;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('SUMMON', 'Hero config not found: ' + heroDisplayId);
            return null;
        }

        var quality = hc.quality || 'purple';
        var heroType = hc.heroType || 'critical';
        var la = getHeroLevelAttr(level) || {};
        var qp = getHeroQualityParam(quality) || {};
        var tp = getHeroTypeParam(heroType) || {};
        var evEntries = getHeroEvolve(heroDisplayId) || [];
        var wuEntries = getHeroWakeUp(heroDisplayId) || [];

        var talent = Number(hc.talent) || 0;

        var d = {
            _hp: 0, _attack: 0, _armor: 0, _speed: 0,
            _hit: 0, _dodge: 0, _block: 0, _damageReduce: 0, _armorBreak: 0,
            _controlResist: 0, _skillDamage: 0, _criticalDamage: 0, _blockEffect: 0,
            _critical: 0, _criticalResist: 0, _trueDamage: 0, _energy: 50,
            _power: 0, _extraArmor: 0, _hpPercent: 0, _armorPercent: 0,
            _attackPercent: 0, _speedPercent: 0, _orghp: 0, _superDamage: 0,
            _healPlus: 0, _healerPlus: 0, _damageDown: 0, _shielderPlus: 0,
            _damageUp: 0,
            _talent: talent,
            _level: level,
            _exp: 0,
            _evolveLevel: evolveLevel
        };

        // ── Evolve bonuses ──
        var evList = Array.isArray(evEntries) ? evEntries : [];
        for (var ei = 0; ei < evList.length; ei++) {
            var ev = evList[ei];
            if (evolveLevel >= (ev.level || 0)) {
                d._hp += Number(ev.hp) || 0;
                d._attack += Number(ev.attack) || 0;
                d._armor += Number(ev.armor) || 0;
                d._speed += Number(ev.speed) || 0;
            }
        }

        // ── WakeUp/Star bonuses ──
        var wuList = Array.isArray(wuEntries) ? wuEntries : [];
        for (var wi = 0; wi < wuList.length; wi++) {
            var wu = wuList[wi];
            if (starLevel >= (wu.star || 0)) {
                talent += Number(wu.talent) || 0;
                d._hp += Number(wu.hp) || 0;
                d._attack += Number(wu.attack) || 0;
                d._armor += Number(wu.armor) || 0;
                d._speed += Number(wu.speed) || 0;
            }
        }
        d._talent = talent;

        // ── Base stats: level × type × quality × balance ──
        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        d._hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        d._attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        d._armor += baseArm;

        // ── Flat stats dari hero config ──
        d._speed += Number(hc.speed) || 0;
        d._hit += Number(hc.hit) || 0;
        d._dodge += Number(hc.dodge) || 0;
        d._block += Number(hc.block) || 0;
        d._damageReduce += Number(hc.damageReduce) || 0;
        d._armorBreak += Number(hc.armorBreak) || 0;
        d._controlResist += Number(hc.controlResist) || 0;
        d._skillDamage += Number(hc.skillDamage) || 0;
        d._criticalDamage += Number(hc.criticalDamage) || 0;
        d._blockEffect += Number(hc.blockEffect) || 0;
        d._critical += Number(hc.critical) || 0;
        d._criticalResist += Number(hc.criticalResist) || 0;
        d._trueDamage += Number(hc.trueDamage) || 0;
        d._healPlus += Number(hc.healPlus) || 0;
        d._healerPlus += Number(hc.healerPlus) || 0;
        d._energy = 50;

        log.details('SUMMON', [
            ['makeHeroBasicAttr', 'heroId=' + heroDisplayId + ' lv=' + level],
            ['raw_hp', d._hp.toFixed(1)],
            ['raw_atk', d._attack.toFixed(1)],
            ['raw_arm', d._armor.toFixed(1)],
            ['talent', String(talent)],
            ['speed', String(d._speed)]
        ]);

        return d;
    }

    // ═══════════════════════════════════════════════════════════
    //  RANDOM POOL — 2-step quality roll + hero pick
    // ═══════════════════════════════════════════════════════════

    /**
     * getRandomHeroFromPool(sType)
     *
     * 2-step random selection:
     *   1. Roll quality tier dari summonRandom.json (individual rates, hero-only)
     *   2. Pick random hero dari summonPool.json (weighted by pool weight)
     *
     * Piece tiers (orangePiece, flickerOrangePiece, superOrangePiece) di-skip.
     * Rate di-normalize agar total hero-only = 1.0.
     *
     * @param {number} sType — SummonType (COMMON=1, FRIEND=2, SUPER=3, SUPER_DIAMOND=4)
     * @returns {number|null} heroDisplayId
     */
    function getRandomHeroFromPool(sType) {
        var summonRandom = getSummonRandom();
        var summonPool = getSummonPool();

        if (!summonRandom || !summonPool) {
            log.error('SUMMON', 'Cannot load summonRandom/summonPool config');
            return null;
        }

        var rateCol = QUALITY_RATE_COL[sType] || 'randomHigh';
        var weightCol = POOL_WEIGHT_COL[sType] || 'randomHigh';

        // ── Step 1: Build hero-only quality rate table ──
        var heroRates = [];
        for (var i = 1; i <= 10; i++) {
            var entry = summonRandom[String(i)];
            if (!entry) continue;
            // Skip piece types — kita hanya beri hero, bukan fragment
            if (entry.type.indexOf('Piece') !== -1) continue;
            var rate = Number(entry[rateCol]) || 0;
            if (rate <= 0) continue;
            heroRates.push({ quality: entry.type, rate: rate });
        }

        if (heroRates.length === 0) {
            log.error('SUMMON', 'No hero quality rates available for sType=' + sType);
            return null;
        }

        // Normalize rates
        var totalRate = 0;
        for (var r = 0; r < heroRates.length; r++) totalRate += heroRates[r].rate;
        if (totalRate <= 0) {
            log.error('SUMMON', 'Total hero quality rate is 0 for sType=' + sType);
            return null;
        }

        // Roll quality
        var roll = Math.random() * totalRate;
        var accumulated = 0;
        var selectedQuality = null;
        for (var q = 0; q < heroRates.length; q++) {
            accumulated += heroRates[q].rate;
            if (roll < accumulated) {
                selectedQuality = heroRates[q].quality;
                break;
            }
        }

        if (!selectedQuality) {
            selectedQuality = heroRates[heroRates.length - 1].quality;
            log.warn('SUMMON', 'Quality roll fallback to: ' + selectedQuality);
        }

        log.details('SUMMON', [
            ['qualityRoll', 'sType=' + sType + ' pool=' + rateCol],
            ['selectedQuality', selectedQuality],
            ['rawRoll', roll.toFixed(4)],
            ['totalRate', totalRate.toFixed(4)]
        ]);

        // ── Step 2: Pick random hero dari pool matching quality ──
        var poolEntries = [];
        var totalWeight = 0;

        for (var key in summonPool) {
            if (!summonPool.hasOwnProperty(key)) continue;
            var pEntry = summonPool[key];

            // Hanya type="hero", skip "heroPiece"
            if (pEntry.type !== 'hero') continue;

            // Quality harus match
            if (pEntry.quality !== selectedQuality) continue;

            // Weight harus > 0 untuk pool ini
            var weight = Number(pEntry[weightCol]) || 0;
            if (weight <= 0) continue;

            poolEntries.push({ thingsId: Number(pEntry.thingsId), weight: weight });
            totalWeight += weight;
        }

        if (poolEntries.length === 0 || totalWeight === 0) {
            log.error('SUMMON', [
                ['poolPick', 'FAILED'],
                ['quality', selectedQuality],
                ['sType', String(sType)],
                ['reason', 'no heroes with weight > 0 in this quality tier']
            ]);
            return null;
        }

        // Weighted random pick
        var heroRoll = Math.random() * totalWeight;
        var heroAccum = 0;
        var pickedId = null;
        for (var h = 0; h < poolEntries.length; h++) {
            heroAccum += poolEntries[h].weight;
            if (heroRoll < heroAccum) {
                pickedId = poolEntries[h].thingsId;
                break;
            }
        }

        // Fallback: last entry
        if (!pickedId) {
            pickedId = poolEntries[poolEntries.length - 1].thingsId;
        }

        log.details('SUMMON', [
            ['poolPick', 'sType=' + sType + ' quality=' + selectedQuality],
            ['poolSize', String(poolEntries.length)],
            ['totalWeight', String(totalWeight)],
            ['pickedHeroId', String(pickedId)]
        ]);

        return pickedId;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD HERO DATA OBJECT
    // ═══════════════════════════════════════════════════════════

    /**
     * buildSummonHeroData(heroDisplayId, heroInstanceId)
     * Build complete hero data object untuk _addTotal response.
     * Format sesuai SetHeroDataToModel (L134054-134112).
     *
     * @param {number} heroDisplayId — hero template ID
     * @param {number} heroInstanceId — unique instance ID
     * @returns {object|null}
     */
    function buildSummonHeroData(heroDisplayId, heroInstanceId) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('SUMMON', 'Cannot build hero data — config not found: ' + heroDisplayId);
            return null;
        }

        var heroTag = hc.tag ? hc.tag.split(',') : [];
        var baseAttr = makeHeroBasicAttr(heroDisplayId, 1, 0, 0);

        if (!baseAttr) {
            log.error('SUMMON', 'Cannot build hero data — base attr failed: ' + heroDisplayId);
            return null;
        }

        var heroData = {
            _heroId: heroInstanceId,
            _heroDisplayId: heroDisplayId,
            _heroStar: 0,
            _expeditionMaxLevel: 0,
            _heroTag: heroTag,
            _fragment: 0,
            _superSkillResetCount: 0,
            _potentialResetCount: 0,
            _heroBaseAttr: baseAttr,
            _superSkillLevel: {},
            _potentialLevel: {},
            _qigong: [],
            _qigongTmp: [],
            _qigongStage: 1,
            _qigongTmpPower: 0,
            _totalCost: {
                _wakeUp: { _items: [] },
                _earring: { _items: [] },
                _levelUp: { _items: [] },
                _evolve: { _items: [] },
                _skill: { _items: [] },
                _qigong: { _items: [] },
                _heroBreak: { _items: [] }
            },
            _breakInfo: {
                _breakLevel: 1,
                _level: 0,
                _attr: { _items: [] }
            },
            _gemstoneSuitId: 0,
            _linkTo: [],
            _linkFrom: ''
        };

        log.details('SUMMON', [
            ['buildHeroData', 'displayId=' + heroDisplayId + ' instanceId=' + heroInstanceId],
            ['quality', hc.quality || '-'],
            ['heroType', hc.heroType || '-'],
            ['talent', String(hc.talent || 0)],
            ['speed', String(hc.speed || 0)]
        ]);

        return heroData;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO INSTANCE ID GENERATION
    // ═══════════════════════════════════════════════════════════

    /**
     * generateHeroInstanceId(savedData)
     * Generate unique hero instance ID.
     * Mencari max _heroId di existing collection + 1.
     */
    function generateHeroInstanceId(savedData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        var heros = savedData.heros._heros;
        var maxId = 0;
        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;
            var hid = Number(heros[key]._heroId) || 0;
            if (hid > maxId) maxId = hid;
        }
        return maxId + 1;
    }

    // ═══════════════════════════════════════════════════════════
    //  ADD HERO TO PLAYER COLLECTION
    // ═══════════════════════════════════════════════════════════

    /**
     * addHeroToCollection(savedData, heroData)
     * Tambahkan hero ke savedData.heros._heros.
     * Key = next sequential index.
     *
     * @returns {string} hero key index yang digunakan
     */
    function addHeroToCollection(savedData, heroData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        var heros = savedData.heros._heros;
        var maxKey = -1;
        for (var k in heros) {
            if (heros.hasOwnProperty(k)) { var nk = Number(k); if (nk > maxKey) maxKey = nk; }
        }
        var heroKey = String(maxKey + 1);
        savedData.heros._heros[heroKey] = heroData;

        log.details('SUMMON', ['heroAdded', 'key=' + heroKey + ' displayId=' + heroData._heroDisplayId]);

        return heroKey;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    /**
     * handleSummonOne(request, callback)
     *
     * Paid single summon handler.
     *
     * Request:
     *   { type:'summon', action:'summonOne',
     *     userId, sType, version:'1.0' }
     *
     * Response:
     *   _addTotal      — Array<HeroData> (1 hero)
     *   _changeInfo    — { _items: { "itemId": { _id, _num }, ... } } (updated balances)
     *   _energy        — updated energy value
     *   _canFreeTime   — current free summon timestamp (unchanged by paid summon)
     *   actId          — empty string
     *
     * @param {object} request
     * @param {function} callback(responseData)
     */
    function handleSummonOne(request, callback) {
        var userId = request.userId;
        var sType = Number(request.sType) || SUMMON_TYPE.COMMON;

        log.info('HANDLER', 'summon/summonOne — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['sType', String(sType) + ' (' + ({
                1: 'COMMON', 2: 'FRIEND', 3: 'SUPER', 4: 'SUPER_DIAMOND'
            }[sType] || 'UNKNOWN') + ')'],
            ['version', request.version || '-']
        ]);

        // ── Validate userId ──
        if (!userId) {
            log.error('HANDLER', 'summon/summonOne — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        // ── Validate sType — only 1,2,3,4 for paid summon ──
        var validSTypes = [SUMMON_TYPE.COMMON, SUMMON_TYPE.FRIEND, SUMMON_TYPE.SUPER, SUMMON_TYPE.SUPER_DIAMOND];
        if (validSTypes.indexOf(sType) === -1) {
            log.error('HANDLER', 'summon/summonOne — invalid sType: ' + sType + ' (only 1-4 allowed)');
            callback({ _error: 'invalid_sType' }, 1);
            return;
        }

        // ── Load summon config for cost info ──
        var summonConfig = getSummonConfig();
        if (!summonConfig) {
            log.error('HANDLER', 'summon/summonOne — failed to load summon.json');
            callback({ _error: 'config_error' }, 1);
            return;
        }

        var configId = SUMMON_CONFIG_ID[sType];
        var sConfig = summonConfig[configId];
        if (!sConfig) {
            log.error('HANDLER', 'summon/summonOne — no summon config for sType=' + sType + ' configId=' + configId);
            callback({ _error: 'config_error' }, 1);
            return;
        }

        var costItemId = Number(sConfig.costID1);
        var costAmount = Number(sConfig.cost1);
        var energyGain = Number(sConfig.summonEnergy) || 0;

        log.details('SUMMON', [
            ['config', sConfig.type],
            ['costItemId', String(costItemId)],
            ['costAmount', String(costAmount)],
            ['energyGain', String(energyGain)]
        ]);

        // ── Load user data ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('HANDLER', 'summon/summonOne — user data not found: ' + storageKey);
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        // ── Check item balance ──
        var currentBalance = getItemBalance(savedData, costItemId);
        if (currentBalance < costAmount) {
            log.warn('HANDLER', 'summon/summonOne — not enough items: need ' + costAmount + ' of ' + costItemId + ', have ' + currentBalance);
            callback({ _error: 'not_enough_items' }, 1);
            return;
        }

        // ── Ensure summon data structure ──
        if (!savedData.summon) {
            savedData.summon = {
                _energy: 50,
                _wishList: [],
                _wishVersion: 0,
                _canCommonFreeTime: 0,
                _canSuperFreeTime: 0,
                _summonTimes: {}
            };
            log.details('SUMMON', 'initialized summon data structure for userId=' + userId);
        }

        // ══════════════════════════════════════════════════════════
        //  DEDUCT COST
        // ══════════════════════════════════════════════════════════

        var newBalance = currentBalance - costAmount;
        setItemBalance(savedData, costItemId, newBalance);

        log.details('SUMMON', [
            ['cost', 'item=' + costItemId + ' cost=' + costAmount + ' balance=' + currentBalance + '→' + newBalance]
        ]);

        // ══════════════════════════════════════════════════════════
        //  ROLL HERO FROM POOL
        // ══════════════════════════════════════════════════════════

        var heroDisplayId = getRandomHeroFromPool(sType);

        if (!heroDisplayId) {
            log.error('HANDLER', 'summon/summonOne — failed to roll hero for sType=' + sType);
            // Refund: restore item balance
            setItemBalance(savedData, costItemId, currentBalance);
            callback({ _error: 'no_hero_available' }, 1);
            return;
        }

        // Verify hero config exists
        var heroConfig = getHeroConfig(heroDisplayId);
        if (!heroConfig) {
            log.error('HANDLER', 'summon/summonOne — hero config missing for displayId: ' + heroDisplayId);
            setItemBalance(savedData, costItemId, currentBalance);
            callback({ _error: 'hero_config_missing' }, 1);
            return;
        }

        // ── Generate hero instance ──
        var heroInstanceId = generateHeroInstanceId(savedData);
        var heroData = buildSummonHeroData(heroDisplayId, heroInstanceId);

        if (!heroData) {
            log.error('HANDLER', 'summon/summonOne — failed to build hero data for: ' + heroDisplayId);
            setItemBalance(savedData, costItemId, currentBalance);
            callback({ _error: 'hero_build_failed' }, 1);
            return;
        }

        log.info('SUMMON', [
            'HERO RESULT —',
            'displayId=' + heroDisplayId,
            'instanceId=' + heroInstanceId,
            'quality=' + (heroConfig.quality || '?'),
            'heroType=' + (heroConfig.heroType || '?'),
            'sType=' + sType
        ].join(' '));

        // ══════════════════════════════════════════════════════════
        //  ADD HERO TO USER DATA
        // ══════════════════════════════════════════════════════════

        var heroKey = addHeroToCollection(savedData, heroData);

        // ══════════════════════════════════════════════════════════
        //  UPDATE ENERGY
        // ══════════════════════════════════════════════════════════

        var currentEnergy = Number(savedData.summon._energy) || 0;
        var newEnergy = currentEnergy + energyGain;
        savedData.summon._energy = newEnergy;

        log.details('SUMMON', [
            ['energy', 'current=' + currentEnergy + ' +gain=' + energyGain + ' = ' + newEnergy]
        ]);

        // ── Update summonTimes ──
        var sTypeKey = String(sType);
        if (!savedData.summon._summonTimes) savedData.summon._summonTimes = {};
        savedData.summon._summonTimes[sTypeKey] = (Number(savedData.summon._summonTimes[sTypeKey]) || 0) + 1;

        // ══════════════════════════════════════════════════════════
        //  PERSIST USER DATA
        // ══════════════════════════════════════════════════════════

        db._set(storageKey, savedData);

        // ══════════════════════════════════════════════════════════
        //  TASK PROGRESS UPDATE (General Solution)
        // ============================================================
        // Setelah summon sukses, cek current task user.
        // Jika taskType relevant dengan sType yang dilakukan → set COMPLETE.
        // Kirim Notify 'mainTaskChange' ke client.
        //
        // Client contract (main.min.js L77080):
        //   Notify "mainTaskChange" → setMianTask(e._curMainTask)
        //   e._curMainTask = array [{_id, _state}]
        //
        // Task summon-related (task.json):
        //   6011: summonFriend, taskPara1=1 (sType=FRIEND)
        //   6013: summon,       taskPara1=1 (sType apapun)
        // ============================================================

        var taskUpdated = checkAndCompleteTask(savedData, sType);
        if (taskUpdated) {
            // Save updated curMainTask ke DB
            db._set(storageKey, savedData);

            // Kirim Notify mainTaskChange ke client
            // Format: { _curMainTask: [{_id, _state}] }
            MainServer.log.notify('mainTaskChange', {
                _curMainTask: savedData.curMainTask
            });

            log.info('TASK', 'Notify mainTaskChange sent — task ' +
                savedData.curMainTask[0]._id + ' state=' +
                savedData.curMainTask[0]._state);
        }

        // ══════════════════════════════════════════════════════════
        //  BUILD RESPONSE
        // ══════════════════════════════════════════════════════════

        // _changeInfo: paid summon updates item balance(s)
        // Format: { _items: { "itemId": { _id, _num: ABSOLUTE_BALANCE }, ... } }
        // _num = ABSOLUTE balance (SET, not delta) — client resets to this value
        var changeItems = {};
        changeItems[String(costItemId)] = { _id: costItemId, _num: newBalance };

        var changeInfo = { _items: changeItems };

        // _canFreeTime: paid summon does NOT change free summon timers
        // Return current value so client stays in sync
        // Client: if sType=SUPER → canSuperFreeTime; if sType=COMMON → canCommonFreeTime
        // For sType=FRIEND/SUPER_DIAMOND, client also reads _canFreeTime
        var canFreeTime = 0;
        if (sType === SUMMON_TYPE.SUPER || sType === SUMMON_TYPE.SUPER_DIAMOND) {
            canFreeTime = savedData.summon._canSuperFreeTime || 0;
        } else {
            canFreeTime = savedData.summon._canCommonFreeTime || 0;
        }

        var response = {
            _addTotal: [heroData],
            _changeInfo: changeInfo,
            _energy: newEnergy,
            _canFreeTime: canFreeTime,
            actId: ''
        };

        log.info('HANDLER', 'summon/summonOne — SUCCESS');
        log.details('response', [
            ['heroDisplayId', String(heroDisplayId)],
            ['heroInstanceId', String(heroInstanceId)],
            ['quality', heroConfig.quality || '?'],
            ['heroType', heroConfig.heroType || '?'],
            ['costItem', costItemId + ' x' + costAmount],
            ['newBalance', String(newBalance)],
            ['energy', String(newEnergy)],
            ['canFreeTime', new Date(canFreeTime).toISOString()]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('summon', 'summonOne', handleSummonOne);

    window.MainServer = MainServer;
})();
