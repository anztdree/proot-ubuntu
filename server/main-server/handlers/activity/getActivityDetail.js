/**
 * handlers/activity/getActivityDetail.js — Activity Detail Handler (TRIAL: NORMAL_LUCK + HERO_HELP + LANTENBLESSING)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: activity/getActivityDetail
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Return detail lengkap 1 activity berdasarkan actId. Client pakai untuk
 *   render panel activity (sub-tab yang di-tap user di BaseActivity).
 *
 *   TRIAL SCOPE: Hanya handle actType 3001 (NORMAL_LUCK).
 *   actType lain (mis. SUPER_GIFT) akan return error ret=1 sampai handler
 *   di-extend nanti.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js):
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Entry point (L96441-96448) — BaseActivity.changeDetalActivityView:
 *     ts.processHandler({
 *         type: "activity", action: "getActivityDetail",
 *         userId: <userId>,
 *         actId: <id dari brief>,
 *         cycleType: <actCycle dari brief = 5>,
 *         poolId: <poolId dari brief = 1>,
 *         version: "1.0"
 *     }, function(t) {
 *         UserInfoSingleton.getInstance().certificationLevel = t.certificationLevel;
 *         ActivityManager.getInstance().changeEndTime(t);
 *         var o = t.act._activityType;  // routing ke panel class
 *         switch(o) {
 *             case ACTIVITY_TYPE.NORMAL_LUCK:
 *                 n = "ActivityNormalLuck";
 *                 break;
 *             // ... case lain
 *         }
 *         e.createChild(n, { parent:"Activity", value: t });
 *     })
 *
 *   Call site lain (L57986, L89549, L89888, L90394, L90867, L91416, L93151,
 *   L94037, L94230, L94244, L95953, L98188, L98964, L105928, L168118,
 *   L168193) — semua untuk actType lain (FB/IOS GiveLike, OfflineAct,
 *   NewHeroChallenge, recharge refresh, dll). TIDAK relevan untuk trial ini.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L96450 + L79851-79889)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       certificationLevel: <number>,
 *       act: <ActivityBase fields + type-specific>,
 *       uact: <UserActivityBase fields + type-specific>
 *   })
 *
 *   Catatan:
 *     - 'forceEndTime' optional (L79588 changeEndTime baca ini untuk
 *       override act._endTime). Trial tidak include.
 *     - Field 'act' dan 'uact' HARUS semua _-prefixed (deserialize client
 *       pakai `this[t.substring(1)] = n` untuk field yang isCommonType).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * NORMAL_LUCK RESPONSE STRUCTURE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Class hierarchy (verified L79851, L80248-80268, L103241-103271):
 *     NormalLuckActivity extends ActivityBase
 *       - tambahan fields: _randHero, _task, _notProtectSHero, _des2
 *       - _randHero: RandGroupItems (L79762-79780)
 *       - _task: ActivityTaskItem (L79864-79876) — TIDAK dipakai NormalLuck
 *                panel, boleh omit (default kosong di constructor)
 *     UserNormalLuckActivity extends UserActivityBase
 *       - tambahan field: _curCount (number, dipakai L103247)
 *
 *   ActivityBase fields (verified L79854 constructor defaults):
 *     _id, _name, _des, _icon, _image, _displayIndex, _activityType,
 *     _cycleType, _enable, _timeType, _newUserUsing, _startDay,
 *     _durationDay, _startTime, _endTime, _showRed
 *
 *   UserActivityBase fields (verified L79880 constructor defaults):
 *     _startTime, _endTime, _activityId, _loopTag
 *
 *   RandGroupItems structure (verified L79762-79780):
 *     {
 *       _randId: <number>,
 *       _groups: {
 *         "<key>": {
 *           _groupId: <number>,
 *           _totalWeight: <number>,
 *           _items: [
 *             { _itemId: <heroId>, _num: <count>, _weight: <weight> },
 *             ...
 *           ]
 *         }
 *       }
 *     }
 *
 *   RandItem fields (verified L79730-79742):
 *     _itemId, _num, _weight
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIELDS YANG DIBACA NORMAL_LUCK PANEL (verified L95698-95834, L103241-103271)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   act._id              — L95781, L95795 (actId untuk handler normalLuck)
 *   act._activityType    — L96452 (routing switch)
 *   act._cycleType       — deserialize only
 *   act._endTime         — L103263 (fallback kalau uact._endTime kosong)
 *   act._image           — L103268 getBgSource → L95710 setUrlImage(bg)
 *   act._notProtectSHero — L95714 (toggle visibility label proteksi S hero)
 *   act._des2            — L95807 lookAllHeroBtnTap (hero pool tooltip text)
 *                          Kalau "" → fallback ke summonRandom config
 *   act._randHero        — L103253 getHeroList (preview hero pool)
 *
 *   uact._curCount       — L103247 (progress summon user)
 *   uact._endTime        — L103263 (prioritas sebelum act._endTime)
 *
 *   Field TIDAK dibaca di NormalLuck panel:
 *     act._name, act._icon, act._des, act._displayIndex, act._enable,
 *     act._timeType, act._newUserUsing, act._startDay, act._durationDay,
 *     act._startTime, act._showRed, act._task (semua di-deserialize only)
 *     uact._startTime, uact._activityId, uact._loopTag
 *
 *   Semua field tetap dikirim (sesuai ActivityBase / UserActivityBase
 *   contract) supaya deserialize client tidak missing property.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TRIAL DATA
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Waktu: unlimited (endTime = 4102444800000 = 2100-01-01 00:00:00 UTC)
 *   Level: tidak ada gating (trial bebas)
 *
 *   Hero pool (randHero):
 *     Group "1" (totalWeight 1000):
 *       - 1600 Shenron (superOrange)         weight 500  ← featured utama
 *       - 1318 (orange)                      weight 150
 *       - 1301 (purple)                      weight 150
 *       - 1201 (blue)                        weight 100
 *       - 1102 (green)                       weight 50
 *       - 1001 (white)                       weight 50
 *
 *   Source konfigurasi hero quality:
 *     hero.json[<id>].quality = superOrange|orange|purple|blue|green|white
 *     1600  → superOrange (Shenron / dragonSoul)
 *     1318  → orange
 *     1301  → purple
 *     1201  → blue
 *     1102  → green
 *     1001  → white
 *
 *   Image:
 *     act._image = "/resource/assets/image/public/hero_related/hero_picture/hero_picture_1600.jpg"
 *     (path verified dari default.res-en.json resources[]:
 *      name="hero_picture_1600_jpg",
 *      url="assets/image/public/hero_related/hero_picture/hero_picture_1600.jpg?v=315148")
 *     Game di-serve dari htdocs root, file resource ada di folder /resource/,
 *     jadi HTTP path diawali /resource/.
 *     Client setUrlImage L52360-52367:
 *       - indexOf("http") == -1 → else branch
 *       - replace("/activity/", "/activity_<lang>/") — no match, path tetap
 *       - n.source = protocol + "//" + host + path
 *         → http://<host>/resource/assets/image/public/hero_related/hero_picture/hero_picture_1600.jpg
 *     File ada di local user (offline bundle), TIDAK di repo ini.
 *
 *   Task: TIDAK ada task yang terlibat di NormalLuck panel
 *     (verified Q3 — _task di-deserialize tapi tidak ditampilkan)
 *     Tetap dikirim kosong supaya constructor default class tidak break:
 *       _task: { _des:"", _target:0, _reward:{ _normalReward:{_items:[]},
 *                                            _randReward:[], _anyReward:{} } }
 *
 *   certificationLevel: 0 (default, L96450 set ke UserInfoSingleton)
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var ACTIVITY_TYPE = {
        NORMAL_LUCK: 3001,
        HERO_HELP: 3013,
        LANTENBLESSING: 5035
    };

    var ACTIVITY_CYCLE = {
        SUMMON: 5,
        HOLIDAY: 8
    };

    /**
     * 4102444800000 = 2100-01-01 00:00:00 UTC (ms).
     * Trial: unlimited time. Client L103263 baca uact._endTime dulu,
     * kalau 0/falsey fallback ke act._endTime. Pakai nilai masa depan
     * besar supaya countdown timer tampilkan "2100-01-01" — bukti
     * unlimited.
     */
    var TRIAL_END_TIME = 4102444800000;

    /**
     * Hero pool untuk NormalLuck.
     *
     * Pool ini hanya untuk PREVIEW UI (tombol "Look All Hero" L95804).
     * Roll summon sebenarnya di-handle oleh handler activity/normalLuck
     * (terpisah, belum di-build).
     *
     * Hero ID + quality (verified dari resource/json/hero.json):
     *   1600 → superOrange (Shenron, dragonSoul, featured utama)
     *   1318 → orange
     *   1301 → purple
     *   1201 → blue
     *   1102 → green
     *   1001 → white
     *
     * Weight: featured (Shenron) 500, lalu menurun sesuai quality tier.
     * totalWeight = 500+150+150+100+50+50 = 1000.
     */
    var NORMAL_LUCK_HERO_POOL = [
        { itemId: 1600, num: 1, weight: 500 },
        { itemId: 1318, num: 1, weight: 150 },
        { itemId: 1301, num: 1, weight: 150 },
        { itemId: 1201, num: 1, weight: 100 },
        { itemId: 1102, num: 1, weight: 50  },
        { itemId: 1001, num: 1, weight: 50  }
    ];

    var NORMAL_LUCK_TOTAL_WEIGHT = 1000;

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * TAB 3 (poolId: 2) — Card Pool
     * ═══════════════════════════════════════════════════════════════════════
     *
     * Shenron 5%, SSS hero 3% each, sisanya purple sesuai logika.
     * Total weight = 330 (original).
     *
     *   Shenron:  17/330 = 5.15%
     *   SSS each: 10/330 = 3.03%
     *   Purple:   ~48/330 = ~14.5% each
     */
    var NORMAL_LUCK_TAB2_HERO_POOL = [
        // SSS HEROES (7 non-Shenron) — 3% each (weight 10/330)
        { itemId: 1512, num: 1, weight: 10 },  // Gotenks SS3
        { itemId: 1609, num: 1, weight: 10 },  // Vegeta SSG
        { itemId: 1608, num: 1, weight: 10 },  // Golden Frieza
        { itemId: 1602, num: 1, weight: 10 },  // Whis
        { itemId: 1601, num: 1, weight: 10 },  // Goku SSG
        { itemId: 1505, num: 1, weight: 10 },  // Majin Buu Fat
        { itemId: 1514, num: 1, weight: 10 },  // Goku SS3

        // SHENRON — 5% (weight 17/330)
        { itemId: 1600, num: 1, weight: 17 },  // Shenron Dragon

        // PURPLE HEROES — rest = 330 - 70 - 17 = 243
        { itemId: 1301, num: 1, weight: 49 },  // Saiyan Child
        { itemId: 1205, num: 1, weight: 49 },  // Tortoise
        { itemId: 1309, num: 1, weight: 49 },  // Crane School
        { itemId: 1310, num: 1, weight: 48 },  // Purple Hero
        { itemId: 1305, num: 1, weight: 48 }   // Kami / Namekian
    ];

    var NORMAL_LUCK_TAB2_TOTAL_WEIGHT = 330;

    /**
     * Image path untuk background panel (act._image).
     *
     * Pakai huodongnew224.jpg — banner NormalLuck yang verified ada di
     * local user (folder activity_en).
     *
     * ⚠️ PENTING — Path HARUS relative (TIDAK boleh mengandung "http"):
     *
     * setUrlImage (L52360-52367) punya 2 path:
     *   PATH 1: indexOf("http") > -1 → SetUrlImage.load → t.texture = n
     *           → Set texture LANGSUNG, eui.Image TIDAK auto-update size
     *           → activityBG (no width/height di skin) tetap 0×0 → INVISIBLE!
     *   PATH 2: else → n.source = protocol + "//" + host + t
     *           → Set source string, eui.Image load internal + AUTO-UPDATE SIZE
     *           → Image visible dengan natural dimensions
     *
     * Karena activityBG di skin TIDAK punya width/height, WAJIB pakai PATH 2.
     * Maka path dikirim RELATIVE (tanpa "http" prefix).
     *
     * ⚠️ setUrlImage juga replace `/activity/` → `/activity_<lang>/`.
     * Path pakai `activity_en` langsung supaya tidak di-replace lagi.
     *
     * USER HARUS: file huodongnew224.jpg harus ada di folder
     * `activity_en` (atau buat symlink: `ln -s activity activity_en`).
     */
    var NORMAL_LUCK_IMAGE = '/resource/assets/image/en/ui/activity_en/huodongnew224.jpg';

    /**
     * Background image untuk NormalLuck Tab 2 (poolId: 2) — Card Pool / Summon Return.
     *
     * Pakai huodongnew112.jpg — background panel cardPool.
     *
     * Evidence: Client L103268: getBgSource() → act._image → setUrlImage(bg)
     */
    var NORMAL_LUCK_TAB2_IMAGE = '/resource/assets/image/en/ui/activity_en/huodongnew112.jpg';

    /**
     * actId untuk NORMAL_LUCK. HARUS match dengan yang dikirim oleh
     * getActivityBrief.js (id = String(actType) = "3001").
     */
    var NORMAL_LUCK_ACT_ID = '3001';  // Tab 1 (EXISTING) - JANGAN UBAH!

    /**
     * actId untuk NORMAL_LUCK Tab 2 (poolId: 2) — Card Pool / Summon Return (BARU).
     * Format dari getActivityBrief.js: String(actType) + '_' + poolId = "3001_2"
     */
    var NORMAL_LUCK_TAB2_ACT_ID = '3001_2';

    /**
     * actId untuk LANTENBLESSING. HARUS match dengan yang dikirim oleh
     * getActivityBrief.js (id = String(actType) = "5035").
     */
    var LANTENBLESSING_ACT_ID = '5035';

    /**
     * actId untuk HERO_HELP. HARUS match dengan yang dikirim oleh
     * getActivityBrief.js (id = String(actType) = "3013").
     */
    var HERO_HELP_ACT_ID   = '3013';
    var CANDLE_SHOP_ACT_ID  = '5012';  // ACTIVITY_TYPE.SHOP → SuperGiftBuyWithOtherActivity panel
    var CANDLE_SHOP_IMAGE   = '/resource/assets/image/en/ui/activity_en/huodongnew954.jpg';

    /**
     * Image path untuk background panel HERO_HELP (act._image).
     *
     * Pakai huodongnew46.jpg — verified ada di local user (folder activity_en).
     *
     * ⚠️ setUrlImage (L52360-52367) akan replace `/activity/` → `/activity_en/`.
     * Path pakai `activity_en` langsung supaya tidak di-replace lagi.
     *
     * Path asli file: /resource/assets/image/en/ui/activity/huodongnew46.jpg
     * Path yang dikirim: /resource/assets/image/en/ui/activity_en/huodongnew46.jpg
     *
     * USER HARUS: file huodongnew46.jpg harus ada di folder `activity_en`
     * (atau buat symlink: `ln -s activity activity_en`).
     */
    var HERO_HELP_IMAGE = '/resource/assets/image/en/ui/activity_en/huodongnew46.jpg';

    /**
     * Konfigurasi HeroHelpActivityItem untuk act._items{}.
     *
     * Struktur (verified dari main.min.js L80200 HeroHelpActivityItem):
     *   _costHero     — number (jumlah hero yang dijadikan biaya)
     *   _costDiamond  — number (jumlah diamond yang dijadikan biaya)
     *   _heroClass    — number (HERO_CLASS enum: 0=NULL, 1=STRENGTH, 2=SKILL, 3=BODY)
     *   _heroQuality  — number (BattleLogic.HERO_COLOR enum: 1=White...7=SuperOrange)
     *   _displayId    — number (hero display ID yang dijadikan BIAYA)
     *   _vip          — number (VIP requirement, 0 = no gate)
     *   _goods        — ActivityReward (hero yang dihasilkan sebagai REWARD)
     *
     * Client L92452 (ExchangeHeroActListItem.processAll):
     *   - t.goods.normalReward[0].id → hero reward display ID
     *   - t.goods.normalReward[0].num → hero reward count
     *   - t.displayId → hero cost display ID (kalau ada, specific hero)
     *   - t.costHero → jumlah hero cost
     *   - t.costDiamond → jumlah diamond cost
     *   - t.heroClass, t.heroQuality → class/quality cost (kalau displayId=0)
     *   - t.vip → VIP requirement
     *
     * 52 SSS heroes untuk rotasi Hero Rescue.
     * Limited/excluded heroes (NOT in pool):
     *   1600 (Shenron/Dragon), 1603 (Beerus),
     *   1619 (Gogeta), 1634 (Super Android 17), 1635 (Three-Star Dragon),
     *   1636 (Broly), 1637 (Myers), 1638 (One-Star Dragon), 1639 (Four-Star Dragon),
     *   1646 (Conic), 1647 (Gogeta), 1648 (Cell), 1649 (Hearts),
     *   1650 (Piccolo), 1651 (Fu), 1652 (Time Kaiōshin), 1653 (Gohan),
     *   1654 (Kame Sennin), 1655 (Vegeta), 1656 (Krillin), 1657 (Goku), 1658 (Bulma)
     *
     * Cost: Shenron (1600) x 1 + 8888 diamond per hero. Reward: 1 SSS hero copy.
     */
    var HERO_HELP_ITEMS = [
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1505 },  // Majin Buu
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1512 },  // Gotenks
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1513 },  // Majin Buu
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1514 },  // Goku
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1515 },  // Gohan
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1516 },  // Vegito
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1601 },  // Goku (God)
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1602 },  // Whis
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1604 },  // Broly
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1605 },  // Vegeta (God)
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1606 },  // Goku (God)
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1607 },  // Goku (Future)
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1608 },  // Frieza
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1609 },  // Vegeta (Future)
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1610 },  // Vados
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1611 },  // Champa
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1612 },  // Hit
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1613 },  // Black Goku
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1614 },  // Rumsshi
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1615 },  // Janembo
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1616 },  // Kusu
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1617 },  // Cooler
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1618 },  // Kale
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1620 },  // Android 17
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1621 },  // Zamasu
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1622 },  // Vegeta (Future)
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1623 },  // Goku (UI)
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1624 },  // Marcarita
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1625 },  // Belmod
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1626 },  // Kefla
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1627 },  // Dyspo
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1628 },  // Toppo
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1629 },  // Heles
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1630 },  // Sawaa
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1631 },  // Jiran
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1632 },  // Baby
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1633 },  // Goku
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1640 },  // Zamasu
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1641 },  // Trunks
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1642 },  // Toppo
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1643 },  // Vegeta
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1644 },  // Jiran
        { costHero: 1, costDiamond: 8888, heroClass: 0, heroQuality: 0, displayId: 1600, vip: 0, rewardHeroId: 1645 }   // Quitela
    ];

    /**
     * Image path untuk background panel LANTENBLESSING (act._image).
     *
     * TRIAL: Set ke string kosong "" supaya client pakai DEFAULT resource
     * dari skin ActivityLanternBlessingSkin (default: yingxiongxinxibeijing_jpg
     * atau apapun yang ada di skin).
     *
     * Client L95710: ToolCommon.setUrlImage(t.getBgSource(), e.actBg)
     *   getBgSource() → act._image → background image path
     *
     * Path pakai `activity_en` langsung supaya setUrlImage TIDAK
     * replace `/activity/` → `/activity_en/` lagi (L52360-52367).
     *
     * Path asli file: /resource/assets/image/en/ui/activity/huodongnew929.jpg
     * Path yang dikirim: /resource/assets/image/en/ui/activity_en/huodongnew929.jpg
     */
    var LANTENBLESSING_IMAGE = '/resource/assets/image/en/ui/activity_en/huodongnew929.jpg';

    /**
     * Konfigurasi 14 LanternBlessItem untuk act._items[].
     *
     * Setiap item punya:
     *   _lightReward: reward kalau lantern dinyalakan (sukses)
     *   _failReward: reward kalau gagal (fallback)
     *
     * Client L90465: e.initItemGroup → iterate o.length (harus 14)
     * Client L90489: o[t].lightReward[0].id + num → display reward
     * Client L95706: o[t].failReward[0].id → setTitleTwoResource
     *
     * 14 posisi dengan escalating rewards:
     *   - Light (diamond, id:101): 50 → 1000 (naik per posisi)
     *   - Fail  (gold,    id:102): 5000 → 15000 (naik per posisi)
     */
    var LANTERN_ITEMS_COUNT = 14;
    // ═══════════════════════════════════════════════════════════
    //  LANTERN BLESSING — 14 Slot Rewards
    // ═══════════════════════════════════════════════════════════
    //
    //  Slot 1:  S Hero Shard x100         (ID 2851)
    //  Slot 2:  Potara Shard x5000         (ID 135)
    //  Slot 3:  Awaken Stone x100          (ID 501)
    //  Slot 4:  Training Pass x5000        (ID 142)
    //  Slot 5:  SS Hero Shard x100         (ID 2861)
    //  Slot 6-11: Daily rotating random rewards (6 pools, rotate per 24h)
    //  Slot 12: Dragon Soul x5             (ID 124)
    //  Slot 13: SSS Classic Hero Pick      (ID 505, chooseBox)
    //  Slot 14: Strongest Warrior Pick     (ID 517, chooseBox)
    //
    //  ⚠️ FORMAT: _lightReward dan _failReward HARUS { _items: [{ _id, _num }] }
    //    Client deserialize: for(var o in n._items) { a.id = n._items[o]._id ... }
    //
    //  Item IDs reference:
    //    101=Diamond, 102=Gold, 111=Soul Stone, 112=Arena Coin
    //    113=Snake Coin, 114=Guild Coin, 115=Glory Coin
    //    121=Friendship Point, 122=Normal Summon Orb, 123=Adv Summon Orb
    //    124=Dragon Soul, 131=Exp Capsule, 132=Break Capsule
    //    133=Super Holy Water, 134=God Water, 135=Potara Shard
    //    136=Power Stone, 137=Alloy, 138=Z Crystal
    //    139=Potara Jade, 140=Gold Essence, 141=Market Refresh Ticket
    //    142=Training Pass, 146=Senzu Bean, 149=Lucky Coin
    //    150=Mineral Crystal, 501=Awaken Stone, 655=Potara Soul
    //    2851=S Hero Shard, 2861=SS Hero Shard, 2881=SSS Hero Shard
    //

    // 6 pool untuk slot 6-11 — setiap pool berisi beberapa kandidat item.
    // Server akan pilih 1 item per pool setiap hari (rotate by date).
    var LANTERN_DAILY_POOLS = [
        // Pool 0 (slot 6) — Currency type
        [
            { _id: 111, _num: 500 },   // Soul Stone x500
            { _id: 112, _num: 2000 },  // Arena Coin x2000
            { _id: 113, _num: 2000 },  // Snake Coin x2000
            { _id: 114, _num: 2000 },  // Guild Coin x2000
            { _id: 115, _num: 1000 },  // Glory Coin x1000
            { _id: 121, _num: 3000 },  // Friendship Point x3000
            { _id: 149, _num: 200 }    // Lucky Coin x200
        ],
        // Pool 1 (slot 7) — Consumable type
        [
            { _id: 131, _num: 100 },   // Exp Capsule x100
            { _id: 132, _num: 50 },    // Break Capsule x50
            { _id: 133, _num: 30 },    // Super Holy Water x30
            { _id: 134, _num: 20 },    // God Water x20
            { _id: 140, _num: 100 },   // Gold Essence x100
            { _id: 141, _num: 50 },    // Market Refresh Ticket x50
            { _id: 146, _num: 100 },   // Senzu Bean x100
            { _id: 150, _num: 100 }    // Mineral Crystal x100
        ],
        // Pool 2 (slot 8) — Summon / Special
        [
            { _id: 122, _num: 20 },    // Normal Summon Orb x20
            { _id: 123, _num: 10 },    // Adv Summon Orb x10
            { _id: 138, _num: 50 },    // Z Crystal x50
            { _id: 139, _num: 30 },    // Potara Jade x30
            { _id: 655, _num: 20 },    // Potara Soul x20
            { _id: 501, _num: 50 },    // Awaken Stone x50
            { _id: 135, _num: 2000 }   // Potara Shard x2000
        ],
        // Pool 3 (slot 9) — Shard type
        [
            { _id: 2851, _num: 200 },  // S Hero Shard x200
            { _id: 2861, _num: 50 },   // SS Hero Shard x50
            { _id: 2881, _num: 20 },   // SSS Hero Shard x20
            { _id: 135, _num: 3000 },  // Potara Shard x3000
            { _id: 655, _num: 50 },    // Potara Soul x50
            { _id: 124, _num: 20 }     // Dragon Soul x20
        ],
        // Pool 4 (slot 10) — Material / Equipment
        [
            { _id: 136, _num: 200 },   // Power Stone x200
            { _id: 137, _num: 200 },   // Alloy x200
            { _id: 501, _num: 80 },    // Awaken Stone x80
            { _id: 142, _num: 3000 },  // Training Pass x3000
            { _id: 131, _num: 200 },   // Exp Capsule x200
            { _id: 132, _num: 100 },   // Break Capsule x100
            { _id: 140, _num: 200 }    // Gold Essence x200
        ],
        // Pool 5 (slot 11) — High value
        [
            { _id: 111, _num: 1000 },  // Soul Stone x1000
            { _id: 123, _num: 20 },    // Adv Summon Orb x20
            { _id: 124, _num: 10 },    // Dragon Soul x10
            { _id: 655, _num: 50 },    // Potara Soul x50
            { _id: 2861, _num: 100 },  // SS Hero Shard x100
            { _id: 2881, _num: 30 },   // SSS Hero Shard x30
            { _id: 134, _num: 50 },    // God Water x50
            { _id: 149, _num: 500 }    // Lucky Coin x500
        ]
    ];

    /**
     * Pick 1 item from a daily pool based on current date.
     * Uses day-of-year % pool.length for deterministic daily rotation.
     */
    function getDailyPoolPick(poolIndex) {
        var pool = LANTERN_DAILY_POOLS[poolIndex];
        var now = new Date();
        var start = new Date(now.getFullYear(), 0, 0);
        var diff = now - start;
        var oneDay = 86400000;
        var dayOfYear = Math.floor(diff / oneDay);
        // Use poolIndex offset so different pools don't all pick same index
        var idx = (dayOfYear + poolIndex * 7) % pool.length;
        return pool[idx];
    }

    /**
     * Build 14 lantern items with proper rewards.
     * Slots 0-4: Fixed items (S Shard, Potara, Awaken, Training, SS Shard)
     * Slots 5-10: Daily rotating random items (6 pools)
     * Slot 11: Dragon Soul x5
     * Slot 12: SSS Classic Hero Pick (ID 505)
     * Slot 13: Strongest Warrior Pick (ID 517)
     */
    function buildLanternItems() {
        // Fixed rewards for slots 0-4, 11, 12, 13
        var fixedLight = [
            { _id: 2851, _num: 100 },  // Slot 1:  S Hero Shard x100
            { _id: 135,  _num: 5000 }, // Slot 2:  Potara Shard x5000
            { _id: 501,  _num: 100 },  // Slot 3:  Awaken Stone x100
            { _id: 142,  _num: 5000 }, // Slot 4:  Training Pass x5000
            { _id: 2861, _num: 100 },  // Slot 5:  SS Hero Shard x100
            null, null, null, null, null, null,  // Slots 6-11: daily (filled below)
            { _id: 124,  _num: 5 },    // Slot 12: Dragon Soul x5
            { _id: 505,  _num: 1 },    // Slot 13: SSS Classic Hero Pick
            { _id: 517,  _num: 1 }     // Slot 14: Strongest Warrior Pick
        ];

        // Fixed fail rewards — Gold for slots 0-11, Diamond for slots 12-13
        var fixedFail = [
            { _id: 102, _num: 5000 },
            { _id: 102, _num: 5000 },
            { _id: 102, _num: 5000 },
            { _id: 102, _num: 8000 },
            { _id: 102, _num: 8000 },
            null, null, null, null, null, null,
            { _id: 102, _num: 15000 },
            { _id: 101, _num: 500 },   // Slot 13: fail = 500 diamond (big slot)
            { _id: 101, _num: 1000 }   // Slot 14: fail = 1000 diamond (jackpot slot)
        ];

        var items = {};
        for (var i = 0; i < 14; i++) {
            var lightReward, failReward;

            if (i >= 5 && i <= 10) {
                // Slots 6-11 (index 5-10): daily rotating from pools
                lightReward = getDailyPoolPick(i - 5);
                failReward = { _id: 102, _num: 8000 + Math.floor((i - 5) / 2) * 2000 };
            } else {
                lightReward = fixedLight[i];
                failReward = fixedFail[i];
            }

            items[String(i)] = {
                _lightReward: {
                    _items: [
                        { _id: lightReward._id, _num: lightReward._num }
                    ]
                },
                _failReward: {
                    _items: [
                        { _id: failReward._id, _num: failReward._num }
                    ]
                }
            };
        }
        return items;
    }

    /**
     * Cost config untuk LANTENBLESSING (act._cost, act._tenCost, act._resetCost).
     *
     * ⚠️ FORMAT KRITIS: { _items: [{ _id, _num }] }
     *
     * BUKAN plain array! Client deserialize (L82068-82072):
     *   _cost → for(var o in n._items) {
     *       var a = new BasicItem;
     *       a.id = n._items[o]._id, a.num = n._items[o]._num;
     *       this.cost.push(a)
     *   }
     *
     * Client L90438 (initResfreshCount):
     *   for (r in n) { var i = n[r].id, s = n[r].num; setSmallCostGroup(...) }
     *
     * Client L90767 (blessingOnceBtnTap):
     *   for (o in n) { n[o].id, n[o].num }
     *
     * Client L90677 (resetLanternBtnTap):
     *   resetCost[0].id, resetCost[0].num
     *
     * Trial:
     *   cost (×1): 100 diamond
     *   tenCost (×10): 1000 diamond
     *   resetCost: 200 diamond
     */
    var LANTERN_COST_1     = { _items: [{ _id: 101, _num: 100 }] };
    var LANTERN_COST_10    = { _items: [{ _id: 101, _num: 1000 }] };
    var LANTERN_RESET_COST = { _items: [{ _id: 101, _num: 200 }] };

    /**
     * poolDiamond — total diamond pool (display big reward counter).
     * Client L90454: initBigRewaardCount → bigRewardBiteLab.text = poolDiamond
     */
    var LANTERN_POOL_DIAMOND = 5000;

    // ═══════════════════════════════════════════════════════════
    //  BUILDER — HERO_HELP response (Hero coming for Rescue)
    // ═══════════════════════════════════════════════════════════
    //
    //  Class hierarchy (verified L80213 + L80232 + L80200):
    //    HeroHelpActivity extends ActivityBase
    //      - extension: _items (dict of HeroHelpActivityItem)
    //    UserHeroHelpActivity extends UserActivityBase
    //      - extension: _haveGotReward (dict boolean)
    //    HeroHelpActivityItem (per item di act._items)
    //      - _costHero, _costDiamond, _heroClass, _heroQuality,
    //        _displayId, _vip, _goods (ActivityReward)
    //
    //  Client access (verified L92452-92500 ExchangeHeroActListItem.processAll):
    //    act._image → getBgSource → activityBG
    //    act._des → getDescribe
    //    act._endTime → getEndTime
    //    act._items (dict) → iterate, count keys > 3 → show scroll arrows
    //    item._goods.normalReward[0].id → hero reward display ID
    //    item._goods.normalReward[0].num → hero reward count
    //    item._displayId → hero cost display ID (specific hero)
    //    item._costHero → jumlah hero cost
    //    item._costDiamond → jumlah diamond cost
    //    item._heroClass, item._heroQuality → class/quality cost (kalau displayId=0)
    //    item._vip → VIP requirement
    //    uact._haveGotReward[itemId] → boolean (sudah claim?)
    //

    /**
     * Rotasi 3 hero per hari dari HERO_HELP_ITEMS pool (42 heroes).
     * Cycle: 42 / 3 = 14 hari, lalu ulang dari awal.
     *
     * Logika:
     *   1. Hitung hari ke-0 berdasarkan epoch (UTC+7 / WIB = Asia/Jakarta)
     *   2. startIndex = (dayIndex * 3) % poolLength
     *   3. Ambil 3 item dari startIndex (wrap around kalau kelebihan)
     *
     * Timezone: WIB (UTC+7) — hari berganti jam 00:00 WIB.
     */
    var HERO_RESCUE_ROTATION_PER_DAY = 3;
    var HERO_RESCUE_WIB_OFFSET_MS = 7 * 60 * 60 * 1000;  // UTC+7

    function getTodayHeroRescueIndices() {
        var now = Date.now();
        // Konversi ke WIB, lalu floor ke start-of-day WIB
        var wibMs = now + HERO_RESCUE_WIB_OFFSET_MS;
        var dayIndex = Math.floor(wibMs / (24 * 60 * 60 * 1000));
        var poolLen = HERO_HELP_ITEMS.length;
        var startIndex = (dayIndex * HERO_RESCUE_ROTATION_PER_DAY) % poolLen;
        var indices = [];
        for (var i = 0; i < HERO_RESCUE_ROTATION_PER_DAY; i++) {
            indices.push((startIndex + i) % poolLen);
        }
        return indices;
    }

    function buildHeroHelpItems() {
        var items = {};
        var indices = getTodayHeroRescueIndices();
        for (var j = 0; j < indices.length; j++) {
            var cfg = HERO_HELP_ITEMS[indices[j]];
            items[String(j)] = {
                _costHero:    cfg.costHero,
                _costDiamond: cfg.costDiamond,
                _heroClass:   cfg.heroClass,
                _heroQuality: cfg.heroQuality,
                _displayId:   cfg.displayId,
                _vip:         cfg.vip,
                _goods: {
                    _normalReward: {
                        _items: [
                            { _id: cfg.rewardHeroId, _num: 1 }
                        ]
                    },
                    _randReward: [],
                    _anyReward: {}
                }
            };
        }
        return items;
    }

    function buildActHeroHelp() {
        return {
            // ── ActivityBase (verified L79854) ──
            _id:            HERO_HELP_ACT_ID,
            _name:          'Hero coming for Rescue',
            _des:           'During the event time, with required heroes and materials, you can exchange for powerful heroes!',
            _icon:          '',
            _image:         HERO_HELP_IMAGE,
            _displayIndex:  200,
            _activityType:  ACTIVITY_TYPE.HERO_HELP,
            _cycleType:     ACTIVITY_CYCLE.SUMMON,
            _enable:        true,
            _timeType:      0,
            _newUserUsing:  false,
            _startDay:      0,
            _durationDay:   0,
            _startTime:     0,
            _endTime:       TRIAL_END_TIME,
            _showRed:       false,

            // ── HeroHelpActivity extension (verified L80213-80230) ──
            _items:         buildHeroHelpItems()
        };
    }

    /**
     * Get today's WIB date string (e.g. "20260726").
     * Used to detect rotation day change → auto-clear haveGotReward.
     */
    function getTodayWibDateString() {
        var now = Date.now();
        var wibMs = now + HERO_RESCUE_WIB_OFFSET_MS;
        var d = new Date(wibMs);
        var yyyy = d.getUTCFullYear();
        var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(d.getUTCDate()).padStart(2, '0');
        return '' + yyyy + mm + dd;
    }

    function buildUactHeroHelp(userId) {
        var todayDateStr = getTodayWibDateString();
        var storageKey = 'ms_userAct_' + userId + '_' + HERO_HELP_ACT_ID;
        var storedUact = db._get(storageKey);

        if (storedUact && storedUact._rotationDate === todayDateStr) {
            // Same day — return stored state as-is (haveGotReward preserved)
            return storedUact;
        }

        // New day (or first time) — reset haveGotReward, update rotation date
        var uact = {
            // ── UserActivityBase (verified L79880) ──
            _startTime:     0,
            _endTime:       0,  // falsy → client fallback ke act._endTime
            _activityId:    HERO_HELP_ACT_ID,
            _loopTag:       '',

            // ── UserHeroHelpActivity extension (verified L80232-80249) ──
            _haveGotReward: {},  // dict boolean, keyed by string itemId ("0","1","2")

            // ── Rotation tracking (mock-server internal, not read by client) ──
            _rotationDate:  todayDateStr  // WIB date string, e.g. "20260726"
        };
        db._set(storageKey, uact);
        return uact;
    }

    function buildHeroHelpResponse(userId) {
        return {
            certificationLevel: 0,
            act:  buildActHeroHelp(),
            uact: buildUactHeroHelp(userId)
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILDER — LANTENBLESSING response
    // ═══════════════════════════════════════════════════════════
    //
    //  Return object dengan field lengkap sesuai contract:
    //    - ActivityBase (15 field, _-prefixed)
    //    - LanternBlessActivity extension (_cost, _resetCost,
    //      _items{}, _tasks{}, _tenCost, _tip, _rankReward[], _poolDiamond,
    //      _shopActId)
    //    - UserActivityBase (4 field, _-prefixed)
    //    - UserLanternBlessActivity extension (_curPos, _totalCount,
    //      _blessTime, _rewardRecords[], _tasks{}, _clickTip)
    //
    //  Class hierarchy (verified L82060 + L82078):
    //    LanternBlessActivity extends ActivityBase
    //    UserLanternBlessActivity extends UserActivityBase
    //
    //  Field yang dibaca client (verified L90406-90450, L101253-101290):
    //    act._image → getBgSource → e.actBg
    //    act._endTime → getEndTime (fallback uact._endTime)
    //    act._des → getDescribe
    //    act._cycleType → getCycleType
    //    act._cost._items[] → initResfreshCount (cost ×1)
    //    act._tenCost._items[] → initResfreshCount (cost ×10)
    //    act._resetCost._items[] → initResfreshCount (reset cost)
    //    act._items[0].failReward[0].id → setTitleTwoResource
    //    act._items[] → initItemGroup (14 items, _lightReward + _failReward)
    //    act._poolDiamond → initBigRewaardCount
    //    act._rankReward.length → rankBtn visibility
    //    act._tasks → targetRewardGroup visibility
    //    uact._clickTip → ruledesRedImg visibility
    //    uact._endTime → getEndTime (prioritas)
    //    uact._rewardRecords → getRewardHistory
    //    uact._totalCount → getUpCount
    //    uact._tasks → getHaveGotTaskReward
    //

    function buildLanternTasks() {
        // 5 task milestones: bless 10/30/50/100/200 kali → bonus diamond
        // Client L101295: getTasks iterate Object.getOwnPropertyNames(act._tasks)
        return {
            '0': {
                _des: 'Bless 10 times',
                _target: 10,
                _reward: {
                    _normalReward: { _items: [{ _id: 101, _num: 50 }] },
                    _randReward: [],
                    _anyReward: {}
                }
            },
            '1': {
                _des: 'Bless 30 times',
                _target: 30,
                _reward: {
                    _normalReward: { _items: [{ _id: 101, _num: 150 }] },
                    _randReward: [],
                    _anyReward: {}
                }
            },
            '2': {
                _des: 'Bless 50 times',
                _target: 50,
                _reward: {
                    _normalReward: { _items: [{ _id: 101, _num: 300 }] },
                    _randReward: [],
                    _anyReward: {}
                }
            },
            '3': {
                _des: 'Bless 100 times',
                _target: 100,
                _reward: {
                    _normalReward: { _items: [{ _id: 101, _num: 500 }] },
                    _randReward: [],
                    _anyReward: {}
                }
            },
            '4': {
                _des: 'Bless 200 times',
                _target: 200,
                _reward: {
                    _normalReward: { _items: [{ _id: 101, _num: 1000 }] },
                    _randReward: [],
                    _anyReward: {}
                }
            }
        };
    }

    function buildActLanternBlessing() {
        return {
            // ── ActivityBase (verified L79854) ──
            _id:            LANTENBLESSING_ACT_ID,
            _name:          'Lantern Blessing',
            _des:           'Light up lanterns to win rewards!',
            _icon:          '',
            _image:         LANTENBLESSING_IMAGE,
            _displayIndex:  100,
            _activityType:  ACTIVITY_TYPE.LANTENBLESSING,
            _cycleType:     ACTIVITY_CYCLE.HOLIDAY,
            _enable:        true,
            _timeType:      0,
            _newUserUsing:  false,
            _startDay:      0,
            _durationDay:   0,
            _startTime:     0,
            _endTime:       TRIAL_END_TIME,
            _showRed:       false,

            // ── LanternBlessActivity extension (verified L82060-82107) ──
            //
            // Format _cost / _tenCost / _resetCost: { _items: [{ _id, _num }] }
            //   Client L82068-82072: for(var o in n._items) { a.id = n._items[o]._id ... }
            //   Setelah deserialize: cost[] = array of BasicItem {id, num}
            //   Client L90433-90447: for (r in n) { n[r].id, n[r].num }
            //
            // Format _items: OBJECT keyed "0".."13", setiap item punya
            //   _lightReward: { _items: [{ _id, _num }] }
            //   _failReward:  { _items: [{ _id, _num }] }
            //   Client L82043-82047: for(var o in n._items) { a.id = n._items[o]._id ... }
            //   Setelah deserialize: item.lightReward[] = array of BasicItem {id, num}
            //   Client L90465: items[t].lightReward[0].id / items[t].failReward[0].id
            //
            // Constructor defaults (L82062-82063):
            //   cost=[], resetCost=[], addPoolDiamond=0, items=[],
            //   tasks={}, tenCost=[], tip="", rankReward=[], poolDiamond=0,
            //   shopActId=""
            //
            _cost:           LANTERN_COST_1,
            _resetCost:      LANTERN_RESET_COST,
            _items:          buildLanternItems(),
            _tasks:          buildLanternTasks(),
            _tenCost:        LANTERN_COST_10,
            _tip:            'Each lit lantern grants a random reward. Keep blessing to earn milestone bonuses!',
            _rankReward:     [],
            _poolDiamond:    LANTERN_POOL_DIAMOND,
            _shopActId:      CANDLE_SHOP_ACT_ID,
            _addPoolDiamond: 0
        };
    }

    function buildUactLanternBlessing() {
        return {
            // ── UserActivityBase (verified L79880) ──
            _startTime:  0,
            _endTime:    0,  // falsy → client fallback ke act._endTime
            _activityId: LANTENBLESSING_ACT_ID,
            _loopTag:    '',

            // ── UserLanternBlessActivity extension (verified L82078) ──
            _curPos:        0,        // posisi lantern saat ini (0-14)
            _totalCount:    0,        // total bless count
            _blessTime:     0,        // timestamp bless terakhir
            _rewardRecords: [],       // history reward
            _tasks:         {},       // tasks yang sudah di-claim (keyed by string)
            _clickTip:      false     // sudah klik tip?
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILDER — CANDLE SHOP response
    // ═══════════════════════════════════════════════════════════
    //
    //  Candle Shop dibuka via goToShop(shopActId) dari Lantern Blessing.
    //  Client L96408: goToShop(e) → cari actId==e di ActivitySmallList → select & refresh.
    //  Jadi CANDLE_SHOP_ACT_ID HARUS ada sebagai entry di getActivityBrief.
    //
    //  Background: huodongnew954.jpg
    //  Tab icon (brief): huodongnew955.png
    //

    function buildCandleShopItems() {
        // ── Candle Shop items (SuperGiftBuyWithOtherActivity) ──
        //
        // Client SuperGiftBuyWithOtherActivityViewData.initList (L94418):
        //   for(var n in t) {  // iterate act._items
        //     t[n]._reward     → reward (ActivityReward format)
        //     t[n]._cost._items → cost [{_id, _num}]
        //     t[n]._limit       → max purchase count
        //     t[n]._des         → description text
        //     t[n]._showDiscount → discount number (10 = no discount shown)
        //   }
        //
        // Client SuperGiftBuyWithOtherListItem.processAll (L94480):
        //   limit - buyTimes = remaining purchases
        //   disCountNum != 10 → show discount badge
        //   ACTIVITY_REQUEST_TYPE.ShopBuy = buy action
        //
        var CANDLE_ID = 711;  // 蜡烛 (Candle, activityItem, orange)

        return {
            '0': {
                _reward: {
                    _normalReward: { _items: [{ _id: 505, _num: 1 }] },
                    _randReward: [],
                    _anyReward: {}
                },
                _cost: { _items: [{ _id: CANDLE_ID, _num: 10000 }] },
                _limit: 1,
                _des: 'SSS Hero Choose Box',
                _showDiscount: 10
            },
            '1': {
                _reward: {
                    _normalReward: { _items: [{ _id: 664, _num: 1 }] },
                    _randReward: [],
                    _anyReward: {}
                },
                _cost: { _items: [{ _id: CANDLE_ID, _num: 10000 }] },
                _limit: 1,
                _des: 'Red Gear Full Set',
                _showDiscount: 10
            }
        };
    }

    function buildCandleShopResponse() {
        // ── SuperGiftBuyWithOtherActivity panel data ──
        //
        // Client L94357-94364 (initAll):
        //   getBgSource() → act._image → background
        //   getEndTime()  → uact._endTime || act._endTime
        //   getShowItems() → act._showItems → [itemId, ...] for title resources
        //
        // Client L94418-94451 (initList):
        //   for(var n in t) → iterate act._items
        //   t[n]._reward, t[n]._cost._items, t[n]._limit, t[n]._des, t[n]._showDiscount
        //   uact._buyTimes[n] → user's current purchase count per item
        //
        return {
            certificationLevel: 0,
            act: {
                _id:            CANDLE_SHOP_ACT_ID,
                _name:          'Candle Shop',
                _des:           'Exchange candles for exclusive rewards!',
                _icon:          '',
                _image:         CANDLE_SHOP_IMAGE,
                _displayIndex:  90,
                _activityType:  5012,  // ACTIVITY_TYPE.SHOP → SuperGiftBuyWithOtherActivity
                _cycleType:     ACTIVITY_CYCLE.HOLIDAY,
                _enable:        true,
                _timeType:      0,
                _newUserUsing:  false,
                _startDay:      0,
                _durationDay:   0,
                _startTime:     0,
                _endTime:       TRIAL_END_TIME,
                _showRed:       false,

                // ── SHOP-specific fields ──
                // act._items: shop item list (keyed "0".."N")
                //   Each: _reward, _cost, _limit, _des, _showDiscount
                _items: buildCandleShopItems(),

                // act._showItems: resource item IDs shown in title bar
                //   Client L94366: n[0] → setTitleResource, n[1] → setTitleTwoResource
                _showItems: [711]  // Candle (蜡烛)
            },
            uact: {
                _startTime:  0,
                _endTime:    0,  // falsy → client fallback ke act._endTime
                _activityId: CANDLE_SHOP_ACT_ID,
                _loopTag:    '',

                // ── UserShopActivity extension ──
                // Client L94421: uact._buyTimes[n] → purchase count per item
                _buyTimes: {}
            }
        };
    }

    function buildLanternBlessingResponse() {
        return {
            certificationLevel: 0,
            act:  buildActLanternBlessing(),
            uact: buildUactLanternBlessing()
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILDER — NORMAL_LUCK response
    // ═══════════════════════════════════════════════════════════
    //
    //  Return object dengan field lengkap sesuai contract:
    //    - ActivityBase (15 field, _-prefixed)
    //    - NormalLuckActivity extension (_randHero, _task, _notProtectSHero,
    //      _des2)
    //    - UserActivityBase (4 field, _-prefixed)
    //    - UserNormalLuckActivity extension (_curCount)
    //
    //  Field order mengikuti urutan deklarasi constructor class client
    //  (L79854 + L80248-80267) supaya log/debug mudah dibaca.
    //

    /**
     * Build _randHero object untuk NormalLuck Tab 1 (poolId: 1) — existing pool.
     * Menggunakan NORMAL_LUCK_HERO_POOL (Shenron + standard heroes).
     */
    function buildRandHero() {
        var items = [];
        for (var i = 0; i < NORMAL_LUCK_HERO_POOL.length; i++) {
            var h = NORMAL_LUCK_HERO_POOL[i];
            items.push({
                _itemId: h.itemId,
                _num:    h.num,
                _weight: h.weight
            });
        }
        return {
            _randId: 1,
            _groups: {
                '1': {
                    _groupId:     1,
                    _totalWeight: NORMAL_LUCK_TOTAL_WEIGHT,
                    _items:       items
                }
            }
        };
    }

    /**
     * Build _randHero object untuk NormalLuck Tab 2 (poolId: 2) — Card Pool / Summon Return.
     * Menggunakan NORMAL_LUCK_TAB2_HERO_POOL (Dragon Ball heroes).
     */
    function buildRandHeroTab2() {
        var items = [];
        for (var i = 0; i < NORMAL_LUCK_TAB2_HERO_POOL.length; i++) {
            var h = NORMAL_LUCK_TAB2_HERO_POOL[i];
            items.push({
                _itemId: h.itemId,
                _num:    h.num,
                _weight: h.weight
            });
        }
        return {
            _randId: 2,
            _groups: {
                '2': {
                    _groupId:     2,
                    _totalWeight: NORMAL_LUCK_TAB2_TOTAL_WEIGHT,
                    _items:       items
                }
            }
        };
    }

    function buildEmptyTask() {
        // NormalLuck panel TIDAK baca _task (verified Q3).
        // Tetap dikirim kosong supaya constructor default class
        // (ActivityTaskItem L79864) tidak break saat deserialize.
        return {
            _des:    '',
            _target: 0,
            _reward: {
                _normalReward: { _items: [] },
                _randReward:   [],
                _anyReward:    {}
            }
        };
    }

    /**
     * Build response object act (ActivityBase) untuk NORMAL_LUCK.
     *
     * @param {number} poolId - 1 (Tab 1 existing) atau 2 (Tab 2 cardPool)
     * @returns {Object} ActivityBase fields + NormalLuckActivity extension
     *
     * Evidence: Client L103268: getBgSource() → act._image → setUrlImage(bg)
     */
    function buildActNormalLuck(poolId) {
        // Pilih background image berdasarkan poolId
        var backgroundImage = (poolId === 2)
            ? NORMAL_LUCK_TAB2_IMAGE   // Tab 2: huodongnew112.jpg (cardPool)
            : NORMAL_LUCK_IMAGE;        // Tab 1: huodongnew224.jpg (existing)

        // Pilih actId berdasarkan poolId
        var actIdForPool = (poolId === 2)
            ? NORMAL_LUCK_TAB2_ACT_ID   // "3001_2"
            : NORMAL_LUCK_ACT_ID;      // "3001" (original)

        return {
            // ── ActivityBase (verified L79854) ──
            _id:            actIdForPool,
            _name:          'cardPool',
            _des:           '',
            _icon:          '',
            _image:         backgroundImage,
            _displayIndex:  90,
            _activityType:  ACTIVITY_TYPE.NORMAL_LUCK,
            _cycleType:     ACTIVITY_CYCLE.SUMMON,
            _enable:        true,
            _timeType:      0,
            _newUserUsing:  false,
            _startDay:      0,
            _durationDay:   0,
            _startTime:     0,
            _endTime:       TRIAL_END_TIME,
            _showRed:       false,

            // ── NormalLuckActivity extension (verified L80248-80258) ──
            _randHero:         (poolId === 2) ? buildRandHeroTab2() : buildRandHero(),
            _task:             buildEmptyTask(),
            _notProtectSHero:  false,
            _des2:             ''
        };
    }

    function buildUactNormalLuck() {
        return {
            // ── UserActivityBase (verified L79880) ──
            _startTime:  0,
            _endTime:    0,  // falsy → client fallback ke act._endTime (L103263)
            _activityId: NORMAL_LUCK_ACT_ID,
            _loopTag:    '',

            // ── UserNormalLuckActivity extension (verified L80261-80267) ──
            _curCount:   0
        };
    }

    /**
     * Build complete response untuk NORMAL_LUCK.
     *
     * @param {number} poolId - 1 (Tab 1) atau 2 (Tab 2 cardPool)
     * @returns {Object} { certificationLevel, act, uact }
     */
    function buildNormalLuckResponse(poolId) {
        return {
            certificationLevel: 0,
            act:  buildActNormalLuck(poolId),
            uact: buildUactNormalLuck()
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetActivityDetail(request, callback) {
        var userId  = request && request.userId;
        var actId   = request && request.actId;
        var cycleType = request && request.cycleType;
        var poolId    = request && request.poolId;

        log.info('ACTIVITY', 'activity/getActivityDetail START — '
            + 'userId=' + (userId || '-')
            + ', actId=' + (actId || '-')
            + ', cycleType=' + (cycleType || '-')
            + ', poolId=' + (poolId || '-'));

        try {
            // ── VALIDATE userId ──
            if (!userId) {
                log.warn('ACTIVITY', 'getActivityDetail — missing userId');
                callback({}, 1);
                return;
            }

            // ── VALIDATE actId ──
            // actId dikirim dari brief.id = String(actType).
            // Untuk trial ini hanya handle actId "3001" (NORMAL_LUCK).
            if (!actId) {
                log.warn('ACTIVITY', 'getActivityDetail — missing actId');
                callback({}, 1);
                return;
            }

            // ── ROUTE by actId ──
            // Trial: support NORMAL_LUCK ("3001") + LANTENBLESSING ("5035")
            // actId lain (mis. "3003" SUPER_GIFT) → ret=1 supaya
            // client tampilkan error tips (handler belum di-extend).
            var response;
            var logDetails;

            if (String(actId) === NORMAL_LUCK_ACT_ID || String(actId) === NORMAL_LUCK_TAB2_ACT_ID) {
                // ── NORMAL_LUCK (Theme Card Pool / Card Pool) ──
                // Support 2 tabs: poolId=1 (existing) dan poolId=2 (cardPool BARU)
                var normalLuckPoolId = (String(actId) === NORMAL_LUCK_TAB2_ACT_ID) ? 2 : 1;
                response = buildNormalLuckResponse(normalLuckPoolId);
                log.info('ACTIVITY', 'getActivityDetail SUCCESS — '
                    + 'NORMAL_LUCK actId=' + actId
                    + ', poolId=' + normalLuckPoolId
                    + ', heroPool=' + NORMAL_LUCK_HERO_POOL.length + ' heroes'
                    + ', totalWeight=' + NORMAL_LUCK_TOTAL_WEIGHT
                    + ', endTime=2100-01-01 (unlimited)');
                logDetails = [
                    ['userId',             userId],
                    ['actId',              actId],
                    ['poolId',             normalLuckPoolId],
                    ['activityType',       ACTIVITY_TYPE.NORMAL_LUCK],
                    ['cycleType',          ACTIVITY_CYCLE.SUMMON],
                    ['act._image',         (normalLuckPoolId === 2) ? NORMAL_LUCK_TAB2_IMAGE : NORMAL_LUCK_IMAGE],
                    ['act._endTime',       TRIAL_END_TIME + ' (2100-01-01 UTC)'],
                    ['act._randHero.groups', '1 (6 heroes)'],
                    ['act._notProtectSHero', 'false'],
                    ['uact._curCount',     0],
                    ['certificationLevel', 0]
                ];
            } else if (String(actId) === HERO_HELP_ACT_ID) {
                // ── HERO_HELP (Hero coming for Rescue) ──
                response = buildHeroHelpResponse(userId);
                var todayIndices = getTodayHeroRescueIndices();
                var todayHeroIds = todayIndices.map(function(idx) {
                    return HERO_HELP_ITEMS[idx].rewardHeroId;
                });
                var haveGotRewardKeys = Object.keys(response.uact._haveGotReward);
                log.info('ACTIVITY', 'getActivityDetail SUCCESS — '
                    + 'HERO_HELP actId=' + HERO_HELP_ACT_ID
                    + ', rotation=3/' + HERO_HELP_ITEMS.length + ' today=[' + todayHeroIds.join(', ') + ']'
                    + ', cycle=14 days'
                    + ', claimed=' + haveGotRewardKeys.length + '/3'
                    + ', endTime=2100-01-01 (unlimited)');
                logDetails = [
                    ['userId',             userId],
                    ['actId',              HERO_HELP_ACT_ID],
                    ['activityType',       ACTIVITY_TYPE.HERO_HELP],
                    ['cycleType',          ACTIVITY_CYCLE.SUMMON],
                    ['act._image',         HERO_HELP_IMAGE + ' (default skin)'],
                    ['act._endTime',       TRIAL_END_TIME + ' (2100-01-01 UTC)'],
                    ['pool.total',         HERO_HELP_ITEMS.length],
                    ['rotation.today',     todayHeroIds.join(', ')],
                    ['uact._haveGotReward', haveGotRewardKeys.length > 0 ? haveGotRewardKeys.join(',') : '{}'],
                    ['uact._rotationDate', response.uact._rotationDate || '(none)'],
                    ['certificationLevel', 0]
                ];
            } else if (String(actId) === LANTENBLESSING_ACT_ID) {
                // ── LANTENBLESSING ──
                response = buildLanternBlessingResponse();
                log.info('ACTIVITY', 'getActivityDetail SUCCESS — '
                    + 'LANTENBLESSING actId=' + LANTENBLESSING_ACT_ID
                    + ', items=' + LANTERN_ITEMS_COUNT
                    + ', poolDiamond=' + LANTERN_POOL_DIAMOND
                    + ', endTime=2100-01-01 (unlimited)');
                logDetails = [
                    ['userId',             userId],
                    ['actId',              LANTENBLESSING_ACT_ID],
                    ['activityType',       ACTIVITY_TYPE.LANTENBLESSING],
                    ['cycleType',          ACTIVITY_CYCLE.HOLIDAY],
                    ['act._image',         LANTENBLESSING_IMAGE],
                    ['act._endTime',       TRIAL_END_TIME + ' (2100-01-01 UTC)'],
                    ['act._items.count',   LANTERN_ITEMS_COUNT],
                    ['act._poolDiamond',   LANTERN_POOL_DIAMOND],
                    ['act._cost',          '101 x100 (array[1])'],
                    ['act._tenCost',       '101 x1000 (array[1])'],
                    ['act._resetCost',     '101 x200 (array[1)]'],
                    ['uact._curPos',       0],
                    ['uact._totalCount',   0],
                    ['uact._clickTip',     false],
                    ['certificationLevel', 0]
                ];
            } else if (String(actId) === CANDLE_SHOP_ACT_ID) {
                // ── CANDLE SHOP ──
                response = buildCandleShopResponse();
                log.info('ACTIVITY', 'getActivityDetail SUCCESS — '
                    + 'CANDLE_SHOP actId=' + CANDLE_SHOP_ACT_ID
                    + ', endTime=2100-01-01 (unlimited)');
                logDetails = [
                    ['userId',             userId],
                    ['actId',              CANDLE_SHOP_ACT_ID],
                    ['act._image',         CANDLE_SHOP_IMAGE],
                    ['act._endTime',       TRIAL_END_TIME + ' (2100-01-01 UTC)'],
                    ['certificationLevel', 0]
                ];
            } else {
                log.warn('ACTIVITY', 'getActivityDetail — unsupported actId "'
                    + actId + '" (NORMAL_LUCK/HERO_HELP/LANTENBLESSING/CANDLE_SHOP)');
                callback({}, 1);
                return;
            }

            log.details('response', logDetails);

            // ── CALLBACK ──
            callback(response);

        } catch (err) {
            log.error('ACTIVITY', 'getActivityDetail UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('activity', 'getActivityDetail', handleGetActivityDetail);
})();
