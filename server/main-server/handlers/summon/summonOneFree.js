/**
 * handlers/summon/summonOneFree.js — Free Summon (Single) Handler v2
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: summon/summonOneFree
 * ============================================================
 *
 * Client call — 2 call sites:
 *
 * ── CALL SITE 1: highSummonOnceBtnClick (Super Summon) L95502-95514
 *   Trigger: Player tap "Free Summon" pada Super/High banner
 *   Condition: highSummonFree() == true
 *   Request:
 *     { type:'summon', action:'summonOneFree',
 *       userId, sType: SummonType.SUPER (=3), isGuide, version:'1.0' }
 *
 * ── CALL SITE 2: commonSummonOnceBtnClick (Normal Summon) L95578-95597
 *   Trigger: Player tap "Free Summon" pada Normal/Common banner
 *   Condition: commonSummonFree() == true
 *   Request:
 *     { type:'summon', action:'summonOneFree',
 *       userId, sType: SummonType.COMMON (=1), isGuide, version:'1.0' }
 *
 * ============================================================
 * RESPONSE FORMAT (L95432-95469 requestCallBackCheck):
 * ============================================================
 *
 * CRITICAL FIELDS:
 *   _addTotal    — Array<HeroData>: hero results dari summon
 *                  Client: s = e._addTotal || e._addHeroes
 *   _changeInfo  — { _items: { "itemId": { _id, _num }, ... } }
 *                  ItemsCommonSingleton.resetTtemsCallBack (L118412-118419)
 *                  _num = ABSOLUTE balance (SET, not delta)
 *                  Free summon: no item changes → empty object {}
 *   _energy      — number: updated summon energy value
 *   _canFreeTime — number: timestamp ms kapan free summon available lagi
 *                  sType=SUPER → canSuperFreeTime = _canFreeTime
 *                  sType=COMMON → canCommonFreeTime = _canFreeTime
 *   actId        — string: activity ID (untuk activity-linked summon)
 *
 * ============================================================
 * TUTORIAL FLOW (isGuide:true):
 * ============================================================
 * Tutorial steps 2201-2213 trigger 2 free summons:
 *   Step 2201-2203 "召唤1" → Hero 1206 (Bulma Blue, blue/skill)
 *   Step 2204-2213 "召唤2" → Hero 1309 (Tien, purple/body)
 *
 * Source: constant.json
 *   tutorialNormalHero: 1206
 *   tutorialHighHero:   1309
 *   tutorialHeroBagSort: "1309,1205,1206"
 *
 * Logic: cek player collection → belum punya 1206 → kasi 1206
 *        cek player collection → belum punya 1309 → kasi 1309
 *        keduanya ada → fallback random pool
 *
 * During tutorial: cooldown BYPASS (isGuide=true → skip cooldown check)
 * Cooldown tetap di-set setelah summon (untuk pasca-tutorial)
 *
 * ============================================================
 * RANDOM POOL ALGORITHM (2-step):
 * ============================================================
 * Step 1: Roll quality tier dari summonRandom.json (individual rates)
 *   sType=3 (SUPER): randomHigh column
 *     flickerOrange=1%, orange=8%, purple=28%, blue=58%, pieces=5%
 *   sType=1 (COMMON): randomNormal column
 *     white=20%, green=34%, blue=25%, purple=10%, orange=1%, pieces=10%
 *
 * Step 2: Pick random hero dari summonPool.json
 *   type="hero", quality=rolled tier, weight > 0 for pool column
 *   Weighted random by hero weight value
 *
 * Piece tiers (orangePiece, flickerOrangePiece) → SKIP, re-normalize hero-only rates
 *   SUPER hero-only: flickerOrange 1.05%, orange 8.42%, purple 29.47%, blue 61.05%
 *   COMMON hero-only: white 22.22%, green 37.78%, blue 27.78%, purple 11.11%, orange 1.11%
 *
 * ============================================================
 * ENERGY MECHANICS:
 * ============================================================
 * summon.json:
 *   summonSuper (sType=3):         summonEnergy = +10
 *   summonNormal (sType=1):        summonEnergy = +0
 *   summonSuperDiamond (sType=4):  summonEnergy = +10 (NOT handled here)
 *   summonFriend (sType=2):        summonEnergy = +0 (NOT handled here)
 *
 * Energy stored: savedData.summon._energy
 * Max threshold: 800 (from summonEnergy.json, 3 tiers all 800)
 * Energy summon (summon/summonEnergy): separate handler, NOT here
 *
 * ============================================================
 * FREE SUMMON COOLDOWN (from summon.json):
 * ============================================================
 *   sType=1 (COMMON): free = 21600s (6 jam)
 *   sType=3 (SUPER):  free = 86400s (24 jam)
 * Cooldowns are INDEPENDENT per pool type.
 *
 * ============================================================
 * DUPLICATE HEROES:
 * ============================================================
 * Duplicate = duplicate. Tidak convert ke fragment/apapun.
 * Hero tetap ditambahkan ke collection sebagai instance baru.
 *
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
     * Free summon cooldown (SECONDS) — dari summon.json config.
     * COMMON (sType=1): 21600s = 6 jam
     * SUPER  (sType=3): 86400s = 24 jam
     */
    var FREE_COOLDOWN_SEC = {
        1: 21600,
        3: 86400
    };

    /**
     * Energy gain per free summon — dari summon.json summonEnergy field.
     * COMMON: 0 (no energy)
     * SUPER:  +10 energy
     */
    var SUMMON_ENERGY_GAIN = {
        1: 0,
        3: 10
    };

    /**
     * Tutorial predetermined heroes — dari constant.json:
     *   tutorialNormalHero: 1206 (Bulma Blue, blue, skill) → sType=COMMON (1)
     *   tutorialHighHero:   1309 (Tien, purple, body)  → sType=SUPER  (3)
     *
     * IMPORTANT: Mapping is sType-based, NOT sequential!
     *   COMMON summon → Bulma Blue (normal quality hero)
     *   SUPER  summon → Tien       (high quality hero)
     */
    var TUTORIAL_HERO_BY_STYPE = {
        1: 1206,  // COMMON → tutorialNormalHero (Bulma Blue)
        3: 1309   // SUPER  → tutorialHighHero (Tien)
    };

    /** summonRandom.json quality type → column name per sType */
    var QUALITY_RATE_COL = {
        1: 'randomNormal',
        3: 'randomHigh'
    };

    /** summonPool.json hero weight → column name per sType */
    var POOL_WEIGHT_COL = {
        1: 'randomNormal',
        3: 'randomHigh'
    };

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
            log.error('RESOURCE', 'summonOneFree failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'summonOneFree failed to load: ' + name + '.json — ' + e.message);
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

    function getConstant() {
        return loadJsonSync('constant');
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
    //  TUTORIAL HERO DETECTION
    // ═══════════════════════════════════════════════════════════

    /**
     * playerHasHeroByDisplayId(savedData, displayId)
     * Cek apakah player sudah punya hero dengan displayId tertentu.
     *
     * @param {object} savedData — player data dari db._get()
     * @param {number} displayId — hero template ID (1206, 1309, etc.)
     * @returns {boolean}
     */
    function playerHasHeroByDisplayId(savedData, displayId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return false;
        var heros = savedData.heros._heros;
        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;
            if (Number(heros[key]._heroDisplayId) === displayId) {
                return true;
            }
        }
        return false;
    }

    /**
     * getTutorialHero(savedData, sType)
     * Menentukan hero tutorial yang harus diberikan berdasarkan sType.
     *
     * Logic (sType-based, dari constant.json):
     *   sType=1 (COMMON) → 1206 (tutorialNormalHero, Bulma Blue)
     *   sType=3 (SUPER)  → 1309 (tutorialHighHero, Tien)
     *
     * Jika hero tutorial untuk sType tersebut sudah dimiliki → return null
     *   (fallback ke random pool)
     *
     * @param {object} savedData
     * @param {number} sType
     * @returns {number|null} heroDisplayId atau null jika sudah punya / bukan tutorial
     */
    function getTutorialHero(savedData, sType) {
        var tutorialId = TUTORIAL_HERO_BY_STYPE[sType];
        if (!tutorialId) {
            log.details('SUMMON', ['tutorialGrant', 'no tutorial hero defined for sType=' + sType]);
            return null;
        }

        if (playerHasHeroByDisplayId(savedData, tutorialId)) {
            log.details('SUMMON', [
                ['tutorialGrant', 'player already owns tutorial hero for sType=' + sType],
                ['heroId', String(tutorialId)],
                ['fallback', 'random pool']
            ]);
            return null;
        }

        log.details('SUMMON', [
            ['tutorialGrant', 'granting predetermined hero'],
            ['heroId', String(tutorialId)],
            ['sType', String(sType) + ' (' + (sType === 3 ? 'SUPER' : 'COMMON') + ')']
        ]);
        return tutorialId;
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
     * @param {number} sType — SummonType (COMMON=1, SUPER=3)
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
            // Fallback: ambil quality terakhir yang available
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
     * handleSummonOneFree(request, callback)
     *
     * Free single summon handler.
     *
     * Request:
     *   { type:'summon', action:'summonOneFree',
     *     userId, sType, isGuide, version:'1.0' }
     *
     * Response:
     *   _addTotal      — Array<HeroData> (1 hero)
     *   _changeInfo    — { _items: {} } (empty — no cost for free summon)
     *   _energy        — updated energy value
     *   _canFreeTime   — timestamp ms for next free summon
     *   actId          — empty string
     *
     * @param {object} request
     * @param {function} callback(responseData)
     */
    function handleSummonOneFree(request, callback) {
        var userId = request.userId;
        var sType = Number(request.sType) || SUMMON_TYPE.COMMON;
        var isGuide = request.isGuide === true;

        log.info('HANDLER', 'summon/summonOneFree — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['sType', String(sType) + ' (' + (sType === 3 ? 'SUPER' : 'COMMON') + ')'],
            ['isGuide', isGuide ? 'YES' : 'NO'],
            ['version', request.version || '-']
        ]);

        // ── Validate userId ──
        if (!userId) {
            log.error('HANDLER', 'summon/summonOneFree — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        // ── Validate sType — hanya COMMON(1) dan SUPER(3) untuk free summon ──
        if (sType !== SUMMON_TYPE.COMMON && sType !== SUMMON_TYPE.SUPER) {
            log.error('HANDLER', 'summon/summonOneFree — invalid sType: ' + sType + ' (only 1=COMMON, 3=SUPER allowed)');
            callback({ _error: 'invalid_sType' }, 1);
            return;
        }

        // ── Load user data ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('HANDLER', 'summon/summonOneFree — user data not found: ' + storageKey);
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        // ── Check free summon cooldown (BYPASS saat tutorial) ──
        var now = Date.now();

        if (!isGuide) {
            if (sType === SUMMON_TYPE.SUPER) {
                var superFreeTime = (savedData.summon && savedData.summon._canSuperFreeTime) || 0;
                if (superFreeTime > now) {
                    var superWaitSec = Math.ceil((superFreeTime - now) / 1000);
                    log.warn('HANDLER', 'summon/summonOneFree — SUPER free not ready (wait ' + superWaitSec + 's)');
                    callback({ _error: 'free_not_ready' }, 1);
                    return;
                }
            } else {
                var commonFreeTime = (savedData.summon && savedData.summon._canCommonFreeTime) || 0;
                if (commonFreeTime > now) {
                    var commonWaitSec = Math.ceil((commonFreeTime - now) / 1000);
                    log.warn('HANDLER', 'summon/summonOneFree — COMMON free not ready (wait ' + commonWaitSec + 's)');
                    callback({ _error: 'free_not_ready' }, 1);
                    return;
                }
            }
        } else {
            log.details('SUMMON', 'tutorial_mode — cooldown check BYPASSED');
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
        //  DETERMINE HERO RESULT
        // ══════════════════════════════════════════════════════════

        var heroDisplayId = null;
        var heroSource = 'unknown';

        // ── Priority 1: Tutorial predetermined hero (sType-based) ──
        if (isGuide) {
            var tutorialHero = getTutorialHero(savedData, sType);
            if (tutorialHero) {
                heroDisplayId = tutorialHero;
                heroSource = 'tutorial';
            } else {
                log.warn('SUMMON', 'isGuide=true but tutorial hero for sType=' + sType + ' already owned — falling back to random pool');
            }
        }

        // ── Priority 2: Random from pool ──
        if (!heroDisplayId) {
            heroDisplayId = getRandomHeroFromPool(sType);
            heroSource = 'random_pool';
        }

        // ── Validate hero result ──
        if (!heroDisplayId) {
            log.error('HANDLER', 'summon/summonOneFree — failed to determine hero (source=' + heroSource + ', sType=' + sType + ')');
            callback({ _error: 'no_hero_available' }, 1);
            return;
        }

        // Verify hero config exists
        var heroConfig = getHeroConfig(heroDisplayId);
        if (!heroConfig) {
            log.error('HANDLER', 'summon/summonOneFree — hero config missing for displayId: ' + heroDisplayId);
            callback({ _error: 'hero_config_missing' }, 1);
            return;
        }

        // ── Generate hero instance ──
        var heroInstanceId = generateHeroInstanceId(savedData);
        var heroData = buildSummonHeroData(heroDisplayId, heroInstanceId);

        if (!heroData) {
            log.error('HANDLER', 'summon/summonOneFree — failed to build hero data for: ' + heroDisplayId);
            callback({ _error: 'hero_build_failed' }, 1);
            return;
        }

        log.info('SUMMON', [
            'HERO RESULT —',
            'displayId=' + heroDisplayId,
            'instanceId=' + heroInstanceId,
            'source=' + heroSource,
            'quality=' + (heroConfig.quality || '?'),
            'heroType=' + (heroConfig.heroType || '?'),
            'sType=' + (sType === 3 ? 'SUPER' : 'COMMON'),
            'isGuide=' + isGuide
        ].join(' '));

        // ══════════════════════════════════════════════════════════
        //  ADD HERO TO USER DATA
        // ══════════════════════════════════════════════════════════

        var heroKey = addHeroToCollection(savedData, heroData);

        // ══════════════════════════════════════════════════════════
        //  UPDATE COOLDOWN — dari summon.json config
        // ══════════════════════════════════════════════════════════

        var cooldownSec = FREE_COOLDOWN_SEC[sType] || 86400; // default 24h
        var nextFreeTime = now + (cooldownSec * 1000);

        if (sType === SUMMON_TYPE.SUPER) {
            savedData.summon._canSuperFreeTime = nextFreeTime;
        } else {
            savedData.summon._canCommonFreeTime = nextFreeTime;
        }

        log.details('SUMMON', [
            ['cooldown', 'sType=' + sType + ' → ' + cooldownSec + 's (' + (cooldownSec / 3600) + 'h)'],
            ['nextFreeTime', new Date(nextFreeTime).toISOString()]
        ]);

        // ══════════════════════════════════════════════════════════
        //  UPDATE ENERGY — dari summon.json summonEnergy field
        // ══════════════════════════════════════════════════════════

        var energyGain = SUMMON_ENERGY_GAIN[sType] || 0;
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
        //  BUILD RESPONSE
        // ══════════════════════════════════════════════════════════

        // _changeInfo: free summon TIDAK mengubah item (no cost).
        // Client: resetTtemsCallBack checks if (e._changeInfo) → iterate _items
        // Format: { _items: {} } — empty object (NOT array)
        // Client for-in on empty object = no-op → safe.
        var changeInfo = { _items: {} };

        var response = {
            _addTotal: [heroData],
            _changeInfo: changeInfo,
            _energy: newEnergy,
            _canFreeTime: nextFreeTime,
            actId: ''
        };

        log.info('HANDLER', 'summon/summonOneFree — SUCCESS');
        log.details('response', [
            ['heroDisplayId', String(heroDisplayId)],
            ['heroInstanceId', String(heroInstanceId)],
            ['heroSource', heroSource],
            ['quality', heroConfig.quality || '?'],
            ['heroType', heroConfig.heroType || '?'],
            ['energy', String(newEnergy)],
            ['cooldown', cooldownSec + 's'],
            ['nextFreeTime', new Date(nextFreeTime).toISOString()]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('summon', 'summonOneFree', handleSummonOneFree);

    window.MainServer = MainServer;
})();
