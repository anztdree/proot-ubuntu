/**
 * weapon/wear.js — Weapon Wear Handler (v5 — SELF-CONTAINED)
 * Super Warrior Z — MAIN SERVER
 *
 * Client call (main.min.js L174612-174624):
 *   ts.processHandler({
 *     type: "weapon", action: "wear",
 *     userId, heroId, weaponId, version: "1.0"
 *   }, function(e) {
 *     EquipInfoManager.wearWeaponCallBack(e),        // L82772-82774
 *     HerosManager.setTotalAttrsByHeroId(e, e.heroId), // L85171 → L85204
 *     WeaponAttrManager.initWeaponAttr()               // L88007
 *   })
 *
 * Client expects in response:
 *   heroId, weaponId, _oldWeaponId, _heroTotalAttr: { _items: { "0":{_id,_num}, ... } }
 *
 * setTotalAttrs (L85201-85230):
 *   e._heroTotalAttr._items → OVERWRITE hero.totalAttr[id] = {id, num}
 *   id==21 → hero.heroBaseAttr.power = Math.floor(_num)
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

        // Evolve bonuses
        for (var ei = 0; ei < evEntries.length; ei++) {
            var ev = evEntries[ei];
            if (evolveLevel >= (ev.level || 0)) {
                stats.hp += Number(ev.hp) || 0;
                stats.attack += Number(ev.attack) || 0;
                stats.armor += Number(ev.armor) || 0;
                stats.speed += Number(ev.speed) || 0;
            }
        }

        // WakeUp/Star bonuses
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

        // Base stats: level × type × quality × balance
        stats.hp += ((Number(la.hp)||0) * (Number(tp.hpParam)||0) + (Number(tp.hpBais)||0)) * (Number(qp.hpParam)||1) * (Number(hc.balanceHp)||1);
        stats.attack += ((Number(la.attack)||0) * (Number(tp.attackParam)||0) + (Number(tp.attackBais)||0)) * (Number(qp.attackParam)||1) * (Number(hc.balanceAttack)||1);
        stats.armor += ((Number(la.armor)||0) * (Number(tp.armorParam)||0) + (Number(tp.armorBais)||0)) * (Number(qp.armorParam)||1) * (Number(hc.balanceArmor)||1);

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
            else if (id === 21) continue; // power nanti
            else if (id === 22) val = totalHp;
            else {
                val = rawStats[name];
                if (val === undefined) val = 0;
                if (equipFlatStats[id] !== undefined) val += Number(equipFlatStats[id]) || 0;
            }

            items[String(id)] = { _id: id, _num: val };
        }

        // Compute power
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
    //  WEAPON LEVEL-UP STATS
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
    //  WEAPON FINDER
    // ═══════════════════════════════════════════════════════════

    function findEquippedWeapon(savedData, heroId) {
        if (!savedData.weapon || !savedData.weapon._items) return null;
        var items = savedData.weapon._items;
        for (var wid in items) {
            if (!items.hasOwnProperty(wid)) continue;
            if (String(items[wid]._heroId) === String(heroId)) {
                return { weaponId: wid, weaponData: items[wid] };
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD _heroTotalAttr WITH WEAPON STATS
    // ═══════════════════════════════════════════════════════════

    function buildHeroTotalAttr(savedData, heroId, weaponData) {
        // 1. Cari hero
        var found = findHeroInStorage(savedData, heroId);
        if (!found || !found.hero) return null;

        var hero = found.hero;
        var displayId = hero._heroDisplayId || Number(hero._heroId);
        var baseAttr = hero._heroBaseAttr || {};
        var level = Number(baseAttr._level) || 1;
        var evolveLevel = Number(baseAttr._evolveLevel) || 0;
        var starLevel = Number(hero._heroStar) || 0;

        // 2. Compute raw base stats
        var rawStats = computeRawBaseStats(displayId, level, evolveLevel, starLevel);
        if (!rawStats) return null;

        // 3. Get equip flat stats
        var equipFlat = getHeroEquippedFlatStats(savedData, heroId);

        // 4. Build 42-item total attr (base + equip, with power)
        var items = buildTotalAttrItems(rawStats, equipFlat);

        // 5. Get weapon flat attack from weaponStrengthen.json
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

        // 6. Get weapon level-up stats (% + flat bonuses)
        var wlu = getWeaponLevelUpStats(wDisplayId, Number(weaponData._star) || 0);

        // 7. Apply weapon stats to items
        var hp  = Number(items['0']  && items['0']._num)  || 0;
        var atk = Number(items['1']  && items['1']._num)  || 0;
        var arm = Number(items['2']  && items['2']._num)  || 0;

        // HP: multiply weapon hpPercent
        if (wlu.hpPercent !== 0) hp *= (1 + wlu.hpPercent);

        // ATK: add weapon flat attack, then multiply weapon attackPercent
        atk += weaponAtk;
        if (wlu.attackPercent !== 0) atk *= (1 + wlu.attackPercent);

        // ARM: multiply weapon armorPercent
        if (wlu.armorPercent !== 0) arm *= (1 + wlu.armorPercent);

        // Write back modified core stats
        items['0']  = { _id: 0,  _num: hp };
        items['1']  = { _id: 1,  _num: atk };
        items['2']  = { _id: 2,  _num: arm };
        items['22'] = { _id: 22, _num: hp }; // orghp

        // Percentage attrs: equip% + weapon%
        var hpP  = (Number(items['17'] && items['17']._num) || 0) + wlu.hpPercent;
        var armP = (Number(items['18'] && items['18']._num) || 0) + wlu.armorPercent;
        var atkP = (Number(items['19'] && items['19']._num) || 0) + wlu.attackPercent;
        items['17'] = { _id: 17, _num: hpP };
        items['18'] = { _id: 18, _num: armP };
        items['19'] = { _id: 19, _num: atkP };

        // Flat bonuses from weaponLevelUp (critical, dodge, block, speed, etc)
        for (var attrId in wlu.flatStats) {
            var existing = Number(items[attrId] && items[attrId]._num) || 0;
            items[attrId] = { _id: Number(attrId), _num: existing + wlu.flatStats[attrId] };
        }

        // 8. RECOMPUTE POWER with weapon stats included
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

    function handleWeaponWear(request, callback) {
        try {
            var userId   = request && request.userId;
            var heroId   = request && request.heroId;
            var weaponId = request && request.weaponId;

            log.info('WEAPON_WEAR', 'START');

            if (!userId || !heroId || !weaponId) {
                callback({ heroId: String(heroId||''), weaponId: String(weaponId||''), _oldWeaponId: '' });
                return;
            }

            var key = userStorageKey(userId);
            var savedData = db._get(key);
            if (!savedData) {
                callback({ heroId: String(heroId), weaponId: String(weaponId), _oldWeaponId: '' });
                return;
            }

            if (!savedData.weapon) savedData.weapon = { _items: {} };
            if (!savedData.weapon._items) savedData.weapon._items = {};

            var targetWeapon = savedData.weapon._items[String(weaponId)];
            if (!targetWeapon) {
                callback({ heroId: String(heroId), weaponId: String(weaponId), _oldWeaponId: '' });
                return;
            }

            if (targetWeapon._heroId && String(targetWeapon._heroId) !== String(heroId)) {
                callback({ heroId: String(heroId), weaponId: String(weaponId), _oldWeaponId: '' });
                return;
            }

            // NO-OP: weapon already on this hero
            if (String(targetWeapon._heroId) === String(heroId)) {
                var noopItems = buildHeroTotalAttr(savedData, heroId, targetWeapon);
                callback({
                    heroId: String(heroId),
                    weaponId: String(weaponId),
                    _oldWeaponId: '',
                    _heroTotalAttr: noopItems ? { _items: noopItems } : undefined
                });
                updateWeaponAttrsForUI(targetWeapon);
                db._set(key, savedData);
                return;
            }

            // Take off old weapon
            var oldWeaponEntry = findEquippedWeapon(savedData, heroId);
            var oldWeaponId = '';
            if (oldWeaponEntry) {
                oldWeaponId = String(oldWeaponEntry.weaponId);
                oldWeaponEntry.weaponData._heroId = '';
                log.arrow('old weapon removed: ' + oldWeaponId);
            }

            // Equip new weapon
            targetWeapon._heroId = String(heroId);
            log.arrow('weapon equipped: ' + weaponId
                + ' (displayId=' + (targetWeapon._displayId || '?')
                + ', star=' + (targetWeapon._star || 0)
                + ', level=' + (targetWeapon._level || 1) + ')');

            // Save
            db._set(key, savedData);

            // Build response with _heroTotalAttr
            var totalAttrItems = buildHeroTotalAttr(savedData, heroId, targetWeapon);

            var response = {
                heroId: String(heroId),
                weaponId: String(weaponId),
                _oldWeaponId: oldWeaponId
            };

            if (totalAttrItems) {
                response._heroTotalAttr = { _items: totalAttrItems };
                log.info('WEAPON_WEAR', 'SUCCESS — power=' + (totalAttrItems['21'] ? totalAttrItems['21']._num : '?'));
            }

            callback(response);

            // Update weapon _attrs for UI display (after response)
            updateWeaponAttrsForUI(targetWeapon);
            db._set(key, savedData);

        } catch (err) {
            log.error('WEAPON_WEAR', 'UNCAUGHT: ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback({
                heroId: String((request && request.heroId) || ''),
                weaponId: String((request && request.weaponId) || ''),
                _oldWeaponId: ''
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('weapon', 'wear', handleWeaponWear);

})();