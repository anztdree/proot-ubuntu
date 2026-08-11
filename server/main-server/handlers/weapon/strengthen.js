/**
 * weapon/strengthen.js — Weapon Strengthen Handler (v1 — SELF-CONTAINED)
 * Super Warrior Z — MAIN SERVER
 *
 * Client call (main.min.js L175213-175239):
 *   ts.processHandler({
 *     type: "weapon", action: "strengthen" | "autoStrengthen",
 *     userId, heroId, weaponId, version: "1.0"
 *   }, function(e) {
 *     EquipInfoManager.resetWeaponData(e),              // L82784-82791
 *     HerosManager.setTotalAttrsByHeroId(e, e.heroId),  // L85171 → L85204
 *     UIWindowManager.openHeroAttrChange(),
 *     ItemsCommonSingleton.resetTtemsCallBack(e),       // reads _changeInfo._items
 *     t.checkNextState(o)
 *   })
 *
 * resetWeaponData (L82784):
 *   n = WeaponDataArray[e._weapon._weaponId]
 *   for(o in e._delWeapons) delete WeaponDataArray[e._delWeapons[o]]
 *   n.deserialize(e._weapon)   → reads _attrs._items, _strengthenCost._items, common fields
 *
 * resetTtemsCallBack:
 *   if(e._changeInfo) { for(o in e._changeInfo._items) setItem(_id, _num); refreshNodeResource() }
 *
 * weaponStrengthen.json structure:
 *   { "1": { id, weapon:4101, quality:"green", level:1, attack:290,
 *            userLevel:20, costID1:137, num1:10, costID2:102, num2:2390 } }
 *   — costID3/costID4 may exist (0 = no cost)
 *
 * Response format:
 *   {
 *     heroId: String,
 *     _weapon: { _weaponId, _displayId, _level, _star, _heroId, _attrs, _strengthenCost, _haloId, _haloLevel },
 *     _delWeapons: {},
 *     _heroTotalAttr: { _items: { "0":{_id,_num}, ... } },
 *     _changeInfo: { _items: { "137":{_id:137,_num:ABSOLUTE}, "102":{_id:102,_num:ABSOLUTE}, ... } }
 *   }
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.weapon) {
        MainServer.handlers.weapon = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG CACHE (sync XHR)
    // ═══════════════════════════════════════════════════════════

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _cache[name] = data;
                return data;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ATTRIBUTE ID MAPPING (0-41) — dari getAttrs.js
    // ═══════════════════════════════════════════════════════════

    var FULL_ATTR_IDS = [
        'hp','attack','armor','speed','hit','dodge','block','blockEffect',
        'skillDamage','critical','criticalResist','criticalDamage','armorBreak',
        'damageReduce','controlResist','trueDamage','energy','hpPercent',
        'armorPercent','attackPercent','speedPercent','power','orghp',
        'superDamage','healPlus','healerPlus','extraArmor','shielderPlus',
        'damageUp','damageDown','talent','superDamageResist',
        'dragonBallWarDamageUp','r33','r34','r35','r36','r37','r38','r39','r40','zpowerLevel'
    ];

    // ═══════════════════════════════════════════════════════════
    //  POWER WEIGHTS — dari getAttrs.js
    // ═══════════════════════════════════════════════════════════

    var ATK_BASE_WEIGHTS = {
        'critical':20,'criticalSingle':20,'hit':20,
        'skill':15,'body':15,'block':15,'armor':15,'armorS':15,
        'armorDamage':15,'bodyDamage':15,'dodge':15,'strength':15,'dot':15
    };

    var POWER_BASE_WEIGHTS = {
        hp:'balancePower', attack:'atkBase', armor:1, speed:0,
        extraArmor:1, orghp:0, talent:0, power:0,
        hpPercent:1, attackPercent:1, armorPercent:1, speedPercent:0,
        hit:1, dodge:1, block:1, blockEffect:1, skillDamage:1,
        critical:1, criticalResist:1, criticalDamage:1, armorBreak:1,
        damageReduce:1, controlResist:1, trueDamage:1,
        healPlus:1, healerPlus:1, shielderPlus:1, damageUp:1, damageDown:1,
        superDamage:1, superDamageResist:1, dragonBallWarDamageUp:1
    };

    var _heroPowerCache = null;

    function getHeroPowerForType(heroType) {
        if (!_heroPowerCache) {
            var hpTable = loadJson('heroPower');
            _heroPowerCache = {};
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

    function computePower(displayStats, rawStats) {
        var balancePower = rawStats.balancePower || 1;
        var quality = rawStats.quality || 'purple';
        var heroType = rawStats.heroType || 'critical';
        var typeWeights = getHeroPowerForType(heroType);

        var power = 0;
        for (var statName in displayStats) {
            if (!POWER_BASE_WEIGHTS.hasOwnProperty(statName)) continue;
            var baseWeight = POWER_BASE_WEIGHTS[statName];
            if (baseWeight === 'balancePower') baseWeight = balancePower;
            else if (baseWeight === 'atkBase') baseWeight = ATK_BASE_WEIGHTS[heroType] || 15;
            if (baseWeight === 0) continue;

            var pp = 1;
            if (typeWeights && typeWeights[statName]) pp = typeWeights[statName];

            power += (Number(displayStats[statName]) || 0) * baseWeight * pp;
        }

        var qpTable = loadJson('heroQualityPower');
        if (qpTable && qpTable[quality]) {
            power *= (Number(qpTable[quality].powerParam) || 1);
        }
        return Math.floor(power);
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO BASE STAT COMPUTATION — dari getAttrs.js
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

    function computeRawBaseStats(heroDisplayId, level, evolveLevel, starLevel) {
        var hc = loadJson('hero');
        hc = hc ? hc[String(heroDisplayId)] : null;
        if (!hc) return null;

        var quality = hc.quality || 'purple';
        var heroType = hc.heroType || 'critical';

        var la = (loadJson('heroLevelAttr') || {})[String(level)] || {};
        var qp = (loadJson('heroQualityParam') || {})[quality] || {};
        var tp = (loadJson('heroTypeParam') || {})[heroType] || {};
        var evEntries = loadJson('heroEvolve');
        evEntries = evEntries ? (evEntries[String(heroDisplayId)] || []) : [];
        var wuEntries = loadJson('heroWakeUp');
        wuEntries = wuEntries ? (wuEntries[String(heroDisplayId)] || []) : [];

        var stats = {
            hp:0, attack:0, armor:0, speed:0, hit:0, dodge:0, block:0,
            damageReduce:0, armorBreak:0, controlResist:0, skillDamage:0,
            criticalDamage:0, blockEffect:0, critical:0, criticalResist:0,
            trueDamage:0, energy:0, hpPercent:0, armorPercent:0,
            attackPercent:0, speedPercent:0, extraArmor:0, orghp:0,
            superDamage:0, healPlus:0, healerPlus:0, damageDown:0,
            shielderPlus:0, damageUp:0,
            talent: Number(hc.talent) || 0,
            heroType: heroType, quality: quality,
            balancePower: Number(hc.balancePower) || 1
        };

        for (var ei = 0; ei < evEntries.length; ei++) {
            var ev = evEntries[ei];
            if (evolveLevel >= (ev.level || 0)) {
                stats.hp += Number(ev.hp) || 0;
                stats.attack += Number(ev.attack) || 0;
                stats.armor += Number(ev.armor) || 0;
                stats.speed += Number(ev.speed) || 0;
            }
        }

        for (var wi = 0; wi < wuEntries.length; wi++) {
            var wu = wuEntries[wi];
            if (starLevel >= (wu.star || 0)) {
                stats.talent += Number(wu.talent) || 0;
                stats.hp += Number(wu.hp) || 0;
                stats.attack += Number(wu.attack) || 0;
                stats.armor += Number(wu.armor) || 0;
                stats.speed += Number(wu.speed) || 0;
            }
        }

        stats.hp += ((Number(la.hp)||0) * (Number(tp.hpParam)||0) + (Number(tp.hpBais)||0)) * (Number(qp.hpParam)||1) * (Number(hc.balanceHp)||1);
        stats.attack += ((Number(la.attack)||0) * (Number(tp.attackParam)||0) + (Number(tp.attackBais)||0)) * (Number(qp.attackParam)||1) * (Number(hc.balanceAttack)||1);
        stats.armor += ((Number(la.armor)||0) * (Number(tp.armorParam)||0) + (Number(tp.armorBais)||0)) * (Number(qp.armorParam)||1) * (Number(hc.balanceArmor)||1);

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

    function getEquipAbilities(equipConfig) {
        var abilities = [];
        if (!equipConfig) return abilities;
        var fields = ['abilityID1','abilityID2','abilityID3'];
        var values = ['value1','value2','value3'];
        for (var i = 0; i < 3; i++) {
            if (equipConfig[fields[i]] !== undefined && equipConfig[fields[i]] !== '' && equipConfig[values[i]] !== undefined) {
                abilities.push({ abilityId: Number(equipConfig[fields[i]]), value: Number(equipConfig[values[i]]) || 0 });
            }
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
            var eq = (loadJson('equip') || {})[String(item._id)];
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
    //  BUILD 42-ITEM TOTAL ATTR (dari getAttrs.js buildTotalAttrItems)
    // ═══════════════════════════════════════════════════════════

    function buildTotalAttrItems(rawStats, equipFlatStats) {
        var talent = rawStats.talent || 0;
        var items = {};

        var dispBaseHp = rawStats.hp * talent;
        var dispBaseAtk = rawStats.attack * talent;
        var totalHp = dispBaseHp + (Number(equipFlatStats[0]) || 0);
        var totalAtk = dispBaseAtk + (Number(equipFlatStats[1]) || 0);
        var totalArmor = rawStats.armor + (Number(equipFlatStats[2]) || 0);

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
                if (equipFlatStats[id] !== undefined) val += Number(equipFlatStats[id]) || 0;
            }

            items[String(id)] = { _id: id, _num: val };
        }

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
    //  WEAPON LEVEL-UP (STAR) STATS
    // ═══════════════════════════════════════════════════════════

    var WLU_ATTR_MAP = {
        'critical':9,'criticalDamage':11,'criticalResist':10,
        'block':6,'dodge':5,'speed':3,
        'attackPercent':19,'hpPercent':17,'armorPercent':18
    };

    var WLU_FLAT_ATTR_MAP = {
        'critical':9,'criticalDamage':11,'criticalResist':10,
        'block':6,'dodge':5,'speed':3
    };

    function getWeaponLevelUpStats(displayId, star) {
        var result = { attackPercent:0, hpPercent:0, armorPercent:0, flatStats:{} };
        var wlu = loadJson('weaponLevelUp');
        if (!wlu) return result;

        var entries = wlu[String(displayId)];
        if (!entries || !Array.isArray(entries)) return result;

        for (var i = 0; i < entries.length; i++) {
            if (Number(entries[i].level) === Number(star)) {
                var e = entries[i];
                result.attackPercent = Number(e.attackPercent) || 0;
                result.hpPercent = Number(e.hpPercent) || 0;
                result.armorPercent = Number(e.armorPercent) || 0;

                for (var statName in WLU_FLAT_ATTR_MAP) {
                    if (e.hasOwnProperty(statName)) {
                        var val = Number(e[statName]) || 0;
                        if (val !== 0) result.flatStats[WLU_FLAT_ATTR_MAP[statName]] = val;
                    }
                }
                return result;
            }
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  UPDATE WEAPON _attrs._items FOR UI DISPLAY
    //  (setelah response dikirim, untuk storage → re-login deserialize)
    // ═══════════════════════════════════════════════════════════

    function updateWeaponAttrsForUI(weaponData) {
        var displayId = Number(weaponData._displayId) || 0;
        var star = Number(weaponData._star) || 0;

        if (!weaponData._attrs) weaponData._attrs = { _items: {} };
        if (!weaponData._attrs._items) weaponData._attrs._items = {};
        var items = weaponData._attrs._items;

        var wlu = loadJson('weaponLevelUp');
        if (wlu) {
            var entries = wlu[String(displayId)];
            if (entries && Array.isArray(entries)) {
                for (var i = 0; i < entries.length; i++) {
                    if (Number(entries[i].level) === star) {
                        var e = entries[i];
                        for (var field in WLU_ATTR_MAP) {
                            if (e.hasOwnProperty(field)) {
                                var val = Number(e[field]) || 0;
                                if (val !== 0) {
                                    var attrId = String(WLU_ATTR_MAP[field]);
                                    if (!items[attrId]) {
                                        items[attrId] = { _id: WLU_ATTR_MAP[field], _num: val };
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM HELPERS
    //  Storage: savedData.totalProps._items = ARRAY [{_id, _num}, ...]
    //  Client L77685: e.totalProps._items → setItem(_id, _num)
    //  Ref: arena/startBattle.js getBal/setBal pattern
    // ═══════════════════════════════════════════════════════════

    function getItemNum(savedData, itemId) {
        var items = savedData && savedData.totalProps && savedData.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    function setItemNum(savedData, itemId, num) {
        if (!savedData.totalProps) savedData.totalProps = { _items: [] };
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = num;
                return;
            }
        }
        items.push({ _id: Number(itemId), _num: num });
    }

    function deductItem(savedData, itemId, amount) {
        var current = getItemNum(savedData, itemId);
        var newVal = Math.max(0, current - amount);
        setItemNum(savedData, itemId, newVal);
        return newVal;
    }

    // ═══════════════════════════════════════════════════════════
    //  STRENGTHEN CONFIG LOOKUP
    // ═══════════════════════════════════════════════════════════

    // Cache strengthen entries indexed by weapon displayId → level → config
    var _strengthenCache = null;

    function getStrengthenConfig(weaponDisplayId, level) {
        if (!_strengthenCache) {
            var ws = loadJson('weaponStrengthen');
            _strengthenCache = {};
            if (ws) {
                for (var key in ws) {
                    if (!ws.hasOwnProperty(key)) continue;
                    var entry = ws[key];
                    var wId = String(entry.weapon);
                    var lv = Number(entry.level);
                    if (!_strengthenCache[wId]) _strengthenCache[wId] = {};
                    _strengthenCache[wId][lv] = entry;
                }
            }
        }
        var wMap = _strengthenCache[String(weaponDisplayId)];
        if (!wMap) return null;
        return wMap[Number(level)] || null;
    }

    function getMaxStrengthenLevel(weaponDisplayId) {
        var ws = loadJson('weaponStrengthen');
        if (!ws) return 0;
        var maxLv = 0;
        for (var key in ws) {
            if (!ws.hasOwnProperty(key)) continue;
            if (Number(ws[key].weapon) === Number(weaponDisplayId)) {
                var lv = Number(ws[key].level) || 0;
                if (lv > maxLv) maxLv = lv;
            }
        }
        return maxLv;
    }

    // ═══════════════════════════════════════════════════════════
    //  SERIALIZE WEAPON FOR RESPONSE
    // ═══════════════════════════════════════════════════════════

    function serializeWeaponForResponse(weaponId, weaponData) {
        var obj = {
            _weaponId: String(weaponId),
            _displayId: Number(weaponData._displayId) || 0,
            _level: Number(weaponData._level) || 1,
            _star: Number(weaponData._star) || 0,
            _heroId: String(weaponData._heroId || '')
        };

        // _attrs._items — for WeaponDataModel.deserialize
        if (weaponData._attrs && weaponData._attrs._items) {
            obj._attrs = { _items: {} };
            for (var k in weaponData._attrs._items) {
                if (!weaponData._attrs._items.hasOwnProperty(k)) continue;
                var src = weaponData._attrs._items[k];
                obj._attrs._items[k] = { _id: Number(src._id), _num: Number(src._num) || 0 };
            }
        }

        // _strengthenCost._items — for WeaponDataModel.deserialize
        if (weaponData._strengthenCost && weaponData._strengthenCost._items) {
            obj._strengthenCost = { _items: {} };
            for (var k2 in weaponData._strengthenCost._items) {
                if (!weaponData._strengthenCost._items.hasOwnProperty(k2)) continue;
                var src2 = weaponData._strengthenCost._items[k2];
                obj._strengthenCost._items[k2] = { _id: Number(src2._id), _num: Number(src2._num) || 0 };
            }
        }

        // _haloCost._items
        if (weaponData._haloCost && weaponData._haloCost._items) {
            obj._haloCost = { _items: {} };
            for (var k3 in weaponData._haloCost._items) {
                if (!weaponData._haloCost._items.hasOwnProperty(k3)) continue;
                var src3 = weaponData._haloCost._items[k3];
                obj._haloCost._items[k3] = { _id: Number(src3._id), _num: Number(src3._num) || 0 };
            }
        }

        // _haloId, _haloLevel (common fields, isCommonType)
        if (weaponData._haloId !== undefined) obj._haloId = Number(weaponData._haloId) || 0;
        if (weaponData._haloLevel !== undefined) obj._haloLevel = Number(weaponData._haloLevel) || 0;

        return obj;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD _heroTotalAttr WITH WEAPON STATS
    // ═══════════════════════════════════════════════════════════

    function buildHeroTotalAttr(savedData, heroId, weaponData) {
        var found = findHeroInStorage(savedData, heroId);
        if (!found || !found.hero) return null;

        var hero = found.hero;
        var displayId = hero._heroDisplayId || Number(hero._heroId);
        var baseAttr = hero._heroBaseAttr || {};
        var level = Number(baseAttr._level) || 1;
        var evolveLevel = Number(baseAttr._evolveLevel) || 0;
        var starLevel = Number(hero._heroStar) || 0;

        var rawStats = computeRawBaseStats(displayId, level, evolveLevel, starLevel);
        if (!rawStats) return null;

        var equipFlat = getHeroEquippedFlatStats(savedData, heroId);
        var items = buildTotalAttrItems(rawStats, equipFlat);

        // Weapon flat attack from weaponStrengthen.json
        var weaponAtk = 0;
        var wDisplayId = Number(weaponData._displayId) || 0;
        var wLevel = Number(weaponData._level) || 1;
        var ws = loadJson('weaponStrengthen');
        if (ws) {
            for (var wk in ws) {
                if (!ws.hasOwnProperty(wk)) continue;
                if (Number(ws[wk].weapon) === wDisplayId && Number(ws[wk].level) === wLevel) {
                    weaponAtk = Number(ws[wk].attack) || 0;
                    break;
                }
            }
        }

        // Weapon level-up stats (% + flat bonuses from star)
        var wlu = getWeaponLevelUpStats(wDisplayId, Number(weaponData._star) || 0);

        // Apply weapon stats to items
        var hp  = Number(items['0']  && items['0']._num)  || 0;
        var atk = Number(items['1']  && items['1']._num)  || 0;
        var arm = Number(items['2']  && items['2']._num)  || 0;

        if (wlu.hpPercent !== 0) hp *= (1 + wlu.hpPercent);
        atk += weaponAtk;
        if (wlu.attackPercent !== 0) atk *= (1 + wlu.attackPercent);
        if (wlu.armorPercent !== 0) arm *= (1 + wlu.armorPercent);

        items['0']  = { _id: 0,  _num: hp };
        items['1']  = { _id: 1,  _num: atk };
        items['2']  = { _id: 2,  _num: arm };
        items['22'] = { _id: 22, _num: hp };

        var hpP  = (Number(items['17'] && items['17']._num) || 0) + wlu.hpPercent;
        var armP = (Number(items['18'] && items['18']._num) || 0) + wlu.armorPercent;
        var atkP = (Number(items['19'] && items['19']._num) || 0) + wlu.attackPercent;
        items['17'] = { _id: 17, _num: hpP };
        items['18'] = { _id: 18, _num: armP };
        items['19'] = { _id: 19, _num: atkP };

        for (var attrId in wlu.flatStats) {
            var existing = Number(items[attrId] && items[attrId]._num) || 0;
            items[attrId] = { _id: Number(attrId), _num: existing + wlu.flatStats[attrId] };
        }

        // Recompute power
        var displayStats = {};
        for (var di = 0; di < FULL_ATTR_IDS.length; di++) {
            var dId = di;
            var dName = FULL_ATTR_IDS[dId];
            if (dId === 21 || dId === 22) continue;
            var dVal = Number(items[String(dId)] && items[String(dId)]._num) || 0;
            if (POWER_BASE_WEIGHTS.hasOwnProperty(dName)) {
                displayStats[dName] = dVal;
            }
        }
        var newPower = computePower(displayStats, rawStats);
        items['21'] = { _id: 21, _num: newPower };

        log.arrow('power=' + newPower + ' hp=' + hp.toFixed(1) + ' atk=' + atk.toFixed(1) + ' arm=' + arm.toFixed(1));
        return items;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleWeaponStrengthen(request, callback) {
        try {
            var userId   = request && request.userId;
            var heroId   = request && request.heroId;
            var weaponId = request && request.weaponId;

            log.info('WEAPON_STRENGTHEN', 'START action=' + (request ? request.action : '?'));

            if (!userId || !heroId || !weaponId) {
                callback({ heroId: String(heroId||''), _weapon: {_weaponId:'',_displayId:0,_level:1,_star:0,_heroId:''}, _delWeapons: {} });
                return;
            }

            var key = userStorageKey(userId);
            var savedData = db._get(key);
            if (!savedData) {
                callback({ heroId: String(heroId), _weapon: {_weaponId:String(weaponId),_displayId:0,_level:1,_star:0,_heroId:String(heroId)}, _delWeapons: {} });
                return;
            }

            if (!savedData.weapon) savedData.weapon = { _items: {} };
            if (!savedData.weapon._items) savedData.weapon._items = {};
            // Find weapon
            var weaponData = savedData.weapon._items[String(weaponId)];
            if (!weaponData) {
                log.error('WEAPON_STRENGTHEN', 'weapon not found: ' + weaponId);
                callback({ heroId: String(heroId), _weapon: {_weaponId:String(weaponId),_displayId:0,_level:1,_star:0,_heroId:String(heroId)}, _delWeapons: {} });
                return;
            }

            // Validate weapon is equipped to the hero
            if (String(weaponData._heroId) !== String(heroId)) {
                log.error('WEAPON_STRENGTHEN', 'weapon not on hero: weapon.heroId='
                    + weaponData._heroId + ' requested=' + heroId);
                callback({ heroId: String(heroId), _weapon: serializeWeaponForResponse(weaponId, weaponData), _delWeapons: {} });
                return;
            }

            var wDisplayId = Number(weaponData._displayId) || 0;
            var currentLevel = Number(weaponData._level) || 1;
            var maxLevel = getMaxStrengthenLevel(wDisplayId);

            if (currentLevel >= maxLevel) {
                log.arrow('already max level: ' + currentLevel);
                callback({ heroId: String(heroId), _weapon: serializeWeaponForResponse(weaponId, weaponData), _delWeapons: {} });
                return;
            }

            // Get user level (PLAYERLEVELID = 104)
            var userLevel = getItemNum(savedData, 104);

            // Determine max iterations
            var isAuto = (request.action === 'autoStrengthen');
            var maxIter = isAuto ? 10 : 1;

            var levelsDone = 0;
            var totalCosts = {};  // itemId → total amount deducted

            for (var iter = 0; iter < maxIter; iter++) {
                // FIX: lookup config by CURRENT level (not nextLevel)
                // Client L83124: r[n.level] — entry level:N = cost to go N→N+1
                // Client L175771: levelUpLocalCostList[t.level - 1] — same logic
                var config = getStrengthenConfig(wDisplayId, currentLevel);

                if (!config) {
                    log.arrow('no config for level ' + currentLevel + ', stopping');
                    break;
                }

                // Check user level requirement
                if (userLevel < (Number(config.userLevel) || 0)) {
                    log.arrow('userLevel ' + userLevel + ' < required ' + config.userLevel + ', stopping');
                    break;
                }

                // Check and collect costs (costID1-4 / num1-4)
                var canAfford = true;
                var iterCosts = {};
                for (var ci = 1; ci <= 4; ci++) {
                    var costId = config['costID' + ci];
                    var costNum = Number(config['num' + ci]) || 0;
                    if (!costId || costNum <= 0) continue;
                    costId = Number(costId);
                    var have = getItemNum(savedData, costId);
                    if (have < costNum) {
                        canAfford = false;
                        log.arrow('cannot afford: item ' + costId + ' have=' + have + ' need=' + costNum);
                        break;
                    }
                    iterCosts[costId] = costNum;
                }

                if (!canAfford) break;

                // Deduct costs
                for (var cId in iterCosts) {
                    if (!iterCosts.hasOwnProperty(cId)) continue;
                    deductItem(savedData, Number(cId), iterCosts[cId]);
                    totalCosts[cId] = (totalCosts[cId] || 0) + iterCosts[cId];
                }

                // Level up weapon
                var nextLevel = currentLevel + 1;
                weaponData._level = nextLevel;
                currentLevel = nextLevel;
                levelsDone++;

                log.arrow('strengthened to level ' + nextLevel);
            }

            if (levelsDone === 0) {
                log.info('WEAPON_STRENGTHEN', 'NO LEVELS DONE');
                var noopTotalAttr = buildHeroTotalAttr(savedData, heroId, weaponData);
                var noopResp = {
                    heroId: String(heroId),
                    _weapon: serializeWeaponForResponse(weaponId, weaponData),
                    _delWeapons: {}
                };
                if (noopTotalAttr) noopResp._heroTotalAttr = { _items: noopTotalAttr };
                callback(noopResp);
                return;
            }

            log.info('WEAPON_STRENGTHEN', 'DONE ' + levelsDone + ' levels → level ' + currentLevel);

            // Save to DB
            db._set(key, savedData);

            // Build _changeInfo._items (ABSOLUTE item counts after deduction)
            var changeItems = {};
            for (var cItemId in totalCosts) {
                if (!totalCosts.hasOwnProperty(cItemId)) continue;
                var absNum = getItemNum(savedData, Number(cItemId));
                changeItems[cItemId] = { _id: Number(cItemId), _num: absNum };
            }

            // Build _heroTotalAttr
            var totalAttrItems = buildHeroTotalAttr(savedData, heroId, weaponData);

            // Build response
            var response = {
                heroId: String(heroId),
                _weapon: serializeWeaponForResponse(weaponId, weaponData),
                _delWeapons: {}
            };

            if (totalAttrItems) {
                response._heroTotalAttr = { _items: totalAttrItems };
                log.info('WEAPON_STRENGTHEN', 'power=' + (totalAttrItems['21'] ? totalAttrItems['21']._num : '?'));
            }

            // Only include _changeInfo if there are actual item changes
            var hasChange = false;
            for (var ck in changeItems) { if (changeItems.hasOwnProperty(ck)) { hasChange = true; break; } }
            if (hasChange) {
                response._changeInfo = { _items: changeItems };
            }

            // Send response FIRST
            callback(response);

            // Update weapon _attrs for UI display (AFTER callback, to avoid corrupting response)
            updateWeaponAttrsForUI(weaponData);
            db._set(key, savedData);

        } catch (err) {
            log.error('WEAPON_STRENGTHEN', 'UNCAUGHT: ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback({
                heroId: String((request && request.heroId) || ''),
                _weapon: { _weaponId: String((request && request.weaponId) || ''), _displayId: 0, _level: 1, _star: 0, _heroId: String((request && request.heroId) || '') },
                _delWeapons: {}
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER — handles BOTH "strengthen" AND "autoStrengthen"
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('weapon', 'strengthen', handleWeaponStrengthen);
    MainServer.registerHandler('weapon', 'autoStrengthen', handleWeaponStrengthen);

})();