/**
 * move.js — Mine Move Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS (1 file, 1 action):
 *   Request:  { type:"mine", action:"move", userId, targetX, targetY, version:"1.0" }
 *   Response: { _leftStep, _stepRecoverTime }
 *
 *   1. Validasi: coords dalam range, Manhattan dist == 1, AP > 0
 *   2. Hitung effective AP (base + recovered), kurangi 1
 *   3. Update posisi, reveal fog sekitar posisi baru
 *   4. Simpan, return { _leftStep, _stepRecoverTime }
 *
 *   Client HANYA membaca 2 field dari response (L105480):
 *     o._leftStep        → changeLeftStep()
 *     o._stepRecoverTime → changeStepRecoverTime()
 *   changeCurrPos(targetX, targetY) dipanggil dari CLIENT,
 *   BUKAN dari response.
 * ============================================================
 *
 * EVIDENCE DARI main.min(unminfy).js:
 *
 *   [PEMANGGILAN] L105456-105474 requestMove():
 *     o.stepNumber < 1 → addcountBtnTap() (client pre-check, server juga harus validasi)
 *     ts.processHandler({
 *       type:"mine", action:"move", userId, targetX:e, targetY:t, version:"1.0"
 *     }, successCb, failCb)
 *
 *   [RESPONSE CONSUMER] L105475-105487 playMoveAnimation(e, t, n, o):
 *     o = response
 *     changeLeftStep(o._leftStep)        ← HANYA baca _leftStep
 *     changeStepRecoverTime(o._stepRecoverTime)  ← HANYA baca _stepRecoverTime
 *     changeCurrPos(e, t)                 ← dari REQUEST params, bukan response
 *     openCongratulationObtain(o, cb)      ← L56637: if(!_changeInfo) return → aman
 *
 *   [CLIENT ROUTING] L105429-105443 clickMapItem():
 *     if (manhattanDist != 1) → show "too far" tip
 *     if (cell[r][i][1] ada):
 *       ENEMY/BOSS → requestBattle()
 *       SILVER_CHEST/GOLDEN_CHEST → openBox()
 *       DOOR/other → requestMove()   ← DOOR type juga move
 *     else → requestMove()           ← empty cell
 *
 *     Artinya: move handler bisa dipanggil untuk empty cell ATAU DOOR cell.
 *     Server tidak perlu cek tipe item — cukup cek jarak dan AP.
 *
 *   [REVEAL LOGIC] changeCurrPos (L79583 TheWildAdventureManager):
 *     if (cell[x][y][1] && cell[x][y][1]._type == ENEMY) → Chebyshev <= 2 (5x5 box)
 *     else → Manhattan <= 1
 *     Move selalu ke empty/DOOR cell → selalu Manhattan <= 1.
 *     Server WAJIB reveal juga agar re-login visibility konsisten.
 *
 *   [AP FORMULA] — sama dengan getMineCount() client (L79583):
 *     recovered = floor(max(now - stepRecoverTime, 0) / (1000 * 1800))
 *     effectiveAP = min(leftStep + recovered, 50)
 *     Setelah move: leftStep = effectiveAP - 1, stepRecoverTime = now
 *     Reset stepRecoverTime ke now agar client tidak double-count recovery.
 *
 *   [STORAGE]:
 *     _mineModel di dalam savedData: db._get('user:{userId}')._mineModel
 *     Update _curX, _curY, _leftStep, _stepRecoverTime, _map (reveal fog)
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

    var constantJson = loadJson('constant');

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS (dari constant.json[1])
    // ═══════════════════════════════════════════════════════════

    var MAX_STEPS = (constantJson && constantJson['1'])
        ? Number(constantJson['1'].mineActionPointMax) : 50;

    var REFRESH_SEC = (constantJson && constantJson['1'])
        ? Number(constantJson['1'].mineActionPointRefreshTime) : 1800;

    var REFRESH_MS = REFRESH_SEC * 1000;

    // Map dimensi — L105193: n.length=7 kolom, n[0].length=8 baris
    var MAP_COLS = 7;  // x: 0..6
    var MAP_ROWS = 8;  // y: 0..7

    // ═══════════════════════════════════════════════════════════
    //  REVEAL VISIBILITY
    // ═══════════════════════════════════════════════════════════
    //
    // Identik dengan client changeCurrPos untuk non-ENEMY cell:
    //   for i=0..a.length, s=0..a[i].length
    //     Math.abs(e-i) + Math.abs(t-s) <= r → a[i][s][0] = 1
    //   r = 1 → Manhattan distance <= 1 (5 cell: center + 4 tetangga)

    function revealAround(map, cx, cy) {
        var dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var i = 0; i < dirs.length; i++) {
            var nx = cx + dirs[i][0];
            var ny = cy + dirs[i][1];
            if (nx >= 0 && nx < MAP_COLS && ny >= 0 && ny < MAP_ROWS) {
                map[nx][ny][0] = 1;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(data, callback) {
        var userId = data.userId;
        var targetX = data.targetX;
        var targetY = data.targetY;

        // ── 1. LOAD DATA ──
        var savedData = db._get('user:' + userId);
        if (!savedData) {
            log.error('MINE', 'move — no user data for ' + userId);
            callback({}, 1);
            return;
        }

        var model = savedData._mineModel;
        if (!model) {
            log.error('MINE', 'move — no mineModel for ' + userId);
            callback({}, 1);
            return;
        }

        // ── 2. VALIDASI COORDS ──
        // L105193: map.length=7 (x), map[0].length=8 (y)
        if (targetX < 0 || targetX >= MAP_COLS || targetY < 0 || targetY >= MAP_ROWS) {
            log.warn('MINE', 'move — out of bounds [' + targetX + ',' + targetY + '] user=' + userId);
            callback({}, 1);
            return;
        }

        // L105435: client cek Manhattan distance == 1
        var dist = Math.abs(model._curX - targetX) + Math.abs(model._curY - targetY);
        if (dist !== 1) {
            log.warn('MINE', 'move — dist=' + dist + ' cur=[' + model._curX + ',' + model._curY +
                '] target=[' + targetX + ',' + targetY + '] user=' + userId);
            callback({}, 1);
            return;
        }

        // ── 3. HITUNG & VALIDASI AP ──
        var now = Date.now();
        var elapsed = Math.max(now - model._stepRecoverTime, 0);
        var recovered = Math.floor(elapsed / REFRESH_MS);
        var effectiveAP = Math.min(model._leftStep + recovered, MAX_STEPS);

        if (effectiveAP < 1) {
            log.warn('MINE', 'move — no AP: effective=' + effectiveAP +
                ' base=' + model._leftStep + ' recovered=' + recovered + ' user=' + userId);
            callback({}, 1);
            return;
        }

        // ── 4. SIMPAN POSISI ASAL (sebelum di-overwrite) ──
        var fromX = model._curX;
        var fromY = model._curY;

        // ── 5. KURANGI AP ──
        // Cash out recovered steps, kurangi 1 untuk move ini.
        // Reset stepRecoverTime ke now → client tidak double-count.
        model._leftStep = effectiveAP - 1;
        model._stepRecoverTime = now;

        // ── 6. UPDATE POSISI ──
        model._curX = targetX;
        model._curY = targetY;

        // ── 7. REVEAL VISIBILITY ──
        // Server WAJIB reveal agar re-login data konsisten.
        // Move selalu ke empty/DOOR cell → Manhattan <= 1.
        revealAround(model._map, targetX, targetY);

        // ── 8. SIMPAN ──
        savedData._mineModel = model;

        // Sync timesInfo agar enterGame konsisten jika DC sebelum next getInfo.
        if (!savedData.timesInfo) savedData.timesInfo = {};
        savedData.timesInfo.mineSteps = model._leftStep;
        savedData.timesInfo.mineStepsRecover = model._stepRecoverTime;

        db._set('user:' + userId, savedData);

        // ── 9. LOG ──
        log.details('MINE', [
            ['action', 'move'],
            ['userId', userId],
            ['from', fromX + ',' + fromY],
            ['to', targetX + ',' + targetY],
            ['AP', model._leftStep + '/' + MAX_STEPS],
            ['recovered', String(recovered)]
        ]);

        // ── 10. RESPONSE ──
        // Client L105480 HANYA baca _leftStep dan _stepRecoverTime.
        callback({
            _leftStep: model._leftStep,
            _stepRecoverTime: model._stepRecoverTime
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('mine', 'move', handle);
})();