/**
 * handlers/user/enterGame.js — EnterGame Handler (MONSTER v3 — FINAL 100%)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  FILE PEMBAGIAN STRATEGI:
 *    enterGame.js  → JANTUNG main-server. Semua field response,
 *                    validasi, daily reset, metadata, broadcast,
 *                    hero base attr, hangup reward, timesInfo recovery.
 *    getAttrs.js   → Hero FULL attr computation (DIPISAH, kompleks)
 *    registChat.js → Chat server registration (DIPISAH)
 *    LAINNYA       → Satu handler = satu file
 * ============================================================
 *
 * Client call: processHandler({type:'user',action:'enterGame',
 *   loginToken, userId, serverId, version, language, gameVersion}, cb)
 *   main.min.js L114422-114430
 *
 * Response callback: cb(responseData)
 *   responseData = FULL user data object (100+ fields)
 *   Client flow setelah sukses (L114431-114441):
 *     1. ts.fromReconnect ?
 *        YES → saveUserData(t) + refreshNodeResource (skip loginSuccessCallBack)
 *        NO  → loginSuccessCallBack(t)
 *               ├─ saveUserData(t)          — L114793-114873 (100+ field reads)
 *               ├─ if (e.newUser) → SDK reports
 *               └─ ts.runScene('OverScene')  — L114548
 *     2. reportToLoginEnterInfo()  — L114448 (SaveUserEnterInfo ke LOGIN server)
 *     3. chatJoinRecord(broadcastRecord)  — L114436
 *     4. setInterval(registChat, 3000)  — L114438 (chat server polling)
 *     5. loginClient.destroy()  — L114459 (setelah SaveUserEnterInfo sukses)
 *
 *   Post-enterGame network requests (setelah OverScene load):
 *     heroImage.getAll → hero.getAttrs → userMsg.getMsgList → entrust.getInfo
 *     chat.login → chat.joinRoom ×4 → dungeon connect
 *
 * Response MUST include semua field yang saveUserData baca (L114793-114873).
 *
 * Error: callback(data, retCode) — retCode != 0 → envelope ret != 0
 *   Client processHandler L113851: e.ret === 0 untuk sukses,
 *   else → ErrorHandler.ShowErrorTips (gunakan errorDefine.json)
 *
 * Alur loginToken validation:
 *   Login-server SaveHistory → generate token → simpan ke IndexedDB
 *     DB: last_game_server, store: loginInfo (field: loginToken)
 *   Main-server enterGame → baca IndexedDB via validateLoginToken → proses
 *
 * Ret Code Mapping (berbasis errorDefine.json):
 *   0 = success
 *   1 = generic error (default)
 *   2 = maintenance mode
 *   3 = account banned
 *   4 = version mismatch
 *   5 = server full
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.user) {
        MainServer.handlers.user = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH A: RESOURCE CACHE & CONFIG LOADER
    // ═══════════════════════════════════════════════════════════
    //
    //  Semua config JSON di-load sync dari ./resource/json/.
    //  Di-cache di _resourceCache supaya tidak load ulang per-request.
    //
    //  Config files yang digunakan enterGame:
    //    constant.json   → startHero, startHeroLevel, startLesson, dll (key "1")
    //    hero.json       → hero config per displayId (tag, talent, quality, type,
    //                       balanceHp/Attack/Armor, speed, hit, dodge, dll)
    //    heroLevelAttr.json → hero base HP/attack/armor per level
    //    heroQualityParam.json → quality multiplier (hpParam/attackParam/armorParam)
    //    heroTypeParam.json   → type multiplier + flat biases (hpBais/attackBais)
    //    heroEvolve.json      → evolve bonus stats per hero per evolve level
    //    heroWakeUp.json      → star/wakeup bonus stats per hero per star level
    //    heroWakeUpRed.json   → red star bonus stats
    //    heroEvolveRed.json   → red evolve bonus stats
    //    errorDefine.json     → error code definitions (365 entries)
    //    currencyDisplay.json → currency formatting templates
    //    bagPlus.json        → backpack capacity per level
    //    task.json           → main task chain (6001→6002→...→6044)
    //    zPowerQualityPara.json → quality power multiplier
    //    lesson.json         → lesson/chapter config (for hangup rewards)

    var _resourceCache = {};

    /**
     * loadJsonSync(name) — Load JSON config dari ./resource/json/{name}.json
     * Cached — hanya load sekali, selanjutnya dari memory.
     *
     * @param {string} name — filename TANPA .json extension
     * @returns {object|null} parsed JSON data, null jika gagal
     */
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

    // ── Config getter functions ──

    /** constant.json key "1" — startHero, startHeroLevel, resetTime, dll */
    function getConstant() {
        if (window.constant && window.constant['1']) return window.constant['1'];
        var c = loadJsonSync('constant');
        return c ? c['1'] : null;
    }

    /** hero.json — per hero config by displayId string */
    function getHeroConfig(heroDisplayId) {
        var h = loadJsonSync('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    /** heroLevelAttr.json — base stats per level: hp, attack, armor */
    function getHeroLevelAttr(level) {
        var la = loadJsonSync('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    /** heroQualityParam.json — quality multiplier indexed by quality string */
    function getHeroQualityParam(quality) {
        var qp = loadJsonSync('heroQualityParam');
        return qp ? qp[quality] : null;
    }

    /** heroTypeParam.json — type multiplier + flat biases indexed by heroType string */
    function getHeroTypeParam(heroType) {
        var tp = loadJsonSync('heroTypeParam');
        return tp ? tp[heroType] : null;
    }

    /** heroEvolve.json — evolve bonus stats per hero per evolve level */
    function getHeroEvolve(heroId) {
        var ev = loadJsonSync('heroEvolve');
        return ev ? ev[String(heroId)] : null;
    }

    /** heroWakeUp.json — star/wakeup bonus stats per hero per star level */
    function getHeroWakeUp(heroId) {
        var wu = loadJsonSync('heroWakeUp');
        return wu ? wu[String(heroId)] : null;
    }

    /** errorDefine.json — error code definitions by id */
    function getErrorDefine(errorCode) {
        var ed = loadJsonSync('errorDefine');
        return ed ? ed[String(errorCode)] : null;
    }

    /** currencyDisplay.json — currency formatting templates */
    function getCurrencyDisplay(currencyCode) {
        var cd = loadJsonSync('currencyDisplay');
        return cd ? cd[currencyCode] : null;
    }

    /** task.json — main task chain config */
    function getTaskConfig(taskId) {
        var t = loadJsonSync('task');
        return t ? t[String(taskId)] : null;
    }

    /** zPowerQualityPara.json — quality power multiplier */
    function getZPowerQualityPara(quality) {
        var zp = loadJsonSync('zPowerQualityPara');
        if (!zp) return null;
        // zPowerQualityPara indexed by numeric id, not quality string
        for (var k in zp) {
            if (zp.hasOwnProperty(k) && zp[k].quality === quality) return zp[k];
        }
        return null;
    }

    /** lesson.json — lesson/chapter config for hangup reward computation */
    function getLessonConfig(lessonId) {
        var l = loadJsonSync('lesson');
        return l ? l[String(lessonId)] : null;
    }

    /** bagPlus.json — backpack capacity per level */
    function getBagPlus(level) {
        var bp = loadJsonSync('bagPlus');
        return bp ? bp[String(level)] : null;
    }

    /** idleAwardFirst.json — first-time idle rewards for new players */
    function getIdleAwardFirst() {
        return loadJsonSync('idleAwardFirst');
    }

    /** onlineBonus.json — online time bonus tiers */
    function getOnlineBonus() {
        return loadJsonSync('onlineBonus');
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH B: ITEM ID CONSTANTS
    // ═══════════════════════════════════════════════════════════
    //
    //  Client L116237: hardcoded item ID constants.
    //  Used di setBackpack (L114912-114921) untuk iterasi totalProps._items.
    //  Player level di-read via PLAYERLEVELID item → getUserLevel().
    //
    //  Evidence:
    //    L114917: a == PLAYERLEVELID → setLastUserLevel(r)
    //    L96315: getUserLevel() → getItemNum(PLAYERLEVELID)
    //    L114456: reportToLoginEnterInfo reads getUserLevel()

    var ITEM_IDS = {
        DIAMONDID: 101,               // L116237 — premium currency
        GOLDID: 102,                 // L116237 — regular currency
        PLAYEREXPERIENCEID: 103,     // L116237 — user EXP (progress toward next level)
        PLAYERLEVELID: 104,          // L116237 — user level (CRITICAL: getUserLevel())
        PLAYERVIPEXPERIENCEID: 105,  // L116237 — VIP experience
        PLAYERVIPLEVELID: 106,       // L116237 — VIP level (hero bag capacity)
        PLAYERVIPEXPALLID: 107,      // L116237 — VIP exp all-time
        EXPERIENCECAPSULEID: 131,   // L116237 — EXP capsule item
        EVOLVECAPSULEID: 132,       // L116237 — Evolve capsule item
        SoulCoinID: 111,             // L116249 — Soul Coin (altar shop refresh)
        ArenaCoinID: 112,            // L116237 — Arena Coin
        SnakeCoinID: 113,            // L116237 — Snake Coin (snake shop refresh)
        TeamCoinID: 114,             // L116237 — Team Coin (guild shop)
        HonourCoinID: 115,           // L116237 — Honour Coin (guild shop)
        EnergyStone: 136,            // L116237 — Energy Stone
        Metal: 137,                  // L116237 — Metal
        ZCOIN: 138,                  // L116249 — Z Coin
        Aurine: 140,                 // L116237 — Aurine
        POTENTIALWATER: 133,         // L116249 — Potential Water
        SUPERWATER: 134,             // L116249 — Super Water
        EARUPCOIN: 135,              // L116249 — Ear Up Coin
        EAREVOLVECOIN: 139,          // L116249 — Ear Evolve Coin
        FRIENDHEART: 121,            // L116249 — Friend Heart
        COMMONSUMMONPAPER: 122,      // L116249 — Common Summon Paper
        HIGHSUMMONPAPER: 123,        // L116249 — High Summon Paper
        DRAGONSPIRIT: 124,           // L116249 — Dragon Spirit
        MARKETREFRESHID: 141,        // L116249 — Market Refresh item
        LOWENTRUSTBOOK: 143,         // L116249 — Low Entrust Book
        MIDDLEENTRUSTBOOK: 144,      // L116249 — Middle Entrust Book
        HIGHENTRUSTBOOK: 145         // L116249 — High Entrust Book
    };

    // ═══════════════════════════════════════════════════════════
    //  BATCH C: ERROR CODES & ERROR DEFINITION INTEGRATION
    // ═══════════════════════════════════════════════════════════
    //
    //  Ret code mapping berbasis errorDefine.json (365 entries).
    //  Client L113851: e.ret === 0 → sukses, else → ShowErrorTips.
    //  ErrorDefine fields: id, hintType, isKick, isNotShow, errorType,
    //    errorDescription (i18n key).
    //
    //  NOTE: Client ShowErrorTips menerima errorDescription dan menampilkan
    //  sesuai hintType ("window" = modal, "float" = toast).
    //  isKick=1 → kick player ke login screen.

    var RET_CODES = {
        SUCCESS: 0,
        GENERIC_ERROR: 1,        // errorDefine id=1 — ERROR_UNKNOWN
        MAINTENANCE: 2,           // custom — server maintenance
        ACCOUNT_BANNED: 3,        // custom — account banned
        VERSION_MISMATCH: 4,      // custom — client version too old
        SERVER_FULL: 5,           // custom — server at capacity
        TOKEN_INVALID: 6,         // custom — login token invalid
        TOKEN_MISMATCH: 7,        // custom — login token value mismatch
        MISSING_USERID: 8,        // custom — missing userId
        SERVER_ERROR: 99          // custom — uncaught exception
    };

    /**
     * buildError(retCode, detail) — Build error response object.
     *
     * Format yang client terima via callback(data, retCode):
     *   callback({ errorCode, errorMessage, detail }, retCode)
     *
     * Client L113851: e.ret !== 0 → ShowErrorTips.
     * ShowErrorTips menggunakan errorDescription dari errorDefine.json
     * untuk i18n message display.
     *
     * @param {number} retCode — dari RET_CODES
     * @param {string} detail — human-readable detail untuk log
     * @returns {{ error: string, errorCode: number, errorMessage: string, detail: string }}
     */
    function buildError(retCode, detail) {
        var errorNames = {};
        errorNames[RET_CODES.SUCCESS] = 'SUCCESS';
        errorNames[RET_CODES.GENERIC_ERROR] = 'GENERIC_ERROR';
        errorNames[RET_CODES.MAINTENANCE] = 'MAINTENANCE';
        errorNames[RET_CODES.ACCOUNT_BANNED] = 'ACCOUNT_BANNED';
        errorNames[RET_CODES.VERSION_MISMATCH] = 'VERSION_MISMATCH';
        errorNames[RET_CODES.SERVER_FULL] = 'SERVER_FULL';
        errorNames[RET_CODES.TOKEN_INVALID] = 'TOKEN_INVALID';
        errorNames[RET_CODES.TOKEN_MISMATCH] = 'TOKEN_MISMATCH';
        errorNames[RET_CODES.MISSING_USERID] = 'MISSING_USERID';
        errorNames[RET_CODES.SERVER_ERROR] = 'SERVER_ERROR';

        // Lookup errorDefine for official description
        var errorDesc = '';
        var ed = getErrorDefine(retCode);
        if (ed && ed.errorDescription) {
            errorDesc = ed.errorDescription;
        }

        return {
            error: errorNames[retCode] || 'UNKNOWN',
            errorCode: retCode,
            errorMessage: errorDesc || (errorNames[retCode] || 'Unknown error'),
            detail: detail || ''
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH D: SERVER METADATA
    // ═══════════════════════════════════════════════════════════
    //
    //  Server-wide metadata yang PERSISTEN — bukan di-generate tiap login.
    //  Disimpan di IndexedDB key: server:meta
    //
    //  Fields:
    //    _serverOpenDate — Unix timestamp (ms) saat server pertama kali setup.
    //      Client L96134: setServerOpenDate(e). Digunakan:
    //        - L93040: VIP unlock setelah N hari (constant.stageVIPShowTime)
    //        - L126027: Temple privilege unlock (constant.templeTestVIPShowTime)
    //        - L132595: New server friend features
    //        - L242007: Team dungeon task unlock
    //    _serverVersion — version string. Client L96070: display di settings UI.
    //      NO version comparison logic di client — purely informational.
    //    _currency — currency code. Client L114795: ts.currency = e.currency.
    //      Used untuk IAP formatting via currencyDisplay.json.
    //    _maintenance — boolean. Jika true, semua enterGame ditolak dengan ret=2.
    //    _bannedUsers — object: { userId: true } for banned accounts.
    //    _broadcastQueue — array: server-wide broadcast messages.
    //    _onlineBulletins — array: server-wide online bulletins.

    var SERVER_META_KEY = 'server:meta';

    function getServerMeta() {
        var meta = db._get(SERVER_META_KEY);
        if (meta) return meta;

        // First time — initialize defaults
        var c = getConstant();
        meta = {
            _serverOpenDate: Date.now(),
            _serverVersion: '1.0.0',
            _currency: 'USD',
            _maintenance: false,
            _bannedUsers: {},       // { userId: true } — banned accounts
            _broadcastQueue: [],     // server-wide broadcast messages
            _onlineBulletins: []    // server-wide online bulletins
        };
        db._set(SERVER_META_KEY, meta);
        log.debug('META', 'Server metadata initialized — serverOpenDate: ' + new Date(meta._serverOpenDate).toISOString());
        return meta;
    }

    function updateServerMeta(updates) {
        var meta = getServerMeta();
        for (var key in updates) {
            if (updates.hasOwnProperty(key)) {
                meta[key] = updates[key];
            }
        }
        db._set(SERVER_META_KEY, meta);
        return meta;
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH E: HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * generateRetrieveDay(date) — Generate "retrieve day" string.
     *
     * Replicates client L83699: ToolCommon.generateRetrieveDay().
     * Hours before 6:00 AM belong to the PREVIOUS day.
     * This is the CORRECT daily boundary for resetTime: "6:00:00".
     *
     * Used for:
     *   - Daily reset boundary (scheduleInfo)
     *   - Checkin day tracking
     *   - Red-dot display checks on client
     *
     * @param {Date} date — JavaScript Date object
     * @returns {string} "YYYY-M-D" formatted date string
     *
     * Evidence: L83699
     *   e.generateRetrieveDay = function(e) {
     *       var t = e.getHours();
     *       return 6 > t && (e = new Date(e.valueOf() - 86400000)),
     *              e.getFullYear() + '-' + (e.getMonth() + 1) + '-' + e.getDate();
     *   }
     */
    function generateRetrieveDay(date) {
        // Convert to UTC+8 (CST) to match original game server behavior.
        // Original game ran in China timezone — 6:00 AM boundary = 6:00 AM CST.
        // Server may run in UTC (Docker default), causing wrong day boundaries
        // for users in other timezones (e.g. UTC+7 Jakarta).
        // Formula: UTC ms + timezoneOffset (to get UTC) + 8h (to get CST)
        var utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
        var cstMs = utcMs + (8 * 3600000);
        var cstHour = Math.floor((cstMs % 86400000) / 3600000);
        if (cstHour < 6) {
            cstMs -= 86400000;
        }
        var adjusted = new Date(cstMs);
        return adjusted.getUTCFullYear() + '-' + (adjusted.getUTCMonth() + 1) + '-' + adjusted.getUTCDate();
    }

    /**
     * computeUserLevel(savedData) — Extract user level from totalProps.
     *
     * Client L96315: getUserLevel() → getItemNum(PLAYERLEVELID).
     * Client L114456: reportToLoginEnterInfo reads getUserLevel().
     * L114917: a == PLAYERLEVELID → setLastUserLevel(r).
     *
     * The PLAYERLEVELID item (_id: 104) in totalProps._items stores the
     * user's current level. This is used by reportToLoginEnterInfo to send
     * userLevel to the login server.
     *
     * @param {object} savedData — full user data
     * @returns {number} user level (default 1 if not found)
     */
    function computeUserLevel(savedData) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 1;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (items[i]._id === ITEM_IDS.PLAYERLEVELID) {
                return Number(items[i]._num) || 1;
            }
        }
        return 1;
    }

    /**
     * findItemById(savedData, itemId) — Find item in totalProps._items by ID.
     *
     * Client setBackpack L114913-114920 iterates totalProps._items.
     * For each item, checks _id against PLAYERLEVELID (104).
     *
     * @param {object} savedData — full user data
     * @param {number} itemId — item ID to find
     * @returns {object|null} item object {_id, _num} or null
     */
    function findItemById(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return null;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (items[i]._id === itemId) {
                return items[i];
            }
        }
        return null;
    }

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

    /**
     * repairOnlineGiftTimer(savedData) — Fix _onlineGift._nextTime setelah deepMerge.
     *
     * PROBLEM: deepMerge saved vs defaults untuk _onlineGift:
     *   saved._onlineGift = { _curId: 0, _nextTime: 0 }  (dari data lama / corrupt)
     *   defaults._onlineGift = { _curId: 0, _nextTime: <computed_ms> }
     *   deepMerge recurse ke dalam _onlineGift, lalu untuk _nextTime:
     *     typeof 0 !== 'object' → else branch: result[key] = sv → saved 0 MENANG!
     *   Akibat: _nextTime tetap 0 → timer home screen stuck 0:00 selamanya.
     *
     * DETEKSI: _nextTime dianggap corrupted jika:
     *   1. _nextTime = 0 tapi curId bukan tier terakhir (belum di-init / deepMerge)
     *   2. _nextTime = NaN atau negatif
     *   3. _nextTime > 48 jam di masa depan (max tier = 12 jam, corrupted misal 1000x)
     *
     * FIX: Setelah deepMerge, cek _onlineGift._nextTime.
     *   Jika corrupted → compute ulang dari onlineBonus.json berdasarkan _curId.
     *
     * Di-call untuk SEMUA user (new dan returning), setelah deepMerge.
     * Untuk new user, buildNewUserResponse sudah compute _nextTime dengan benar
     *   tapi repair ini juga aman di-call (akan skip karena _nextTime valid).
     *
     * CATATAN: (now + firstTierTime) * 1000 itu BENAR.
     *   now = db.nowSeconds() = detik, firstTierTime = detik,
     *   *1000 = konversi ke ms. Hasilnya ms timestamp yang valid.
     *   Analisis sebelumnya yang bilang "1000x terlalu besar" adalah SALAH.
     *
     * @param {object} savedData — the response object (will be mutated in-place)
     */

    /**
     * recoverGuildDataForEnterGame(savedData, userId) — 🔴🔴🔴 CRITICAL GUILD RECOVERY!
     * 
     * ════════════════════════════════════════════════════════════════
     * PROBLEM:
     *   User create guild → data tersimpan di IndexedDB (user:*, guild:list)
     *   Saat relogin, enterGame return userGuild/userGuildPub dengan _guildId: ''
     *   Client: setTeamInfoModel('') → user KELUAR GUILD!
     * 
     * SOLUTION:
     *   Baca guild data user dari DB → populate response fields yang client expect!
     * 
     * 📖 CLIENT CODE (main.min.js):
     * ─────────────────────────────────────────────────────────────
     * L114933-114938 (setTeam):
     *   e.userGuild && t.setUserTeamInfoModel(e.userGuild)      ← WAJIB!
     *   e.userGuildPub && t.setUserTeamInfoModel(e.userGuildPub)
     *   void 0 != e.guildLevel && t.setMyTeamLevel(e.guildLevel)
     * 
     * L114795 (saveUserData):
     *   e.guildName && TeamInfoManager.getInstance().setTeamName(e.guildName)
     * 
     * L114838:
     *   e.guildActivePoints && TeamInfoManager.getInstance().setActivePoints(...)
     * 
     * @param {object} savedData — enterGame response (will be MUTATED!)
     * @param {string} userId — user ID
     */
    function recoverGuildDataForEnterGame(savedData, userId) {
        // Cek apakah user punya data guild di savedData
        var userGuildData = savedData.guild;
        if (!userGuildData || !userGuildData._guildId) {
            log.debug('GUILD_RECOVERY', 'User not in any guild — skipping recovery');
            return; // User tidak ada di guild, biarkan default kosong
        }

        var guildId = userGuildData._guildId;
        log.debug('GUILD_RECOVERY', '🔍 User IS in guild: ' + guildId);
        log.details('userGuildData', [
            ['_guildId', guildId],
            ['_isCaptain', userGuildData._isCaptain ? 'YES' : 'NO'],
            ['_guildName', userGuildData._guildName || '(empty)']
        ]);

        // Baca guild info lengkap dari guild:list
        var GUILD_LIST_KEY = 'guild:list';
        var guildList = db._get(GUILD_LIST_KEY);
        var guildInfo = null;

        if (guildList && guildList[guildId]) {
            guildInfo = guildList[guildId];
            log.debug('GUILD_RECOVERY', '✅ Found guild in guild:list: ' + (guildInfo._name || '?'));
        } else {
            log.warn('GUILD_RECOVERY', '⚠️ Guild NOT found in guild:list: ' + guildId);
            // Tetap lanjutkan pakai data dari userGuildData saja
        }

        // ════════════════════════════════════════════════════════════════
        // POPULATE userGuild (L114933: setUserTeamInfoModel)
        // ════════════════════════════════════════════════════════════════
        
        if (!savedData.userGuild) {
            savedData.userGuild = {};
        }

        // 🔴🔴🔴 FIELD PALING PENTING: _guildId!
        savedData.userGuild._guildId = guildId;

        // Fields dari userGuildData (disimpan saat createGuild/joinGuild)
        if (userGuildData._requestedGuild) {
            savedData.userGuild._requestedGuild = userGuildData._requestedGuild;
        }
        if (typeof userGuildData._haveReadBulletin !== 'undefined') {
            savedData.userGuild._haveReadBulletin = userGuildData._haveReadBulletin;
        }
        if (userGuildData._canJoinGuildTime) {
            savedData.userGuild._canJoinGuildTime = userGuildData._canJoinGuildTime;
        }
        if (typeof userGuildData._createGuildCD !== 'undefined') {
            savedData.userGuild._createGuildCD = userGuildData._createGuildCD;
        }
        if (typeof userGuildData._isCaptain !== 'undefined') {
            savedData.userGuild._isCaptain = userGuildData._isCaptain;
        }
        if (userGuildData._joinTime) {
            savedData.userGuild._joinTime = userGuildData._joinTime;
        }

        // Tech tree (default empty obj kalau tidak ada)
        if (guildInfo && guildInfo._tech) {
            savedData.userGuild._tech = guildInfo._tech;
        } else if (!savedData.userGuild._tech) {
            savedData.userGuild._tech = {};
        }

        // Satan gift default
        if (!savedData.userGuild._satanGift) {
            savedData.userGuild._satanGift = { _exp: 0, _level: 1, _canRewardTime: {} };
        }

        // Ball war participation
        if (typeof userGuildData._ballWarJoin !== 'undefined') {
            savedData.userGuild._ballWarJoin = userGuildData._ballWarJoin;
        }

        // Click system
        if (userGuildData._clickSys) {
            savedData.userGuild._clickSys = userGuildData._clickSys;
        }

        // Check-in type
        if (userGuildData._checkInType) {
            savedData.userGuild._checkInType = userGuildData._checkInType;
        }

        // ════════════════════════════════════════════════════════════════
        // POPULATE userGuildPub (mirror untuk publik info)
        // ════════════════════════════════════════════════════════════════

        if (!savedData.userGuildPub) {
            savedData.userGuildPub = {};
        }

        savedData.userGuildPub._guildId = guildId;
        savedData.userGuildPub._requestedGuild = savedData.userGuild._requestedGuild || [];
        savedData.userGuildPub._haveReadBulletin = savedData.userGuild._haveReadBulletin || false;
        savedData.userGuildPub._canJoinGuildTime = savedData.userGuild._canJoinGuildTime || 0;
        savedData.userGuildPub._createGuildCD = savedData.userGuild._createGuildCD || false;
        savedData.userGuildPub._ballWarJoin = savedData.userGuild._ballWarJoin || false;
        savedData.userGuildPub._clickSys = savedData.userGuild._clickSys || {};
        savedData.userGuildPub._checkInType = savedData.userGuild._checkInType || 0;
        savedData.userGuildPub._tech = savedData.userGuild._tech || {};

        // ════════════════════════════════════════════════════════════════
        // POPULATE GUILD-LEVEL FIELDS (dari guildInfo)
        // ════════════════════════════════════════════════════════════════

        if (guildInfo) {
            // 📖 L114795: e.guildName && setTeamName(e.guildName)
            if (guildInfo._name) {
                savedData.guildName = guildInfo._name;
                log.debug('GUILD_RECOVERY', '✅ guildName = ' + guildInfo._name);
            }

            // 📖 L114937: void 0 != e.guildLevel && setMyTeamLevel(e.guildLevel)
            if (typeof guildInfo._level !== 'undefined' && guildInfo._level !== null) {
                savedData.guildLevel = guildInfo._level;
                log.debug('GUILD_RECOVERY', '✅ guildLevel = ' + guildInfo._level);
            }

            // Active points (dari guildInfo atau default)
            if (guildInfo._activePoints || guildInfo._activePoint) {
                savedData.guildActivePoints = guildInfo._activePoints || guildInfo._activePoint;
                log.debug('GUILD_RECOVERY', '✅ guildActivePoints set');
            }

            // Treasure match ret (jika ada)
            if (typeof guildInfo._guildTreasureMatchRet !== 'undefined') {
                savedData.guildTreasureMatchRet = guildInfo._guildTreasureMatchRet;
            }
        } else {
            // Fallback ke userGuildData kalau guildInfo tidak ada di DB
            if (userGuildData._guildName) {
                savedData.guildName = userGuildData._guildName;
                log.debug('GUILD_RECOVERY', '✅ guildName (from userData) = ' + userGuildData._guildName);
            }
        }

        // ════════════════════════════════════════════════════════════════
        // LOG VERIFICATION
        // ════════════════════════════════════════════════════════════════

        log.info('GUILD_RECOVERY', '🎉 GUILD DATA RECOVERED FOR ENTERGAME!');
        log.details('recoveredFields', [
            ['userGuild._guildId', savedData.userGuild._guildId || '(MISSING!)'],
            ['userGuildPub._guildId', savedData.userGuildPub._guildId || '(MISSING!)'],
            ['guildName', savedData.guildName || '(empty)'],
            ['guildLevel', String(savedData.guildLevel || 0)],
            ['guildActivePoints', savedData.guildActivePoints ? 'SET' : '(empty)']
        ]);
    }

    function repairOnlineGiftTimer(savedData) {
        if (!savedData.giftInfo || !savedData.giftInfo._onlineGift) return;

        var ol = savedData.giftInfo._onlineGift;
        var curId = Number(ol._curId) || 0;
        var nextTime = Number(ol._nextTime) || 0;
        var nowMs = Date.now();

        // ── Sanity check: deteksi _nextTime yang corrupted ──
        // Valid range: 0 (claimable/habis) atau nowMs s/d nowMs + 48 jam
        // Max tier waktu = 43200 detik (12 jam). 48 jam = margin aman.
        var MAX_FUTURE_MS = 48 * 3600 * 1000; // 172800000 ms
        var needRepair = false;
        var repairReason = '';

        if (nextTime === 0) {
            // _nextTime = 0 → perlu cek apakah memang 0 (tier terakhir) atau belum di-init
            // Jika curId bukan tier terakhir dan _nextTime = 0 → repair
            var bonusTable = getOnlineBonus();
            if (bonusTable) {
                if (curId === 0) {
                    needRepair = true;
                    repairReason = 'curId=0, _nextTime=0 (uninitialized)';
                } else {
                    var curTier = bonusTable[String(curId)];
                    if (curTier && curTier.nextID) {
                        needRepair = true;
                        repairReason = 'curId=' + curId + ' has nextID but _nextTime=0';
                    }
                    // else: curId is last tier, _nextTime=0 is correct
                }
            } else {
                // Config not found — if _nextTime=0 and curId=0, repair with default
                if (curId === 0) {
                    needRepair = true;
                    repairReason = 'config not found, curId=0, _nextTime=0';
                }
            }
        } else if (isNaN(nextTime) || nextTime < 0) {
            needRepair = true;
            repairReason = 'invalid value: ' + ol._nextTime;
        } else if (nextTime - nowMs > MAX_FUTURE_MS) {
            // _nextTime > 48 jam di masa depan → corrupted (misal 1000x too large)
            needRepair = true;
            repairReason = 'too far in future: ' + Math.ceil((nextTime - nowMs) / 3600000) + 'h (max 48h)';
        }

        if (!needRepair) return;

        log.warn('REPAIR', 'onlineGift._nextTime CORRUPTED — ' + repairReason + ' (old=' + ol._nextTime + ')');

        // ── Compute correct _nextTime ──
        var bonusTable = getOnlineBonus();
        if (!bonusTable) {
            ol._nextTime = nowMs + (300 * 1000);
            log.debug('REPAIR', 'onlineGift._nextTime: config not found, default 300s → ' + ol._nextTime);
            return;
        }

        if (curId === 0) {
            var tier1 = bonusTable['1'];
            if (tier1) {
                var tierTime = Number(tier1.time) || 300;
                ol._nextTime = nowMs + (tierTime * 1000);
                log.debug('REPAIR', 'onlineGift._nextTime: curId=0 → now+' + tierTime + 's = ' + ol._nextTime);
            }
        } else {
            var curTier = bonusTable[String(curId)];
            if (curTier && curTier.nextID) {
                var nextTier = bonusTable[String(curTier.nextID)];
                if (nextTier) {
                    var nextTimeSec = Number(nextTier.time) || 300;
                    ol._nextTime = nowMs + (nextTimeSec * 1000);
                    log.debug('REPAIR', 'onlineGift._nextTime: curId=' + curId + ' nextID=' +
                        curTier.nextID + ' → now+' + nextTimeSec + 's = ' + ol._nextTime);
                }
            } else {
                ol._nextTime = 0;
                log.debug('REPAIR', 'onlineGift._nextTime: curId=' + curId + ' is last tier, keeping 0');
            }
        }
    }

    /**
     * normalizeResponseData(savedData) — Fix nested fields that deepMerge misses.
     *
     * PROBLEM: deepMerge preserves saved objects as-is. If a saved object
     * is missing inner fields that the client reads with .length (no guard),
     * the client crashes: "Cannot read properties of undefined (reading 'length')".
     *
     * EXAMPLE: equip._suits["1205"] has { _suitItems: [...] } but is missing
     * _suitAttrs and _equipAttrs. Client SetEquipDataToModel (L82843) does
     * e._suitAttrs.length → crash.
     *
     * This function normalizes ALL such fields after deepMerge.
     * Called for BOTH new and returning users (safe — only fills missing).
     *
     * @param {object} data — the response object (will be mutated in-place)
     */
    function normalizeResponseData(data) {
        var fixCount = 0;

        // ── 1. equip._suits — normalize each suit object ──
        // Client L82840-82860: SetEquipDataToModel reads:
        //   e._suitItems (array), e._suitAttrs (array), e._equipAttrs (array),
        //   e._earrings (object), e._weaponState (number)
        // All accessed with .length — MUST be arrays.
        if (data.equip && data.equip._suits && typeof data.equip._suits === 'object') {
            for (var suitId in data.equip._suits) {
                if (!data.equip._suits.hasOwnProperty(suitId)) continue;
                var suit = data.equip._suits[suitId];
                if (!suit || typeof suit !== 'object') {
                    data.equip._suits[suitId] = {
                        _suitItems: [], _suitAttrs: [], _equipAttrs: [],
                        _earrings: {}, _weaponState: 0
                    };
                    fixCount++;
                    continue;
                }
                if (!Array.isArray(suit._suitItems)) {
                    suit._suitItems = [];
                    fixCount++;
                }
                if (!Array.isArray(suit._suitAttrs)) {
                    suit._suitAttrs = [];
                    fixCount++;
                }
                if (!Array.isArray(suit._equipAttrs)) {
                    suit._equipAttrs = [];
                    fixCount++;
                }
                // _earrings is read via .deserialize (for-in, safe) — but ensure it's object
                if (!suit._earrings || typeof suit._earrings !== 'object') {
                    suit._earrings = {};
                    fixCount++;
                }
                // _weaponState — number, client does direct assign (safe) — but ensure it exists
                if (suit._weaponState === undefined || suit._weaponState === null) {
                    suit._weaponState = 0;
                }
            }
        }

        // ── 2. timeTrial._gotStarReward — should be object (for-in iteration) ──
        // Client L95xxx: iterates with for-in — object is correct, not array.
        // (Audit flagged this as expecting array, but it's actually fine as object.)
        // No fix needed — just ensuring it exists.
        if (data.timeTrial && data.timeTrial._gotStarReward === undefined) {
            data.timeTrial._gotStarReward = {};
        }

        if (fixCount > 0) {
            log.warn('NORMALIZE', 'Fixed ' + fixCount + ' missing nested field(s) in response data');
        }
    }

    /**
     * cleanNullFromItemsArrays(data) — Remove null/undefined entries from ALL _items arrays.
     *
     * ROOT CAUSE of "Cannot read properties of null (reading '_id')":
     *   Client HeroCostModel.deserialize (L5335:29242) iterates _items with for-in:
     *     a.id = n._items[o]._id  →  crashes if n._items[o] is null
     *   This happens in _totalCost._levelUp._items, _earring._items, etc.
     *
     * WHY nulls exist:
     *   deepMerge returns saved arrays as-is (line 2014). If saved data in
     *   IndexedDB has _items: [null, null, ...] (corrupted from a previous
     *   crash session), deepMerge preserves them. Client then crashes.
     *
     * FIX: Recursively walk response data, filter nulls from any _items array.
     * Client ALWAYS expects _items entries to be objects with _id + _num.
     * Null entries are NEVER valid in _items arrays.
     *
     * @param {object} data — the response object (mutated in-place)
     * @returns {number} count of cleaned arrays
     */
    function cleanNullFromItemsArrays(data) {
        var cleanCount = 0;

        function walk(obj) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                // Walk array elements (don't clean non-_items arrays)
                for (var i = 0; i < obj.length; i++) {
                    if (obj[i] && typeof obj[i] === 'object') walk(obj[i]);
                }
                return;
            }
            for (var key in obj) {
                if (!obj.hasOwnProperty(key)) continue;
                var val = obj[key];
                if (key === '_items' && Array.isArray(val)) {
                    var hasNull = false;
                    for (var j = 0; j < val.length; j++) {
                        if (val[j] === null || val[j] === undefined) { hasNull = true; break; }
                    }
                    if (hasNull) {
                        var cleaned = [];
                        for (var k = 0; k < val.length; k++) {
                            if (val[k] !== null && val[k] !== undefined) cleaned.push(val[k]);
                        }
                        obj[key] = cleaned;
                        cleanCount++;
                    }
                    // Walk cleaned items for nested _items
                    for (var m = 0; m < obj[key].length; m++) {
                        if (obj[key][m] && typeof obj[key][m] === 'object') walk(obj[key][m]);
                    }
                } else if (val && typeof val === 'object') {
                    walk(val);
                }
            }
        }

        walk(data);
        return cleanCount;
    }

    /**
     * logAuditField(data, groupLabel, fieldDefs) — Audit response fields for integrity.
     *
     * Checks each field defined in fieldDefs against the actual data.
     * Logs WARNING for any undefined/null/mismatched fields.
     * Logs OK for all valid fields (collapsed into one line).
     *
     * Used before callback(savedData) to detect the source of:
     *   "Cannot read properties of undefined (reading 'length')"
     *
     * @param {object} data — the response object
     * @param {string} groupLabel — descriptive label for this audit group
     * @param {Array} fieldDefs — array of field definitions:
     *   { path: 'dot.path', expect: 'array'|'object', deepAudit: string|true }
     */
    function logAuditField(data, groupLabel, fieldDefs) {
        var warnings = [];
        var okList = [];

        for (var i = 0; i < fieldDefs.length; i++) {
            var def = fieldDefs[i];
            var parts = def.path.split('.');
            var val = data;

            // Navigate the dot-path
            for (var p = 0; p < parts.length; p++) {
                if (val === undefined || val === null) break;
                val = val[parts[p]];
            }

            var actualType = val === undefined ? 'UNDEFINED' :
                             val === null ? 'NULL' :
                             Array.isArray(val) ? 'array(' + val.length + ')' :
                             typeof val;

            var isOk = true;

            if (val === undefined || val === null) {
                isOk = false;
                warnings.push('  ⚠️  ' + def.path + ' = ' + actualType +
                    ' (expected: ' + def.expect + ')');
            } else if (def.expect === 'array' && !Array.isArray(val)) {
                isOk = false;
                warnings.push('  ⚠️  ' + def.path + ' = ' + actualType +
                    ' (expected: array, client may crash on .length!)');
            } else if (def.expect === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
                isOk = false;
                warnings.push('  ⚠️  ' + def.path + ' = ' + actualType +
                    ' (expected: object)');
            } else {
                okList.push(def.path + ':' + actualType);
            }

            // Deep audit: check nested arrays inside objects
            if (isOk && def.deepAudit && val && typeof val === 'object') {
                var auditKey = def.deepAudit === true ? null : def.deepAudit;

                if (auditKey) {
                    // Audit a specific nested key (e.g., equip._suits → check each suit's arrays)
                    var nestedObj = val[auditKey];
                    if (nestedObj === undefined || nestedObj === null) {
                        warnings.push('  ⚠️  ' + def.path + '.' + auditKey + ' = UNDEFINED');
                    } else if (typeof nestedObj === 'object' && !Array.isArray(nestedObj)) {
                        for (var nk in nestedObj) {
                            if (!nestedObj.hasOwnProperty(nk)) continue;
                            var suit = nestedObj[nk];
                            // Check common array fields in suit objects
                            var suitArrays = ['_suitItems', '_suitAttrs', '_equipAttrs'];
                            for (var sa = 0; sa < suitArrays.length; sa++) {
                                var saKey = suitArrays[sa];
                                var saVal = suit ? suit[saKey] : undefined;
                                if (saVal === undefined || saVal === null) {
                                    warnings.push('  ⚠️  ' + def.path + '.' + auditKey +
                                        '["' + nk + '"].' + saKey + ' = ' +
                                        (saVal === undefined ? 'UNDEFINED' : 'NULL') +
                                        ' (client SetEquipDataToModel will crash on .length!)');
                                } else if (!Array.isArray(saVal)) {
                                    warnings.push('  ⚠️  ' + def.path + '.' + auditKey +
                                        '["' + nk + '"].' + saKey + ' = ' + typeof saVal +
                                        ' (expected array)');
                                }
                            }
                        }
                    }
                } else {
                    // auditKey === true → audit all values in the object (e.g., _bet)
                    for (var bk in val) {
                        if (!val.hasOwnProperty(bk)) continue;
                        var betVal = val[bk];
                        if (betVal === undefined || betVal === null) {
                            warnings.push('  ⚠️  ' + def.path + '["' + bk + '"] = ' +
                                (betVal === undefined ? 'UNDEFINED' : 'NULL') +
                                ' (client deserialize will crash on .length!)');
                        } else if (!Array.isArray(betVal)) {
                            warnings.push('  ⚠️  ' + def.path + '["' + bk + '"] = ' + typeof betVal +
                                ' (expected array, client reads .length)');
                        }
                    }
                }
            }
        }

        // Log problems only — silent when all OK
        if (warnings.length > 0) {
            log.warn('NORMALIZE', groupLabel + ' — ' + warnings.length + ' problem(s)');
            for (var w = 0; w < warnings.length; w++) {
                log.warn('NORMALIZE', warnings[w]);
            }
        }
    }

    /**
     * makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel)
     * — Compute base hero attribute values from config.
     *
     * Replicates client HeroAttributeCommon.makeHeroBasicAttr (L115999-116073).
     * This computes the RAW base stats that go into _heroBaseAttr.
     *
     * IMPORTANT: getAttrs handler computes FULL stats (including equipment,
     * potential, qigong, earring, gems). This function only computes
     * the BASE from level/quality/type/evolve/wakeUp.
     *
     * Formula for scaling stats (L116073):
     *   hp = (heroLevelAttr.hp × heroTypeParam.hpParam + heroTypeParam.hpBais)
     *         × heroQualityParam.hpParam × heroInfo.balanceHp
     *   attack = (heroLevelAttr.attack × heroTypeParam.attackParam + heroTypeParam.attackBais)
     *            × heroQualityParam.attackParam × heroInfo.balanceAttack
     *   armor = (heroLevelAttr.armor × heroTypeParam.armorParam + heroTypeParam.armorBais)
     *           × heroQualityParam.armorParam × heroInfo.balanceArmor
     *
     * Flat stats from heroInfo (NO scaling):
     *   speed, hit, dodge, block, damageReduce, armorBreak, controlResist,
     *   skillDamage, criticalDamage, blockEffect, critical, criticalResist,
     *   trueDamage, healPlus, healerPlus, talent
     *
     * Evolve bonuses (L116001-116010):
     *   For each evolve entry where evolveLevel >= entry.level:
     *     hp += entry.hp, attack += entry.attack, armor += entry.armor, speed += entry.speed
     *
     * WakeUp/Star bonuses (L116012-116031):
     *   For each wakeUp entry where starLevel >= entry.star:
     *     talent += entry.talent, hp += entry.hp, attack += entry.attack,
     *     armor += entry.armor, speed += entry.speed
     *
     * Talent multiplication (L133840-133849 setBaseAttr):
     *   FINAL hp = rawHp × talent
     *   FINAL attack = rawAttack × talent
     *   armor and speed are NOT talent-multiplied.
     *
     * @param {string|number} heroDisplayId — hero display ID (e.g., 1205)
     * @param {number} level — hero level (e.g., 3)
     * @param {number} evolveLevel — evolve level (0 = no evolve)
     * @param {number} starLevel — star/wakeUp level (0 = no star)
     * @returns {object} base attr dict with all stat values
     */
    function makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.warn('HERO_ATTR', 'Hero config not found for: ' + heroDisplayId + ' — returning zeros');
            return {
                _level: level, _talent: 0, _exp: 0, _evolveLevel: evolveLevel,
                _hp: 0, _attack: 0, _armor: 0, _speed: 0, _hit: 0, _dodge: 0,
                _block: 0, _damageReduce: 0, _armorBreak: 0, _controlResist: 0,
                _skillDamage: 0, _criticalDamage: 0, _blockEffect: 0,
                _critical: 0, _criticalResist: 0, _trueDamage: 0, _energy: 50,
                _power: 0, _extraArmor: 0, _hpPercent: 0, _armorPercent: 0,
                _attackPercent: 0, _speedPercent: 0, _orghp: 0, _superDamage: 0,
                _healPlus: 0, _healerPlus: 0, _damageDown: 0, _shielderPlus: 0,
                _damageUp: 0
            };
        }

        var quality = hc.quality || 'purple';
        var heroType = hc.heroType || 'critical';

        // Load configs
        var la = getHeroLevelAttr(level) || {};    // {hp, attack, armor}
        var qp = getHeroQualityParam(quality) || {}; // {hpParam:1, attackParam:1, armorParam:1}
        var tp = getHeroTypeParam(heroType) || {};   // {hpParam, hpBais, attackParam, attackBais, ...}
        var evEntries = getHeroEvolve(heroDisplayId) || [];
        var wuEntries = getHeroWakeUp(heroDisplayId) || [];

        // Start with all zeros
        var d = {
            _hp: 0, _attack: 0, _armor: 0, _speed: 0,
            _hit: 0, _dodge: 0, _block: 0, _damageReduce: 0, _armorBreak: 0,
            _controlResist: 0, _skillDamage: 0, _criticalDamage: 0, _blockEffect: 0,
            _critical: 0, _criticalResist: 0, _trueDamage: 0, _energy: 50,
            _power: 0, _extraArmor: 0, _hpPercent: 0, _armorPercent: 0,
            _attackPercent: 0, _speedPercent: 0, _orghp: 0, _superDamage: 0,
            _healPlus: 0, _healerPlus: 0, _damageDown: 0, _shielderPlus: 0,
            _damageUp: 0, _talent: Number(hc.talent) || 0
        };

        // STEP 1: Evolve bonuses (L116001-116010)
        // For each evolve entry where evolveLevel >= entry.level
        var evList = Array.isArray(evEntries) ? evEntries : [];
        for (var ei = 0; ei < evList.length; ei++) {
            var ev = evList[ei];
            if (evolveLevel >= (ev.level || 0)) {
                d._hp += Number(ev.hp) || 0;
                d._attack += Number(ev.attack) || 0;
                d._armor += Number(ev.armor) || 0;
                d._speed += Number(ev.speed) || 0;
            }
        }

        // STEP 2: WakeUp/Star bonuses (L116012-116031)
        var wuList = Array.isArray(wuEntries) ? wuEntries : [];
        for (var wi = 0; wi < wuList.length; wi++) {
            var wu = wuList[wi];
            if (starLevel >= (wu.star || 0)) {
                d._talent += Number(wu.talent) || 0;
                d._hp += Number(wu.hp) || 0;
                d._attack += Number(wu.attack) || 0;
                d._armor += Number(wu.armor) || 0;
                d._speed += Number(wu.speed) || 0;
            }
        }

        // STEP 3: Base stats from level × type × quality × balance (L116073)
        // hp = (heroLevelAttr.hp × typeParam.hpParam + typeParam.hpBais) × qualityParam.hpParam × balanceHp
        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        d._hp += baseHp;

        // attack = (heroLevelAttr.attack × typeParam.attackParam + typeParam.attackBais) × qualityParam.attackParam × balanceAttack
        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        d._attack += baseAtk;

        // armor = (heroLevelAttr.armor × typeParam.armorParam + typeParam.armorBais) × qualityParam.armorParam × balanceArmor
        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        d._armor += baseArm;

        // STEP 4: Flat stats from heroInfo (NO scaling)
        d._speed += Number(hc.speed) || 0;
        d._hit += Number(hc.hit) || 0;
        d._dodge += Number(hc.dodge) || 0;
        d._block += Number(hc.block) || 0;
        d._damageReduce += Number(hc.damageReduce) || 0;
        d._armorBreak += Number(hc.armorBreak) || 0;
        d._controlResist += Number(hc.controlResist) || 0;
        d._skillDamage += Number(hc.skillDamage) || 0;
        d._criticalDamage += Number(hc.criticalDamage) || 0;
        d._blockEffect += Number(hc.blockEffect) || 0;
        d._critical += Number(hc.critical) || 0;
        d._criticalResist += Number(hc.criticalResist) || 0;
        d._trueDamage += Number(hc.trueDamage) || 0;
        d._healPlus += Number(hc.healPlus) || 0;
        d._healerPlus += Number(hc.healerPlus) || 0;

        // STEP 5: Talent — stored as-is, NOT multiplied here.
        //
        // WHY NO MULTIPLICATION: Client makeHeroBasicAttr (L116073) adds
        // talent as a plain stat field without multiplying hp/attack.
        // Talent multiplication happens LATER in setBaseAttr (L133847-133848)
        // which is called from getAttrs handler, NOT from enterGame.
        //
        // Client flow:
        //   enterGame → deserialize(heroBaseAttr) → stores raw values
        //   getAttrs  → setBaseAttr(_baseAttr) → hp *= talent, attack *= talent
        //
        // Evidence: L116073 shows `addHeroAttr(d, talent, i.talent)` — just stores
        //   the value, no multiplication. L133847 shows `hp = hp * talent` — only
        //   in setBaseAttr which is called from getAttrs, not enterGame.
        //
        // NOTE: _orghp is NOT part of makeHeroBasicAttr formula. Client
        //   computes it separately. Set to 0 here; getAttrs will populate it.

        d._orghp = 0;

        // Set metadata fields
        d._level = level;
        d._exp = 0;
        d._evolveLevel = evolveLevel;
        d._energy = Number(hc.energyMax) || 100;

        log.details('HERO_ATTR', [
            ['heroId', String(heroDisplayId)],
            ['level', String(level)],
            ['quality', quality],
            ['heroType', heroType],
            ['talent', String(d._talent)],
            ['hp', String(Math.round(d._hp))],
            ['attack', String(Math.round(d._attack))],
            ['armor', String(Math.round(d._armor))],
            ['speed', String(Math.round(d._speed))]
        ]);

        return d;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD RESPONSE — buildNewUserResponse
    // ═══════════════════════════════════════════════════════════
    //
    //  Membangun FULL default response untuk new user.
    //  Setiap field punya evidence reference ke main.min(unminfy).js.
    //
    //  Field classification:
    //    ✅ = unconditional read (client crash kalau undefined)
    //    ⚠️ = guarded read (client skip kalau undefined, safe)
    //    🔒 = internal server use (tidak dikirim ke client langsung)
    //
    //  TOTAL fields: 100+ top-level fields
    //  UNCONDITIONAL (must send): ~22 fields
    //  GUARDED (safe to omit): ~75 fields

    function buildNewUserResponse(request) {
        var c = getConstant();
        var startHeroId = c ? String(c.startHero) : '1205';
        var startHeroLevel = c ? Number(c.startHeroLevel) : 3;
        var hc = getHeroConfig(startHeroId);
        var startUserLevel = c ? Number(c.startUserLevel) : 1;
        var startUserExp = c ? Number(c.startUserExp) : 0;
        var meta = getServerMeta();
        var now = db.nowSeconds();
        var r = {};

        // ── Top-level flags & metadata ──

        r.newUser = true;  // ✅ L114524: if (e.newUser) → SDK reports
        r.currency = meta._currency;  // ✅ L114795: ts.currency = e.currency (NO guard)
        r.serverVersion = meta._serverVersion;  // ⚠️ L114823: guarded, display in settings
        r.serverOpenDate = meta._serverOpenDate;  // ⚠️ L114823: guarded, VIP/temple/friend/dungeon gates
        r.serverId = request.serverId || 1;  // ✅ L114823: setServerId (internally guarded)

        // ── User info ──
        // L114874-114885: setUserInfo(e) reads e.user._id,._pwd,._nickName,
        //   ._headImage,._lastLoginTime,._createTime,._bulletinVersions,._oriServerId
        // L114884: _nickChangeTimes → guarded (void check)
        // L114456: reportToLoginEnterInfo reads createTime + getUserLevel()

        r.user = {
            _id: request.userId,  // ✅ L114876: t.userId = n._id
            _pwd: '',  // ✅ L114877: t.userPassward = n._pwd
            _nickName: 'New User' + Math.floor(10000 + Math.random() * 90000),  // ✅ L114878
            _headImage: (c && c.playerIcon) ? c.playerIcon : 'hero_icon_1205',  // ✅ L114879
            _lastLoginTime: now,  // ✅ L114880: seconds — server internal (checkDailyReset L1710, hangup L1878). Client reads tapi TIDAK pakai new Date().
            _createTime: Date.now(),  // ✅ L114881: ms — client L52466: createTime/1e3 → HARUS ms
            _bulletinVersions: {},  // ✅ L114882: t.bulletinVersions
            _oriServerId: request.serverId || 1,  // ✅ L114883: setOriServerId
            _nickChangeTimes: 0  // ⚠️ L114884: guarded
        };

        // ── On-hook (AFK/idle) system ──
        // L114886-114900: setOnHook(e) reads e.hangup + e.globalWarBuffTag/LastRank/Buff/BuffEndTime
        // All UNCONDITIONAL — setOnHook selalu dipanggil (L114795 passes e.hangup)

        r.hangup = {
            _curLess: (c && c.startLesson) ? Number(c.startLesson) : 10101,  // ✅ L114888
            _maxPassLesson: (c && c.startLesson) ? Number(c.startLesson) : 0,  // ✅ L114889 — FIX: new user must start 0, not 10101
            _haveGotChapterReward: {},  // ✅ L114891
            _maxPassChapter: (c && c.startChapter) ? c.startChapter : 801,  // ✅ L114892
            _clickGlobalWarBuffTag: '',  // ✅ L114893
            _buyFund: false,  // ✅ L114898
            _haveGotFundReward: {},  // ✅ L114899
            _lastGainTime: Date.now()  // ✅ ms timestamp — dipakai gain.js untuk hitung elapsed
        };

        r.globalWarBuffTag = '';  // ✅ L114894
        r.globalWarLastRank = {};  // ✅ L114895
        r.globalWarBuff = 0;  // ✅ L114896
        r.globalWarBuffEndTime = 0;  // ✅ L114897

        // ── Summon system ──
        // L114901-114911: setSummon(e) reads e.summon — UNCONDITIONAL

        r.summon = {
            _energy: 50,  // ✅ L114903
            _wishList: [],  // ✅ L114904
            _wishVersion: 0,  // ✅ L114905
            _canCommonFreeTime: 0,  // ✅ L114906
            _canSuperFreeTime: 0,  // ✅ L114907
            _summonTimes: {}  // ✅ L114908-114911: iterasi for-in
        };

        // ── Inventory (totalProps) + Backpack ──
        // L114912-114921: setBackpack(e) reads e.totalProps._items[] + e.backpackLevel
        // L114917: a == PLAYERLEVELID → setLastUserLevel(r) ← CRITICAL
        // L116237: ALL item ID constants defined there
        // Client 100% server-driven: setItem(id, num) for EVERY item in array
        // getItemNum() returns 0 for missing items — but VIP Level (106) needed
        // for hero bag capacity (VIPBag[vipLevel].heroBagPlus)
        //
        // idleAwardFirst.json: Gold×1000, UserEXP×20, EXP Capsule×500
        // These are the default starting resources for new players.

        // Load idleAwardFirst config for default starting resources
        var idleFirstAwards = getIdleAwardFirst() || {};
        var idleFirstGold = 0, idleFirstExp = 0, idleFirstExpCapsule = 0;
        for (var afKey in idleFirstAwards) {
            if (!idleFirstAwards.hasOwnProperty(afKey)) continue;
            var af = idleFirstAwards[afKey];
            if (Number(af.award) === ITEM_IDS.GOLDID) idleFirstGold = Number(af.num) || 0;
            else if (Number(af.award) === ITEM_IDS.PLAYEREXPERIENCEID) idleFirstExp = Number(af.num) || 0;
            else if (Number(af.award) === ITEM_IDS.EXPERIENCECAPSULEID) idleFirstExpCapsule = Number(af.num) || 0;
        }

        var startDiamond = (c && c.startDiamond) ? Number(c.startDiamond) : 10;
        var startGold = (c && c.startGold) ? Number(c.startGold) : 0;

        r.totalProps = {
            _items: [
                // ── Currency ──
                { _id: ITEM_IDS.DIAMONDID, _num: startDiamond },
                { _id: ITEM_IDS.GOLDID, _num: startGold + idleFirstGold },

                // ── Player stats ──
                { _id: ITEM_IDS.PLAYEREXPERIENCEID, _num: startUserExp + idleFirstExp },
                { _id: ITEM_IDS.PLAYERLEVELID, _num: startUserLevel },

                // ── VIP system (L96244: getItemNum(PLAYERVIPLEVELID), L96366: VIPBag[vipLevel]) ──
                { _id: ITEM_IDS.PLAYERVIPEXPERIENCEID, _num: 0 },
                { _id: ITEM_IDS.PLAYERVIPLEVELID, _num: 0 },
                { _id: ITEM_IDS.PLAYERVIPEXPALLID, _num: 0 },

                // ── Hero upgrade materials (idleAwardFirst default) ──
                { _id: ITEM_IDS.EXPERIENCECAPSULEID, _num: idleFirstExpCapsule },
                { _id: ITEM_IDS.EVOLVECAPSULEID, _num: 0 },

                // ── Coins (shop refresh currencies) ──
                { _id: ITEM_IDS.SoulCoinID, _num: 0 },
                { _id: ITEM_IDS.ArenaCoinID, _num: 0 },
                { _id: ITEM_IDS.SnakeCoinID, _num: 0 },
                { _id: ITEM_IDS.TeamCoinID, _num: 0 },
                { _id: ITEM_IDS.HonourCoinID, _num: 0 },

                // ── Materials ──
                { _id: ITEM_IDS.EnergyStone, _num: 0 },
                { _id: ITEM_IDS.Metal, _num: 0 },
                { _id: ITEM_IDS.ZCOIN, _num: 0 },
                { _id: ITEM_IDS.Aurine, _num: 0 },
                { _id: ITEM_IDS.POTENTIALWATER, _num: 0 },
                { _id: ITEM_IDS.SUPERWATER, _num: 0 },
                { _id: ITEM_IDS.EARUPCOIN, _num: 0 },
                { _id: ITEM_IDS.EAREVOLVECOIN, _num: 0 },

                // ── Social / Summon / Market ──
                { _id: ITEM_IDS.FRIENDHEART, _num: 0 },
                { _id: ITEM_IDS.COMMONSUMMONPAPER, _num: 0 },
                { _id: ITEM_IDS.HIGHSUMMONPAPER, _num: 0 },
                { _id: ITEM_IDS.DRAGONSPIRIT, _num: 0 },
                { _id: ITEM_IDS.MARKETREFRESHID, _num: 0 },
                { _id: ITEM_IDS.LOWENTRUSTBOOK, _num: 0 },
                { _id: ITEM_IDS.MIDDLEENTRUSTBOOK, _num: 0 },
                { _id: ITEM_IDS.HIGHENTRUSTBOOK, _num: 0 }
            ]
        };

        log.debug('ENTERGAME', 'New user starting items — Gold: ' + (startGold + idleFirstGold) +
            ', EXP: ' + (startUserExp + idleFirstExp) +
            ', ExpCapsule: ' + idleFirstExpCapsule +
            ', Diamond: ' + startDiamond);

        r.backpackLevel = 1;  // ✅ L114921: t.heroBackPack. bagPlus.json key "1" max:90

        // ── Equipment systems ──
        // L114922-114930: setSign reads e.imprint._items[]
        // L130929-130947: readByData reads e.equip._suits + e.weapon._items + e.genki

        r.imprint = { _items: [] };  // ✅ L114924-114930: iterates
        r.equip = { _suits: {} };  // ✅ L130931: if (e.equip) — guarded
        r.weapon = { _items: {} };  // ✅ L130938: if (e.weapon) — guarded
        r.genki = { _id: '', _items: [], _curSmeltNormalExp: 0, _curSmeltSuperExp: 0 };  // ✅ L130946

        // ── Dungeon ──
        // L114944-114948: setCounterpart reads e.dungeon._dungeons

        r.dungeon = { _dungeons: {} };  // ✅ L114945: if (e.dungeon)

        // ── Heroes ──
        // L133718-133723: readByData(e.heros) → iterates e._heros[n] → SetHeroDataToModel
        // L134054-134112: SetHeroDataToModel reads all hero fields
        // L134096: heroBaseAttr.deserialize reads _level, _talent, _exp, _evolveLevel + all stats

        r.heros = buildDefaultHero(startHeroId, startHeroLevel, hc);

        // ── Super skill ──
        // L114795: SuperSkillSingleton.getInstance().initSuperSkill(e.superSkill)
        // L88732: if (e) { for-in e._skills } — empty {} = no super skills (safe)

        r.superSkill = {};  // ✅ L55769: initSuperSkill(e) → if(e) { e._skills } — object

        // ── Summon log ──
        // L114795: SummonSingleton.getInstance().setSummomLogList(e)
        // L95230: if (e.summonLog) — guarded

        r.summonLog = {};  // ⚠️

        // ── Guild systems ──
        // L114933-114938: setTeam(e) reads e.userGuild, e.userGuildPub, e.guildLevel, e.guildTreasureMatchRet
        // L135729-135740: saveGuildTech(e) reads e.userGuild._tech ← MUST be object!

        r.userGuild = {
            _guildId: '',  // ✅ setUserTeamInfoModel
            _requestedGuild: [],  // ✅
            _satanGift: { _exp: 0, _level: 1, _canRewardTime: {} },  // ✅
            _haveReadBulletin: false,  // ✅
            _canJoinGuildTime: 0,  // ✅
            _createGuildCD: false,  // ✅
            _ballWarJoin: false,  // ✅
            _clickSys: {},  // ✅
            _checkInType: 0,  // ✅
            _tech: {}  // ✅ FIX GAP#2: L135732 for-in userGuild._tech — MUST be object
        };

        r.userGuildPub = {
            _guildId: '',  // ✅
            _requestedGuild: [],  // ✅
            _satanGift: { _exp: 0, _level: 1, _canRewardTime: {} },  // ✅
            _haveReadBulletin: false,  // ✅
            _canJoinGuildTime: 0,  // ✅
            _createGuildCD: false,  // ✅
            _ballWarJoin: false,  // ✅
            _clickSys: {},  // ✅
            _checkInType: 0,  // ✅
            _tech: {}  // ✅ FIX GAP#2: saveGuildTech juga iterates userGuildPub
        };

        r.guildName = '';  // ⚠️ L114795: guarded, setTeamName (x2)
        r.guildLevel = 0;  // ⚠️ L114937: void 0 != check
        r.guildTreasureMatchRet = 0;  // ⚠️ L114938: void 0 != check
        r.guildActivePoints = {};  // ⚠️ L114838: guarded

        // ── Schedule info (daily reset counts) ──
        // L114795: AllRefreshCount.getInstance().initData(e.scheduleInfo)
        // L91274-91323: 47 fields (42 unconditional, 5 guarded)
        // Client TIDAK punya daily reset — 100% server responsibility

        r.channelSpecial = {
            _honghuUrl: '',            // ⚠️ L114846: e.channelSpecial && e.channelSpecial._honghuUrl
            _honghuUrlStartTime: 0,   // ⚠️ L114846: nested &&
            _honghuUrlEndTime: 0       // ⚠️ L114846: nested &&
        };
        r.scheduleInfo = buildDefaultScheduleInfo();  // ✅ 47 fields, L91274-91323
        r.cellgameHaveSetHero = false;  // ⚠️ L114795: void 0 != → inject ke scheduleInfo

        // ── Dragon balls ──
        // L114795: ItemsCommonSingleton.getInstance().initDragonBallEquip(e.dragonEquiped)
        // L118500: for-in e → check key vs dragon ball IDs (1-7)

        r.dragonEquiped = {};  // ✅ keys = dragon ball IDs, values ignored

        // ── Arena ──
        // L114823: setArenaTeamInfo(e._arenaTeam) — internally guarded if(e)

        r._arenaTeam = [];  // ✅ 5 slots, internally guarded
        r._arenaSuper = [];  // ✅ internally guarded

        // ── Karin tower ──
        // L114823: setKarinTime(e.karinStartTime, e.karinEndTime) — UNCONDITIONAL setter

        r.karinStartTime = 0;  // ✅
        r.karinEndTime = 0;  // ✅

        // ── QQ platform (Chinese market) ──
        // L114839-114844: direct assign, ALL UNCONDITIONAL

        r.enableShowQQ = false;  // ✅ L114839
        r.showQQVip = false;     // ✅ L114840
        r.showQQ = false;        // ✅ L114841
        r.showQQImg1 = '';       // ✅ L114842
        r.showQQImg2 = '';       // ✅ L114843
        r.showQQUrl = '';        // ✅ L114844

        // ── Retrieve (get-back) system ──
        // L114849: setRetrieveModel(e.retrieve) — internally guarded e &&

        r.retrieve = {
            _id: '',  // ✅
            _finishDungeons: {},  // ✅
            _calHangupTime: 0,  // ✅
            _retrieveHangupReward: {},  // ✅
            _retrieveHangupTime: 0,  // ✅
            _retrieveDungeons: {},  // ✅
            _finishTime: 0  // ✅
        };

        // ── Broadcast & Chat ──
        // L114436: chatJoinRecord({ _record: t.broadcastRecord })
        // L114632-114640: iterasi _record → ChatDataBaseClass.getData(a)
        // BroadcastRecord item structure (L92098-92110):
        //   _id, _type, _time, _kind, _name, _content, _image, _param,
        //   _headEffect, _headBox, _oriServerId, _serverId, _showMain

        r.broadcastRecord = [];  // ✅ L114436: parsed by chatJoinRecord
        r.forbiddenChat = { users: {}, finishTime: {} };  // ✅ L114870: setUserBidden
        // L92037-92040: var o = e.finishTime; → o[r] (indexed by userId) → MUST be OBJECT {}, NOT number

        // ── Hero skin ──
        // L114795: e.heroSkin && HerosManager.setSkinData(e.heroSkin) — guarded
        // L133537-133545: reads _skins, _curSkin

        r.heroSkin = { _skins: {}, _curSkin: {} };  // ⚠️ guarded
        r.hideHeroes = [];  // ⚠️ L114845: guarded
        r.heroImageVersion = 0;  // ✅ L114823: void 0 != check
        r.superImageVersion = 0;  // ✅ L114823: void 0 != check

        // ── Welfare / VIP / Gift systems ──
        // L114795-114813: multiple WelfareInfoManager calls

        r.vipLog = [];  // ⚠️ guarded
        r.cardLog = [];  // ⚠️ guarded
        r.guide = { _id: '', _steps: {} };  // ⚠️ guarded
        r.clickSystem = { _clickSys: { 1: false, 2: false } };  // ⚠️ L114795-114797

        // ── Online bonus gift timer ──
        // L114804: WelfareInfoManager.setOnlineGift(e.giftInfo._onlineGift)
        // L126327-126334: sets _curId and _nextTime
        // L233749: Home.setOnLineGift — timer = _nextTime - serverTime
        //   if _nextTime = 0 → timer = negative → NEVER starts!
        // FIX: Set _nextTime = now + first tier time (300s = 5min from onlineBonus.json)
        var onlineBonus = getOnlineBonus();
        var firstTierTime = 300;  // default 5 minutes
        if (onlineBonus && onlineBonus['1']) {
            firstTierTime = Number(onlineBonus['1'].time) || 300;
        }

        r.giftInfo = {
            // setGiftInfo fields (L79584) — read when getRewardInfo response arrives
            _id: '',                           // set on login
            _isBuyFund: false,                  // setGiftInfo: giftInfo._isBuyFund = e._isBuyFund
            _levelGiftCount: {},                // setGiftInfo: iterated & copied
            _levelBuyGift: {},                  // setGiftInfo: iterated → setLevelBuyGiftItem
            _fundGiftCount: {},                 // setGiftInfo: iterated & copied
            // saveUserData fields (L77647-77651) — read at login
            _gotChannelWeeklyRewardTag: '',     // L114800
            _fristRecharge: {                   // L114801
                _canGetReward: false,
                _haveGotReward: false
            },
            _haveGotVipRewrd: {},               // L114802
            _buyVipGiftCount: {},               // L114803
            _onlineGift: { _curId: 0, _nextTime: (now + firstTierTime) * 1000 },  // L114804: ms timestamp — now=seconds, firstTierTime=seconds → ×1000 → ms ✓
            _gotBSAddToHomeReward: false,       // L114806
            _clickHonghuUrlTime: 0              // L114809: || 0 fallback
        };

        r.monthCard = { _id: '', _card: {} };  // ⚠️ L114814
        r.recharge = { _id: '', _haveBought: {} };  // ⚠️ L114814

        // ── Times info (recovery-based) ──
        // L114814: TimesInfoSingleton.getInstance().initData(e.timesInfo) — guarded
        // L96001-96011: fields TANPA _ prefix!
        // Client hitung recovery: Math.floor((serverTime - recoverTime) / interval)
        // Recovery intervals from constant.json:
        //   marketRefreshTime: 7200 (2h), vipMarketRefreshTime: 43200 (12h)
        //   templeTestTimesRefresh: 1800 (30min), mahaAdventureCD: 14400 (4h)
        //   mineActionPointRefreshTime: 1800 (30min), karinTowerFeetRefresh: 7200 (2h)

        r.timesInfo = {
            marketRefreshTimes: 5,            // ⚠️ max: marketRefreshTimeMax=5
            marketRefreshTimesRecover: 0,    // ⚠️ timestamp ms for recovery calc
            vipMarketRefreshTimes: 5,        // ⚠️ max: vipMarketRefreshTimeMax=5
            vipMarketRefreshTimesRecover: 0,
            templeTimes: 10,                 // ⚠️ max: templeTestTimes=10
            templeTimesRecover: 0,
            mahaTimes: 5,                     // ⚠️ max: mahaAdventureTimesMax=5
            mahaTimesRecover: 0,
            mineSteps: 50,                    // ⚠️ max: mineActionPointMax=50
            mineStepsRecover: 0,
            karinFeet: 5,                     // ⚠️ max: karinTowerFeet=5
            karinFeetRecover: 0
        };

        // ── Download reward ──
        // L114814-114822: guarded

        // r.userDownloadReward = REMOVED — download reward UI tidak digunakan di mock server
        //   Client L77652: if(e.userDownloadReward) { ... set userDownloadModel }
        //   Client L168106: userDownloadModel && downloadAward[1].isWork && n.push(DOWNLOADREWARD)
        //   Dengan field ini tidak ada, userDownloadModel = undefined → tab TIDAK muncul.

        // ── Various guarded systems ──

        r.YouTuberRecruit = { _hidden: true };  // ⚠️ L114823: guarded by !e._hidden
        r.userYouTuberRecruit = { _gotReward: false, _hasJoin: false };  // ⚠️
        r.timeMachine = { _items: {} };  // ⚠️ TimeLeapSingleton
        r.timeBonusInfo = { _id: '', _timeBonus: [] };  // ⚠️ TimeLimitGiftBagManager
        r.onlineBulletin = [];  // ⚠️ BulletinSingleton.setBulletInfo L92127
        // L92132-92136: _startTime, _endTime, _info, _interval, _duration
        r.lastTeam = { _lastTeamInfo: null };  // ⚠️ firstLoginSetMyTeam

        // ── Training (Padipata) ──
        // L114823: PadipataInfoManager.setPadipataModel(e.training) — guarded
        // L121377-121387: reads _id, _type, _times, _timesStartRecover, _surpriseReward,
        //   _questionId, _enemyId, _cfgId

        r.training = {
            _id: '', _type: 0, _times: 0, _timesStartRecover: 0,
            _surpriseReward: {}, _questionId: 0, _enemyId: 0, _cfgId: 0
        };

        // ── Global War ──
        // L114823: GlobalWarManager — guarded

        r.warInfo = { _rank64: [], _rank16: [] };
        r.userWar = {
            _id: '', _session: 0, _worldId: 0, _areaId: 0,
            _auditionWinCount: 0, _gotAuditionReward: {}, _bet: {},
            _championCount: 0, _liked: false
        };

        // ── Head effect ──
        // L114823: HeadEffectModel.deserialize — guarded
        // Client akses .curEffect/.curBox TANPA null-check → harus ada defaults!

        r.headEffect = { _effects: [], _curEffect: 0, _curBox: 0 };

        // ── Ball War (Dragon Ball) ──
        // L114829: guarded assignments

        r.userBallWar = {
            _times: 0, _timesStartRecover: 0, _finishClickTag: '',
            _lastOwnerTag: '', _nextCanFightTime: 0, _readRecordTime: 0
        };
        r.ballWarState = 0;
        r.ballBroadcast = [];
        r.ballWarInfo = {
            _signed: false, _fieldId: '', _point: 0, _topMsg: ''
        };

        // ── Expedition ──
        // L114847: ExpeditionManager — guarded

        r.expedition = {
            _id: '', _passLesson: {}, _machines: {}, _collection: [],
            _teams: {}, _times: 0, _timesStartRecover: 0
        };

        // ── Space Trial ──
        // L114848: SpaceTrialManager — guarded

        r.timeTrial = {
            _id: '', _levelStars: {}, _level: 1, _totalStars: 0,
            _gotStarReward: {}, _haveTimes: 0, _timesStartRecover: 0,
            _lastRefreshTime: 0, _timeTrialNextOpenTime: 0, _startTime: 0
        };
        r.timeTrialNextOpenTime = 0;

        // ── Battle Medal ──
        // L114850: BattleMedalManager — guarded

        r.battleMedal = {
            _id: '', _battleMedalId: '', _cycle: 0, _nextRefreshTime: 0,
            _level: 0, _curExp: 0, _openSuper: false, _task: {},
            _levelReward: {}, _shopBuyTimes: {}, _buyLevelCount: 0
        };

        // ── Shop & misc ──

        r.shopNewHeroes = {};  // ⚠️ L114851
        // r.questionnaires = REMOVED — survey/questionnaire UI tidak digunakan di mock server
        //   Client L168106: getQuestData() && n.push(ACTIVITY_CYCLE.QUESTION)
        //   Dengan field ini tidak ada, getQuestData() = undefined → tab TIDAK muncul.

        // ── Team Dungeon ──
        // L114852-114863: TeamworkManager — all guarded

        r.teamDungeon = {
            _myTeam: '', _canCreateTeamTime: 0, _nextCanJoinTime: 0
        };
        r.teamServerHttpUrl = '';  // ⚠️ L114853
        r.teamDungeonOpenTime = 0;  // ⚠️ L114856
        r.teamDungeonTask = { _achievement: {}, _dailyRefreshTime: 0, _daily: {} };
        r.teamDungeonSplBcst = {};
        r.teamDungeonNormBcst = {};
        r.teamDungeonHideInfo = {};
        r.teamDungeonInvitedFriends = [];
        r.myTeamServerSocketUrl = '';

        // ── Temple ──

        r.templeLess = 0;

        // ── Gemstone ──
        // L114864: EquipInfoManager.saveGemStone(e) — e.gemstone && guarded

        r.gemstone = { _items: [] };

        // ── Resonance ──
        // L114866: HerosManager.setResonanceModel — guarded

        r.resonance = {
            _id: '', _diamondCabin: 0, _cabins: {}, _buySeatCount: 0,
            _totalTalent: 0, _unlockSpecial: false
        };

        // ── Top Battle ──
        // L114867: TopBattleManager — setTopBattleLoginInfo selalu dipanggil

        r.userTopBattle = {
            _id: '', _teams: {}, _teamTag: '', _nextSetTeamTime: 0,
            _lastPoint: 0, _records: [], _history: [], _bet: {},
            _liked: false, _gotRankReward: []
        };
        r.topBattleInfo = { _season: 0 };

        // ── Fast team ──
        r.fastTeam = { _teamInfo: {} };  // ⚠️ L114868

        // ── Gravity trial ──
        r.gravity = {
            _id: '', _haveTimes: 0, _timesStartRecover: 0,
            _lastLess: 0, _lastTime: 0
        };

        // ── Little game (mini-game plugin) ──
        r.littleGame = { _gotBattleReward: {}, _gotChapterReward: {}, _clickTime: 0 };

        // ── Team training ──
        // L114952: guarded, deserialize strips _ prefix
        r.teamTraining = { _id: '', _levels: {}, _unlock: false, _version: '' };

        // ── Checkin / Sign-in ──
        // L114932: guarded, setSignInInfo
        // L137192-137198: CheckinModel defaults
        r.checkin = buildDefaultCheckin(Date.now());

        // ── Main task ──
        // L114954: UNCONDITIONAL — setMianTask selalu dipanggil
        // L62521-62525: setMianTask(e) → for(var n in e) _mainTask._id = e[n]._id, _state = e[n]._state
        // L77720-77721: setMainTask(e) → calls setMianTask(e.curMainTask)
        // L168007-168016: Home UI checks _state == TASK_STATE.COMPLETE → green "claim", DOING → yellow progress
        // L173947-173954: getReward request → taskIds:[currentMainTask._id], taskClass:TASK_CLASS.MAIN (1)
        // L173956: response._nextTasks → setMainTaskWithComplete → advance to next task
        // L77080: push "mainTaskChange" → setMianTask(e._curMainTask)
        //
        // TASK_STATE enum (L62602-62605):
        //   DEFAULT=0 (locked), DOING=1 (active), COMPLETE=2 (done, await claim), FINISH=3 (claimed)
        //
        // For returning users, curMainTask is preserved via deepMerge.
        // For new users, start at task 6001 with state DOING.
        //
        // task.json chain: 6001→6002→...→6044 (linear, nextTaskID links)
        // Task 6001: taskType:"lesson", taskPara1:10102 (clear stage 1-2)
        r.curMainTask = [{ _id: 6001, _state: 1 }]; // TASK_STATE.DOING

        // ── Blacklist ──
        // L114869: UNCONDITIONAL — setBlacklistPlayerInfo selalu dipanggil
        // L92031-92036: if (e.blacklist) → iterasi
        r.blacklist = [];

        return r;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD DEFAULT HERO (with computed base stats)
    // ═══════════════════════════════════════════════════════════
    //
    //  Builds a default hero for new users.
    //  Uses makeHeroBasicAttr to compute actual base stats from configs
    //  instead of returning all zeros.
    //
    //  Evidence:
    //    L133718-133723: readByData iterates e._heros[n]
    //    L134054-134112: SetHeroDataToModel reads all hero fields
    //    L134096: heroBaseAttr.deserialize reads _level, _talent, _exp, _evolveLevel + stats

    function buildDefaultHero(heroId, heroLevel, hc) {
        var displayId = Number(heroId);
        var heroTag = (hc && hc.tag) ? hc.tag.split(',') : [];

        // Compute actual base stats from configs
        var baseAttr = makeHeroBasicAttr(displayId, heroLevel, 0, 0);

        return {
            _heros: {
                '0': {
                    _heroId: heroId,
                    _heroDisplayId: displayId,
                    _heroStar: 0,
                    _expeditionMaxLevel: 0,
                    _heroTag: heroTag,
                    _fragment: 0,
                    _superSkillResetCount: 0,
                    _potentialResetCount: 0,

                    _heroBaseAttr: baseAttr,  // Computed base stats from configs

                    _superSkillLevel: {},  // ✅ L134211: readLocalSkillData
                    _potentialLevel: {},
                    _qigong: [],  // ✅ L134112: if (e._qigong)
                    _qigongTmp: [],  // ✅ L134112: if (e._qigongTmp)
                    _qigongStage: 1,  // ✅ L134112: e._qigongStage ? ... : 1
                    _qigongTmpPower: 0,  // ✅ L134112: void 0 != e._qigongTmpPower

                    _totalCost: {
                        _wakeUp: { _items: [] },
                        _earring: { _items: [] },
                        _levelUp: { _items: [] },
                        _evolve: { _items: [] },
                        _skill: { _items: [] },
                        _qigong: { _items: [] },
                        _heroBreak: { _items: [] }
                    },

                    _breakInfo: {
                        _breakLevel: 1,
                        _level: 0,
                        _attr: { _items: [] }
                    },

                    _gemstoneSuitId: 0,
                    _linkTo: [],
                    _linkFrom: ''
                }
            }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD DEFAULT SCHEDULE INFO
    // ═══════════════════════════════════════════════════════════
    //
    //  AllRefreshCount.initData (L91274-91323) reads 47 fields.
    //  42 unconditional, 5 guarded (void 0 != check).
    //  Client TIDAK punya daily reset — server MUST reset these daily.

    function buildDefaultScheduleInfo() {
        return {
            _marketDiamondRefreshCount: 0,         // L91276 — UNCONDITIONAL
            _vipMarketDiamondRefreshCount: 0,       // L91277 — UNCONDITIONAL
            _arenaAttackTimes: 5,                    // L91278 — UNCONDITIONAL (constant[1].arenaAttackTimes = 5)
            _arenaBuyTimesCount: 0,                 // L91279 — UNCONDITIONAL
            _snakeResetTimes: 0,                    // L91280 — UNCONDITIONAL
            _snakeSweepCount: 0,                    // L91281 — UNCONDITIONAL
            _cellGameHaveGotReward: true,            // L91282 — UNCONDITIONAL (new user = already got)
            _cellGameHaveTimes: 0,                  // L91283 — UNCONDITIONAL
            _cellgameHaveSetHero: false,             // L91284 — UNCONDITIONAL
            _strongEnemyTimes: 0,                   // L91285 — UNCONDITIONAL
            _strongEnemyBuyCount: 0,                // L91286 — UNCONDITIONAL
            _mergeBossBuyCount: 0,                  // L91287 — UNCONDITIONAL
            _dungeonTimes: { "1":2, "2":2, "3":2, "4":2, "5":2, "6":2, "7":2, "8":2 },  // L91288 — default times from constant.json (all 2); client setCounterPartTime does for-in → needs populated keys
            _dungeonBuyTimesCount: {},                // L91289 — UNCONDITIONAL → setCounterPartBuyCount → for-in iterates → MUST be OBJECT
            _karinBattleTimes: 0,                    // L91290 — UNCONDITIONAL
            _karinBuyBattleTimesCount: 0,            // L91291 — UNCONDITIONAL
            _karinBuyFeetCount: 0,                   // L91292 — UNCONDITIONAL
            _entrustResetTimes: 0,                   // L91293 — UNCONDITIONAL
            _dragonExchangeSSPoolId: 0,              // L91294 — UNCONDITIONAL
            _dragonExchangeSSSPoolId: 0,             // L91295 — UNCONDITIONAL
            _teamDugeonUsedRobots: [],                // L91296 — UNCONDITIONAL
            _timeTrialBuyTimesCount: 0,             // L91297 — UNCONDITIONAL
            _monthCardHaveGotReward: {},             // L91298 — UNCONDITIONAL
            _goldBuyCount: 0,                        // L91299 — UNCONDITIONAL
            _likeRank: 0,                            // L91300 — UNCONDITIONAL
            _mahaAttackTimes: 0,                     // L91301 — UNCONDITIONAL
            _mahaBuyTimesCount: 0,                   // L91302 — UNCONDITIONAL
            _mineResetTimes: 0,                      // L91303 — GUARDED (void 0 !=)
            _mineBuyResetTimesCount: 0,             // L91304 — GUARDED
            _mineBuyStepCount: 0,                    // L91305 — GUARDED
            _guildBossTimes: 0,                      // L91306 — UNCONDITIONAL
            _guildBossTimesBuyCount: 0,              // L91307 — UNCONDITIONAL
            _treasureTimes: 0,                       // L91308 — UNCONDITIONAL
            _guildCheckInType: 0,                    // L91309 — UNCONDITIONAL
            _templeBuyCount: 0,                      // L91310 — GUARDED
            _trainingBuyCount: 0,                    // L91311 — GUARDED
            _bossCptTimes: 0,                        // L91312 — GUARDED
            _bossCptBuyCount: 0,                     // L91313 — GUARDED
            _ballWarBuyCount: 0,                     // L91314 — GUARDED
            _expeditionEvents: {},                    // L91315 — GUARDED (e &&)
            _clickExpedition: 0,                     // L91316 — UNCONDITIONAL
            _expeditionSpeedUpCost: 0,                // L91317 — UNCONDITIONAL
            _templeDailyReward: 0,                   // L91318 — UNCONDITIONAL
            _templeYesterdayLess: 0,                 // L91319 — UNCONDITIONAL
            _topBattleTimes: 0,                      // L91320 — UNCONDITIONAL
            _topBattleBuyCount: 0,                   // L91321 — UNCONDITIONAL
            _gravityTrialBuyTimesCount: 0,           // L91322 — UNCONDITIONAL
            _snakeDungeonBuyTimes: 0,                // L91323 — additional
            _bossAttackBuyCount: 0                   // L91324 — additional
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD DEFAULT CHECKIN
    // ═══════════════════════════════════════════════════════════
    //
    //  Server controls sign-in eligibility via _activeItem[] + _maxActiveDay.
    //  Client L137192-137198: constructor defaults.
    //  Client L220291-220296: day <= _maxActiveDay → reward unlocked.

    function buildDefaultCheckin(nowMs) {
        // nowMs = MILLISECONDS — client L156726: new Date(c + getServerOffTime())
        //   expects c in ms. Server asli kirim _lastActiveDate dalam ms.
        return {
            _id: '',          // ✅ L137194: default ''
            _activeItem: [],   // ✅ L137195: default []
            _curCycle: 1,      // ✅ L137196: default 1
            _maxActiveDay: 0,  // ✅ L137197: default 0 (no days unlocked)
            // _lastActiveDate: 0 (NOT nowMs!)
            // checkinUpdate() will detect '' !== todayDate and unlock day 1.
            // If we set nowMs here, checkinUpdate sees same-day → skips → day 1 never unlocks.
            _lastActiveDate: 0
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH F: CHECK DAILY RESET (with 6:00 AM boundary)
    // ═══════════════════════════════════════════════════════════
    //
    //  Client TIDAK punya daily reset logic. 100% server responsibility.
    //  Daily reset boundary: 6:00 AM (constant.json resetTime: "6:00:00").
    //  Evidence: L83699 generateRetrieveDay — hours < 6 → previous day.
    //
    //  WHAT gets reset:
    //    scheduleInfo → ALL 47+ fields back to defaults
    //
    //  WHAT does NOT get reset:
    //    timesInfo → client computes recovery from timestamps.
    //      Kalau recoverTime di-reset → recovery = 0 → user kehilangan waktu!
    //      Evidence: TimesInfoSingleton L95968-96037.
    //    checkin → has its own day-tracking logic
    //    totalProps (currency, items) → never reset by daily
    //    user data → never reset

    function checkDailyReset(savedData) {
        var lastLoginTime = savedData.user ? (savedData.user._lastLoginTime || 0) : 0;
        var now = db.nowSeconds();

        // Use generateRetrieveDay for proper 6:00 AM boundary
        var lastDate = lastLoginTime ? new Date(lastLoginTime * 1000) : null;
        var nowDate = new Date(now * 1000);

        var lastDay = lastDate ? generateRetrieveDay(lastDate) : '';
        var nowDay = generateRetrieveDay(nowDate);

        if (lastDay && lastDay !== nowDay) {
            log.info('HANDLER', 'DAILY RESET — ' + lastDay + ' -> ' + nowDay);
            savedData.scheduleInfo = buildDefaultScheduleInfo();
            return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH G: CHECKIN UPDATE (RETURNING USER)
    // ═══════════════════════════════════════════════════════════
    //
    //  Cek apakah user bisa sign-in hari ini.
    //  Kalau _lastActiveDate bukan hari ini → tambah 1 ke _maxActiveDay
    //  dan tambahkan day number ke _activeItem[].
    //
    //  Uses generateRetrieveDay for proper 6:00 AM boundary.

    function checkinUpdate(savedData) {
        var nowMs = Date.now();
        if (!savedData.checkin) {
            savedData.checkin = buildDefaultCheckin(nowMs);
            return;
        }

        // _lastActiveDate disimpan dalam MILLISECONDS (ms) karena client
        // L156726: new Date(c + getServerOffTime()) mengharapkan c dalam ms.
        // generateRetrieveDay butuh Date object → konversi dari ms.
        var lastDateMs = savedData.checkin._lastActiveDate || 0;
        var lastDateStr = lastDateMs ? generateRetrieveDay(new Date(lastDateMs)) : '';
        var nowDateStr = generateRetrieveDay(new Date(nowMs));

        if (lastDateStr !== nowDateStr) {
            savedData.checkin._maxActiveDay = (savedData.checkin._maxActiveDay || 0) + 1;
            var todayDay = savedData.checkin._maxActiveDay;

            if (!savedData.checkin._activeItem) {
                savedData.checkin._activeItem = [];
            }
            if (savedData.checkin._activeItem.indexOf(todayDay) === -1) {
                savedData.checkin._activeItem.push(todayDay);
            }

            savedData.checkin._lastActiveDate = nowMs;
            log.debug('HANDLER', 'CHECKIN — day unlocked: ' + todayDay);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH H: TIMESINFO RECOVERY CALCULATION (RETURNING USER)
    // ═══════════════════════════════════════════════════════════
    //
    //  For returning users, compute recovery for timesInfo fields.
    //  Client L95968-96037: reads count + recoverTime, computes recovery lazily.
    //
    //  Recovery intervals from constant.json:
    //    marketRefreshTime: 7200 (2 hours) — max: marketRefreshTimeMax: 5
    //    vipMarketRefreshTime: 43200 (12 hours) — max: vipMarketRefreshTimeMax: 5
    //    templeTestTimesRefresh: 1800 (30 min) — max: templeTestTimes: 10
    //    mahaAdventureCD: 14400 (4 hours) — max: mahaAdventureTimesMax: 5
    //    mineActionPointRefreshTime: 1800 (30 min) — max: mineActionPointMax: 50
    //    karinTowerFeetRefresh: 7200 (2 hours) — max: karinTowerFeet: 5
    //    trainingTimesRefresh: 7200 (2 hours) — max: trainingTimesMax: 10
    //    expeditionBattleTimesRefresh: 14400 (4 hours) — max: expeditionBattleTimes: 10
    //
    //  Formula: recovered = Math.floor((now - recoverTime) / interval)
    //           newCount = Math.min(currentCount + recovered, max)
    //
    //  Evidence:
    //    L96020: market recovery (interval - ceil(elapsed % interval))
    //    L125960: temple recovery
    //    L125012: mine recovery
    //    L136916: karin feet recovery

    function computeTimesInfoRecovery(savedData) {
        if (!savedData.timesInfo) return;

        var c = getConstant();
        var nowMs = Date.now();
        var ti = savedData.timesInfo;

        // Market refresh — max 5, interval 7200s (2h)
        var marketMax = Number(c && c.marketRefreshTimeMax) || 5;
        var marketInterval = Number(c && c.marketRefreshTime) || 7200;
        var mr = computeRecovery(ti.marketRefreshTimes, ti.marketRefreshTimesRecover, marketMax, marketInterval, nowMs);
        ti.marketRefreshTimes = mr.count;
        ti.marketRefreshTimesRecover = mr.recoverTimestamp;

        // VIP Market refresh — max 5, interval 43200s (12h)
        var vipMarketMax = Number(c && c.vipMarketRefreshTimeMax) || 5;
        var vipMarketInterval = Number(c && c.vipMarketRefreshTime) || 43200;
        var vmr = computeRecovery(ti.vipMarketRefreshTimes, ti.vipMarketRefreshTimesRecover, vipMarketMax, vipMarketInterval, nowMs);
        ti.vipMarketRefreshTimes = vmr.count;
        ti.vipMarketRefreshTimesRecover = vmr.recoverTimestamp;

        // Temple times — max 10, interval 1800s (30min)
        var templeMax = Number(c && c.templeTestTimes) || 10;
        var templeInterval = Number(c && c.templeTestTimesRefresh) || 1800;
        var tr = computeRecovery(ti.templeTimes, ti.templeTimesRecover, templeMax, templeInterval, nowMs);
        ti.templeTimes = tr.count;
        ti.templeTimesRecover = tr.recoverTimestamp;

        // Maha adventure times — max 5, interval 14400s (4h)
        var mahaMax = Number(c && c.mahaAdventureTimesMax) || 5;
        var mahaInterval = Number(c && c.mahaAdventureCD) || 14400;
        var mar = computeRecovery(ti.mahaTimes, ti.mahaTimesRecover, mahaMax, mahaInterval, nowMs);
        ti.mahaTimes = mar.count;
        ti.mahaTimesRecover = mar.recoverTimestamp;

        // Mine action points — max 50, interval 1800s (30min)
        var mineMax = Number(c && c.mineActionPointMax) || 50;
        var mineInterval = Number(c && c.mineActionPointRefreshTime) || 1800;
        var mir = computeRecovery(ti.mineSteps, ti.mineStepsRecover, mineMax, mineInterval, nowMs);
        ti.mineSteps = mir.count;
        ti.mineStepsRecover = mir.recoverTimestamp;

        // Karin tower feet — max 5, interval 7200s (2h)
        var karinFeetMax = Number(c && c.karinTowerFeet) || 5;
        var karinFeetInterval = Number(c && c.karinTowerFeetRefresh) || 7200;
        var kfr = computeRecovery(ti.karinFeet, ti.karinFeetRecover, karinFeetMax, karinFeetInterval, nowMs);
        ti.karinFeet = kfr.count;
        ti.karinFeetRecover = kfr.recoverTimestamp;

        log.details('TIMESINFO_RECOVERY', [
            ['market', ti.marketRefreshTimes + '/' + marketMax],
            ['vipMarket', ti.vipMarketRefreshTimes + '/' + vipMarketMax],
            ['temple', ti.templeTimes + '/' + templeMax],
            ['maha', ti.mahaTimes + '/' + mahaMax],
            ['mine', ti.mineSteps + '/' + mineMax],
            ['karinFeet', ti.karinFeet + '/' + karinFeetMax]
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH I: HANGUP (AFK) REWARD COMPUTATION
    // ═══════════════════════════════════════════════════════════
    //
    //  For returning users: compute offline/idle rewards.
    //  Client L114886-114900: setOnHook reads hangup data.
    //
    //  AFK reward system:
    //    - Max idle time: constant.idle = 28800 (8 hours)
    //    - Reward tick interval: constant.idleAwardEveryTime = 300 (5 min)
    //    - Max reward ticks: 28800 / 300 = 96 ticks
    //    - Each tick gives lesson rewards based on hangup._curLess
    //
    //  The server should:
    //    1. Calculate offline time since last login
    //    2. Clamp to max idle time
    //    3. Calculate reward ticks
    //    4. Store _calHangupTime for retrieve system
    //
    //  NOTE: In a full implementation, the server would compute actual
    //  lesson rewards from lesson.json. For the mock server, we just
    //  track the time and tick count — the actual reward item generation
    //  happens when the client calls the retrieve handler.

    function computeHangupRewards(savedData) {
        if (!savedData.hangup || !savedData.user) return;

        var lastLoginTime = savedData.user._lastLoginTime || 0;
        var now = db.nowSeconds();
        var offlineSeconds = now - lastLoginTime;

        if (offlineSeconds <= 0) return;

        var c = getConstant();
        var maxIdle = Number(c && c.idle) || 28800;
        var tickInterval = Number(c && c.idleAwardEveryTime) || 300;

        // Clamp offline time to max idle
        var effectiveSeconds = Math.min(offlineSeconds, maxIdle);
        var ticks = Math.floor(effectiveSeconds / tickInterval);

        if (ticks > 0) {
            // Store for retrieve system
            if (savedData.retrieve) {
                savedData.retrieve._calHangupTime = effectiveSeconds;
            }

            log.details('HANGUP', [
                ['offlineSeconds', String(Math.round(offlineSeconds))],
                ['effectiveSeconds', String(Math.round(effectiveSeconds))],
                ['maxIdle', String(maxIdle)],
                ['ticks', String(ticks)],
                ['tickInterval', String(tickInterval)]
            ]);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH J: BROADCAST RECORD INJECTION
    // ═══════════════════════════════════════════════════════════
    //
    //  Server-wide broadcast messages stored in server metadata.
    //  Injected into user response at login.
    //
    //  Client L114436: chatJoinRecord({ _record: t.broadcastRecord })
    //  L114632-114640: iterates _record → ChatDataBaseClass.getData(a)
    //  L92098-92110: reads each broadcast item fields:
    //    _id, _type, _time, _kind, _name, _content, _image, _param,
    //    _headEffect, _headBox, _oriServerId, _serverId, _showMain
    //
    //  Broadcast structure:
    //    broadcastRecord: [
    //      {
    //        _id: "msg_001",
    //        _type: "system",      // message type
    //        _time: 1717000000000, // unix timestamp ms
    //        _kind: "world",       // channel: world/guild/private
    //        _name: "System",      // sender name
    //        _content: "Welcome!", // message text
    //        _image: "",          // optional image URL
    //        _param: "",          // extra params
    //        _headEffect: 0,      // head frame effect ID
    //        _headBox: 0,         // head box ID
    //        _oriServerId: 1,     // original server
    //        _serverId: 1,        // current server
    //        _showMain: false      // show on main screen
    //      }
    //    ]

    function injectBroadcastRecord(savedData) {
        var meta = getServerMeta();
        if (meta._broadcastQueue && meta._broadcastQueue.length > 0) {
            savedData.broadcastRecord = meta._broadcastQueue.slice();
            log.details('BROADCAST', [
                ['injected', String(savedData.broadcastRecord.length) + ' broadcasts']
            ]);
        } else {
            savedData.broadcastRecord = savedData.broadcastRecord || [];
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH K: ONLINE BULLETIN INJECTION
    // ═══════════════════════════════════════════════════════════
    //
    //  Server-wide online bulletins stored in server metadata.
    //  Injected into user response at login.
    //
    //  Client L92127-92139: BulletinSingleton.setBulletInfo(e)
    //  L92132-92136: reads each bulletin item:
    //    _startTime, _endTime, _info, _interval, _duration
    //
    //  Bulletin structure:
    //    onlineBulletin: [
    //      {
    //        _startTime: 1717000000000,  // start timestamp ms
    //        _endTime: 1717100000000,    // end timestamp ms
    //        _info: "Event announcement", // bulletin text
    //        _interval: 300000,           // display interval ms
    //        _duration: 5000              // display duration ms
    //      }
    //    ]

    function injectOnlineBulletin(savedData) {
        var meta = getServerMeta();
        if (meta._onlineBulletins && meta._onlineBulletins.length > 0) {
            savedData.onlineBulletin = meta._onlineBulletins.slice();
            log.details('BULLETIN', [
                ['injected', String(savedData.onlineBulletin.length) + ' bulletins']
            ]);
        } else {
            savedData.onlineBulletin = savedData.onlineBulletin || [];
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH L: DEEP MERGE — returning user data + fresh defaults
    // ═══════════════════════════════════════════════════════════
    //
    //  Aturan:
    //    - Field di saved → saved WINS (user progress preserved)
    //    - Field HANYA di defaults → ambil dari defaults (new field)
    //    - Nested plain object → recurse
    //    - Array → saved WINS, JANGAN merge arrays
    //    - null/0/''/false di saved → preserved (intentional)
    //
    //  WHY: When buildNewUserResponse gets new fields (game update),
    //  old saved data won't have them. deepMerge fills missing fields
    //  from defaults WITHOUT overwriting user progress.

    function deepMerge(saved, defaults) {
        if (saved === undefined || saved === null) return defaults;
        if (typeof saved !== 'object') return saved;
        if (Array.isArray(saved)) return saved;
        if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) return saved;

        var result = {};
        var key;

        // 1. Copy all keys from defaults (schema)
        for (key in defaults) {
            if (!defaults.hasOwnProperty(key)) continue;
            if (key in saved) {
                var sv = saved[key];
                var df = defaults[key];
                // FIX: jika saved value === undefined, gunakan default
                // Saved undefined bisa terjadi jika field ditambahkan belakangan
                // lalu savedData di-serialize tanpa field tersebut, lalu
                // IndexedDB return object dengan property undefined.
                // typeof undefined !== 'object' → masuk else → result = undefined
                // → JSON.stringify omit key → field hilang dari response.
                if (sv === undefined) {
                    result[key] = df;
                } else if (typeof sv === 'object' && sv !== null && !Array.isArray(sv)
                    && typeof df === 'object' && df !== null && !Array.isArray(df)) {
                    result[key] = deepMerge(sv, df);
                } else {
                    result[key] = sv;
                }
            } else {
                result[key] = df;
            }
        }

        // 2. Add keys from saved not in defaults (extra data)
        for (key in saved) {
            if (!saved.hasOwnProperty(key)) continue;
            if (!(key in result)) {
                result[key] = saved[key];
            }
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH M: MAIN HANDLER — handleEnterGame
    // ═══════════════════════════════════════════════════════════
    //
    //  Alur lengkap:
    //    1. VALIDASI: maintenance, banned, userId, loginToken, gameVersion
    //    2. LOAD/CREATE: baca saved data atau build new user
    //    3. MERGE: deepMerge saved + defaults (returning user only)
    //    4. DAILY RESET: cek beda hari (6:00 AM boundary) → reset scheduleInfo
    //    5. CHECKIN UPDATE: unlock hari baru jika beda hari
    //    6. TIMESINFO RECOVERY: hitung recovery untuk returning user
    //    7. HANGUP REWARDS: hitung offline reward ticks
    //    8. INJECT: broadcast + bulletin dari server metadata
    //    9. SAVE: simpan ke DB (IndexedDB)
    //   10. RESPOND: callback(responseData)

    function handleEnterGame(request, callback) {
        var userId = request.userId;
        var serverId = request.serverId || 1;
        var loginToken = request.loginToken || '';
        var gameVersion = request.gameVersion || '';

        var t0 = Date.now();

        log.info('HANDLER', 'enterGame processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['serverId', String(serverId)],
            ['loginToken', loginToken ? loginToken.substring(0, 16) + '...' : '(empty)'],
            ['language', request.language || '-'],
            ['gameVersion', gameVersion || '-'],
            ['version', request.version || '-']
        ]);

        try {

            // ═══ VALIDASI 0: Maintenance mode ═══
            var meta = getServerMeta();
            if (meta._maintenance) {
                log.warn('HANDLER', 'SERVER IN MAINTENANCE — rejecting enterGame');
                callback(buildError(RET_CODES.MAINTENANCE, 'Server sedang maintenance'), RET_CODES.MAINTENANCE);
                return;
            }

            // ═══ VALIDASI 1: Banned user check ═══
            if (userId && meta._bannedUsers && meta._bannedUsers[userId]) {
                log.warn('HANDLER', 'BANNED USER — rejecting enterGame for userId: ' + userId);
                callback(buildError(RET_CODES.ACCOUNT_BANNED, 'Account banned'), RET_CODES.ACCOUNT_BANNED);
                return;
            }

            // ═══ VALIDASI 2: userId wajib ═══
            // L114426: userId = ts.loginInfo.userInfo.userId — selalu ada dari login
            if (!userId) {
                log.error('HANDLER', 'Missing userId in enterGame request');
                callback(buildError(RET_CODES.MISSING_USERID, 'userId tidak boleh kosong'), RET_CODES.MISSING_USERID);
                return;
            }

            // ═══ VALIDASI 3: loginToken — CROSS-SERVER (async) ═══
            // Baca langsung dari IndexedDB saat dipanggil (bukan cache startup).
            // Login-server menulis token SETELAH user login — cache startup selalu kosong.

            db.validateLoginToken(userId, function (tokenCheck) {
                try {
                    if (!tokenCheck.valid) {
                        log.warn('HANDLER', 'loginToken validation FAILED — ' + tokenCheck.reason);
                        callback(
                            buildError(RET_CODES.TOKEN_INVALID, 'Token validation failed: ' + tokenCheck.reason),
                            RET_CODES.TOKEN_INVALID
                        );
                        return;
                    }

                    // ═══ VALIDASI 4: token value match ═══
                    if (loginToken && tokenCheck.token && tokenCheck.token.loginToken) {
                        if (tokenCheck.token.loginToken !== loginToken) {
                            log.error('HANDLER', 'loginToken VALUE MISMATCH');
                            log.details('error', [
                                ['userId', userId],
                                ['stored', (tokenCheck.token.loginToken || '').substring(0, 16) + '...'],
                                ['received', loginToken.substring(0, 16) + '...']
                            ]);
                            callback(buildError(RET_CODES.TOKEN_MISMATCH, 'Token value tidak cocok'), RET_CODES.TOKEN_MISMATCH);
                            return;
                        }
                    }

                    log.info('HANDLER', 'loginToken validated');

                    // ═══ VALIDASI 5: gameVersion (soft check) ═══
                    // Client L114430: sends gameVersion via ToolCommon.getClientVer()
                    // Client TIDAK punya version comparison — purely server-side check.
                    if (gameVersion) {
                        log.details('version', [
                            ['clientGameVersion', gameVersion],
                            ['serverVersion', meta._serverVersion]
                        ]);
                        // TODO: implement version range check when needed:
                        // if (compareVersion(gameVersion, MIN_VERSION) < 0) {
                        //     callback(buildError(RET_CODES.VERSION_MISMATCH, ...), RET_CODES.VERSION_MISMATCH);
                        //     return;
                        // }
                    }

                    // ═══ PROSES DATA ═══

                    var storageKey = 'user:' + userId;
                    var savedData = db._get(storageKey);
                    var isNewUser = !savedData;

                    if (isNewUser) {
                        // ── NEW USER: build fresh default data ──
                        log.info('HANDLER', 'NEW USER — building default data');
                        savedData = buildNewUserResponse(request);
                    } else {
                        // ── RETURNING USER: merge dengan defaults ──
                        log.info('HANDLER', 'RETURNING USER — merging with defaults');

                        // ═══════════════════════════════════════════════════════
                        // 🔴 FIX BUG: Kid Goku muncul ulang setelah resolve + re-login
                        // ═══════════════════════════════════════════════════════
                        // ROOT CAUSE: deepMerge(saved, defaults) recurse ke
                        // heros._heros. defaults.heros._heros punya key '0' (kid goku).
                        // Jika saved.heros._heros tidak punya key '0' (sudah resolve),
                        // deepMerge line 2286 copy dari defaults → kid goku HIDUP LAGI.
                        //
                        // Client L133718: readByData(e.heros) → iterate e._heros[n]
                        // → SetHeroDataToModel → hero muncul di list.
                        //
                        // FIX: Simpan saved.heros._heros sebelum merge, restore
                        // setelah merge. Defaults hanya untuk schema, BUKAN untuk
                        // menambahkan hero yang sudah dihapus player.
                        // ═══════════════════════════════════════════════════════
                        var savedHeroes = (savedData.heros && savedData.heros._heros)
                            ? JSON.parse(JSON.stringify(savedData.heros._heros))
                            : null;

                        var freshDefaults = buildNewUserResponse(request);
                        savedData = deepMerge(savedData, freshDefaults);

                        // Restore hero list dari saved data (bukan defaults)
                        if (savedHeroes !== null) {
                            if (!savedData.heros) savedData.heros = {};
                            savedData.heros._heros = savedHeroes;
                            log.debug('HANDLER', 'HERO LIST RESTORED from saved data '
                                + '(protected ' + Object.keys(savedHeroes).length + ' heroes from defaults merge)');
                        }

                        savedData.newUser = false;

                        // ── DAILY RESET (6:00 AM boundary) ──
                        var didReset = checkDailyReset(savedData);

                        // ── TIMESINFO RECOVERY ──
                        computeTimesInfoRecovery(savedData);

                        // ── HANGUP REWARDS ──
                        computeHangupRewards(savedData);

                        log.details('merge', [
                            ['strategy', 'saved WINS, defaults fill missing'],
                            ['resultFields', String(Object.keys(savedData).length)],
                            ['dailyReset', didReset ? 'YES' : 'NO'],
                            ['checkinDay', String(savedData.checkin ? savedData.checkin._maxActiveDay : 0)]
                        ]);
                    }

                    // ── 🔴🔴🔴 GUILD DATA RECOVERY (CRITICAL FIX!) 🔴🔴🔴 ──
                    // ROOT CAUSE: User create guild → data tersimpan di DB.
                    // Saat relogin, enterGame return userGuild/userGuildPub KOSONG!
                    // Client terima _guildId: '' → user KELUAR GUILD!
                    //
                    // 📖 Client code (main.min.js L114933-114938):
                    //   e.setTeam(e) {
                    //     e.userGuild && t.setUserTeamInfoModel(e.userGuild),  ←🔴 HARUS ADA!
                    //     e.userGuildPub && t.setUserTeamInfoModel(e.userGuildPub),
                    //     void 0 != e.guildLevel && t.setMyTeamLevel(e.guildLevel),
                    //   }
                    // 📖 Client code (main.min.js L114795):
                    //   e.guildName && TeamInfoManager.getInstance().setTeamName(e.guildName)
                    recoverGuildDataForEnterGame(savedData, userId);

                    // ── CHECKIN UPDATE — for BOTH new and returning users ──
                    // BUG FIX: Previously only ran for returning users (inside else block).
                    // New users had _lastActiveDate = nowMs → checkinUpdate saw same-day → skipped.
                    // Now: buildDefaultCheckin sets _lastActiveDate = 0 → lastDateStr = '' → always
                    // different from today → day 1 unlocked on first login.
                    checkinUpdate(savedData);

                    // ── REPAIR ONLINE GIFT TIMER ──
                    // CRITICAL FIX: deepMerge mempreserves saved _onlineGift._nextTime = 0
                    // karena 0 bukan object → deepMerge line 1901: result[key] = sv (saved wins)
                    // Padahal freshDefaults sudah compute _nextTime = (now + 300) * 1000
                    // Tanpa repair, timer home screen stuck 0:00 selamanya.
                    repairOnlineGiftTimer(savedData);

                    // ── NORMALIZE RESPONSE DATA ──
                    // Fix fields that deepMerge can't reach (nested objects inside saved arrays).
                    // deepMerge preserves saved objects as-is — inner fields may be missing.
                    // Client SetEquipDataToModel (L82843) reads _suitItems/_suitAttrs/_equipAttrs
                    //   with .length and NO guard — undefined = crash.
                    normalizeResponseData(savedData);

                    // ── FIX: Remove null entries from ALL _items arrays ──
                    // ROOT CAUSE: Client HeroCostModel.deserialize (L5335:29242) does
                    //   a.id = n._items[o]._id — crashes if n._items[o] is null.
                    // deepMerge preserves saved arrays as-is, so corrupted nulls from
                    // IndexedDB survive into the response.
                    var nullCleanCount = cleanNullFromItemsArrays(savedData);
                    if (nullCleanCount > 0) {
                        log.warn('NORMALIZE', 'Cleaned nulls from ' + nullCleanCount + ' _items array(s)');
                    }

                    // ── REMOVE: questionnaires & userDownloadReward from response ──
                    // Returning user: deepMerge "saved WINS" → old savedData may still have
                    //   these fields → they leak into response → unwanted UI tabs appear.
                    // Client guards: L77669 e.questionnaires &&, L77652 if(e.userDownloadReward)
                    // So deleting the fields = client never sees them = tabs never appear.
                    delete savedData.questionnaires;
                    delete savedData.userDownloadReward;

                    // ── FIX: Rebuild dungeon._dungeons from _dungeonProgress ──
                    // ROOT CAUSE:
                    //   Client L77710-77714: setCounterpart reads e.dungeon._dungeons
                    //     → for-in → set _curMaxLevel & _lastLevel per type into CounterpartSingleton.
                    //   Client L161105-161108: getMaxLesson(dungeonType) reads from CounterpartSingleton.
                    //   Client L63521: if(getMaxLesson(EQUIP) >= selectedLevel) → auto-sweep.
                    //
                    //   buildNewUserResponse sets r.dungeon = { _dungeons: {} } (empty, correct for new).
                    //   checkBattleResult stores progress in savedData._dungeonProgress[type] = { _curMaxLevel, _lastLevel }.
                    //   deepMerge: savedData.dungeon._dungeons = {} (from defaults, no dungeon key in saved).
                    //   → Returning user ALWAYS gets _dungeons: {} → getMaxLesson() = 0 → NO AUTO-SWEEP.
                    //
                    //   ENERGY dungeon (type 3) is SKIPPED by client L59046:
                    //     e[n]._type == DUNGEON_TYPE.ENERGY || (...)
                    //   So we must NOT include type 3 in _dungeons.
                    //
                    // FIX: Convert savedData._dungeonProgress → savedData.dungeon._dungeons
                    //   BEFORE response is sent.

                    (function rebuildDungeonDungeons() {
                        var dp = savedData._dungeonProgress;
                        if (!dp || typeof dp !== 'object') return;  // no progress yet (new user or never cleared)

                        // Ensure savedData.dungeon exists (deepMerge may have set it to { _dungeons: {} })
                        if (!savedData.dungeon) savedData.dungeon = {};
                        var dungeons = {};
                        var converted = 0;

                        for (var typeKey in dp) {
                            var typeNum = Number(typeKey);
                            if (typeNum === 3) continue;  // ENERGY — skip (client ignores it)

                            var entry = dp[typeKey];
                            if (!entry || typeof entry !== 'object') continue;

                            // Only include types that have actual progress beyond initial state
                            var curMax = Number(entry._curMaxLevel) || 0;
                            var lastLvl = Number(entry._lastLevel) || 0;

                            // Include if player has ever cleared any level (curMax > 1 or lastLvl > 0)
                            // For safety, include ALL types that have progress entry
                            dungeons[typeKey] = {
                                _type: typeNum,
                                _curMaxLevel: curMax,
                                _lastLevel: lastLvl
                            };
                            converted++;
                        }

                        if (converted > 0) {
                            savedData.dungeon._dungeons = dungeons;
                            log.warn('DUNGEON_FIX', 'Rebuilt _dungeons from _dungeonProgress: ' + converted + ' types');
                        }
                    })();

                    // ── FIX: Force arena attack times = 5 ──
                    // ROOT CAUSE: AllRefreshCount._arenaAttackTimes (client) = 0 → shows "0/5"
                    //   Client L58000: constructor default = 0
                    //   Client L58006: initData reads scheduleInfo._arenaAttackTimes
                    //   Client L157624-157627: getBattleTime() = AllRefreshCount.arenaAttackTimes + "/" + constant[1].arenaAttackTimes
                    //   Client L63595: battle → AllRefreshCount.arenaAttackTimes-- (IN-MEMORY ONLY, not sent to server)
                    // WHY 0: deepMerge "saved WINS" → if savedData.scheduleInfo._arenaAttackTimes = 0 (stale),
                    //   it stays 0. Mock server doesn't track arena battle decrements,
                    //   so saved value should always be 5, but corrupted/old data may have 0.
                    // FIX: Force to default 5 for mock server (real server would track decrements).
                    if (savedData.scheduleInfo) {
                        savedData.scheduleInfo._arenaAttackTimes = 5;
                    }

                    // ── FIX: Main task chain completed — clear curMainTask ──
                    // ROOT CAUSE (Quest 44 / Task 6044 bug):
                    //   Task 6044 = task terakhir di chain (no nextTaskID).
                    //   Saat claim: getReward set curMainTask[0]._state = 3 (FINISH).
                    //   Saat re-login: enterGame return curMainTask = [{ _id:6044, _state:3 }].
                    //   Client setMianTask → _mainTask = { _id:6044, _state:3 } (non-null).
                    //   HomeMain.setMainTask() tidak punya handler state=3 → task group
                    //     tetap visible tapi broken (tidak masuk if COMPLETE/DOING/DEFAULT).
                    //   Client setMainTaskWithComplete([]) → jika _nextTasks = [] → _mainTask = null.
                    //     TAPI setMainTaskWithComplete HANYA dipanggil dari getReward response,
                    //     BUKAN dari enterGame response. enterGame pakai setMianTask → setMianTask
                    //     TIDAK handle array kosong — Object.keys([]).length = 0 → _mainTask = null.
                    //
                    // FIX: Jika curMainTask[0]._state === 3 (FINISH), kirim array kosong [].
                    //   Client setMianTask([]) → Object.keys([]).length <= 0 → _mainTask = null
                    //   → HomeMain.setMainTask: if(null == t) → mainTaskGroup.visible = !1
                    //   → Task HILANG dari home screen. PERMANEN.
                    //
                    //   Untuk task lain yang belum FINISH (state=1 DOING atau state=2 COMPLETE),
                    //   curMainTask tetap dikirim apa adanya — tidak ada perubahan.
                    //
                    //   State 2 (COMPLETE) di-preserve karena user mungkin belum claim.
                    //   State 1 (DOING) di-preserve karena task masih berjalan.

                    if (savedData.curMainTask && Array.isArray(savedData.curMainTask) && savedData.curMainTask.length > 0) {
                        if (Number(savedData.curMainTask[0]._state) === 3) {
                            log.debug('HANDLER', 'Main task already FINISH (state=3) — clearing curMainTask to empty array');
                            savedData.curMainTask = [];
                        }
                    }

                    // Update lastLoginTime (selalu, new maupun returning)
                    if (savedData.user) {
                        savedData.user._lastLoginTime = db.nowSeconds();
                    }

                    // ── INJECT BROADCAST & BULLETIN ──
                    injectBroadcastRecord(savedData);
                    injectOnlineBulletin(savedData);

                    // ── COMPUTE USER LEVEL for logging ──
                    var userLevel = computeUserLevel(savedData);

                    // Simpan ke DB (IndexedDB)
                    db._set(storageKey, savedData);

                    var elapsed = Date.now() - t0;

                    log.info('HANDLER', 'enterGame response ready — ' +
                        Object.keys(savedData).length + ' top-level fields (' + elapsed + 'ms)');
                    log.details('response', [
                        ['newUser', String(isNewUser)],
                        ['userId', savedData.user ? savedData.user._id : '-'],
                        ['userLevel', String(userLevel)],
                        ['heroCount', savedData.heros && savedData.heros._heros ?
                            String(Object.keys(savedData.heros._heros).length) : '0'],
                        ['fieldCount', String(Object.keys(savedData).length)],
                        ['checkinDay', String(savedData.checkin ? savedData.checkin._maxActiveDay : 0)],
                        ['broadcastCount', String((savedData.broadcastRecord || []).length)],
                        ['bulletinCount', String((savedData.onlineBulletin || []).length)],
                        ['elapsed', elapsed + 'ms']
                    ]);

                    // ═══ RESPONSE INTEGRITY LOGGER ═══
                    // Logs EVERY field that saveUserData (L77643-77669) reads.
                    // Client error: "Cannot read properties of undefined (reading 'length')"
                    // This logger catches ANY undefined/null field BEFORE callback.
                    // When error occurs, check this log block to find the culprit.
                    logAuditField(savedData, 'ARRAY FIELDS (client reads .length)', [
                        // Arrays that saveUserData iterates with .length directly
                        { path: 'broadcastRecord',            expect: 'array' },
                        { path: 'onlineBulletin',             expect: 'array' },
                        { path: 'ballBroadcast',              expect: 'array' },
                        { path: 'blacklist',                  expect: 'array' },
                        { path: 'hideHeroes',                 expect: 'array' },
                        { path: 'vipLog',                     expect: 'array' },
                        { path: 'cardLog',                    expect: 'array' },
                        { path: '_arenaTeam',                 expect: 'array' },
                        { path: '_arenaSuper',                expect: 'array' },
                        { path: 'teamDungeonInvitedFriends',  expect: 'array' },
                        { path: 'curMainTask',                expect: 'array' },
                        // Nested arrays inside objects
                        { path: 'totalProps._items',          expect: 'array' },
                        { path: 'imprint._items',             expect: 'array' },
                        { path: 'summon._wishList',            expect: 'array' },
                        { path: 'userGuild._requestedGuild',  expect: 'array' },
                        { path: 'userGuildPub._requestedGuild', expect: 'array' },
                        // warInfo nested arrays
                        { path: 'warInfo._rank64',            expect: 'array' },
                        { path: 'warInfo._rank16',            expect: 'array' },
                        // userTopBattle nested arrays
                        { path: 'userTopBattle._records',     expect: 'array' },
                        { path: 'userTopBattle._history',      expect: 'array' },
                        { path: 'userTopBattle._gotRankReward', expect: 'array' },
                        // Other nested arrays
                        { path: 'headEffect._effects',        expect: 'array' },
                        { path: 'expedition._collection',      expect: 'array' },
                        { path: 'timeBonusInfo._timeBonus',    expect: 'array' },
                        { path: 'gemstone._items',             expect: 'array' },
                        { path: 'timeTrial._gotStarReward',    expect: 'object' },  // client iterates with for-in, NOT .length
                        // scheduleInfo nested arrays
                        { path: 'scheduleInfo._teamDugeonUsedRobots', expect: 'array' },
                        // checkin nested arrays
                        { path: 'checkin._activeItem',         expect: 'array' },
                    ]);

                    logAuditField(savedData, 'EQUIP FIELDS (SetEquipDataToModel reads .length)', [
                        // equip._suits is an object, each suit has arrays that .length is called on
                        { path: 'equip', expect: 'object', deepAudit: '_suits' }
                    ]);

                    logAuditField(savedData, 'TOP BATTLE _bet (deserialize reads n[r].length)', [
                        { path: 'userTopBattle._bet', expect: 'object', deepAudit: true },
                        { path: 'userWar._bet',        expect: 'object', deepAudit: true }
                    ]);

                    logAuditField(savedData, 'CRITICAL OBJECTS (client reads without guard)', [
                        { path: 'user',           expect: 'object' },
                        { path: 'hangup',         expect: 'object' },
                        { path: 'summon',         expect: 'object' },
                        { path: 'scheduleInfo',   expect: 'object' },
                        { path: 'dragonEquiped',  expect: 'object' },
                        { path: 'superSkill',     expect: 'object' },
                        { path: 'clickSystem',    expect: 'object' },
                        { path: 'forbiddenChat',  expect: 'object' },
                        { path: 'channelSpecial', expect: 'object' },
                        { path: 'heroSkin',       expect: 'object' },
                        { path: 'resonance',      expect: 'object' },
                        { path: 'topBattleInfo',  expect: 'object' },
                        { path: 'fastTeam',       expect: 'object' },
                    ]);

                    logAuditField(savedData, 'HERO DATA (readByData reads hero fields)', [
                        { path: 'heros._heros', expect: 'object' },
                    ]);

                    logAuditField(savedData, 'GUILD DATA (setTeam reads guild fields)', [
                        { path: 'userGuild',     expect: 'object' },
                        { path: 'userGuildPub',  expect: 'object' },
                        { path: 'userGuild._tech',    expect: 'object' },
                        { path: 'userGuildPub._tech', expect: 'object' },
                    ]);

                    // ═══════════════════════════════════════════════
                    //  DEFENSIVE FILTER: Bersihkan imprint._items yang corrupt
                    // ═══════════════════════════════════════════════════════════
                    // Root cause (sudah ditelusuri):
                    //   - Client ImprintItem.deserialize membaca signEx[displayId].type
                    //   - Jika displayId TIDAK ADA di signEx.json → CRASH
                    //   - Contoh: _displayId=245 (seharusnya signPiece, bukan sign)
                    //   - Sumber: dulu mungkin handler lama yg tidak punya validasi
                    // Fix dua lapis:
                    //   1) openBox.js buildSignModel — validasi sebelum tulis (sudah fix)
                    //   2) enterGame.js di sini — filter sebelum kirim ke client
                    // ═══════════════════════════════════════════════════════════
                    try {
                        var filterImprint = savedData.imprint && savedData.imprint._items;
                        if (filterImprint && filterImprint.length > 0) {
                            var signExRef = loadJsonSync('signEx');
                            var thingsIDRef = loadJsonSync('thingsID'); // cache sekali untuk log
                            var validItems = [];
                            var removedCount = 0;

                            for (var fi = 0; fi < filterImprint.length; fi++) {
                                var fiItem = filterImprint[fi];
                                // Cek 1: item harus truthy (bukan null/undefined)
                                if (!fiItem) {
                                    log.warn('IMPRINT-FILTER', 'Removed null/undefined entry at index ' + fi);
                                    removedCount++;
                                    continue;
                                }
                                // Cek 2: _displayId harus ada dan valid number
                                var fiDispId = fiItem._displayId;
                                if (fiDispId === undefined || fiDispId === null || isNaN(Number(fiDispId))) {
                                    log.warn('IMPRINT-FILTER', 'Removed entry ' + (fiItem._signId || fi) + ' — invalid _displayId: ' + fiDispId);
                                    removedCount++;
                                    continue;
                                }
                                // Cek 3: _displayId harus ada di signEx.json
                                if (signExRef && !signExRef[String(fiDispId)]) {
                                    var typeInfo = (thingsIDRef && thingsIDRef[String(fiDispId)]) ? thingsIDRef[String(fiDispId)].thingsType : 'unknown';
                                    log.warn('IMPRINT-FILTER', 'Removed entry ' + (fiItem._signId || fi)
                                        + ' — _displayId=' + fiDispId + ' NOT in signEx.json'
                                        + ' (thingsType=' + typeInfo + ')'
                                        + ' full=' + JSON.stringify(fiItem));
                                    removedCount++;
                                    continue;
                                }
                                // Cek 4: _signId harus ada
                                if (!fiItem._signId) {
                                    log.warn('IMPRINT-FILTER', 'Removed entry at index ' + fi + ' — missing _signId');
                                    removedCount++;
                                    continue;
                                }
                                validItems.push(fiItem);
                            }

                            if (removedCount > 0) {
                                log.error('IMPRINT-FILTER', 'FILTERED ' + removedCount + '/' + filterImprint.length
                                    + ' invalid imprint items — data was corrupt and would crash client');
                                savedData.imprint._items = validItems;
                                // savedData akan di-_set ke DB oleh caller, jadi perubahan ini persist
                            }
                        }
                    } catch (filterErr) {
                        log.error('IMPRINT-FILTER', 'Defensive filter itself crashed: ' + filterErr.message + ' — sending data as-is');
                    }

                    callback(savedData);
                } catch (err) {
                    log.error('HANDLER', 'enterGame ERROR', err);
                    callback(buildError(RET_CODES.SERVER_ERROR, err.message || 'Unknown error'), RET_CODES.SERVER_ERROR);
                }
            }); // end validateLoginToken
        } catch (err) {
            log.error('HANDLER', 'enterGame UNCAUGHT ERROR', err);
            callback(buildError(RET_CODES.SERVER_ERROR, err.message || 'Unknown error'), RET_CODES.SERVER_ERROR);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  BATCH N: SERVER ADMIN FUNCTIONS (exposed via MainServer)
    // ═══════════════════════════════════════════════════════════
    //
    //  Admin functions untuk manage server state dari console/devtools.
    //  Dipanggil via: MainServer.admin.setMaintenance(true/false)
    //                 MainServer.admin.banUser(userId)
    //                 MainServer.admin.addBroadcast(msg)
    //                 MainServer.admin.addBulletin(bulletin)

    if (!MainServer.admin) {
        MainServer.admin = {};
    }

    /**
     * Toggle maintenance mode.
     * @param {boolean} enabled — true = maintenance, false = normal
     */
    MainServer.admin.setMaintenance = function (enabled) {
        updateServerMeta({ _maintenance: !!enabled });
        log.info('ADMIN', 'Maintenance mode: ' + (enabled ? 'ON' : 'OFF'));
    };

    /**
     * Ban/unban a user.
     * @param {string} userId — user to ban
     * @param {boolean} banned — true = ban, false = unban
     */
    MainServer.admin.banUser = function (userId, banned) {
        var meta = getServerMeta();
        if (!meta._bannedUsers) meta._bannedUsers = {};
        if (banned) {
            meta._bannedUsers[userId] = true;
        } else {
            delete meta._bannedUsers[userId];
        }
        db._set(SERVER_META_KEY, meta);
        log.info('ADMIN', 'User ' + userId + (banned ? ' BANNED' : ' UNBANNED'));
    };

    /**
     * Add server-wide broadcast message.
     * @param {object} msg — broadcast message object
     *   Required: _type, _kind, _name, _content
     *   Optional: _image, _param, _headEffect, _headBox, _showMain
     */
    MainServer.admin.addBroadcast = function (msg) {
        var meta = getServerMeta();
        if (!meta._broadcastQueue) meta._broadcastQueue = [];
        var now = Date.now();
        var broadcast = {
            _id: 'bc_' + now + '_' + Math.random().toString(36).substring(2, 8),
            _type: msg._type || 'system',
            _time: now,
            _kind: msg._kind || 'world',
            _name: msg._name || 'System',
            _content: msg._content || '',
            _image: msg._image || '',
            _param: msg._param || '',
            _headEffect: msg._headEffect || 0,
            _headBox: msg._headBox || 0,
            _oriServerId: msg._oriServerId || 1,
            _serverId: msg._serverId || 1,
            _showMain: !!msg._showMain
        };
        meta._broadcastQueue.push(broadcast);
        db._set(SERVER_META_KEY, meta);
        log.info('ADMIN', 'Broadcast added: ' + broadcast._id + ' — ' + broadcast._content);
    };

    /**
     * Clear all broadcast messages.
     */
    MainServer.admin.clearBroadcasts = function () {
        updateServerMeta({ _broadcastQueue: [] });
        log.info('ADMIN', 'All broadcasts cleared');
    };

    /**
     * Add server-wide online bulletin.
     * @param {object} bulletin — bulletin object
     *   Required: _startTime, _endTime, _info
     *   Optional: _interval, _duration
     */
    MainServer.admin.addBulletin = function (bulletin) {
        var meta = getServerMeta();
        if (!meta._onlineBulletins) meta._onlineBulletins = [];
        var entry = {
            _startTime: bulletin._startTime || Date.now(),
            _endTime: bulletin._endTime || (Date.now() + 86400000),
            _info: bulletin._info || '',
            _interval: bulletin._interval || 300000,
            _duration: bulletin._duration || 5000
        };
        meta._onlineBulletins.push(entry);
        db._set(SERVER_META_KEY, meta);
        log.info('ADMIN', 'Bulletin added: ' + entry._info);
    };

    /**
     * Clear all online bulletins.
     */
    MainServer.admin.clearBulletins = function () {
        updateServerMeta({ _onlineBulletins: [] });
        log.info('ADMIN', 'All bulletins cleared');
    };

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('user', 'enterGame', handleEnterGame);

    window.MainServer = MainServer;
})();
