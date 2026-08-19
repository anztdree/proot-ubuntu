/**
 * handlers/weapon/merge.js — Weapon Piece Merge Handler
 * Super Warrior Z — MAIN SERVER
 *
 * TUGAS: Merge weapon pieces → produce weapons.
 * User konsumsi N pieces → dapat N weapon.
 *
 * CONFIG CHAIN (resource/json):
 *   1. weaponPiece.json[pieceId] → mergeNum (pieces per merge), mergeRandom (key ke weaponMerge)
 *   2. weaponMerge.json[mergeRandom] → weaponID (OBJECT=direct, ARRAY=random by weight)
 *   3. weaponStrengthen.json → cari weapon==weaponID && level==1 → attack value
 *   4. weapon.json[weaponID] → quality (client set saat deserialize, TIDAK dikirim server)
 *
 * STORAGE:
 *   Pieces: savedData.totalProps._items (ARRAY) → deduct mergeNum × mergeCount
 *   Weapons: savedData.weapon._items (OBJECT keyed by weaponId) → add WeaponDataModel
 *
 * RESPONSE:
 *   { _changeInfo: { _items: { "<pieceId>": {_id, _num:<ABSOLUTE>} } },
 *     _addWeapons: [<WeaponDataModel>, ...] }
 *
 * Client openCongratulationObtain (L56636-56651):
 *   - saveGainWithOutItems → _addWeapons → deserialize → addToWeap
 *   - _changeInfo._items → openCommonItemGetTips → setItem(id, num) OVERWRITE inventory
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

    var ATTR_ATTACK = 1;  // abilityName.json[1].englishName = "attack"

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJson(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
            log.error('RESOURCE', 'weapon/merge failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'weapon/merge failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getWeaponPieceConfig(pieceId) {
        var wp = loadJson('weaponPiece');
        return wp ? wp[String(pieceId)] : null;
    }

    function getWeaponMergeConfig(mergeRandomKey) {
        var wm = loadJson('weaponMerge');
        return wm ? wm[String(mergeRandomKey)] : null;
    }

    function getWeaponStrengthenAttack(weaponId) {
        var ws = loadJson('weaponStrengthen');
        if (!ws) return 0;
        for (var k in ws) {
            if (!ws.hasOwnProperty(k)) continue;
            var entry = ws[k];
            if (Number(entry.weapon) === Number(weaponId) && Number(entry.level) === 1) {
                return Number(entry.attack) || 0;
            }
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  INVENTORY HELPERS (pattern dari semua handler)
    // ═══════════════════════════════════════════════════════════

    function getItemBalance(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                return;
            }
        }
        items.push({ _id: Number(itemId), _num: newBalance });
    }

    // ═══════════════════════════════════════════════════════════
    //  WEAPON INSTANCE ID GENERATOR
    //  addToWeap (L82808): WeaponDataArray[weaponId] — check duplicate
    //  Jadi weaponId harus unique per weapon instance.
    // ═══════════════════════════════════════════════════════════

    var _weaponIdCounter = 0;

    function generateWeaponInstanceId(userId) {
        _weaponIdCounter++;
        return 'weapon_' + userId + '_' + Date.now() + '_' + _weaponIdCounter;
    }

    // ═══════════════════════════════════════════════════════════
    //  WEAPON MERGE RESULT PICKER
    //  weaponMerge.json[mergeRandom]:
    //    OBJECT → direct weaponID
    //    ARRAY → random pick by weight (random field)
    //
    //  Verified dari main.min.js getWeaponMergeId (L52953-52964):
    //    if(!Array.isArray(r)) return r.weaponID;
    //    for(var i in r) return r[i].weaponID;  ← client selalu pick first
    //  Tapi untuk mock server, kita pick random by weight untuk lebih realistis.
    // ═══════════════════════════════════════════════════════════

    function pickMergeResultWeapon(mergeConfig) {
        if (!mergeConfig) return 0;

        if (!Array.isArray(mergeConfig)) {
            // OBJECT → direct weaponID
            return Number(mergeConfig.weaponID) || 0;
        }

        // ARRAY → random pick by weight
        var totalWeight = 0;
        for (var i = 0; i < mergeConfig.length; i++) {
            totalWeight += Number(mergeConfig[i].random) || 0;
        }

        if (totalWeight <= 0) {
            // Fallback: pick first
            return Number(mergeConfig[0].weaponID) || 0;
        }

        var roll = Math.random() * totalWeight;
        var cumulative = 0;
        for (var j = 0; j < mergeConfig.length; j++) {
            cumulative += Number(mergeConfig[j].random) || 0;
            if (roll < cumulative) {
                return Number(mergeConfig[j].weaponID) || 0;
            }
        }

        return Number(mergeConfig[mergeConfig.length - 1].weaponID) || 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD WeaponDataModel
    //  Format (verified dari L88017-88048):
    //    _weaponId (string), _displayId (number), _heroId (string),
    //    _star (number), _level (number),
    //    _attrs: { _items: { "1": {_id:1, _num:<attack>} } }  ← OBJECT keyed by string
    //    _strengthenCost: { _items: {} }  ← OBJECT
    //    _haloId (number), _haloLevel (number),
    //    _haloCost: { _items: {} }  ← OBJECT
    //
    //  Quality TIDAK dikirim — client set dari weapon.json[_displayId].quality
    //  saat deserialize (L88043-88045).
    // ═══════════════════════════════════════════════════════════

    function buildWeaponDataModel(weaponDisplayId, attack, weaponInstanceId) {
        return {
            _weaponId: String(weaponInstanceId),
            _displayId: Number(weaponDisplayId),
            _heroId: "",
            _star: 0,
            _level: 1,
            _attrs: {
                _items: {
                    "1": { _id: ATTR_ATTACK, _num: attack }
                }
            },
            _strengthenCost: {
                _items: {}
            },
            _haloId: 0,
            _haloLevel: 0,
            _haloCost: {
                _items: {}
            }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  WEAPON STORAGE — savedData.weapon._items (OBJECT keyed by weaponId)
    //  Pattern dari enterGame.js L1226: r.weapon = { _items: {} }
    //  readByData (L82821-82826): for(s in i) { deserialize(i[s]), addToWeap(weaponId) }
    // ═══════════════════════════════════════════════════════════

    function addWeaponToStorage(savedData, weaponDataModel) {
        if (!savedData.weapon) savedData.weapon = { _items: {} };
        if (!savedData.weapon._items) savedData.weapon._items = {};

        var weaponId = weaponDataModel._weaponId;
        savedData.weapon._items[String(weaponId)] = weaponDataModel;
    }

    // ═══════════════════════════════════════════════════════════
    //  PROCESS SINGLE PIECE TYPE
    //  Input: { id: <pieceId>, num: <mergeCount> }
    //  Output: { weapons: [<WeaponDataModel>], changeItems: { "<pieceId>": {_id, _num} } }
    // ═══════════════════════════════════════════════════════════

    function processPieceMerge(savedData, userId, pieceEntry) {
        var pieceId = Number(pieceEntry.id);
        var mergeCount = Number(pieceEntry.num) || 0;

        if (!pieceId || mergeCount <= 0) {
            log.warn('WEAPON_MERGE', 'Invalid piece entry: id=' + pieceId + ' num=' + mergeCount);
            return { weapons: [], changeItems: {} };
        }

        // 1. Load weaponPiece.json[pieceId]
        var pieceCfg = getWeaponPieceConfig(pieceId);
        if (!pieceCfg) {
            log.warn('WEAPON_MERGE', 'weaponPiece.json not found for pieceId=' + pieceId);
            return { weapons: [], changeItems: {} };
        }

        var mergeNum = Number(pieceCfg.mergeNum) || 0;
        var mergeRandom = pieceCfg.mergeRandom;

        if (mergeNum <= 0) {
            log.warn('WEAPON_MERGE', 'Invalid mergeNum=' + mergeNum + ' for pieceId=' + pieceId);
            return { weapons: [], changeItems: {} };
        }

        // 2. Validate: user punya cukup pieces?
        var currentBalance = getItemBalance(savedData, pieceId);
        var totalPiecesNeeded = mergeNum * mergeCount;

        if (currentBalance < totalPiecesNeeded) {
            log.warn('WEAPON_MERGE', 'Not enough pieces: have=' + currentBalance
                + ' need=' + totalPiecesNeeded + ' (mergeNum=' + mergeNum + ' × count=' + mergeCount + ')');
            return { weapons: [], changeItems: {} };
        }

        // 3. Load weaponMerge.json[mergeRandom]
        var mergeCfg = getWeaponMergeConfig(mergeRandom);
        if (!mergeCfg) {
            log.warn('WEAPON_MERGE', 'weaponMerge.json not found for mergeRandom=' + mergeRandom);
            return { weapons: [], changeItems: {} };
        }

        // 4. Deduct pieces from inventory
        var newBalance = currentBalance - totalPiecesNeeded;
        setItemBalance(savedData, pieceId, newBalance);

        var changeItems = {};
        changeItems[String(pieceId)] = {
            _id: pieceId,
            _num: newBalance  // ABSOLUTE balance
        };

        // 5. Produce weapons (1 per merge operation)
        var weapons = [];
        for (var i = 0; i < mergeCount; i++) {
            // Pick weapon result (direct or random)
            var weaponDisplayId = pickMergeResultWeapon(mergeCfg);
            if (!weaponDisplayId) {
                log.error('WEAPON_MERGE', 'Failed to pick weapon for mergeRandom=' + mergeRandom);
                continue;
            }

            // Get attack from weaponStrengthen.json (level 1)
            var attack = getWeaponStrengthenAttack(weaponDisplayId);

            // Generate unique weapon instance ID
            var weaponInstanceId = generateWeaponInstanceId(userId);

            // Build WeaponDataModel
            var weaponModel = buildWeaponDataModel(weaponDisplayId, attack, weaponInstanceId);

            // Add to server storage
            addWeaponToStorage(savedData, weaponModel);

            // Add to response
            weapons.push(weaponModel);

            log.details('WEAPON_MERGE', [
                ['weapon' + (i + 1), 'pieceId=' + pieceId + ' → weaponDisplayId=' + weaponDisplayId
                    + ' attack=' + attack + ' instanceId=' + weaponInstanceId]
            ]);
        }

        log.info('WEAPON_MERGE', 'Piece ' + pieceId + ': ' + mergeCount + ' merges × ' + mergeNum
            + ' pieces = ' + totalPiecesNeeded + ' consumed → ' + weapons.length + ' weapons produced'
            + ' (balance ' + currentBalance + ' → ' + newBalance + ')');

        return { weapons: weapons, changeItems: changeItems };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleMerge(request, callback) {
        // OUTER SAFETY NET — client BACA t._changeInfo + t._addWeapons.
        // openCongratulationObtain (L56637): if(!(t._changeInfo || t._addWeapons || ...))
        //   → "没有任何东西！！！" → return tanpa crash.
        // Tapi最好 return valid response.
        try {
            _handleMergeImpl(request, callback);
        } catch (err) {
            log.error('WEAPON_MERGE', 'UNCAUGHT EXCEPTION: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback({ _changeInfo: { _items: {} }, _addWeapons: [] });
        }
    }

    function _handleMergeImpl(request, callback) {
        var userId = request && request.userId;
        var pieces = request && request.pieces;

        log.info('WEAPON_MERGE', 'START (userId=' + (userId || '-') + ')');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['pieces', JSON.stringify(pieces || [])],
            ['version', (request && request.version) || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('WEAPON_MERGE', 'missing userId');
            callback({ _changeInfo: { _items: {} }, _addWeapons: [] });
            return;
        }

        if (!pieces || !Array.isArray(pieces) || pieces.length === 0) {
            log.error('WEAPON_MERGE', 'missing or empty pieces array');
            callback({ _changeInfo: { _items: {} }, _addWeapons: [] });
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('WEAPON_MERGE', 'user data not found: ' + key);
            callback({ _changeInfo: { _items: {} }, _addWeapons: [] });
            return;
        }

        // ── PROCESS EACH PIECE TYPE ──
        var allWeapons = [];
        var allChangeItems = {};

        for (var i = 0; i < pieces.length; i++) {
            var result = processPieceMerge(savedData, userId, pieces[i]);
            // Accumulate weapons
            for (var w = 0; w < result.weapons.length; w++) {
                allWeapons.push(result.weapons[w]);
            }
            // Accumulate changeItems (merge keys)
            for (var ck in result.changeItems) {
                if (!result.changeItems.hasOwnProperty(ck)) continue;
                allChangeItems[ck] = result.changeItems[ck];
            }
        }

        // ── SAVE USER DATA ──
        db._set(key, savedData);

        // ── BUILD RESPONSE ──
        var response = {
            _changeInfo: {
                _items: allChangeItems
            },
            _addWeapons: allWeapons
        };

        log.info('WEAPON_MERGE', 'SUCCESS — ' + allWeapons.length + ' weapons produced'
            + ', ' + Object.keys(allChangeItems).length + ' piece types consumed');
        log.details('response', [
            ['userId', userId],
            ['_changeInfo._items.count', String(Object.keys(allChangeItems).length)],
            ['_addWeapons.count', String(allWeapons.length)],
            ['weapons', allWeapons.map(function(w) {
                return w._displayId + '(atk=' + (w._attrs._items['1'] ? w._attrs._items['1']._num : '?') + ')';
            }).join(', ')],
            ['piecesConsumed', JSON.stringify(allChangeItems)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('weapon', 'merge', handleMerge);

})();
