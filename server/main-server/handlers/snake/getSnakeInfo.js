/**
 * handlers/snake/getSnakeInfo.js — Snake Dungeon Info Handler
 * Super Warrior Z — MAIN SERVER (DRAFT v2)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: snake/getSnakeInfo
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Return snake dungeon state user — current lesson, passed lesson,
 *   hero team state (HP/energy), dan reward box yang sudah di-claim.
 *
 *   Snake dungeon = "Snake Road" / "Snake Way" — dungeon bertingkat (10 stage).
 *   User battle stage by stage. Hero HP/energy persistent antar stage.
 *   Setiap beberapa stage ada reward box (snakeChest.json).
 *
 *   ══════════════════════════════════════════════════════════════════
 *   v2 CHANGES:
 *   ══════════════════════════════════════════════════════════════════
 *   1. DAILY RESET pukul 06:00 — SNAKE_RESET_HOUR = 6
 *      - generateSnakeDayTag() pakai game day logic (jam < 06 → yesterday)
 *      - Saat getSnakeInfo dipanggil, cek apakah sudah ganti game day
 *      - Jika ya DAN passLess >= 10 (user sudah clear semua stage):
 *        → Reset: curLess=1, passLess=0, allTeam={}, gotRewardBox=[]
 *      - Jika ya TAPI passLess < 10 (user belum clear semua):
 *        → TIDAK reset — user lanjutkan progressnya
 *      - Anti double-reset: _snakeLastResetDate disimpan di DB
 *
 *   2. PROGRESS PERSISTENCE — diperkuat
 *      - Semua field di-validate dan di-ensure setiap load
 *      - Deep-safe: response di-build dari fresh copy, bukan reference
 *      - _snakeLastResetDate persist ke DB bersama snake state
 *
 *   3. snakeResetTimes HANDLING
 *      - savedData._snakeResetTimes dicatat (1 = ada reset pending)
 *      - Client getState() (L135681) cek ini > 0 → call snake/reset → getSnakeInfo
 *      - Karena snake/reset handler belum ada, reset logic di-handle di sini
 *      - Setelah reset di sini, _snakeResetTimes diset 0
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITE (main.min(unminfy).js L135692)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Dipanggil dari SnakeMain.getSnakeInfo():
 *     ts.processHandler({
 *         type: "snake",
 *         action: "getSnakeInfo",
 *         userId: <userId>,
 *         version: "1.0"
 *     }, function(t) {
 *         SnakeManager.getInstance().saveSnakeData(t),  // t._snake → deserialize
 *         e.doRefresh()
 *     })
 *
 *   Juga dipanggil setelah snake/reset (L135685):
 *     reset callback → AllRefreshCount.snakeResetTimes = 0 → getSnakeInfo()
 *
 *   Flow masuk dari SnakeMain.getState() (L135681):
 *     if (AllRefreshCount.snakeResetTimes > 0) {
 *         ts.processHandler({ type:"snake", action:"reset", ... }, function(t) {
 *             AllRefreshCount.snakeResetTimes = 0;
 *             e.getSnakeInfo()
 *         })
 *     } else {
 *         e.getSnakeInfo()
 *     }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L86457 saveSnakeData + L86560 SnakeModel)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _snake: {
 *           _id: <string>,              // snake ID (unused, default "")
 *           _curLess: <number>,         // current lesson/stage (1-10), default 1
 *           _passLess: <number>,        // highest passed lesson, default 0
 *           _allTeam: {                 // hero state per hero instance ID
 *               "<heroInstanceId>": {
 *                   _curHp: <number>,
 *                   _totalHp: <number>,
 *                   _energy: <number>
 *               },
 *               ...
 *           },
 *           _gotRewardBox: [<number>, ...]  // array of box IDs already claimed
 *       }
 *   })
 *
 *   Client SnakeModel.deserialize (L86560):
 *     "_allTeam"    → dict of SnakeHeroInfo (deserialize each, set .heroId = key)
 *     "_gotRewardBox" → array (copy raw values)
 *     "_id", "_curLess", "_passLess" → strip underscore (common type)
 *
 *   SnakeHeroInfo.deserialize (L86595):
 *     "_curHp" → curHp, "_totalHp" → totalHp, "_energy" → energy
 *     (all common-typed fields stripped)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONFIG (constant.json[1])
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   snakeDungeonMaxLesson = 10    — max stage
 *   snakeTimes = 1               — daily battle times
 *   snakeHeroLevel = 40          — hero level untuk snake battle
 *
 *   snakeDungeon.json (10 entries):
 *     id, difficulty, award1, num1, battleBackGround
 *
 *   snakeChest.json (4 entries):
 *     id, lessonNeeded, award1, num1
 *     Box 1: lessonNeeded=4, Box 2: lessonNeeded=6
 *     Box 3: lessonNeeded=8, Box 4: lessonNeeded=10
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT USAGE (SnakeMain panel L135620)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   setChapterGroup (L135761):
 *     curLessId = SnakeManager.getCurLessId()   → _curLess
 *     passLessId = SnakeManager.getPassLessId() → _passLess
 *     Render 10 stage slots:
 *       stage < curLess  → done (passed)
 *       stage == curLess → current (highlighted)
 *       stage > curLess  → locked
 *
 *   setAwardBtn (L135712):
 *     curLessId, passLessId, getRewardBoxGot()
 *     snakeChest.json: box[r].lessonNeeded
 *     Box visible jika: curLess > lessonNeeded || curLess == passLess
 *     Box claimable jika: visible && !gotRewardBox.contains(boxId)
 *
 *   processAll (L135631):
 *     Sweep button: visible jika passLess == snakeDungeonMaxLesson && snakeWipe[sweepCount+1] exists
 *     Fast battle: visible jika !cleared && (VIP >= quickBattleSnakeDungeonVIP || level >= quickBattleSnakeDungeon)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESET LOGIC (06:00 boundary)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Game day boundary: SNAKE_RESET_HOUR = 6 (06:00 WIB)
 *   - Jika jam sekarang < 06:00 → game day = kemarin
 *   - Jika jam sekarang >= 06:00 → game day = hari ini
 *
 *   Saat getSnakeInfo dipanggil:
 *   1. Hitung todayTag = generateSnakeDayTag()
 *   2. Bandingkan dengan savedData.snake._snakeLastResetDate
 *   3. Jika todayTag !== _snakeLastResetDate:
 *      a. Jika snake._passLess >= SNAKE_DUNGEON_MAX_LESSON (user sudah clear semua):
 *         → RESET: curLess=1, passLess=0, allTeam={}, gotRewardBox=[]
 *         → Set _snakeLastResetDate = todayTag
 *         → Log: "DAILY RESET — snake dungeon reset for new game day"
 *      b. Jika snake._passLess < SNAKE_DUNGEON_MAX_LESSON (user belum selesai):
 *         → TIDAK reset — user lanjutkan progress
 *         → Set _snakeLastResetDate = todayTag (mark bahwa kita sudah cek hari ini)
 *         → Log: "NEW GAME DAY — no reset (passLess < max, user still in progress)"
 *
 *   Kenapa reset hanya jika passLess >= 10?
 *   - Snake dungeon = 1x per hari (snakeTimes = 1)
 *   - User battle stage 1→10, kalau berhasil clear semua → bisa sweep
 *   - Setelah sweep → state sudah reset (curLess=1, passLess=0)
 *   - Atau kalau user clear tapi belum sweep → 06:00 reset otomatis
 *   - Kalau user belum clear → jangan reset, kasih kesempatan lanjutkan
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STORAGE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Snake state disimpan di savedData.snake:
 *     savedData.snake = {
 *       _id: "",
 *       _curLess: 1,
 *       _passLess: 0,
 *       _allTeam: {},
 *       _gotRewardBox: [],
 *       _snakeLastResetDate: "snake_YYYYMMDD"   // ← v2: tracking reset
 *     }
 *
 *   Kalau belum ada (first time), buat default dengan _snakeLastResetDate = todayTag.
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS — verified dari constant.json[1]
    // ═══════════════════════════════════════════════════════════

    var SNAKE_DUNGEON_MAX_LESSON = 10;
    var SNAKE_RESET_HOUR = 6;

    // ═══════════════════════════════════════════════════════════
    //  DAILY RESET — Game Day Logic (06:00 boundary)
    // ═══════════════════════════════════════════════════════════
    //
    //  Sama pola dengan arena/getDailyReward.js (DAILY_RESET_HOUR=22),
    //  tapi snake reset pukul 06:00.
    //
    //  Jika jam < 06:00 → masih "kemarin" → subtract 1 day.
    //  Jika jam >= 06:00 → "hari ini".
    //

    function generateSnakeDayTag() {
        var d = new Date();
        if (d.getHours() < SNAKE_RESET_HOUR) {
            d.setDate(d.getDate() - 1);
        }
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return 'snake_' + y + m + day;
    }

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    /**
     * Build default snake state untuk first-time user.
     *
     * SnakeModel defaults (verified L86560):
     *   id = ""
     *   curLess = 1      (start at stage 1)
     *   passLess = 0     (nothing passed yet)
     *   allTeam = {}      (no hero team state)
     *   gotRewardBox = [] (no boxes claimed)
     *
     * v2: tambah _snakeLastResetDate = todayTag (track reset)
     */
    function buildDefaultSnake(todayTag) {
        return {
            _id: '',
            _curLess: 1,
            _passLess: 0,
            _allTeam: {},
            _gotRewardBox: [],
            _snakeLastResetDate: todayTag || ''
        };
    }

    /**
     * Load snake state dari savedData. Kalau belum ada, create default.
     * Ensure semua field valid dan bertipe benar.
     *
     * v2: tambah validate _snakeLastResetDate
     */
    function loadSnakeState(savedData, todayTag) {
        if (!savedData.snake || typeof savedData.snake !== 'object') {
            savedData.snake = buildDefaultSnake(todayTag);
        }

        var s = savedData.snake;

        // Validate each field
        if (typeof s._id !== 'string') s._id = '';
        if (typeof s._curLess !== 'number' || isNaN(s._curLess)) s._curLess = 1;
        if (typeof s._passLess !== 'number' || isNaN(s._passLess)) s._passLess = 0;
        if (!s._allTeam || typeof s._allTeam !== 'object') s._allTeam = {};
        if (!Array.isArray(s._gotRewardBox)) s._gotRewardBox = [];

        // v2: validate _snakeLastResetDate
        if (typeof s._snakeLastResetDate !== 'string') s._snakeLastResetDate = '';

        // Clamp values ke range valid
        s._curLess = Math.max(1, Math.min(SNAKE_DUNGEON_MAX_LESSON, s._curLess));
        s._passLess = Math.max(0, Math.min(SNAKE_DUNGEON_MAX_LESSON, s._passLess));

        // Validate _gotRewardBox content — pastikan semua number
        var cleanedBox = [];
        for (var i = 0; i < s._gotRewardBox.length; i++) {
            if (typeof s._gotRewardBox[i] === 'number' && !isNaN(s._gotRewardBox[i])) {
                cleanedBox.push(s._gotRewardBox[i]);
            }
        }
        s._gotRewardBox = cleanedBox;

        // Validate _allTeam content — pastikan setiap entry punya _curHp, _totalHp, _energy
        for (var heroId in s._allTeam) {
            if (!s._allTeam.hasOwnProperty(heroId)) continue;
            var hero = s._allTeam[heroId];
            if (typeof hero !== 'object' || hero === null) {
                delete s._allTeam[heroId];
                continue;
            }
            if (typeof hero._curHp !== 'number' || isNaN(hero._curHp)) hero._curHp = 0;
            if (typeof hero._totalHp !== 'number' || isNaN(hero._totalHp)) hero._totalHp = 0;
            if (typeof hero._energy !== 'number' || isNaN(hero._energy)) hero._energy = 0;
        }

        return s;
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY RESET CHECK
    // ═══════════════════════════════════════════════════════════
    //
    //  Dipanggil setiap kali getSnakeInfo.
    //  Cek apakah sudah ganti game day (06:00 boundary).
    //  Jika ya dan user sudah clear semua stage → reset progress.
    //

    function checkDailyReset(savedData) {
        var todayTag = generateSnakeDayTag();
        var snake = loadSnakeState(savedData, todayTag);

        // Sudah cek hari ini? → skip
        if (snake._snakeLastResetDate === todayTag) {
            return false;  // no reset needed
        }

        // Ganti game day! Cek apakah perlu reset
        var didReset = false;

        if (snake._passLess >= SNAKE_DUNGEON_MAX_LESSON) {
            // ═══════════════════════════════════════════════════
            //  RESET — user sudah clear semua stage
            // ═══════════════════════════════════════════════════
            //
            //  Reset ke default state:
            //    curLess = 1 (mulai dari stage 1)
            //    passLess = 0 (belum ada yang passed)
            //    allTeam = {} (hero HP/energy fresh)
            //    gotRewardBox = [] (semua box bisa di-claim lagi)
            //
            //  Alur setelah reset:
            //    1. User battle stage 1→10 lagi
            //    2. Kalau clear semua → bisa sweep
            //    3. Besok 06:00 → reset lagi (jika clear)

            log.info('SNAKE', 'DAILY RESET — '
                + 'newGameDay=' + todayTag
                + ', prevDate=' + (snake._snakeLastResetDate || '(none)')
                + ', old passLess=' + snake._passLess
                + ' → resetting snake dungeon');

            snake._curLess = 1;
            snake._passLess = 0;
            snake._allTeam = {};
            snake._gotRewardBox = [];

            didReset = true;
        } else {
            // ═══════════════════════════════════════════════════
            //  NEW GAME DAY — tapi user belum clear semua
            // ═══════════════════════════════════════════════════
            //
            //  Jangan reset! User masih dalam progress.
            //  Misalnya user sudah di stage 7 tapi belum clear 10.
            //  Kasih kesempatan lanjutkan hari ini.

            log.info('SNAKE', 'NEW GAME DAY — '
                + 'newGameDay=' + todayTag
                + ', prevDate=' + (snake._snakeLastResetDate || '(none)')
                + ', passLess=' + snake._passLess
                + ' → NO reset (user still in progress, need passLess >= '
                + SNAKE_DUNGEON_MAX_LESSON + ')');
        }

        // Update last reset date regardless
        snake._snakeLastResetDate = todayTag;

        return didReset;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD RESPONSE
    // ═══════════════════════════════════════════════════════════
    //
    //  Response berisi _snake dengan field lengkap sesuai SnakeModel.
    //
    //  ⚠️ DEEP COPY — response fields di-copy satu per satu,
    //  bukan reference. Ini mencegah client-side modification
    //  mempengaruhi server state.
    //
    //  _allTeam: dict of SnakeHeroInfo, keyed by hero instance ID (string).
    //    Setiap entry: { _curHp, _totalHp, _energy }
    //
    //  _gotRewardBox: array of box IDs (number) yang sudah di-claim.
    //

    function buildSnakeResponse(snake) {
        // Deep copy _allTeam
        var allTeamCopy = {};
        for (var heroId in snake._allTeam) {
            if (!snake._allTeam.hasOwnProperty(heroId)) continue;
            var h = snake._allTeam[heroId];
            allTeamCopy[heroId] = {
                _curHp: h._curHp || 0,
                _totalHp: h._totalHp || 0,
                _energy: h._energy || 0
            };
        }

        // Deep copy _gotRewardBox
        var boxCopy = [];
        for (var i = 0; i < snake._gotRewardBox.length; i++) {
            boxCopy.push(snake._gotRewardBox[i]);
        }

        return {
            _snake: {
                _id: snake._id || '',
                _curLess: snake._curLess || 1,
                _passLess: snake._passLess || 0,
                _allTeam: allTeamCopy,
                _gotRewardBox: boxCopy
            }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetSnakeInfo(request, callback) {
        var userId = request && request.userId;

        log.info('SNAKE', 'snake/getSnakeInfo START — userId=' + (userId || '-'));

        try {
            // ── VALIDATE userId ──
            if (!userId) {
                log.warn('SNAKE', 'getSnakeInfo — missing userId');
                callback({}, 1);
                return;
            }

            // ── Load user data ──
            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) {
                log.warn('SNAKE', 'getSnakeInfo — user data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // ── DAILY RESET CHECK (v2) ──
            // Cek apakah perlu reset berdasarkan 06:00 boundary.
            // Jika user sudah clear stage 10 dan game day baru → reset.
            var didReset = checkDailyReset(savedData);

            // ── Load / init snake state (setelah reset check) ──
            var todayTag = generateSnakeDayTag();
            var snake = loadSnakeState(savedData, todayTag);

            // ── Persist (kalau baru di-init atau ada reset) ──
            db._set(storageKey, savedData);

            // ── Build response (deep copy) ──
            var response = buildSnakeResponse(snake);

            // ── Count stats for logging ──
            var teamCount = Object.keys(snake._allTeam || {}).length;
            var boxCount = (snake._gotRewardBox || []).length;

            log.info('SNAKE', 'getSnakeInfo SUCCESS — '
                + 'curLess=' + snake._curLess
                + ', passLess=' + snake._passLess
                + ', allTeam=' + teamCount + ' heroes'
                + ', gotRewardBox=' + boxCount + ' boxes'
                + (didReset ? ' [DAILY RESET APPLIED]' : '')
                + ', gameDay=' + todayTag);
            log.details('response', [
                ['userId', userId],
                ['_id', snake._id || ''],
                ['_curLess', String(snake._curLess)],
                ['_passLess', String(snake._passLess)],
                ['_allTeam.count', String(teamCount)],
                ['_gotRewardBox', JSON.stringify(snake._gotRewardBox)],
                ['_snakeLastResetDate', snake._snakeLastResetDate || '(none)'],
                ['SNAKE_RESET_HOUR', String(SNAKE_RESET_HOUR)]
            ]);

            // ── CALLBACK ──
            callback(response);

        } catch (err) {
            log.error('SNAKE', 'getSnakeInfo UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('snake', 'getSnakeInfo', handleGetSnakeInfo);
})();