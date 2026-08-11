/**
 * handlers/activity/getActivityBrief.js — Activity Brief List Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: activity/getActivityBrief
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Return daftar ringkasan activity yang sedang aktif untuk user.
 *   Cukup untuk ROUTING di sisi client (group by actCycle -> 1 tombol per
 *   cycle, sort by displayIndex DESC, render sub-tab list di dalam panel).
 *   BUKAN untuk menampilkan detail reward — itu tugas getActivityDetail.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js):
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [L57530] TSUIController.backToActivityPage:
 *     ts.processHandler({
 *         type: "activity", action: "getActivityBrief",
 *         userId: <userId>, version: "1.0"
 *     }, function(o) {
 *         // iterate o._acts, filter by actCycle==targetCycle
 *         // match id untuk firstSetActId
 *         // runScene("BaseActivity", { actsData: filtered, ... })
 *     })
 *
 *   [L168092] Home.setActs:
 *     ts.processHandler({
 *         type: "activity", action: "getActivityBrief",
 *         userId: <userId>, version: "1.0"
 *     }, function(t) {
 *         // iterate t._acts
 *         // group by actCycle -> 1 button per unique cycle
 *         // push actCycle to n[] array for setAllActSmallItem(n)
 *         // special-case routing: ITEM_DROP, NEW_USER_MAIL, FREE_INHERIT,
 *         //   FB/IOS GIVELIKE, OFFLINE_ACT, OFFLINE_ACT_TWO
 *     })
 *
 *   [L103401] BaseActivityViewData.setActivityList:
 *     // post-process actsData dari params
 *     // sort by displayIndex DESC: t.displayIndex - e.displayIndex
 *     // build ActivitySmallList item: { activityIconBg, poolId, actId,
 *     //   activityCycle, showRed, activityType }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({ _acts: <object keyed by String(actType)> })
 *
 *   Per-entry fields (verified dibaca client):
 *     id            string    wajib  - dipakai sebagai key, dikirim ke
 *                                       getActivityDetail sebagai actId
 *     actType       number    wajib  - dipakai untuk routing & filtering
 *                                       (L168104, L103415)
 *     actCycle      number    wajib  - dipakai untuk grouping 1 button per
 *                                       cycle (L57542, L168104)
 *     displayIndex  number    wajib  - sort DESC di sub-tab list
 *                                       (L103406: t.displayIndex - e.displayIndex)
 *     icon          string    wajib  - sub-tab card icon (L103410 → L95867)
 *                                       HTTP path ke hero portrait
 *     showRed       boolean   wajib  - red dot indicator (L103414)
 *     poolId        number    wajib  - dikirim ke getActivityDetail (L103411,
 *                                       L96447)
 *     endTime       number    opsional - kapan activity berakhir (L168102,
 *                                       dipakai untuk regression/timeLimitBags)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ACTIVITY CYCLE & TYPE ENUMS (client L79029-79174 + L79722-79725)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ACTIVITY_CYCLE.SUMMON = 5
 *     - ActivityCycleInfoMap[5] = { titleImg: "huodongnew175_png",
 *                                    homeIcon: "zhujiemiannew106_png",
 *                                    sort: 58 }
 *     - titleImg → di-render sebagai activityCycleImage (header "Theme Card
 *       Pool" + "DRAGON BALL" baked-in image, client-side hardcoded)
 *     - homeIcon → di-render sebagai tombol SUMMON di home screen
 *
 *   ACTIVITY_TYPE.NORMAL_LUCK = 3001  (panel: ActivityNormalLuck)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * NORMAL_LUCK — THEME CARD POOL
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   NORMAL_LUCK adalah event gacha "Theme Card Pool" — pool hero SS yang
 *   selalu berganti-ganti. Di server asli, 1 cycle SUMMON berisi MULTIPLE
 *   entries NORMAL_LUCK (4 card thumbnail = 4 pool hero berbeda).
 *
 *   Untuk trial ini, kita fokus 1 entry (1 tab) dulu:
 *     - 1 entry NORMAL_LUCK dengan featured hero 1600 (Shenron, SSS)
 *
 *   Saat user tap tombol SUMMON di home → 1 button muncul.
 *   Saat user masuk panel SUMMON → 1 sub-tab muncul (NORMAL_LUCK).
 *   Saat user tap sub-tab → client call getActivityDetail dengan
 *     { actId: "3001", cycleType: 5, poolId: 1 }.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONFIG GAMBAR — SUB-TAB CARD ICON
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   brief.icon → activityIconBg (L103410) → activitySmallIcon (L95867)
 *
 *   Client L95867 (ActivitySmallListItem.processAll):
 *     ToolCommon.setUrlImage(e.data.activityIconBg, e.activitySmallIcon)
 *
 *   setUrlImage L52360-52367:
 *     - indexOf("http") == -1 → else branch
 *     - replace("/activity/", "/activity_<lang>/") — HINDARI path dengan
 *       "/activity/" karena akan di-replace ke folder yang tidak ada
 *     - n.source = protocol + "//" + host + path
 *
 *   Image yang dipakai: hero_icon_long (portrait orientation)
 *     Path: /resource/assets/image/public/hero_related/hero_icon_long/hero_icon_1600_long.png
 *     Resource key: hero_icon_1600_long_png (verified di default.res-en.json)
 *
 *   Catatan: hero_icon_long = portrait icon (fit di card thumbnail 194×160).
 *   Jangan pakai hero_picture (landscape full art) — tidak fit di card.
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS — subset of client enums (L79029, L79722)
    // ═══════════════════════════════════════════════════════════

    var ACTIVITY_CYCLE = {
        SUMMON: 5,
        HOLIDAY: 8
    };

    var ACTIVITY_TYPE = {
        NORMAL_LUCK: 3001,
        HERO_HELP: 3013,
        LANTENBLESSING: 5035,
        CANDLE_SHOP: 5012
    };

    /**
     * Sub-tab card icon HTTP path.
     *
     * Pakai huodongnew225.png (181×166, square) — verified ada di local user.
     * Cocok untuk card thumbnail (skin 194×160).
     *
     * ⚠️ PENTING: setUrlImage (L52360-52367) akan replace `/activity/` →
     * `/activity_en/` (untuk bahasa English). Jadi path dikirim dengan
     * `activity_en` langsung supaya TIDAK di-replace lagi.
     *
     * Path asli file: /resource/assets/image/en/ui/activity/huodongnew225.png
     * Path yang dikirim: /resource/assets/image/en/ui/activity_en/huodongnew225.png
     *
     * USER HARUS: buat folder `activity_en` dan copy file ke sana, ATAU
     * buat symlink: `cd resource/assets/image/en/ui/ && ln -s activity activity_en`
     */
    var NORMAL_LUCK_ICON_PATH = '/resource/assets/image/en/ui/activity_en/huodongnew225.png';

    /**
     * Sub-tab card icon untuk LANTENBLESSING (cycle HOLIDAY).
     *
     * Lantern Blessing tab icon — huodongnew946.png.
     *
     * Client L95867:
     *   e.data.activityIconBg && e.data.activityIconBg.length > 0 &&
     *     ToolCommon.setUrlImage(e.data.activityIconBg, e.activitySmallIcon)
     */
    var LANTENBLESSING_ICON_PATH = '/resource/assets/image/en/ui/activity_en/huodongnew946.png';

    /**
     * Sub-tab card icon untuk HERO_HELP (cycle SUMMON, tab ketiga).
     *
     * Pakai huodongnew104.png — verified ada di local user (folder activity_en).
     *
     * ⚠️ setUrlImage (L52360-52367) akan replace `/activity/` → `/activity_en/`.
     * Path pakai `activity_en` langsung supaya tidak di-replace lagi.
     *
     * Path asli file: /resource/assets/image/en/ui/activity/huodongnew104.png
     * Path yang dikirim: /resource/assets/image/en/ui/activity_en/huodongnew104.png
     *
     * USER HARUS: file huodongnew104.png harus ada di folder `activity_en`
     * (atau buat symlink: `ln -s activity activity_en`).
     */
    var HERO_HELP_ICON_PATH   = '/resource/assets/image/en/ui/activity_en/huodongnew104.png';

    /**
     * Sub-tab card icon untuk CANDLE SHOP (cycle HOLIDAY).
     * Tab icon: huodongnew955.png
     */
    var CANDLE_SHOP_ICON_PATH = '/resource/assets/image/en/ui/activity_en/huodongnew955.png';

    /**
     * Sub-tab card icon untuk NORMAL_LUCK Tab 2 (poolId: 2, cycle SUMMON).
     *
     * Pakai huodongnew113.jpg — icon tab "cardPool" (Summon Return).
     *
     * ⚠️ setUrlImage (L52360-52367) akan replace `/activity/` → `activity_en/`.
     * Path pakai `activity_en` langsung supaya tidak di-replace lagi.
     */
    var NORMAL_LUCK_TAB2_ICON_PATH = '/resource/assets/image/en/ui/activity_en/huodongnew113.jpg';

    /**
     * Definisi activity yang aktif untuk trial ini.
     *
     * Trial: 1 entry NORMAL_LUCK di cycle SUMMON (5).
     * Featured hero: 1600 (Shenron, SSS superOrange).
     *
     * displayIndex menentukan urutan render di sub-tab list
     * (sort DESC — angka lebih besar muncul lebih dulu).
     *
     * Field 'id' (string) = actType sebagai string. Dipakai sebagai key
     * _acts dan dikirim kembali ke getActivityDetail sebagai actId.
     */
    var ACTIVE_ACTIVITIES = [
        // ── Cycle SUMMON (5) — Tab 1: Theme Card Pool (EXISTING) ──
        {
            actType:       ACTIVITY_TYPE.NORMAL_LUCK,
            actCycle:      ACTIVITY_CYCLE.SUMMON,
            displayIndex:  100,
            poolId:        1,
            showRed:       false,
            endTime:       0
        },
        // ── Cycle SUMMON (5) — Tab 2: Card Pool / Summon Return (BARU) ──
        {
            actType:       ACTIVITY_TYPE.NORMAL_LUCK,
            actCycle:      ACTIVITY_CYCLE.SUMMON,
            displayIndex:  99,
            poolId:        2,
            showRed:       false,
            endTime:       0
        },
        // ── Cycle SUMMON (5) — Tab 3: Hero Coming for Rescue ──
        // Dipindahkan dari HOLIDAY ke SUMMON
        {
            actType:       ACTIVITY_TYPE.HERO_HELP,
            actCycle:      ACTIVITY_CYCLE.SUMMON,
            displayIndex:  200,
            poolId:        1,
            showRed:       false,
            endTime:       0
        },
        // ── Cycle HOLIDAY (8) — Tab 1: Lantern Blessing ──
        {
            actType:       ACTIVITY_TYPE.LANTENBLESSING,
            actCycle:      ACTIVITY_CYCLE.HOLIDAY,
            displayIndex:  100,
            poolId:        1,
            showRed:       false,
            endTime:       0
        },
        // ── Cycle HOLIDAY (8) — Tab 2: Candle Shop (SHOP panel) ──
        {
            actType:       ACTIVITY_TYPE.CANDLE_SHOP,  // 5012 = ACTIVITY_TYPE.SHOP
            actCycle:      ACTIVITY_CYCLE.HOLIDAY,
            displayIndex:  90,
            poolId:        1,
            showRed:       false,
            endTime:       0
        }
    ];

    // ═══════════════════════════════════════════════════════════
    //  HELPER — build single _acts entry
    // ═══════════════════════════════════════════════════════════
    //
    //  Return object dengan field lengkap yang dibaca client.
    //  Field order mengikuti urutan baca client:
    //    id, actType, actCycle, icon, showRed, displayIndex, poolId, endTime
    //
    //  Catatan:
    //    - 'id' HARUS string (client L57541: var u = l.id; dipakai sebagai
    //      object key dan dikirim sebagai actId string ke getActivityDetail)
    //    - 'icon' = HTTP path ke hero portrait. Client L103410:
    //      activityIconBg: t[o].icon — dipakai untuk card thumbnail icon
    //      di panel BaseActivity.
    //    - 'endTime' = 0 artinya tidak ada batas waktu (trial).
    //      Client L168102: r.endTime && (...) — falsy 0 di-skip.
    //

    /**
     * Get icon HTTP path untuk actType + poolId.
     * 
     * Evidence: Client L103410: activityIconBg: t[o].icon
     * Routing:
     *   - HERO_HELP (3013)          → huodongnew104.png
     *   - LANTENBLESSING (5035)     → default skin (empty)
     *   - NORMAL_LUCK (3001) poolId:2 → huodongnew113.jpg (Tab 2 BARU)
     *   - NORMAL_LUCK (3001) poolId:1 → huodongnew225.png (Tab 1, default)
     */
    function getIconPath(actType, poolId) {
        if (actType === ACTIVITY_TYPE.HERO_HELP) {
            return HERO_HELP_ICON_PATH;
        }
        if (actType === ACTIVITY_TYPE.LANTENBLESSING) {
            return LANTENBLESSING_ICON_PATH;
        }
        if (actType === ACTIVITY_TYPE.CANDLE_SHOP) {
            return CANDLE_SHOP_ICON_PATH;
        }
        if (actType === ACTIVITY_TYPE.NORMAL_LUCK && poolId === 2) {
            return NORMAL_LUCK_TAB2_ICON_PATH;  // Tab 2: cardPool icon
        }
        return NORMAL_LUCK_ICON_PATH;  // default: Tab 1 NORMAL_LUCK
    }

    function buildAct(def) {
        // Evidence L103412: actId: t[o].id → dikirim ke getActivityDetail
        // Tab 1 (poolId:1) → id = "3001" (ORIGINAL, backward compatible)
        // Tab 2 (poolId:2) → id = "3001_2" (BARU, unik)
        var actId = (def.poolId === 2) 
            ? String(def.actType) + '_' + def.poolId  
            : String(def.actType);
        
        return {
            id:           actId,
            actType:      def.actType,
            actCycle:     def.actCycle,
            icon:         getIconPath(def.actType, def.poolId),
            showRed:      def.showRed,
            displayIndex: def.displayIndex,
            poolId:       def.poolId,
            endTime:      def.endTime
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetActivityBrief(request, callback) {
        var userId = request && request.userId;

        log.info('ACTIVITY', 'activity/getActivityBrief START — userId=' + (userId || '-'));

        try {
            // ── VALIDATE userId ──
            // Client L168089 / L57529: userId wajib dikirim dari
            // UserInfoSingleton.getInstance().userId.
            // Kalau missing -> return ret=1 (generic error), client
            // tampilkan error tips via ErrorHandler.ShowErrorTips.
            if (!userId) {
                log.warn('ACTIVITY', 'getActivityBrief — missing userId');
                callback({}, 1);
                return;
            }

            // ── BUILD _acts ──
            // Object keyed by String(actType). Client iterate dengan
            // for-in (L57539, L168100), jadi urutan key insertion =
            // urutan iterasi (TAPI sort akhir pakai displayIndex).
            //
            // Trial: 1 entry NORMAL_LUCK di cycle SUMMON.
            // Tidak ada cek state user (level, dll) untuk trial ini.
            // Tidak ada cek server time / endTime untuk trial ini.
            var acts = {};
            for (var i = 0; i < ACTIVE_ACTIVITIES.length; i++) {
                var def = ACTIVE_ACTIVITIES[i];
                var entry = buildAct(def);
                acts[entry.id] = entry;
            }

            // ── LOG SUCCESS ──
            var actCount = Object.keys(acts).length;
            log.info('ACTIVITY', 'getActivityBrief SUCCESS — '
                + actCount + ' activities returned, cycle SUMMON(5)');
            log.details('response', [
                ['userId',       userId],
                ['acts.count',   actCount],
                ['cycles',       'SUMMON(5)'],
                ['actTypes',     Object.keys(acts).join(', ')]
            ]);

            // ── CALLBACK ──
            // Framework wrap dengan buildEnvelope:
            //   { ret: 0, data: JSON.stringify({_acts: acts}),
            //     compress: false, serverTime, server0Time }
            // Handler TIDAK set serverTime/server0Time (framework inject).
            callback({ _acts: acts });

        } catch (err) {
            log.error('ACTIVITY', 'getActivityBrief UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════
    //
    //  Flat key registration: MainServer.handlers['activity/getActivityBrief']
    //  Lazy load: index.js loadHandlerScript inject <script src=".../getActivityBrief.js">
    //  Saat script ini load, registerHandler resolve pending callbacks.
    //

    MainServer.registerHandler('activity', 'getActivityBrief', handleGetActivityBrief);
})();
