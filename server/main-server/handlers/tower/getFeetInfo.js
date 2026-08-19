/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: tower/getFeetInfo
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  TUGAS & TANGGUNG JAWAB FILE INI (1 file, 1 action):
 *
 *  Handler untuk request: { type:"tower", action:"getFeetInfo", userId, version:"1.0" }
 *  Response:              { _feetTimes: number, _feetStartRecover: number }
 *
 *  Server WAJIB:
 *    1. Load savedData user dari IndexedDB (user:{userId})
 *    2. Baca savedData.timesInfo.karinFeet dan savedData.timesInfo.karinFeetRecover
 *    3. Apply server-side recovery (sama dengan enterGame.js):
 *       - max = constant.karinTowerFeet (5)
 *       - interval = constant.karinTowerFeetRefresh (7200 detik = 2 jam)
 *       - Formula: recovered = floor((now - recoverTimestamp) / interval)
 *       - result = min(currentCount + recovered, maxCount)
 *       - Jika result >= maxCount → recoverTimestamp = 0 (penuh, tidak perlu recovery)
 *       - Jika recoverTimestamp = 0 → tidak ada recovery berjalan (sudah penuh)
 *    4. Simpan ke DB jika ada perubahan
 *    5. Return { _feetTimes, _feetStartRecover }
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  EVIDENCE DARI main.min(unminfy).js:
 *
 *  [PEMANGGILAN] Hanya 1 tempat:
 *    L133531-133539  ArenaChooseMain.requestArena() → call saat buka Arena UI
 *    Tujuan: Tampilkan counter "X/5" feet Karin Tower di lobby Arena.
 *
 *  [RESPONSE CONSUMER] TowerDataManager.setTowerCount (L87810):
 *    e.prototype.setTowerCount = function(e, t) {
 *        n.towerModelData.feetTimes = e;           // _feetTimes
 *        n.towerModelData.feetStartRecover = t;     // _feetStartRecover
 *        var o = constant[1].karinTowerFeet;        // max = 5
 *        n.towerModelData.feetTimes >= o && (
 *            n.towerModelData.feetTimes = o,
 *            n.towerModelData.feetStartRecover = 0
 *        )
 *    }
 *
 *  [DISPLAY] L133538:
 *    e.jiaLinTaNum.text = TowerDataManager.getInstance().getTowerFeetTimes()
 *                         + "/" + n[1].karinTowerFeet
 *    → Menampilkan "3/5" di UI Arena.
 *
 *  [CLIENT RECOVERY] TowerDataManager.getTowerFeetTimes() (L87815):
 *    Client JUGA menghitung recovery sendiri:
 *      if (feetStartRecover == 0) return feetTimes;
 *      elapsed = max(now - feetStartRecover, 0)
 *      recovered = floor(elapsed / (karinTowerFeetRefresh * 1000))
 *      return min(feetTimes + recovered, karinTowerFeet)
 *    → Jadi server BISA mengembalikan raw stored value,
 *      client akan menghitung recovery-nya sendiri.
 *    → Tapi lebih baik server pre-compute agar konsisten dengan enterGame.
 *
 *  [DATA SOURCE]
 *    savedData.timesInfo.karinFeet        — sisa feet (0-5)
 *    savedData.timesInfo.karinFeetRecover  — timestamp ms recovery dimulai
 *    Init oleh enterGame.js L1354-1355: karinFeet: 5, karinFeetRecover: 0
 *
 *  [CONSTANTS]
 *    constant.karinTowerFeet = 5          (max feet per hari, recoverable)
 *    constant.karinTowerFeetRefresh = 7200 (2 jam per 1 foot recovery)
 *
 *  [STORAGE]
 *    Key: user:{userId} (same savedData as enterGame)
 *    Field: savedData.timesInfo.karinFeet
 *    Field: savedData.timesInfo.karinFeetRecover
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.tower) {
        MainServer.handlers.tower = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  RECOVERY FORMULA (identik dengan enterGame.js L482-499)
    // ═══════════════════════════════════════════════════════════

    /**
     * computeRecovery(currentCount, recoverTimestamp, maxCount, intervalSec, nowMs)
     * — Calculate recovered count based on elapsed time.
     *
     * Replicates client recovery formula (L96020, L125960, L125012, L136916).
     * Formula: recovered = Math.floor((now - recoverTimestamp) / interval)
     *          result = Math.min(currentCount + recovered, maxCount)
     *
     * When recoverTimestamp = 0 → recovery disabled (count at max / not recovering).
     * When currentCount >= maxCount → no recovery needed.
     *
     * @param {number} currentCount — stored count
     * @param {number} recoverTimestamp — last recover timestamp in ms (serverTime)
     * @param {number} maxCount — maximum count
     * @param {number} intervalSec — recovery interval in seconds
     * @param {number} nowMs — current server time in ms
     * @returns {{ count: number, recoverTimestamp: number }}
     */
    function computeRecovery(currentCount, recoverTimestamp, maxCount, intervalSec, nowMs) {
        if (!recoverTimestamp || recoverTimestamp === 0) {
            return { count: currentCount, recoverTimestamp: recoverTimestamp };
        }
        if (currentCount >= maxCount) {
            return { count: currentCount, recoverTimestamp: 0 };
        }

        var elapsed = Math.max(0, nowMs - recoverTimestamp) / 1000;
        var recovered = Math.floor(elapsed / intervalSec);

        if (recovered <= 0) {
            return { count: currentCount, recoverTimestamp: recoverTimestamp };
        }

        var newCount = Math.min(currentCount + recovered, maxCount);
        var newTimestamp = newCount >= maxCount ? 0 : recoverTimestamp + recovered * intervalSec * 1000;

        return { count: newCount, recoverTimestamp: newTimestamp };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetFeetInfo(request, callback) {
        var userId = request.userId;

        // ── VALIDASI ──
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            log.warn('TOWER', 'getFeetInfo — missing or invalid userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        log.info('TOWER', 'tower/getFeetInfo userId=' + userId);

        try {
            // 1. Load savedData dari IndexedDB
            var savedData = db._get('user:' + userId);
            if (!savedData) {
                log.warn('TOWER', 'getFeetInfo — No savedData for userId=' + userId);
                // Return default (full feet, no recovery)
                callback({ _feetTimes: 5, _feetStartRecover: 0 });
                return;
            }

            // 2. Load constants
            var constants = null;
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', './resource/json/constant.json', false);
                xhr.send();
                if (xhr.status === 200 || xhr.status === 0) {
                    constants = JSON.parse(xhr.responseText);
                }
            } catch (e) {}

            var c = (constants && constants[1]) ? constants[1] : null;
            var FEET_MAX = Number(c && c.karinTowerFeet) || 5;
            var FEET_INTERVAL = Number(c && c.karinTowerFeetRefresh) || 7200;

            // 3. Baca current feet dari timesInfo
            var ti = savedData.timesInfo;
            if (!ti) {
                log.warn('TOWER', 'getFeetInfo — No timesInfo for userId=' + userId);
                callback({ _feetTimes: FEET_MAX, _feetStartRecover: 0 });
                return;
            }

            var currentFeet = (typeof ti.karinFeet === 'number') ? ti.karinFeet : FEET_MAX;
            var currentRecover = (typeof ti.karinFeetRecover === 'number') ? ti.karinFeetRecover : 0;

            // 4. Apply server-side recovery
            var nowMs = Date.now();
            var result = computeRecovery(currentFeet, currentRecover, FEET_MAX, FEET_INTERVAL, nowMs);

            // 5. Save jika ada perubahan
            var changed = (result.count !== currentFeet || result.recoverTimestamp !== currentRecover);
            if (changed) {
                ti.karinFeet = result.count;
                ti.karinFeetRecover = result.recoverTimestamp;
                db._set('user:' + userId, savedData);
            }

            // 6. Log & Response
            log.details('TOWER', [
                ['userId', userId],
                ['feet', result.count + '/' + FEET_MAX],
                ['recover', result.recoverTimestamp === 0 ? 'full' : 'recovering'],
                ['changed', changed ? 'yes' : 'no']
            ]);

            callback({
                _feetTimes: result.count,
                _feetStartRecover: result.recoverTimestamp
            });

        } catch (err) {
            log.error('TOWER', 'getFeetInfo UNCAUGHT ERROR: ' + err.message);
            log.error('TOWER', 'Stack: ' + (err.stack || '(no stack)'));
            callback({
                _error: 'server_error',
                _message: err.message || 'Unknown error'
            }, 99);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('tower', 'getFeetInfo', handleGetFeetInfo);

    window.MainServer = MainServer;
})();