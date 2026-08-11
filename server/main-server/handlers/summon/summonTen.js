/**
 * handlers/summon/summonTen.js — Paid 10x Summon Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: summon/summonTen
 * ============================================================
 *
 * Client call — 4 call sites:
 *
 * ── CALL SITE 1: highSummonTenBtnClick (Super Summon)
 *   Trigger: Player tap "10x Summon" pada Super/High banner
 *   Condition: HIGHSUMMONPAPER (item 123) >= cost2
 *   Fallback: If no paper → check DIAMONDID (item 101) >= cost2
 *   Request:
 *     { type:'summon', action:'summonTen',
 *       userId, sType: SummonType.SUPER (=3), version:'1.0' }
 *     OR sType: SummonType.SUPER_DIAMOND (=4) when using diamonds
 *
 * ── CALL SITE 2: friendSummonTenBtnClick (Friend Summon)
 *   Trigger: Player tap "10x Summon" pada Friend banner
 *   Request:
 *     { type:'summon', action:'summonTen',
 *       userId, sType: SummonType.FRIEND (=2), version:'1.0' }
 *
 * ── CALL SITE 3: commonSummonTenBtnClick (Normal Summon)
 *   Trigger: Player tap "10x Summon" pada Normal/Common banner
 *   Request:
 *     { type:'summon', action:'summonTen',
 *       userId, sType: SummonType.COMMON (=1), version:'1.0' }
 *
 * ============================================================
 * RESPONSE FORMAT (L95432-95469 requestCallBackCheck):
 * ============================================================
 *
 * CRITICAL FIELDS:
 *   _addTotal      — Array<HeroData>: hero results dari summon (10 heroes)
 *                    Client: s = e._addTotal || e._addHeroes
 *   _changeInfo    — { _items: { "itemId": { _id, _num }, ... } }
 *                    ItemsCommonSingleton.resetTtemsCallBack (L118412-118419)
 *                    _num = ABSOLUTE balance (SET, not delta)
 *   _energy        — number: updated summon energy value (after 10x gain)
 *   _canFreeTime   — number: timestamp ms kapan free summon available lagi
 *                    Paid summon does NOT change this — return current value
 *   actId          — string: empty string
 *
 * ============================================================
 * SUMMON CONFIG (summon.json):
 * ============================================================
 *   ID=1 (summonSuper, sType=3):         costID=123, cost2=10, energy=+10/draw
 *   ID=2 (summonSuperDiamond, sType=4):  costID=101, cost2=2200, energy=+10/draw
 *   ID=3 (summonNormal, sType=1):        costID=122, cost2=10, energy=+0/draw
 *   ID=4 (summonFriend, sType=2):         costID=121, cost2=100, energy=+0/draw
 *
 * 10x cost = cost2 field (bukan cost1).
 * Energy gain = summonEnergy × 10 draws.
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
 * Each of the 10 draws is independent — no guaranteed pity system
 * implemented here (pity is handled by summonEnergy handler separately).
 *
 * ============================================================
 * ENERGY MECHANICS:
 * ============================================================
 * summon.json summonEnergy field × 10 draws:
 *   sType=3 (SUPER):         +100 energy (10 × 10)
 *   sType=4 (SUPER_DIAMOND): +100 energy (10 × 10)
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

    /** Number of draws for this handler */
    var DRAW_COUNT = 10;

    /** Storage key format — sama dengan enterGame.js */
    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
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
            log.error('RESOURCE', 'summonTen failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'summonTen failed to load: ' + name + '.json — ' + e.message);
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

        return d;
    }

    // ═══════════════════════════════════════════════════════════
    //  QUALITY TIER HIERARCHY & GUARANTEE HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Quality tier rank — higher number = better quality.
     * Used for guarantee logic: SUPER 10x summon must yield at least 1 S-rank.
     *
     * Tier mapping (game convention):
     *   white → D    (rank 1)
     *   green → C    (rank 2)
     *   blue  → B    (rank 3)
     *   purple → A   (rank 4)
     *   orange → S   (rank 5)  ← GUARANTEE THRESHOLD for SUPER summon
     *   flickerOrange → SS (rank 6)
     *   superOrange → SSS (rank 7)
     */
    var QUALITY_TIER_RANK = {
        'white': 1,
        'green': 2,
        'blue': 3,
        'purple': 4,
        'orange': 5,
        'flickerOrange': 6,
        'superOrange': 7
    };

    /**
     * forcePickHeroByQuality(sType, minQuality)
     *
     * Force-pick a hero from the pool with quality >= minQuality.
     * This is used for the SUPER 10x guarantee: at least 1 S-rank per 10 pulls.
     *
     * Instead of using the normal random quality roll (which could yield any quality),
     * this function restricts the quality roll to only tiers >= minQuality.
     *
     * @param {number} sType — SummonType (3=SUPER, 4=SUPER_DIAMOND)
     * @param {string} minQuality — Minimum quality tier (e.g. 'orange')
     * @returns {number|null} heroDisplayId guaranteed at minQuality or above
     */
    function forcePickHeroByQuality(sType, minQuality) {
        var summonRandom = getSummonRandom();
        var summonPool = getSummonPool();

        if (!summonRandom || !summonPool) {
            log.error('SUMMON', 'forcePick: cannot load config');
            return null;
        }

        var minRank = QUALITY_TIER_RANK[minQuality] || 0;
        var rateCol = QUALITY_RATE_COL[sType] || 'randomHigh';
        var weightCol = POOL_WEIGHT_COL[sType] || 'randomHigh';

        // ── Step 1: Build quality rate table filtered to >= minQuality, hero-only ──
        var heroRates = [];
        for (var i = 1; i <= 10; i++) {
            var entry = summonRandom[String(i)];
            if (!entry) continue;
            if (entry.type.indexOf('Piece') !== -1) continue;
            var rank = QUALITY_TIER_RANK[entry.type] || 0;
            if (rank < minRank) continue;
            var rate = Number(entry[rateCol]) || 0;
            if (rate <= 0) continue;
            heroRates.push({ quality: entry.type, rate: rate });
        }

        if (heroRates.length === 0) {
            log.error('SUMMON', 'forcePick: no quality tiers >= ' + minQuality + ' have rate for sType=' + sType);
            return null;
        }

        // Normalize rates and roll quality
        var totalRate = 0;
        for (var r = 0; r < heroRates.length; r++) totalRate += heroRates[r].rate;

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
        if (!selectedQuality) selectedQuality = heroRates[heroRates.length - 1].quality;

        // ── Step 2: Pick random hero dari pool matching quality ──
        var poolEntries = [];
        var totalWeight = 0;

        for (var key in summonPool) {
            if (!summonPool.hasOwnProperty(key)) continue;
            var pEntry = summonPool[key];
            if (pEntry.type !== 'hero') continue;
            if (pEntry.quality !== selectedQuality) continue;
            var weight = Number(pEntry[weightCol]) || 0;
            if (weight <= 0) continue;
            poolEntries.push({ thingsId: Number(pEntry.thingsId), weight: weight });
            totalWeight += weight;
        }

        if (poolEntries.length === 0 || totalWeight === 0) {
            log.error('SUMMON', 'forcePick: no pool entries for quality=' + selectedQuality + ' sType=' + sType);
            return null;
        }

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
        if (!pickedId) pickedId = poolEntries[poolEntries.length - 1].thingsId;

        log.details('SUMMON', [
            ['forcePick', 'GUARANTEE triggered'],
            ['sType', String(sType)],
            ['minQuality', minQuality],
            ['rolledQuality', selectedQuality],
            ['pickedHeroId', String(pickedId)]
        ]);

        return pickedId;
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
     * Piece tiers di-skip. Rate di-normalize agar total hero-only = 1.0.
     *
     * @param {number} sType — SummonType (1-4)
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
            if (entry.type.indexOf('Piece') !== -1) continue;
            var rate = Number(entry[rateCol]) || 0;
            if (rate <= 0) continue;
            heroRates.push({ quality: entry.type, rate: rate });
        }

        if (heroRates.length === 0) {
            log.error('SUMMON', 'No hero quality rates available for sType=' + sType);
            return null;
        }

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
        }

        // ── Step 2: Pick random hero dari pool matching quality ──
        var poolEntries = [];
        var totalWeight = 0;

        for (var key in summonPool) {
            if (!summonPool.hasOwnProperty(key)) continue;
            var pEntry = summonPool[key];

            if (pEntry.type !== 'hero') continue;
            if (pEntry.quality !== selectedQuality) continue;

            var weight = Number(pEntry[weightCol]) || 0;
            if (weight <= 0) continue;

            poolEntries.push({ thingsId: Number(pEntry.thingsId), weight: weight });
            totalWeight += weight;
        }

        if (poolEntries.length === 0 || totalWeight === 0) {
            log.error('SUMMON', [
                ['poolPick', 'FAILED'],
                ['quality', selectedQuality],
                ['sType', String(sType)]
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

        if (!pickedId) {
            pickedId = poolEntries[poolEntries.length - 1].thingsId;
        }

        log.details('SUMMON', [
            ['poolPick', 'sType=' + sType + ' quality=' + selectedQuality],
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
     *
     * @returns {string} hero key index
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

        return heroKey;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    /**
     * handleSummonTen(request, callback)
     *
     * Paid 10x summon handler.
     *
     * Request:
     *   { type:'summon', action:'summonTen',
     *     userId, sType, version:'1.0' }
     *
     * Response:
     *   _addTotal      — Array<HeroData> (10 heroes)
     *   _changeInfo    — { _items: { "itemId": { _id, _num }, ... } } (updated balance)
     *   _energy        — updated energy value
     *   _canFreeTime   — current free summon timestamp (unchanged by paid summon)
     *   actId          — empty string
     *
     * @param {object} request
     * @param {function} callback(responseData)
     */
    function handleSummonTen(request, callback) {
        var userId = request.userId;
        var sType = Number(request.sType) || SUMMON_TYPE.COMMON;

        log.info('HANDLER', 'summon/summonTen — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['sType', String(sType) + ' (' + ({
                1: 'COMMON', 2: 'FRIEND', 3: 'SUPER', 4: 'SUPER_DIAMOND'
            }[sType] || 'UNKNOWN') + ')'],
            ['version', request.version || '-']
        ]);

        // ── Validate userId ──
        if (!userId) {
            log.error('HANDLER', 'summon/summonTen — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        // ── Validate sType — only 1,2,3,4 for paid summon ──
        var validSTypes = [SUMMON_TYPE.COMMON, SUMMON_TYPE.FRIEND, SUMMON_TYPE.SUPER, SUMMON_TYPE.SUPER_DIAMOND];
        if (validSTypes.indexOf(sType) === -1) {
            log.error('HANDLER', 'summon/summonTen — invalid sType: ' + sType + ' (only 1-4 allowed)');
            callback({ _error: 'invalid_sType' }, 1);
            return;
        }

        // ── Load summon config for cost info ──
        var summonConfig = getSummonConfig();
        if (!summonConfig) {
            log.error('HANDLER', 'summon/summonTen — failed to load summon.json');
            callback({ _error: 'config_error' }, 1);
            return;
        }

        var configId = SUMMON_CONFIG_ID[sType];
        var sConfig = summonConfig[configId];
        if (!sConfig) {
            log.error('HANDLER', 'summon/summonTen — no summon config for sType=' + sType + ' configId=' + configId);
            callback({ _error: 'config_error' }, 1);
            return;
        }

        // 10x summon uses cost2 field (NOT cost1)
        var costItemId = Number(sConfig.costID2);
        var costAmount = Number(sConfig.cost2);
        var energyPerDraw = Number(sConfig.summonEnergy) || 0;

        log.details('SUMMON', [
            ['config', sConfig.type],
            ['costItemId', String(costItemId)],
            ['costAmount', String(costAmount) + ' (10x)'],
            ['energyPerDraw', String(energyPerDraw)],
            ['totalEnergyGain', String(energyPerDraw * DRAW_COUNT)]
        ]);

        // ── Load user data ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('HANDLER', 'summon/summonTen — user data not found: ' + storageKey);
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        // ── Check item balance ──
        var currentBalance = getItemBalance(savedData, costItemId);
        if (currentBalance < costAmount) {
            log.warn('HANDLER', 'summon/summonTen — not enough items: need ' + costAmount + ' of ' + costItemId + ', have ' + currentBalance);
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
        //  DEDUCT COST (10x = cost2)
        // ══════════════════════════════════════════════════════════

        var newBalance = currentBalance - costAmount;
        setItemBalance(savedData, costItemId, newBalance);

        log.details('SUMMON', [
            ['cost', 'item=' + costItemId + ' cost=' + costAmount + ' balance=' + currentBalance + '→' + newBalance]
        ]);

        // ══════════════════════════════════════════════════════════
        //  ROLL 10 HEROES FROM POOL
        // ══════════════════════════════════════════════════════════

        var heroResults = [];
        var rollErrors = 0;

        for (var draw = 0; draw < DRAW_COUNT; draw++) {
            var heroDisplayId = getRandomHeroFromPool(sType);

            if (!heroDisplayId) {
                log.error('SUMMON', 'summonTen — failed to roll hero on draw ' + (draw + 1) + '/' + DRAW_COUNT + ' for sType=' + sType);
                rollErrors++;
                continue;
            }

            var heroConfig = getHeroConfig(heroDisplayId);
            if (!heroConfig) {
                log.error('SUMMON', 'summonTen — hero config missing for displayId: ' + heroDisplayId + ' on draw ' + (draw + 1));
                rollErrors++;
                continue;
            }

            var heroInstanceId = generateHeroInstanceId(savedData);
            var heroData = buildSummonHeroData(heroDisplayId, heroInstanceId);

            if (!heroData) {
                log.error('SUMMON', 'summonTen — failed to build hero data for: ' + heroDisplayId);
                rollErrors++;
                continue;
            }

            // Add to collection
            addHeroToCollection(savedData, heroData);

            heroResults.push({
                heroData: heroData,
                displayId: heroDisplayId,
                instanceId: heroInstanceId,
                quality: heroConfig.quality || '?',
                heroType: heroConfig.heroType || '?'
            });
        }

        // ── Validate: at least 1 hero must be obtained ──
        if (heroResults.length === 0) {
            log.error('HANDLER', 'summon/summonTen — ALL 10 draws failed! Refunding cost.');
            setItemBalance(savedData, costItemId, currentBalance);
            callback({ _error: 'no_hero_available' }, 1);
            return;
        }

        if (rollErrors > 0) {
            log.warn('SUMMON', 'summonTen — ' + rollErrors + '/' + DRAW_COUNT + ' draws failed, continuing with ' + heroResults.length + ' results');
        }

        // ══════════════════════════════════════════════════════════
        //  SUPER SUMMON GUARANTEE — at least 1 S-rank per 10x
        // ══════════════════════════════════════════════════════════
        //
        //  Game design: SUPER (sType=3) and SUPER_DIAMOND (sType=4)
        //  10x summon MUST yield at least 1 hero with quality >= orange (S-rank).
        //
        //  Client shows UI tip: "notProtectSHero = false" → tip visible.
        //  This is the server-side enforcement of that guarantee.
        //
        //  Logic: If no hero in the batch has quality >= orange, find the
        //  hero with the LOWEST quality tier and REPLACE it with a
        //  guaranteed S-rank hero from the pool.
        // ══════════════════════════════════════════════════════════

        if (sType === SUMMON_TYPE.SUPER || sType === SUMMON_TYPE.SUPER_DIAMOND) {
            var MIN_GUARANTEE_TIER = 'orange'; // S-rank minimum
            var minGuaranteeRank = QUALITY_TIER_RANK[MIN_GUARANTEE_TIER]; // 5

            // Check if any hero already meets the guarantee
            var hasGuaranteed = false;
            for (var gi = 0; gi < heroResults.length; gi++) {
                var gRank = QUALITY_TIER_RANK[heroResults[gi].quality] || 0;
                if (gRank >= minGuaranteeRank) {
                    hasGuaranteed = true;
                    break;
                }
            }

            if (!hasGuaranteed) {
                log.info('SUMMON', 'summonTen — GUARANTEE TRIGGERED: no S-rank in 10x batch, forcing replacement');

                // Find the hero with the LOWEST quality tier to replace
                var replaceIdx = -1;
                var lowestRank = 999;
                for (var li = 0; li < heroResults.length; li++) {
                    var lRank = QUALITY_TIER_RANK[heroResults[li].quality] || 0;
                    if (lRank < lowestRank) {
                        lowestRank = lRank;
                        replaceIdx = li;
                    }
                }

                if (replaceIdx >= 0) {
                    var oldResult = heroResults[replaceIdx];
                    log.details('SUMMON', [
                        ['guarantee_replace', 'replacing hero at index ' + replaceIdx],
                        ['oldHero', 'displayId=' + oldResult.displayId + ' quality=' + oldResult.quality],
                        ['oldInstanceId', String(oldResult.instanceId)]
                    ]);

                    // Remove old hero from collection (find by heroId and delete)
                    var oldHeroId = oldResult.instanceId;
                    if (savedData.heros && savedData.heros._heros) {
                        var herosMap = savedData.heros._heros;
                        for (var rk in herosMap) {
                            if (herosMap.hasOwnProperty(rk) && herosMap[rk]._heroId === oldHeroId) {
                                delete herosMap[rk];
                                log.details('SUMMON', ['guarantee_remove', 'removed hero key=' + rk + ' instanceId=' + oldHeroId]);
                                break;
                            }
                        }
                    }

                    // Force-pick a new hero at minimum S-rank quality
                    var guaranteedDisplayId = forcePickHeroByQuality(sType, MIN_GUARANTEE_TIER);

                    if (guaranteedDisplayId) {
                        var guaranteedConfig = getHeroConfig(guaranteedDisplayId);
                        var newInstance = generateHeroInstanceId(savedData);
                        var newHeroData = buildSummonHeroData(guaranteedDisplayId, newInstance);

                        if (newHeroData) {
                            // Add new hero to collection
                            addHeroToCollection(savedData, newHeroData);

                            // Replace in results array
                            heroResults[replaceIdx] = {
                                heroData: newHeroData,
                                displayId: guaranteedDisplayId,
                                instanceId: newInstance,
                                quality: guaranteedConfig ? (guaranteedConfig.quality || 'orange') : 'orange',
                                heroType: guaranteedConfig ? (guaranteedConfig.heroType || '?') : '?'
                            };

                            log.info('SUMMON', [
                                ['guarantee_success', 'REPLACED with guaranteed S-rank hero'],
                                ['newHero', 'displayId=' + guaranteedDisplayId + ' quality=' + (guaranteedConfig ? guaranteedConfig.quality : '?')],
                                ['newInstanceId', String(newInstance)]
                            ]);
                        } else {
                            log.error('SUMMON', 'guarantee: failed to build hero data for guaranteed hero displayId=' + guaranteedDisplayId);
                        }
                    } else {
                        log.error('SUMMON', 'guarantee: forcePickHeroByQuality returned null — could not guarantee S-rank');
                    }
                }
            } else {
                log.details('SUMMON', 'summonTen — guarantee check PASSED: batch already contains S-rank+ hero');
            }
        }

        // Build _addTotal array
        var addTotal = [];
        for (var ri = 0; ri < heroResults.length; ri++) {
            addTotal.push(heroResults[ri].heroData);
        }

        log.info('SUMMON', 'summonTen — ROLLED ' + heroResults.length + ' heroes');
        for (var li = 0; li < heroResults.length; li++) {
            log.details('SUMMON', [
                ['hero#' + (li + 1), 'displayId=' + heroResults[li].displayId + ' instanceId=' + heroResults[li].instanceId + ' quality=' + heroResults[li].quality]
            ]);
        }

        // ══════════════════════════════════════════════════════════
        //  UPDATE ENERGY (energyPerDraw × number of successful draws)
        // ══════════════════════════════════════════════════════════

        var currentEnergy = Number(savedData.summon._energy) || 0;
        var totalEnergyGain = energyPerDraw * heroResults.length;
        var newEnergy = currentEnergy + totalEnergyGain;
        savedData.summon._energy = newEnergy;

        log.details('SUMMON', [
            ['energy', 'current=' + currentEnergy + ' +gain=' + totalEnergyGain + ' (' + energyPerDraw + '×' + heroResults.length + ') = ' + newEnergy]
        ]);

        // ── Update summonTimes ──
        var sTypeKey = String(sType);
        if (!savedData.summon._summonTimes) savedData.summon._summonTimes = {};
        savedData.summon._summonTimes[sTypeKey] = (Number(savedData.summon._summonTimes[sTypeKey]) || 0) + heroResults.length;

        // ══════════════════════════════════════════════════════════
        //  PERSIST USER DATA
        // ══════════════════════════════════════════════════════════

        db._set(storageKey, savedData);

        // ══════════════════════════════════════════════════════════
        //  BUILD RESPONSE
        // ══════════════════════════════════════════════════════════

        // _changeInfo: 10x summon updates item balance
        var changeItems = {};
        changeItems[String(costItemId)] = { _id: costItemId, _num: newBalance };

        var changeInfo = { _items: changeItems };

        // _canFreeTime: paid summon does NOT change free summon timers
        var canFreeTime = 0;
        if (sType === SUMMON_TYPE.SUPER || sType === SUMMON_TYPE.SUPER_DIAMOND) {
            canFreeTime = savedData.summon._canSuperFreeTime || 0;
        } else {
            canFreeTime = savedData.summon._canCommonFreeTime || 0;
        }

        var response = {
            _addTotal: addTotal,
            _changeInfo: changeInfo,
            _energy: newEnergy,
            _canFreeTime: canFreeTime,
            actId: ''
        };

        log.info('HANDLER', 'summon/summonTen — SUCCESS (' + heroResults.length + ' heroes)');
        log.details('response', [
            ['heroCount', String(heroResults.length)],
            ['costItem', costItemId + ' x' + costAmount],
            ['newBalance', String(newBalance)],
            ['energy', String(newEnergy) + ' (+' + totalEnergyGain + ')'],
            ['canFreeTime', new Date(canFreeTime).toISOString()]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('summon', 'summonTen', handleSummonTen);

    window.MainServer = MainServer;
})();
