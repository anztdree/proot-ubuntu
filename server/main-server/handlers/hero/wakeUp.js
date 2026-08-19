/**
 * handlers/hero/wakeUp.js — Hero WakeUp (Star Up) Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: hero/wakeUp
 * ============================================================
 *
 * Client call (main.min.js L124445-124453):
 *   ts.processHandler({
 *     type: 'hero',
 *     action: 'wakeUp',
 *     userId: r,
 *     heroId: t.choseHeroId,            // hero instance ID to star-up
 *     heros: o,                         // FLAT array of feeder hero IDs
 *     dragonPieceNum: a.dragonlist,     // array: [dragonUsed, 0, 0]
 *     selfPieceNum: a.selfPiecelist,    // array: [selfPieceUsed, 0, 0]
 *     version: '1.0'
 *   }, callback(response))
 *
 * Dipanggil saat:
 *   - Player menekan tombol "Star Up" di window HeroMainWakeUp (L124430)
 *   - NAIKKAN STAR hero (+1): star 0→1→2→...→9→10
 *   - Mengonsumsi: hero piece + dragon soul piece (material isPiece=1)
 *                  feeder heroes (material isPiece=0)
 *                  item cost (itemID/num4)
 *                  red item cost (redItemID/num5, hanya red entries)
 *
 * Response callback (main.min.js L124454-124482):
 *   1. Simpan state SEBELUM wakeup (beforeMaxLevel, beforTalent, dll)
 *   2. t._totalTalent → HerosManager.setHistoryQuaNum(t._totalTalent)
 *      (resonance system: sum talent semua hero player)
 *   3. HerosManager.WakeUpCallBack(t) — L85276-85286:
 *      a. SetHeroDataToModel(t._hero) → deserialize FULL hero data
 *         → update herosInfo[heroId]
 *      b. setTotalAttrs(t, hero, true) → update baseAttr + totalAttr
 *         → reads t._baseAttr._items OBJECT → setBaseAttr
 *         → reads t._heroTotalAttr._items → totalAttr
 *         → id==21 → heroBaseAttr.power = Math.floor(_num)
 *         → setTotalCost(t._totalCost, hero)
 *      c. for (o in t.heros) removeHeroFromList(t.heros[o])
 *      d. if t._linkHeroes → update linked heroes
 *   4. Build return items list (feeder hero equip & sign — from client memory)
 *   5. Update item balances: for d in t._changeInfo._items:
 *      setUserAttributeItem(g._id, g._num)  // ABSOLUTE balance!
 *   6. Open HeroWakeUpSuccess / HeroWakeUpGodSuccess window
 *   7. Close HeroMainWakeUp window
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 * {
 *   heroId: 'abc123',                // hero instance ID
 *   _hero: {                         // FULL hero object (dari savedData)
 *     _heroId: 'abc123',
 *     _heroDisplayId: 1203,
 *     _heroStar: 2,                  // STAR BARU (+1)
 *     _heroBaseAttr: {
 *       _level: 80,
 *       _evolveLevel: 60,
 *       _hp: 992.0,
 *       _attack: 412.5,
 *       _armor: 143.5,
 *       _speed: 376,
 *       _talent: 0.48,
 *       _power: 5000,
 *       ...                          // semua field lainnya
 *     },
 *     _heroTag: [...],
 *     _fragment: ...,
 *     _superSkillLevel: ...,
 *     _potentialLevel: ...,
 *     ...                            // semua field hero
 *   },
 *   _baseAttr: { _items: { ... } },        // 35 items, OBJECT
 *   _heroTotalAttr: { _items: { ... } },   // 42 items, OBJECT (dengan power)
 *   _totalCost: {
 *     _wakeUp:    { _items: { "2203":{_id:2203,_num:30}, "2600":{_id:2600,_num:10}, "501":{_id:501,_num:5} } },
 *     _earring:   { _items: {} },
 *     _levelUp:   { _items: {} },
 *     _evolve:    { _items: {} },
 *     _skill:     { _items: {} },
 *     _qigong:    { _items: {} },
 *     _heroBreak: { _items: {} }
 *   },
 *   _totalTalent: 2.15,                     // sum talent SEMUA hero player
 *   heros: ['feeder1', 'feeder2', ...],     // feeder hero IDs yang DIHAPUS
 *   _changeInfo: {                         // ABSOLUTE balances SETELAH deduction
 *     _items: {                            // OBJECT
 *       "2203": {_id:2203, _num:170},      // sisa hero piece
 *       "2600": {_id:2600, _num:4490},     // sisa dragon soul piece
 *       "501":  {_id:501,  _num:99995}     // sisa item cost
 *     }
 *   },
 *   _linkHeroesTotalAttr: {},
 *   _linkHeroesBasicAttr: {}
 * }
 *
 * GAGAL: callback({}) — client tidak update apa-apa
 *
 * ============================================================
 * JSON CONFIG YANG DIPAKAI:
 *   heroWakeUp.json        ✅ star-up entries (talent, hp, atk, armor, speed, cost)
 *   heroWakeUpRed.json     ✅ red star-up entries (star 6+, redItemID/num5)
 *   hero.json              ✅ quality, heroType, talent, balancePower, speed, dll
 *   heroLevelAttr.json     ✅ level → {hp, attack, armor}
 *   heroTypeParam.json     ✅ heroType → {hpParam, attackParam, armorParam, ...Bais}
 *   heroQualityParam.json  ✅ quality → {hpParam, attackParam, armorParam}
 *   heroPower.json         ✅ per stat per heroType: powerParam
 *   heroQualityPower.json  ✅ quality → {powerParam}
 *   heroEvolve.json        ✅ evolve bonuses (termasuk di computeRawBaseStats)
 *   equip.json             ✅ equip flat stats
 *   constant.json          ✅ dragonSoulPieceID = 2600
 * ============================================================
 *
 * HERO WAKEUP JSON STRUCTURE NOTES:
 *   heroWakeUp[displayId] bisa berupa:
 *     - DICT (single entry, star 1 only) — 10 heroes: 1201,1202,1206,1207,etc.
 *     - ARRAY (multiple entries, star 1-5) — 139 heroes
 *   heroWakeUpRed[displayId] selalu ARRAY (star 6-10)
 *   Client merge: heroWakeUp[id].concat(heroWakeUpRed[id]) — L53251-53255
 *
 *   Fields per entry:
 *     star: star level yang diberikan
 *     material1/2/3: item ID (hero piece jika isPiece=1) atau displayId hero (jika isPiece=0)
 *     isPiece1/2/3: 1=hero piece, 0=hero
 *     isRandom1/2/3: 0=hero spesifik, 1=random hero
 *     star1/2/3: minimum star feeder (jika isPiece=0)
 *     num1/2/3: jumlah yang dibutuhkan
 *     itemID: item cost ID
 *     num4: jumlah item cost
 *     redItemID: red item cost (hanya di heroWakeUpRed)
 *     num5: jumlah red item cost
 *     levelBound: max level setelah wakeup di star ini
 *     talent: talent BONUS (DITAMBAHKAN ke base talent dari hero.json)
 *     hp/attack/armor/speed: FLAT stat bonus
 *     skillLevel: level skill proactive setelah wakeup
 *     levelUp: skill ID yang di-level-up (opsional)
 *
 * DRAGON PIECE / SELF PIECE FORMAT (from request):
 *   dragonPieceNum = [dragonUsed_for_material1, 0, 0]
 *   selfPieceNum = [selfPieceUsed_for_material1, 0, 0]
 *   Total pieces needed = num1 = dragonPieceNum[0] + selfPieceNum[0]
 *   HANYA material1 yang pakai piece (isPiece=1)
 *   Material2/3 selalu hero feeder (isPiece=0) → client kirim ID di request.heros
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

    function getHeroWakeUpRed(heroId) {
        var wur = loadJsonSync('heroWakeUpRed');
        return wur ? wur[String(heroId)] : null;
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

    function getConstant() {
        var c = loadJsonSync('constant');
        return c ? c[1] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  EQUIP FLAT STAT HELPERS (same logic as autoLevelUp.js / evolve.js)
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
    //  STAT COMPUTATION (PLAYER formula — same as autoLevelUp.js / evolve.js)
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
        // Must normalize: wuEntries can be DICT (single entry) or ARRAY
        var wuList = Array.isArray(wuEntries) ? wuEntries : [wuEntries];
        var wuRedEntries = getHeroWakeUpRed(heroDisplayId) || [];
        var wuRedList = Array.isArray(wuRedEntries) ? wuRedEntries : [wuRedEntries];
        var allWu = wuList.concat(wuRedList);

        for (var wi = 0; wi < allWu.length; wi++) {
            var wu = allWu[wi];
            if (!wu) continue;
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
    //  _items OBJECT BUILDER (same format as autoLevelUp.js / evolve.js)
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
    //  POWER COMPUTATION (same as autoLevelUp.js / evolve.js)
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
    //  ITEM & HERO HELPERS
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
    //  WAKEUP HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Normalize wakeUp entries to array.
     * heroWakeUp[displayId] can be DICT (single entry) or ARRAY.
     * Always returns array.
     */
    function normalizeWakeUpEntries(entries) {
        if (!entries) return [];
        if (Array.isArray(entries)) return entries;
        return [entries];
    }

    /**
     * Get merged wakeUp entries (normal + red) for a hero.
     * Same logic as client L53251-53255:
     *   heroWakeUp[displayId].concat(heroWakeUpRed[displayId])
     */
    function getMergedWakeUpEntries(heroDisplayId) {
        var normal = normalizeWakeUpEntries(getHeroWakeUp(heroDisplayId));
        var red = normalizeWakeUpEntries(getHeroWakeUpRed(heroDisplayId));
        return normal.concat(red);
    }

    /**
     * Find the NEXT wakeUp entry to apply.
     * Returns the entry with star === currentStar + 1.
     * Returns null if already at max star.
     */
    function getNextWakeUpEntry(heroDisplayId, currentStar) {
        var all = getMergedWakeUpEntries(heroDisplayId);
        var targetStar = currentStar + 1;
        for (var i = 0; i < all.length; i++) {
            var entry = all[i];
            if (!entry) continue;
            if (Number(entry.star) === targetStar) {
                return entry;
            }
        }
        return null;
    }

    /**
     * Compute totalTalent: sum of wakeUp talent bonuses for ALL player heroes,
     * based on each hero's current star level.
     * Used for resonance system (L86346: checkHeroLevelUpCondition checks totalTalent).
     */
    function computeTotalTalent(savedData) {
        var totalTalent = 0;
        if (!savedData || !savedData.heros || !savedData.heros._heros) return totalTalent;

        var heroes = savedData.heros._heros;
        for (var key in heroes) {
            var hero = heroes[key];
            if (!hero) continue;
            var displayId = hero._heroDisplayId;
            var star = Number(hero._heroStar) || 0;
            if (!displayId || star <= 0) continue;

            // Get merged wakeUp entries for this hero's displayId
            var allWu = getMergedWakeUpEntries(displayId);
            for (var i = 0; i < allWu.length; i++) {
                var wu = allWu[i];
                if (!wu) continue;
                // Cumulative: sum talent for all entries with star <= hero's star
                if (star >= (Number(wu.star) || 0)) {
                    totalTalent += Number(wu.talent) || 0;
                }
            }
        }
        return totalTalent;
    }

    /**
     * Remove a hero from savedData.heros._heros.
     * Returns true if found and removed.
     */
    function removeHeroFromStorage(savedData, heroId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return false;
        var heroes = savedData.heros._heros;
        for (var key in heroes) {
            var hero = heroes[key];
            if (hero._heroId === heroId) {
                delete heroes[key];
                return true;
            }
        }
        return false;
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
     * Client: setUserAttributeItem(id, num) → absolute balance
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
    //  HANDLER: hero/wakeUp
    // ═══════════════════════════════════════════════════════════

    /**
     * handleWakeUp(request, callback)
     *
     * Stars up a hero: consumes piece/hero materials + item costs,
     * increments hero._heroStar, returns updated stats using PLAYER formula.
     *
     * REQUEST:
     *   heroId: hero instance ID to star-up
     *   heros: flat array of feeder hero IDs (for material slots with isPiece=0)
     *   dragonPieceNum: array [dragonUsed, 0, 0] — dragon soul piece (2600) count
     *   selfPieceNum: array [selfPieceUsed, 0, 0] — hero piece count
     *
     * IMPORTANT:
     *   - _changeInfo._items = ABSOLUTE balances after deduction (NOT negative delta!)
     *     Client does: setUserAttributeItem(id, num)
     *   - _hero = FULL hero object from savedData (after star update)
     *   - heros = feeder hero IDs that were DELETED from savedData
     *   - _totalTalent = sum talent bonuses for ALL player heroes (resonance)
     */
    function handleWakeUp(request, callback) {
        var userId = request.userId;
        var heroId = request.heroId;
        var feederHeroIds = request.heros || [];
        var dragonPieceNum = request.dragonPieceNum || [];
        var selfPieceNum = request.selfPieceNum || [];

        log.info('HANDLER', 'hero/wakeUp processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['heroId', heroId || '-'],
            ['feederCount', String(feederHeroIds.length)],
            ['dragonPiece', String(dragonPieceNum[0] || 0)],
            ['selfPiece', String(selfPieceNum[0] || 0)],
            ['version', request.version || '-']
        ]);

        try {
            if (!userId || !heroId) {
                log.warn('HANDLER', 'hero/wakeUp — missing userId or heroId');
                callback({});
                return;
            }

            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('HANDLER', 'hero/wakeUp — user data not found');
                callback({});
                return;
            }

            var found = findHeroInStorage(savedData, heroId);
            if (!found || !found.hero) {
                log.warn('HANDLER', 'hero/wakeUp — hero not found: ' + heroId);
                callback({});
                return;
            }

            var hero = found.hero;
            var displayId = hero._heroDisplayId;
            var baseAttr = hero._heroBaseAttr || {};
            var currentStar = Number(hero._heroStar) || 0;
            var currentLevel = Number(baseAttr._level) || 1;
            var currentEvolveLevel = Number(baseAttr._evolveLevel) || 0;

            log.details('hero_state', [
                ['displayId', String(displayId)],
                ['currentStar', String(currentStar)],
                ['currentLevel', String(currentLevel)],
                ['currentEvolveLevel', String(currentEvolveLevel)]
            ]);

            // ── STEP 1: Find next wakeUp entry ──
            var nextEntry = getNextWakeUpEntry(displayId, currentStar);
            if (!nextEntry) {
                log.info('HANDLER', 'hero/wakeUp — already at max star: ' + currentStar);
                callback({});
                return;
            }

            var newStar = Number(nextEntry.star) || 0;

            log.details('wakeup_entry', [
                ['newStar', String(newStar)],
                ['material1', String(nextEntry.material1 || '-')],
                ['isPiece1', String(nextEntry.isPiece1)],
                ['num1', String(nextEntry.num1)],
                ['material2', String(nextEntry.material2 || '-')],
                ['isPiece2', String(nextEntry.isPiece2)],
                ['num2', String(nextEntry.num2 || 0)],
                ['material3', String(nextEntry.material3 || '-')],
                ['isPiece3', String(nextEntry.isPiece3)],
                ['num3', String(nextEntry.num3 || 0)],
                ['itemID', String(nextEntry.itemID || '-')],
                ['num4', String(nextEntry.num4 || 0)],
                ['redItemID', String(nextEntry.redItemID || '-')],
                ['num5', String(nextEntry.num5 || 0)],
                ['levelBound', String(nextEntry.levelBound)],
                ['talent', String(nextEntry.talent)],
                ['hp', String(nextEntry.hp)],
                ['attack', String(nextEntry.attack)],
                ['armor', String(nextEntry.armor)],
                ['speed', String(nextEntry.speed)]
            ]);

            // ── STEP 2: Validate & deduct materials ──
            var constant = getConstant();
            var dragonSoulPieceID = constant ? Number(constant.dragonSoulPieceID) || 2600 : 2600;
            var deductedItems = [];
            var totalCostItems = {};
            var feederHeroCountNeeded = 0;
            var notEnough = false;

            // Process each material slot (1, 2, 3)
            for (var slot = 1; slot <= 3; slot++) {
                var materialId = Number(nextEntry['material' + slot]) || 0;
                var isPiece = Number(nextEntry['isPiece' + slot]) || 0;
                var num = Number(nextEntry['num' + slot]) || 0;

                if (!materialId || num <= 0) continue;

                if (isPiece === 1) {
                    // HERO PIECE: deduct from item inventory
                    // Client sends dragonPieceNum[slot-1] + selfPieceNum[slot-1] = num
                    var selfPieceUsed = Number(selfPieceNum[slot - 1]) || 0;
                    var dragonPieceUsed = Number(dragonPieceNum[slot - 1]) || 0;

                    // Deduct self hero pieces
                    if (selfPieceUsed > 0) {
                        var selfBalance = getItemNum(savedData, materialId);
                        if (selfBalance < selfPieceUsed) {
                            log.warn('HANDLER', 'hero/wakeUp — not enough self piece: ' + materialId + ' need=' + selfPieceUsed + ' have=' + selfBalance);
                            notEnough = true;
                            break;
                        }
                        deductItem(savedData, materialId, selfPieceUsed);
                        deductedItems.push({ id: materialId, cost: selfPieceUsed });
                    }

                    // Deduct dragon soul pieces
                    if (dragonPieceUsed > 0) {
                        var dragonBalance = getItemNum(savedData, dragonSoulPieceID);
                        if (dragonBalance < dragonPieceUsed) {
                            log.warn('HANDLER', 'hero/wakeUp — not enough dragon soul piece: need=' + dragonPieceUsed + ' have=' + dragonBalance);
                            notEnough = true;
                            break;
                        }
                        deductItem(savedData, dragonSoulPieceID, dragonPieceUsed);
                        deductedItems.push({ id: dragonSoulPieceID, cost: dragonPieceUsed });
                    }

                    // Track in totalCost
                    totalCostItems[String(materialId)] = { _id: materialId, _num: selfPieceUsed };
                    if (dragonPieceUsed > 0) {
                        totalCostItems[String(dragonSoulPieceID)] = { _id: dragonSoulPieceID, _num: dragonPieceUsed };
                    }

                } else {
                    // FEEDER HEROES: count how many are needed
                    feederHeroCountNeeded += num;
                }
            }

            if (notEnough) {
                callback({});
                return;
            }

            // Validate feeder hero count
            if (feederHeroCountNeeded > 0 && feederHeroIds.length < feederHeroCountNeeded) {
                log.warn('HANDLER', 'hero/wakeUp — not enough feeder heroes: need=' + feederHeroCountNeeded + ' provided=' + feederHeroIds.length);
                callback({});
                return;
            }

            // ── STEP 3: Validate & deduct item costs ──
            var itemCostID = Number(nextEntry.itemID) || 0;
            var itemCostNum = Number(nextEntry.num4) || 0;
            var redItemID = Number(nextEntry.redItemID) || 0;
            var redItemNum = Number(nextEntry.num5) || 0;

            if (itemCostID > 0 && itemCostNum > 0) {
                var itemBalance = getItemNum(savedData, itemCostID);
                if (itemBalance < itemCostNum) {
                    log.warn('HANDLER', 'hero/wakeUp — not enough item cost: ' + itemCostID + ' need=' + itemCostNum + ' have=' + itemBalance);
                    callback({});
                    return;
                }
                deductItem(savedData, itemCostID, itemCostNum);
                deductedItems.push({ id: itemCostID, cost: itemCostNum });
                totalCostItems[String(itemCostID)] = { _id: itemCostID, _num: itemCostNum };
            }

            if (redItemID > 0 && redItemNum > 0) {
                var redBalance = getItemNum(savedData, redItemID);
                if (redBalance < redItemNum) {
                    log.warn('HANDLER', 'hero/wakeUp — not enough red item cost: ' + redItemID + ' need=' + redItemNum + ' have=' + redBalance);
                    callback({});
                    return;
                }
                deductItem(savedData, redItemID, redItemNum);
                deductedItems.push({ id: redItemID, cost: redItemNum });
                totalCostItems[String(redItemID)] = { _id: redItemID, _num: redItemNum };
            }

            // ── STEP 4: Update hero star ──
            hero._heroStar = newStar;

            // ── STEP 5: Delete feeder heroes from savedData ──
            for (var fi = 0; fi < feederHeroIds.length; fi++) {
                var feederId = feederHeroIds[fi];
                removeHeroFromStorage(savedData, feederId);
            }

            // ── STEP 5b: Accumulate _totalCost._wakeUp ──
            // Simpan resource wakeUp/star ke hero data agar bisa direfund nantinya.
            if (Object.keys(totalCostItems).length > 0) {
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
                var wuSection = found.hero._totalCost._wakeUp;
                if (!wuSection) {
                    found.hero._totalCost._wakeUp = { _items: {} };
                    wuSection = found.hero._totalCost._wakeUp;
                }
                // FIX: _items bisa berupa array (dari data lama), client expect OBJECT
                if (!wuSection._items || Array.isArray(wuSection._items)) wuSection._items = {};
                for (var wuKey in totalCostItems) {
                    if (!totalCostItems.hasOwnProperty(wuKey)) continue;
                    var wuItem = totalCostItems[wuKey];
                    var oldNum = wuSection._items[wuKey] ? Number(wuSection._items[wuKey]._num) : 0;
                    wuSection._items[wuKey] = { _id: Number(wuKey), _num: oldNum + (wuItem._num || 0) };
                }
            }

            // ── STEP 6: Save to DB ──
            db._set(storageKey, savedData);

            // ── STEP 7: Recompute stats (PLAYER formula, same as evolve) ──
            var newStats = computeRawBaseStats(displayId, currentLevel, currentEvolveLevel, newStar);
            var equipFlatStats = getHeroEquippedFlatStats(savedData, heroId);

            log.info('HANDLER', 'hero/wakeUp success');
            log.details('result', [
                ['heroId', heroId],
                ['displayId', String(displayId)],
                ['oldStar', String(currentStar)],
                ['newStar', String(newStar)],
                ['rawHp', String(newStats ? newStats.hp : 'null')],
                ['rawAtk', String(newStats ? newStats.attack : 'null')],
                ['rawArm', String(newStats ? newStats.armor : 'null')],
                ['rawTalent', String(newStats ? newStats.talent : 'null')]
            ]);

            // ── STEP 8: Compute _totalTalent (resonance: sum all hero talents) ──
            var totalTalent = computeTotalTalent(savedData);

            log.details('totalTalent', [
                ['totalTalent', String(totalTalent)]
            ]);

            // ── STEP 9: Build _totalCost with _wakeUp section ──
            var totalCost = buildEmptyTotalCost();
            totalCost._wakeUp = { _items: totalCostItems };

            // ── STEP 9.5: Sanitize _hero._totalCost before sending ──
            // Client HeroTotalCost.deserialize (L84906) iterates _items with for...in
            // and reads n._items[o]._id — if _items is ARRAY of nulls → CRASH.
            // Ensure ALL _totalCost.*._items are OBJECTS, not arrays.
            if (hero._totalCost) {
                var _tcSections = ['_wakeUp', '_earring', '_levelUp', '_evolve', '_skill', '_qigong', '_heroBreak'];
                for (var _si = 0; _si < _tcSections.length; _si++) {
                    var _sec = hero._totalCost[_tcSections[_si]];
                    if (_sec && Array.isArray(_sec._items)) {
                        // Convert array to empty object — corrupted data, discard
                        log.warn('HANDLER', 'hero/wakeUp — sanitized _hero._totalCost.' + _tcSections[_si] + '._items from array to object (was ' + _sec._items.length + ' elems)');
                        _sec._items = {};
                    }
                }
            }

            // ── STEP 10: Build response ──
            var response = {
                heroId: heroId,
                _hero: hero,
                _baseAttr: { _items: buildBaseAttrItems(newStats) },
                _heroTotalAttr: { _items: buildTotalAttrItems(newStats, equipFlatStats) },
                _totalCost: totalCost,
                _totalTalent: totalTalent,
                heros: feederHeroIds,
                _changeInfo: { _items: buildChangeInfo(savedData, deductedItems) },
                _linkHeroesTotalAttr: {},
                _linkHeroesBasicAttr: {}
            };

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'hero/wakeUp UNCAUGHT ERROR', err);
            callback({});
        }
    }

    // ═══════════════════════════════════════════════════════════
    // REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'wakeUp', handleWakeUp);

    window.MainServer = MainServer;
})();