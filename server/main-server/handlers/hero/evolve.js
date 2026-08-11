/**
 * handlers/hero/evolve.js — Hero Evolve Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: hero/evolve
 * ============================================================
 *
 * Client call (main.min.js L121131-121136):
 *   ts.processHandler({
 *     type: 'hero',
 *     action: 'evolve',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     heroId: t.getHeroId(),
 *     version: '1.0'
 *   }, callback(response))
 *
 * Dipanggil saat:
 *   - Player menekan tombol "Evolve" di window HeroEvolve (L121120)
 *   - BUKAN limit evolve (itu handler lain)
 *   - BUKAN super skill evolve (itu superSkill/evolveSuperSkill)
 *
 * Response callback (main.min.js L121137-121151):
 *   1. Cek e._openType:
 *      - OPEN_TIME_BONUS → log saja
 *      - OPEN_TIPS → client cek item count lokal, popup "item tidak cukup"
 *   2. Cek e._changeInfo → berarti SUKSES:
 *      a. HerosManager.getInstance().levelUpCallBack(e, true)
 *         → setHeroLevelUpDataChange(e, hero):
 *           e._evolveLevel → hero.heroBaseAttr.evolveLevel = e._evolveLevel
 *           → setHeroPassiveSkillState(hero)
 *           → setHeroProactiveSkillState(hero)
 *         → setTotalAttrs(e, hero):
 *           - setBaseAttr(e._baseAttr, hero) → reads _baseAttr._items OBJECT
 *           - reads e._heroTotalAttr._items → hero.totalAttr
 *           - id==21 → heroBaseAttr.power = Math.floor(_num)
 *           - setTotalCost(e._totalCost, hero) → deserialize 7 sections
 *      b. ItemsCommonSingleton.getInstance().resetTtemsCallBack(e)
 *         → reads e._changeInfo._items → setItem(id, num) → items[id] = num
 *         → _num = ABSOLUTE balance (NOT negative delta!)
 *      c. ts.closeWindow('HeroEvolve')
 *      d. t.getOnUpdate()()
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 * {
 *   heroId: 'abc123',
 *   _evolveLevel: 20,
 *   _baseAttr:        { _items: { "0":{_id:0,_num:992.0}, ... } },   // 35 items, OBJECT
 *   _heroTotalAttr:   { _items: { "0":{_id:0,_num:396.8}, ... } },   // 42 items, OBJECT
 *   _totalCost: {
 *     _wakeUp:    { _items: {} },
 *     _earring:   { _items: {} },
 *     _levelUp:   { _items: {} },
 *     _evolve:    { _items: { "132":{_id:132,_num:192}, "102":{_id:102,_num:2000} } },
 *     _skill:     { _items: {} },
 *     _qigong:    { _items: {} },
 *     _heroBreak: { _items: {} }
 *   },
 *   _changeInfo:  { _items: { "132":{_id:132,_num:47820}, "102":{_id:102,_num:165398} } },
 *   _linkHeroesTotalAttr: {},
 *   _linkHeroesBasicAttr: {}
 * }
 *
 * GAGAL (item tidak cukup):
 *   { _openType: 2 }   // TimeLimitBonus.OPEN_TIPS
 *
 * ============================================================
 * JSON CONFIG YANG DIPAKAI:
 *   heroEvolve.json       ✅ evolve entries (level, cost, stats bonus)
 *   heroEvolveRed.json    ✅ red evolve entries (level 200+, costID3, needStarSelf)
 *   hero.json             ✅ quality, heroType, talent, balancePower, speed, hit, dll
 *   heroLevelAttr.json    ✅ level → {hp, attack, armor}
 *   heroTypeParam.json    ✅ heroType → {hpParam, attackParam, armorParam, ...Bais}
 *   heroQualityParam.json ✅ quality → {hpParam, attackParam, armorParam}
 *   heroPower.json        ✅ per stat per heroType: powerParam
 *   heroQualityPower.json ✅ quality → {powerParam}
 *   heroWakeUp.json       ✅ star-up bonuses (talent, hp, attack, armor, speed)
 *   equip.json            ✅ equip flat stats
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

    function getHeroEvolveRed(heroId) {
        var evr = loadJsonSync('heroEvolveRed');
        return evr ? evr[String(heroId)] : null;
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
    //  EQUIP FLAT STAT HELPERS (same logic as autoLevelUp.js)
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
    //  STAT COMPUTATION (PLAYER formula — same as autoLevelUp.js)
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

        // Evolve bonuses — CUMULATIVE: all entries with level <= evolveLevel
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

        // WakeUp/Star bonuses — CUMULATIVE: all entries with star <= starLevel
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
    //  _items OBJECT BUILDER (same format as autoLevelUp.js)
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
    //  POWER COMPUTATION (same as autoLevelUp.js)
    // ═══════════════════════════════════════════════════════════

    var ATK_BASE_WEIGHTS = {
        'critical':       20, 'criticalSingle': 20, 'hit': 20,
        'skill':          15, 'body': 15, 'block': 15,
        'armor':          15, 'armorS': 15, 'armorDamage': 15,
        'bodyDamage':     15, 'dodge': 15, 'strength': 15, 'dot': 15
    };

    var POWER_BASE_WEIGHTS = {
        hp:          'balancePower',
        attack:      'atkBase',
        armor:       1,
        speed:       0,
        extraArmor:  1,
        orghp:       0,
        talent:      0,
        power:       0,
        hpPercent:      1,
        attackPercent:  1,
        armorPercent:   1,
        speedPercent:   0,
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
        healPlus:         1,
        healerPlus:       1,
        shielderPlus:     1,
        damageUp:         1,
        damageDown:       1,
        superDamage:      1,
        superDamageResist:      1,
        dragonBallWarDamageUp: 1
    };

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

        var typeWeights = getHeroPowerForType(heroType);

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

        var heroQualityPowerTable = getHeroQualityPower();
        if (heroQualityPowerTable && heroQualityPowerTable[quality]) {
            var qp = Number(heroQualityPowerTable[quality].powerParam) || 1;
            power *= qp;
        }

        return Math.floor(power);
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM HELPERS
    // ═══════════════════════════════════════════════════════════

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
    //  EVOLVE HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Get merged evolve entries (normal + red) for a hero.
     * Same logic as client: HeroCommon.getlocalHeroEvolve (L53305-53309)
     *   heroEvolve[displayId].concat(heroEvolveRed[displayId])
     */
    function getMergedEvolveEntries(heroDisplayId) {
        var normal = getHeroEvolve(heroDisplayId) || [];
        var red = getHeroEvolveRed(heroDisplayId) || [];
        if (!Array.isArray(normal)) normal = [];
        if (!Array.isArray(red)) red = [];
        return normal.concat(red);
    }

    /**
     * Find the NEXT evolve entry to apply.
     * Returns the entry with the LOWEST level > currentEvolveLevel.
     * Returns null if already at max evolve.
     */
    function getNextEvolveEntry(heroDisplayId, currentEvolveLevel) {
        var all = getMergedEvolveEntries(heroDisplayId);
        var next = null;
        for (var i = 0; i < all.length; i++) {
            var ev = all[i];
            var evLevel = Number(ev.level) || 0;
            // Skip level 0 (initial state, bonus all 0, cost all 0)
            if (evLevel <= 0) continue;
            // Must be the NEXT evolve level above current
            if (evLevel > currentEvolveLevel) {
                if (next === null || evLevel < (Number(next.level) || 0)) {
                    next = ev;
                }
            }
        }
        return next;
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

    /**
     * buildChangeInfo(savedData, deductedItems)
     * Returns ABSOLUTE balances of items that changed, as OBJECT.
     * Client: setItem(id, num) → items[id] = num
     *
     * @param {Array} deductedItems - [{id, cost}, ...] items that were deducted
     */
    function buildChangeInfo(savedData, deductedItems) {
        var items = {};
        for (var i = 0; i < deductedItems.length; i++) {
            var di = deductedItems[i];
            var balance = getItemNum(savedData, di.id);
            items[String(di.id)] = { _id: di.id, _num: balance };
        }
        return items;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hero/evolve
    // ═══════════════════════════════════════════════════════════

    /**
     * handleEvolve(request, callback)
     *
     * Evolves a hero: deducts item costs, increments evolveLevel,
     * returns updated stats using PLAYER formula.
     *
     * _changeInfo._items = ABSOLUTE balances after deduction (NOT negative delta!)
     *   Client does: setItem(id, num) → this.items[id] = num
     */
    function handleEvolve(request, callback) {
        var userId = request.userId;
        var heroId = request.heroId;

        log.info('HANDLER', 'hero/evolve processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['heroId', heroId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            if (!userId || !heroId) {
                log.warn('HANDLER', 'hero/evolve — missing userId or heroId');
                callback({});
                return;
            }

            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('HANDLER', 'hero/evolve — user data not found');
                callback({});
                return;
            }

            var found = findHeroInStorage(savedData, heroId);
            if (!found || !found.hero) {
                log.warn('HANDLER', 'hero/evolve — hero not found: ' + heroId);
                callback({});
                return;
            }

            var hero = found.hero;
            var displayId = hero._heroDisplayId || Number(hero._heroId);
            var hc = getHeroConfig(displayId);
            var baseAttr = hero._heroBaseAttr || {};
            var currentLevel = Number(baseAttr._level) || 1;
            var currentEvolveLevel = Number(baseAttr._evolveLevel) || 0;
            var currentStar = Number(hero._heroStar) || 0;

            log.details('hero_state', [
                ['displayId', String(displayId)],
                ['currentLevel', String(currentLevel)],
                ['currentEvolveLevel', String(currentEvolveLevel)],
                ['currentStar', String(currentStar)]
            ]);

            // ── STEP 1: Find next evolve entry ──
            var nextEntry = getNextEvolveEntry(displayId, currentEvolveLevel);
            if (!nextEntry) {
                log.info('HANDLER', 'hero/evolve — already at max evolve level: ' + currentEvolveLevel);
                callback({});
                return;
            }

            var newEvolveLevel = Number(nextEntry.level) || 0;

            log.details('evolve_entry', [
                ['newEvolveLevel', String(newEvolveLevel)],
                ['costID1', String(nextEntry.costID1)],
                ['num1', String(nextEntry.num1)],
                ['costID2', String(nextEntry.costID2)],
                ['num2', String(nextEntry.num2)],
                ['costID3', String(nextEntry.costID3 || '-')],
                ['num3', String(nextEntry.num3 || '-')],
                ['hpBonus', String(nextEntry.hp)],
                ['atkBonus', String(nextEntry.attack)],
                ['armBonus', String(nextEntry.armor)],
                ['spdBonus', String(nextEntry.speed)]
            ]);

            // ── STEP 2: Validate prerequisites ──
            // needLevel: hero must be at this level
            var needLevel = Number(nextEntry.needLevel) || 0;
            if (needLevel > 0 && currentLevel < needLevel) {
                log.warn('HANDLER', 'hero/evolve — hero level ' + currentLevel + ' < needLevel ' + needLevel);
                callback({});
                return;
            }

            // needStarSelf: for red evolve entries
            var needStarSelf = Number(nextEntry.needStarSelf) || 0;
            if (needStarSelf > 0 && currentStar < needStarSelf) {
                log.warn('HANDLER', 'hero/evolve — hero star ' + currentStar + ' < needStarSelf ' + needStarSelf);
                callback({});
                return;
            }

            // ── STEP 3: Validate & deduct item costs ──
            var costID1 = Number(nextEntry.costID1) || 0;
            var num1 = Number(nextEntry.num1) || 0;
            var costID2 = Number(nextEntry.costID2) || 0;
            var num2 = Number(nextEntry.num2) || 0;
            var costID3 = Number(nextEntry.costID3) || 0;
            var num3 = Number(nextEntry.num3) || 0;

            // Check balances
            var bal1 = getItemNum(savedData, costID1);
            var bal2 = getItemNum(savedData, costID2);
            var bal3 = costID3 ? getItemNum(savedData, costID3) : 0;

            var notEnough = false;
            if (num1 > 0 && bal1 < num1) notEnough = true;
            if (num2 > 0 && bal2 < num2) notEnough = true;
            if (num3 > 0 && bal3 < num3) notEnough = true;

            if (notEnough) {
                log.warn('HANDLER', 'hero/evolve — not enough resources');
                log.details('cost_check', [
                    ['costID1/' + costID1, bal1 + '/' + num1],
                    ['costID2/' + costID2, bal2 + '/' + num2],
                    ['costID3/' + costID3, bal3 + '/' + num3]
                ]);
                // TimeLimitBonus.OPEN_TIPS = 2
                callback({ _openType: 2 });
                return;
            }

            // Deduct costs
            var deductedItems = [];
            if (num1 > 0 && costID1 > 0) {
                deductItem(savedData, costID1, num1);
                deductedItems.push({ id: costID1, cost: num1 });
            }
            if (num2 > 0 && costID2 > 0) {
                deductItem(savedData, costID2, num2);
                deductedItems.push({ id: costID2, cost: num2 });
            }
            if (num3 > 0 && costID3 > 0) {
                deductItem(savedData, costID3, num3);
                deductedItems.push({ id: costID3, cost: num3 });
            }

            // ── STEP 4: Update hero evolveLevel ──
            baseAttr._evolveLevel = newEvolveLevel;

            // ── STEP 4b: Accumulate _totalCost._evolve ──
            // Simpan resource evolve ke hero data agar bisa direfund nantinya.
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
            var evSection = found.hero._totalCost._evolve;
            if (!evSection) {
                found.hero._totalCost._evolve = { _items: {} };
                evSection = found.hero._totalCost._evolve;
            }
            if (!evSection._items) evSection._items = {};
            if (num1 > 0 && costID1 > 0) {
                var key1 = String(costID1);
                var old1 = evSection._items[key1] ? Number(evSection._items[key1]._num) : 0;
                evSection._items[key1] = { _id: costID1, _num: old1 + num1 };
            }
            if (num2 > 0 && costID2 > 0) {
                var key2 = String(costID2);
                var old2 = evSection._items[key2] ? Number(evSection._items[key2]._num) : 0;
                evSection._items[key2] = { _id: costID2, _num: old2 + num2 };
            }
            if (num3 > 0 && costID3 > 0) {
                var key3 = String(costID3);
                var old3 = evSection._items[key3] ? Number(evSection._items[key3]._num) : 0;
                evSection._items[key3] = { _id: costID3, _num: old3 + num3 };
            }

            // ── STEP 5: Save to DB ──
            db._set(storageKey, savedData);

            // ── STEP 6: Recompute stats (PLAYER formula, same as autoLevelUp) ──
            var newStats = computeRawBaseStats(displayId, currentLevel, newEvolveLevel, currentStar);
            var equipFlatStats = getHeroEquippedFlatStats(savedData, heroId);

            log.info('HANDLER', 'hero/evolve success');
            log.details('result', [
                ['heroId', heroId],
                ['displayId', String(displayId)],
                ['oldEvolve', String(currentEvolveLevel)],
                ['newEvolve', String(newEvolveLevel)],
                ['rawHp', String(newStats ? newStats.hp : 'null')],
                ['rawAtk', String(newStats ? newStats.attack : 'null')],
                ['rawArm', String(newStats ? newStats.armor : 'null')]
            ]);

            // ── STEP 7: Build evolve cost items (OBJECT format for _totalCost._evolve) ──
            var evolveCostItems = {};
            if (num1 > 0 && costID1 > 0) {
                evolveCostItems[String(costID1)] = { _id: costID1, _num: num1 };
            }
            if (num2 > 0 && costID2 > 0) {
                evolveCostItems[String(costID2)] = { _id: costID2, _num: num2 };
            }
            if (num3 > 0 && costID3 > 0) {
                evolveCostItems[String(costID3)] = { _id: costID3, _num: num3 };
            }

            var totalCost = buildEmptyTotalCost();
            totalCost._evolve = { _items: evolveCostItems };

            // ── STEP 8: Build response ──
            var response = {
                heroId: heroId,
                _evolveLevel: newEvolveLevel,
                _baseAttr: { _items: buildBaseAttrItems(newStats) },
                _heroTotalAttr: { _items: buildTotalAttrItems(newStats, equipFlatStats) },
                _totalCost: totalCost,
                _changeInfo: { _items: buildChangeInfo(savedData, deductedItems) },
                _linkHeroesTotalAttr: {},
                _linkHeroesBasicAttr: {}
            };

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'hero/evolve UNCAUGHT ERROR', err);
            callback({});
        }
    }

    // ═══════════════════════════════════════════════════════════
    // REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'evolve', handleEvolve);

    window.MainServer = MainServer;
})();