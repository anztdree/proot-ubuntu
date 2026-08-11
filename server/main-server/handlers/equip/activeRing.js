/**
 * equip/activeRing V10 — AKUMULASI approach
 *
 * Client call (L122587-122592):
 *   { type:"equip", action:"activeRing", userId, heroId, version:"1.0" }
 *
 * Client callback (L122593-122595):
 *   1. setTotalAttrsByHeroId(t, t.heroId)  → OVERWRITE per-entry
 *   2. activeEarringCallBack(t)             → SetEquipDataToModel
 *   3. doRefresh() + showUnLockEffect()
 *
 * V10 APPROACH — AKUMULASI, bukan hitung ulang dari nol:
 *   Hero power sudah diakumulasi dari BANYAK sumber (autoLevelUp, weapon,
 *   qigong, potential, break, skin, dll). Jadi:
 *   1. Baca hero.totalAttr dari HerosManager (sudah lengkap)
 *   2. TAMBAHKAN ring flat stats
 *   3. APPLY ring percent ke hp/atk/armor
 *   4. Recompute power dari total yang sudah lengkap
 *   5. Kirim hanya entry yang berubah + power
 *
 * Kenapa ini benar:
 *   setTotalAttrs (L85216-85219) OVERWRITE per-entry: t.totalAttr[u.id] = u
 *   Entry yang TIDAK ada di response tetap punya nilai lama.
 *   Jadi kita hanya perlu kirim entry yang diubah oleh ring.
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.equip) MainServer.handlers.equip = {};

    var INITIAL_RING_ID = 4501;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE
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
    //  RING ABILITY → ATTR ID
    // ═══════════════════════════════════════════════════════════

    var RING_ATTR = {
        hp: 0, attack: 1, armor: 2, speed: 3, hit: 4, dodge: 5, block: 6,
        blockEffect: 7, skillDamage: 8, critical: 9, criticalResist: 10,
        criticalDamage: 11, armorBreak: 12, damageReduce: 13, controlResist: 14,
        trueDamage: 15, hpPercent: 17, armorPercent: 18, attackPercent: 19
    };

    // ═══════════════════════════════════════════════════════════
    //  POWER COMPUTATION (minimal — hanya untuk recompute power)
    // ═══════════════════════════════════════════════════════════

    var ATTR_ID_TO_NAME = {
        0:'hp', 1:'attack', 2:'armor', 3:'speed', 4:'hit', 5:'dodge', 6:'block',
        7:'blockEffect', 8:'skillDamage', 9:'critical', 10:'criticalResist',
        11:'criticalDamage', 12:'armorBreak', 13:'damageReduce', 14:'controlResist',
        15:'trueDamage', 16:'energy', 17:'hpPercent', 18:'armorPercent',
        19:'attackPercent', 20:'speedPercent', 23:'superDamage', 24:'healPlus',
        25:'healerPlus', 26:'extraArmor', 27:'shielderPlus', 28:'damageUp',
        29:'damageDown', 31:'superDamageResist', 32:'dragonBallWarDamageUp'
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

    var ATK_BASE_WEIGHTS = {
        'critical':20,'criticalSingle':20,'hit':20,
        'skill':15,'body':15,'block':15,'armor':15,'armorS':15,
        'armorDamage':15,'bodyDamage':15,'dodge':15,'strength':15,'dot':15
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

    function computePower(displayStats, heroConfig) {
        var balancePower = Number(heroConfig.balancePower) || 1;
        var quality = heroConfig.quality || 'purple';
        var heroType = heroConfig.heroType || 'critical';
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
    //  RING STATS — baca ring.json + ringLevelUp.json
    // ═══════════════════════════════════════════════════════════

    function getRingStats(ringId, ringLevel) {
        var flat = {};
        var rawAttrs = [];
        var rc = loadJson('ring');
        var lc = loadJson('ringLevelUp');
        var rd = rc ? rc[String(ringId)] : null;

        // Base stats dari ring.json
        if (rd) {
            var n = Number(rd.abilityNum) || 0;
            for (var i = 1; i <= n; i++) {
                var abilityName = rd['ability' + i];
                var aid = RING_ATTR[abilityName];
                if (aid === undefined) continue;
                var val = Number(rd['value' + i]) || 0;
                flat[aid] = (flat[aid] || 0) + val;
            }
        }

        // Level stats dari ringLevelUp.json (sum level 1..ringLevel)
        if (lc) {
            for (var lv = 1; lv <= ringLevel; lv++) {
                var ld = lc[String(lv)];
                if (!ld) continue;
                var ln = Number(ld.abilityNum) || 0;
                for (var j = 1; j <= ln; j++) {
                    var lAbilityName = ld['ability' + j];
                    var lid = RING_ATTR[lAbilityName];
                    if (lid === undefined) continue;
                    var lval = Number(ld['value' + j]) || 0;
                    flat[lid] = (flat[lid] || 0) + lval;
                }
            }
        }

        // Build rawAttrs untuk _earrings._attrs._items
        for (var fid in flat) {
            if (!flat.hasOwnProperty(fid)) continue;
            rawAttrs.push({ _id: Number(fid), _num: flat[fid] });
        }
        return { flat: flat, rawAttrs: rawAttrs };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleActiveRing(request, callback) {
        try { _impl(request, callback); }
        catch (err) {
            log.error('ACTIVE_RING', 'UNCAUGHT: ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback({}, 1);
        }
    }

    function _impl(request, callback) {
        var userId = request && request.userId;
        var heroId = request && request.heroId;

        log.info('ACTIVE_RING', 'START userId=' + (userId || '-') + ' heroId=' + (heroId || '-'));

        if (!userId || !heroId) { callback({}, 1); return; }

        var key = 'ms_user_' + userId + '_1';
        var savedData = db._get(key);
        if (!savedData) { log.error('ACTIVE_RING', 'user not found'); callback({}, 1); return; }

        // Init equip._suits
        if (!savedData.equip) savedData.equip = { _suits: {} };
        if (!savedData.equip._suits) savedData.equip._suits = {};

        var sk = String(heroId);
        var suit = savedData.equip._suits[sk];
        if (!suit) {
            suit = { _suitItems: [], _suitAttrs: [], _equipAttrs: [], _earrings: {}, _weaponState: 0 };
            savedData.equip._suits[sk] = suit;
        }
        if (!Array.isArray(suit._suitItems)) suit._suitItems = [];
        if (!Array.isArray(suit._suitAttrs)) suit._suitAttrs = [];
        if (!Array.isArray(suit._equipAttrs)) suit._equipAttrs = [];

        // Cek ring belum aktif
        if (suit._earrings && Number(suit._earrings._id)) {
            log.info('ACTIVE_RING', 'Ring already active heroId=' + heroId);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  1. BACA RING STATS (base + level 1)
        // ═══════════════════════════════════════════════════════

        var ringLv = 1;
        var ringData = getRingStats(INITIAL_RING_ID, ringLv);

        log.details('ringStats', [
            ['ringId', String(INITIAL_RING_ID)],
            ['ringLevel', String(ringLv)],
            ['flat', JSON.stringify(ringData.flat)]
        ]);

        // ═══════════════════════════════════════════════════════
        //  2. AKUMULASI — baca CURRENT totalAttr dari HerosManager
        //     (sudah termasuk SEMUA sumber: base, equip, weapon,
        //      autoLevelUp, qigong, potential, break, dll)
        // ═══════════════════════════════════════════════════════

        var HM = HerosManager.getInstance();
        var hero = HM.getHero(heroId);
        if (!hero) {
            log.error('ACTIVE_RING', 'hero not found in HerosManager heroId=' + heroId);
            callback({}, 1);
            return;
        }

        var oldPower = hero.heroBaseAttr ? hero.heroBaseAttr.power : 0;

        // Clone current totalAttr (format: { id: BasicItem{ id, num } })
        var currentTA = hero.totalAttr;
        var items = {};
        if (currentTA) {
            for (var cid in currentTA) {
                if (!currentTA.hasOwnProperty(cid)) continue;
                var cItem = currentTA[cid];
                if (cItem && cItem.id !== undefined) {
                    items[String(cItem.id)] = { _id: cItem.id, _num: cItem.num };
                }
            }
        }

        // ═══════════════════════════════════════════════════════
        //  3. TAMBAHKAN ring stats ke existing totalAttr
        // ═══════════════════════════════════════════════════════

        var ringFlat = ringData.flat;

        // Core stats: baca current, tambah flat, apply percent
        var hp  = Number(items['0'] && items['0']._num) || 0;
        var atk = Number(items['1'] && items['1']._num) || 0;
        var arm = Number(items['2'] && items['2']._num) || 0;

        // Tambah ring flat stats
        hp  += Number(ringFlat[0]) || 0;
        atk += Number(ringFlat[1]) || 0;
        arm += Number(ringFlat[2]) || 0;

        // Apply ring percent (multiply total)
        var ringHpPct  = Number(ringFlat[17]) || 0;
        var ringArmPct = Number(ringFlat[18]) || 0;
        var ringAtkPct = Number(ringFlat[19]) || 0;

        if (ringHpPct  !== 0) hp  *= (1 + ringHpPct);
        if (ringAtkPct !== 0) atk *= (1 + ringAtkPct);
        if (ringArmPct !== 0) arm *= (1 + ringArmPct);

        items['0']  = { _id: 0,  _num: hp };
        items['1']  = { _id: 1,  _num: atk };
        items['2']  = { _id: 2,  _num: arm };
        items['22'] = { _id: 22, _num: hp }; // orghp = totalHp

        // Tambah ring percent ke percent items
        items['17'] = { _id: 17, _num: (Number(items['17'] && items['17']._num) || 0) + ringHpPct };
        items['18'] = { _id: 18, _num: (Number(items['18'] && items['18']._num) || 0) + ringArmPct };
        items['19'] = { _id: 19, _num: (Number(items['19'] && items['19']._num) || 0) + ringAtkPct };

        // Ring flat stats lainnya (speed, hit, dodge, block, dll)
        for (var attrId in ringFlat) {
            var aIdN = Number(attrId);
            // Skip: hp(0), atk(1), arm(2), hp%(17), arm%(18), atk%(19) — sudah dihandle
            if (aIdN === 0 || aIdN === 1 || aIdN === 2) continue;
            if (aIdN === 17 || aIdN === 18 || aIdN === 19) continue;
            var existing = Number(items[String(aIdN)] && items[String(aIdN)]._num) || 0;
            items[String(aIdN)] = { _id: aIdN, _num: existing + (Number(ringFlat[attrId]) || 0) };
        }

        // ═══════════════════════════════════════════════════════
        //  4. RECOMPUTE POWER dari total stats yang sudah lengkap
        // ═══════════════════════════════════════════════════════

        var heroConfig = (loadJson('hero') || {})[String(hero.heroDisplayId)] || {};
        var displayStats = {};
        for (var di in items) {
            if (!items.hasOwnProperty(di)) continue;
            var dId = Number(di);
            var dName = ATTR_ID_TO_NAME[dId];
            if (!dName || dId === 21 || dId === 22) continue;
            if (POWER_BASE_WEIGHTS.hasOwnProperty(dName)) {
                displayStats[dName] = items[di]._num;
            }
        }
        var newPower = computePower(displayStats, heroConfig);
        items['21'] = { _id: 21, _num: newPower };

        log.arrow('AKUMULASI: oldPower=' + oldPower + ' → newPower=' + newPower
            + ' (delta=' + (newPower - oldPower) + ')');

        // ═══════════════════════════════════════════════════════
        //  5. SIMPAN _earrings ke savedData
        // ═══════════════════════════════════════════════════════

        var earItems = {};
        for (var ai = 0; ai < ringData.rawAttrs.length; ai++) {
            earItems[String(ai)] = { _id: ringData.rawAttrs[ai]._id, _num: ringData.rawAttrs[ai]._num };
        }
        suit._earrings = {
            _id: INITIAL_RING_ID,
            _level: ringLv,
            _attrs: { _items: earItems }
        };
        db._set(key, savedData);

        // ═══════════════════════════════════════════════════════
        //  6. RESPONSE
        // ═══════════════════════════════════════════════════════

        log.info('ACTIVE_RING', 'SUCCESS heroId=' + heroId
            + ' ringId=' + INITIAL_RING_ID + ' power=' + oldPower + '→' + newPower);

        callback({
            heroId: String(heroId),
            _totalAttr: { _items: items },
            _equip: {
                _suitItems: suit._suitItems,
                _suitAttrs: suit._suitAttrs,
                _equipAttrs: suit._equipAttrs,
                _earrings: suit._earrings,
                _weaponState: suit._weaponState || 0
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('equip', 'activeRing', handleActiveRing);

    window.MainServer = MainServer;
})();