/**
 * weapon/upgrade.js — Weapon Star Up (Upgrade) Handler (v2)
 * Super Warrior Z — MAIN SERVER
 *
 * Client call (main.min.js L175190-175209):
 *   ts.processHandler({
 *     type: "weapon", action: "upgrade",
 *     userId, heroId, weaponId, version: "1.0"
 *   }, function(t) {
 *     // t._openType == 1 → Logger.serverDebugLog (no action)
 *     // t._openType == 2 → UIWindowManager.openMoneyNotEnough(starUpCostID1)
 *     // TimeBonusOpenType: { OPEN_TIME_BONUS:1, OPEN_TIPS:2 }
 *
 *     if(t._changeInfo) {
 *       var o = EquipInfoManager.getInstance().resetWeaponData(t);
 *       // resetWeaponData (L82784-82791):
 *       //   n = WeaponDataArray[t._weapon._weaponId]
 *       //   for(o in t._delWeapons) delete WeaponDataArray[t._delWeapons[o]]
 *       //   n.deserialize(t._weapon)
 *
 *       HerosManager.getInstance().setTotalAttrsByHeroId(t, t.heroId)
 *       ItemsCommonSingleton.getInstance().resetTtemsCallBack(t)
 *       UIWindowManager.openHeroAttrChange()
 *       e.checkNextState(o)
 *       e.processButton("starUpBtn", e.starUpBtn)
 *     }
 *   })
 *
 * ── STAR UP FLOW (main.min.js) ──
 *
 * 1. starUpBtnTap (L175176-175189):
 *    - o = getNextWeaponStarInfo(n.displayId, n.star)
 *      → weaponLevelUp[displayId][star + 1]  OR
 *        if null AND weapon[displayId].Deification → weaponLevelUp[Deification][0]
 *    - Client pre-checks (server should also validate):
 *      a. o exists (next star config)
 *      b. User level >= o.playerlevel (red weapons only)
 *      c. starUpCost1Enough: getItemNum(costID1) >= num1
 *      d. starUpCost2Enough: getWeaponNumByDisplayerIdAndStar(costID2, 0, weaponId) >= num2
 *      e. For orange star=5: need >=5 orange weapon count + playerlevel + confirmation dialog
 *    - Server receives ONLY: { type, action, userId, heroId, weaponId, version }
 *
 * 2. Config: weaponLevelUp.json[displayId] = Array of 6 entries (level 0-5)
 *    Per entry:
 *    {
 *      id, name, quality,
 *      level: <starLevel>,           ← "level" field = star level (0-5)
 *      costID1, num1,                 ← material item cost (item ID in inventory)
 *      costID2, num2,                 ← food weapon (displayId of weapon to consume)
 *      attackPercent, hpPercent, armorPercent,
 *      critical, dodge, block, speed, criticalDamage, criticalResist,
 *      playerlevel: <optional>,       ← required player level (red weapons only)
 *      resolveID1, resolveNum1,       ← resolve reward (client IGNORES these)
 *      resolveID2, resolveNum2        ← resolve reward 2 (red weapons, levels 1-5 only, client IGNORES)
 *    }
 *    NOTE: Level 5 entries have NO cost fields (max star, no upgrade beyond).
 *    NOTE: No costID3/costID4 exists in weaponLevelUp.json.
 *    NOTE: resolveID/resolveNum are NOT consumed and NOT sent to client.
 *
 * 3. weapon.json[displayId].Deification (orange→red):
 *    - Only orange weapons (4401-4406) have this field → points to red (4407-4412)
 *    - Orange star=5 + no next config → lookup weaponLevelUp[Deification][0] for cost
 *    - After upgrade: displayId=Deification, star=0, level KEPT
 *    - Client derives quality from weapon.json[newDisplayId].quality → auto becomes "red"
 *
 * 4. Food weapon criteria (L82725-82732):
 *    heroId == "" (unequipped), displayId == costID2, star == 0, level == 1,
 *    no haloId, NOT the weapon being upgraded (excludeWeaponId)
 *
 * ── CONSTANTS ──
 *   WEAPONFULLSTAR = 5 (L79232)
 *   WEAPON_QUAILTY.ORGANE = 4 (L88051-88054, typo in client)
 *   TimeBonusOpenType.OPEN_TIME_BONUS = 1 (L79264)
 *   TimeBonusOpenType.OPEN_TIPS = 2 (L79264)
 *   PLAYERLEVELID = 104 (item ID for player level in totalProps)
 *
 * ── RESPONSE FORMAT ──
 * {
 *   heroId: String,
 *   _weapon: <WeaponDataModel>,              // resetWeaponData reads this
 *   _delWeapons: { "weaponId1": 1, ... },    // weapons consumed as food
 *   _heroTotalAttr: { _items: { "0":{_id,_num}, ... } },
 *   _changeInfo: { _items: { "<itemId>":{_id, _num:<ABSOLUTE>}, ... } },
 *   _openType: <optional, 1 or 2>            // only when cost insufficient
 * }
 *
 * WeaponDataModel fields (deserialize L88017-88049):
 *   _weaponId, _displayId, _heroId, _star, _level,
 *   _attrs: { _items: { "1":{_id:1, _num:<attack>}, ... } },
 *   _strengthenCost: { _items: {} },
 *   _haloId, _haloLevel,
 *   _haloCost: { _items: {} }
 *   Quality is NOT sent — client derives from weapon.json[displayId].quality
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
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var PLAYERLEVELID = 104;       // item ID that stores player level
    var WEAPONFULLSTAR = 5;
    var WQ_ORGANE = 4;             // WEAPON_QUAILTY.ORGANE
    var OPEN_TIME_BONUS = 1;       // TimeBonusOpenType.OPEN_TIME_BONUS
    var OPEN_TIPS = 2;             // TimeBonusOpenType.OPEN_TIPS

    // ═══════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
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
    //  ATTRIBUTE ID MAPPING (0-41) — dari getAttrs.js / wear.js / strengthen.js
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
    //  BUILD 42-ITEM TOTAL ATTR
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

    // weaponLevelUp.json field → attr ID mapping
    var WLU_ATTR_MAP = {
        'critical':9, 'criticalDamage':11, 'criticalResist':10,
        'block':6, 'dodge':5, 'speed':3,
        'attackPercent':19, 'hpPercent':17, 'armorPercent':18
    };

    var WLU_FLAT_ATTR_MAP = {
        'critical':9, 'criticalDamage':11, 'criticalResist':10,
        'block':6, 'dodge':5, 'speed':3
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
    //  UPDATE WEAPON _attrs._items FOR STORAGE (after callback)
    //  Adds star-up % bonuses to _attrs for next login/deserialize
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
    //  ITEM INVENTORY HELPERS
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

        if (weaponData._attrs && weaponData._attrs._items) {
            obj._attrs = { _items: {} };
            for (var k in weaponData._attrs._items) {
                if (!weaponData._attrs._items.hasOwnProperty(k)) continue;
                var src = weaponData._attrs._items[k];
                obj._attrs._items[k] = { _id: Number(src._id), _num: Number(src._num) || 0 };
            }
        }

        if (weaponData._strengthenCost && weaponData._strengthenCost._items) {
            obj._strengthenCost = { _items: {} };
            for (var k2 in weaponData._strengthenCost._items) {
                if (!weaponData._strengthenCost._items.hasOwnProperty(k2)) continue;
                var src2 = weaponData._strengthenCost._items[k2];
                obj._strengthenCost._items[k2] = { _id: Number(src2._id), _num: Number(src2._num) || 0 };
            }
        }

        if (weaponData._haloCost && weaponData._haloCost._items) {
            obj._haloCost = { _items: {} };
            for (var k3 in weaponData._haloCost._items) {
                if (!weaponData._haloCost._items.hasOwnProperty(k3)) continue;
                var src3 = weaponData._haloCost._items[k3];
                obj._haloCost._items[k3] = { _id: Number(src3._id), _num: Number(src3._num) || 0 };
            }
        }

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

        // Weapon level-up (star) stats
        var wlu = getWeaponLevelUpStats(wDisplayId, Number(weaponData._star) || 0);

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
    //  GET NEXT STAR CONFIG
    //  Mirrors client getNextWeaponStarInfo (L83810-83816):
    //   weaponLevelUp[displayId][star + 1]
    //   If null/undefined: check weapon.json[displayId].Deification
    //     → weaponLevelUp[Deification][0]
    //
    //  weaponLevelUp.json structure: { displayId: [ {level:0,...}, {level:1,...}, ..., {level:5,...} ] }
    //  The array is always 6 entries indexed 0-5, corresponding to star levels.
    // ═══════════════════════════════════════════════════════════

    function getNextWeaponStarInfo(displayId, currentStar) {
        var wlu = loadJson('weaponLevelUp');
        if (!wlu) return null;

        var nextStar = Number(currentStar) + 1;

        // Try weaponLevelUp[displayId][nextStar]
        var entries = wlu[String(displayId)];
        if (entries && Array.isArray(entries)) {
            for (var i = 0; i < entries.length; i++) {
                if (Number(entries[i].level) === nextStar) {
                    return { _deification: false, _config: entries[i] };
                }
            }
        }

        // No next star → check Deification (only for orange star=5)
        if (Number(currentStar) !== WEAPONFULLSTAR) return null;

        var wc = loadJson('weapon');
        if (!wc) return null;
        var weaponCfg = wc[String(displayId)];
        if (!weaponCfg || !weaponCfg.Deification) return null;

        var deifId = weaponCfg.Deification;
        var defEntries = wlu[String(deifId)];
        if (defEntries && Array.isArray(defEntries) && defEntries.length > 0) {
            // Return star 0 config of deification weapon
            return { _deification: true, _deificationId: deifId, _config: defEntries[0] };
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  GET WEAPON QUALITY (numeric) from weapon.json
    // ═══════════════════════════════════════════════════════════

    var QUALITY_MAP = { 'white':0, 'green':1, 'blue':2, 'purple':3, 'orange':4, 'red':5 };

    function getWeaponQualityNum(displayId) {
        var wc = loadJson('weapon');
        if (!wc) return 0;
        var cfg = wc[String(displayId)];
        if (!cfg || !cfg.quality) return 0;
        return QUALITY_MAP[cfg.quality] || 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  FIND FOOD WEAPONS
    //  Mirrors getWeaponNumByDisplayerIdAndStar (L82725-82732):
    //   Count/select unequipped weapons matching displayId, star=0, level=1,
    //   no haloId, excluding the weapon being upgraded
    //
    //  NOTE: Client code has an operator precedence bug where weapons with
    //  haloId get incorrectly counted. We implement the CORRECT logic.
    // ═══════════════════════════════════════════════════════════

    function findFoodWeapons(savedData, foodDisplayId, excludeWeaponId, neededCount) {
        var foodList = [];
        if (!savedData.weapon || !savedData.weapon._items) return foodList;

        var items = savedData.weapon._items;
        for (var wid in items) {
            if (!items.hasOwnProperty(wid)) continue;
            if (String(wid) === String(excludeWeaponId)) continue;  // exclude self

            var w = items[wid];
            // Must be unequipped
            if (String(w._heroId) !== '') continue;
            // Must NOT have halo (circle-upgraded weapons can't be food)
            if (w._haloId && Number(w._haloId) !== 0) continue;
            // Must match displayId, star=0, level=1
            if (Number(w._displayId) !== Number(foodDisplayId)) continue;
            if (Number(w._star) !== 0) continue;
            if (Number(w._level) !== 1) continue;

            foodList.push(wid);

            if (foodList.length >= neededCount) break;  // enough found
        }
        return foodList;
    }

    // ═══════════════════════════════════════════════════════════
    //  REBUILD WEAPON _attrs._items FOR NEW DISPLAY ID
    //  After deification: weapon changes displayId → need new base attack
    //  from weaponStrengthen.json at current level.
    //  Also clears _strengthenCost (new weapon type, no history).
    // ═══════════════════════════════════════════════════════════

    function rebuildWeaponAttrsForNewDisplayId(weaponData, newDisplayId) {
        var level = Number(weaponData._level) || 1;

        // Get base attack for new displayId at current level
        var attack = 0;
        var ws = loadJson('weaponStrengthen');
        if (ws) {
            for (var k in ws) {
                if (!ws.hasOwnProperty(k)) continue;
                if (Number(ws[k].weapon) === Number(newDisplayId) && Number(ws[k].level) === level) {
                    attack = Number(ws[k].attack) || 0;
                    break;
                }
            }
        }

        weaponData._attrs = { _items: {} };
        weaponData._attrs._items['1'] = { _id: 1, _num: attack };

        // Clear strengthenCost (new weapon type, fresh strengthen history)
        weaponData._strengthenCost = { _items: {} };
    }

    // ═══════════════════════════════════════════════════════════
    //  FAIL RESPONSE HELPER
    // ═══════════════════════════════════════════════════════════

    function failResponse(heroId, weaponId, weaponData, openType) {
        var resp = {
            heroId: String(heroId || ''),
            _weapon: weaponData ? serializeWeaponForResponse(weaponId, weaponData) : {
                _weaponId: String(weaponId || ''), _displayId: 0, _level: 1, _star: 0, _heroId: String(heroId || '')
            },
            _delWeapons: {}
        };
        if (openType) resp._openType = openType;
        return resp;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleWeaponUpgrade(request, callback) {
        try {
            var userId   = request && request.userId;
            var heroId   = request && request.heroId;
            var weaponId = request && request.weaponId;

            log.info('WEAPON_UPGRADE', 'START (userId=' + (userId || '-') + ')');

            // ── VALIDATION ──
            if (!userId || !heroId || !weaponId) {
                log.error('WEAPON_UPGRADE', 'missing params: userId=' + !!userId
                    + ' heroId=' + !!heroId + ' weaponId=' + !!weaponId);
                callback(failResponse(heroId, weaponId, null));
                return;
            }

            var key = userStorageKey(userId);
            var savedData = db._get(key);
            if (!savedData) {
                log.error('WEAPON_UPGRADE', 'user data not found: ' + key);
                callback(failResponse(heroId, weaponId, null));
                return;
            }

            // ── FIND WEAPON ──
            if (!savedData.weapon) savedData.weapon = { _items: {} };
            if (!savedData.weapon._items) savedData.weapon._items = {};

            var weaponData = savedData.weapon._items[String(weaponId)];
            if (!weaponData) {
                log.error('WEAPON_UPGRADE', 'weapon not found in storage: ' + weaponId);
                callback(failResponse(heroId, weaponId, null));
                return;
            }

            var wDisplayId = Number(weaponData._displayId) || 0;
            var currentStar = Number(weaponData._star) || 0;
            var wLevel = Number(weaponData._level) || 1;

            log.details('WEAPON_UPGRADE', [
                ['weaponId', String(weaponId)],
                ['displayId', String(wDisplayId)],
                ['currentStar', String(currentStar)],
                ['level', String(wLevel)],
                ['heroId', String(weaponData._heroId)]
            ]);

            // ── GET NEXT STAR CONFIG ──
            var nextStarInfo = getNextWeaponStarInfo(wDisplayId, currentStar);
            if (!nextStarInfo) {
                log.arrow('no next star config — weapon already at max star or no config');
                callback(failResponse(heroId, weaponId, weaponData));
                return;
            }

            var isDeification = !!nextStarInfo._deification;
            var starConfig = nextStarInfo._config;
            var deificationId = isDeification ? nextStarInfo._deificationId : null;

            log.arrow('nextStarConfig: level=' + starConfig.level
                + (isDeification ? ' (DEIFICATION -> ' + deificationId + ')' : '')
                + ' costID1=' + starConfig.costID1 + ' num1=' + starConfig.num1
                + ' costID2=' + starConfig.costID2 + ' num2=' + starConfig.num2
                + ' playerlevel=' + (starConfig.playerlevel || 'none'));

            // ── CHECK PLAYER LEVEL (red weapons have playerlevel requirement) ──
            // Client pre-checks this (L175183-175188), but server must validate too.
            if (starConfig.playerlevel) {
                var userLevel = getItemNum(savedData, PLAYERLEVELID);
                if (userLevel < Number(starConfig.playerlevel)) {
                    log.arrow('playerLevel ' + userLevel + ' < required ' + starConfig.playerlevel + ' -> reject');
                    callback(failResponse(heroId, weaponId, weaponData));
                    return;
                }
            }

            // ── CHECK & DEDUCT COST1 (material item) ──
            var changeItems = {};
            var costId1 = starConfig.costID1;
            var costNum1 = Number(starConfig.num1) || 0;

            if (costId1 !== undefined && costId1 !== null && Number(costId1) !== 0 && costNum1 > 0) {
                costId1 = Number(costId1);
                var haveCost1 = getItemNum(savedData, costId1);

                if (haveCost1 < costNum1) {
                    log.arrow('cost1 not enough: item ' + costId1 + ' have=' + haveCost1 + ' need=' + costNum1
                        + ' -> _openType=' + OPEN_TIME_BONUS);
                    // _openType=1: client logs "道具不足,需要弹限时礼包" but takes no action
                    callback(failResponse(heroId, weaponId, weaponData, OPEN_TIME_BONUS));
                    return;
                }

                deductItem(savedData, costId1, costNum1);
                changeItems[String(costId1)] = { _id: costId1, _num: getItemNum(savedData, costId1) };
                log.arrow('cost1 deducted: item ' + costId1 + ' x' + costNum1 + ' (balance now: ' + getItemNum(savedData, costId1) + ')');
            }

            // ── CHECK & CONSUME COST2 (food weapons) ──
            var delWeapons = {};
            var costId2 = starConfig.costID2;
            var costNum2 = Number(starConfig.num2) || 0;

            if (costId2 !== undefined && costId2 !== null && Number(costId2) !== 0 && costNum2 > 0) {
                costId2 = Number(costId2);
                var foodWeapons = findFoodWeapons(savedData, costId2, weaponId, costNum2);

                if (foodWeapons.length < costNum2) {
                    log.arrow('cost2 (food weapons) not enough: have=' + foodWeapons.length
                        + ' need=' + costNum2 + ' (displayId=' + costId2 + ') -> _openType=' + OPEN_TIPS);

                    // Refund cost1 if already deducted
                    if (changeItems[String(Number(starConfig.costID1))]) {
                        var refundId = Number(starConfig.costID1);
                        var currentBal = getItemNum(savedData, refundId);
                        setItemNum(savedData, refundId, currentBal + costNum1);
                        log.arrow('refunded cost1: item ' + refundId + ' x' + costNum1);
                    }

                    // _openType=2: client opens MaterialNotEnoughTips for starUpCostID1
                    callback(failResponse(heroId, weaponId, weaponData, OPEN_TIPS));
                    return;
                }

                // Consume food weapons
                for (var fi = 0; fi < foodWeapons.length; fi++) {
                    var foodWid = foodWeapons[fi];
                    delWeapons[foodWid] = 1;  // mark for deletion in _delWeapons
                    delete savedData.weapon._items[foodWid];  // remove from server storage
                }
                log.arrow('cost2 consumed: ' + foodWeapons.length + ' food weapons (displayId=' + costId2 + ')');
            }

            // ── PERFORM STAR UP ──
            if (isDeification) {
                // DEIFICATION: orange star=5 → red weapon
                // displayId changes, star resets to 0, level is KEPT (L175254-175255)
                var oldDisplayId = wDisplayId;
                weaponData._displayId = deificationId;
                weaponData._star = 0;

                // Rebuild _attrs for new displayId (new base attack from weaponStrengthen.json)
                rebuildWeaponAttrsForNewDisplayId(weaponData, deificationId);

                log.info('WEAPON_UPGRADE', 'DEIFICATION: ' + oldDisplayId + ' -> ' + deificationId
                    + ' (level kept=' + weaponData._level + ', star reset=0)');
            } else {
                // NORMAL STAR UP: increment star
                weaponData._star = currentStar + 1;
                log.info('WEAPON_UPGRADE', 'star ' + currentStar + ' -> ' + weaponData._star);
            }

            // ══════════════════════════════════════════════════════
            //  TASK CHECK — refineWeaponQuality
            // ══════════════════════════════════════════════════════
            //  2 jenis task yang terkait weapon upgrade (star-up):
            //
            //  1. MAIN TASK (task.json #6043):
            //     { taskType:"refineWeaponQuality", taskPara1:1, taskPara2:1 }
            //     = refine/upgrade 1 weapon (taskPara1) sampai star >= taskPara2
            //     Jika curMainTask[0]._state === DOING(1) dan kondisi terpenuhi
            //     → set _state = COMPLETE(2) + push mainTaskChange notify
            //
            //  2. ACHIEVEMENT (taskAchievement.json chain 6391→6392→6393):
            //     6391: taskPara1=1, taskPara2=1 → 1 weapon star >= 1
            //     6392: taskPara1=1, taskPara2=3 → 1 weapon star >= 3
            //     6393: taskPara1=1, taskPara2=5 → 1 weapon star >= 5
            //     Walk chain, find active (non-FINISH), increment _curCount,
            //     set COMPLETE jika _curCount >= taskPara1.
            //
            //  Pola: sama dengan hero/resolve.js & backpack/randSummons.js
            // ══════════════════════════════════════════════════════

            var newStar = Number(weaponData._star) || 0;
            var taskUpdated = false;
            var achievementUpdated = false;

            // ── MAIN TASK CHECK ──
            try {
                var cmt = savedData.curMainTask;
                var canCheckTask = cmt && Array.isArray(cmt) && cmt.length > 0
                    && Number(cmt[0]._state) === 1; // TASK_STATE.DOING

                if (canCheckTask) {
                    var taskCfg = loadJson('task');
                    if (taskCfg) {
                        var mainTaskDef = taskCfg[String(cmt[0]._id)];
                        if (mainTaskDef && mainTaskDef.taskType === 'refineWeaponQuality') {
                            var needCount = Number(mainTaskDef.taskPara1) || 1;
                            var targetStar = Number(mainTaskDef.taskPara2) || 1;

                            // Count weapons in inventory with star >= targetStar
                            var refinedCount = 0;
                            var allWeapons = savedData.weapon && savedData.weapon._items;
                            if (allWeapons) {
                                for (var wk in allWeapons) {
                                    if (!allWeapons.hasOwnProperty(wk)) continue;
                                    var wStar = Number(allWeapons[wk]._star) || 0;
                                    if (wStar >= targetStar) {
                                        refinedCount++;
                                    }
                                }
                            }

                            if (refinedCount >= needCount) {
                                cmt[0]._state = 2; // TASK_STATE.COMPLETE
                                taskUpdated = true;

                                log.info('TASK', 'weapon/upgrade — Main task '
                                    + cmt[0]._id + ' (refineWeaponQuality) DOING → COMPLETE'
                                    + ' (weapons with star>=' + targetStar + ': ' + refinedCount + '/' + needCount + ')');
                            } else {
                                log.info('TASK', 'weapon/upgrade — refineWeaponQuality not yet — '
                                    + refinedCount + '/' + needCount + ' weapons at star>=' + targetStar);
                            }
                        }
                    }
                }
            } catch (taskErr) {
                log.error('TASK', 'weapon/upgrade — main task check error: '
                    + (taskErr && taskErr.message || taskErr));
            }

            // ── ACHIEVEMENT CHECK (chain 6391→6392→6393) ──
            try {
                if (savedData._taskProgress && savedData._taskProgress._achievements) {
                    var achieveCfg = loadJson('taskAchievement');
                    if (achieveCfg) {
                        // Walk chain 6391 → 6392 → 6393, find first non-FINISH
                        var chainStart = '6391';
                        var currentAchId = chainStart;
                        var activeAchId = null;
                        var activeAchEntry = null;
                        var activeAchCfg = null;
                        var achSafety = 0;

                        while (currentAchId && achieveCfg[currentAchId] && achSafety < 10) {
                            achSafety++;
                            var achEntry = savedData._taskProgress._achievements[currentAchId];
                            if (!achEntry) {
                                // Not initialized yet — skip (getReward will init)
                                break;
                            }
                            if (Number(achEntry._state) !== 3) { // not FINISH
                                activeAchId = currentAchId;
                                activeAchEntry = achEntry;
                                activeAchCfg = achieveCfg[currentAchId];
                                break;
                            }
                            // FINISH → move to next in chain
                            var nextAchId = achieveCfg[currentAchId].nextTaskID;
                            currentAchId = nextAchId ? String(nextAchId) : null;
                        }

                        if (activeAchEntry && activeAchCfg && activeAchCfg.taskType === 'refineWeaponQuality') {
                            var achTargetStar = Number(activeAchCfg.taskPara2) || 1;
                            var achNeedCount = Number(activeAchCfg.taskPara1) || 1;

                            // Count weapons in inventory with star >= achTargetStar
                            var achRefinedCount = 0;
                            var achAllWeapons = savedData.weapon && savedData.weapon._items;
                            if (achAllWeapons) {
                                for (var awk in achAllWeapons) {
                                    if (!achAllWeapons.hasOwnProperty(awk)) continue;
                                    var awStar = Number(achAllWeapons[awk]._star) || 0;
                                    if (awStar >= achTargetStar) {
                                        achRefinedCount++;
                                    }
                                }
                            }

                            var achOldCount = Number(activeAchEntry._curCount) || 0;
                            activeAchEntry._curCount = achRefinedCount;

                            if (achRefinedCount >= achNeedCount && Number(activeAchEntry._state) < 2) {
                                activeAchEntry._state = 2; // COMPLETE
                            }

                            achievementUpdated = true;
                            log.info('TASK', 'weapon/upgrade — Achievement '
                                + activeAchId + ' (refineWeaponQuality) _curCount: '
                                + achOldCount + ' → ' + achRefinedCount
                                + ' / ' + achNeedCount + ' (star>=' + achTargetStar + ')'
                                + ' (state=' + activeAchEntry._state + ')');
                        } else {
                            log.info('TASK', 'weapon/upgrade — No active refineWeaponQuality achievement found'
                                + (activeAchId ? ' (activeId=' + activeAchId + ' but not refineWeaponQuality)' : ' (all FINISH or not initialized)'));
                        }
                    }
                } else {
                    log.info('TASK', 'weapon/upgrade — _taskProgress._achievements not initialized, skipping achievement check');
                }
            } catch (achErr) {
                log.error('TASK', 'weapon/upgrade — achievement check error: '
                    + (achErr && achErr.message || achErr));
            }

            // ── SAVE USER DATA (termasuk perubahan curMainTask & achievement) ──
            db._set(key, savedData);
            log.arrow('saved' + (taskUpdated ? ' [main task updated]' : '') + (achievementUpdated ? ' [achievement updated]' : ''));

            // ── PUSH mainTaskChange NOTIFY (setelah save agar state konsisten) ──
            // Format: { action:'mainTaskChange', _curMainTask:[{_id, _state}] }
            // Client L77080: setMianTask(e._curMainTask)
            if (taskUpdated && typeof MainServer.notify === 'function') {
                try {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{
                            _id: cmt[0]._id,
                            _state: 2 // TASK_STATE.COMPLETE
                        }]
                    });
                    log.info('TASK', 'weapon/upgrade — pushed mainTaskChange (state=2 COMPLETE)');
                } catch (notifyErr) {
                    log.error('TASK', 'weapon/upgrade — notify failed: '
                        + (notifyErr && notifyErr.message || notifyErr));
                }
            }

            // ── BUILD RESPONSE ──
            var response = {
                heroId: String(heroId),
                _weapon: serializeWeaponForResponse(weaponId, weaponData),
                _delWeapons: delWeapons
            };

            // _changeInfo: absolute item balances (material costs deducted)
            if (Object.keys(changeItems).length > 0) {
                response._changeInfo = { _items: changeItems };
            }

            // _heroTotalAttr: full 42-item attribute array with weapon stats applied
            var totalAttrItems = buildHeroTotalAttr(savedData, heroId, weaponData);
            if (totalAttrItems) {
                response._heroTotalAttr = { _items: totalAttrItems };
                log.arrow('new power=' + (totalAttrItems['21'] ? totalAttrItems['21']._num : '?'));
            }

            // Send response FIRST (client needs it immediately)
            callback(response);

            // After callback: update weapon _attrs for future storage/display
            updateWeaponAttrsForUI(weaponData);
            db._set(key, savedData);

            log.info('WEAPON_UPGRADE', 'SUCCESS — weaponId=' + weaponId
                + ' displayId=' + weaponData._displayId
                + ' star=' + weaponData._star
                + ' level=' + weaponData._level
                + ' delWeapons=' + Object.keys(delWeapons).length
                + ' changeItems=' + Object.keys(changeItems).length
                + (taskUpdated ? ' [MAIN_TASK_COMPLETE]' : '')
                + (achievementUpdated ? ' [ACHIEVEMENT_UPDATED]' : ''));

        } catch (err) {
            log.error('WEAPON_UPGRADE', 'UNCAUGHT: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback(failResponse(
                request && request.heroId,
                request && request.weaponId,
                null
            ));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('weapon', 'upgrade', handleWeaponUpgrade);

})();