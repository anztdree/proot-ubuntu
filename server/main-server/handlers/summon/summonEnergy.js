/**
 * handlers/summon/summonEnergy.js — Energy Summon Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: summon/summonEnergy
 * ============================================================
 *
 * Client call (main.min.js L61997-62002):
 *   ts.processHandler({
 *     type: 'summon',
 *     action: 'summonEnergy',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     version: '1.0'
 *   }, callback(response))
 *
 * Prerequisites (VALIDATED CLIENT-SIDE before request):
 *   1. Hero backpack has space (checkPackEnough(1))
 *   2. User has NO_LIMIT month card (终生卡, monthCard id=3)
 *   3. Energy bar is full (energyPrecent() >= 1)
 *
 * Client response handling (L62003):
 *   e.justShowPage = true;
 *   n.requestCallBackCheck(e, true, true, n.oneBtnClickEvent, n.tenBtnClickEvent, t);
 *   ts.currentSceneNode.data.initData()
 *
 * requestCallBackCheck (L61747-61766) reads:
 *   e._addTotal || e._addHeroes → hero results (same format as summonOne)
 *   e._energy → updated energy value
 *   e._changeInfo._items → item balance updates (object, keyed by string ID)
 *   e._canFreeTime → free timer (optional)
 *
 * ============================================================
 * ENERGY MECHANICS:
 * ============================================================
 *   - Energy gained from super summon: +10 per roll (summon.json id=1,2)
 *   - Energy stored: savedData.summon._energy
 *   - Threshold: summonEnergy.json → entry matching (_summonTimes[5] + 1)
 *     id=1: 800, id=2: 800, id=3: 800
 *   - After 3 summons: no more entries → uses max threshold (800)
 *   - Energy CARRIES OVER: newEnergy = currentEnergy - threshold
 *
 * ============================================================
 * ENERGY POOL (summonPool.json):
 * ============================================================
 *   Column: randomSummonEnergy
 *   Contents: 36 heroes, ALL flickerOrange (SS) quality
 *   Algorithm: DIRECT weighted random pick (no quality roll step)
 *     - Filter: type="hero" AND randomSummonEnergy > 0
 *     - Weighted random by randomSummonEnergy value
 *
 * ============================================================
 * RESPONSE FORMAT:
 * ============================================================
 * {
 *   _addTotal: [ { _heroId, _heroDisplayId, _heroStar, _heroBaseAttr, ... } ],
 *   _changeInfo: { _items: {} },  // no item cost for energy summon
 *   _energy: <newEnergyAfterConsumption>,
 *   _canFreeTime: <currentFreeTime>,
 *   actId: ''
 * }
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

    var SUMMON_TYPE_ENERGY = 5;

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
            log.error('RESOURCE', 'summonEnergy failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'summonEnergy failed to load: ' + name + '.json — ' + e.message);
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

    function getSummonPool() {
        return loadJsonSync('summonPool');
    }

    function getSummonEnergyConfig() {
        return loadJsonSync('summonEnergy');
    }

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPERS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

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

    // ═══════════════════════════════════════════════════════════
    //  HERO BASE ATTR COMPUTATION
    // ═══════════════════════════════════════════════════════════

    /**
     * makeHeroBasicAttr — sama dengan summonOne.js
     */
    function makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel) {
        level = level || 1;
        evolveLevel = evolveLevel || 0;
        starLevel = starLevel || 0;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('SUMMON_ENERGY', 'Hero config not found: ' + heroDisplayId);
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

        // Evolve bonuses
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

        // WakeUp/Star bonuses
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

        // Base stats: level × type × quality × balance
        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        d._hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        d._attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        d._armor += baseArm;

        // Flat stats dari hero config
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
    //  BUILD HERO DATA OBJECT
    // ═══════════════════════════════════════════════════════════

    /**
     * buildSummonHeroData — sama format dengan summonOne.js
     */
    function buildSummonHeroData(heroDisplayId, heroInstanceId) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('SUMMON_ENERGY', 'Cannot build hero data — config not found: ' + heroDisplayId);
            return null;
        }

        var heroTag = hc.tag ? hc.tag.split(',') : [];
        var baseAttr = makeHeroBasicAttr(heroDisplayId, 1, 0, 0);

        if (!baseAttr) {
            log.error('SUMMON_ENERGY', 'Cannot build hero data — base attr failed: ' + heroDisplayId);
            return null;
        }

        return {
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
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO INSTANCE ID GENERATION
    // ═══════════════════════════════════════════════════════════

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

        log.details('SUMMON_ENERGY', ['heroAdded', 'key=' + heroKey + ' displayId=' + heroData._heroDisplayId]);

        return heroKey;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENERGY POOL — DIRECT WEIGHTED RANDOM PICK
    // ═══════════════════════════════════════════════════════════

    /**
     * getRandomHeroFromEnergyPool()
     *
     * Pool: summonPool.json → type="hero" AND randomSummonEnergy > 0
     * Semua hero di pool ini adalah flickerOrange (SS).
     * TIDAK ada quality roll — langsung weighted random pick.
     *
     * @returns {number|null} heroDisplayId (thingsId)
     */
    function getRandomHeroFromEnergyPool() {
        var summonPool = getSummonPool();

        if (!summonPool) {
            log.error('SUMMON_ENERGY', 'Cannot load summonPool.json');
            return null;
        }

        // Collect all heroes with energy weight > 0
        var poolEntries = [];
        var totalWeight = 0;

        for (var key in summonPool) {
            if (!summonPool.hasOwnProperty(key)) continue;
            var pEntry = summonPool[key];

            if (pEntry.type !== 'hero') continue;

            var weight = Number(pEntry.randomSummonEnergy) || 0;
            if (weight <= 0) continue;

            poolEntries.push({ thingsId: Number(pEntry.thingsId), weight: weight });
            totalWeight += weight;
        }

        if (poolEntries.length === 0 || totalWeight === 0) {
            log.error('SUMMON_ENERGY', 'No heroes in energy pool!');
            return null;
        }

        // Weighted random pick
        var roll = Math.random() * totalWeight;
        var accum = 0;
        var pickedId = null;

        for (var h = 0; h < poolEntries.length; h++) {
            accum += poolEntries[h].weight;
            if (roll < accum) {
                pickedId = poolEntries[h].thingsId;
                break;
            }
        }

        // Fallback
        if (!pickedId) {
            pickedId = poolEntries[poolEntries.length - 1].thingsId;
        }

        log.details('SUMMON_ENERGY', [
            ['poolSize', String(poolEntries.length)],
            ['totalWeight', String(totalWeight)],
            ['pickedHeroId', String(pickedId)]
        ]);

        return pickedId;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENERGY THRESHOLD CALCULATOR
    // ═══════════════════════════════════════════════════════════

    /**
     * getEnergyThreshold(summonEnergyTimes)
     *
     * Dari summonEnergy.json:
     *   Client logic (L61631-61636):
     *     n = _summonTimes[SummonType.ENERGY]
     *     cari entry dimana id == n + 1 → ambil summonEnergy value
     *     kalau tidak ketemu, pakai max dari semua entry
     *
     * @param {number} timesDone — jumlah energy summon yang sudah dilakukan
     * @returns {number} energy threshold yang dibutuhkan
     */
    function getEnergyThreshold(timesDone) {
        var config = getSummonEnergyConfig();
        if (!config) {
            log.error('SUMMON_ENERGY', 'Cannot load summonEnergy.json');
            return 800; // fallback default
        }

        var nextId = timesDone + 1;
        var threshold = 0;
        var maxThreshold = 0;

        for (var key in config) {
            if (!config.hasOwnProperty(key)) continue;
            var entry = config[key];
            var entryId = Number(entry.id) || 0;
            var entryEnergy = Number(entry.summonEnergy) || 0;

            if (entryId === nextId) {
                threshold = entryEnergy;
            }
            if (entryEnergy > maxThreshold) {
                maxThreshold = entryEnergy;
            }
        }

        // Jika tidak ada entry untuk id ini (misal sudah >3 kali), pakai max
        if (threshold <= 0) {
            threshold = maxThreshold;
        }

        return threshold > 0 ? threshold : 800;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleSummonEnergy(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'summon/summonEnergy — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['version', request.version || '-']
        ]);

        // ── Validate userId ──
        if (!userId) {
            log.error('HANDLER', 'summon/summonEnergy — missing userId');
            callback({}, 1);
            return;
        }

        // ── Load user data ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HANDLER', 'summon/summonEnergy — user data not found: ' + userId);
            callback({}, 1);
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
        }
        if (!savedData.summon._summonTimes) {
            savedData.summon._summonTimes = {};
        }

        // ── Read current energy & times ──
        var currentEnergy = Number(savedData.summon._energy) || 0;
        var energyTimes = Number(savedData.summon._summonTimes[String(SUMMON_TYPE_ENERGY)]) || 0;

        // ── Calculate energy threshold ──
        var threshold = getEnergyThreshold(energyTimes);

        log.details('energy', [
            ['currentEnergy', String(currentEnergy)],
            ['energyTimes', String(energyTimes)],
            ['threshold', String(threshold)]
        ]);

        // ── Validate energy >= threshold ──
        if (currentEnergy < threshold) {
            log.error('HANDLER', 'summon/summonEnergy — insufficient energy: ' + currentEnergy + ' < ' + threshold);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  ROLL HERO FROM ENERGY POOL
        // ═══════════════════════════════════════════════════════

        var heroDisplayId = getRandomHeroFromEnergyPool();
        if (!heroDisplayId) {
            log.error('HANDLER', 'summon/summonEnergy — failed to roll hero from energy pool');
            callback({}, 1);
            return;
        }

        // ── Generate hero instance ID ──
        var heroInstanceId = generateHeroInstanceId(savedData);

        // ── Build hero data ──
        var heroData = buildSummonHeroData(heroDisplayId, heroInstanceId);
        if (!heroData) {
            log.error('HANDLER', 'summon/summonEnergy — failed to build hero data');
            callback({}, 1);
            return;
        }

        // ── Add hero to collection ──
        addHeroToCollection(savedData, heroData);

        // ═══════════════════════════════════════════════════════
        //  UPDATE ENERGY & SUMMON TIMES
        // ═══════════════════════════════════════════════════════

        // Subtract threshold (energy carries over)
        var newEnergy = currentEnergy - threshold;
        if (newEnergy < 0) newEnergy = 0;
        savedData.summon._energy = newEnergy;

        // Increment energy summon times
        var newTimes = energyTimes + 1;
        savedData.summon._summonTimes[String(SUMMON_TYPE_ENERGY)] = newTimes;

        log.details('energy', [
            ['consumed', String(threshold)],
            ['newEnergy', String(newEnergy)],
            ['newTimes', String(newTimes)]
        ]);

        // ═══════════════════════════════════════════════════════
        //  PERSIST USER DATA
        // ═══════════════════════════════════════════════════════

        db._set(key, savedData);

        // ═══════════════════════════════════════════════════════
        //  BUILD RESPONSE
        // ═══════════════════════════════════════════════════════

        // _changeInfo: no item cost for energy summon, but client always
        // processes _changeInfo._items via resetTtemsCallBack.
        // Send empty object — client handles gracefully.
        var changeInfo = { _items: {} };

        // _canFreeTime: energy summon does NOT change free timers.
        // Return 0 so client's ternary falls through to existing values.
        var canFreeTime = 0;

        var response = {
            _addTotal: [heroData],
            _changeInfo: changeInfo,
            _energy: newEnergy,
            _canFreeTime: canFreeTime,
            actId: ''
        };

        log.info('HANDLER', 'summon/summonEnergy — SUCCESS');
        log.details('response', [
            ['heroDisplayId', String(heroDisplayId)],
            ['heroInstanceId', String(heroInstanceId)],
            ['newEnergy', String(newEnergy)],
            ['energyTimes', String(newTimes)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('summon', 'summonEnergy', handleSummonEnergy);

    window.MainServer = MainServer;

})();