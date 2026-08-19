/**
 * handlers/user/clickSystem.js — User Click System Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: user/clickSystem
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Tandai bahwa user telah mengklik tombol "Privilege" (Fund) di panel
 *   Chapter Main atau Temple Trial. Setelah klik, red dot di tombol
 *   privilege hilang (supaya user tidak terus-terusan diingatkan).
 *
 *   Server-side: persist klik state ke user data (`clickSystem._clickSys[sysType] = true`).
 *   Client-side: callback langsung set local state, tidak baca response.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js):
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [L148726-148735] TempleTrial.privilegeBtnTap → isClicksys():
 *     ts.processHandler({
 *         type: "user",
 *         action: "clickSystem",
 *         sysType: CLICK_SYSTEM.TEMPLE_FUND,  // = 2
 *         userId: <userId>
 *     }, function(e) {
 *         // e (response) TIDAK DIBACA!
 *         UserClickSingleton.getInstance().setClickSys(CLICK_SYSTEM.TEMPLE_FUND, true)
 *     })
 *
 *   [L159922-159931] ChapterMain.privilegeBtnTap → isClicksys():
 *     ts.processHandler({
 *         type: "user",
 *         action: "clickSystem",
 *         sysType: CLICK_SYSTEM.LESSON_FUND,  // = 1
 *         userId: <userId>
 *     }, function(e) {
 *         UserClickSingleton.getInstance().setClickSys(CLICK_SYSTEM.LESSON_FUND, true)
 *     })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EVIDENCE: BUKTI BUKAN ASUMSI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * [UserClickSingleton class] L62225-62242:
 *   function e() {
 *       this.clickSystem = {
 *           _id: UserInfoSingleton.getInstance().userId,
 *           _clickSys: {
 *               1: false,    // LESSON_FUND — initial: NOT clicked
 *               2: false     // TEMPLE_FUND — initial: NOT clicked
 *           }
 *       }
 *   }
 *   setClickSys(e, t) → this.clickSystem._clickSys[e] = t
 *   getCurClickSys(e) → this.clickSystem._clickSys[e]
 *
 * [CLICK_SYSTEM enum] L62244-62247:
 *   LESSON_FUND = 1
 *   TEMPLE_FUND = 2
 *
 * [UserDataParser.saveUserData] L77645-77646 (enterGame response handler):
 *   if (e.clickSystem)
 *       for (var n in e.clickSystem._clickSys)
 *           UserClickSingleton.getInstance().setClickSys(n, e.clickSystem._clickSys[n]);
 *   → Saat login, client baca savedData.clickSystem._clickSys dan override local state.
 *   → JADI SERVER WAJIB PERSIST state ini di savedData.clickSystem._clickSys.
 *
 * [checkPrivilegeRed] L59475-59488:
 *   var t = UserClickSingleton.getInstance().getCurClickSys(CLICK_SYSTEM.LESSON_FUND);
 *   if (!t) return true;   // NOT clicked → show red dot
 *   ...
 *   → Red dot logic: jika _clickSys[1] === false → tampilkan red dot.
 *
 * [TrialManager.checkPrivileRed] L79584:
 *   var o = UserClickSingleton.getInstance().getCurClickSys(CLICK_SYSTEM.TEMPLE_FUND);
 *   if (!o) return true;   // NOT clicked → show red dot
 *
 * [enterGame default] L1368:
 *   r.clickSystem = { _clickSys: { 1: false, 2: false } };
 *   → New user default: both unclicked (red dot tampil).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TASK INVOLVEMENT?
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ❌ TIDAK ADA TASK yang terkait dengan clickSystem.
 *   - task.json (MAIN): 0 match untuk "clickSystem", "click", "fund", "privilege"
 *   - taskDaily.json: 0 match
 *   - taskAchievement.json: 0 match
 *   - main.min.js callback (L148733, L159929): TIDAK baca response, TIDAK trigger task refresh
 *   - mainTaskChange notify TIDAK perlu dikirim
 *
 *   Handler ini PURE persistence — simpan state, return success.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REQUEST FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   {
 *       type: "user",
 *       action: "clickSystem",
 *       sysType: <number>,   // 1 = LESSON_FUND, 2 = TEMPLE_FUND
 *       userId: <string>
 *   }
 *
 *   Note: TIDAK ada `version` field di request (beda dari handler lain).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Callback di client (L148733, L159929) TIDAK MEMBACA response apapun.
 *   Hanya set local state setelah callback dipanggil.
 *   → Server bisa return apa saja (asalkan ret=0).
 *
 *   Mock response: { _clickSys: { <sysType>: true } }
 *   (Field ini opsional, hanya untuk debugging — client tidak baca)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STORAGE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   User data key: user:{userId}
 *   Field: savedData.clickSystem = { _clickSys: { 1: bool, 2: bool } }
 *
 *   enterGame.js L1368 sudah init default:
 *     r.clickSystem = { _clickSys: { 1: false, 2: false } };
 *
 *   Setelah handler ini jalan:
 *     savedData.clickSystem._clickSys[sysType] = true
 *
 *   Saat user login lagi (enterGame response):
 *     UserDataParser L77645-77646 baca savedData.clickSystem._clickSys
 *     dan set ke UserClickSingleton → red dot tidak muncul lagi.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT ERROR HANDLING
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Callback TIDAK punya error handler. ret=1 akan menyebabkan "Unknown Error".
 *   Semua validation failure → return ret=0 dengan {} (empty).
 *   Sebenarnya client tetap set local state di callback, jadi self-healing,
 *   tapi tetap return ret=0 untuk konsistensi.
 *
 * ═══════════════════════════════════════════════════════════════════════
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
    //  CONSTANTS — verified dari main.min.js L62244-62247
    // ═══════════════════════════════════════════════════════════

    var CLICK_SYSTEM = {
        LESSON_FUND: 1,
        TEMPLE_FUND: 2
    };

    var VALID_SYS_TYPES = {
        1: 'LESSON_FUND',
        2: 'TEMPLE_FUND'
    };

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleClickSystem(request, callback) {
        // OUTER SAFETY NET — client callback TIDAK baca response,
        // tapi ret=1 masih bikin "Unknown Error". Wrap agar aman.
        try {
            _handleClickSystemImpl(request, callback);
        } catch (err) {
            log.error('HANDLER', 'user/clickSystem — UNCAUGHT EXCEPTION: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            callback({});  // ret=0 empty — client self-heal via local setClickSys
        }
    }

    function _handleClickSystemImpl(request, callback) {
        var userId = request && request.userId;
        var sysType = Number(request && request.sysType);

        log.info('HANDLER', 'user/clickSystem — START'
            + ' (userId=' + (userId || '-') + ', sysType=' + sysType
            + ' (' + (VALID_SYS_TYPES[sysType] || 'UNKNOWN') + '))');

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'user/clickSystem — missing userId');
            callback({});  // ret=0 — client self-heal
            return;
        }

        if (!VALID_SYS_TYPES[sysType]) {
            log.error('HANDLER', 'user/clickSystem — invalid sysType: ' + sysType
                + ' (only 1=LESSON_FUND, 2=TEMPLE_FUND supported)');
            callback({});
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HANDLER', 'user/clickSystem — user data not found: ' + key);
            callback({});
            return;
        }

        // Ensure clickSystem structure exists (default match enterGame.js L1368)
        if (!savedData.clickSystem) {
            savedData.clickSystem = { _clickSys: { 1: false, 2: false } };
            log.info('HANDLER', 'user/clickSystem — initialized default clickSystem');
        }
        if (!savedData.clickSystem._clickSys) {
            savedData.clickSystem._clickSys = { 1: false, 2: false };
        }

        // ── CHECK CURRENT STATE ──
        var sysKey = String(sysType);
        var wasClicked = savedData.clickSystem._clickSys[sysKey] === true;

        if (wasClicked) {
            // Idempotent — already clicked, no change needed
            log.info('HANDLER', 'user/clickSystem — sysType=' + sysType
                + ' (' + VALID_SYS_TYPES[sysType] + ') already true — no-op');
            callback({ _clickSys: { sysType: sysType, state: true, changed: false } });
            return;
        }

        // ── UPDATE STATE ──
        savedData.clickSystem._clickSys[sysKey] = true;

        // Also ensure _id field set (for client UserClickSingleton structure compat)
        if (!savedData.clickSystem._id) {
            savedData.clickSystem._id = userId;
        }

        // ── SAVE USER DATA ──
        db._set(key, savedData);

        log.info('HANDLER', 'user/clickSystem — SUCCESS: sysType=' + sysType
            + ' (' + VALID_SYS_TYPES[sysType] + ') false → true'
            + ' (red dot akan hilang setelah login ulang)');

        // ── BUILD RESPONSE ──
        // Client callback (L148733, L159929) TIDAK baca response.
        // Return debugging info saja.
        var response = {
            _clickSys: {
                sysType: sysType,
                state: true,
                changed: true
            }
        };

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('user', 'clickSystem', handleClickSystem);

})();
