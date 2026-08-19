/**
 * handlers/trial/getState.js — Temple Trial GetState Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: trial/getState
 * ============================================================
 *
 * Client call (main.min.js L56271-56286):
 *   OpenLimit.checkTempleLimit() → cek level >= 23 (open.json #25)
 *   ts.processHandler({
 *     type: 'trial',
 *     action: 'getState',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     version: '1.0'
 *   }, callback(response))
 *
 * Response callback (L56279-56286):
 *   1. TrialManager.getInstance().setTempleTrialInfo(e)
 *      → reads e._model
 *   2. ts.runScene('TempleTrial', { parent: 'Temple', isTrialGroup: false })
 *
 * ============================================================
 * RESPONSE FORMAT (WAJIB):
 * ============================================================
 * {
 *   _model: {
 *     _id: string,
 *     _haveTimes: number,
 *     _timesStartRecover: number (ms timestamp),
 *     _lastLess: number (floor ID, 0 = belum mulai),
 *     _lastTime: number (ms timestamp),
 *     _buyFund: boolean,
 *     _haveGotFundReward: object { [id]: boolean }
 *   }
 * }
 *
 * ============================================================
 * TUGAS HANDLER INI:
 * ============================================================
 * 1. VALIDASI request (userId)
 * 2. READ savedData dari DB
 * 3. INIT trialState jika belum ada (new user)
 * 4. DAILY RESET cek: jika hari berganti (UTC+8)
 *    → simpan _lastLess ke _yesterdayFloor
 *    → reset times, buyCount
 *    → update _dailyDate
 * 5. COMPUTE real-time recovery
 *    → hitung berapa times recovered sejak _timesStartRecover
 *    → cap ke max times (10)
 *    → update DB agar konsisten
 * 6. RETURN response { _model: { ... } }
 *
 * ============================================================
 * YANG TIDAK DILAKUKAN:
 * ============================================================
 * - Tidak build enemy team (itu trial/startBattle)
 * - Tidak grant reward (itu trial/checkBattleResult)
 * - Tidak deduct item (itu trial/vipBuy)
 * - Tidak advance quest/task (itu trial/checkBattleResult)
 * - Tidak cek VIP/IAP (itu trial/vipBuy, trial/buyFund)
 *
 * ============================================================
 * JSON CONFIG YANG DI-LOAD:
 * ============================================================
 *   constant.json  ✅ templeTestTimes (10), templeTestTimesRefresh (1800)
 *
 *   TIDAK MEMUAT: templeTest.json, dungeonTimesBuy.json, templeDaily.json,
 *   templePrivilege.json, templePrivilegeBuy.json, task.json, taskDaily.json,
 *   taskAchievement.json, open.json → semua itu untuk handler lain.
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.trial) {
        MainServer.handlers.trial = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE & CONFIG LOADER
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJsonSync(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
        } catch (e) {
            log.warn('RESOURCE', 'Failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getConstant(key) {
        var c = loadJsonSync('constant');
        return c ? c[key] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  UTC+8 (CST) DATE HELPERS
    //  Identik dengan enterGame.js generateRetrieveDay (L411-425)
 // ═══════════════════════════════════════════════════════════

    function getCSTNow() {
        var now = new Date();
        return new Date(now.getTime() + (8 * 60 * 60 * 1000) + now.getTimezoneOffset() * 60 * 1000);
    }

    function getTodayStrCST() {
        var d = getCSTNow();
        var yyyy = d.getUTCFullYear();
        var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(d.getUTCDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }

    // ═══════════════════════════════════════════════════════════
    //  TRIAL STATE INIT
    // ═══════════════════════════════════════════════════════════

    /**
     * Build default trial state for new user.
     * Called when savedData.trialState does not exist.
     *
     * @param {string} userId
     * @returns {Object} trialState
     */
    function buildDefaultTrialState(userId) {
        var nowMs = Date.now();
        var today = getTodayStrCST();
        var maxTimes = Number(getConstant('templeTestTimes')) || 10;

        return {
            _id: userId,
            _haveTimes: maxTimes,
            _timesStartRecover: nowMs,
            _lastLess: 0,
            _lastTime: 0,
            _buyFund: false,
            _haveGotFundReward: {},
            _buyCount: 0,
            _dailyDate: today,
            _yesterdayFloor: 0,
            _dailyRewardClaimed: false
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY RESET
    // ═══════════════════════════════════════════════════════════

    /**
     * Check and perform daily reset based on UTC+8 date.
     * MUTATES savedData.trialState in place.
     *
     * Daily reset logic:
     * 1. Save current _lastLess to _yesterdayFloor (for getDailyReward)
     * 2. Reset _haveTimes to max (10)
     * 3. Reset _timesStartRecover to now
     * 4. Reset _buyCount to 0
     * 5. Set _dailyDate to today
     * 6. Set _dailyRewardClaimed to false
     *
     * @param {Object} ts - trialState from savedData
     * @returns {boolean} true if reset was performed
     */
    function checkDailyReset(ts) {
        var today = getTodayStrCST();
        if (ts._dailyDate === today) {
            return false;
        }

        log.info('TRIAL_STATE', 'Daily reset detected (was ' + (ts._dailyDate || 'none') + ', now ' + today + ')');

        // Save yesterday's floor for daily reward
        ts._yesterdayFloor = ts._lastLess || 0;

        // Reset times
        var maxTimes = Number(getConstant('templeTestTimes')) || 10;
        ts._haveTimes = maxTimes;
        ts._timesStartRecover = Date.now();

        // Reset buy count
        ts._buyCount = 0;

        // Reset daily reward claimed flag
        ts._dailyRewardClaimed = false;

        // Update date
        ts._dailyDate = today;

        log.details('daily_reset', [
            ['yesterdayFloor', String(ts._yesterdayFloor)],
            ['newHaveTimes', String(ts._haveTimes)],
            ['newDailyDate', ts._dailyDate]
        ]);

        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  TIME RECOVERY COMPUTATION
    // ═══════════════════════════════════════════════════════════

    /**
     * Compute real-time recovered times and update trialState.
     * MUTATES ts in place.
     *
     * Client-side formula (getTrialCount):
     *   elapsed = (now - _timesStartRecover) / 1000
     *   recovered = Math.floor(elapsed / templeTestTimesRefresh)
     *   finalCount = Math.min(_haveTimes + recovered, maxTimes)
     *
     * Server-side: we update DB to stay in sync.
     *   newHaveTimes = Math.min(oldHaveTimes + recoveredTimes, maxTimes)
     *   newTimesStartRecover = oldTimesStartRecover + (recoveredTimes * refreshMs)
     *
     * WHY update DB? So that if getState is called again, recovery
     * doesn't double-count. Client also computes this locally via
     * setTrialCount(), so server must be consistent.
     *
     * @param {Object} ts - trialState (MUTATED)
     * @returns {void}
     */
    function computeTimeRecovery(ts) {
        var maxTimes = Number(getConstant('templeTestTimes')) || 10;
        var refreshSeconds = Number(getConstant('templeTestTimesRefresh')) || 1800;
        var refreshMs = refreshSeconds * 1000;

        if (ts._haveTimes >= maxTimes) {
            // Already at max, no recovery needed
            // But ensure _timesStartRecover is set for future recovery
            if (!ts._timesStartRecover || ts._timesStartRecover <= 0) {
                ts._timesStartRecover = Date.now();
            }
            return;
        }

        var nowMs = Date.now();
        var startRecover = ts._timesStartRecover || nowMs;

        // If _timesStartRecover is in the future or invalid, fix it
        if (startRecover > nowMs) {
            ts._timesStartRecover = nowMs;
            return;
        }

        var elapsedMs = nowMs - startRecover;
        var recoveredTimes = Math.floor(elapsedMs / refreshMs);

        if (recoveredTimes <= 0) {
            return;
        }

        // Calculate new values
        var oldHaveTimes = ts._haveTimes;
        var newHaveTimes = Math.min(oldHaveTimes + recoveredTimes, maxTimes);
        var actualRecovered = newHaveTimes - oldHaveTimes;

        // Update _timesStartRecover to account for recovered times
        // This prevents double-counting on next getState call
        ts._timesStartRecover = startRecover + (actualRecovered * refreshMs);
        ts._haveTimes = newHaveTimes;

        log.details('recovery', [
            ['oldHaveTimes', String(oldHaveTimes)],
            ['recovered', String(actualRecovered)],
            ['newHaveTimes', String(newHaveTimes)],
            ['maxTimes', String(maxTimes)]
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: trial/getState
    // ═══════════════════════════════════════════════════════════

    /**
     * handleGetState(request, callback)
     *
     * Returns current temple trial state for the player.
     * Handles: init for new user, daily reset, time recovery.
     * Does NOT: battle, reward, deduct, quest advance.
     */
    function handleGetState(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'trial/getState processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            // ── STEP 1: Validate request ──
            if (!userId) {
                log.warn('HANDLER', 'trial/getState — missing userId');
                callback({});
                return;
            }

            // ── STEP 2: Read savedData from DB ──
            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('HANDLER', 'trial/getState — user data not found for: ' + userId);
                callback({});
                return;
            }

            // ── STEP 3: Ensure trialState exists (new user init) ──
            if (!savedData.trialState) {
                log.info('TRIAL_STATE', 'Initializing trialState for new user: ' + userId);
                savedData.trialState = buildDefaultTrialState(userId);
            }

            var ts = savedData.trialState;

            // ── STEP 4: Daily reset check (UTC+8) ──
            var didReset = checkDailyReset(ts);

            // ── STEP 5: Compute real-time recovery ──
            computeTimeRecovery(ts);

            // ── STEP 6: Save to DB ──
            db._set(storageKey, savedData);

            // ── STEP 7: Build response ──
            var response = {
                _model: {
                    _id: ts._id || userId,
                    _haveTimes: ts._haveTimes,
                    _timesStartRecover: ts._timesStartRecover || 0,
                    _lastLess: ts._lastLess || 0,
                    _lastTime: ts._lastTime || 0,
                    _buyFund: !!ts._buyFund,
                    _haveGotFundReward: ts._haveGotFundReward || {}
                }
            };

            log.info('HANDLER', 'trial/getState success');
            log.details('state', [
                ['userId', userId],
                ['haveTimes', String(response._model._haveTimes)],
                ['lastLess', String(response._model._lastLess)],
                ['buyFund', String(response._model._buyFund)],
                ['dailyReset', didReset ? 'YES' : 'no']
            ]);

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'trial/getState UNCAUGHT ERROR', err);
            callback({});
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('trial', 'getState', handleGetState);

    window.MainServer = MainServer;
})();
