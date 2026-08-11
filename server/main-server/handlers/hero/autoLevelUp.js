/**
 * handlers/hero/autoLevelUp.js — Hero Auto Level-Up Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: hero/autoLevelUp
 * ============================================================
 *
 * Client call (main.min.js L179491-179510):
 *   ts.processHandler({
 *     type: 'hero',
 *     action: 'autoLevelUp',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     heroId: choseHeroId,
 *     version: '1.0',
 *     times: 1    // 1 = single level-up, 100 = auto/max level-up
 *   }, callback(response))
 *
 * Dipanggil saat:
 *   - Single level-up button tap (times=1)
 *   - Auto level-up button tap (times=100)
 *
 * Response callback (main.min.js L179498-179510):
 *   1. HerosManager.getInstance().levelUpCallBack(response)
 *      → setHeroLevelUpDataChange(e, hero)
 *        → e._evolveLevel → hero.heroBaseAttr.evolveLevel = e._evolveLevel
 *        → e._heroLevel → hero.heroBaseAttr.level = e._heroLevel
 *   2. setTotalAttrs(response, hero)
 *      → setBaseAttr(response._baseAttr, hero) — reads _baseAttr._items (OBJECT)
 *      → reads _totalAttr._items (OBJECT) → hero.totalAttr
 *      → setTotalCost(response, hero) — reads _totalCost
 *   3. EquipInfoManager.wakeUpEarringData(n.heroId, n._equip) — if n._equip exists
 *   4. ItemsCommonSingleton.resetTtemsCallBack(n)
 *      → reads n._changeInfo._items (OBJECT)
 *      → for each: setItem(item._id, item._num) → items[id] = num (ABSOLUTE balance!)
 *
 * ============================================================
 * _changeInfo = ABSOLUTE balance after deduction, NOT negative delta!
 *   Client: setItem(id, num) → this.items[id] = num  (SET, not +=)
 *   So _changeInfo._items = { "102": {_id:102, _num:165398}, ... }
 *   means gold balance is now 165398.
 *
 * _totalCost must have 7 sections (HeroTotalCost.deserialize L133362):
 *   _wakeUp, _earring, _levelUp, _evolve, _skill, _qigong, _heroBreak
 *   Each: { _items: { "102": {_id:102, _num:93}, ... } } (OBJECT)
 *
 * ============================================================
 * RESPONSE FORMAT (VERIFIED from HAR)
 * ============================================================
 * {
 *   type: 'hero', action: 'autoLevelUp', userId: '...', heroId: '...',
 *   version: '1.0', times: 1,
 *   _heroLevel: 2,
 *   _totalAttr: { _items: { "0": {_id:0, _num:675.84}, ... } },  ← 42 items, OBJECT
 *   _baseAttr: { _items: { "0": {_id:0, _num:1126.4}, ... } },  ← 35 items, OBJECT
 *   _totalCost: {
 *     _wakeUp:    { _items: {} },
 *     _earring:   { _items: {} },
 *     _levelUp:   { _items: { "102": {_id:102, _num:93}, "131": {_id:131, _num:20} } },
 *     _evolve:    { _items: {} },
 *     _skill:     { _items: {} },
 *     _qigong:    { _items: {} },
 *     _heroBreak: { _items: {} }
 *   },
 *   _changeInfo: { _items: { "102": {_id:102, _num:165398}, "131": {_id:131, _num:29778} } },
 *   _linkHeroesTotalAttr: {},
 *   _linkHeroesBasicAttr: {}
 * }
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

    function getHeroBook() {
        return loadJsonSync('heroBook');
    }

    function getHeroBookRed() {
        return loadJsonSync('heroBookRed');
    }

    function getHeroLevelUpMul() {
        return loadJsonSync('heroLevelUpMul');
    }

    function getHeroLevelUpCost(quality, level) {
        var costTable = loadJsonSync('heroLevelUp' + capitalize(quality));
        if (!costTable) return null;
        return costTable[String(level)] || null;
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function getHeroMaxLevel(displayId, quality) {
        var id = String(displayId);
        var bookRed = getHeroBookRed();
        if (bookRed && bookRed[id]) {
            return parseInt(bookRed[id].level, 10) || 0;
        }
        var book = getHeroBook();
        if (book && book[id]) {
            return parseInt(book[id].level, 10) || 0;
        }
        return 0;
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
    //  STAT COMPUTATION (polosan — same as getAttrs.js)
    // ═══════════════════════════════════════════════════════════

    function computeRawBaseStats(heroDisplayId, level, evolveLevel, starLevel) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) return null;

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

        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        stats.hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        stats.attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        stats.armor += baseArm;

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
    //  _items OBJECT BUILDER (same format as getAttrs.js)
    // ═══════════════════════════════════════════════════════════

    var FULL_ATTR_IDS = [
        'hp','attack','armor','speed','hit','dodge','block','blockEffect',
        'skillDamage','critical','criticalResist','criticalDamage',
        'armorBreak','damageReduce','controlResist','trueDamage',
        'energy','hpPercent','armorPercent','attackPercent','speedPercent',
        'power','orghp','superDamage','healPlus','healerPlus','extraArmor',
        'shielderPlus','damageUp','damageDown','talent',
        'superDamageResist','dragonBallWarDamageUp',
        'reserved33','reserved34','reserved35','reserved36','reserved37',
        'reserved38','reserved39','reserved40','zpowerLevel'
    ];

    function buildBaseAttrItems(rawStats) {
        var items = {};
        for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
            var id = i;
            if (id >= 16 && id <= 22) continue;
            var name = FULL_ATTR_IDS[id];
            var val = rawStats[name];
            if (val === undefined) val = 0;
            items[String(id)] = { _id: id, _num: val };
        }
        return items;
    }

    function buildTotalAttrItems(rawStats, equipFlatStats) {
        var talent = rawStats.talent || 0;
        var displayHp = rawStats.hp * talent;
        var displayAtk = rawStats.attack * talent;
        var displayArm = rawStats.armor;

        // Add equip flat stats to display values (talent applied to base ONLY, then equip flat ADDED)
        var totalHp = displayHp + (Number(equipFlatStats[0]) || 0);
        var totalAtk = displayAtk + (Number(equipFlatStats[1]) || 0);
        var totalArmor = displayArm + (Number(equipFlatStats[2]) || 0);

        var items = {};

        for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
            var id = i;
            var name = FULL_ATTR_IDS[id];
            var val;

            if (id === 0) val = totalHp;
            else if (id === 1) val = totalAtk;
            else if (id === 2) val = totalArmor;
            else if (id === 16) val = 0;
            else if (id === 21) continue;
            else if (id === 22) val = totalHp;
            else {
                val = rawStats[name];
                if (val === undefined) val = 0;
                // Add equip flat contribution for this ability ID
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
        // Percent stats — apply to base stat, counted separately
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
            // Special: hp uses balancePower instead of fixed weight
            if (baseWeight === 'balancePower') {
                baseWeight = balancePower;
            } else if (baseWeight === 'atkBase') {
                baseWeight = ATK_BASE_WEIGHTS[heroType] || 15;
            }
            if (baseWeight === 0) continue;

            var pp = 1; // default powerParam
            if (typeWeights && typeWeights[statName]) {
                pp = typeWeights[statName]; // directly the powerParam number
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
    //  ITEM / COST HELPERS
    // ═══════════════════════════════════════════════════════════

    var ITEM_IDS = {
        DIAMONDID: 101,
        GOLDID: 102,
        PLAYEREXPERIENCEID: 103,
        PLAYERLEVELID: 104,
        EXPERIENCECAPSULEID: 131
    };

    function findItemById(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return null;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (items[i]._id === itemId) return items[i];
        }
        return null;
    }

    function findItemByIdObject(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return null;
        var items = savedData.totalProps._items;
        for (var key in items) {
            if (items[key]._id === itemId) return items[key];
        }
        return null;
    }

    function getItemNum(savedData, itemId) {
        var item = findItemById(savedData, itemId) || findItemByIdObject(savedData, itemId);
        return item ? Number(item._num) || 0 : 0;
    }

    function deductItem(savedData, itemId, amount) {
        var item = findItemById(savedData, itemId) || findItemByIdObject(savedData, itemId);
        if (!item) return 0;
        var current = Number(item._num) || 0;
        var deduct = Math.min(current, amount);
        item._num = current - deduct;
        return deduct;
    }

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
    //  UP_TYPE CONSTANTS (matching main.min.js L84283)
    // ═══════════════════════════════════════════════════════════

    var UP_TYPE = {
        TYPE_LEVEL: 1,
        TYPE_EVOLVE: 2,
        TYPE_WAKEUP: 3,
        TYPE_FULL: 4,
        TYPE_WAITMACHINEUP: 5,
        TYPE_WAITSTARUP: 6
    };

    function getHeroNextState(hero, heroConfig) {
        var displayId = hero._heroDisplayId || Number(hero._heroId);
        var baseAttr = hero._heroBaseAttr || {};
        var level = Number(baseAttr._level) || 1;
        var evolveLevel = Number(baseAttr._evolveLevel) || 0;
        var starLevel = Number(hero._heroStar) || 0;
        var quality = (heroConfig && heroConfig.quality) || 'purple';

        var evEntries = getHeroEvolve(displayId) || [];
        for (var ei = 0; ei < evEntries.length; ei++) {
            var ev = evEntries[ei];
            if (Number(ev.level) === level) {
                if (level > evolveLevel) {
                    if (starLevel < (Number(ev.needStarSelf) || 0)) {
                        return UP_TYPE.TYPE_WAITSTARUP;
                    }
                    return UP_TYPE.TYPE_EVOLVE;
                }
            }
        }

        var maxLevel = getHeroMaxLevel(displayId, quality);
        if (maxLevel > 0 && level >= maxLevel) {
            return UP_TYPE.TYPE_FULL;
        }

        return UP_TYPE.TYPE_LEVEL;
    }

    // ═══════════════════════════════════════════════════════════
    //  EMPTY TOTAL COST TEMPLATE (7 sections, all empty _items)
    // ═══════════════════════════════════════════════════════════

    function buildEmptyTotalCost() {
        return {
            _wakeUp:    { _items: {} },
            _earring:   { _items: {} },
            _levelUp:   { _items: {} },
            _evolve:    { _items: {} },
            _skill:     { _items: {} },
            _qigong:    { _items: {} },
            _heroBreak: { _items: {} }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hero/autoLevelUp
    // ═══════════════════════════════════════════════════════════

    /**
     * handleAutoLevelUp(request, callback)
     *
     * Levels up a hero, deducts costs, returns updated stats.
     * All values are FLOAT (no Math.floor on stats).
     *
     * _changeInfo._items = ABSOLUTE balances after deduction (NOT negative deltas!)
     *   Client does: setItem(id, num) → this.items[id] = num
     *
     * _totalCost = 7 sections, _levelUp has the actual cost as OBJECT.
     * _items format: { "102": {_id:102, _num:93}, ... } (OBJECT, not array)
     */
    function handleAutoLevelUp(request, callback) {
        var userId = request.userId;
        var heroId = request.heroId;
        var times = Number(request.times) || 1;

        log.info('HANDLER', 'hero/autoLevelUp processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['heroId', heroId || '-'],
            ['times', String(times)],
            ['version', request.version || '-']
        ]);

        try {
            if (!userId || !heroId) {
                log.warn('HANDLER', 'hero/autoLevelUp — missing userId or heroId');
                callback({});
                return;
            }

            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('HANDLER', 'hero/autoLevelUp — user data not found');
                callback({});
                return;
            }

            var found = findHeroInStorage(savedData, heroId);
            if (!found || !found.hero) {
                log.warn('HANDLER', 'hero/autoLevelUp — hero not found: ' + heroId);
                callback({});
                return;
            }

            var hero = found.hero;
            var displayId = hero._heroDisplayId || Number(hero._heroId);
            var hc = getHeroConfig(displayId);
            var quality = (hc && hc.quality) || 'purple';
            var baseAttr = hero._heroBaseAttr || {};
            var currentLevel = Number(baseAttr._level) || 1;
            var evolveLevel = Number(baseAttr._evolveLevel) || 0;
            var starLevel = Number(hero._heroStar) || 0;

            log.details('hero_state', [
                ['displayId', String(displayId)],
                ['quality', quality],
                ['currentLevel', String(currentLevel)],
                ['evolveLevel', String(evolveLevel)],
                ['starLevel', String(starLevel)]
            ]);

            // Check max level
            var maxLevel = getHeroMaxLevel(displayId, quality);
            if (maxLevel > 0 && currentLevel >= maxLevel) {
                log.info('HANDLER', 'hero/autoLevelUp — already at max level: ' + maxLevel);
                var maxStats = computeRawBaseStats(displayId, currentLevel, evolveLevel, starLevel);
                var maxEquipFlat = getHeroEquippedFlatStats(savedData, heroId);
                callback({
                    type: 'hero', action: 'autoLevelUp', userId: userId, heroId: heroId,
                    version: '1.0', times: times,
                    _heroLevel: currentLevel,
                    _totalAttr: { _items: buildTotalAttrItems(maxStats, maxEquipFlat) },
                    _baseAttr: { _items: buildBaseAttrItems(maxStats) },
                    _totalCost: buildEmptyTotalCost(),
                    _changeInfo: { _items: buildChangeInfo(savedData) },
                    _linkHeroesTotalAttr: {},
                    _linkHeroesBasicAttr: {}
                });
                return;
            }

            // Calculate max times (respecting max level and evolve blocking)
            var effectiveMaxLevel = maxLevel > 0 ? maxLevel : 9999;
            var targetTimes = Math.min(times, effectiveMaxLevel - currentLevel);

            for (var checkLevel = currentLevel; checkLevel < currentLevel + targetTimes; checkLevel++) {
                var evEntries = getHeroEvolve(displayId) || [];
                for (var ei = 0; ei < evEntries.length; ei++) {
                    var ev = evEntries[ei];
                    if (Number(ev.level) === checkLevel && checkLevel > evolveLevel) {
                        targetTimes = Math.min(targetTimes, checkLevel - currentLevel);
                        break;
                    }
                }
                if (targetTimes <= 0) break;
            }

            if (targetTimes <= 0) {
                log.info('HANDLER', 'hero/autoLevelUp — blocked by evolve/star at level ' + currentLevel);
                var blockedStats = computeRawBaseStats(displayId, currentLevel, evolveLevel, starLevel);
                var blockedEquipFlat = getHeroEquippedFlatStats(savedData, heroId);
                callback({
                    type: 'hero', action: 'autoLevelUp', userId: userId, heroId: heroId,
                    version: '1.0', times: times,
                    _heroLevel: currentLevel,
                    _totalAttr: { _items: buildTotalAttrItems(blockedStats, blockedEquipFlat) },
                    _baseAttr: { _items: buildBaseAttrItems(blockedStats) },
                    _totalCost: buildEmptyTotalCost(),
                    _changeInfo: { _items: buildChangeInfo(savedData) },
                    _linkHeroesTotalAttr: {},
                    _linkHeroesBasicAttr: {}
                });
                return;
            }

            // Get current balances BEFORE deduction (for _changeInfo)
            var currentExpBalance = getItemNum(savedData, ITEM_IDS.EXPERIENCECAPSULEID);
            var currentGoldBalance = getItemNum(savedData, ITEM_IDS.GOLDID);

            // Calculate cost per level, check resources
            var qualityIndex = { white: 1, green: 2, blue: 3, purple: 4, orange: 5, flickerOrange: 6, superOrange: 7 };
            var qIndex = qualityIndex[quality] || 4;
            var levelUpMulTable = getHeroLevelUpMul();

            var actualTimes = 0;
            var totalExpCost = 0;
            var totalGoldCost = 0;

            for (var t = 0; t < targetTimes; t++) {
                var lvl = currentLevel + t;
                var costEntry = getHeroLevelUpCost(quality, lvl);
                if (!costEntry) break;

                var singleExp = Number(costEntry.num1) || 0;
                var singleGold = Number(costEntry.num2) || 0;

                // Apply heroLevelUpMul multiplier
                if (levelUpMulTable) {
                    var mulEntries = levelUpMulTable[String(qIndex)];
                    if (Array.isArray(mulEntries)) {
                        for (var mi = 0; mi < mulEntries.length; mi++) {
                            var mul = mulEntries[mi];
                            if (Number(mul.evolveLevel) === evolveLevel) {
                                var mulVal = Number(mul.hpMul) || 1;
                                singleExp = Math.floor(singleExp * mulVal);
                                singleGold = Math.floor(singleGold * mulVal);
                                break;
                            }
                        }
                    }
                }

                // Check if player can afford
                if (totalExpCost + singleExp > currentExpBalance) break;
                if (totalGoldCost + singleGold > currentGoldBalance) break;

                totalExpCost += singleExp;
                totalGoldCost += singleGold;
                actualTimes++;
            }

            if (actualTimes === 0) {
                log.info('HANDLER', 'hero/autoLevelUp — not enough resources');
                var noResStats = computeRawBaseStats(displayId, currentLevel, evolveLevel, starLevel);
                var noResEquipFlat = getHeroEquippedFlatStats(savedData, heroId);
                callback({
                    type: 'hero', action: 'autoLevelUp', userId: userId, heroId: heroId,
                    version: '1.0', times: times,
                    _heroLevel: currentLevel,
                    _totalAttr: { _items: buildTotalAttrItems(noResStats, noResEquipFlat) },
                    _baseAttr: { _items: buildBaseAttrItems(noResStats) },
                    _totalCost: buildEmptyTotalCost(),
                    _changeInfo: { _items: buildChangeInfo(savedData) },
                    _linkHeroesTotalAttr: {},
                    _linkHeroesBasicAttr: {}
                });
                return;
            }

            // Deduct costs
            deductItem(savedData, ITEM_IDS.EXPERIENCECAPSULEID, totalExpCost);
            deductItem(savedData, ITEM_IDS.GOLDID, totalGoldCost);

            // Update hero level
            var newLevel = currentLevel + actualTimes;
            baseAttr._level = newLevel;

            // ── ACCUMULATE _totalCost ──
            // Simpan resource yg sudah dihabiskan ke hero data agar bisa
            // direfund nantinya (mis: hero/reborn handler).
            if (!found.hero._totalCost) {
                found.hero._totalCost = {
                    _wakeUp: { _items: {} },
                    _earring: { _items: {} },
                    _levelUp: { _items: {} },
                    _evolve: { _items: {} },
                    _skill: { _items: {} },
                    _qigong: { _items: {} },
                    _heroBreak: { _items: {} }
                };
            }
            // Accumulate levelUp costs
            if (totalExpCost > 0 || totalGoldCost > 0) {
                var lvlUp = found.hero._totalCost._levelUp;
                if (!lvlUp) {
                    found.hero._totalCost._levelUp = { _items: {} };
                    lvlUp = found.hero._totalCost._levelUp;
                }
                if (!lvlUp._items) lvlUp._items = {};
                if (totalExpCost > 0) {
                    var expKey = String(ITEM_IDS.EXPERIENCECAPSULEID);
                    var expOld = lvlUp._items[expKey] ? Number(lvlUp._items[expKey]._num) : 0;
                    lvlUp._items[expKey] = { _id: ITEM_IDS.EXPERIENCECAPSULEID, _num: expOld + totalExpCost };
                }
                if (totalGoldCost > 0) {
                    var goldKey = String(ITEM_IDS.GOLDID);
                    var goldOld = lvlUp._items[goldKey] ? Number(lvlUp._items[goldKey]._num) : 0;
                    lvlUp._items[goldKey] = { _id: ITEM_IDS.GOLDID, _num: goldOld + totalGoldCost };
                }
            }

            // Save
            db._set(storageKey, savedData);

            // ── Check & advance main task (upGradeHeroLevel) ──
            // Pola sama dengan checkBattleResult.js STEP 7e
            try {
                var cmt = savedData.curMainTask;
                var canCheck = cmt && Array.isArray(cmt) && cmt.length > 0 && cmt[0]._state === 1;

                if (canCheck) {
                    var tcCfg = loadJsonSync('task');
                    var tcDef = tcCfg && tcCfg[cmt[0]._id];

                    if (tcDef && tcDef.taskType === 'upGradeHeroLevel') {
                        var tcNeedCount = Number(tcDef.taskPara1) || 0;
                        var tcNeedLevel = Number(tcDef.taskPara2) || 0;
                        var tcHeroes = savedData.heros && savedData.heros._heros;
                        var tcCount = 0;

                        if (tcHeroes) {
                            for (var tcK in tcHeroes) {
                                if (!tcHeroes.hasOwnProperty(tcK)) continue;
                                var tcH = tcHeroes[tcK];
                                var tcLvl = Number((tcH._heroBaseAttr && tcH._heroBaseAttr._level) || 0);
                                if (tcLvl >= tcNeedLevel) tcCount++;
                            }
                        }

                        if (tcCount >= tcNeedCount) {
                            cmt[0]._state = 2;
                            log.info('TASK', 'Task ' + cmt[0]._id + ' DOING → COMPLETE (upGradeHeroLevel)');
                            log.details('taskMatch', [
                                ['taskId', String(cmt[0]._id)],
                                ['needCount', String(tcNeedCount)],
                                ['needLevel', String(tcNeedLevel)],
                                ['heroCount', String(tcCount)]
                            ]);

                            if (typeof MainServer.notify === 'function') {
                                MainServer.notify({
                                    action: 'mainTaskChange',
                                    _curMainTask: [{ _id: cmt[0]._id, _state: 2 }]
                                });
                                log.info('TASK', 'Pushed mainTaskChange state=2');
                            }
                        } else {
                            log.info('TASK', 'upGradeHeroLevel not yet — have ' + tcCount + '/' + tcNeedCount + ' heroes at level ' + tcNeedLevel);
                        }
                    }
                }
            } catch (tcErr) {
                log.warn('TASK', 'upGradeHeroLevel check error: ' + (tcErr.message || tcErr));
            }

            // Compute new stats
            var newStats = computeRawBaseStats(displayId, newLevel, evolveLevel, starLevel);

            // Get hero's equipped items flat stats
            var equipFlatStats = getHeroEquippedFlatStats(savedData, heroId);

            log.info('HANDLER', 'hero/autoLevelUp success');
            log.details('result', [
                ['heroId', heroId],
                ['oldLevel', String(currentLevel)],
                ['newLevel', String(newLevel)],
                ['actualTimes', String(actualTimes)],
                ['expCost', String(totalExpCost)],
                ['goldCost', String(totalGoldCost)],
                ['expBalance', String(currentExpBalance - totalExpCost)],
                ['goldBalance', String(currentGoldBalance - totalGoldCost)]
            ]);

            // Build _totalCost._levelUp._items as OBJECT
            var levelUpCostItems = {};
            if (totalExpCost > 0) {
                levelUpCostItems[String(ITEM_IDS.EXPERIENCECAPSULEID)] = {
                    _id: ITEM_IDS.EXPERIENCECAPSULEID, _num: totalExpCost
                };
            }
            if (totalGoldCost > 0) {
                levelUpCostItems[String(ITEM_IDS.GOLDID)] = {
                    _id: ITEM_IDS.GOLDID, _num: totalGoldCost
                };
            }

            var totalCost = buildEmptyTotalCost();
            totalCost._levelUp = { _items: levelUpCostItems };

            // Build response
            var response = {
                type: 'hero',
                action: 'autoLevelUp',
                userId: userId,
                heroId: heroId,
                version: '1.0',
                times: times,
                _heroLevel: newLevel,
                _totalAttr: { _items: buildTotalAttrItems(newStats, equipFlatStats) },
                _baseAttr: { _items: buildBaseAttrItems(newStats) },
                _totalCost: totalCost,
                _changeInfo: { _items: buildChangeInfo(savedData) },
                _linkHeroesTotalAttr: {},
                _linkHeroesBasicAttr: {}
            };

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'hero/autoLevelUp UNCAUGHT ERROR', err);
            callback({});
        }
    }

    /**
     * buildChangeInfo(savedData) — Build _changeInfo._items as OBJECT.
     *
     * Returns ABSOLUTE balances of exp capsule (131) and gold (102).
     * Client: setItem(id, num) → items[id] = num
     *
     * Format: { "102": {_id:102, _num:165398}, "131": {_id:131, _num:29778} }
     */
    function buildChangeInfo(savedData) {
        var items = {};
        var exp = getItemNum(savedData, ITEM_IDS.EXPERIENCECAPSULEID);
        var gold = getItemNum(savedData, ITEM_IDS.GOLDID);
        items[String(ITEM_IDS.EXPERIENCECAPSULEID)] = { _id: ITEM_IDS.EXPERIENCECAPSULEID, _num: exp };
        items[String(ITEM_IDS.GOLDID)] = { _id: ITEM_IDS.GOLDID, _num: gold };
        return items;
    }

    // ═══════════════════════════════════════════════════════════
    // REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'autoLevelUp', handleAutoLevelUp);

    window.MainServer = MainServer;
})();
