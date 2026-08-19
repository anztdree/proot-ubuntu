/**
 * entrust/getInfo.js — Entrust GetInfo Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS (1 file, 1 action):
 *   Request:  { type:"entrust", action:"getInfo", userId }
 *   Response: { _model: { _entrusts: { _entrusts: [...] },
 *                         _helpedFrieds: [],
 *                         _refreshCount: N,
 *                         _helpFriendHero: "" } }
 *
 *   1. Load user data dari user:{userId}
 *   2. Jika _entrustModel sudah ada → return itu
 *   3. Jika belum ada → generate daftar entrust baru, simpan, return
 *
 *   Generation logic:
 *     - Baca VIP level dari totalProps._items (item 106)
 *     - Lookup rewardNum.json by VIP → normalRewardNum
 *     - Random select normalRewardNum cfgId dari rewardList.json
 *       (weighted by `random` field, higher = lebih sering)
 *     - Setiap entrust: state=NEW(0), type=DEFAULT(0),
 *       finishDate=0, heroes=[], heroesInfo={}
 * ============================================================
 *
 * EVIDENCE DARI main.min(unminfy).js:
 *
 *   [PEMANGGILAN] L56315-56336 runSceneEntrust():
 *     if (entrustResetTimes > 0) {
 *       ts.processHandler({ type:"entrust", action:"reset", userId },
 *         function(e) { entrustResetTimes=0; t() })
 *     } else { t() }
 *     function t() {
 *       ts.processHandler({ type:"entrust", action:"getInfo", userId },
 *         function(t) {
 *           EntrustSingleton.getInstance().initData(t._model)
 *           // then open EntrustMain scene
 *         })
 *     }
 *
 *   [RESPONSE CONSUMER] L59093-59095 initData(e):
 *     t.setentrusts(e._entrusts._entrusts)
 *     t.helpedFriends = e._helpedFrieds      // ⚠️ TYPO — client spells it _helpedFrieds
 *     t.refreshCount = e._refreshCount
 *     t.helpFriendHero = e._helpFriendHero
 *
 *   [ENTRUST DATA STRUCTURE] L59105-59111 setentrusts(e):
 *     for (var n in e) {
 *       o._id = e[n]._id
 *       o._cfgId = e[n]._cfgId        → rewardList.json ID (15101, 15201, etc.)
 *       o._state = e[n]._state        → ENTRUST_STATE enum
 *       o._type = e[n]._type          → ENTRUST_TYPE enum
 *       o._finishDate = e[n]._finishDate
 *       o._heroes = e[n]._heroes      → array of hero IDs used in battle
 *       o._heroesInfo = e[n]._heroesInfo  → object with hero detail per slot
 *     }
 *
 *   [ENTRUST_STATE] L59189-59192:
 *     NEW=0, DOING=1, COMPLETE=2
 *
 *   [ENTRUST_TYPE] L59193-59196:
 *     DEFAULT=0, BOOK=1
 *
 *   [EntrustData constructor] L59182-59185:
 *     _id:"", _cfgId:0, _state:ENTRUST_STATE.NEW,
 *     _type:ENTRUST_TYPE.DEFAULT, _finishDate:0,
 *     _heroes:[], _heroesInfo:{}
 *
 *   [UI RENDER — EntrustListItem L164208-164216]:
 *     var n = ReadJsonSingleton.getInstance().rewardList[e.data.cfgId]
 *     e.entrustName.text = n.name        → name from rewardList
 *     e.entrustValue.text = n.description → description from rewardList
 *     e.entrustTime.text = n.time/3600   → hours display
 *     e.setStar(n.star)                  → star count
 *     e.setReward()                      → reads reward1/num1, reward2/num2...
 *
 *   [VIP → entrust count] rewardNum.json:
 *     { vip:0, normalRewardNum:5 } → { vip:18, normalRewardNum:10 }
 *     VIP level stored in totalProps._items as item 106 (PLAYERVIPLEVELID)
 *
 *   [CONSTANTS — constant.json[1]]:
 *     rewardMax: 20          → max total entrusts allowed
 *     rewardListRefresh: 10  → diamond cost per refresh per entrust
 *     rewardSpeedUpMin: 3600 → min seconds before speed-up allowed
 *     rewardSpeedUpPrice: 0.02 → diamond cost multiplier for speed-up
 *
 *   [ENTRUST BOOK — rewardBook.json]:
 *     143: 3-star book, 144: 4-star book, 145: 5-star book
 *     Added via userEntrustBook action → type=BOOK(1)
 *
 *   [REFRESH — refreshCurrent L16370-16378]:
 *     Response: { _entrusts: { _entrusts: [...] }, _refreshCount, _changeInfo }
 *     Deducts diamonds, re-randomizes non-DOING entrusts
 *     Client: ItemsCommonSingleton.resetTtemsCallBack(t) → _changeInfo._items
 *
 *   [REWARD LIST — rewardList.json]:
 *     24 entries, star 1-6, weighted by `random` field
 *     15101-15104: star 1 (7200s, 1 hero, blue, random=7500)
 *     15201-15203: star 2 (10800s, 1 hero, blue, random=8000-12000)
 *     15301-15304: star 3 (14400s, 2-3 heroes, blue, random=0-10000)
 *     15401-15405: star 4 (21600s, 2-3 heroes, purple, random=0-4000)
 *     15501-15505: star 5 (28800s, 2-3 heroes, orange/purple, random=0-2000)
 *     15601-15603: star 6 (43200s, 3 heroes, orange, random=0-2000)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var PLAYERVIPLEVELID = 106;  // L116237 — VIP level in totalProps._items

    var ENTRUST_STATE = { NEW: 0, DOING: 1, COMPLETE: 2 };
    var ENTRUST_TYPE  = { DEFAULT: 0, BOOK: 1 };

    // Default entrust count if VIP lookup fails (VIP 0 = 5 tasks)
    var DEFAULT_ENTRUST_COUNT = 5;

    // ═══════════════════════════════════════════════════════════
    //  JSON LOADING (sync XHR — self-contained pattern)
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
            log.error('ENTRUST', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('ENTRUST', 'loadJson ' + name + ': ' + e.message);
        }
        return null;
    }

    var rewardListJson = loadJson('rewardList');
    var rewardNumJson  = loadJson('rewardNum');
    var constantJson   = loadJson('constant');

    // ═══════════════════════════════════════════════════════════
    //  ITEM HELPERS (totalProps._items ARRAY pattern)
    // ═══════════════════════════════════════════════════════════
    //
    // BUKTI: L77685 main.min.js
    //   n = e.totalProps._items → t.setItem(a, r)
    // Storage: savedData.totalProps._items = [{_id, _num}, ...]

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

    // ═══════════════════════════════════════════════════════════
    //  ENTRUST GENERATION
    // ═══════════════════════════════════════════════════════════

    /**
     * Get the number of daily entrusts based on VIP level.
     * Uses rewardNum.json: { vip, normalRewardNum }
     * Falls back to DEFAULT_ENTRUST_COUNT (5) if not found.
     */
    function getEntrustCount(vipLevel) {
        if (!rewardNumJson) return DEFAULT_ENTRUST_COUNT;
        // Find the highest vip entry that is <= vipLevel
        var bestCount = DEFAULT_ENTRUST_COUNT;
        for (var key in rewardNumJson) {
            var entry = rewardNumJson[key];
            if (Number(entry.vip) <= vipLevel) {
                var num = Number(entry.normalRewardNum);
                if (num > bestCount) bestCount = num;
            }
        }
        return bestCount;
    }

    /**
     * Weighted random selection of cfgIds from rewardList.json.
     * The `random` field is a weight — higher value = more likely.
     * Entries with random=0 CAN still be selected (equal lowest weight).
     *
     * @param {number} count — how many entrusts to generate
     * @returns {Array} — array of cfgId strings
     */
    function generateEntrustCfgIds(count) {
        if (!rewardListJson) return [];

        // Build weighted pool
        var pool = [];  // [cfgId, cfgId, ...] — repeated by weight
        for (var key in rewardListJson) {
            var entry = rewardListJson[key];
            var weight = Number(entry.random) || 1;  // 0 → weight 1 (still possible)
            for (var w = 0; w < weight; w++) {
                pool.push(key);
            }
        }

        if (pool.length === 0) return [];

        // Fisher-Yates shuffle
        for (var i = pool.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        }

        // Pick `count` unique cfgIds
        var selected = [];
        var used = {};
        for (var k = 0; k < pool.length && selected.length < count; k++) {
            var cfgId = pool[k];
            if (!used[cfgId]) {
                used[cfgId] = true;
                selected.push(cfgId);
            }
        }

        return selected;
    }

    /**
     * Generate the full _entrustModel for a new user or daily reset.
     *
     * @param {number} vipLevel
     * @returns {Object} — _entrustModel
     */
    function generateEntrustModel(vipLevel) {
        var count = getEntrustCount(vipLevel);
        var cfgIds = generateEntrustCfgIds(count);
        var now = Date.now();

        var entrusts = [];
        for (var i = 0; i < cfgIds.length; i++) {
            entrusts.push({
                _id: String(now) + '_' + String(i),   // unique ID
                _cfgId: Number(cfgIds[i]),              // rewardList.json ID
                _state: ENTRUST_STATE.NEW,             // 0 = NEW
                _type: ENTRUST_TYPE.DEFAULT,           // 0 = DEFAULT (not from book)
                _finishDate: 0,                        // no timer yet
                _heroes: [],                           // no heroes assigned yet
                _heroesInfo: {}                        // no hero details yet
            });
        }

        // Default refresh count: from constant.json or 0
        var refreshCount = 0;

        return {
            _entrusts: entrusts,
            _helpedFrieds: [],        // ⚠️ TYPO preserved — client expects this spelling (L59095)
            _refreshCount: refreshCount,
            _helpFriendHero: ""       // no support hero set yet
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(data, callback) {
        var userId = data.userId;

        if (!userId) {
            log.error('ENTRUST', 'getInfo — missing userId');
            callback({}, 1);
            return;
        }

        // ── 1. LOAD USER DATA ──
        var savedData = db._get('user:' + userId);

        if (!savedData) {
            log.error('ENTRUST', 'getInfo — no user data for ' + userId);
            callback({}, 1);
            return;
        }

        // ── 2. GET VIP LEVEL ──
        // VIP level stored in totalProps._items as item 106 (PLAYERVIPLEVELID)
        var vipLevel = getItemNum(savedData, PLAYERVIPLEVELID);

        // ── 3. IF _entrustModel EXISTS → RETURN IT ──
        if (savedData._entrustModel) {
            log.details('ENTRUST', [
                ['action', 'getInfo'],
                ['userId', userId],
                ['source', 'existing model'],
                ['entrustCount', (savedData._entrustModel._entrusts || []).length],
                ['vip', vipLevel]
            ]);

            callback({ _model: savedData._entrustModel });
            return;
        }

        // ── 4. NO MODEL YET → GENERATE NEW ──
        var model = generateEntrustModel(vipLevel);

        // Save to user data
        savedData._entrustModel = model;
        db._set('user:' + userId, savedData);

        log.details('ENTRUST', [
            ['action', 'getInfo'],
            ['userId', userId],
            ['source', 'generated fresh'],
            ['entrustCount', (model._entrusts || []).length],
            ['vip', vipLevel]
        ]);

        callback({ _model: model });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('entrust', 'getInfo', handle);

})();