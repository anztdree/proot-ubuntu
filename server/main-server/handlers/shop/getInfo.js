/**
 * getInfo.js — Shop GetInfo Handler (FINAL — SEMPURNA)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS & TANGGUNG JAWAB FILE INI (1 file, 1 action):
 *   Handler untuk request: { type:"shop", action:"getInfo", userId, version:"1.0" }
 *   Response:              { _shop: { _id, _buyTimes, _autoRefreshTime } }
 *
 *   Server WAJIB:
 *     1. Load state pembelian user dari IndexedDB (shop:{userId})
 *     2. Cek & apply auto-refresh untuk setiap market type:
 *        - Jika _autoRefreshTime[mt] <= now → RESET _buyTimes[mt] = {}, set next refresh
 *        - Jika _autoRefreshTime[mt] tidak ada/0 → init = now + interval
 *        - Jika _autoRefreshTime[mt] > now → biarkan
 *     3. Save state (jika ada perubahan)
 *     4. Return { _shop: { _id, _buyTimes, _autoRefreshTime } }
 * ============================================================
 *
 * EVIDENCE DARI main.min(unminfy).js:
 *
 *   [PEMANGGILAN] Hanya 2 tempat:
 *     L56865  UIWindowManager.openShopMain → call shop/getInfo saat user buka Shop UI
 *     L133732  ShopMain.getShopInfo → re-call saat timer countdown habis (auto-refresh)
 *
 *   [RESPONSE CONSUMER] ShopInfoManager.setShopInfo (L79580):
 *     e.prototype.setShopInfo = function(e) {
 *         t.shopInfo._id = e._id;                       // SET _id
 *         t.shopInfo._buyTimes = {};
 *         for (var n in e._buyTimes) {
 *             var o = parseInt(n);                       // marketType string → number
 *             var a = {};
 *             for (var r in e._buyTimes[n]) {
 *                 a[r] = e._buyTimes[n][r];              // copy itemID → count
 *             }
 *             t.shopInfo._buyTimes[o] = a;
 *         }
 *         t.shopInfo._autoRefreshTime = {};
 *         for (var r in e._autoRefreshTime) {
 *             var o = parseInt(r);                       // marketType string → number
 *             t.shopInfo._autoRefreshTime[o] = e._autoRefreshTime[r];
 *         }
 *     }
 *
 *   [FIELD USAGE]:
 *     _id               — Tidak pernah di-read client, tapi WAJIB dikirim (client expect field)
 *     _buyTimes         — DIBACA via getBuyTimes(marketType, itemID) di:
 *                         L133608, L133620, L133652, L161612
 *                         Dipakai untuk hitung sisa stock: config.count - buyTimes
 *     _autoRefreshTime  — DIBACA di ShopMain.timeDown (L133709, L133713):
 *                         o = t._autoRefreshTime[n]; a = o - serverTime;
 *                         if (0 >= a) e.getShopInfo();  // re-call getInfo → expect reset
 *
 *   [MARKET TYPES] getServerShopType (L133771-133793):
 *     ShopType.TYPE_ARENA       (0) → MARKET_TYPE.TYPE_ARENA       (2)
 *     ShopType.TYPE_GUILD       (1) → MARKET_TYPE.TYPE_GUILD       (3)
 *     ShopType.TYPE_SOUL        (2) → MARKET_TYPE.TYPE_SOUL        (4)
 *     ShopType.TYPE_SNAKE       (3) → MARKET_TYPE.TYPE_SNAKE       (5)
 *     ShopType.TYPE_SOUL_PLUS   (4) → MARKET_TYPE.TYPE_SOUL_PLUS   (7)
 *     ShopType.TYPE_TEAM_DUNGEON(5) → MARKET_TYPE.TYPE_TEAM_DUNGEON(8)
 *
 *   [AUTO-REFRESH INTERVAL] constant.json (semua = 720 menit = 12 jam):
 *     arenaShopRefreshNaturally        = 720
 *     guildShopRefreshNaturally        = 720
 *     soulShopRefreshNaturally         = 720
 *     soulShopPlusRefreshNaturally     = 720
 *     snakeShopRefreshNaturally        = 720
 *     teamDungeonShopRefreshNaturally  = 720
 *
 *   [STORAGE]
 *     Key IndexedDB: shop:{userId}
 *     Value: { _id, _buyTimes, _autoRefreshTime, _lastUpdate }
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.shop) {
        MainServer.handlers.shop = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var MIN_MS = 60 * 1000;
    var HOUR_MS = 60 * MIN_MS;
    var DAY_MS = 24 * HOUR_MS;

    // Auto-refresh interval: 720 menit = 12 jam (dari constant.json, semua shop sama)
    var AUTO_REFRESH_INTERVAL_MS = 720 * MIN_MS;

    // 6 market types yang di-handle (MAP dari ShopType UI → MARKET_TYPE server)
    // Source: getServerShopType L133771-133793
    var HANDLED_MARKET_TYPES = [2, 3, 4, 5, 7, 8];

    var MARKET_TYPE_NAMES = {
        2: 'ARENA',
        3: 'GUILD',
        4: 'SOUL',
        5: 'SNAKE',
        7: 'SOUL_PLUS',
        8: 'TEAM_DUNGEON'
    };

    // Storage
    var SHOP_STORAGE_PREFIX = 'shop:';
    var SERVER_META_KEY = 'serverItem';

    function shopStorageKey(userId) {
        return SHOP_STORAGE_PREFIX + userId;
    }

    function getServerOpenDate() {
        var meta = db._get(SERVER_META_KEY);
        return (meta && meta._serverOpenDate) ? meta._serverOpenDate : Date.now();
    }

    /**
     * Generate UUID-style shop ID.
     * Format: shop_{userId}_{timestamp}_{random}
     * Persistent di DB — tidak berubah setelah first call.
     */
    function generateShopId(userId) {
        var random = Math.random().toString(36).substring(2, 10);
        return 'shop_' + userId + '_' + Date.now() + '_' + random;
    }

    // ═══════════════════════════════════════════════════════════
    //  STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /**
     * Validate & normalize state yang di-load dari DB.
     * Handle corrupt/incomplete data dengan fallback ke default.
     *
     * Defensive programming untuk:
     *   - State null/undefined
     *   - Field hilang (_id, _buyTimes, _autoRefreshTime)
     *   - Field bukan object (corrupt)
     *   - Market type hilang dari _buyTimes/_autoRefreshTime
     */
    function normalizeState(state, userId) {
        var now = Date.now();

        // State null/undefined → create fresh
        if (!state || typeof state !== 'object') {
            state = {
                _id: generateShopId(userId),
                _buyTimes: {},
                _autoRefreshTime: {},
                _lastUpdate: now
            };
        }

        // Validate _id (string, non-empty)
        if (!state._id || typeof state._id !== 'string') {
            state._id = generateShopId(userId);
        }

        // Validate _buyTimes (object)
        if (!state._buyTimes || typeof state._buyTimes !== 'object' || Array.isArray(state._buyTimes)) {
            state._buyTimes = {};
        }

        // Validate _autoRefreshTime (object)
        if (!state._autoRefreshTime || typeof state._autoRefreshTime !== 'object' || Array.isArray(state._autoRefreshTime)) {
            state._autoRefreshTime = {};
        }

        // Ensure semua 6 market type ada di _buyTimes & _autoRefreshTime
        for (var i = 0; i < HANDLED_MARKET_TYPES.length; i++) {
            var mt = HANDLED_MARKET_TYPES[i];
            var mtKey = String(mt);

            // _buyTimes[mt] harus object
            if (!state._buyTimes[mtKey] || typeof state._buyTimes[mtKey] !== 'object' || Array.isArray(state._buyTimes[mtKey])) {
                state._buyTimes[mtKey] = {};
            }

            // _autoRefreshTime[mt] harus number > 0
            var refreshTime = state._autoRefreshTime[mtKey];
            if (typeof refreshTime !== 'number' || refreshTime <= 0 || isNaN(refreshTime)) {
                state._autoRefreshTime[mtKey] = now + AUTO_REFRESH_INTERVAL_MS;
            }
        }

        return state;
    }

    /**
     * Load state dari IndexedDB, atau create default kalau belum ada.
     * Selalu normalize setelah load untuk handle corrupt data.
     */
    function loadShopState(userId) {
        var key = shopStorageKey(userId);
        var state = db._get(key);

        var isFirstTime = !state;
        state = normalizeState(state, userId);

        // Save kalau first time atau ada perubahan dari normalize
        if (isFirstTime) {
            db._set(key, state);
            log.info('SHOP', 'Created default shop state for user ' + userId);
        }

        return state;
    }

    /**
     * Cek & apply auto-refresh untuk SETIAP market type.
     *
     * Logic (berdasarkan ShopMain.timeDown L133707-133713):
     *   Client countdown: a = _autoRefreshTime[mt] - serverTime
     *   Jika a <= 0 → client re-call getInfo (expect server RESET _buyTimes[mt])
     *
     * Jadi server WAJIB:
     *   - Jika _autoRefreshTime[mt] <= now → RESET _buyTimes[mt] = {} & set next refresh
     *   - Jika _autoRefreshTime[mt] tidak ada/0 → init = now + interval
     *   - Jika _autoRefreshTime[mt] > now → biarkan
     */
    function applyAutoRefresh(state) {
        var now = Date.now();
        var refreshedTypes = [];
        var changed = false;

        for (var i = 0; i < HANDLED_MARKET_TYPES.length; i++) {
            var mt = HANDLED_MARKET_TYPES[i];
            var mtKey = String(mt);
            var refreshTime = state._autoRefreshTime[mtKey];

            // Case 1: Tidak ada atau 0 → init
            if (!refreshTime || refreshTime <= 0 || isNaN(refreshTime)) {
                state._autoRefreshTime[mtKey] = now + AUTO_REFRESH_INTERVAL_MS;
                changed = true;
                continue;
            }

            // Case 2: Sudah lewat → RESET buyTimes & set next refresh
            if (refreshTime <= now) {
                state._buyTimes[mtKey] = {};
                state._autoRefreshTime[mtKey] = now + AUTO_REFRESH_INTERVAL_MS;
                refreshedTypes.push(MARKET_TYPE_NAMES[mt] + '(' + mt + ')');
                changed = true;
            }

            // Case 3: Masih valid → biarkan
        }

        if (refreshedTypes.length > 0) {
            state._lastUpdate = now;
            log.info('SHOP', 'Auto-refresh triggered for: ' + refreshedTypes.join(', '));
        }

        return { state: state, changed: changed, refreshedCount: refreshedTypes.length };
    }

    /**
     * Build response _shop object sesuai format client.
     * Client (setShopInfo L79580) akan parseInt key untuk convert string → number.
     * Jadi key boleh string.
     */
    function buildShopResponse(state) {
        return {
            _id: state._id,
            _buyTimes: state._buyTimes,
            _autoRefreshTime: state._autoRefreshTime
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetInfo(request, callback) {
        var userId = request.userId;

        // ── VALIDATION ──
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            log.warn('SHOP', 'getInfo — missing or invalid userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        log.info('SHOP', 'shop/getInfo userId=' + userId);

        try {
            // 1. Load state dari IndexedDB (auto-create + normalize kalau perlu)
            var state = loadShopState(userId);

            // 2. Apply auto-refresh (reset _buyTimes kalau sudah lewat)
            var refreshResult = applyAutoRefresh(state);
            state = refreshResult.state;

            // 3. Save state jika ada perubahan (auto-refresh atau normalize)
            if (refreshResult.changed) {
                db._set(shopStorageKey(userId), state);
            }

            // 4. Build response sesuai format client
            var shopData = buildShopResponse(state);

            // 5. Log summary
            var marketTypesWithBuys = 0;
            var totalBuyRecords = 0;
            for (var mtKey in shopData._buyTimes) {
                if (shopData._buyTimes.hasOwnProperty(mtKey)) {
                    var count = Object.keys(shopData._buyTimes[mtKey]).length;
                    if (count > 0) {
                        marketTypesWithBuys++;
                        totalBuyRecords += count;
                    }
                }
            }

            log.details('SHOP', [
                ['userId', userId],
                ['shopId', shopData._id.substring(0, 30) + '...'],
                ['marketTypes', Object.keys(shopData._autoRefreshTime).length + ' types'],
                ['buyRecords', marketTypesWithBuys + ' types, ' + totalBuyRecords + ' items'],
                ['autoRefreshed', refreshResult.refreshedCount + ' types']
            ]);

            // 6. Return response
            callback({ _shop: shopData });

        } catch (err) {
            log.error('SHOP', 'getInfo UNCAUGHT ERROR: ' + err.message);
            log.error('SHOP', 'Stack: ' + (err.stack || '(no stack)'));

            // Return error response
            callback({
                _error: 'server_error',
                _message: err.message || 'Unknown error'
            }, 99);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('shop', 'getInfo', handleGetInfo);

    window.MainServer = MainServer;
})();
