/**
 * handlers/hero/getAttrs.js — Hero FULL Attribute Computation Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: hero/getAttrs
 * ============================================================
 *
 * Client call (main.min.js L84786-84795):
 *   ts.processHandler({
 *     type: 'hero',
 *     action: 'getAttrs',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     heros: [heroId1, heroId2, ...],
 *     version: '1.0'
 *   }, callback(response))
 *
 * Dipanggil saat:
 *   - Setelah hero wakeup/star-up (L84786)
 *   - Setelah evolve (L89715)
 *   - Setelah summon new hero (L89840)
 *   - Setelah equip/sign changes (various)
 *
 * Response callback (main.min.js L133724-133738):
 *   HerosManager.getInstance().getAttrsCallBack(heroIdArray, response)
 *
 *   getAttrsCallBack iterates heroIdArray:
 *     for (var o in t._attrs):
 *       hero = getHero(heroIdArray[o])
 *       setTotalAttrs({
 *         _totalAttr: t._attrs[o],
 *         _baseAttr: t._baseAttrs[o]
 *       }, hero)
 *
 * setTotalAttrs (L133802-133839):
 *   1. Calls setBaseAttr(e._baseAttr, hero) — reads _baseAttr._items (OBJECT, for-in)
 *   2. Reads _totalAttr._items → hero.totalAttr[id] = {id, num}
 *   3. Special: _id == 21 (power) → hero.heroBaseAttr.power = Math.floor(_num)
 *
 * setBaseAttr (L133840-133849):
 *   for each item in _baseAttr._items (OBJECT, for-in):
 *     englishName = abilityName[item._id].englishName
 *     heroBaseAttr[englishName] = item._num      ← FLOAT, no floor
 *   heroBaseAttr.hp *= heroBaseAttr.talent         ← client applies talent
 *   heroBaseAttr.attack *= heroBaseAttr.talent
 *   // armor and speed are NOT talent-multiplied by client
 *
 * ============================================================
 * RESPONSE FORMAT (VERIFIED from HAR — real server traffic)
 * ============================================================
 *
 * _attrs and _baseAttrs are ARRAYS (one element per hero).
 * Each element has _items as OBJECT keyed by string ID:
 *   _items: { "0": {"_id":0, "_num":992.0}, "1": {"_id":1, "_num":412.5}, ... }
 *
 * _baseAttr: 35 items — IDs 0-15, 23-41 (NO 16-22)
 *   Raw base stats WITHOUT talent multiplication.
 *   Client applies talent on hp and attack in setBaseAttr.
 *
 * _totalAttr: 42 items — IDs 0-41 (complete)
 *   Display stats WITH talent + power (id=21).
 *   For polosan: same as base + talent applied + energy(16) + orghp(22) + power(21)
 *
 * ============================================================
 * VERIFIED FORMULAS (polosan — no equipment bonuses)
 * ============================================================
 *
 * HP:   raw_hp  = (levelAttr.hp * typeParam.hpParam + typeParam.hpBais)
 *                   * qualityParam.hpParam * balanceHp
 *        total_hp = raw_hp * talent  (FLOAT, no floor — client does floor)
 *
 * ATK:  raw_atk  = (levelAttr.attack * typeParam.attackParam + typeParam.attackBais)
 *                   * qualityParam.attackParam * balanceAttack
 *        total_atk = raw_atk * talent  (FLOAT)
 *
 * DEF:  raw_arm  = (levelAttr.armor * typeParam.armorParam + typeParam.armorBais)
 *                   * qualityParam.armorParam * balanceArmor
 *        total_arm = raw_arm  (NO talent)
 *
 * POWER: weighted sum of display stats * heroPower[heroType] weights
 *        * heroQualityPower[quality].powerParam
 *        Result = Math.floor(power)
 *
 * ============================================================
 * KID GOKU 1205 LEVEL 1 TEST CASE (polosan, critical type, purple)
 * ============================================================
 *   raw_hp=992.0, raw_atk=412.5, raw_arm=143.5, speed=376, talent=0.4
 *   total_hp=396.8, total_atk=165.0, total_arm=143.5
 *   power=3919 (empirically derived: dispHp×1.2 + dispAtk×20 + dispArm×1)
 *   NOTE: real server gives 3886 — gap ~34 (under investigation)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.hero) {
        MainServer.handlers.hero = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE & CONFIG LOADER
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
        } catch (e) {
            log.warn('RESOURCE', 'Failed to load: ' + name + '.json — ' + e.message);
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

    function getHeroPowerTable() {
        return loadJsonSync('heroPower');
    }

    function getHeroQualityPower() {
        return loadJsonSync('heroQualityPower');
    }

    function getEquipConfig(equipId) {
        var eq = loadJsonSync('equip');
        return eq ? eq[String(equipId)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  EQUIP FLAT STAT HELPERS (same logic as wearAuto.js)
    // ═══════════════════════════════════════════════════════════

    function getEquipAbilities(equipConfig) {
        var abilities = [];
        if (!equipConfig) return abilities;
        if (equipConfig.abilityID1 !== undefined && equipConfig.abilityID1 !== '' && equipConfig.value1 !== undefined) {
            abilities.push({ abilityId: Number(equipConfig.abilityID1), value: Number(equipConfig.value1) || 0 });
        }
        if (equipConfig.abilityID2 !== undefined && equipConfig.abilityID2 !== '' && equipConfig.value2 !== undefined) {
            abilities.push({ abilityId: Number(equipConfig.abilityID2), value: Number(equipConfig.value2) || 0 });
        }
        if (equipConfig.abilityID3 !== undefined && equipConfig.abilityID3 !== '' && equipConfig.value3 !== undefined) {
            abilities.push({ abilityId: Number(equipConfig.abilityID3), value: Number(equipConfig.value3) || 0 });
        }
        return abilities;
    }

    /**
     * Read hero's currently equipped items from savedData and sum their flat stats.
     * Returns { flatStats: {abilityId: totalValue} }
     */
    function getHeroEquippedFlatStats(savedData, heroId) {
        var flatStats = {};
        if (!savedData || !savedData.equip || !savedData.equip._suits) return flatStats;
        var heroEquip = savedData.equip._suits[heroId];
        if (!heroEquip || !heroEquip._suitItems) return flatStats;

        var suitItems = heroEquip._suitItems;
        for (var i = 0; i < suitItems.length; i++) {
            var item = suitItems[i];
            var equipId = item._id;
            var eq = getEquipConfig(equipId);
            if (!eq) continue;

            var abilities = getEquipAbilities(eq);
            for (var ai = 0; ai < abilities.length; ai++) {
                var ab = abilities[ai];
                if (flatStats[ab.abilityId] === undefined) flatStats[ab.abilityId] = 0;
                flatStats[ab.abilityId] += ab.value;
            }
        }
        return flatStats;
    }

    // ═══════════════════════════════════════════════════════════
    //  STAT COMPUTATION (VERIFIED — polosan formula)
    // ═══════════════════════════════════════════════════════════

    /**
     * computeRawBaseStats(heroDisplayId, level, evolveLevel, starLevel)
     * — Compute RAW base stats (WITHOUT talent multiplication).
     *
     * Returns object with all stat names. Values are FLOAT (no Math.floor).
     */
    function computeRawBaseStats(heroDisplayId, level, evolveLevel, starLevel) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.warn('GETATTRS', 'Hero config not found: ' + heroDisplayId);
            return null;
        }

        var quality = hc.quality || 'purple';
        var heroType = hc.heroType || 'critical';

        var la = getHeroLevelAttr(level) || {};
        var qp = getHeroQualityParam(quality) || {};
        var tp = getHeroTypeParam(heroType) || {};
        var evEntries = getHeroEvolve(heroDisplayId) || [];
        var wuEntries = getHeroWakeUp(heroDisplayId) || [];

        var stats = {
            hp: 0, attack: 0, armor: 0, speed: 0,
            hit: 0, dodge: 0, block: 0, damageReduce: 0, armorBreak: 0,
            controlResist: 0, skillDamage: 0, criticalDamage: 0, blockEffect: 0,
            critical: 0, criticalResist: 0, trueDamage: 0, energy: 0,
            hpPercent: 0, armorPercent: 0, attackPercent: 0, speedPercent: 0,
            extraArmor: 0, orghp: 0, superDamage: 0,
            healPlus: 0, healerPlus: 0, damageDown: 0, shielderPlus: 0,
            damageUp: 0, talent: Number(hc.talent) || 0,
            heroType: heroType,
            quality: quality,
            balancePower: Number(hc.balancePower) || 1
        };

        // Evolve bonuses
        var evList = Array.isArray(evEntries) ? evEntries : [];
        for (var ei = 0; ei < evList.length; ei++) {
            var ev = evList[ei];
            if (evolveLevel >= (ev.level || 0)) {
                stats.hp += Number(ev.hp) || 0;
                stats.attack += Number(ev.attack) || 0;
                stats.armor += Number(ev.armor) || 0;
                stats.speed += Number(ev.speed) || 0;
            }
        }

        // WakeUp/Star bonuses
        var wuList = Array.isArray(wuEntries) ? wuEntries : [];
        for (var wi = 0; wi < wuList.length; wi++) {
            var wu = wuList[wi];
            if (starLevel >= (wu.star || 0)) {
                stats.talent += Number(wu.talent) || 0;
                stats.hp += Number(wu.hp) || 0;
                stats.attack += Number(wu.attack) || 0;
                stats.armor += Number(wu.armor) || 0;
                stats.speed += Number(wu.speed) || 0;
            }
        }

        // Base stats: level × type × quality × balance
        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        stats.hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        stats.attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        stats.armor += baseArm;

        // Flat stats from hero config
        stats.speed += Number(hc.speed) || 0;
        stats.hit += Number(hc.hit) || 0;
        stats.dodge += Number(hc.dodge) || 0;
        stats.block += Number(hc.block) || 0;
        stats.damageReduce += Number(hc.damageReduce) || 0;
        stats.armorBreak += Number(hc.armorBreak) || 0;
        stats.controlResist += Number(hc.controlResist) || 0;
        stats.skillDamage += Number(hc.skillDamage) || 0;
        stats.criticalDamage += Number(hc.criticalDamage) || 0;
        stats.blockEffect += Number(hc.blockEffect) || 0;
        stats.critical += Number(hc.critical) || 0;
        stats.criticalResist += Number(hc.criticalResist) || 0;
        stats.trueDamage += Number(hc.trueDamage) || 0;
        stats.healPlus += Number(hc.healPlus) || 0;
        stats.healerPlus += Number(hc.healerPlus) || 0;

        return stats;
    }

    // ═══════════════════════════════════════════════════════════
    //  _items OBJECT BUILDER — format: { "0": {_id, _num}, "1": ... }
    // ═══════════════════════════════════════════════════════════

    /**
     * Full attribute ID mapping (0-41) — covers ALL IDs from HAR.
     * IDs 0-30: core stats, IDs 31-41: extended stats (always 0 for polosan).
     */
    var FULL_ATTR_IDS = [
        /* 0*/  'hp',
        /* 1*/  'attack',
        /* 2*/  'armor',
        /* 3*/  'speed',
        /* 4*/  'hit',
        /* 5*/  'dodge',
        /* 6*/  'block',
        /* 7*/  'blockEffect',
        /* 8*/  'skillDamage',
        /* 9*/  'critical',
        /* 10*/ 'criticalResist',
        /* 11*/ 'criticalDamage',
        /* 12*/ 'armorBreak',
        /* 13*/ 'damageReduce',
        /* 14*/ 'controlResist',
        /* 15*/ 'trueDamage',
        /* 16*/ 'energy',
        /* 17*/ 'hpPercent',
        /* 18*/ 'armorPercent',
        /* 19*/ 'attackPercent',
        /* 20*/ 'speedPercent',
        /* 21*/ 'power',
        /* 22*/ 'orghp',
        /* 23*/ 'superDamage',
        /* 24*/ 'healPlus',
        /* 25*/ 'healerPlus',
        /* 26*/ 'extraArmor',
        /* 27*/ 'shielderPlus',
        /* 28*/ 'damageUp',
        /* 29*/ 'damageDown',
        /* 30*/ 'talent',
        /* 31*/ 'superDamageResist',
        /* 32*/ 'dragonBallWarDamageUp',
        /* 33*/ 'reserved33',
        /* 34*/ 'reserved34',
        /* 35*/ 'reserved35',
        /* 36*/ 'reserved36',
        /* 37*/ 'reserved37',
        /* 38*/ 'reserved38',
        /* 39*/ 'reserved39',
        /* 40*/ 'reserved40',
        /* 41*/ 'zpowerLevel'
    ];

    /**
     * buildBaseAttrItems(rawStats) — Build _baseAttr._items as OBJECT.
     *
     * _baseAttr has 35 items: IDs 0-15, 23-41 (NO 16-22).
     * Values are RAW (WITHOUT talent).
     * Client applies talent on hp/attack in setBaseAttr (L133847-133848).
     *
     * Format: { "0": {_id:0, _num:992.0}, "1": {_id:1, _num:412.5}, ... }
     */
    function buildBaseAttrItems(rawStats) {
        var items = {};
        for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
            var id = i;
            // _baseAttr: skip IDs 16-22 (energy, hpPercent, armorPercent, attackPercent, speedPercent, power, orghp)
            if (id >= 16 && id <= 22) continue;

            var name = FULL_ATTR_IDS[id];
            var val = rawStats[name];
            if (val === undefined) val = 0;

            items[String(id)] = { _id: id, _num: val };
        }
        return items;
    }

    /**
     * buildTotalAttrItems(rawStats) — Build _totalAttr._items as OBJECT.
     *
     * _totalAttr has 42 items: IDs 0-41 (complete).
     * Values are DISPLAY stats (WITH talent for hp/attack, NO talent for armor).
     * Also includes: energy(16)=starting Ki from heroBaseAttr._energy (default 50),
     *   orghp(22)=displayHp, power(21)=computed.
     *
     * Format: { "0": {_id:0, _num:396.8}, "1": {_id:1, _num:165.0}, ..., "21": {_id:21, _num:1081}, ... }
     */
    function buildTotalAttrItems(rawStats, equipFlatStats, heroBaseAttr) {
        var talent = rawStats.talent || 0;
        var items = {};

        // Display values: talent applied to base ONLY, then equip flat ADDED
        var dispBaseHp = rawStats.hp * talent;
        var dispBaseAtk = rawStats.attack * talent;

        var totalHp = dispBaseHp + (Number(equipFlatStats[0]) || 0);
        var totalAtk = dispBaseAtk + (Number(equipFlatStats[1]) || 0);
        var totalArmor = rawStats.armor + (Number(equipFlatStats[2]) || 0);

        // Attr ID 16 = RemainEnery (starting Ki in battle).
        // Default = 50 (set by makeHeroBasicAttr in buy.js, summonOne.js, etc.)
        // BUG FIX: previously hardcoded to 0, causing all heroes to start battle with 0 Ki.
        var startEnergy = 50;
        if (heroBaseAttr && typeof heroBaseAttr._energy === 'number' && !isNaN(heroBaseAttr._energy)) {
            startEnergy = heroBaseAttr._energy;
        }

        for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
            var id = i;
            var name = FULL_ATTR_IDS[id];
            var val;

            if (id === 0) val = totalHp;
            else if (id === 1) val = totalAtk;
            else if (id === 2) val = totalArmor;
            else if (id === 16) val = startEnergy;
            else if (id === 21) continue;
            else if (id === 22) val = totalHp;
            else {
                val = rawStats[name];
                if (val === undefined) val = 0;
                if (equipFlatStats[id] !== undefined) {
                    val += Number(equipFlatStats[id]) || 0;
                }
            }

            items[String(id)] = { _id: id, _num: val };
        }

        // Compute power using total display stats (base + equip)
        var displayStats = {};
        for (var si = 0; si < FULL_ATTR_IDS.length; si++) {
            var sId = si;
            var sName = FULL_ATTR_IDS[sId];
            if (sId === 21 || sId === 22) continue;
            var sVal;
            if (sId === 0) sVal = totalHp;
            else if (sId === 1) sVal = totalAtk;
            else if (sId === 2) sVal = totalArmor;
            else {
                sVal = Number(rawStats[sName]) || 0;
                if (equipFlatStats[sId] !== undefined) sVal += Number(equipFlatStats[sId]) || 0;
            }
            if (POWER_BASE_WEIGHTS.hasOwnProperty(sName)) {
                displayStats[sName] = sVal;
            }
        }
        items['21'] = { _id: 21, _num: computePower(displayStats, rawStats) };
        return items;
    }

    // ═══════════════════════════════════════════════════════════
    //  POWER COMPUTATION — v3 (uses heroPower.json per-type weights)
    // ═══════════════════════════════════════════════════════════
    //
    //  Base formula (empirically verified delta for critical type):
    //    power = Σ( stat_value × baseWeight[statName] × heroPower[heroType][statName].powerParam )
    //
    //  Base weights (derived from Kid Goku 1205 delta analysis):
    //    hp     → balancePower  (from hero.json, e.g. 1.2 for critical)
    //    attack → 20
    //    armor  → 1
    //    speed  → 0  (constant per hero, invisible to delta)
    //    all other stats → 1
    //
    //  heroPower.json provides per-type per-stat powerParam:
    //    critical:          hp=1, atk=1, arm=1
    //    bodyDamage:        hp=1, atk=1.6, arm=1
    //    armorDamage:        hp=1, atk=2, arm=1
    //    body/block/armor/etc: hp=1, atk=1, arm=1
    //
    //  Quality multiplier: heroQualityPower[quality].powerParam (all=1 currently)
    //
    //  VERIFIED: Delta per level 100% match for Kid Goku 1205 (critical/purple)
    //    L1→L2: Δ=292, L2→L3: Δ=305
    //
    //  KNOWN GAP: Absolute values off by ~33 for critical/polosan polosan.
    //    L1 calc=3919 vs real≈3886, L2 calc=4211 vs real≈4178
    //    TODO: Need HAR data from bodyDamage/armorDamage types to verify
    //          base weights for those types and close the gap.
    // ================================================================

    // ATK base weight varies by hero type (from HAR delta analysis):
    //   critical/criticalSingle/hit: B=20
    //   skill/body/block/armor/dodge/strength/dot: B=15
    //   bodyDamage: B=15 (then heroPower pp=1.6 → effective=24)
    //   armorDamage: B=15 (then heroPower pp=2 → effective=30)
    var ATK_BASE_WEIGHTS = {
        'critical':       20, 'criticalSingle': 20, 'hit': 20,
        'skill':          15, 'body': 15, 'block': 15,
        'armor':          15, 'armorS': 15, 'armorDamage': 15,
        'bodyDamage':     15, 'dodge': 15, 'strength': 15, 'dot': 15
    };

    // Base weights per stat name
    var POWER_BASE_WEIGHTS = {
        hp:          'balancePower',  // special: uses hero's balancePower, not a fixed number
        attack:      'atkBase',       // special: uses ATK_BASE_WEIGHTS[heroType]
        armor:       1,
        speed:       0,              // speed is constant, not counted
        extraArmor:  1,
        orghp:       0,              // orghp is a display copy of hp, not separate
        talent:      0,
        power:       0,              // don't count power itself
        // Percent stats
        hpPercent:      1,
        attackPercent:  1,
        armorPercent:   1,
        speedPercent:   0,
        // Combat secondary stats
        hit:              1,
        dodge:            1,
        block:            1,
        blockEffect:      1,
        skillDamage:      1,
        critical:         1,
        criticalResist:   1,
        criticalDamage:   1,
        armorBreak:       1,
        damageReduce:     1,
        controlResist:    1,
        trueDamage:       1,
        // Support stats
        healPlus:         1,
        healerPlus:       1,
        shielderPlus:     1,
        damageUp:         1,
        damageDown:       1,
        superDamage:      1,
        // Extended stats
        superDamageResist:      1,
        dragonBallWarDamageUp: 1
    };

    // Cache heroPower lookup table: heroType → { attName → powerParam }
    // NOTE: powerExtraParam exists in heroPower.json (on armor/extraArmor entries)
    //       but is NOT used in the power sum formula. Purpose TBD — may be
    //       for a secondary calculation or a flag. Kept in cache for future use.
    var _heroPowerCache = null;

    function getHeroPowerForType(heroType) {
        if (!_heroPowerCache) {
            var hpTable = getHeroPowerTable();
            _heroPowerCache = {};
            if (hpTable) {
                for (var key in hpTable) {
                    var entry = hpTable[key];
                    var ht = entry.heroType;
                    if (!ht) continue;
                    if (!_heroPowerCache[ht]) {
                        _heroPowerCache[ht] = {};
                    }
                    _heroPowerCache[ht][entry.attName] = Number(entry.powerParam) || 0;
                }
            }
        }
        return _heroPowerCache[heroType] || null;
    }

    /**
     * computePower(rawStats) — Power calculation using heroPower.json per-type weights.
     *
     * power = floor( Σ( stat × baseWeight × heroPower.powerParam ) ) × qualityMult
     *
     * @param {Object} rawStats - Raw base stats from computeRawBaseStats
     *   Must include: hp, attack, armor, talent, balancePower, quality, heroType
     * @returns {number} Computed power (floored integer)
     */
    function computePower(displayStats, rawStats) {
        var balancePower = rawStats.balancePower || 1;
        var quality = rawStats.quality || 'purple';
        var heroType = rawStats.heroType || 'critical';

        // Get heroPower per-type weights
        var typeWeights = getHeroPowerForType(heroType);

        // Calculate power: Σ( stat × baseWeight × powerParam )
        var power = 0;
        for (var statName in displayStats) {
            if (!POWER_BASE_WEIGHTS.hasOwnProperty(statName)) continue;

            var baseWeight = POWER_BASE_WEIGHTS[statName];
            if (baseWeight === 'balancePower') {
                baseWeight = balancePower;
            } else if (baseWeight === 'atkBase') {
                baseWeight = ATK_BASE_WEIGHTS[heroType] || 15;
            }
            if (baseWeight === 0) continue;

            var pp = 1;
            if (typeWeights && typeWeights[statName]) {
                pp = typeWeights[statName];
            }

            var statVal = Number(displayStats[statName]) || 0;
            var contribution = statVal * baseWeight * pp;
            power += contribution;
        }

        // Quality power multiplier (heroQualityPower: all qualities = 1 currently)
        var heroQualityPowerTable = getHeroQualityPower();
        if (heroQualityPowerTable && heroQualityPowerTable[quality]) {
            var qp = Number(heroQualityPowerTable[quality].powerParam) || 1;
            power *= qp;
        }

        return Math.floor(power);
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO DATA RETRIEVAL
    // ═══════════════════════════════════════════════════════════

    function findHeroInStorage(savedData, heroId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return null;
        var heroes = savedData.heros._heros;
        for (var key in heroes) {
            var hero = heroes[key];
            if (hero._heroId === heroId || hero._heroDisplayId === Number(heroId) || String(hero._heroDisplayId) === String(heroId)) {
                return { hero: hero, index: key };
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hero/getAttrs
    // ═══════════════════════════════════════════════════════════

    /**
     * handleGetAttrs(request, callback)
     *
     * Response format (VERIFIED from HAR):
     *   {
     *     type: 'hero', action: 'getAttrs', userId: '...', heros: [...], version: '1.0',
     *     _attrs: [
     *       { _items: { "0": {_id:0, _num:396.8}, ... } },   ← ARRAY, one per hero
     *       ...
     *     ],
     *     _baseAttrs: [
     *       { _items: { "0": {_id:0, _num:992.0}, ... } },
     *       ...
     *     ]
     *   }
     *
     * _baseAttr._items: 35 items, IDs 0-15 + 23-41, OBJECT keyed by string ID
     * _totalAttr._items: 42 items, IDs 0-41, OBJECT keyed by string ID
     * All values are FLOAT (no Math.floor on hp/atk/arm).
     */
    function handleGetAttrs(request, callback) {
        var userId = request.userId;
        var heroIds = request.heros;

        log.info('HANDLER', 'hero/getAttrs processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['heroCount', String(heroIds ? heroIds.length : 0)],
            ['version', request.version || '-']
        ]);

        try {
            if (!userId || !heroIds || !Array.isArray(heroIds) || heroIds.length === 0) {
                log.warn('HANDLER', 'hero/getAttrs — missing userId or heros array');
                callback({
                    type: 'hero', action: 'getAttrs', userId: userId, heros: heroIds, version: '1.0',
                    _attrs: [], _baseAttrs: []
                });
                return;
            }

            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('HANDLER', 'hero/getAttrs — user data not found: ' + storageKey);
                callback({
                    type: 'hero', action: 'getAttrs', userId: userId, heros: heroIds, version: '1.0',
                    _attrs: [], _baseAttrs: []
                });
                return;
            }

            var responseAttrs = [];
            var responseBaseAttrs = [];

            for (var i = 0; i < heroIds.length; i++) {
                var heroId = heroIds[i];

                var found = findHeroInStorage(savedData, heroId);
                if (!found || !found.hero) {
                    log.warn('HANDLER', 'hero/getAttrs — hero not found: ' + heroId);
                    responseAttrs.push({ _items: {} });
                    responseBaseAttrs.push({ _items: {} });
                    continue;
                }

                var hero = found.hero;
                var displayId = hero._heroDisplayId || Number(hero._heroId);
                var baseAttr = hero._heroBaseAttr || {};
                var level = Number(baseAttr._level) || 1;
                var evolveLevel = Number(baseAttr._evolveLevel) || 0;
                var starLevel = Number(hero._heroStar) || 0;

                log.details('hero[' + i + ']', [
                    ['heroId', String(heroId)],
                    ['displayId', String(displayId)],
                    ['level', String(level)],
                    ['evolveLevel', String(evolveLevel)],
                    ['starLevel', String(starLevel)]
                ]);

                var rawStats = computeRawBaseStats(displayId, level, evolveLevel, starLevel);

                if (!rawStats) {
                    log.warn('HANDLER', 'hero/getAttrs — failed to compute stats for heroId: ' + heroId);
                    responseAttrs.push({ _items: {} });
                    responseBaseAttrs.push({ _items: {} });
                    continue;
                }

                // Get hero's equipped items flat stats
                var equipFlatStats = getHeroEquippedFlatStats(savedData, heroId);

                // _baseAttr: RAW stats, 35 items (IDs 0-15, 23-41), OBJECT format
                responseBaseAttrs.push({ _items: buildBaseAttrItems(rawStats) });

                // _totalAttr: Display stats + equip + energy, 42 items (IDs 0-41), OBJECT format
                responseAttrs.push({ _items: buildTotalAttrItems(rawStats, equipFlatStats, baseAttr) });

                var talent = rawStats.talent || 0;
                var dispHp = rawStats.hp * talent;
                var dispAtk = rawStats.attack * talent;
                log.details('stats[' + i + ']', [
                    ['displayId', String(displayId)],
                    ['rawHp', String(rawStats.hp)],
                    ['rawAtk', String(rawStats.attack)],
                    ['rawArm', String(rawStats.armor)],
                    ['talent', String(talent)],
                    ['dispHp', String(dispHp)],
                    ['dispAtk', String(dispAtk)],
                    ['dispArm', String(rawStats.armor)],
                    ['speed', String(rawStats.speed)],
                    ['baseItems', String(Object.keys(buildBaseAttrItems(rawStats)).length)],
                    ['totalItems', String(Object.keys(buildTotalAttrItems(rawStats, equipFlatStats)).length)]
                ]);
            }

            log.info('HANDLER', 'hero/getAttrs success — processed ' + heroIds.length + ' heroes');

            callback({
                type: 'hero',
                action: 'getAttrs',
                userId: userId,
                heros: heroIds,
                version: '1.0',
                _attrs: responseAttrs,
                _baseAttrs: responseBaseAttrs
            });

        } catch (err) {
            log.error('HANDLER', 'hero/getAttrs UNCAUGHT ERROR', err);
            callback({
                type: 'hero', action: 'getAttrs', userId: userId, heros: heroIds, version: '1.0',
                _attrs: [], _baseAttrs: []
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'getAttrs', handleGetAttrs);

    window.MainServer = MainServer;
})();
