/**
 * handlers/backpack/openBox.js — Backpack Open Box Handler (PERFECT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: backpack/openBox
 * TYPE: backpack  |  ACTION: openBox
 *
 * Buka box/item dari backpack. Tiga varian request:
 *   1. CombinationBox (thingsType='combinationBox') — bundle, beri SEMUA item sekaligus
 *   2. RandomBox     (thingsType='randomBox')      — weighted random dari randomBox.json
 *   3. ChooseBox     (thingsType='chooseBox')      — player pilih dari chooseBox.json
 *
 * ============================================================
 * REWARD TYPE DISPATCH (7 paths — traced from client L56636-56721)
 * ============================================================
 *
 *   thingsType        → Response Key       → Client Storage         → Server Storage
 *   ─────────────────────────────────────────────────────────────────────────────────
 *   hero              → _addHeroes (array) → HerosManager.addToHeros → savedData.heros._heros[key]
 *   weapon            → _addWeapons (array)→ EquipInfoManager.addToWeap → savedData.weapon._items[weaponId]
 *   jewel             → _addStones  (array)→ EquipInfoManager.addGemStoneToList → savedData.gemstone._items[id]
 *   jewelSpecial      → _addStones  (array)→ (same as jewel)         → savedData.gemstone._items[id]
 *   sign              → _addSigns   (array)→ SignInfoManager.addSigns → savedData.imprint._items (ARRAY push)
 *   genki             → _addGenkis  (array)→ EquipInfoManager.addGenKiToList → savedData.genki._items[id]
 *   ALL OTHER types   → _changeInfo._items  → ItemsCommonSingleton.setItem → savedData.totalProps._items
 *
 *   Client guard (L56637): if no _changeInfo, _addHeroes, _addSigns, _addWeapons,
 *   _addStones, _addGenkis → "nothing" + return.
 *
 * ============================================================
 * DATA MODELS (verified from client deserialize)
 * ============================================================
 *
 *   WeaponDataModel (L88017+):
 *     { _weaponId: String, _displayId: Number, _heroId: "",
 *       _star: 0, _level: 1,
 *       _attrs: { _items: { "1": { _id: 1, _num: <attack> } } },
 *       _strengthenCost: { _items: {} },
 *       _haloId: 0, _haloLevel: 0, _haloCost: { _items: {} } }
 *     → deserialize: isCommonType strips _ prefix. Quality set by client from weapon.json.
 *
 *   GemstoneItem (L83940-83952):
 *     { _id: String, _displayId: Number, _heroId: "",
 *       _level: 1, _totalExp: 0, _version: "" }
 *     → deserialize: isCommonType strips _. jewPosition set by client from jewel.json.
 *
 *   SignInfoModel (from setSign + L56694-56699):
 *     { _signId: String, _displayId: Number, _heroId: "",
 *       _level: 1, _star: 0,
 *       _mainAttr: { _items: [{ _id: 0, _num: 0 }] },
 *       _starAttr: { _items: [{ _id: 0, _num: 0 }] },
 *       _viceAttr: {}, _addAttr: {},
 *       _totalCost: { _items: [] }, _tmpViceAttr: {} }
 *     → setSignInfoModel: custom deserialize, uses _signId as unique key.
 *       Client reads s.id, s.displayId, s.star, s.part, s.level after deserialize.
 *       part comes from sign.json config, NOT from server data.
 *
 *   GenkiItem (L83904-83914):
 *     { _id: String, _displayId: Number, _heroId: "", _heroPos: 0,
 *       _mainAttr: { _items: [{ _id: <attrId>, _num: <val> }] },
 *       _viceAttr: { _items: [{ _id: <attrId>, _num: <val> }] } }
 *     → deserialize: special _mainAttr/_viceAttr + isCommonType for others.
 *
 * ============================================================
 * STORAGE PATHS (from client enterGame loading)
 * ============================================================
 *   Weapon:    savedData.weapon._items    → OBJECT keyed by _weaponId
 *   Gemstone:  savedData.gemstone._items  → OBJECT keyed by _id
 *   Sign:      savedData.imprint._items   → ARRAY (push)
 *   Genki:     savedData.genki._items     → OBJECT keyed by _id
 *
 * ============================================================
 * RANDOM BOX GROUP SYSTEM (CRITICAL — verified from randomBox.json)
 * ============================================================
 *   randomBox.json entries have a "group" field.
 *   Each group is an INDEPENDENT weighted random roll.
 *   Miss entries (no goodsID) mean "nothing from this group".
 *
 *   Example box 171 (hero fragment box):
 *     Group 1: 2841x10(1000), MISS(0)     → 100% guaranteed 2841x10
 *     Group 2: 2851x5(4000), MISS(6000)   → 40% chance 2851x5
 *     Group 3: 2851x10(500), MISS(9500)  → 5% chance 2851x10
 *
 *   Player ALWAYS gets group 1 reward, plus maybe group 2, plus maybe group 3.
 *   If we treated it as flat pool: 73.8% miss rate → completely wrong!
 *
 *   Example box 611 (team dungeon box): 4 identical groups
 *     Each group rolls independently → 4 separate reward chances.
 *
 *   Example box 164 (single OBJECT, not array):
 *     { goodsID: 4499, num: 1, group: 1, random: 10000 } → 100% guaranteed
 *
 * ============================================================
 * BOX CONSUMPTION
 * ============================================================
 *   Setelah reward di-resolve, box DEDUCT dari inventory:
 *     1. Baca CURRENT balance box
 *     2. Kurangi dengan num
 *     3. Update savedData via setBal()
 *     4. Include di _changeInfo._items agar client update UI
 *     5. db._set() simpan ke DB
 *
 * ============================================================
 * CLIENT CALL SITES (main.min(unminfy).js)
 * ============================================================
 * L130077-130135 — OpenBox.openBoxBtnTap()
 *   Varian A (RandomBox/CombinationBox):
 *     { type:"backpack", action:"openBox", userId, itemId, num, version:"1.0" }
 *   Varian B (ChooseBox):
 *     { type:"backpack", action:"openBox", userId, itemId, num, chooseIndex, version:"1.0" }
 *   Branching (L130135):
 *     thingsType == ChooseBox → Varian B
 *     else → Varian A
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 * {
 *   _addHeroes:  [{ _heroId, _heroDisplayId, ... }],
 *   _addWeapons: [{ _weaponId, _displayId, _heroId, _star, _level, _attrs, ... }],
 *   _addStones:  [{ _id, _displayId, _heroId, _level, _totalExp, _version }],
 *   _addSigns:   [{ _signId, _displayId, _heroId, _level, _star, _mainAttr, ... }],
 *   _addGenkis:  [{ _id, _displayId, _heroId, _heroPos, _mainAttr, _viceAttr }],
 *   _changeInfo: {
 *     _items: {
 *       "rewardItemId": { _id, _num: ABSOLUTE_BALANCE },
 *       "boxItemId":     { _id, _num: ABSOLUTE_BALANCE_AFTER_DEDUCT }
 *     }
 *   }
 * }
 *
 * CRITICAL: _changeInfo._items = OBJECT keyed by STRING itemId
 *   _num = ABSOLUTE balance (bukan delta!)
 *   Box item WAJIB ada di _changeInfo._items (balance setelah deduct)
 *   Instance-type rewards (hero/weapon/jewel/sign/genki) KE dedicated array,
 *   TIDAK di _changeInfo._items
 *
 * ============================================================
 * CONFIG FILES
 * ============================================================
 *   randomBox.json          — weighted random pools (per-group independent rolls)
 *   chooseBox.json          — choose options per box
 *   combinationBox.json     — bundle: equip sets, dragon balls, etc.
 *   signCombinationBox.json — bundle: sign/insignia sets
 *   thingsID.json           — item type lookup (thingsType + combinationBoxTo)
 *   weaponStrengthen.json   — weapon base attack at level 1
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJsonSync(name) {
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
            log.error('BPACK_OPENBOX', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('BPACK_OPENBOX', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPERS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    function getBal(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    function setBal(savedData, itemId, val) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                items[i]._num = val;
                return val;
            }
        }
        items.push({ _id: itemId, _num: val });
        return val;
    }

    // ═══════════════════════════════════════════════════════════
    //  UUID / ID GENERATORS
    // ═══════════════════════════════════════════════════════════

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    var _weaponIdCounter = 0;
    function generateWeaponInstanceId(userId) {
        _weaponIdCounter++;
        return 'weapon_' + userId + '_' + Date.now() + '_' + _weaponIdCounter;
    }

    var _stoneIdCounter = 0;
    function generateStoneId() {
        _stoneIdCounter++;
        return 'stone_' + Date.now() + '_' + _stoneIdCounter;
    }

    var _signIdCounter = 0;
    function generateSignId() {
        _signIdCounter++;
        return 'sign_' + Date.now() + '_' + _signIdCounter;
    }

    var _genkiIdCounter = 0;
    function generateGenkiId() {
        _genkiIdCounter++;
        return 'genki_' + Date.now() + '_' + _genkiIdCounter;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM TYPE DETECTION
    // ═══════════════════════════════════════════════════════════

    function getThingsType(itemId) {
        var thingsID = loadJsonSync('thingsID');
        var cfg = thingsID && thingsID[String(itemId)];
        return cfg ? (cfg.thingsType || '') : '';
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO HELPERS
    // ═══════════════════════════════════════════════════════════

    function buildHeroData(heroDisplayId) {
        return {
            _heroId: generateUUID(),
            _heroDisplayId: Number(heroDisplayId),
            _heroBaseAttr: {
                _level: 1,
                _evolveLevel: 0
            },
            _heroStar: 0,
            _superSkillLevel: 0,
            _potentialLevel: {},
            _superSkillResetCount: 0,
            _potentialResetCount: 0,
            _qigong: { _items: {} },
            _qigongTmp: { _items: {} },
            _qigongTmpPower: 0,
            _qigongStage: 1,
            _breakInfo: {
                _breakLevel: 1,
                _level: 0,
                _attr: { _items: {} },
                _version: ""
            },
            _totalCost: {
                _wakeUp: { _items: {} },
                _earring: { _items: {} },
                _levelUp: { _items: {} },
                _evolve: { _items: {} },
                _skill: { _items: {} },
                _qigong: { _items: {} },
                _heroBreak: { _items: {} }
            },
            _expeditionMaxLevel: 0,
            _gemstoneSuitId: 0,
            _linkTo: [],
            _linkFrom: "",
            _resonanceType: 0,
            _version: "202010131125"
        };
    }

    function addHeroToCollection(savedData, heroData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        var heros = savedData.heros._heros;
        var maxKey = -1;
        for (var k in heros) {
            if (heros.hasOwnProperty(k)) { var nk = Number(k); if (nk > maxKey) maxKey = nk; }
        }
        var heroKey = String(maxKey + 1);
        savedData.heros._heros[heroKey] = heroData;
        return heroKey;
    }

    // ═══════════════════════════════════════════════════════════
    //  WEAPON HELPERS
    // ═══════════════════════════════════════════════════════════
    //
    //  Storage: savedData.weapon._items[weaponId] — OBJECT keyed by _weaponId
    //  Response: _addWeapons — ARRAY of WeaponDataModel
    //  Client (L56701-56707): new WeaponDataModel; deserialize(); EquipInfoManager.addToWeap()
    //
    //  Reference: weapon/merge.js L197-232

    var ATTR_ATTACK = 1;

    function getWeaponAttack(weaponDisplayId) {
        var ws = loadJsonSync('weaponStrengthen');
        if (!ws) return 0;
        for (var k in ws) {
            if (!ws.hasOwnProperty(k)) continue;
            var entry = ws[k];
            if (Number(entry.weapon) === Number(weaponDisplayId) && Number(entry.level) === 1) {
                return Number(entry.attack) || 0;
            }
        }
        return 0;
    }

    function buildWeaponDataModel(weaponDisplayId, userId) {
        var attack = getWeaponAttack(weaponDisplayId);
        var instanceId = generateWeaponInstanceId(userId);
        return {
            _weaponId: String(instanceId),
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

    function addWeaponToStorage(savedData, weaponModel) {
        if (!savedData.weapon) savedData.weapon = { _items: {} };
        if (!savedData.weapon._items) savedData.weapon._items = {};
        var weaponId = weaponModel._weaponId;
        savedData.weapon._items[String(weaponId)] = weaponModel;
    }

    // ═══════════════════════════════════════════════════════════
    //  GEMSTONE / JEWEL HELPERS
    // ═══════════════════════════════════════════════════════════
    //
    //  Storage: savedData.gemstone._items[id] — OBJECT keyed by _id
    //  Response: _addStones — ARRAY of gemstone data
    //  Client (L56715-56721): new GemstoneItem; deserialize(); addGemStoneToList()
    //
    //  Client GemstoneItem (L83940-83952):
    //    Constructor: id="", displayId=0, heroId="", level=1, totalExp=0, version=""
    //    deserialize: isCommonType strips _. jewPosition from jewel[displayId].jewPosition
    //    → Server sends: _id, _displayId, _heroId, _level, _totalExp, _version

    function buildGemstoneModel(displayId) {
        var stoneId = generateStoneId();
        return {
            _id: String(stoneId),
            _displayId: Number(displayId),
            _heroId: "",
            _level: 1,
            _totalExp: 0,
            _version: ""
        };
    }

    function addGemstoneToStorage(savedData, stoneModel) {
        if (!savedData.gemstone) savedData.gemstone = { _items: {} };
        if (!savedData.gemstone._items) savedData.gemstone._items = {};
        var stoneId = stoneModel._id;
        savedData.gemstone._items[String(stoneId)] = stoneModel;
    }

    // ═══════════════════════════════════════════════════════════
    //  SIGN / IMPRINT HELPERS
    // ═══════════════════════════════════════════════════════════
    //
    //  Storage: savedData.imprint._items — ARRAY (push)
    //  Response: _addSigns — ARRAY of sign data
    //  Client (L56694-56700): setSignInfoModel(); addSigns(s.id, s)
    //
    //  Client reads: s.id, s.displayId, s.star, s.part, s.level
    //    → id comes from _signId (stripped _)
    //    → displayId comes from _displayId (stripped _)
    //    → part comes from sign.json config lookup, NOT server data
    //    → star, level come from _star, _level (stripped _)

    function buildSignModel(signDisplayId) {
        // ── VALIDASI: pastikan signDisplayId ada di signEx.json ──
        // Client ImprintItem.deserialize akan crash jika signEx[displayId] undefined.
        // Ini terjadi jika box config salah, atau ID yang masuk adalah signPiece (bukan sign).
        var signEx = loadJsonSync('signEx');
        var numDisplayId = Number(signDisplayId);
        if (!signEx || !signEx[String(numDisplayId)]) {
            log.error('OPENBOX', 'buildSignModel REJECTED — displayId=' + signDisplayId
                + ' (type=' + getThingsType(signDisplayId) + ')'
                + ' NOT found in signEx.json. Silakan cek box config.');
            return null; // ← caller wajib cek null
        }

        var signId = generateSignId();
        return {
            _signId: String(signId),
            _displayId: numDisplayId,
            _heroId: "",
            _level: 1,
            _star: 0,
            _mainAttr: { _items: [{ _id: 0, _num: 0 }] },
            _starAttr: { _items: [{ _id: 0, _num: 0 }] },
            _viceAttr: {},
            _addAttr: {},
            _totalCost: { _items: [] },
            _tmpViceAttr: {}
        };
    }

    function addSignToStorage(savedData, signModel) {
        if (!savedData.imprint) savedData.imprint = { _items: [] };
        if (!savedData.imprint._items) savedData.imprint._items = [];
        savedData.imprint._items.push(signModel);
    }

    // ═══════════════════════════════════════════════════════════
    //  GENKI HELPERS
    // ═══════════════════════════════════════════════════════════
    //
    //  Storage: savedData.genki._items[id] — OBJECT keyed by _id
    //  Response: _addGenkis — ARRAY of genki data
    //  Client (L56708-56714): new GenkiItem; deserialize(); addGenKiToList()
    //
    //  Client GenkiItem (L83904-83914):
    //    Constructor: id="", displayId=0, heroId="", heroPos=0,
    //                 mainAttr=BasicItem, viceAttr=BasicItem
    //    deserialize: _mainAttr → mainAttr.id/num from _items[0],
    //                 _viceAttr → viceAttr.id/num from _items[0],
    //                 others via isCommonType (strip _)

    function buildGenkiModel(genkiDisplayId) {
        var genkiId = generateGenkiId();
        return {
            _id: String(genkiId),
            _displayId: Number(genkiDisplayId),
            _heroId: "",
            _heroPos: 0,
            _mainAttr: { _items: [{ _id: 0, _num: 0 }] },
            _viceAttr: { _items: [{ _id: 0, _num: 0 }] }
        };
    }

    function addGenkiToStorage(savedData, genkiModel) {
        if (!savedData.genki) savedData.genki = { _items: {} };
        if (!savedData.genki._items) savedData.genki._items = {};
        var genkiId = genkiModel._id;
        savedData.genki._items[String(genkiId)] = genkiModel;
    }

    // ═══════════════════════════════════════════════════════════
    //  RANDOM ROLL — PER-GROUP INDEPENDENT ROLLS
    // ═══════════════════════════════════════════════════════════
    //
    //  CRITICAL: randomBox.json uses "group" field for independent rolls.
    //  Each group is rolled separately. Miss = no reward from that group.
    //
    //  Example box 171:
    //    Group 1: 2841x10(1000), MISS(0)   → always get 2841x10
    //    Group 2: 2851x5(4000), MISS(6000)  → 40% chance 2851x5
    //    Group 3: 2851x10(500), MISS(9500) → 5% chance 2851x10
    //
    //  Returns: ARRAY of { goodsID, num } — one per group that hit

    function rollSingleGroup(groupEntries) {
        // Weighted random within one group
        var totalWeight = 0;
        for (var i = 0; i < groupEntries.length; i++) {
            totalWeight += Number(groupEntries[i].random) || 0;
        }
        if (totalWeight <= 0) return null;

        var roll = Math.random() * totalWeight;
        var acc = 0;
        for (var j = 0; j < groupEntries.length; j++) {
            acc += Number(groupEntries[j].random) || 0;
            if (roll < acc) {
                // Check if this entry is a miss (no goodsID)
                if (groupEntries[j].goodsID == null) return null;
                return {
                    goodsID: Number(groupEntries[j].goodsID),
                    num: Number(groupEntries[j].num) || 1
                };
            }
        }

        // Fallback to last entry
        var last = groupEntries[groupEntries.length - 1];
        if (last.goodsID == null) return null;
        return { goodsID: Number(last.goodsID), num: Number(last.num) || 1 };
    }

    /**
     * Roll all groups in a randomBox pool independently.
     * @param {Array|Object} poolRaw - entries from randomBox.json
     * @returns {Array} array of { goodsID, num } hits
     */
    function rollRandomBox(poolRaw) {
        var pool = Array.isArray(poolRaw) ? poolRaw : [poolRaw];
        if (pool.length === 0) return [];

        // Group entries by "group" field
        var groups = {};
        for (var i = 0; i < pool.length; i++) {
            var gKey = String(pool[i].group != null ? pool[i].group : 1);
            if (!groups[gKey]) groups[gKey] = [];
            groups[gKey].push(pool[i]);
        }

        // Roll each group independently
        var hits = [];
        var groupKeys = Object.keys(groups);
        // Sort groups by key for deterministic order
        groupKeys.sort(function (a, b) { return Number(a) - Number(b); });

        for (var g = 0; g < groupKeys.length; g++) {
            var result = rollSingleGroup(groups[groupKeys[g]]);
            if (result) {
                hits.push(result);
            }
        }

        return hits;
    }

    // ═══════════════════════════════════════════════════════════
    //  GRANT REGULAR ITEM REWARD (counter-based items only)
    // ═══════════════════════════════════════════════════════════

    function grantItemReward(savedData, rewardItems, itemId, amount) {
        if (!itemId || amount <= 0) return;
        var oldBal = getBal(savedData, itemId);
        var newBal = oldBal + amount;
        setBal(savedData, itemId, newBal);
        rewardItems[String(itemId)] = { _id: itemId, _num: newBal };
    }

    // ═══════════════════════════════════════════════════════════
    //  GRANT REWARD — TYPE DISPATCHER (the core fix)
    // ═══════════════════════════════════════════════════════════
    //
    //  Dispatches reward to the correct path based on thingsType:
    //    hero         → addHeroes array + savedData.heros._heros
    //    weapon       → addWeapons array + savedData.weapon._items
    //    jewel/special→ addStones array + savedData.gemstone._items
    //    sign         → addSigns array  + savedData.imprint._items
    //    genki        → addGenkis array + savedData.genki._items
    //    all others   → rewardItems (_changeInfo._items) + savedData.totalProps._items
    //
    //  Parameters:
    //    savedData    — user data
    //    rewardItems  — _changeInfo._items accumulator (OBJECT keyed by STRING itemId)
    //    addHeroes    — _addHeroes accumulator (ARRAY)
    //    addWeapons   — _addWeapons accumulator (ARRAY)
    //    addStones    — _addStones accumulator (ARRAY)
    //    addSigns     — _addSigns accumulator (ARRAY)
    //    addGenkis    — _addGenkis accumulator (ARRAY)
    //    userId       — for weapon instance ID generation
    //    goodsID      — the item being granted
    //    amount       — quantity (for instance types, creates 'amount' instances)
    //    isAccumulate — true = RandomBox multi-roll mode (delta accumulation for regular items)

    function grantReward(savedData, rewardItems, addHeroes, addWeapons, addStones, addSigns, addGenkis, userId, goodsID, amount, isAccumulate) {
        if (!goodsID || amount <= 0) return;

        var type = getThingsType(goodsID);

        // ── HERO PATH ──
        if (type === 'hero') {
            for (var h = 0; h < amount; h++) {
                var heroData = buildHeroData(goodsID);
                addHeroToCollection(savedData, heroData);
                addHeroes.push(heroData);
            }
            return;
        }

        // ── WEAPON PATH ──
        if (type === 'weapon') {
            for (var w = 0; w < amount; w++) {
                var weapon = buildWeaponDataModel(goodsID, userId);
                addWeaponToStorage(savedData, weapon);
                addWeapons.push(weapon);
            }
            return;
        }

        // ── JEWEL / JEWEL SPECIAL PATH ──
        if (type === 'jewel' || type === 'jewelSpecial') {
            for (var j = 0; j < amount; j++) {
                var stone = buildGemstoneModel(goodsID);
                addGemstoneToStorage(savedData, stone);
                addStones.push(stone);
            }
            return;
        }

        // ── SIGN PATH ──
        if (type === 'sign') {
            for (var s = 0; s < amount; s++) {
                var sign = buildSignModel(goodsID);
                if (!sign) {
                    // buildSignModel menolak displayId yang tidak ada di signEx.json
                    log.error('OPENBOX', 'grantReward: skip invalid sign goodsID=' + goodsID + ' (signEx lookup failed)');
                    continue;
                }
                addSignToStorage(savedData, sign);
                addSigns.push(sign);
            }
            return;
        }

        // ── GENKI PATH ──
        if (type === 'genki') {
            for (var g = 0; g < amount; g++) {
                var genki = buildGenkiModel(goodsID);
                addGenkiToStorage(savedData, genki);
                addGenkis.push(genki);
            }
            return;
        }

        // ── REGULAR ITEM PATH (counter-based) ──
        if (isAccumulate) {
            // RandomBox multi-roll: accumulate delta, resolve later
            var key = String(goodsID);
            var existing = rewardItems[key];
            if (existing && existing._accDelta != null) {
                existing._accDelta += amount;
            } else {
                rewardItems[key] = { _id: goodsID, _num: 0, _accDelta: amount };
            }
        } else {
            // ChooseBox / CombinationBox: set absolute balance immediately
            grantItemReward(savedData, rewardItems, goodsID, amount);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(data, callback) {
        try {
            _handleImpl(data, callback);
        } catch (err) {
            log.error('BPACK_OPENBOX', 'UNCAUGHT: ' + (err && err.message) + (err && err.stack ? '\n' + err.stack : ''));
            callback({ _changeInfo: { _items: {} } }, 0);
        }
    }

    function _handleImpl(data, callback) {
        var userId = data.userId;
        var itemId = Number(data.itemId) || 0;
        var num = Number(data.num) || 0;
        var chooseIndex = data.chooseIndex;

        log.info('BPACK_OPENBOX', 'START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['itemId', String(itemId)],
            ['num', String(num)],
            ['chooseIndex', chooseIndex != null ? String(chooseIndex) : '(none)']
        ]);

        // ── 1) VALIDATE ──────────────────────────────────────
        if (!userId) {
            log.error('BPACK_OPENBOX', 'missing userId');
            callback({ _changeInfo: { _items: {} } }, 0);
            return;
        }
        if (!itemId) {
            log.error('BPACK_OPENBOX', 'missing itemId');
            callback({ _changeInfo: { _items: {} } }, 0);
            return;
        }
        if (num <= 0) {
            log.error('BPACK_OPENBOX', 'invalid num: ' + num);
            callback({ _changeInfo: { _items: {} } }, 0);
            return;
        }

        // ── 2) LOAD USER DATA ───────────────────────────────
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('BPACK_OPENBOX', 'user data not found: ' + storageKey);
            callback({ _changeInfo: { _items: {} } }, 0);
            return;
        }

        // ── 3) CHECK BOX BALANCE ────────────────────────────
        var boxBalance = getBal(savedData, itemId);
        if (boxBalance < num) {
            log.warn('BPACK_OPENBOX', 'not enough boxes: need ' + num + ' of ' + itemId + ', have ' + boxBalance);
            callback({ _changeInfo: { _items: {} } }, 0);
            return;
        }

        // ── 4) DETERMINE BOX TYPE ───────────────────────────
        var thingsID = loadJsonSync('thingsID');
        var itemCfg = thingsID && thingsID[String(itemId)];
        var thingsType = itemCfg ? itemCfg.thingsType : '';

        // thingsType is STRING from thingsID.json: "randomBox", "combinationBox", "chooseBox"
        var isChooseBox = (thingsType === 'chooseBox' || chooseIndex != null);
        var isCombinationBox = (thingsType === 'combinationBox');

        // ── 5) RESOLVE REWARDS ──────────────────────────────
        var rewardItems = {};   // _changeInfo._items — keyed by STRING itemId (regular items only)
        var addHeroes = [];     // _addHeroes — hero instances
        var addWeapons = [];    // _addWeapons — weapon instances
        var addStones = [];     // _addStones — gemstone instances
        var addSigns = [];      // _addSigns — sign instances
        var addGenkis = [];     // _addGenkis — genki instances

        if (isChooseBox) {
            // ══════════════════════════════════════════════════
            //  CHOOSE BOX — player sudah pilih di UI
            // ══════════════════════════════════════════════════
            var chooseBox = loadJsonSync('chooseBox');
            var options = chooseBox && chooseBox[String(itemId)];

            if (!options || !Array.isArray(options)) {
                log.error('BPACK_OPENBOX', 'itemId ' + itemId + ' not found in chooseBox.json');
                callback({ _changeInfo: { _items: {} } }, 0);
                return;
            }

            if (chooseIndex == null || chooseIndex < 0 || chooseIndex >= options.length) {
                log.error('BPACK_OPENBOX', 'invalid chooseIndex=' + chooseIndex + ' for itemId=' + itemId + ' (count=' + options.length + ')');
                callback({ _changeInfo: { _items: {} } }, 0);
                return;
            }

            var chosen = options[chooseIndex];
            var rewardId = Number(chosen.goodsID);
            var rewardNum = Number(chosen.num) || 1;

            // Grant reward — type dispatcher handles hero/weapon/jewel/sign/genki/item
            grantReward(savedData, rewardItems, addHeroes, addWeapons, addStones, addSigns, addGenkis, userId, rewardId, rewardNum * num, false);

            log.details('chooseBox', [
                ['itemId', String(itemId)],
                ['chooseIndex', String(chooseIndex)],
                ['rewardId', String(rewardId)],
                ['rewardType', getThingsType(rewardId) || '?'],
                ['rewardNum', String(rewardNum)],
                ['openCount', String(num)],
                ['totalReward', String(rewardNum * num)]
            ]);

        } else if (isCombinationBox) {
            // ══════════════════════════════════════════════════
            //  COMBINATION BOX — bundle, beri SEMUA item sekaligus
            // ══════════════════════════════════════════════════
            //
            // 2 sub-tipe via thingsID[].combinationBoxTo:
            //   "combinationBox"       → combinationBox.json    (equip sets, dragon balls)
            //   "signCombinationBox"   → signCombinationBox.json (sign/insignia sets)
            //
            var comboBoxTo = itemCfg.combinationBoxTo || '';
            var configFileName;

            if (comboBoxTo === 'signCombinationBox') {
                configFileName = 'signCombinationBox';
            } else {
                configFileName = 'combinationBox';
            }

            var comboConfig = loadJsonSync(configFileName);
            var bundleItems = comboConfig && comboConfig[String(itemId)];

            if (!bundleItems || !Array.isArray(bundleItems)) {
                log.error('BPACK_OPENBOX', 'itemId ' + itemId + ' not found in ' + configFileName + '.json');
                callback({ _changeInfo: { _items: {} } }, 0);
                return;
            }

            // Beri SEMUA item di bundle (per box opened)
            for (var bi = 0; bi < num; bi++) {
                for (var si = 0; si < bundleItems.length; si++) {
                    var bGoodsID = Number(bundleItems[si].goodsID);
                    var bNum = Number(bundleItems[si].num) || 1;

                    // Grant — type dispatcher handles ALL types
                    grantReward(savedData, rewardItems, addHeroes, addWeapons, addStones, addSigns, addGenkis, userId, bGoodsID, bNum, false);
                }
            }

            log.details('combinationBox', [
                ['itemId', String(itemId)],
                ['comboType', comboBoxTo || 'combinationBox'],
                ['configFile', configFileName + '.json'],
                ['bundleSize', String(bundleItems.length)],
                ['openCount', String(num)]
            ]);

        } else {
            // ══════════════════════════════════════════════════
            //  RANDOM BOX — weighted random per-group rolls
            // ══════════════════════════════════════════════════
            var randomBox = loadJsonSync('randomBox');
            var poolRaw = randomBox && randomBox[String(itemId)];

            if (!poolRaw) {
                log.error('BPACK_OPENBOX', 'itemId ' + itemId + ' not found in randomBox.json');
                callback({ _changeInfo: { _items: {} } }, 0);
                return;
            }

            // Roll for EACH box opened (each opening independent)
            for (var ri = 0; ri < num; ri++) {
                var hits = rollRandomBox(poolRaw);

                for (var hi = 0; hi < hits.length; hi++) {
                    var hit = hits[hi];

                    // Grant — type dispatcher handles ALL types
                    // isAccumulate=true for regular items (delta mode)
                    grantReward(savedData, rewardItems, addHeroes, addWeapons, addStones, addSigns, addGenkis, userId, hit.goodsID, hit.num, true);

                    log.details('rollHit', [
                        ['box', String(ri + 1) + '/' + String(num)],
                        ['rewardId', String(hit.goodsID)],
                        ['rewardNum', String(hit.num)],
                        ['rewardType', getThingsType(hit.goodsID) || '?']
                    ]);
                }
            }

            // Resolve accumulated deltas → absolute balances (regular items only)
            for (var rk in rewardItems) {
                if (rewardItems.hasOwnProperty(rk)) {
                    var entry = rewardItems[rk];
                    if (entry._accDelta != null) {
                        var oldBal = getBal(savedData, entry._id);
                        var newBal = oldBal + entry._accDelta;
                        setBal(savedData, entry._id, newBal);
                        entry._num = newBal;
                        delete entry._accDelta;
                    }
                }
            }
        }

        // ── 6) CONSUME BOX — HAPUS dari inventory ───────────
        var currentBoxBal = getBal(savedData, itemId);
        var newBoxBalance = Math.max(0, currentBoxBal - num);
        setBal(savedData, itemId, newBoxBalance);

        // Include box deduction di response agar client update UI
        rewardItems[String(itemId)] = { _id: itemId, _num: newBoxBalance };

        // ── 7) PERSIST TO DATABASE ──────────────────────────
        db._set(storageKey, savedData);

        // ── 8) BUILD RESPONSE ───────────────────────────────
        var response = {};

        // Instance-type rewards (only include if non-empty)
        if (addHeroes.length > 0) response._addHeroes = addHeroes;
        if (addWeapons.length > 0) response._addWeapons = addWeapons;
        if (addStones.length > 0) response._addStones = addStones;
        if (addSigns.length > 0) response._addSigns = addSigns;
        if (addGenkis.length > 0) response._addGenkis = addGenkis;

        // Regular items + box deduction (always present for UI update)
        response._changeInfo = {
            _items: rewardItems
        };

        log.info('BPACK_OPENBOX', 'SUCCESS');
        log.details('result', [
            ['userId', userId],
            ['boxItemId', String(itemId)],
            ['boxType', String(thingsType || '(unknown)')],
            ['opened', String(num)],
            ['boxBefore', String(currentBoxBal)],
            ['boxAfter', String(newBoxBalance)],
            ['heroesGained', String(addHeroes.length)],
            ['weaponsGained', String(addWeapons.length)],
            ['stonesGained', String(addStones.length)],
            ['signsGained', String(addSigns.length)],
            ['genkisGained', String(addGenkis.length)],
            ['itemRewards', String(Object.keys(rewardItems).length - 1)]
        ]);

        callback(response, 0);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('backpack', 'openBox', handle);

})();