/**
 * handlers/equip/wearAuto.js — One-Step Wear (Auto Equip Best Gear)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════
 * REFERENCE: main.min.js (client-side), HAR decompressed, equip.json
 * ═══════════════════════════════════════════════════════════════════
 *
 * Client call (main.min.js):
 *   ts.processHandler({
 *     type: "equip", action: "wearAuto",
 *     userId: userId, heroId: heroId,
 *     equipInfo: { "1": "3001", "2": "3002", "3": "3003", "4": "3004" },
 *     weaponId: "",
 *     version: "1.0"
 *   }, callback)
 *
 * Client response processing (3 callbacks):
 *   1. EquipInfoManager.oneSteapWear(response)
 *      → SetEquipDataToModel(response._equipItem) → builds EquipInfoModel
 *      → updates equipDataList[heroId], WeaponDataArray
 *   2. HerosManager.setTotalAttrsByHeroId(response, response.heroId)
 *      → setTotalAttrs(resp, heroData)
 *      → if _baseAttr: setBaseAttr (NOT sent by wearAuto)
 *      → _totalAttr._items → heroData.totalAttr[id] = {id, num}
 *      → id==21 → heroBaseAttr.power = Math.floor(_num)
 *      → if _linkHeroesTotalAttr: setTotalAttrsByHeroIdNotChange for linked heroes
 *   3. ItemsCommonSingleton.resetTtemsCallBack(response)
 *      → _changeInfo._items → setItem(id, num)  [ABSOLUTE balance]
 *      → refreshNodeResource()
 *
 * ═══════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (11 fields — verified from 5 HAR entries)
 * ═══════════════════════════════════════════════════════════════════
 *
 * {
 *   type: "equip", action: "wearAuto",
 *   userId: "...", heroId: "...",
 *   equipInfo: {"1":"3001","3":"3003"},   ← echo of request (only slots being equipped)
 *   weaponId: "",                          ← echo of request
 *   version: "1.0",
 *   _totalAttr: { _items: { "0":{_id:0,_num:5650}, "1":{_id:1,_num:435}, ... } },
 *   _changeInfo: { _items: { "3001":{_id:3001,_num:0}, ... } },
 *   _equipItem: {
 *     _suitItems: [{ _id:"3001", _pos:1, _version:"201906201330" }, ...],
 *     _earrings: { _id:0, _level:0, _attrs:{_items:{},_version:""} },
 *     _suitAttrs: [],                              ← empty for green (no suit bonus)
 *     _equipAttrs: [{ _id:1,_num:270 }, { _id:26,_num:1430 }, { _id:0,_num:4906 }],
 *     _weaponState: 0
 *   },
 *   _linkHeroesTotalAttr: {}   ← always empty object for single-hero equip
 * }
 *
 * ═══════════════════════════════════════════════════════════════════
 * KEY CONCEPTS
 * ═══════════════════════════════════════════════════════════════════
 *
 * 1. _totalAttr = BASE hero stats (polosan) + FLAT equip stats (ADDED, not merged)
 *    - Base stats: computed from hero.json + heroLevelAttr.json + heroTypeParam.json
 *    - Talent: applied to base hp/attack ONLY, THEN equip flat stats added
 *    - totalHp = (rawBaseHp * talent) + equipFlatHp
 *    - totalAtk = (rawBaseAtk * talent) + equipFlatAtk
 *    - totalArmor = rawBaseArmor + equipFlatArmor (no talent on armor)
 *
 * 2. _equipAttrs = SUM of flat equip stats ONLY (no base stats)
 *    - [{_id: abilityId, _num: summedValue}, ...] — only non-zero entries
 *
 * 3. _changeInfo._items = ABSOLUTE balance after transaction
 *    - Key = string item ID, _id = number, _num = absolute balance
 *
 * 4. _suitItems._id = STRING (in wearAuto; INTEGER in wear/takeOff)
 *
 * 5. Power = floor( sum(stat_value * baseWeight * heroPower.powerParam) * qualityMult )
 *    - baseWeight: hp→balancePower, atk→ATK_BASE_WEIGHTS[heroType], armor→1, extraArmor→1, etc.
 *    - heroPower.json: per-type per-stat powerParam modifier
 *    - qualityMult: from heroQualityPower.json (all=1 currently)
 *    - Uses TOTAL stats (base + equip) for computation
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.equip) {
        MainServer.handlers.equip = {};
    }

    // ═══════════════════════════════════════════════════════════════
    //  RESOURCE CACHE & CONFIG LOADER
    // ═══════════════════════════════════════════════════════════════

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
            log.warn('WEARAUTO', 'Failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getEquipConfig(equipId) {
        var eq = loadJsonSync('equip');
        return eq ? eq[String(equipId)] : null;
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

    function getEquipSuitBonus(equipId) {
        var eq = getEquipConfig(equipId);
        if (!eq) return null;
        var suitId = eq.belongToSuit;
        if (!suitId) return null;
        // Load suit config to get bonus stats
        var suits = loadJsonSync('equipSuit');
        if (!suits) return null;
        return suits[String(suitId)] || null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  FULL ATTRIBUTE ID MAPPING (0-41)
    // ═══════════════════════════════════════════════════════════════

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
        /* 33*/ 'bloodDamage',
        /* 34*/ 'normalAttack',
        /* 35*/ 'blockThrough',
        /* 36*/ 'criticalDamageResist',
        /* 37*/ 'reserved37',
        /* 38*/ 'reserved38',
        /* 39*/ 'reserved39',
        /* 40*/ 'reserved40',
        /* 41*/ 'zpowerLevel'
    ];

    // ═══════════════════════════════════════════════════════════════
    //  HERO BASE STAT COMPUTATION (verified from getAttrs HAR analysis)
    // ═══════════════════════════════════════════════════════════════

    /**
     * computeRawBaseStats(heroDisplayId, level, evolveLevel, starLevel)
     * Returns object with all stat names as FLOAT (no Math.floor).
     */
    function computeRawBaseStats(heroDisplayId, level, evolveLevel, starLevel) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.warn('WEARAUTO', 'Hero config not found: ' + heroDisplayId);
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
            damageUp: 0,
            talent: Number(hc.talent) || 0,
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

        // Base stats: level * type * quality * balance
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

    // ═══════════════════════════════════════════════════════════════
    //  POWER COMPUTATION
    //  Formula: power = floor( sum(stat * baseWeight * heroPower.pp) * qualityMult )
    // ═══════════════════════════════════════════════════════════════

    var ATK_BASE_WEIGHTS = {
        'critical': 20, 'criticalSingle': 20, 'hit': 20,
        'skill': 15, 'body': 15, 'block': 15,
        'armor': 15, 'armorS': 15, 'armorDamage': 15,
        'bodyDamage': 15, 'dodge': 15, 'strength': 15, 'dot': 15
    };

    var POWER_BASE_WEIGHTS = {
        hp: 'balancePower', attack: 'atkBase', armor: 1,
        speed: 0, extraArmor: 1, orghp: 0, talent: 0, power: 0,
        hpPercent: 1, attackPercent: 1, armorPercent: 1, speedPercent: 0,
        hit: 1, dodge: 1, block: 1, blockEffect: 1,
        skillDamage: 1, critical: 1, criticalResist: 1, criticalDamage: 1,
        armorBreak: 1, damageReduce: 1, controlResist: 1, trueDamage: 1,
        healPlus: 1, healerPlus: 1, shielderPlus: 1,
        damageUp: 1, damageDown: 1, superDamage: 1,
        superDamageResist: 1, dragonBallWarDamageUp: 1,
        bloodDamage: 1, normalAttack: 1, blockThrough: 1,
        criticalDamageResist: 1
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
                    if (!_heroPowerCache[ht]) _heroPowerCache[ht] = {};
                    _heroPowerCache[ht][entry.attName] = Number(entry.powerParam) || 0;
                }
            }
        }
        return _heroPowerCache[heroType] || null;
    }

    /**
     * computePower(displayStats, rawStats)
     * @param {Object} displayStats - Map of statName → display value (base + equip, talent applied)
     * @param {Object} rawStats - Raw base stats (for heroType, quality, balancePower, talent)
     * @returns {number} Floored power value
     */
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
            power += statVal * baseWeight * pp;
        }

        // Quality power multiplier (all = 1 currently)
        var heroQualityPowerTable = getHeroQualityPower();
        if (heroQualityPowerTable && heroQualityPowerTable[quality]) {
            var qp = Number(heroQualityPowerTable[quality].powerParam) || 1;
            power *= qp;
        }

        return Math.floor(power);
    }

    // ═══════════════════════════════════════════════════════════════
    //  EQUIP FLAT STAT EXTRACTION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Extract flat ability stats from a single equip config.
     * Returns array of {abilityId, value} pairs.
     */
    function getEquipAbilities(equipConfig) {
        var abilities = [];
        if (!equipConfig) return abilities;

        // ability1/abilityID1/value1
        if (equipConfig.abilityID1 !== undefined && equipConfig.abilityID1 !== '' && equipConfig.value1 !== undefined) {
            abilities.push({
                abilityId: Number(equipConfig.abilityID1),
                value: Number(equipConfig.value1) || 0
            });
        }
        // ability2/abilityID2/value2
        if (equipConfig.abilityID2 !== undefined && equipConfig.abilityID2 !== '' && equipConfig.value2 !== undefined) {
            abilities.push({
                abilityId: Number(equipConfig.abilityID2),
                value: Number(equipConfig.value2) || 0
            });
        }
        // ability3/abilityID3/value3
        if (equipConfig.abilityID3 !== undefined && equipConfig.abilityID3 !== '' && equipConfig.value3 !== undefined) {
            abilities.push({
                abilityId: Number(equipConfig.abilityID3),
                value: Number(equipConfig.value3) || 0
            });
        }

        return abilities;
    }

    /**
     * Sum flat equip stats from all equips in equipInfo.
     * Returns { equipAttrs: [{_id, _num}], flatStats: {abilityId: totalValue} }
     */
    function sumEquipFlatStats(equipInfo) {
        var flatStats = {};
        var changedEquipIds = [];

        for (var pos in equipInfo) {
            var equipId = equipInfo[pos];
            if (!equipId) continue;

            var eq = getEquipConfig(equipId);
            if (!eq) {
                log.warn('WEARAUTO', 'Equip config not found: ' + equipId);
                continue;
            }

            changedEquipIds.push(String(equipId));

            var abilities = getEquipAbilities(eq);
            for (var ai = 0; ai < abilities.length; ai++) {
                var ab = abilities[ai];
                if (flatStats[ab.abilityId] === undefined) {
                    flatStats[ab.abilityId] = 0;
                }
                flatStats[ab.abilityId] += ab.value;
            }
        }

        // Build _equipAttrs array (only non-zero entries)
        var equipAttrs = [];
        for (var aid in flatStats) {
            if (flatStats[aid] !== 0) {
                equipAttrs.push({ _id: Number(aid), _num: flatStats[aid] });
            }
        }

        return { equipAttrs: equipAttrs, flatStats: flatStats, changedEquipIds: changedEquipIds };
    }

    // ═══════════════════════════════════════════════════════════════
    //  HERO DATA RETRIEVAL
    // ═══════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════
    //  RESPONSE BUILDERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Build _totalAttr._items — 42 entries (IDs 0-41), ALL present.
     *
     * Logic:
     *   displayHp = rawBaseHp * talent + equipFlatHp
     *   displayAtk = rawBaseAtk * talent + equipFlatAtk
     *   displayArmor = rawBaseArmor + equipFlatArmor (no talent)
     *   All other stats = rawBase + equipFlat
     *   orghp = displayHp (mirror of hp)
     *   power = computed from ALL display stats
     */
    function buildTotalAttrItems(rawStats, equipFlatStats) {
        var talent = rawStats.talent || 0;
        var items = {};

        // Display values: talent applied to base ONLY, then equip flat ADDED
        var dispBaseHp = rawStats.hp * talent;
        var dispBaseAtk = rawStats.attack * talent;

        // Total display = base display + equip flat
        var totalHp = dispBaseHp + (Number(equipFlatStats[0]) || 0);      // ability 0 = hp
        var totalAtk = dispBaseAtk + (Number(equipFlatStats[1]) || 0);    // ability 1 = attack
        var totalArmor = rawStats.armor + (Number(equipFlatStats[2]) || 0); // ability 2 = armor

        for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
            var id = i;
            var name = FULL_ATTR_IDS[id];
            var val;

            if (id === 0) {
                val = totalHp;
            } else if (id === 1) {
                val = totalAtk;
            } else if (id === 2) {
                val = totalArmor;
            } else if (id === 16) {
                // energy — always 0 in wearAuto (no equip contributes energy for green)
                val = 0;
            } else if (id === 21) {
                // power — skip, compute after
                continue;
            } else if (id === 22) {
                // orghp = total display HP (same as id 0)
                val = totalHp;
            } else {
                // All other stats: base + equip flat
                val = Number(rawStats[name]) || 0;
                // Add equip flat contribution for this ability ID
                if (equipFlatStats[id] !== undefined) {
                    val += Number(equipFlatStats[id]) || 0;
                }
            }

            items[String(id)] = { _id: id, _num: val };
        }

        // Compute power using total display stats
        var displayStats = {};
        // Build display stats map for power computation
        for (var si = 0; si < FULL_ATTR_IDS.length; si++) {
            var sId = si;
            var sName = FULL_ATTR_IDS[sId];
            if (sId === 21 || sId === 22) continue; // skip power and orghp

            var sVal;
            if (sId === 0) {
                sVal = totalHp;
            } else if (sId === 1) {
                sVal = totalAtk;
            } else if (sId === 2) {
                sVal = totalArmor;
            } else {
                sVal = Number(rawStats[sName]) || 0;
                if (equipFlatStats[sId] !== undefined) {
                    sVal += Number(equipFlatStats[sId]) || 0;
                }
            }
            if (POWER_BASE_WEIGHTS.hasOwnProperty(sName)) {
                displayStats[sName] = sVal;
            }
        }

        var power = computePower(displayStats, rawStats);
        items['21'] = { _id: 21, _num: power };

        return items;
    }

    /**
     * Build _suitItems array from equipInfo.
     * Format: [{_id: STRING, _pos: NUMBER, _version: STRING}]
     */
    function buildSuitItems(equipInfo) {
        var suitItems = [];
        for (var pos in equipInfo) {
            var equipId = equipInfo[pos];
            if (!equipId) continue;
            suitItems.push({
                _id: String(equipId),
                _pos: Number(pos),
                _version: '201906201330'
            });
        }
        return suitItems;
    }

    /**
     * Build _equipItem object.
     */
    function buildEquipItem(equipInfo, equipAttrs) {
        return {
            _suitItems: buildSuitItems(equipInfo),
            _earrings: {
                _id: 0,
                _level: 0,
                _attrs: { _items: {}, _version: '' }
            },
            _suitAttrs: [],  // Green has no suit bonus; TODO: blue+ suit bonus
            _equipAttrs: equipAttrs,
            _weaponState: 0
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  SAVEDATA UPDATES
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    //  ITEM BALANCE — read/write totalProps._items (ARRAY format)
    //  Same pattern as gain.js, autoLevelUp.js, and all other handlers.
    //
    //  Server storage: totalProps._items = [{_id, _num}, ...]
    //  Client reads:   setBackpack → for-in → setItem(id, num)
    // ═══════════════════════════════════════════════════════════════

    function getBal(sd, id) {
        var items = sd && sd.totalProps && sd.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    function setBal(sd, id, val) {
        if (!sd.totalProps) sd.totalProps = { _items: [] };
        if (!sd.totalProps._items) sd.totalProps._items = [];
        var items = sd.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) { items[i]._num = val; return; }
        }
        items.push({ _id: id, _num: val });
    }

    /**
     * Update savedData with new equip assignment.
     * Returns _changeInfo items (ABSOLUTE balances, OBJECT keyed by string ID).
     */
    function updateSavedData(savedData, heroId, equipInfo, newEquipIds, oldSuitItems) {
        var changeItems = {};

        // 1. Build map of old items by position for selective replacement
        var oldItemsByPos = {};
        if (oldSuitItems && oldSuitItems.length > 0) {
            for (var oi = 0; oi < oldSuitItems.length; oi++) {
                var oldItem = oldSuitItems[oi];
                oldItemsByPos[Number(oldItem._pos)] = oldItem;
            }
        }

        // 2. For each position in equipInfo: return old item to inventory, then consume new item
        for (var pos in equipInfo) {
            var posNum = Number(pos);
            var eid = equipInfo[pos];
            if (!eid) continue;

            // Return old item at this position to inventory (if any)
            if (oldItemsByPos[posNum]) {
                var oldId = Number(oldItemsByPos[posNum]._id);
                var oldBal = getBal(savedData, oldId);
                var newBal = oldBal + 1;
                setBal(savedData, oldId, newBal);
                changeItems[String(oldId)] = { _id: oldId, _num: newBal };
                log.details('inventory', [
                    ['return pos ' + posNum, String(oldId)],
                    ['bal', oldBal + ' -> ' + newBal]
                ]);
                delete oldItemsByPos[posNum];
            }
        }

        // 3. Consume new equips from inventory
        for (var ni = 0; ni < newEquipIds.length; ni++) {
            var newId = Number(newEquipIds[ni]);
            var oldBal = getBal(savedData, newId);
            var newBal = Math.max(0, oldBal - 1);
            setBal(savedData, newId, newBal);
            changeItems[String(newId)] = { _id: newId, _num: newBal };

            log.details('inventory', [
                ['consume', String(newId)],
                ['bal', oldBal + ' -> ' + newBal]
            ]);
        }

        // 4. Update equip._suits for this hero: merge kept old items + new items
        if (!savedData.equip) savedData.equip = {};
        if (!savedData.equip._suits) savedData.equip._suits = {};
        if (!savedData.equip._suits[heroId]) savedData.equip._suits[heroId] = {};

        var mergedSuitItems = [];

        // Keep old items for positions NOT in equipInfo
        for (var oldPos in oldItemsByPos) {
            if (!oldItemsByPos.hasOwnProperty(oldPos)) continue;
            var keepItem = oldItemsByPos[oldPos];
            mergedSuitItems.push({
                _id: String(keepItem._id),
                _pos: Number(keepItem._pos),
                _version: keepItem._version || '201906201330'
            });
        }

        // Add new items from equipInfo
        for (var pos in equipInfo) {
            if (!equipInfo.hasOwnProperty(pos)) continue;
            var eid = equipInfo[pos];
            if (!eid) continue;
            mergedSuitItems.push({
                _id: String(eid),
                _pos: Number(pos)
            });
        }

        savedData.equip._suits[heroId]._suitItems = mergedSuitItems;

        return changeItems;
    }

    // ═══════════════════════════════════════════════════════════════
    //  HANDLER: equip/wearAuto
    // ═══════════════════════════════════════════════════════════════

    function handleWearAuto(request, callback) {
        var userId = request.userId;
        var heroId = request.heroId;
        var equipInfo = request.equipInfo || {};
        var weaponId = request.weaponId || '';

        log.info('WEARAUTO', 'equip/wearAuto processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['heroId', heroId || '-'],
            ['equipInfo', JSON.stringify(equipInfo)],
            ['weaponId', weaponId || '(none)']
        ]);

        try {
            if (!userId || !heroId) {
                log.warn('WEARAUTO', 'Missing userId or heroId');
                callback({}, 1);
                return;
            }

            // Load savedData
            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('WEARAUTO', 'User data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // Find hero
            var found = findHeroInStorage(savedData, heroId);
            if (!found || !found.hero) {
                log.warn('WEARAUTO', 'Hero not found: ' + heroId);
                callback({}, 1);
                return;
            }

            var hero = found.hero;
            var displayId = hero._heroDisplayId || Number(hero._heroId);
            var baseAttr = hero._heroBaseAttr || {};
            var level = Number(baseAttr._level) || 1;
            var evolveLevel = Number(baseAttr._evolveLevel) || 0;
            var starLevel = Number(hero._heroStar) || 0;

            log.details('hero', [
                ['heroId', String(heroId)],
                ['displayId', String(displayId)],
                ['level', String(level)],
                ['evolveLevel', String(evolveLevel)],
                ['starLevel', String(starLevel)]
            ]);

            // Compute raw base stats (polosan)
            var rawStats = computeRawBaseStats(displayId, level, evolveLevel, starLevel);
            if (!rawStats) {
                log.warn('WEARAUTO', 'Failed to compute base stats for heroId: ' + heroId);
                callback({}, 1);
                return;
            }

            // Sum flat equip stats from equipInfo
            var equipResult = sumEquipFlatStats(equipInfo);
            var equipAttrs = equipResult.equipAttrs;
            var flatStats = equipResult.flatStats;
            var newEquipIds = equipResult.changedEquipIds;

            log.details('equipStats', [
                ['equipCount', String(Object.keys(equipInfo).length)],
                ['equipAttrs', JSON.stringify(equipAttrs)]
            ]);

            // Get old suit items for this hero (for returning to inventory)
            var oldSuitItems = [];
            if (savedData.equip && savedData.equip._suits && savedData.equip._suits[heroId]) {
                oldSuitItems = savedData.equip._suits[heroId]._suitItems || [];
            }

            // Build _totalAttr._items (base + equip flat, talent applied to base only)
            var totalAttrItems = buildTotalAttrItems(rawStats, flatStats);

            // Update savedData (inventory + equip assignment)
            var changeInfoItems = updateSavedData(savedData, heroId, equipInfo, newEquipIds, oldSuitItems);

            // Handle weapon if present
            // TODO: weapon swap logic when we have weapon HAR data

            log.details('result', [
                ['totalAttrCount', String(Object.keys(totalAttrItems).length)],
                ['changeInfoCount', String(Object.keys(changeInfoItems).length)],
                ['equipAttrsCount', String(equipAttrs.length)]
            ]);

            // Build response
            var response = {
                type: 'equip',
                action: 'wearAuto',
                userId: userId,
                heroId: heroId,
                equipInfo: equipInfo,
                weaponId: weaponId,
                version: '1.0',
                _totalAttr: { _items: totalAttrItems },
                _changeInfo: { _items: changeInfoItems },
                _equipItem: buildEquipItem(equipInfo, equipAttrs),
                _linkHeroesTotalAttr: {}
            };

            log.info('WEARAUTO', 'equip/wearAuto success');

            // Save updated savedData
            db._set(storageKey, savedData);

            // ── Check & advance main task (getOnAllEquip) ──
            // Pola sama dengan checkBattleResult.js STEP 7e & autoLevelUp.js
            //
            // Task 6006: { taskType:"getOnAllEquip", taskPara1:4 }
            //   = "Equip all 4 heroes with equipment"
            // Cek: count heroes di equip._suits yang punya _suitItems non-empty
            try {
                var cmt = savedData.curMainTask;
                var canCheck = cmt && Array.isArray(cmt) && cmt.length > 0 && cmt[0]._state === 1;

                if (canCheck) {
                    var tcCfg = loadJsonSync('task');
                    var tcDef = tcCfg && tcCfg[cmt[0]._id];

                    if (tcDef && tcDef.taskType === 'getOnAllEquip') {
                        var tcNeedCount = Number(tcDef.taskPara1) || 0;

                        // Count heroes yang punya equipment terpasang
                        var tcSuits = savedData.equip && savedData.equip._suits;
                        var tcEquipCount = 0;

                        if (tcSuits) {
                            for (var tcSk in tcSuits) {
                                if (!tcSuits.hasOwnProperty(tcSk)) continue;
                                var tcSuit = tcSuits[tcSk];
                                var tcItems = tcSuit._suitItems;
                                if (tcItems && Array.isArray(tcItems) && tcItems.length > 0) {
                                    tcEquipCount++;
                                }
                            }
                        }

                        if (tcEquipCount >= tcNeedCount) {
                            cmt[0]._state = 2; // COMPLETE

                            log.info('TASK', 'Task ' + cmt[0]._id + ' DOING → COMPLETE (getOnAllEquip)');
                            log.details('taskMatch', [
                                ['taskId', String(cmt[0]._id)],
                                ['needCount', String(tcNeedCount)],
                                ['equippedHeroCount', String(tcEquipCount)]
                            ]);

                            if (typeof MainServer.notify === 'function') {
                                MainServer.notify({
                                    action: 'mainTaskChange',
                                    _curMainTask: [{ _id: cmt[0]._id, _state: 2 }]
                                });
                                log.info('TASK', 'Pushed mainTaskChange state=2');
                            }
                        } else {
                            log.info('TASK', 'getOnAllEquip not yet — have ' + tcEquipCount + '/' + tcNeedCount + ' heroes equipped');
                        }
                    }
                }
            } catch (tcErr) {
                log.warn('TASK', 'getOnAllEquip check error: ' + (tcErr.message || tcErr));
            }

            callback(response);

        } catch (err) {
            log.error('WEARAUTO', 'UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════════

    MainServer.registerHandler('equip', 'wearAuto', handleWearAuto);

    window.MainServer = MainServer;
})();
