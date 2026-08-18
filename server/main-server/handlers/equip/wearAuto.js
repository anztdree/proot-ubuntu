/**
 * handlers/equip/wearAuto.js — One-Step Wear (Auto Equip Best Gear)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════
 * REFACTORED: Stat computation 100% delegated to heroStats.js
 * ═══════════════════════════════════════════════════════════════════
 *
 * Client call (main.min.js):
 *   processHandler({
 *     type: "equip", action: "wearAuto",
 *     userId, heroId,
 *     equipInfo: { "1": "3001", "2": "3002", "3": "3003", "4": "3004" },
 *     weaponId: "",
 *     version: "1.0"
 *   }, callback)
 *
 * Client response processing (3 callbacks):
 *   1. EquipInfoManager.oneSteapWear(response)
 *      → SetEquipDataToModel(response._equipItem)
 *   2. HerosManager.setTotalAttrsByHeroId(response, response.heroId)
 *      → _totalAttr._items → heroData.totalAttr[id] = {id, num}
 *      → id==21 → heroBaseAttr.power = Math.floor(_num)
 *   3. ItemsCommonSingleton.resetTtemsCallBack(response)
 *      → _changeInfo._items → setItem(id, num) [ABSOLUTE balance]
 *
 * ═══════════════════════════════════════════════════════════════════
 * PIPELINE (simplified via heroStats.js)
 * ═══════════════════════════════════════════════════════════════════
 *
 * 1. Load savedData  (key: user:UID)
 * 2. Find hero
 * 3. Snapshot old suit items
 * 4. Process equip swap  (return old → inventory, consume new, update _suits)
 * 5. heroStats.computeHeroStats(heroId, savedData)  ← SINGLE SOURCE OF TRUTH
 * 6. Build _equipAttrs from ALL equipped suit items
 * 7. Build response, persist, task check
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;
    var heroStats = MainServer.heroStats;

    if (!MainServer.handlers.equip) {
        MainServer.handlers.equip = {};
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INVENTORY HELPERS
    //  Server storage: totalProps._items = [{_id, _num}, ...] (ARRAY)
    // ═══════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════
    //  EQUIP ABILITY EXTRACTION
    //  Reuses heroStats.loadJson for config access (shared cache).
    // ═══════════════════════════════════════════════════════════════════

    function getEquipAbilities(equipConfig) {
        var abilities = [];
        if (!equipConfig) return abilities;
        for (var n = 1; n <= 3; n++) {
            var aId = equipConfig['abilityID' + n];
            var val = equipConfig['value' + n];
            if (aId !== undefined && aId !== '' && val !== undefined) {
                abilities.push({ abilityId: Number(aId), value: Number(val) || 0 });
            }
        }
        return abilities;
    }

    /**
     * Sum flat stats from ALL equipped suit items (for _equipAttrs response).
     * @param {Array} suitItems — savedData.equip._suits[heroId]._suitItems
     * @returns {Array} [{_id: abilityId, _num: totalValue}, ...] non-zero only
     */
    function sumSuitItemAttrs(suitItems) {
        var equipCfg = heroStats.loadJson('equip');
        if (!equipCfg || !suitItems || !suitItems.length) return [];

        var flat = {};
        for (var i = 0; i < suitItems.length; i++) {
            var eq = equipCfg[String(suitItems[i]._id)];
            if (!eq) continue;
            var abs = getEquipAbilities(eq);
            for (var j = 0; j < abs.length; j++) {
                flat[abs[j].abilityId] = (flat[abs[j].abilityId] || 0) + abs[j].value;
            }
        }

        var result = [];
        for (var id in flat) {
            if (flat.hasOwnProperty(id) && flat[id] !== 0) {
                result.push({ _id: Number(id), _num: flat[id] });
            }
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  EQUIP SWAP — inventory + savedData update
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Process equip swap: return old items to inventory, consume new items,
     * and update savedData.equip._suits[heroId] IN PLACE.
     *
     * IMPORTANT: Must run BEFORE heroStats.computeHeroStats(), because
     * heroStats reads the UPDATED savedData to compute equipment bonuses.
     *
     * @param {Object} savedData  — user saved data (modified in place)
     * @param {string} heroId    — hero instance ID
     * @param {Object} equipInfo — request payload: {pos: equipId, ...}
     * @param {Array}  oldSuitItems — snapshot of hero's current _suitItems
     * @returns {Object} changeItems — ABSOLUTE balances keyed by string ID
     */
    function processEquipSwap(savedData, heroId, equipInfo, oldSuitItems) {
        var changeItems = {};

        var oldByPos = {};
        if (oldSuitItems && oldSuitItems.length) {
            for (var i = 0; i < oldSuitItems.length; i++) {
                oldByPos[Number(oldSuitItems[i]._pos)] = oldSuitItems[i];
            }
        }

        for (var pos in equipInfo) {
            if (!equipInfo.hasOwnProperty(pos)) continue;
            var eid = equipInfo[pos];
            if (!eid) continue;
            var posNum = Number(pos);

            if (oldByPos[posNum]) {
                var oldId = Number(oldByPos[posNum]._id);
                var prevBal = getBal(savedData, oldId);
                var newBal = prevBal + 1;
                setBal(savedData, oldId, newBal);
                changeItems[String(oldId)] = { _id: oldId, _num: newBal };

                log.details('inventory', [
                    ['return pos ' + posNum, String(oldId)],
                    ['balance', prevBal + ' → ' + newBal]
                ]);
                delete oldByPos[posNum];
            }

            var newId = Number(eid);
            var prevNewBal = getBal(savedData, newId);
            var afterNewBal = Math.max(0, prevNewBal - 1);
            setBal(savedData, newId, afterNewBal);
            changeItems[String(newId)] = { _id: newId, _num: afterNewBal };

            log.details('inventory', [
                ['consume', String(newId)],
                ['balance', prevNewBal + ' → ' + afterNewBal]
            ]);
        }

        var merged = [];

        for (var op in oldByPos) {
            if (!oldByPos.hasOwnProperty(op)) continue;
            var keep = oldByPos[op];
            merged.push({
                _id: String(keep._id),
                _pos: Number(keep._pos),
                _version: keep._version || '201906201330'
            });
        }

        for (var np in equipInfo) {
            if (!equipInfo.hasOwnProperty(np)) continue;
            if (!equipInfo[np]) continue;
            merged.push({
                _id: String(equipInfo[np]),
                _pos: Number(np),
                _version: '201906201330'
            });
        }

        if (!savedData.equip) savedData.equip = {};
        if (!savedData.equip._suits) savedData.equip._suits = {};
        if (!savedData.equip._suits[heroId]) savedData.equip._suits[heroId] = {};
        savedData.equip._suits[heroId]._suitItems = merged;

        return changeItems;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  RESPONSE BUILDERS
    // ═══════════════════════════════════════════════════════════════════

    function buildResponseSuitItems(suitItems) {
        if (!suitItems) return [];
        var result = [];
        for (var i = 0; i < suitItems.length; i++) {
            result.push({
                _id: String(suitItems[i]._id),
                _pos: Number(suitItems[i]._pos),
                _version: suitItems[i]._version || '201906201330'
            });
        }
        return result;
    }

    function buildEarringBlock(savedData, heroId) {
        var earData = savedData && savedData.earring && savedData.earring._earring;
        if (earData && (Number(earData._level) || 0) > 0) {
            return {
                _id: Number(earData._id) || 0,
                _level: Number(earData._level) || 0,
                _attrs: earData._attrs || { _items: {}, _version: '' }
            };
        }
        return { _id: 0, _level: 0, _attrs: { _items: {}, _version: '' } };
    }

    function getWeaponState(savedData, heroId) {
        if (savedData && savedData.weapon && savedData.weapon._weapons) {
            return savedData.weapon._weapons[heroId] ? 1 : 0;
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  TASK CHECK — getOnAllEquip
    // ═══════════════════════════════════════════════════════════════════

    function checkEquipTask(savedData) {
        try {
            var cmt = savedData.curMainTask;
            if (!cmt || !Array.isArray(cmt) || !cmt.length || cmt[0]._state !== 1) return;

            var tcCfg = heroStats.loadJson('task');
            var tcDef = tcCfg && tcCfg[cmt[0]._id];
            if (!tcDef || tcDef.taskType !== 'getOnAllEquip') return;

            var needCount = Number(tcDef.taskPara1) || 0;
            var suits = savedData.equip && savedData.equip._suits;
            var count = 0;

            if (suits) {
                for (var k in suits) {
                    if (!suits.hasOwnProperty(k)) continue;
                    var items = suits[k]._suitItems;
                    if (items && Array.isArray(items) && items.length > 0) count++;
                }
            }

            if (count >= needCount) {
                cmt[0]._state = 2;
                log.info('TASK', 'getOnAllEquip COMPLETE (' + count + '/' + needCount + ' heroes)');
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: 2 }]
                    });
                }
            } else {
                log.info('TASK', 'getOnAllEquip progress ' + count + '/' + needCount);
            }
        } catch (e) {
            log.warn('TASK', 'getOnAllEquip check error: ' + (e.message || e));
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  HANDLER: equip/wearAuto
    // ═══════════════════════════════════════════════════════════════════

    function handleWearAuto(request, callback) {
        var userId = request.userId;
        var heroId = request.heroId;
        var equipInfo = request.equipInfo || {};
        var weaponId = request.weaponId || '';

        log.info('WEARAUTO', 'equip/wearAuto');
        log.details('WEARAUTO', [
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

            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);
            if (!savedData) {
                log.warn('WEARAUTO', 'User data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            var found = heroStats.findHeroInStorage(savedData, heroId);
            if (!found || !found.hero) {
                log.warn('WEARAUTO', 'Hero not found: ' + heroId);
                callback({}, 1);
                return;
            }

            var oldSuitItems = [];
            if (savedData.equip && savedData.equip._suits && savedData.equip._suits[heroId]) {
                oldSuitItems = savedData.equip._suits[heroId]._suitItems || [];
            }

            var changeInfoItems = processEquipSwap(savedData, heroId, equipInfo, oldSuitItems);

            var statsResult = heroStats.computeHeroStats(heroId, savedData);
            if (!statsResult) {
                log.error('WEARAUTO', 'heroStats.computeHeroStats returned null for heroId: ' + heroId);
                callback({}, 1);
                return;
            }

            var allSuitItems = savedData.equip._suits[heroId]._suitItems || [];
            var equipAttrs = sumSuitItemAttrs(allSuitItems);

            var response = {
                type: 'equip',
                action: 'wearAuto',
                userId: userId,
                heroId: heroId,
                equipInfo: equipInfo,
                weaponId: weaponId,
                version: '1.0',
                _totalAttr: { _items: statsResult.totalItems },
                _changeInfo: { _items: changeInfoItems },
                _equipItem: {
                    _suitItems: buildResponseSuitItems(allSuitItems),
                    _earrings: buildEarringBlock(savedData, heroId),
                    _suitAttrs: [],
                    _equipAttrs: equipAttrs,
                    _weaponState: getWeaponState(savedData, heroId)
                },
                _linkHeroesTotalAttr: {}
            };

            log.details('WEARAUTO', [
                ['totalAttrs', String(Object.keys(statsResult.totalItems).length) + ' items'],
                ['changeInfo', String(Object.keys(changeInfoItems).length) + ' items'],
                ['equipAttrs', String(equipAttrs.length) + ' entries'],
                ['power', String(statsResult.totalItems['21'] ? statsResult.totalItems['21']._num : '?')]
            ]);

            db._set(storageKey, savedData);
            checkEquipTask(savedData);

            log.info('WEARAUTO', 'success');
            callback(response);

        } catch (err) {
            log.error('WEARAUTO', 'UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    MainServer.registerHandler('equip', 'wearAuto', handleWearAuto);
    window.MainServer = MainServer;

})();
