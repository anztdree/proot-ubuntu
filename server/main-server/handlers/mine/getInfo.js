/**
 * getInfo.js — Mine GetInfo Handler (DRAFT v3)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS (1 file, 1 action):
 *   Request:  { type:"mine", action:"getInfo", userId, version:"1.0" }
 *   Response: { _model: { _id, _map, _curX, _curY, _leftStep,
 *                         _stepRecoverTime, _curLevel } }
 *
 *   1. Load user data dari user:{userId}
 *   2. Jika _mineModel sudah ada → return itu
 *   3. Jika belum ada → generate floor 1 baru, simpan, return
 *   4. Sync timesInfo.mineSteps/mineStepsRecover dari _mineModel
 *
 *   _enemyCount dan _boxCount TIDAK dikirim.
 *     Client hitung ulang dari _map di setMineModelInfo() (L79583).
 * ============================================================
 *
 * EVIDENCE DARI main.min(unminfy).js:
 *
 *   [PEMANGGILAN] L56506-56521 openTheWildAdventure():
 *     ts.processHandler({ type:"mine", action:"getInfo", userId, version:"1.0" },
 *       function(e) {
 *         TheWildAdventureManager.getInstance().saveMineModel(e._model),
 *         ts.runScene("TheWildAdventure", { parent:"Adventure" })
 *       },
 *       function(e) { Logger.serverDebugLog("失败！！！"); }
 *     );
 *
 *   [RESPONSE CONSUMER] saveMineModel → setMineModelInfo (L79583):
 *     e.prototype.saveMineModel = function(e) {
 *         var t = this;
 *         t._MineModel = t.setMineModelInfo(e)
 *     }
 *
 *   setMineModelInfo membuat new MineModel, lalu copy field.
 *     for (var r in a) {          ← STRING keys (for-in)
 *       for (var i in a[r]) {
 *         for (var s in a[r][i])
 *           a[r][i][s]._type      ← AKSES ._type di SETIAP index
 *
 *   ⚠️ CRITICAL: setiap cell HARUS:
 *     - Punya item: [fog, { _type, _enemyId, _userId }]
 *     - Tanpa item: [fog]  — TANPA index 1 (bukan null, bukan undefined)
 *     Jika cell = [0, null] → for-in iterasi "1" → null._type → CRASH
 *     Jika cell = [0, item, null, null, ..., true] (sparse→JSON null)
 *       → for-in iterasi "2"→"9" → null._type → CRASH
 *
 *   [STEP RECOVERY — getMineCount() L79583]:
 *     Client menghitung recovery ON-THE-FLY dari _stepRecoverTime:
 *       now = ServerTime.getServerTime()
 *       elapsed = floor(max(now - _stepRecoverTime, 0) / (1000 * 1800))
 *       return _leftStep >= 50 ? _leftStep : min(_leftStep + elapsed, 50)
 *
 *     Jadi server TIDAK perlu compute recovery di getInfo.
 *     Cukup return _mineModel as-is, client yang hitung recovery.
 *
 *   [STEP RECOVERY — enterGame L62194]:
 *     setTheWildAdventureCount(e.mineSteps, e.mineStepsRecover)
 *       → _MineModel._leftStep = mineSteps (sudah di-recover oleh enterGame)
 *
 *     Lalu getInfo → saveMineModel → OVERWRITE _MineModel.
 *     Tapi client getMineCount() selalu hitung recovery dari _stepRecoverTime,
 *     jadi nilai _leftStep yang "stale" tetap menghasilkan AP yang benar di UI.
 *
 *   [STORAGE — BUKTI dari handler asli di git commit a9244b2]:
 *     _mineModel disimpan DI DALAM user data object:
 *       db._get('user:' + userId)  →  savedData._mineModel
 *     BUKAN di key terpisah seperti mine:{userId}.
 *
 *   [MAP STRUKTUR — L105190-105193 loadMapInfo]:
 *     n = t._map
 *     r = n.length          → jumlah kolom (X: 0..6, total 7)
 *     i = n[0].length        → jumlah baris (Y: 0..7, total 8)
 *     Loop: for l=0; r>l; l++  for u=0; i>u; u++
 *
 *   [ITEM TYPES — MINE_ITEM_TYPE enum]:
 *     UNKNOW=0, DOOR=1, ENEMY=2, SILVER_CHEST=3, GOLDEN_CHEST=4, BOSS=5
 *
 *   [_enemyId 0-3 mapping — L105589 requestBattle]:
 *     0 → enemyList1, 1 → enemyList2, 2 → enemyList3, 3 → enemyList4
 *     BOSS → selalu pakai enemyListBOSS (tidak peduli _enemyId)
 *
 *   [Portal — L105327]:
 *     6==n && 7==o → cek posisi (6,7) = START position = portal
 *
 *   [mine.json config — dipakai SAAT generate map, BUKAN saat getInfo return existing]:
 *     silverChestNum, goldenChestNum → jumlah chest per floor
 *     enemyList1-4, enemyListBOSS → dipakai client di requestBattle()
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  JSON LOADING
    // ═══════════════════════════════════════════════════════════

    var _jsonCache = {};

    function loadJson(name) {
        if (_jsonCache[name]) return _jsonCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _jsonCache[name] = data;
                return data;
            }
            log.error('MINE', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('MINE', 'loadJson ' + name + ': ' + e.message);
        }
        return null;
    }

    var mineJson = loadJson('mine');
    var constantJson = loadJson('constant');

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var ITEM_TYPE = {
        UNKNOW: 0, DOOR: 1, ENEMY: 2,
        SILVER_CHEST: 3, GOLDEN_CHEST: 4, BOSS: 5
    };

    // Map dimensi — L105193: n.length=7 kolom, n[0].length=8 baris
    var MAP_COLS = 7;  // x: 0..6
    var MAP_ROWS = 8;  // y: 0..7

    // Posisi tetap — L105327 portal cek (6,7), boss di (0,0)
    var START_X = 6, START_Y = 7;  // Player start (bottom-RIGHT)
    var BOSS_X = 0,  BOSS_Y = 0;   // Boss (top-LEFT)

    // Dari constant.json[1]
    var MAX_AP = (constantJson && constantJson['1']) ? Number(constantJson['1'].mineActionPointMax) : 50;

    // ═══════════════════════════════════════════════════════════
    //  GENERATE FRESH MINE MODEL
    // ═══════════════════════════════════════════════════════════
    //
    // Dipanggil saat user belum punya _mineModel (first time).
    // Client L105190 loadMapInfo akses _map.length dan _map[0].length,
    // jadi _map HARUS berisi grid yang valid (bukan []).
    //
    // Setiap cell HANYA boleh:
    //   [fog]              — tanpa item, TANPA index 1
    //   [fog, { _type, _enemyId, _userId }] — dengan item
    //
    // TIDAK BOLEH:
    //   [fog, null]        → for-in iterasi "1" → null._type → CRASH
    //   [fog, item, <gap>, true] → JSON sparse→null → null._type → CRASH

    function generateMineModel(level, userId) {
        var cfg = mineJson ? mineJson[String(level)] : null;
        var silverNum = cfg ? Number(cfg.silverChestNum) : 4;
        var goldNum = cfg ? Number(cfg.goldenChestNum) : 1;

        // --- Buat grid kosong: semua fog=0, tanpa item ---
        var map = [];
        for (var x = 0; x < MAP_COLS; x++) {
            map[x] = [];
            for (var y = 0; y < MAP_ROWS; y++) {
                map[x][y] = [0];
            }
        }

        // --- Player start (6,7): revealed, tanpa item ---
        map[START_X][START_Y] = [1];

        // --- Boss (0,0): revealed, dengan item BOSS ---
        // _enemyId=0 → client requestBattle pakai enemyListBOSS untuk BOSS type
        map[BOSS_X][BOSS_Y] = [1, { _type: ITEM_TYPE.BOSS, _enemyId: 0, _userId: "" }];

        // --- Kumpulkan posisi tersedia (exclude player start & boss) ---
        var avail = [];
        for (var x = 0; x < MAP_COLS; x++) {
            for (var y = 0; y < MAP_ROWS; y++) {
                if (x === START_X && y === START_Y) continue;
                if (x === BOSS_X && y === BOSS_Y) continue;
                avail.push({ x: x, y: y });
            }
        }

        // Fisher-Yates shuffle
        for (var i = avail.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = avail[i]; avail[i] = avail[j]; avail[j] = tmp;
        }

        var idx = 0;

        // --- 4 Regular ENEMY (enemyId 0,1,2,3 → enemyList1-4 di requestBattle L105589) ---
        for (var e = 0; e < 4; e++) {
            var p = avail[idx++];
            map[p.x][p.y] = [0, { _type: ITEM_TYPE.ENEMY, _enemyId: e, _userId: "" }];
        }

        // --- Silver Chests ---
        for (var s = 0; s < silverNum; s++) {
            var p = avail[idx++];
            map[p.x][p.y] = [0, { _type: ITEM_TYPE.SILVER_CHEST, _enemyId: 0, _userId: "" }];
        }

        // --- Gold Chests ---
        for (var g = 0; g < goldNum; g++) {
            var p = avail[idx++];
            map[p.x][p.y] = [0, { _type: ITEM_TYPE.GOLDEN_CHEST, _enemyId: 0, _userId: "" }];
        }

        var now = Date.now();

        return {
            _id: userId + '_mine_' + now,
            _map: map,
            _curX: START_X,
            _curY: START_Y,
            _leftStep: MAX_AP,
            _stepRecoverTime: now,
            _curLevel: level
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(data, callback) {
        var userId = data.userId;

        if (!userId) {
            log.error('MINE', 'getInfo — missing userId');
            callback({}, 1);
            return;
        }

        // ── 1. LOAD USER DATA ──
        // BUKTI: handler asli (git a9244b2) pakai key ini.
        // _mineModel disimpan DI DALAM user data, bukan key terpisah.
        var savedData = db._get('user:' + userId);

        if (!savedData) {
            log.error('MINE', 'getInfo — no user data for ' + userId);
            callback({}, 1);
            return;
        }

        // ── 2. JIKA _mineModel SUDAH ADA → return ──
        if (savedData._mineModel) {
            // Sync timesInfo dari _mineModel (model = source of truth)
            // Agar enterGame berikutnya konsisten.
            if (!savedData.timesInfo) savedData.timesInfo = {};
            savedData.timesInfo.mineSteps = savedData._mineModel._leftStep;
            savedData.timesInfo.mineStepsRecover = savedData._mineModel._stepRecoverTime;

            db._set('user:' + userId, savedData);

            log.details('MINE', [
                ['action', 'getInfo'],
                ['userId', userId],
                ['source', 'existing floor ' + (savedData._mineModel._curLevel || '?')]
            ]);

            callback({ _model: savedData._mineModel });
            return;
        }

        // ── 3. BELUM ADA _mineModel → generate floor 1 ──
        var model = generateMineModel(1, userId);

        savedData._mineModel = model;

        // Sync timesInfo dari model baru
        if (!savedData.timesInfo) savedData.timesInfo = {};
        savedData.timesInfo.mineSteps = model._leftStep;
        savedData.timesInfo.mineStepsRecover = model._stepRecoverTime;

        db._set('user:' + userId, savedData);

        log.details('MINE', [
            ['action', 'getInfo'],
            ['userId', userId],
            ['source', 'generated fresh floor 1']
        ]);

        callback({ _model: model });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('mine', 'getInfo', handle);
})();