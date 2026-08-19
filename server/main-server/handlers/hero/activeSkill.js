/**
 * draft/hero/activeSkill.js — Activate Potential Skill
 *
 * ── CLIENT CALL (main.min.js L120795) ───────────────────────
 *   { type:"hero", action:"activeSkill", userId, heroId, pos:1-3, stype:POTENTIAL }
 *
 * ── CLIENT CALLBACK (main.min.js L120804) ─────────────────────
 *   changeSkillCallBack(t) → setHeroPotentialSkillState(n, t._potentialLevel)
 *                         → setTotalAttrs(t, n)
 *   openHeroAttrChange() → popup jika attrValues.length > 0
 *
 * ── setTotalAttrs (L85201) ──────────────────────────────────
 *   1. e._baseAttr? → setBaseAttr (SKIP kalau tidak ada — aman)
 *   2. o = e._heroTotalAttr._items
 *   3. L85211: SUBTRACT semua old totalAttr dari attrChangeValues
 *   4. L85216: SET response items ke hero.totalAttr
 *      L85219: id==21 → heroBaseAttr.power = Math.floor(_num)
 *   5. L85221: ADD semua new totalAttr ke attrChangeValues
 *      Result: attrChangeValues[id] = new - old
 *   6. L85227: setTotalCost(e,t) → e._totalCost undefined → SKIP (L85191: n && ...)
 *   7. L85228: e._linkHeroesBasicAttr undefined → SKIP
 *
 * ── getAttrChangeValue (L85246) ────────────────────────────
 *   o array = [0,1,2,3,26,4,5,6,7,8,23,9,10,11,12,13,14,24,25,26,27,28,29,34,36,37]
 *   ID 17 (hpPercent), 19 (attackPercent) TIDAK di list → tidak muncul di popup
 *   Power (21) dihandle terpisah sebagai powerChange
 *
 * ═══════════════════════════════════════════════════════════════
 * ROOT CAUSE FIX (dari investigasi skillOutBattle.json):
 *   458 potential skills → 99% percentage stats (hpPercent, attackPercent, dll)
 *   Nilai: 0.05 ~ 0.3 → kalau disimpan mentah, power += 0.3 × 1 × 1 = 0.3
 *   SOLUSI: Apply percentage ke flat stats SEBELUM build items & power:
 *     totalHp = (rawHp × talent) × (1 + hpPercent) + equipFlat[0]
 *     totalAtk = (rawAtk × talent) × (1 + attackPercent) + equipFlat[1]
 *     totalArm = rawArm × (1 + armorPercent) + equipFlat[2]
 *     Ini membuat power naik signifikan karena HP/ATK naik ribuan.
 * ═══════════════════════════════════════════════════════════════
 */
(function() {
    'use strict';
    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ── Config Cache ─────────────────────────────────────────
    var _cache = {};
    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var x = new XMLHttpRequest();
            x.open('GET', './resource/json/' + name + '.json', false);
            x.send();
            if (x.status === 200) { _cache[name] = JSON.parse(x.responseText); return _cache[name]; }
        } catch(e) { log.warn('RESOURCE', 'Failed: ' + name); }
        return null;
    }

    // ── Stat pipeline (dari evolve.js — sama persis) ──────────
    // skillOutBattle.json field → attr ID (index FULL_ATTR_IDS)
    var POT_STAT = {
        hp:0, attack:1, armor:2, speed:3, hit:4, dodge:5, block:6, blockEffect:7,
        skillDamage:8, critical:9, criticalResist:10, criticalDamage:11,
        armorBreak:12, damageReduce:13, controlResist:14, trueDamage:15,
        hpPercent:17, armorPercent:18, attackPercent:19, speedPercent:20,
        superDamage:23, healPlus:24, healerPlus:25, extraArmor:26,
        shielderPlus:27, damageUp:28, damageDown:29
    };

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

    // ── Equip helpers (dari evolve.js) ─────────────────────────
    function getEquipAbilities(eq) {
        var ab = [];
        if (!eq) return ab;
        if (eq.abilityID1 !== undefined && eq.abilityID1 !== '' && eq.value1 !== undefined)
            ab.push({ abilityId: Number(eq.abilityID1), value: Number(eq.value1) || 0 });
        if (eq.abilityID2 !== undefined && eq.abilityID2 !== '' && eq.value2 !== undefined)
            ab.push({ abilityId: Number(eq.abilityID2), value: Number(eq.value2) || 0 });
        if (eq.abilityID3 !== undefined && eq.abilityID3 !== '' && eq.value3 !== undefined)
            ab.push({ abilityId: Number(eq.abilityID3), value: Number(eq.value3) || 0 });
        return ab;
    }

    function getHeroEquippedFlatStats(savedData, heroId) {
        var flat = {};
        if (!savedData || !savedData.equip || !savedData.equip._suits) return flat;
        var he = savedData.equip._suits[heroId];
        if (!he || !he._suitItems) return flat;
        for (var i = 0; i < he._suitItems.length; i++) {
            var eid = he._suitItems[i]._id;
            var eq = loadJson('equip');
            var cfg = eq ? eq[String(eid)] : null;
            if (!cfg) continue;
            var abilities = getEquipAbilities(cfg);
            for (var j = 0; j < abilities.length; j++) {
                var a = abilities[j];
                if (flat[a.abilityId] === undefined) flat[a.abilityId] = 0;
                flat[a.abilityId] += a.value;
            }
        }
        return flat;
    }

    // ── Raw base stats (dari evolve.js computeRawBaseStats) ─────
    function computeRawBaseStats(displayId, level, evolveLevel, starLevel) {
        var hc = loadJson('hero');
        var hcfg = hc ? hc[String(displayId)] : null;
        if (!hcfg) return null;

        var quality = hcfg.quality || 'purple';
        var heroType = hcfg.heroType || 'critical';
        var la = (loadJson('heroLevelAttr') || {})[String(level)] || {};
        var qp = (loadJson('heroQualityParam') || {})[quality] || {};
        var tp = (loadJson('heroTypeParam') || {})[heroType] || {};
        var evArr = loadJson('heroEvolve') ? (loadJson('heroEvolve')[String(displayId)] || []) : [];
        var evRed = loadJson('heroEvolveRed') ? (loadJson('heroEvolveRed')[String(displayId)] || []) : [];
        var wuArr = loadJson('heroWakeUp') ? (loadJson('heroWakeUp')[String(displayId)] || []) : [];
        if (!Array.isArray(evArr)) evArr = [];
        if (!Array.isArray(evRed)) evRed = [];
        if (!Array.isArray(wuArr)) wuArr = [];

        var s = {
            hp:0, attack:0, armor:0, speed:0, hit:0, dodge:0, block:0,
            damageReduce:0, armorBreak:0, controlResist:0, skillDamage:0,
            criticalDamage:0, blockEffect:0, critical:0, criticalResist:0,
            trueDamage:0, energy:0, hpPercent:0, armorPercent:0,
            attackPercent:0, speedPercent:0, extraArmor:0, orghp:0,
            superDamage:0, healPlus:0, healerPlus:0, damageDown:0,
            shielderPlus:0, damageUp:0,
            talent: Number(hcfg.talent) || 0,
            heroType: heroType, quality: quality,
            balancePower: Number(hcfg.balancePower) || 1
        };

        // Evolve bonuses (cumulative)
        var allEv = evArr.concat(evRed);
        for (var i = 0; i < allEv.length; i++) {
            var e = allEv[i];
            if (evolveLevel >= (e.level || 0)) {
                s.hp += Number(e.hp) || 0;
                s.attack += Number(e.attack) || 0;
                s.armor += Number(e.armor) || 0;
                s.speed += Number(e.speed) || 0;
            }
        }

        // WakeUp/Star bonuses (cumulative)
        for (var i = 0; i < wuArr.length; i++) {
            var w = wuArr[i];
            if (starLevel >= (w.star || 0)) {
                s.talent += Number(w.talent) || 0;
                s.hp += Number(w.hp) || 0;
                s.attack += Number(w.attack) || 0;
                s.armor += Number(w.armor) || 0;
                s.speed += Number(w.speed) || 0;
            }
        }

        // Base: level × type × quality × balance
        var bHp = (Number(la.hp)||0) * (Number(tp.hpParam)||0) + (Number(tp.hpBais)||0);
        bHp *= (Number(qp.hpParam)||1) * (Number(hcfg.balanceHp)||1);
        s.hp += bHp;

        var bAtk = (Number(la.attack)||0) * (Number(tp.attackParam)||0) + (Number(tp.attackBais)||0);
        bAtk *= (Number(qp.attackParam)||1) * (Number(hcfg.balanceAttack)||1);
        s.attack += bAtk;

        var bArm = (Number(la.armor)||0) * (Number(tp.armorParam)||0) + (Number(tp.armorBais)||0);
        bArm *= (Number(qp.armorParam)||1) * (Number(hcfg.balanceArmor)||1);
        s.armor += bArm;

        // Flat dari hero config
        s.speed += Number(hcfg.speed) || 0;
        s.hit += Number(hcfg.hit) || 0;
        s.dodge += Number(hcfg.dodge) || 0;
        s.block += Number(hcfg.block) || 0;
        s.damageReduce += Number(hcfg.damageReduce) || 0;
        s.armorBreak += Number(hcfg.armorBreak) || 0;
        s.controlResist += Number(hcfg.controlResist) || 0;
        s.skillDamage += Number(hcfg.skillDamage) || 0;
        s.criticalDamage += Number(hcfg.criticalDamage) || 0;
        s.blockEffect += Number(hcfg.blockEffect) || 0;
        s.critical += Number(hcfg.critical) || 0;
        s.criticalResist += Number(hcfg.criticalResist) || 0;
        s.trueDamage += Number(hcfg.trueDamage) || 0;
        s.healPlus += Number(hcfg.healPlus) || 0;
        s.healerPlus += Number(hcfg.healerPlus) || 0;

        return s;
    }

    // ── Power computation (dari evolve.js) ──────────────────────
    var ATK_BASE_WEIGHTS = {
        critical:20, criticalSingle:20, hit:20,
        skill:15, body:15, block:15,
        armor:15, armorS:15, armorDamage:15,
        bodyDamage:15, dodge:15, strength:15, dot:15
    };
    var POWER_BASE_WEIGHTS = {
        hp:'balancePower', attack:'atkBase', armor:1, speed:0,
        extraArmor:1, orghp:0, talent:0, power:0,
        hpPercent:0, attackPercent:0, armorPercent:0, speedPercent:0,
        hit:1, dodge:1, block:1, blockEffect:1, skillDamage:1,
        critical:1, criticalResist:1, criticalDamage:1, armorBreak:1,
        damageReduce:1, controlResist:1, trueDamage:1,
        healPlus:1, healerPlus:1, shielderPlus:1,
        damageUp:1, damageDown:1, superDamage:1,
        superDamageResist:1, dragonBallWarDamageUp:1
    };
    var _pwrCache = null;
    function getPowerForType(heroType) {
        if (!_pwrCache) {
            _pwrCache = {};
            var t = loadJson('heroPower');
            if (t) for (var k in t) {
                var e = t[k];
                if (!e.heroType) continue;
                if (!_pwrCache[e.heroType]) _pwrCache[e.heroType] = {};
                _pwrCache[e.heroType][e.attName] = Number(e.powerParam) || 0;
            }
        }
        return _pwrCache[heroType] || null;
    }

    function computePower(displayStats, rawStats) {
        var bp = rawStats.balancePower || 1;
        var quality = rawStats.quality || 'purple';
        var ht = rawStats.heroType || 'critical';
        var tw = getPowerForType(ht);
        var power = 0;
        for (var name in displayStats) {
            if (!POWER_BASE_WEIGHTS.hasOwnProperty(name)) continue;
            var bw = POWER_BASE_WEIGHTS[name];
            if (bw === 'balancePower') bw = bp;
            else if (bw === 'atkBase') bw = ATK_BASE_WEIGHTS[ht] || 15;
            if (bw === 0) continue;
            var pp = (tw && tw[name]) ? tw[name] : 1;
            power += (Number(displayStats[name]) || 0) * bw * pp;
        }
        var qpt = loadJson('heroQualityPower');
        if (qpt && qpt[quality]) power *= (Number(qpt[quality].powerParam) || 1);
        return Math.floor(power);
    }

    // ═══════════════════════════════════════════════════════════
    //  buildTotalAttrItems — KEY FIX: apply % to flat stats
    // ═══════════════════════════════════════════════════════════
    // Potential skills give 99% percentage stats (e.g. hpPercent=0.3).
    // If stored separately, power += 0.3 × 1 × 1 = 0.3 (USELESS).
    // FIX: apply percentage to corresponding flat stats FIRST:
    //   totalHp = (rawHp × talent) × (1 + hpPercent) + equipFlat[0]
    //   → power += deltaHp × balancePower × powerParam (THOUSANDS)
    // Percentage stats stored as separate _items for display (id 17,18,19,20).
    // ═══════════════════════════════════════════════════════════
    function buildTotalAttrItems(rawStats, equipFlatStats) {
        var talent = rawStats.talent || 0;

        // ── STEP 1: Gather ALL percentage bonuses ──
        // From potential skills (already in rawStats) + equipment
        var hpPct  = (Number(rawStats.hpPercent) || 0) + (Number(equipFlatStats[17]) || 0);
        var atkPct = (Number(rawStats.attackPercent) || 0) + (Number(equipFlatStats[19]) || 0);
        var armPct = (Number(rawStats.armorPercent) || 0) + (Number(equipFlatStats[18]) || 0);
        var spdPct = (Number(rawStats.speedPercent) || 0) + (Number(equipFlatStats[20]) || 0);

        // ── STEP 2: Apply % to flat stats (BEFORE adding flat equip) ──
        var dispHp  = rawStats.hp * talent * (1 + hpPct);
        var dispAtk = rawStats.attack * talent * (1 + atkPct);
        var dispArm = rawStats.armor * (1 + armPct);
        var dispSpd = rawStats.speed * (1 + spdPct);

        // ── STEP 3: Add flat equipment bonuses ──
        var totalHp  = dispHp  + (Number(equipFlatStats[0]) || 0);
        var totalAtk = dispAtk + (Number(equipFlatStats[1]) || 0);
        var totalArm = dispArm + (Number(equipFlatStats[2]) || 0);

        // ── STEP 4: Build 42 _items ──
        var items = {};
        for (var i = 0; i < FULL_ATTR_IDS.length; i++) {
            var id = i, name = FULL_ATTR_IDS[id], val;
            if (id === 0)      val = totalHp;
            else if (id === 1) val = totalAtk;
            else if (id === 2) val = totalArm;
            else if (id === 3) val = dispSpd;
            else if (id === 16) val = 0;
            else if (id === 21) continue;
            else if (id === 22) val = totalHp;
            else {
                // For percentage stats (17-20), store raw % value from potential only
                // (equipment % already applied to flat stats above)
                if (id === 17) val = Number(rawStats.hpPercent) || 0;
                else if (id === 18) val = Number(rawStats.armorPercent) || 0;
                else if (id === 19) val = Number(rawStats.attackPercent) || 0;
                else if (id === 20) val = Number(rawStats.speedPercent) || 0;
                else {
                    val = rawStats[name] !== undefined ? rawStats[name] : 0;
                    if (equipFlatStats[id] !== undefined) val += Number(equipFlatStats[id]) || 0;
                }
            }
            items[String(id)] = { _id: id, _num: val };
        }

        // ── STEP 5: Compute power on PERCENTAGE-ADJUSTED values ──
        var ds = {};
        for (var si = 0; si < FULL_ATTR_IDS.length; si++) {
            var sId = si, sName = FULL_ATTR_IDS[sId];
            if (sId === 21 || sId === 22) continue;
            var sv;
            if (sId === 0) sv = totalHp;
            else if (sId === 1) sv = totalAtk;
            else if (sId === 2) sv = totalArm;
            else if (sId === 3) sv = dispSpd;
            else {
                sv = Number(rawStats[sName]) || 0;
                if (equipFlatStats[sId] !== undefined) sv += Number(equipFlatStats[sId]) || 0;
            }
            if (POWER_BASE_WEIGHTS.hasOwnProperty(sName)) ds[sName] = sv;
        }
        items['21'] = { _id: 21, _num: computePower(ds, rawStats) };
        return items;
    }

    // ── Potential stat extractor ───────────────────────────────
    function getPotentialFlatStats(hcfg, sob, potentialLevel) {
        var pot = {};
        for (var p = 1; p <= 3; p++) {
            if (!potentialLevel[p]) continue;
            var sid = hcfg['potential' + p];
            if (!sid || !sob) continue;
            var entry = sob[String(sid)];
            if (!entry) continue;
            var d = Array.isArray(entry) ? entry[0] : entry;
            if (!d) continue;
            for (var f in POT_STAT) {
                var v = d[f];
                if (v === undefined || v === null || v === '') continue;
                var n = Number(v) || 0;
                if (n === 0) continue;
                pot[f] = (pot[f] || 0) + n;
            }
        }
        return pot;
    }

    // ── Hero finder (sama seperti evolve.js findHeroInStorage) ──
    function findHero(savedData, heroId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return null;
        var heroes = savedData.heros._heros;
        for (var k in heroes) {
            var h = heroes[k];
            if (h._heroId === heroId
                || h._heroDisplayId === Number(heroId)
                || String(h._heroDisplayId) === String(heroId)) return h;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler("hero", "activeSkill", function(request, callback) {
        var userId = request.userId,
            heroId = request.heroId,
            pos = Number(request.pos) || 0;

        if (!userId || !heroId || pos < 1 || pos > 3) { callback({}, 1); return; }

        var savedData = db._get('user:' + userId);
        if (!savedData) { callback({}, 1); return; }

        var hero = findHero(savedData, heroId);
        if (!hero) { callback({}, 1); return; }

        var displayId = hero._heroDisplayId || Number(hero._heroId);
        var allHeroes = loadJson('hero');
        var hcfg = allHeroes ? allHeroes[String(displayId)] : null;
        if (!hcfg || !hcfg['potential' + pos]) { callback({}, 1); return; }

        // Aktifkan posisi
        if (!hero._potentialLevel) hero._potentialLevel = {};
        hero._potentialLevel[pos] = 1;

        // Baca hero state
        var baseAttr = hero._heroBaseAttr || {};
        var level = Number(baseAttr._level) || 1;
        var evolveLevel = Number(baseAttr._evolveLevel) || 0;
        var starLevel = Number(hero._heroStar) || 0;

        // Compute raw base stats (base + evolve + star)
        var rawStats = computeRawBaseStats(displayId, level, evolveLevel, starLevel);
        if (!rawStats) { callback({}, 1); return; }

        // Tambahkan potential stats dari SEMUA posisi aktif
        var sob = loadJson('skillOutBattle');
        var potStats = getPotentialFlatStats(hcfg, sob, hero._potentialLevel);
        for (var f in potStats) {
            if (rawStats[f] !== undefined) rawStats[f] += potStats[f];
            else rawStats[f] = potStats[f];
        }

        // Equip flat stats
        var equipFlat = getHeroEquippedFlatStats(savedData, heroId);

        // Build FULL 42 attr IDs (termasuk power id 21)
        // PERCENTAGE stats di-apply ke flat stats di dalam sini
        var totalItems = buildTotalAttrItems(rawStats, equipFlat);

        // Simpan
        db._set('user:' + userId, savedData);

        log.info('HANDLER', 'hero/activeSkill OK hero=' + heroId + ' pos=' + pos +
            ' power=' + (totalItems['21'] ? totalItems['21']._num : '?'));

        // Response: setTotalAttrs (L85201) → delta = new - old
        // L85204: _baseAttr undefined → setBaseAttr SKIP (aman)
        // L85219: id==21 → heroBaseAttr.power = Math.floor(_num)
        // L85227: _totalCost undefined → setTotalCost SKIP (L85191: n && ...)
        // L85228: _linkHeroesBasicAttr undefined → SKIP
        callback({
            heroId: heroId,
            _potentialLevel: hero._potentialLevel,
            _heroTotalAttr: { _items: totalItems }
        });
    });
})();
