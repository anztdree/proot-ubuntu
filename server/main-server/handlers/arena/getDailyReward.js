/**
 * handlers/arena/getDailyReward.js — Arena Get Daily Reward Handler (v3 — 22:00 RESET)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  STUDI MENDALAM DARI main.min.js — FINDINGS:
 * ============================================================
 *
 *  CLIENT REQUEST (L158358-158361):
 *    { type: "arena", action: "getDailyReward", userId }
 *
 *  CLIENT RESPONSE CALLBACK (L158362-158365):
 *    var n = response;
 *    a._myRankRewardTag = n._dailyRewardTag   // update data panel
 *    t.hasGotReward = !0                       // hide receive btn, show "received"
 *    UIWindowManager.openCongratulationObtain(n) // popup reward items
 *    e.setTop()
 *
 *  openCongratulationObtain (L56636-56651):
 *    - Cek t._changeInfo → baca t._changeInfo._items
 *    - Jika TIDAK ada _changeInfo → "没有任何东西！！！" → popup TIDAK muncul
 *    - Jika ada → ItemsCommonSingleton.openCommonItemGetTips(items, ...)
 *    - items = Object keyed by STRING item ID: { "101": { _id, _num }, ... }
 *    - _num = ABSOLUTE NEW BALANCE (sama pattern semua handler lain)
 *
 *  TAG SYSTEM (L157553, L157561-157564):
 *    - _rankReawardTag = array tag yang sudah diklaim (dari arena/join → _rewardTag)
 *    - _myRankRewardTag = tag klaim terakhir (dari arena/join → _arena._dailyRewardTag)
 *    - hasGotReward() = loop cek _myRankRewardTag in _rankReawardTag
 *    - Jika true → setReceived() hide receive btn
 *
 *  REWARD TABLE — arenaEverydayAward.json (client-side config):
 *    14 tier: rank 1 → 999999
 *    Setiap tier punya topRankAward1..4 + num1..4
 *    Item IDs: 101=EXP, 102=Gold, 112=Arena Medal, 501=?
 *    Client L158541-158565: initEveryDayRewardList() baca config ini
 *
 *  ARENA STATE (in-memory, MainServer._arenaStates[userId]):
 *    _rank: number          → current rank
 *    _dailyRewardTag: ''    → tag klaim terakhir
 *    _rewardTags: []        → array semua tag yang sudah diklaim
 *
 * ============================================================
 *  BUG YANG DIFIX (v1 → v2):
 * ============================================================
 *
 *  BUG 1 (CRITICAL): Server restart → double claim hari yang sama
 *    OLD: Cek duplikat hanya di in-memory _rewardTags.
 *         Server restart → _rewardTags = [] → user bisa klaim ulang.
 *    FIX: Persist savedData._arenaLastDailyClaim ke DB.
 *         Cek duplikat di BOTH in-memory _rewardTags DAN DB field.
 *         Setelah klaim, tulis ke KEDUA tempat.
 *
 *  BUG 2 (MEDIUM): _rewardTags[] grows forever (memory leak)
 *    OLD: Tag di-push ke array, tidak pernah dihapus.
 *         Setelah berbulan-bulan, array bisa ratusan entry.
 *    FIX: Setiap klaim, bersihkan tag yang lebih tua dari 30 hari.
 *         Parsing tag "arena_daily_YYYYMMDD" → bandingkan tanggal.
 *
 *  BUG 3 (MEDIUM): Empty changeItems → popup error
 *    OLD: Kalau semua reward slot = 0/invalid, changeItems = {}.
 *         Client L56637: _changeInfo ada tapi _items kosong →
 *         popup mungkin crash atau tampilkan "没有任何东西！！！".
 *    FIX: Jika granted == 0, reject dengan error. Jangan kirim
 *         response dengan _changeInfo kosong.
 *
 *  BUG 4 (LOW): Fallback tier pakai Object.keys() order
 *    OLD: var keys = Object.keys(awardCfg); tier = awardCfg[keys[keys.length-1]];
 *         JSON key order tidak guaranteed (meskipun V8 biasanya preserve).
 *    FIX: Cari tier dengan rankStart tertinggi sebagai fallback.
 *
 *  BUG 5 (LOW): arenaState._rank || 2001 → rank 0 dianggap invalid
 *    OLD: _rank || 2001 — jika rank = 0 (falsy), fallback ke 2001.
 *    FIX: Explicit cek typeof === 'number' && !isNaN().
 *
 *  BUG 6 (NOTE): Client button visibility pasca-restart
 *    arena/join.js membuat state baru dengan _dailyRewardTag:'' dan
 *    _rewardTags:[]. Jika user sudah klaim hari ini sebelum restart,
 *    client akan tampilkan tombol (karena _myRankRewardTag='' tidak
 *    match di _rankReawardTag=[] → hasGotReward()=false).
 *    Tapi server TETAP menolak (BUG 1 fix cek DB).
 *    UX: tombol visible tapi klik → error "already claimed".
 *    FIX LENGKAP: Perlu update arena/join.js untuk restore
 *    _dailyRewardTag dan _rewardTags dari DB saat init.
 *    (Bukan scope file ini, tapi perlu dilakukan nanti.)
 *
 *  BUG 7 (v3): Daily reset jam 22:00, bukan midnight
 *    OLD: generateDailyTag() pakai tanggal lokal saat ini.
 *         Reset terjadi di 00:00 (midnight).
 *    FIX: Game daily reset pukul 22:00. Jika jam < 22 → "game day"
 *         adalah kemarin. Jika jam >= 22 → "game day" adalah hari ini.
 *         Contoh: 17 Juli jam 11:00 → game day = 16 Juli
 *                  17 Juli jam 23:00 → game day = 17 Juli
 *         Tag format tetap "arena_daily_YYYYMMDD" tapi YYYYMMDD
 *         dihitung dari "game day", bukan kalender day.
 *
 * ============================================================
 *  TUGAS UTAMA:
 * ============================================================
 *    1. VALIDASI request (userId)
 *    2. GET arena state + user data
 *    3. GENERATE tag hari ini (format: "arena_daily_YYYYMMDD", reset 22:00)
 *    4. CEK sudah klaim hari ini? (in-memory _rewardTags + DB _arenaLastDailyClaim)
 *    5. LOOKUP rank → match arenaEverydayAward.json tier
 *    6. EXTRACT 4 reward items dari tier → GRANT (akumulasi, bukan overwrite)
 *    7. UPDATE state: push tag, set _dailyRewardTag, persist ke DB
 *    8. CLEANUP: hapus tag > 30 hari dari _rewardTags
 *    9. SAVE db
 *   10. RESPONSE: { _dailyRewardTag, _changeInfo: { _items } }
 *
 * ============================================================
 *  TUGAS YANG BUKAN MILIK FILE INI:
 * ============================================================
 *    - Init arena state (itu tugas arena/join)
 *    - Battle & rank update (itu tugas arena/startBattle)
 *    - Top rank history reward (itu tugas lain, pakai arenaTopRankAward.json)
 *    - Restore _dailyRewardTag dari DB saat join (itu tugas arena/join)
 *
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var RET_CODES = {
        OK: 0,
        MISSING_USERID: 10001,
        NO_ARENA_STATE: 10002,
        ALREADY_CLAIMED: 10003,
        NO_REWARD_TIER: 10004,
        NO_REWARDS: 10005,
        SERVER_ERROR: 99999
    };

    /** Berapa hari tag lama disimpan di _rewardTags sebelum di-clean */
    var TAG_RETENTION_DAYS = 30;

    /** Fallback rank kalau arenaState._rank invalid */
    var INITIAL_RANK = 2001;

    /** Game daily reset pukul 22:00 (10 PM) */
    var DAILY_RESET_HOUR = 22;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADERS (cached sync XHR) — sama pattern startBattle.js
    // ═══════════════════════════════════════════════════════════

    var _configCache = {};

    function _loadJson(url, label) {
        if (_configCache[url]) return _configCache[url];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _configCache[url] = JSON.parse(xhr.responseText);
            }
        } catch (e) {
            log.warn('ARENA_DAILY', 'Failed to load ' + label + ' — ' + e.message);
        }
        return _configCache[url] || {};
    }

    function loadArenaEverydayAwardCfg() {
        return _loadJson('./resource/json/arenaEverydayAward.json', 'arenaEverydayAward.json');
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS — sama pattern startBattle.js L307-357
    //  Server storage: savedData.totalProps._items = [{_id, _num}, ...]
    //  Response: _changeInfo._items = { "itemId": { _id, _num: ABSOLUTE } }
    // ═══════════════════════════════════════════════════════════

    /**
     * Get current balance of an item from savedData.
     */
    function getBal(sd, id) {
        var items = sd && sd.totalProps && sd.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    /**
     * Set absolute balance of an item in savedData.
     */
    function setBal(sd, id, val) {
        if (!sd.totalProps) sd.totalProps = { _items: [] };
        if (!sd.totalProps._items) sd.totalProps._items = [];
        var items = sd.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) {
                items[i]._num = val;
                return val;
            }
        }
        items.push({ _id: id, _num: val });
        return val;
    }

    /**
     * Grant reward: add amount to item balance, record in changeItems for response.
     * CRITICAL: _num di response = ABSOLUTE NEW BALANCE.
     * Client L63406: ItemsCommonSingleton.getInstance().setItem(c, n[u]._num)
     *
     * Akumulasi, BUKAN overwrite:
     *   oldBal = getBal() → dapat balance sekarang
     *   newBal = oldBal + amount → TAMBAH, bukan ganti
     *   setBal(savedData, id, newBal) → simpan balance baru
     *   changeItems[id] = { _id, _num: newBal } → kirim ke client
     */
    function grantReward(savedData, changeItems, itemId, amount) {
        if (!itemId || itemId <= 0 || !amount || amount <= 0) return 0;
        var oldBal = getBal(savedData, itemId);
        var newBal = oldBal + amount;
        setBal(savedData, itemId, newBal);
        changeItems[String(itemId)] = { _id: itemId, _num: newBal };
        log.details('REWARD', ['item', String(itemId), '+' + String(amount), '=' + String(newBal)]);
        return newBal;
    }

    // ═══════════════════════════════════════════════════════════
    //  TAG GENERATOR & PARSER
    // ═══════════════════════════════════════════════════════════

    /**
     * Generate daily reward tag berdasarkan "game day".
     * Format: "arena_daily_20260716"
     *
     * BUG 7 FIX: Game daily reset pukul DAILY_RESET_HOUR (22:00).
     *   - Jika jam < 22:00 → game day = KEMARIN
     *   - Jika jam >= 22:00 → game day = HARI INI
     *
     * Contoh:
     *   17 Juli jam 11:36 → game day = 16 Juli → tag = "arena_daily_20260716"
     *   17 Juli jam 23:00 → game day = 17 Juli → tag = "arena_daily_20260717"
     *   18 Juli jam 21:59 → game day = 17 Juli → tag = "arena_daily_20260717"
     *   18 Juli jam 22:00 → game day = 18 Juli → tag = "arena_daily_20260718"
     *
     * Di pukul 22:00, tag berubah → user bisa klaim lagi (reset otomatis).
     */
    function generateDailyTag() {
        var d = new Date();
        if (d.getHours() < DAILY_RESET_HOUR) {
            d.setDate(d.getDate() - 1);
        }
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return 'arena_daily_' + y + m + day;
    }

    /**
     * Parse tag → Date object. Return null jika format salah.
     * Tag format: "arena_daily_YYYYMMDD"
     */
    function parseTagToDate(tag) {
        if (!tag || typeof tag !== 'string') return null;
        var match = tag.match(/^arena_daily_(\d{4})(\d{2})(\d{2})$/);
        if (!match) return null;
        var y = Number(match[1]);
        var m = Number(match[2]) - 1; // JS month 0-indexed
        var d = Number(match[3]);
        var date = new Date(y, m, d);
        // Validasi: parse kembali, pastikan tidak overflow (e.g. Feb 30)
        if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) {
            return null;
        }
        return date;
    }

    // ═══════════════════════════════════════════════════════════
    //  FIND REWARD TIER BY RANK
    // ═══════════════════════════════════════════════════════════

    /**
     * Cari tier di arenaEverydayAward.json yang cocok dengan rank.
     * Config: { "1": { rankStart:1, rankEnd:1, topRankAward1:101, num1:600, ... }, ... }
     * Logic sama dengan client L158494-158501 (getReward function).
     *
     * @param {Object} cfg — parsed arenaEverydayAward.json
     * @param {number} rank — player current rank
     * @returns {Object|null} tier entry atau null
     */
    function findRewardTier(cfg, rank) {
        for (var key in cfg) {
            if (!cfg.hasOwnProperty(key)) continue;
            var tier = cfg[key];
            var start = Number(tier.rankStart);
            var end = Number(tier.rankEnd);
            if (rank >= start && rank <= end) {
                return tier;
            }
        }
        return null;
    }

    /**
     * BUG 4 FIX: Cari fallback tier dengan rankStart TERTINGGI.
     * Tidak bergantung pada Object.keys() order.
     */
    function findHighestRankStartTier(cfg) {
        var bestTier = null;
        var bestStart = -1;
        for (var key in cfg) {
            if (!cfg.hasOwnProperty(key)) continue;
            var tier = cfg[key];
            var start = Number(tier.rankStart);
            if (start > bestStart) {
                bestStart = start;
                bestTier = tier;
            }
        }
        return bestTier;
    }

    // ═══════════════════════════════════════════════════════════
    //  TAG CLEANUP — BUG 2 FIX
    // ═══════════════════════════════════════════════════════════

    /**
     * Bersihkan tag yang lebih tua dari TAG_RETENTION_DAYS dari _rewardTags.
     * Mencegah memory leak. Dipanggil setelah setiap klaim berhasil.
     *
     * @param {Array} rewardTags — arenaState._rewardTags (MUTATED)
     */
    function cleanupOldTags(rewardTags) {
        if (!Array.isArray(rewardTags) || rewardTags.length <= 1) return;

        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - TAG_RETENTION_DAYS);
        var cutoffTime = cutoff.getTime();

        var before = rewardTags.length;
        for (var i = rewardTags.length - 1; i >= 0; i--) {
            var tagDate = parseTagToDate(rewardTags[i]);
            if (tagDate && tagDate.getTime() < cutoffTime) {
                rewardTags.splice(i, 1);
            }
        }

        var removed = before - rewardTags.length;
        if (removed > 0) {
            log.details('ARENA_DAILY', 'Cleaned ' + removed + ' old tags from _rewardTags (retention=' +
                TAG_RETENTION_DAYS + 'd, remaining=' + rewardTags.length + ')');
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ERROR BUILDER — sama pattern startBattle.js L1331-1336
    // ═══════════════════════════════════════════════════════════

    function buildError(code, msg) {
        if (msg) {
            log.warn('ARENA_DAILY', 'Error ' + code + ': ' + msg);
        }
        return {};
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleArenaGetDailyReward(request, callback) {
        try {
            // ═══ STEP 1: VALIDASI ═══
            var userId = request.userId;
            if (!userId) {
                log.warn('ARENA_DAILY', 'Missing userId');
                callback(buildError(RET_CODES.MISSING_USERID, 'Missing userId'), RET_CODES.MISSING_USERID);
                return;
            }

            // ═══ STEP 2: GET ARENA STATE + USER DATA ═══
            var arenaState = (MainServer._arenaStates && MainServer._arenaStates[userId]) || null;

            // Jika arena state belum ada, user belum pernah buka arena
            if (!arenaState) {
                log.warn('ARENA_DAILY', 'No arena state for userId=' + userId + ' — user never opened arena');
                callback(buildError(RET_CODES.NO_ARENA_STATE, 'No arena state'), RET_CODES.NO_ARENA_STATE);
                return;
            }

            var dbKey = 'user:' + userId;
            var savedData = db._get(dbKey);
            if (!savedData) {
                log.warn('ARENA_DAILY', 'User data not found: ' + userId);
                callback(buildError(RET_CODES.SERVER_ERROR, 'User data not found'), RET_CODES.SERVER_ERROR);
                return;
            }

            // ═══ STEP 3: GENERATE TAG HARI INI ═══
            var todayTag = generateDailyTag();

            // ═══ STEP 4: CEK SUDAH KLAIM? (BUG 1 FIX — double check) ═══
            //
            // Cek DUA sumber:
            //   A) In-memory: arenaState._rewardTags[] → cepat, untuk session ini
            //   B) Persisted DB: savedData._arenaLastDailyClaim → anti server-restart exploit
            //
            var alreadyClaimed = false;

            // A) In-memory check
            var rewardTags = arenaState._rewardTags || [];
            for (var i = 0; i < rewardTags.length; i++) {
                if (rewardTags[i] === todayTag) {
                    alreadyClaimed = true;
                    break;
                }
            }

            // B) DB persistence check (BUG 1 FIX)
            // Ini menangani kasus: server restart → _rewardTags kosong,
            // tapi user sudah klaim hari ini sebelum restart.
            if (!alreadyClaimed && savedData._arenaLastDailyClaim === todayTag) {
                alreadyClaimed = true;
                // Sync: restore ke in-memory supaya konsisten
                if (arenaState._rewardTags) {
                    arenaState._rewardTags.push(todayTag);
                } else {
                    arenaState._rewardTags = [todayTag];
                }
                arenaState._dailyRewardTag = todayTag;
                log.info('ARENA_DAILY', 'Restored daily claim from DB for userId=' + userId +
                    ' tag=' + todayTag + ' (server restart recovery)');
            }

            if (alreadyClaimed) {
                log.info('ARENA_DAILY', 'Daily reward already claimed today — userId=' + userId + ' tag=' + todayTag);
                callback(buildError(RET_CODES.ALREADY_CLAIMED, 'Already claimed today'), RET_CODES.ALREADY_CLAIMED);
                return;
            }

            // ═══ STEP 5: LOOKUP REWARD TIER BERDASARKAN RANK (BUG 5 FIX) ═══
            var rank = arenaState._rank;
            if (typeof rank !== 'number' || isNaN(rank)) {
                rank = INITIAL_RANK;
            }

            var awardCfg = loadArenaEverydayAwardCfg();
            var tier = findRewardTier(awardCfg, rank);

            if (!tier) {
                // BUG 4 FIX: Cari tier dengan rankStart tertinggi (bukan Object.keys order)
                tier = findHighestRankStartTier(awardCfg);
                if (tier) {
                    log.warn('ARENA_DAILY', 'No matching tier for rank=' + rank + ', using highest tier (rankStart=' + tier.rankStart + ')');
                } else {
                    log.error('ARENA_DAILY', 'arenaEverydayAward.json empty or missing');
                    callback(buildError(RET_CODES.NO_REWARD_TIER, 'No reward config'), RET_CODES.NO_REWARD_TIER);
                    return;
                }
            }

            // ═══ STEP 6: EXTRACT 4 REWARD SLOTS & GRANT (AKUMULASI) ═══
            var changeItems = {};
            var granted = 0;

            // Config format: topRankAward1..4 + num1..4
            // Setiap slot: grantReward → oldBal + amount → newBal (AKUMULASI, bukan overwrite)
            for (var slot = 1; slot <= 4; slot++) {
                var itemId = Number(tier['topRankAward' + slot]);
                var amount = Number(tier['num' + slot]);
                if (itemId > 0 && amount > 0) {
                    grantReward(savedData, changeItems, itemId, amount);
                    granted++;
                }
            }

            // BUG 3 FIX: Jika tidak ada reward yang valid, jangan kirim response kosong
            if (granted === 0) {
                log.error('ARENA_DAILY', 'No valid rewards in tier id=' + (tier.id || '?') +
                    ' rank=' + rank + ' — all slots are 0 or invalid');
                callback(buildError(RET_CODES.NO_REWARDS, 'No valid rewards for current rank'), RET_CODES.NO_REWARDS);
                return;
            }

            // ═══ STEP 7: UPDATE STATE (in-memory + DB persistence) ═══
            if (!arenaState._rewardTags) arenaState._rewardTags = [];
            arenaState._rewardTags.push(todayTag);
            arenaState._dailyRewardTag = todayTag;

            // BUG 1 FIX: Persist ke DB agar survive server restart
            savedData._arenaLastDailyClaim = todayTag;

            // BUG 2 FIX: Cleanup tag lama (> 30 hari) dari in-memory
            cleanupOldTags(arenaState._rewardTags);

            // ═══ STEP 8: SAVE DB (1x write — sama pattern BUG 5 fix startBattle.js) ═══
            db._set(dbKey, savedData);

            // ═══ STEP 9: ASSEMBLE RESPONSE ═══
            // Client L158365: n._dailyRewardTag → set ke data._myRankRewardTag
            // Client L56637: t._changeInfo → t._changeInfo._items → popup
            var response = {
                _dailyRewardTag: todayTag,
                _changeInfo: {
                    _items: changeItems
                }
            };

            log.info('ARENA_DAILY', 'Daily reward claimed — userId=' + userId +
                ' rank=' + rank + ' tier=' + (tier.id || '?') +
                ' tag=' + todayTag + ' items=' + granted);

            callback(response);

        } catch (err) {
            log.error('ARENA_DAILY', 'arena/getDailyReward UNCAUGHT ERROR', err);
            callback(buildError(RET_CODES.SERVER_ERROR, err.message || 'Unknown error'), RET_CODES.SERVER_ERROR);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('arena', 'getDailyReward', handleArenaGetDailyReward);

    window.MainServer = MainServer;
})();