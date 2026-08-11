/**
 * equip/autoRingLevelUp — Ring level up (single x1 atau one-key x10)
 *
 * Client call (L163351-163357):
 *   { type:"equip", action:"autoRingLevelUp", userId, heroId, version:"1.0",
 *     times: 1 | 10 }
 *   times=1 → single level up (levelUpBtnTap)
 *   times=10 → one-key level up (oneKeyLevelUpBtnTap)
 *
 * Client callback (L163358-163364):
 *   1. resetEquipData(heroId, e._equip)     → SetEquipDataToModel
 *   2. setTotalAttrsByHeroId(e, e.heroId)   → OVERWRITE totalAttr
 *   3. resetTtemsCallBack(e)                 → setItem(id, absoluteBalance)
 *   4. refreshCost() + openHeroAttrChange() + checkNextState()
 *
 * Response:
 *   heroId, _totalAttr: { _items }, _equip: { _suitItems, _suitAttrs, _equipAttrs, _earrings, _weaponState },
 *   _changeInfo: { _items: { "0":{_id, _num:<ABSOLUTE balance>}, ... } }
 *
 * APPROACH: AKUMULASI — baca hero.totalAttr dari HerosManager, hitung DELTA
 *   ring stats (old level vs new level), apply delta, recompute power.
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
    //  RING STATS — baca ring.json + ringLevelUp.json
    // ═══════════════════════════════════════════════════════════

    function getRingStats(ringId, ringLevel) {
        var flat = {};
        var rawAttrs = [];
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

        for (var fid in flat) {
            if (!flat.hasOwnProperty(fid)) continue;
            rawAttrs.push({ _id: Number(fid), _num: flat[fid] });
        }
        return { flat: flat, rawAttrs: rawAttrs };
    }

    // ═══════════════════════════════════════════════════════════
    //  EVOLVE GATE CHECK — block level up jika BELUM evolve
    //  Sama logika client L82909: evolveTo != earrings.id → waitEvolve
    // ═══════════════════════════════════════════════════════════

    function needsEvolveAt(level, ringId) {
        var re = loadJson('ringEvolve');
        if (re) {
            for (var k in re) {
                if (!re.hasOwnProperty(k)) continue;
                var entry = re[k];
                if (Number(entry.ringEvolve) !== Number(level)) continue;
                if (Number(entry.evolveTo) === Number(ringId)) continue; // sudah evolve
                return true;
            }
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM INVENTORY HELPERS (dari weapon/upgrade.js)
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
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleAutoRingLevelUp(request, callback) {
        try { _impl(request, callback); }
        catch (err) {
            log.error('AUTO_RING_LVUP', 'UNCAUGHT: ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback({}, 1);
        }
    }

    function _impl(request, callback) {
        var userId = request && request.userId;
        var heroId = request && request.heroId;
        var times  = Number(request && request.times) || 1;

        log.info('AUTO_RING_LVUP', 'START userId=' + (userId || '-')
            + ' heroId=' + (heroId || '-') + ' times=' + times);

        if (!userId || !heroId) { callback({}, 1); return; }

        var key = 'ms_user_' + userId + '_1';
        var savedData = db._get(key);
        if (!savedData) { log.error('AUTO_RING_LVUP', 'user not found'); callback({}, 1); return; }

        // ── Get suit & ring ──
        var sk = String(heroId);
        var suit = savedData.equip && savedData.equip._suits && savedData.equip._suits[sk];
        if (!suit || !suit._earrings || !Number(suit._earrings._id)) {
            log.error('AUTO_RING_LVUP', 'no active ring for heroId=' + heroId);
            callback({}, 1);
            return;
        }

        var ringId    = Number(suit._earrings._id);
        var oldLevel  = Number(suit._earrings._level) || 1;

        var ringLU    = loadJson('ringLevelUp');

        // ── Save OLD ring flat stats (for delta) ──
        var oldRingData = getRingStats(ringId, oldLevel);
        var oldFlat     = oldRingData.flat;

        // ── Level up loop ──
        var newLevel = oldLevel;
        var changeItems = {};  // _changeInfo._items: { itemId: newAbsoluteBalance }

        for (var t = 0; t < times; t++) {
            var nextLv = newLevel + 1;

            // Cek config level ada
            if (!ringLU || !ringLU[String(nextLv)]) {
                log.arrow('no config for level ' + nextLv + ' → stop');
                break;
            }

            // Cek evolve block — jika ada evolve entry di level ini yang BELUM dilakukan
            if (needsEvolveAt(newLevel, ringId)) {
                log.arrow('level ' + newLevel + ' needs evolve first (ringId=' + ringId + ')');
                break;
            }

            var lvConfig = ringLU[String(nextLv)];

            // Cek & deduct cost (up to 4 cost IDs, sama seperti client L163597)
            var canAfford = true;
            for (var ci = 1; ci <= 4; ci++) {
                var costId = lvConfig['levelUpCostID' + ci];
                var costNum = Number(lvConfig['num' + ci]) || 0;
                if (!costId || costNum <= 0) continue;

                var have = getItemNum(savedData, Number(costId));
                if (have < costNum) {
                    log.arrow('not enough: item ' + costId + ' have=' + have + ' need=' + costNum);
                    canAfford = false;
                    break;
                }
            }

            if (!canAfford) break;

            // Deduct semua cost
            for (var di = 1; di <= 4; di++) {
                var dCostId = lvConfig['levelUpCostID' + di];
                var dCostNum = Number(lvConfig['num' + di]) || 0;
                if (!dCostId || dCostNum <= 0) continue;
                dCostId = Number(dCostId);

                var newBal = deductItem(savedData, dCostId, dCostNum);
                changeItems[String(dCostId)] = { _id: dCostId, _num: newBal };
                log.arrow('deducted: item ' + dCostId + ' x' + dCostNum + ' → balance=' + newBal);
            }

            newLevel = nextLv;
        }

        // ── Jika tidak ada level up ──
        if (newLevel === oldLevel) {
            log.info('AUTO_RING_LVUP', 'NO LEVEL UP (old=' + oldLevel + ')');
            // Tetap kirim response sukses supaya UI tidak error
            callback({
                heroId: String(heroId),
                _totalAttr: { _items: {} },
                _equip: {
                    _suitItems: suit._suitItems || [],
                    _suitAttrs: suit._suitAttrs || [],
                    _equipAttrs: suit._equipAttrs || [],
                    _earrings: suit._earrings,
                    _weaponState: suit._weaponState || 0
                }
            });
            return;
        }

        log.info('AUTO_RING_LVUP', 'level ' + oldLevel + ' → ' + newLevel
            + ' (' + (newLevel - oldLevel) + ' levels)');

        // ── Compute NEW ring stats ──
        var newRingData = getRingStats(ringId, newLevel);
        var newFlat     = newRingData.flat;

        // ── Update _earrings di savedData ──
        var earItems = {};
        for (var ai = 0; ai < newRingData.rawAttrs.length; ai++) {
            earItems[String(ai)] = {
                _id: newRingData.rawAttrs[ai]._id,
                _num: newRingData.rawAttrs[ai]._num
            };
        }
        suit._earrings = {
            _id: ringId,
            _level: newLevel,
            _attrs: { _items: earItems }
        };

        // ── AKUMULASI: baca current totalAttr, apply DELTA ring stats ──
        var HM = HerosManager.getInstance();
        var hero = HM.getHero(heroId);
        if (!hero) {
            log.error('AUTO_RING_LVUP', 'hero not found in HerosManager');
            callback({}, 1);
            return;
        }

        var oldPower = hero.heroBaseAttr ? hero.heroBaseAttr.power : 0;

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

        // ── Apply DELTA: undo old ring, apply new ring ──
        var hp  = Number(items['0'] && items['0']._num) || 0;
        var atk = Number(items['1'] && items['1']._num) || 0;
        var arm = Number(items['2'] && items['2']._num) || 0;

        // 1) Undo old ring: reverse (flat + percent)
        //    Original formula: result = (base + oldFlat) * (1 + oldPct)
        //    Reverse: base = result / (1 + oldPct) - oldFlat
        var oldHpPct  = Number(oldFlat[17]) || 0;
        var oldArmPct = Number(oldFlat[18]) || 0;
        var oldAtkPct = Number(oldFlat[19]) || 0;

        if (oldHpPct  !== 0) hp  /= (1 + oldHpPct);
        if (oldAtkPct !== 0) atk /= (1 + oldAtkPct);
        if (oldArmPct !== 0) arm /= (1 + oldArmPct);

        hp  -= (Number(oldFlat[0]) || 0);
        atk -= (Number(oldFlat[1]) || 0);
        arm -= (Number(oldFlat[2]) || 0);

        // 2) Apply new ring: (base + newFlat) * (1 + newPct)
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

        // 3) Percent items: remove old ring %, add new ring %
        items['17'] = { _id: 17, _num: ((Number(items['17'] && items['17']._num) || 0) - oldHpPct  + newHpPct) };
        items['18'] = { _id: 18, _num: ((Number(items['18'] && items['18']._num) || 0) - oldArmPct + newArmPct) };
        items['19'] = { _id: 19, _num: ((Number(items['19'] && items['19']._num) || 0) - oldAtkPct + newAtkPct) };

        // 4) Other flat stats delta (speed, hit, dodge, block, dll)
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

        // ── Recompute POWER ──
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

        log.arrow('POWER: ' + oldPower + ' → ' + newPower + ' (delta=' + (newPower - oldPower) + ')');

        // ── Save ──
        db._set(key, savedData);

        // ── RESPONSE ──
        var response = {
            heroId: String(heroId),
            _totalAttr: { _items: items },
            _equip: {
                _suitItems: suit._suitItems || [],
                _suitAttrs: suit._suitAttrs || [],
                _equipAttrs: suit._equipAttrs || [],
                _earrings: suit._earrings,
                _weaponState: suit._weaponState || 0
            }
        };

        // _changeInfo: absolute item balances after deduction
        if (Object.keys(changeItems).length > 0) {
            response._changeInfo = { _items: changeItems };
        }

        log.info('AUTO_RING_LVUP', 'SUCCESS heroId=' + heroId
            + ' ringId=' + ringId + ' lv=' + oldLevel + '→' + newLevel
            + ' power=' + oldPower + '→' + newPower);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('equip', 'autoRingLevelUp', handleAutoRingLevelUp);

    window.MainServer = MainServer;
})();