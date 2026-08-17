/**
 * heroStats.js — Shared Hero Stat Computation Engine
 * Super Warrior Z — MAIN SERVER
 *
 * FILE INI adalah SINGLE SOURCE OF TRUTH untuk semua perhitungan stats hero.
 * Dipanggil oleh index.js (di-load saat boot), digunakan oleh semua handler
 * yang membutuhkan compute stats: getAttrs, evolve, wakeUp, activeSkill,
 * autoLevelUp, weapon/wear, weapon/upgrade, weapon/strengthen, dll.
 *
 * ═══════════════════════════════════════════════════════════
 * ARCHITECTURE
 * ═══════════════════════════════════════════════════════════
 *
 * computeHeroStats(heroId, savedData)
 *   → { baseItems, totalItems, rawStats, talent }
 *
 * computeMultiHeroStats(heroIds, savedData)
 *   → { attrs: [{_items}], baseAttrs: [{_items}] }  (getAttrs format)
 *
 * ═══════════════════════════════════════════════════════════
 * COMPLETE STAT PIPELINE (trace dari main.min.js)
 * ═══════════════════════════════════════════════════════════
 *
 * 1. RAW BASE (computeRawBaseStats)
 *    a. Evolve flat bonus    ← heroEvolve[] + heroEvolveRed[]
 *    b. WakeUp/Star bonus    ← heroWakeUp[] (incl. talent)
 *    c. Level formula         ← heroLevelAttr × heroTypeParam × heroQualityParam × balance
 *    d. Hero config flats     ← hero.json (speed, hit, dodge, block, dll)
 *
 * 2. QIGONG ACTUAL STATS     ← hero._qigong[0-2].num (server-stored integers)
 *    HP qigong × talent, ATK qigong × talent, ARM qigong (no talent)
 *
 * 3. BREAK BONUSES            ← selfBreak[] entries where levelNeeded <= level
 *
 * 4. PASSIVE SKILL STATS      ← skillOutBattle.json
 *    a. Evolve passive (skillPassive1/2/3) → flat + percent
 *    b. Potential (potential1/2/3) → flat + percent
 *    c. Red passive (heroEvolveRed passive) → flat + percent
 *
 * 5. EQUIPMENT BONUSES        ← from savedData
 *    a. Equip base stats       ← equip.json abilityID/value (flat)
 *    b. Sign level-up stats    ← signLevelUp.json ability/value (flat, per level)
 *    c. Sign random extra      ← sign*Ex.json (type:0=flat, type:1=percent)
 *    d. Weapon level-up        ← weaponLevelUp.json (%hp, %atk, %arm + flat)
 *    e. Weapon strengthen      ← weaponStrengthen.json (flat attack)
 *    f. Jewel level-up         ← jewLevelUp.json (ValueType/ValueNumber, 1 flat + 1 %)
 *    g. Ring level-up          ← ringLevelUp.json (ability/value, mix flat + %)
 *    h. Earring level-up       ← earringLevelUp.json (ability/value, mix flat + %)
 *
 * 6. PERCENT FORMULA (ORDER MATTERS!)
 *    For HP/ATK:  base × talent × (1 + sumAllPercent) + flatEquip
 *    For ARM/SPD: base × (1 + sumAllPercent) + flatEquip
 *    Percent sources: passive + potential + redPassive + signExtra(%) + weapon(%) + jewel(%) + ring(%) + earring(%)
 *    All percents stack ADDITIVELY.
 *
 * 7. POWER COMPUTATION
 *    power = floor( Σ( stat × baseWeight × heroPower.powerParam ) × qualityPowerMult )
 *
 * ═══════════════════════════════════════════════════════════
 * RESPONSE FORMATS
 * ═══════════════════════════════════════════════════════════
 *
 * getAttrs format (array per hero):
 *   _attrs:      [{ _items: { "0":{_id:0,_num:val}, ... } }]
 *   _baseAttrs:  [{ _items: { "0":{_id:0,_num:val}, ... } }]
 *
 * Action format (single hero):
 *   _heroTotalAttr: { _items: { "0":{_id:0,_num:val}, ... } }
 *
 * _baseAttr: 35 items — IDs 0-15, 23-41 (NO 16-22)
 *   Raw stats WITHOUT talent multiplication. Client applies talent in setBaseAttr.
 *
 * _totalAttr: 42 items — IDs 0-41 (complete)
 *   Display stats WITH talent + percent applied + power.
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE
    // ═══════════════════════════════════════════════════════════

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var x = new XMLHttpRequest();
            x.open('GET', './resource/json/' + name + '.json', false);
            x.send();
            if (x.status === 200) {
                _cache[name] = JSON.parse(x.responseText);
                return _cache[name];
            }
        } catch (e) {
            log.warn('HERO_STATS', 'Failed to load: ' + name + ' — ' + e.message);
        }
        return null;
    }

    /** Invalidate cache (useful after resource updates in dev) */
    function invalidateCache(name) {
        if (name) { delete _cache[name]; }
        else { for (var k in _cache) delete _cache[k]; }
    }

    // ═══════════════════════════════════════════════════════════
    //  ABILITY NAME MAPPING (from abilityName.json)
    // ═══════════════════════════════════════════════════════════

    /** Full attribute ID list (0-41). Index = ability ID. */
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

    /** Map: skillOutBattle field name → ability ID */
    var SOB_STAT_TO_ID = {
        hp: 0, attack: 1, armor: 2, speed: 3, hit: 4, dodge: 5, block: 6, blockEffect: 7,
        skillDamage: 8, critical: 9, criticalResist: 10, criticalDamage: 11,
        armorBreak: 12, damageReduce: 13, controlResist: 14, trueDamage: 15,
        hpPercent: 17, armorPercent: 18, attackPercent: 19, speedPercent: 20,
        superDamage: 23, healPlus: 24, healerPlus: 25, extraArmor: 26,
        shielderPlus: 27, damageUp: 28, damageDown: 29,
        controlAdd: -1 // controlAdd exists in skillOutBattle but NOT in FULL_ATTR_IDS
    };

    // ═══════════════════════════════════════════════════════════
    //  HERO FINDER
    // ═══════════════════════════════════════════════════════════

    /**
     * Find a hero in savedData by heroId (instance ID or display ID).
     * @returns {{ hero: Object, index: string } | null}
     */
    function findHeroInStorage(savedData, heroId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return null;
        var heroes = savedData.heros._heros;
        for (var key in heroes) {
            var hero = heroes[key];
            if (hero._heroId === heroId
                || hero._heroDisplayId === Number(heroId)
                || String(hero._heroDisplayId) === String(heroId)) {
                return { hero: hero, index: key };
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 1: RAW BASE STATS
    // ═══════════════════════════════════════════════════════════

    /**
     * computeRawBaseStats(displayId, level, evolveLevel, starLevel)
     *
     * Computes RAW base stats WITHOUT talent, percent, or equipment.
     * Corresponds to client's makeHeroBasicAttr (minus qigong MAX).
     *
     * Steps:
     *   1a. Evolve flat bonus (heroEvolve + heroEvolveRed)
     *   1b. WakeUp/Star bonus (heroWakeUp — includes talent)
     *   1c. Level formula: (levelAttr × typeParam + typeBais) × qualityParam × balance
     *   1d. Hero config flats (speed, hit, dodge, block, etc.)
     *
     * @returns {Object|null} stats object with all stat names, or null on error
     */
    function computeRawBaseStats(displayId, level, evolveLevel, starLevel) {
        var hc = loadJson('hero');
        var hcfg = hc ? hc[String(displayId)] : null;
        if (!hcfg) {
            log.warn('HERO_STATS', 'Hero config not found: ' + displayId);
            return null;
        }

        var quality = hcfg.quality || 'purple';
        var heroType = hcfg.heroType || 'critical';

        var la = (loadJson('heroLevelAttr') || {})[String(level)] || {};
        var qp = (loadJson('heroQualityParam') || {})[quality] || {};
        var tp = (loadJson('heroTypeParam') || {})[heroType] || {};

        var evArr = loadJson('heroEvolve');
        evArr = evArr ? (evArr[String(displayId)] || []) : [];
        var evRedArr = loadJson('heroEvolveRed');
        evRedArr = evRedArr ? (evRedArr[String(displayId)] || []) : [];
        var wuArr = loadJson('heroWakeUp');
        wuArr = wuArr ? (wuArr[String(displayId)] || []) : [];

        if (!Array.isArray(evArr)) evArr = [];
        if (!Array.isArray(evRedArr)) evRedArr = [];
        if (!Array.isArray(wuArr)) wuArr = [];

        var stats = {
            hp: 0, attack: 0, armor: 0, speed: 0,
            hit: 0, dodge: 0, block: 0, damageReduce: 0, armorBreak: 0,
            controlResist: 0, skillDamage: 0, criticalDamage: 0, blockEffect: 0,
            critical: 0, criticalResist: 0, trueDamage: 0,
            hpPercent: 0, armorPercent: 0, attackPercent: 0, speedPercent: 0,
            extraArmor: 0, orghp: 0, superDamage: 0,
            healPlus: 0, healerPlus: 0, damageDown: 0, shielderPlus: 0, damageUp: 0,
            talent: Number(hcfg.talent) || 0,
            heroType: heroType,
            quality: quality,
            balancePower: Number(hcfg.balancePower) || 1
        };

        // ── 1a. Evolve flat bonus (cumulative) ──
        // heroEvolve[] + heroEvolveRed[] — both use same structure
        var allEvolve = evArr.concat(evRedArr);
        for (var ei = 0; ei < allEvolve.length; ei++) {
            var ev = allEvolve[ei];
            if (evolveLevel >= (ev.level || 0)) {
                stats.hp += Number(ev.hp) || 0;
                stats.attack += Number(ev.attack) || 0;
                stats.armor += Number(ev.armor) || 0;
                stats.speed += Number(ev.speed) || 0;
            }
        }

        // ── 1b. WakeUp/Star bonus (cumulative) ──
        for (var wi = 0; wi < wuArr.length; wi++) {
            var wu = wuArr[wi];
            if (starLevel >= (wu.star || 0)) {
                stats.talent += Number(wu.talent) || 0;
                stats.hp += Number(wu.hp) || 0;
                stats.attack += Number(wu.attack) || 0;
                stats.armor += Number(wu.armor) || 0;
                stats.speed += Number(wu.speed) || 0;
            }
        }

        // ── 1c. Level × Type × Quality × Balance formula ──
        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hcfg.balanceHp) || 1);
        stats.hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hcfg.balanceAttack) || 1);
        stats.attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hcfg.balanceArmor) || 1);
        stats.armor += baseArm;

        // ── 1d. Hero config flat stats ──
        stats.speed += Number(hcfg.speed) || 0;
        stats.hit += Number(hcfg.hit) || 0;
        stats.dodge += Number(hcfg.dodge) || 0;
        stats.block += Number(hcfg.block) || 0;
        stats.damageReduce += Number(hcfg.damageReduce) || 0;
        stats.armorBreak += Number(hcfg.armorBreak) || 0;
        stats.controlResist += Number(hcfg.controlResist) || 0;
        stats.skillDamage += Number(hcfg.skillDamage) || 0;
        stats.criticalDamage += Number(hcfg.criticalDamage) || 0;
        stats.blockEffect += Number(hcfg.blockEffect) || 0;
        stats.critical += Number(hcfg.critical) || 0;
        stats.criticalResist += Number(hcfg.criticalResist) || 0;
        stats.trueDamage += Number(hcfg.trueDamage) || 0;
        stats.healPlus += Number(hcfg.healPlus) || 0;
        stats.healerPlus += Number(hcfg.healerPlus) || 0;

        return stats;
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 2: QIGONG ACTUAL STATS
    // ═══════════════════════════════════════════════════════════

    /**
     * Add qigong actual stats (server-stored integers) to rawStats.
     * qigong[0].num = HP, qigong[1].num = Attack, qigong[2].num = Armor
     *
     * Client display: HP × talent, ATK × talent, ARM (no talent)
     * Server stores RAW values (before talent).
     * These are added to rawStats BEFORE talent/percent formula.
     *
     * @param {Object} rawStats - raw stats object (modified in place)
     * @param {Object} hero - hero data from savedData
     */
    function addQigongStats(rawStats, hero) {
        if (!hero._qigong) return;
        var qigong = hero._qigong;
        if (!Array.isArray(qigong)) return;

        // qigong[0] = HP, qigong[1] = Attack, qigong[2] = Armor
        if (qigong[0] && qigong[0].num) rawStats.hp += Number(qigong[0].num) || 0;
        if (qigong[1] && qigong[1].num) rawStats.attack += Number(qigong[1].num) || 0;
        if (qigong[2] && qigong[2].num) rawStats.armor += Number(qigong[2].num) || 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 3: BREAK BONUSES
    // ═══════════════════════════════════════════════════════════

    /**
     * Add self-break bonuses to rawStats.
     * Break entries are filtered by: quality matches hero quality AND levelNeeded <= hero level.
     * Each matching entry adds abilityPara values (hp, attack, armor, speed, etc.)
     *
     * @param {Object} rawStats - raw stats object (modified in place)
     * @param {Object} hcfg - hero config from hero.json
     * @param {number} level - hero level
     * @param {number} evolveLevel - hero evolve level
     */
    function addBreakStats(rawStats, hcfg, level, evolveLevel) {
        var selfBreak = loadJson('selfBreak');
        if (!selfBreak) return;

        var heroBreak = selfBreak[String(hcfg.id)];
        if (!heroBreak || !Array.isArray(heroBreak)) return;

        // Find break quality by evolve level
        var breakQuality = loadJson('selfBreakQuality');
        var qualityKey = null;
        if (breakQuality) {
            // breakQuality is ordered by evolveLevel threshold
            for (var bqKey in breakQuality) {
                var bq = breakQuality[bqKey];
                if (evolveLevel >= (Number(bq.evolveLevel) || 0)) {
                    qualityKey = bq.quality || bqKey;
                }
            }
        }

        for (var bi = 0; bi < heroBreak.length; bi++) {
            var entry = heroBreak[bi];
            if (Number(entry.levelNeeded) > level) continue;

            // Match quality if applicable
            if (qualityKey && entry.quality && entry.quality !== qualityKey) continue;

            var ap = entry.abilityPara;
            if (!ap) continue;

            // abilityPara contains stat bonuses
            if (ap.hp) rawStats.hp += Number(ap.hp) || 0;
            if (ap.attack) rawStats.attack += Number(ap.attack) || 0;
            if (ap.armor) rawStats.armor += Number(ap.armor) || 0;
            if (ap.speed) rawStats.speed += Number(ap.speed) || 0;
            if (ap.hit) rawStats.hit += Number(ap.hit) || 0;
            if (ap.dodge) rawStats.dodge += Number(ap.dodge) || 0;
            if (ap.block) rawStats.block += Number(ap.block) || 0;
            if (ap.critical) rawStats.critical += Number(ap.critical) || 0;
            if (ap.criticalDamage) rawStats.criticalDamage += Number(ap.criticalDamage) || 0;
            if (ap.criticalResist) rawStats.criticalResist += Number(ap.criticalResist) || 0;
            if (ap.armorBreak) rawStats.armorBreak += Number(ap.armorBreak) || 0;
            if (ap.damageReduce) rawStats.damageReduce += Number(ap.damageReduce) || 0;
            if (ap.controlResist) rawStats.controlResist += Number(ap.controlResist) || 0;
            if (ap.skillDamage) rawStats.skillDamage += Number(ap.skillDamage) || 0;
            if (ap.blockEffect) rawStats.blockEffect += Number(ap.blockEffect) || 0;
            if (ap.trueDamage) rawStats.trueDamage += Number(ap.trueDamage) || 0;
            if (ap.healPlus) rawStats.healPlus += Number(ap.healPlus) || 0;
            if (ap.healerPlus) rawStats.healerPlus += Number(ap.healerPlus) || 0;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 4: PASSIVE SKILL STATS (skillOutBattle.json)
    // ═══════════════════════════════════════════════════════════

    /**
     * Extract stats from a skillOutBattle entry.
     * Handles both array (leveled) and single object formats.
     * Returns flat stats + percent stats separately.
     *
     * @param {Object} sob - skillOutBattle.json data
     * @param {number|null} skillId - skill ID to look up
     * @param {number} skillLevel - skill level (1-based)
     * @returns {{ flat: Object, percent: Object }} stats keyed by stat name
     */
    function extractSkillStats(sob, skillId, skillLevel) {
        var flat = {};
        var percent = {};
        if (!sob || !skillId) return { flat: flat, percent: percent };

        var entry = sob[String(skillId)];
        if (!entry) return { flat: flat, percent: percent };

        // Leveled format: array of {level, ...stats}
        if (Array.isArray(entry)) {
            // Find matching level (highest level <= skillLevel)
            var matched = null;
            for (var i = 0; i < entry.length; i++) {
                if (Number(entry[i].level) <= skillLevel) {
                    matched = entry[i];
                } else {
                    break; // levels are ordered ascending
                }
            }
            entry = matched;
        }
        // entry is now a single object or null
        if (!entry) return { flat: flat, percent: percent };

        // Extract all known stat fields
        for (var field in SOB_STAT_TO_ID) {
            var val = entry[field];
            if (val === undefined || val === null || val === '') continue;
            var num = Number(val) || 0;
            if (num === 0) continue;

            var id = SOB_STAT_TO_ID[field];
            if (id === -1) continue; // skip unmapped fields (controlAdd)

            // Percent stats: IDs 17-20
            if (id >= 17 && id <= 20) {
                percent[field] = (percent[field] || 0) + num;
            } else {
                flat[field] = (flat[field] || 0) + num;
            }
        }

        return { flat: flat, percent: percent };
    }

    /**
     * Add ALL passive skill stats to rawStats.
     * Sources: evolve passive (skillPassive1/2/3), potential (potential1/2/3),
     *          red passive (skillPassive1/2/3 from heroEvolveRed)
     *
     * @param {Object} rawStats - raw stats object (modified in place)
     * @param {Object} hcfg - hero config from hero.json
     * @param {Object} hero - hero data from savedData
     */
    function addPassiveSkillStats(rawStats, hcfg, hero) {
        var sob = loadJson('skillOutBattle');
        if (!sob) return;

        var i, result;

        // ── 4a. Evolve passive skills (skillPassive1/2/3) ──
        // Skill level = evolveLevel (each evolve unlocks next level)
        for (var sp = 1; sp <= 3; sp++) {
            var spId = hcfg['skillPassive' + sp];
            if (!spId) continue;
            result = extractSkillStats(sob, spId, rawStats._evolveLevel || 0);
            for (var f in result.flat) {
                rawStats[f] = (rawStats[f] || 0) + result.flat[f];
            }
            for (var p in result.percent) {
                rawStats[p] = (rawStats[p] || 0) + result.percent[p];
            }
        }

        // ── 4b. Potential skills (potential1/2/3) ──
        var potLevel = hero._potentialLevel || {};
        for (var pp = 1; pp <= 3; pp++) {
            var potId = hcfg['potential' + pp];
            var potLv = potLevel[pp];
            if (!potId || !potLv) continue;
            result = extractSkillStats(sob, potId, potLv);
            for (var f in result.flat) {
                rawStats[f] = (rawStats[f] || 0) + result.flat[f];
            }
            for (var p in result.percent) {
                rawStats[p] = (rawStats[p] || 0) + result.percent[p];
            }
        }

        // ── 4c. Red passive skills (from heroEvolveRed) ──
        // These are passive skills unlocked by red evolve
        var evRedArr = loadJson('heroEvolveRed');
        if (evRedArr) {
            var redEntries = evRedArr[String(hcfg.id)] || [];
            if (!Array.isArray(redEntries)) redEntries = [];
            var evolveLevel = Number(hero._heroBaseAttr && hero._heroBaseAttr._evolveLevel) || 0;
            for (var ri = 0; ri < redEntries.length; ri++) {
                var re = redEntries[ri];
                if (evolveLevel < (re.level || 0)) continue;
                // Red evolve entries can have skillPassive IDs
                for (var rp = 1; rp <= 3; rp++) {
                    var rpId = re['skillPassive' + rp];
                    if (!rpId) continue;
                    result = extractSkillStats(sob, rpId, 1); // red passive level always 1
                    for (var f in result.flat) {
                        rawStats[f] = (rawStats[f] || 0) + result.flat[f];
                    }
                    for (var p in result.percent) {
                        rawStats[p] = (rawStats[p] || 0) + result.percent[p];
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 5: EQUIPMENT BONUSES
    // ═══════════════════════════════════════════════════════════

    /**
     * Get equip base stats from equip.json (abilityID/value pairs).
     * Returns flat stats as { abilityId: totalValue }.
     */
    function getEquipAbilities(equipConfig) {
        var abilities = [];
        if (!equipConfig) return abilities;
        for (var n = 1; n <= 3; n++) {
            var aId = equipConfig['abilityID' + n];
            var val = equipConfig['value' + n];
            if (aId !== undefined && aId !== '' && val !== undefined) {
                abilities.push({ abilityId: Number(aId), value: Number(val) || 0 });
            }
        }
        return abilities;
    }

    /**
     * Gather ALL equipment bonuses for a hero.
     * Returns { flat: {abilityId: value}, percent: {abilityId: value} }
     *
     * Equipment sources:
     *   a. Equip base stats (equip.json)
     *   b. Sign level-up stats (signLevelUp.json)
     *   c. Sign random extra stats (sign*Ex.json — from saved sign data)
     *   d. Weapon level-up stats (weaponLevelUp.json)
     *   e. Weapon strengthen stats (weaponStrengthen.json)
     *   f. Jewel level-up stats (jewLevelUp.json)
     *   g. Ring level-up stats (ringLevelUp.json)
     *   h. Earring level-up stats (earringLevelUp.json)
     *
     * @param {Object} savedData - user saved data
     * @param {number} heroId - hero instance ID
     * @returns {{ flat: Object, percent: Object }}
     *         flat[abilityId] = total flat value
     *         percent[abilityId] = total percent value (e.g. 0.15 = 15%)
     */
    function gatherEquipBonuses(savedData, heroId) {
        var flat = {};   // abilityId → flat value
        var percent = {}; // abilityId → percent value (0.xx)

        function addFlat(id, val) { flat[id] = (flat[id] || 0) + val; }
        function addPercent(id, val) { percent[id] = (percent[id] || 0) + val; }

        // ── 5a. Equip base stats (suitItems from equip._suits) ──
        if (savedData && savedData.equip && savedData.equip._suits) {
            var heroEquip = savedData.equip._suits[heroId];
            if (heroEquip && heroEquip._suitItems) {
                var equipCfg = loadJson('equip');
                for (var ei = 0; ei < heroEquip._suitItems.length; ei++) {
                    var eqId = heroEquip._suitItems[ei]._id;
                    var eq = equipCfg ? equipCfg[String(eqId)] : null;
                    if (!eq) continue;
                    var abilities = getEquipAbilities(eq);
                    for (var ai = 0; ai < abilities.length; ai++) {
                        addFlat(abilities[ai].abilityId, abilities[ai].value);
                    }
                }
            }
        }

        // ── 5b. Sign level-up stats ──
        // Signs are stored per hero in savedData, with level per part.
        // signLevelUp.json: { id: { part, quality, ability (stat name), value } }
        // Need to sum all sign levels for this hero.
        // Sign data location varies by implementation — checked from hero data.
        if (savedData && savedData.sign && savedData.sign._signs) {
            var heroSigns = savedData.sign._signs[heroId];
            if (heroSigns) {
                var signLvlCfg = loadJson('signLevelUp');
                if (signLvlCfg) {
                    for (var part = 1; part <= 6; part++) {
                        var signLevel = heroSigns['signLevel' + part] || heroSigns[part] || 0;
                        if (signLevel <= 0) continue;
                        // Find the signLevelUp entry for this part+level
                        // signLevelUp is keyed by sequential ID, not by part+level directly
                        // We need to find entries matching part and signLevel
                        for (var sKey in signLvlCfg) {
                            var sEntry = signLvlCfg[sKey];
                            if (Number(sEntry.part) === part && Number(sEntry.signLevel) === signLevel) {
                                var sAbility = sEntry.ability;
                                var sValue = Number(sEntry.value) || 0;
                                if (sAbility && sValue) {
                                    // Convert stat name to ability ID
                                    var sId = statNameToAbilityId(sAbility);
                                    if (sId >= 0) addFlat(sId, sValue);
                                }
                                break; // found matching entry for this part+level
                            }
                        }
                    }
                }
            }
        }

        // ── 5c. Sign random extra stats (from saved sign data) ──
        // Each sign piece can have random extra stats stored in hero data
        // These are computed by server during sign operations and stored as _signExStats
        if (savedData && savedData.sign && savedData.sign._signExStats) {
            var signExData = savedData.sign._signExStats[heroId];
            if (signExData && Array.isArray(signExData._items)) {
                for (var sei = 0; sei < signExData._items.length; sei++) {
                    var exItem = signExData._items[sei];
                    var exId = Number(exItem._id);
                    var exVal = Number(exItem._num) || 0;
                    if (exVal === 0) continue;
                    // type:0 = flat (IDs 0-15, 23-29), type:1 = percent (IDs 17-20)
                    if (exId >= 17 && exId <= 20) {
                        addPercent(exId, exVal);
                    } else {
                        addFlat(exId, exVal);
                    }
                }
            }
        }

        // ── 5d. Weapon stats ──
        // Weapon data stored per hero: savedData.weapon or hero._weapon
        var weaponData = null;
        if (savedData && savedData.weapon && savedData.weapon._weapons) {
            weaponData = savedData.weapon._weapons[heroId];
        }
        if (!weaponData) {
            // Fallback: find hero and check _weapon field
            var found = findHeroInStorage(savedData, heroId);
            if (found && found.hero._weapon) weaponData = found.hero._weapon;
        }
        if (weaponData) {
            var wDisplayId = Number(weaponData._displayId) || 0;
            var wStar = Number(weaponData._star) || 0;
            var wLevel = Number(weaponData._level) || 1;

            // Weapon level-up stats (weaponLevelUp.json)
            var wluCfg = loadJson('weaponLevelUp');
            if (wluCfg && wluCfg[String(wDisplayId)]) {
                var wluEntries = wluCfg[String(wDisplayId)];
                // Find entry matching star level
                for (var wli = 0; wli < wluEntries.length; wli++) {
                    var wlEntry = wluEntries[wli];
                    if (Number(wlEntry.level) !== wStar) continue;
                    // Percent bonuses
                    if (wlEntry.hpPercent) addPercent(17, Number(wlEntry.hpPercent));
                    if (wlEntry.attackPercent) addPercent(19, Number(wlEntry.attackPercent));
                    if (wlEntry.armorPercent) addPercent(18, Number(wlEntry.armorPercent));
                    if (wlEntry.speedPercent) addPercent(20, Number(wlEntry.speedPercent));
                    // Flat bonuses (critical, dodge, block, etc.)
                    var flatNames = ['critical','dodge','block','hit','speed','blockEffect',
                                    'armorBreak','damageReduce','controlResist','trueDamage',
                                    'skillDamage','criticalDamage','criticalResist',
                                    'healPlus','healerPlus','extraArmor','superDamage'];
                    for (var fni = 0; fni < flatNames.length; fni++) {
                        if (wlEntry[flatNames[fni]]) {
                            var fnId = statNameToAbilityId(flatNames[fni]);
                            if (fnId >= 0) addFlat(fnId, Number(wlEntry[flatNames[fni]]) || 0);
                        }
                    }
                    break;
                }
            }

            // Weapon strengthen stats (weaponStrengthen.json)
            var wsCfg = loadJson('weaponStrengthen');
            if (wsCfg) {
                for (var wsKey in wsCfg) {
                    var wsEntry = wsCfg[wsKey];
                    if (Number(wsEntry.weapon) === wDisplayId && Number(wsEntry.level) === wLevel) {
                        var wsAtk = Number(wsEntry.attack) || 0;
                        if (wsAtk) addFlat(1, wsAtk); // attack = ID 1
                        break;
                    }
                }
            }
        }

        // ── 5e. Jewel (gemstone) stats ──
        // Jewel data stored per hero position (1-6)
        if (savedData && savedData.jewel && savedData.jewel._jewels) {
            var heroJewels = savedData.jewel._jewels[heroId];
            if (heroJewels) {
                var jewLvlCfg = loadJson('jewLevelUp');
                if (jewLvlCfg) {
                    for (var jewPos = 1; jewPos <= 6; jewPos++) {
                        var jewData = heroJewels[String(jewPos)];
                        if (!jewData) continue;
                        var jewLevel = Number(jewData._level) || 1;
                        var jewEntries = jewLvlCfg[String(jewPos)];
                        if (!jewEntries || !Array.isArray(jewEntries)) continue;
                        // Find entry matching jewel level
                        for (var jli = 0; jli < jewEntries.length; jli++) {
                            var jlEntry = jewEntries[jli];
                            if (Number(jlEntry.JewLevel) !== jewLevel) continue;
                            // ValueType1/ValueNumber1 = flat stat
                            if (jlEntry.ValueType1 && jlEntry.ValueNumber1) {
                                var jt1Id = statNameToAbilityId(jlEntry.ValueType1);
                                if (jt1Id >= 0) addFlat(jt1Id, Number(jlEntry.ValueNumber1) || 0);
                            }
                            // ValueType2/ValueNumber2 = percent stat
                            if (jlEntry.ValueType2 && jlEntry.ValueNumber2) {
                                var jt2Id = statNameToAbilityId(jlEntry.ValueType2);
                                if (jt2Id >= 0) addPercent(jt2Id, Number(jlEntry.ValueNumber2) || 0);
                            }
                            break;
                        }
                    }
                }
            }
        }

        // ── 5f. Ring stats ──
        if (savedData && savedData.ring && savedData.ring._ring) {
            var ringData = savedData.ring._ring;
            var ringLevel = Number(ringData._level) || 0;
            if (ringLevel > 0) {
                var ringLvlCfg = loadJson('ringLevelUp');
                if (ringLvlCfg && ringLvlCfg[String(ringLevel)]) {
                    var rlEntry = ringLvlCfg[String(ringLevel)];
                    // Sum all levels up to current ring level
                    for (var rlKey in ringLvlCfg) {
                        if (Number(rlKey) > ringLevel) continue;
                        var rle = ringLvlCfg[rlKey];
                        for (var ra = 1; ra <= (Number(rle.abilityNum) || 0); ra++) {
                            var rAbility = rle['ability' + ra];
                            var rValue = Number(rle['value' + ra]) || 0;
                            if (!rAbility || rValue === 0) continue;
                            var rId = statNameToAbilityId(rAbility);
                            if (rId < 0) continue;
                            // Percent stats
                            if (rId >= 17 && rId <= 20) {
                                addPercent(rId, rValue);
                            } else {
                                addFlat(rId, rValue);
                            }
                        }
                    }
                }
            }
        }

        // ── 5g. Earring stats ──
        if (savedData && savedData.earring && savedData.earring._earring) {
            var earData = savedData.earring._earring;
            var earLevel = Number(earData._level) || 0;
            if (earLevel > 0) {
                var earLvlCfg = loadJson('earringLevelUp');
                if (earLvlCfg) {
                    for (var elKey in earLvlCfg) {
                        if (Number(elKey) > earLevel) continue;
                        var ele = earLvlCfg[elKey];
                        for (var ea = 1; ea <= (Number(ele.abilityNum) || 0); ea++) {
                            var eAbility = ele['ability' + ea];
                            var eValue = Number(ele['value' + ea]) || 0;
                            if (!eAbility || eValue === 0) continue;
                            var eId = statNameToAbilityId(eAbility);
                            if (eId < 0) continue;
                            if (eId >= 17 && eId <= 20) {
                                addPercent(eId, eValue);
                            } else {
                                addFlat(eId, eValue);
                            }
                        }
                    }
                }
            }
        }

        return { flat: flat, percent: percent };
    }

    // ═══════════════════════════════════════════════════════════
    //  STAT NAME → ABILITY ID CONVERTER
    // ═══════════════════════════════════════════════════════════

    var _nameToIdMap = null;

    /** Convert stat name (string) to ability ID (number). Returns -1 if not found. */
    function statNameToAbilityId(name) {
        if (!_nameToIdMap) {
            _nameToIdMap = {};
            for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
                _nameToIdMap[FULL_ATTR_IDS[i]] = i;
            }
        }
        return _nameToIdMap.hasOwnProperty(name) ? _nameToIdMap[name] : -1;
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 6: PERCENT FORMULA + FINAL DISPLAY STATS
    // ═══════════════════════════════════════════════════════════

    /**
     * Build final display stats using the complete formula:
     *   HP/ATK:  base × talent × (1 + sumAllPercents) + flatEquip
     *   ARM/SPD: base × (1 + sumAllPercents) + flatEquip
     *   Others:  base + flatEquip
     *
     * @param {Object} rawStats - raw stats (after steps 1-4)
     * @param {Object} equipBonuses - from gatherEquipBonuses: { flat, percent }
     * @param {Object} baseAttr - hero._heroBaseAttr (for energy)
     * @returns {{ totalItems: Object, baseItems: Object }}
     */
    function buildAttrItems(rawStats, equipBonuses, baseAttr) {
        var talent = rawStats.talent || 0;
        var eqFlat = equipBonuses.flat || {};
        var eqPct = equipBonuses.percent || {};

        // ── Sum ALL percent sources (additive) ──
        var hpPct  = (Number(rawStats.hpPercent) || 0)      + (Number(eqPct[17]) || 0);
        var armPct = (Number(rawStats.armorPercent) || 0)    + (Number(eqPct[18]) || 0);
        var atkPct = (Number(rawStats.attackPercent) || 0)   + (Number(eqPct[19]) || 0);
        var spdPct = (Number(rawStats.speedPercent) || 0)    + (Number(eqPct[20]) || 0);

        // ── Apply formula: talent → percent → flat equip ──
        // HP/ATK get talent, ARM/SPD do NOT
        var dispHp  = rawStats.hp * talent * (1 + hpPct);
        var dispAtk = rawStats.attack * talent * (1 + atkPct);
        var dispArm = rawStats.armor * (1 + armPct);
        var dispSpd = rawStats.speed * (1 + spdPct);

        var totalHp  = dispHp  + (Number(eqFlat[0]) || 0);
        var totalAtk = dispAtk + (Number(eqFlat[1]) || 0);
        var totalArm = dispArm + (Number(eqFlat[2]) || 0);
        var totalSpd = dispSpd + (Number(eqFlat[3]) || 0);

        // ── Energy (starting Ki in battle) ──
        var startEnergy = 50; // default
        if (baseAttr && typeof baseAttr._energy === 'number' && !isNaN(baseAttr._energy)) {
            startEnergy = baseAttr._energy;
        }

        // ── Build TOTAL attr items (42 items, IDs 0-41) ──
        var totalItems = {};
        for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
            var id = i;
            var name = FULL_ATTR_IDS[id];
            var val;

            if (id === 0)       val = totalHp;
            else if (id === 1)  val = totalAtk;
            else if (id === 2)  val = totalArm;
            else if (id === 3)  val = totalSpd;
            else if (id === 16) val = startEnergy;
            else if (id === 21) continue; // power computed separately
            else if (id === 22) val = totalHp; // orghp = display HP
            else if (id >= 17 && id <= 20) {
                // Percent stats: store raw % from passive skills only (equipment % already applied)
                val = Number(rawStats[name]) || 0;
            }
            else {
                val = rawStats[name] !== undefined ? rawStats[name] : 0;
                if (eqFlat[id] !== undefined) val += Number(eqFlat[id]) || 0;
            }

            totalItems[String(id)] = { _id: id, _num: val };
        }

        // ── Build BASE attr items (35 items, IDs 0-15 + 23-41) ──
        var baseItems = {};
        for (var bi = 0; bi < FULL_ATTR_IDS.length; bi++) {
            var bId = bi;
            if (bId >= 16 && bId <= 22) continue; // skip energy, percents, power, orghp
            var bName = FULL_ATTR_IDS[bId];
            var bVal = rawStats[bName] !== undefined ? rawStats[bName] : 0;
            baseItems[String(bId)] = { _id: bId, _num: bVal };
        }

        return { totalItems: totalItems, baseItems: baseItems };
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 7: POWER COMPUTATION
    // ═══════════════════════════════════════════════════════════

    // ATK base weight varies by hero type (derived from HAR delta analysis):
    var ATK_BASE_WEIGHTS = {
        'critical': 20, 'criticalSingle': 20, 'hit': 20,
        'skill': 15, 'body': 15, 'block': 15,
        'armor': 15, 'armorS': 15, 'armorDamage': 15,
        'bodyDamage': 15, 'dodge': 15, 'strength': 15, 'dot': 15
    };

    var POWER_BASE_WEIGHTS = {
        hp: 'balancePower', attack: 'atkBase', armor: 1, speed: 0,
        extraArmor: 1, orghp: 0, talent: 0, power: 0,
        // Percent stats — NOT counted in power (already applied to flat stats)
        hpPercent: 0, attackPercent: 0, armorPercent: 0, speedPercent: 0,
        // Combat secondary stats
        hit: 1, dodge: 1, block: 1, blockEffect: 1, skillDamage: 1,
        critical: 1, criticalResist: 1, criticalDamage: 1, armorBreak: 1,
        damageReduce: 1, controlResist: 1, trueDamage: 1,
        // Support stats
        healPlus: 1, healerPlus: 1, shielderPlus: 1,
        damageUp: 1, damageDown: 1, superDamage: 1,
        // Extended stats
        superDamageResist: 1, dragonBallWarDamageUp: 1
    };

    var _heroPowerCache = null;

    function getHeroPowerForType(heroType) {
        if (!_heroPowerCache) {
            _heroPowerCache = {};
            var hpTable = loadJson('heroPower');
            if (hpTable) {
                for (var key in hpTable) {
                    var entry = hpTable[key];
                    if (!entry.heroType) continue;
                    if (!_heroPowerCache[entry.heroType]) _heroPowerCache[entry.heroType] = {};
                    _heroPowerCache[entry.heroType][entry.attName] = Number(entry.powerParam) || 0;
                }
            }
        }
        return _heroPowerCache[heroType] || null;
    }

    /**
     * Compute power from display stats.
     * power = floor( Σ( stat × baseWeight × heroPower.powerParam ) × qualityMult )
     *
     * @param {Object} totalItems - the _items object from buildAttrItems (before power is added)
     * @param {Object} rawStats - raw stats (for balancePower, quality, heroType)
     * @returns {number} Computed power (floored integer)
     */
    function computePower(totalItems, rawStats) {
        var balancePower = rawStats.balancePower || 1;
        var quality = rawStats.quality || 'purple';
        var heroType = rawStats.heroType || 'critical';
        var typeWeights = getHeroPowerForType(heroType);

        var power = 0;
        for (var name in POWER_BASE_WEIGHTS) {
            if (!POWER_BASE_WEIGHTS.hasOwnProperty(name)) continue;
            var baseWeight = POWER_BASE_WEIGHTS[name];
            if (baseWeight === 'balancePower') baseWeight = balancePower;
            else if (baseWeight === 'atkBase') baseWeight = ATK_BASE_WEIGHTS[heroType] || 15;
            if (baseWeight === 0) continue;

            var pp = (typeWeights && typeWeights[name]) ? typeWeights[name] : 1;

            // Get the display value from totalItems
            var id = statNameToAbilityId(name);
            if (id < 0 || id === 21 || id === 22) continue;
            var item = totalItems[String(id)];
            var statVal = item ? (Number(item._num) || 0) : 0;

            power += statVal * baseWeight * pp;
        }

        // Quality power multiplier
        var qpt = loadJson('heroQualityPower');
        if (qpt && qpt[quality]) {
            power *= (Number(qpt[quality].powerParam) || 1);
        }

        return Math.floor(power);
    }

    // ═══════════════════════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════════════════════

    /**
     * computeHeroStats(heroId, savedData)
     *
     * Complete stat computation for a SINGLE hero.
     * This is the main entry point for all handlers.
     *
     * @param {number|string} heroId - hero instance ID
     * @param {Object} savedData - user saved data from DB
     * @returns {{ baseItems: Object, totalItems: Object, rawStats: Object, talent: number } | null}
     *   baseItems  — _baseAttr format: 35 items, IDs 0-15 + 23-41 (OBJECT keyed by string ID)
     *   totalItems — _totalAttr format: 42 items, IDs 0-41 (OBJECT keyed by string ID, includes power)
     *   rawStats   — intermediate raw stats (for debugging)
     *   talent     — talent value used
     *
     * @example
     *   var result = MainServer.heroStats.computeHeroStats(12345, savedData);
     *   if (result) {
     *     callback({
     *       heroId: heroId,
     *       _heroTotalAttr: { _items: result.totalItems },
     *       _baseAttr: { _items: result.baseItems }
     *     });
     *   }
     */
    function computeHeroStats(heroId, savedData) {
        // Find hero
        var found = findHeroInStorage(savedData, heroId);
        if (!found || !found.hero) return null;

        var hero = found.hero;
        var displayId = hero._heroDisplayId || Number(hero._heroId);
        var baseAttr = hero._heroBaseAttr || {};
        var level = Number(baseAttr._level) || 1;
        var evolveLevel = Number(baseAttr._evolveLevel) || 0;
        var starLevel = Number(hero._heroStar) || 0;

        // Step 1: Raw base stats (evolve + wakeup + level formula + hero config)
        var rawStats = computeRawBaseStats(displayId, level, evolveLevel, starLevel);
        if (!rawStats) return null;

        // Store evolveLevel for passive skill lookup
        rawStats._evolveLevel = evolveLevel;

        // Step 2: Qigong actual stats (server-stored integers)
        addQigongStats(rawStats, hero);

        // Step 3: Break bonuses
        var heroCfg = (loadJson('hero') || {})[String(displayId)];
        if (heroCfg) addBreakStats(rawStats, heroCfg, level, evolveLevel);

        // Step 4: Passive skill stats (evolve passive + potential + red passive)
        if (heroCfg) addPassiveSkillStats(rawStats, heroCfg, hero);

        // Step 5: Equipment bonuses (equip + sign + weapon + jewel + ring + earring)
        var equipBonuses = gatherEquipBonuses(savedData, heroId);

        // Step 6: Build display stats with percent formula
        var attrResult = buildAttrItems(rawStats, equipBonuses, baseAttr);

        // Step 7: Compute power
        var power = computePower(attrResult.totalItems, rawStats);
        attrResult.totalItems['21'] = { _id: 21, _num: power };

        return {
            baseItems: attrResult.baseItems,
            totalItems: attrResult.totalItems,
            rawStats: rawStats,
            talent: rawStats.talent || 0
        };
    }

    /**
     * computeMultiHeroStats(heroIds, savedData)
     *
     * Compute stats for MULTIPLE heroes (getAttrs format).
     * Used by hero/getAttrs handler.
     *
     * @param {Array} heroIds - array of hero instance IDs
     * @param {Object} savedData - user saved data from DB
     * @returns {{ attrs: Array, baseAttrs: Array }}
     *   attrs     — _attrs format: array of { _items: Object }
     *   baseAttrs — _baseAttrs format: array of { _items: Object }
     */
    function computeMultiHeroStats(heroIds, savedData) {
        var attrs = [];
        var baseAttrs = [];

        for (var i = 0; i < heroIds.length; i++) {
            var result = computeHeroStats(heroIds[i], savedData);
            if (result) {
                attrs.push({ _items: result.totalItems });
                baseAttrs.push({ _items: result.baseItems });
            } else {
                attrs.push({ _items: {} });
                baseAttrs.push({ _items: {} });
            }
        }

        return { attrs: attrs, baseAttrs: baseAttrs };
    }

    // ═══════════════════════════════════════════════════════════
    //  EXPORT
    // ═══════════════════════════════════════════════════════════

    MainServer.heroStats = {
        computeHeroStats: computeHeroStats,
        computeMultiHeroStats: computeMultiHeroStats,
        // Expose internals for handlers that need partial computation
        computeRawBaseStats: computeRawBaseStats,
        gatherEquipBonuses: gatherEquipBonuses,
        findHeroInStorage: findHeroInStorage,
        statNameToAbilityId: statNameToAbilityId,
        loadJson: loadJson,
        invalidateCache: invalidateCache,
        // Constants
        FULL_ATTR_IDS: FULL_ATTR_IDS,
        SOB_STAT_TO_ID: SOB_STAT_TO_ID,
        POWER_BASE_WEIGHTS: POWER_BASE_WEIGHTS,
        ATK_BASE_WEIGHTS: ATK_BASE_WEIGHTS
    };

    log.info('HERO_STATS', 'Module loaded — computeHeroStats ready');

})();