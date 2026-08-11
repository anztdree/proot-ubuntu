/**
 * equip/ringEvolve — Ring evolve (ubah ring ID, level tetap, bonus CUMULATIVE)
 *
 * Client call (L163163-163168):
 *   { type:"equip", action:"ringEvolve", userId, heroId, version:"1.0" }
 *
 * Client callback (L163169-163186):
 *   if(n._changeInfo) {
 *     1. resetEquipData(n.heroId, n._equip)     → SetEquipDataToModel (L82832)
 *        → delete old equip, parse _suitItems/_suitAttrs/_equipAttrs
 *        → EarringsItem.deserialize(_earrings) (L83866)
 *          → this.attrs[] dari _attrs._items
 *          → this.id dari _id, this.level dari _level
 *     2. setTotalAttrsByHeroId(n, n.heroId)   → OVERWRITE totalAttr (L85171→L85201)
 *        → t.totalAttr[u.id] = u  (per-entry overwrite, bukan full replace)
 *        → power dari id=21
 *        → attrChangeValues = delta (untuk UI heroAttrChange popup)
 *     3. resetTtemsCallBack(n)                 → setItem(id, absoluteBalance) (L3133436)
 *     4. refreshCost() + turnBack()
 *        → ts.openWindow("EarringLevelUp", { evolveSuccess:true })
 *        → UIWindowManager.openHeroAttrChange()  ← pakai attrChangeValues
 *   }
 *
 * Client evolve entry lookup (L163387-163392):
 *   ringEvolve = merge(ringEvolve_json, earringDeify_json)  (L59854-59862)
 *   match: (!entry.heroType || entry.heroType == hero.heroType)
 *          && entry.ringEvolve == earrings.level
 *
 * Client state check (L82909):
 *   waitEvolve = entry.ringEvolve == earrings.level
 *                && entry.evolveTo != earrings.id
 *
 * Client EarringLevelUp initAll (7302558) setelah evolve:
 *   → baca earrings.id dari EquipInfoManager (sudah diupdate resetEquipData)
 *   → baca thingsID[earrings.id] untuk icon/nama ring BARU
 *
 * Client EarringLevelUp doRefresh (7304455):
 *   → data.initData() → baca earrings.level, ringLevelUp[level] untuk cost
 *   → baca earrings.attrs untuk display stat changes
 *
 * CUMULATIVE APPROACH:
 *   _earrings._attrs._items adalah SINGLE SOURCE OF TRUTH untuk ring stats.
 *   Evolve bonus DITUMPUK di atas stats yang sudah ada.
 *   Old stats dibaca dari _earrings._attrs._items (BUKAN getRingStats).
 *   newFlat = oldFlat + evolveBonus.
 *   Ring ID berubah ke evolveTo, level tetap.
 *
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.equip) MainServer.handlers.equip = {};

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

    /**
     * Load merged evolve table, sama seperti client L59854-59862
     */
    function loadMergedEvolveTable() {
        var base = loadJson('ringEvolve') || {};
        var deify = loadJson('earringDeify') || {};
        for (var k in deify) {
            if (deify.hasOwnProperty(k)) {
                base[k] = deify[k];
            }
        }
        return base;
    }

    // ═══════════════════════════════════════════════════════════
    //  RING ABILITY NAME → ATTR ID
    // ═══════════════════════════════════════════════════════════

    var RING_ATTR = {
        hp: 0, attack: 1, armor: 2, speed: 3, hit: 4, dodge: 5, block: 6,
        blockEffect: 7, skillDamage: 8, critical: 9, criticalResist: 10,
        criticalDamage: 11, armorBreak: 12, damageReduce: 13, controlResist: 14,
        trueDamage: 15, hpPercent: 17, armorPercent: 18, attackPercent: 19,
        extraArmor: 26
    };

    // ═══════════════════════════════════════════════════════════
    //  POWER COMPUTATION
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
    //  FALLBACK: baca ring stats dari config (untuk _attrs kosong)
    // ═══════════════════════════════════════════════════════════

    function getRingStats(ringId, ringLevel) {
        var flat = {};
        var rc = loadJson('ring');
        var lc = loadJson('ringLevelUp');
        var rd = rc ? rc[String(ringId)] : null;

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

        return flat;
    }

    // ═══════════════════════════════════════════════════════════
    //  PARSE EVOLVE BONUS ABILITIES → flat stats {attrId: value}
    // ═══════════════════════════════════════════════════════════

    function parseEvolveBonus(entry) {
        var flat = {};
        var abilityNum = Number(entry.abilityNum) || 0;
        for (var i = 1; i <= abilityNum; i++) {
            var abilityName = entry['ability' + i];
            var value = Number(entry['value' + i]) || 0;
            if (!abilityName || value === 0) continue;
            var aid = RING_ATTR[abilityName];
            if (aid === undefined) continue;
            flat[aid] = (flat[aid] || 0) + value;
        }
        return flat;
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
    //  BACA _earrings._attrs._items → flat {attrId: value}
    //  Ini adalah SINGLE SOURCE OF TRUTH untuk ring stats.
    //  ═══════════════════════════════════════════════════════════

    function readEarringAttrs(suit) {
        var flat = {};
        var currentAttrs = suit && suit._earrings && suit._earrings._attrs && suit._earrings._attrs._items;
        if (currentAttrs) {
            for (var caIdx in currentAttrs) {
                if (!currentAttrs.hasOwnProperty(caIdx)) continue;
                var caItem = currentAttrs[caIdx];
                if (caItem && caItem._id !== undefined) {
                    flat[caItem._id] = (flat[caItem._id] || 0) + Number(caItem._num);
                }
            }
        }
        return flat;
    }

    /**
     * Baca ring stats. Prioritas: _earrings._attrs._items > getRingStats fallback.
     */
    function getOldRingFlat(suit, ringId, ringLevel) {
        var fromAttrs = readEarringAttrs(suit);
        if (Object.keys(fromAttrs).length > 0) return fromAttrs;
        // Fallback: hitung dari config (untuk save data lama tanpa _attrs)
        log.arrow('WARNING: _earrings._attrs._items kosong, fallback ke getRingStats('
            + ringId + ',' + ringLevel + ')');
        return getRingStats(ringId, ringLevel);
    }

    /**
     * Build _earrings._attrs._items dari flat {attrId: value}
     * Format: { "0":{_id:0,_num:123}, "1":{_id:17,_num:0.05}, ... }
     */
    function buildEarringAttrsItems(flat) {
        var earItems = {};
        var earIdx = 0;
        for (var fk in flat) {
            if (!flat.hasOwnProperty(fk)) continue;
            earItems[String(earIdx)] = { _id: Number(fk), _num: flat[fk] };
            earIdx++;
        }
        return earItems;
    }

    // ═══════════════════════════════════════════════════════════
    //  FIND EVOLVE ENTRY — sama logika dengan client
    //  Client L163387-163392:
    //    (!l.heroType || l.heroType == a.heroType) && l.ringEvolve == n.earrings.level
    //  Client L82909 (state check):
    //    l.ringEvolve == r && l.evolveTo != n.earrings.id → waitEvolve
    // ═══════════════════════════════════════════════════════════

    function findEvolveEntry(currentLevel, currentRingId, heroType) {
        var table = loadMergedEvolveTable();
        for (var k in table) {
            if (!table.hasOwnProperty(k)) continue;
            var entry = table[k];
            if (entry.heroType && entry.heroType !== heroType) continue;
            if (Number(entry.ringEvolve) !== Number(currentLevel)) continue;
            if (Number(entry.evolveTo) === Number(currentRingId)) continue;
            return entry;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  TOTALATTR DELTA FORMULA
    //  ═══════════════════════════════════════════════════════════
    //
    //  Bagaimana ring stats berkontribusi ke totalAttr:
    //    activeRing: hp = (base + ringFlat) * (1 + ringPct)
    //    stored:     totalAttr[17] += ringPct  (additive %)
    //
    //  Untuk update ring stats (level up / evolve):
    //    Undo old:   base = hp / (1+oldPct) - oldFlat
    //    Apply new:  hp = (base + newFlat) * (1+newPct)
    //
    //  Untuk percent items (17,18,19): simple delta
    //    totalAttr[17] = oldTotal - oldRingPct + newRingPct
    //
    //  Untuk flat stats lain (speed, hit, dll): simple delta
    //    totalAttr[id] = oldTotal + (newFlat - oldFlat)
    // ═══════════════════════════════════════════════════════════

    function applyRingDeltaToTotalAttr(hero, oldFlat, newFlat, heroConfig) {
        // Clone current totalAttr
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

        // ── Core stats (hp, atk, armor): undo old ring, apply new ring ──
        var hp  = Number(items['0'] && items['0']._num) || 0;
        var atk = Number(items['1'] && items['1']._num) || 0;
        var arm = Number(items['2'] && items['2']._num) || 0;

        var oldHpPct  = Number(oldFlat[17]) || 0;
        var oldArmPct = Number(oldFlat[18]) || 0;
        var oldAtkPct = Number(oldFlat[19]) || 0;

        // Undo old ring: reverse (flat + percent)
        if (oldHpPct  !== 0) hp  /= (1 + oldHpPct);
        if (oldAtkPct !== 0) atk /= (1 + oldAtkPct);
        if (oldArmPct !== 0) arm /= (1 + oldArmPct);

        hp  -= (Number(oldFlat[0]) || 0);
        atk -= (Number(oldFlat[1]) || 0);
        arm -= (Number(oldFlat[2]) || 0);

        // Apply new ring: (base + newFlat) * (1 + newPct)
        hp  += (Number(newFlat[0]) || 0);
        atk += (Number(newFlat[1]) || 0);
        arm += (Number(newFlat[2]) || 0);

        var newHpPct  = Number(newFlat[17]) || 0;
        var newAtkPct = Number(newFlat[19]) || 0;
        var newArmPct = Number(newFlat[18]) || 0;

        if (newHpPct  !== 0) hp  *= (1 + newHpPct);
        if (newAtkPct !== 0) atk *= (1 + newAtkPct);
        if (newArmPct !== 0) arm *= (1 + newArmPct);

        items['0']  = { _id: 0,  _num: hp };
        items['1']  = { _id: 1,  _num: atk };
        items['2']  = { _id: 2,  _num: arm };
        items['22'] = { _id: 22, _num: hp }; // orghp

        // Percent items: simple delta (old → new)
        items['17'] = { _id: 17, _num: ((Number(items['17'] && items['17']._num) || 0) - oldHpPct  + newHpPct) };
        items['18'] = { _id: 18, _num: ((Number(items['18'] && items['18']._num) || 0) - oldArmPct + newArmPct) };
        items['19'] = { _id: 19, _num: ((Number(items['19'] && items['19']._num) || 0) - oldAtkPct + newAtkPct) };

        // Other flat stats delta (speed, hit, dodge, block, dll)
        for (var attrId in newFlat) {
            var aIdN = Number(attrId);
            if (aIdN === 0 || aIdN === 1 || aIdN === 2) continue;
            if (aIdN === 17 || aIdN === 18 || aIdN === 19) continue;
            var delta = (Number(newFlat[attrId]) || 0) - (Number(oldFlat[attrId]) || 0);
            if (delta !== 0) {
                var existing = Number(items[String(aIdN)] && items[String(aIdN)]._num) || 0;
                items[String(aIdN)] = { _id: aIdN, _num: existing + delta };
            }
        }

        // Recompute power
        var displayStats = {};
        for (var didx in items) {
            if (!items.hasOwnProperty(didx)) continue;
            var dId = Number(didx);
            var dName = ATTR_ID_TO_NAME[dId];
            if (!dName || dId === 21 || dId === 22) continue;
            if (POWER_BASE_WEIGHTS.hasOwnProperty(dName)) {
                displayStats[dName] = items[didx]._num;
            }
        }
        var newPower = computePower(displayStats, heroConfig);
        items['21'] = { _id: 21, _num: newPower };

        return { items: items, power: newPower };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleRingEvolve(request, callback) {
        try { _impl(request, callback); }
        catch (err) {
            log.error('RING_EVOLVE', 'UNCAUGHT: ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback({}, 1);
        }
    }

    function _impl(request, callback) {
        var userId = request && request.userId;
        var heroId = request && request.heroId;

        log.info('RING_EVOLVE', 'START userId=' + (userId || '-')
            + ' heroId=' + (heroId || '-'));

        if (!userId || !heroId) { callback({}, 1); return; }

        var key = 'ms_user_' + userId + '_1';
        var savedData = db._get(key);
        if (!savedData) { log.error('RING_EVOLVE', 'user not found'); callback({}, 1); return; }

        // ── Get suit & ring ──
        var sk = String(heroId);
        var suit = savedData.equip && savedData.equip._suits && savedData.equip._suits[sk];
        if (!suit || !suit._earrings || !Number(suit._earrings._id)) {
            log.error('RING_EVOLVE', 'no active ring for heroId=' + heroId);
            callback({}, 1);
            return;
        }

        var oldRingId = Number(suit._earrings._id);
        var ringLevel = Number(suit._earrings._level) || 1;

        // ── Get hero info (heroType + level) ──
        var HM = HerosManager.getInstance();
        var hero = HM.getHero(heroId);
        if (!hero) {
            log.error('RING_EVOLVE', 'hero not found in HerosManager');
            callback({}, 1);
            return;
        }

        var heroConfig = (loadJson('hero') || {})[String(hero.heroDisplayId)] || {};
        var heroType = heroConfig.heroType || '';
        var heroLevel = (hero.heroBaseAttr && hero.heroBaseAttr.level) || 0;

        // User level
        var userLevel = 0;
        try {
            userLevel = UserInfoSingleton.getInstance().getUserLevel() || 0;
        } catch (e) {
            userLevel = Number(savedData.level) || 0;
        }

        // ── Find matching evolve entry ──
        var evolveEntry = findEvolveEntry(ringLevel, oldRingId, heroType);
        if (!evolveEntry) {
            log.error('RING_EVOLVE', 'no evolve entry found for ringId=' + oldRingId
                + ' level=' + ringLevel + ' heroType=' + (heroType || '(any)'));
            callback({}, 1);
            return;
        }

        var newRingId = Number(evolveEntry.evolveTo);
        var heroLevelNeeded = Number(evolveEntry.heroLevelNeeded) || 0;
        var playerLevelNeeded = Number(evolveEntry.playerLevelNeeded) || 0;

        log.details('evolveMatch', [
            ['oldRingId', String(oldRingId)],
            ['newRingId', String(newRingId)],
            ['ringLevel', String(ringLevel)],
            ['heroType', heroType || '(any)'],
            ['heroLevel', String(heroLevel) + '/' + heroLevelNeeded],
            ['playerLevel', String(userLevel) + '/' + playerLevelNeeded]
        ]);

        // ── Validate level requirements ──
        if (heroLevel < heroLevelNeeded) {
            log.arrow('hero level not enough: ' + heroLevel + ' < ' + heroLevelNeeded);
            callback({}, 1);
            return;
        }
        if (userLevel < playerLevelNeeded) {
            log.arrow('player level not enough: ' + userLevel + ' < ' + playerLevelNeeded);
            callback({}, 1);
            return;
        }

        // ── Validate & deduct cost ──
        var costIds = [];
        var costNums = [];

        if (evolveEntry.evolveCostID1 && Number(evolveEntry.num1) > 0) {
            costIds.push(Number(evolveEntry.evolveCostID1));
            costNums.push(Number(evolveEntry.num1));
        }
        if (evolveEntry.evolveCostID2 && Number(evolveEntry.num2) > 0) {
            costIds.push(Number(evolveEntry.evolveCostID2));
            costNums.push(Number(evolveEntry.num2));
        }

        // Cek cukup?
        for (var ci = 0; ci < costIds.length; ci++) {
            var have = getItemNum(savedData, costIds[ci]);
            if (have < costNums[ci]) {
                log.arrow('not enough: item ' + costIds[ci] + ' have=' + have + ' need=' + costNums[ci]);
                callback({});
                return;
            }
        }

        // Deduct semua cost
        var changeItems = {};
        for (var di = 0; di < costIds.length; di++) {
            var newBal = deductItem(savedData, costIds[di], costNums[di]);
            changeItems[String(costIds[di])] = { _id: costIds[di], _num: newBal };
            log.arrow('deducted: item ' + costIds[di] + ' x' + costNums[di] + ' → balance=' + newBal);
        }

        // ═══════════════════════════════════════════════════════
        //  HITUNG STATS — CUMULATIVE
        // ═══════════════════════════════════════════════════════

        var oldFlat = getOldRingFlat(suit, oldRingId, ringLevel);
        var evolveBonus = parseEvolveBonus(evolveEntry);

        // newFlat = oldFlat + evolveBonus (CUMULATIVE)
        var newFlat = {};
        for (var ofk in oldFlat) newFlat[ofk] = oldFlat[ofk];
        for (var ebKey in evolveBonus) {
            if (!evolveBonus.hasOwnProperty(ebKey)) continue;
            newFlat[ebKey] = (newFlat[ebKey] || 0) + evolveBonus[ebKey];
        }

        log.details('statsDelta', [
            ['oldFlat', JSON.stringify(oldFlat)],
            ['evolveBonus', JSON.stringify(evolveBonus)],
            ['newFlat', JSON.stringify(newFlat)]
        ]);

        // ═══════════════════════════════════════════════════════
        //  UPDATE _earrings di savedData
        // ═══════════════════════════════════════════════════════

        suit._earrings = {
            _id: newRingId,
            _level: ringLevel,
            _attrs: { _items: buildEarringAttrsItems(newFlat) }
        };

        // ═══════════════════════════════════════════════════════
        //  APPLY DELTA KE totalAttr + RECOMPUTE POWER
        // ═══════════════════════════════════════════════════════

        var oldPower = hero.heroBaseAttr ? hero.heroBaseAttr.power : 0;
        var result = applyRingDeltaToTotalAttr(hero, oldFlat, newFlat, heroConfig);
        var newPower = result.power;

        log.arrow('POWER: ' + oldPower + ' → ' + newPower + ' (delta=' + (newPower - oldPower) + ')');

        // ── Save ──
        db._set(key, savedData);

        // ── RESPONSE ──
        var response = {
            heroId: String(heroId),
            _totalAttr: { _items: result.items },
            _equip: {
                _suitItems: suit._suitItems || [],
                _suitAttrs: suit._suitAttrs || [],
                _equipAttrs: suit._equipAttrs || [],
                _earrings: suit._earrings,
                _weaponState: suit._weaponState || 0
            }
        };

        if (Object.keys(changeItems).length > 0) {
            response._changeInfo = { _items: changeItems };
        }

        log.info('RING_EVOLVE', 'SUCCESS heroId=' + heroId
            + ' ring ' + oldRingId + '→' + newRingId
            + ' lv=' + ringLevel
            + ' power=' + oldPower + '→' + newPower);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('equip', 'ringEvolve', handleRingEvolve);

    window.MainServer = MainServer;
})();
