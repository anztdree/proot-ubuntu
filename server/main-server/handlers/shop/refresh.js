/**
 * draft/shop/refresh.js — Shop Refresh Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: shop/refresh
 * ============================================================
 *
 * REQUEST:
 *   { type:"shop", action:"refresh", userId, marketType, version:"1.0" }
 *
 * RESPONSE:
 *   { _shop: { _id, _buyTimes, _autoRefreshTime }, _changeInfo: { _items: { ... } } }
 *
 * Client L133757-133767 (ShopMain.refreshBtnTap):
 *   ts.processHandler({
 *       type: "shop", action: "refresh",
 *       userId: n, marketType: t, version: "1.0"
 *   }, function(t) {
 *       ShopInfoManager.getInstance().setShopInfo(t._shop),
 *       ItemsCommonSingleton.getInstance().resetTtemsCallBack(t),
 *       e.updateShopUI()
 *   })
 *
 * Client L133770 (sebelum request, konfirmasi dialog):
 *   UIWindowManager.buyTips(message, 0, needItemNum, coinID.toString(), confirmFunc)
 *   → buyTips cek checkMoneyEnough di client-side
 *   → Jika cukup, panggil confirmFunc yang kirim request ke server
 *
 * REFRESH COST per marketType (dari constant.json):
 *   MARKET_TYPE 2 (ARENA):        ID=112 (Arena Medal), Price=5000
 *   MARKET_TYPE 3 (GUILD):        ID=115 (Guild Coin), Price=4000
 *   MARKET_TYPE 4 (SOUL):         ID=111 (Soul Stone), Price=1000
 *   MARKET_TYPE 5 (SNAKE):        ID=113 (Snake Medal), Price=4000
 *   MARKET_TYPE 7 (SOUL_PLUS):    ID=111 (Soul Stone), Price=2000
 *   MARKET_TYPE 8 (TEAM_DUNGEON): ID=590 (Team Dungeon Token), Price=10000
 *
 * LOGIC:
 *   1. Validasi userId & marketType
 *   2. Load shop state dari IndexedDB (ms_shop_{userId})
 *   3. Validasi marketType valid (2,3,4,5,7,8)
 *   4. Load refresh cost dari constant.json
 *   5. Load user data dari IndexedDB (ms_user_{userId}_1)
 *   6. Cek saldo cukup
 *   7. Deduct currency dari totalProps._items
 *   8. Reset _buyTimes[marketType] = {}
 *   9. Set _autoRefreshTime[marketType] = now + 720 menit
 *  10. Save shop state & user data
 *  11. Return { _shop, _changeInfo: { _items } }
 *
 * SETELAH REFRESH:
 *   Client L133764: ShopInfoManager.setShopInfo(t._shop) → update buyTimes & timer
 *   Client L133764: resetTtemsCallBack(t) → deduct item dari client-side cache
 *   Client L133764: e.updateShopUI() → re-render shop items (buy count reset)
 *
 * CATATAN: Client TIDAK kirim refresh cost ke server.
 *   Client hanya konfirmasi di UI (buyTips dialog), lalu kirim request.
 *   Server HARUS cek cost sendiri dari constant.json.
 *   Ini berbeda dari market/refresh yang kirim refreshType.
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var MIN_MS = 60 * 1000;
    var AUTO_REFRESH_INTERVAL_MS = 720 * MIN_MS; // 12 jam (semua shop sama)

    // Valid market types (dari getServerShopType L133771-133793)
    var VALID_MARKET_TYPES = [2, 3, 4, 5, 7, 8];

    var MARKET_TYPE_NAMES = {
        2: 'ARENA',
        3: 'GUILD',
        4: 'SOUL',
        5: 'SNAKE',
        7: 'SOUL_PLUS',
        8: 'TEAM_DUNGEON'
    };

    // Refresh cost config: constant.json key name per marketType
    // Source: ShopMainViewData L133903-133944
    var REFRESH_COST_CONFIG = {
        2: { idKey: 'arenaShopRefreshID',        priceKey: 'arenaShopRefreshPrice' },
        3: { idKey: 'guildShopRefreshID',        priceKey: 'guildShopRefreshPrice' },
        4: { idKey: 'soulShopRefreshID',         priceKey: 'soulShopRefreshPrice' },
        5: { idKey: 'snakeShopRefreshID',        priceKey: 'snakeShopRefreshPrice' },
        7: { idKey: 'soulShopPlusRefreshID',     priceKey: 'soulShopPlusRefreshPrice' },
        8: { idKey: 'teamDungeonShopRefreshID',  priceKey: 'teamDungeonShopRefreshPrice' }
    };

    // Storage keys
    var SHOP_STORAGE_PREFIX = 'ms_shop_';
    var USER_STORAGE_PREFIX = 'ms_user_';
    var SERVER_META_KEY = 'ms_server_meta';

    function shopStorageKey(userId) {
        return SHOP_STORAGE_PREFIX + userId;
    }

    function userStorageKey(userId) {
        return USER_STORAGE_KEY + userId + '_1';
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _configCache = {};

    function loadConstant() {
        if (_configCache.constant) return _configCache.constant;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/constant.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _configCache.constant = JSON.parse(xhr.responseText)[1]; // key "1"
                return _configCache.constant;
            }
        } catch (e) { /* fall through */ }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Get item balance from user's totalProps._items.
     * totalProps._items is ARRAY: [{ _id, _num }, ...]
     */
    function getItemBalance(savedData, itemId) {
        var items = savedData && savedData.totalProps && savedData.totalProps._items;
        if (!items || !Array.isArray(items)) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    /**
     * Deduct item from user's totalProps._items.
     * SETS absolute value (not delta).
     * Returns new balance after deduction.
     */
    function deductItem(savedData, itemId, amount) {
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                var current = Number(items[i]._num) || 0;
                var newBalance = current - amount;
                items[i]._num = Math.max(0, newBalance);
                return items[i]._num;
            }
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleRefresh(request, callback) {
        var userId = request.userId;
        var marketType = Number(request.marketType);

        log.info('SHOP', 'shop/refresh START — userId=' + (userId || '-')
            + ', marketType=' + marketType
            + ' (' + (MARKET_TYPE_NAMES[marketType] || 'UNKNOWN') + ')');

        try {
            // ═══ VALIDASI 1: userId ═══
            if (!userId || typeof userId !== 'string' || userId.trim() === '') {
                log.warn('SHOP', 'refresh — missing or invalid userId');
                callback({}, 1);
                return;
            }

            // ═══ VALIDASI 2: marketType ═══
            if (VALID_MARKET_TYPES.indexOf(marketType) === -1) {
                log.warn('SHOP', 'refresh — invalid marketType: ' + marketType);
                callback({}, 1);
                return;
            }

            // ═══ LOAD CONFIG ═══
            var constant = loadConstant();
            if (!constant) {
                log.error('SHOP', 'refresh — failed to load constant.json');
                callback({}, 1);
                return;
            }

            var costConfig = REFRESH_COST_CONFIG[marketType];
            var refreshItemId = Number(constant[costConfig.idKey]);
            var refreshPrice = Number(constant[costConfig.priceKey]);

            if (!refreshItemId || !refreshPrice) {
                log.error('SHOP', 'refresh — missing cost config for marketType ' + marketType
                    + ': idKey=' + costConfig.idKey + ' priceKey=' + costConfig.priceKey);
                callback({}, 1);
                return;
            }

            // ═══ LOAD USER DATA ═══
            var uKey = userStorageKey(userId);
            var savedData = db._get(uKey);
            if (!savedData) {
                log.warn('SHOP', 'refresh — user data not found: ' + uKey);
                callback({}, 1);
                return;
            }

            // ═══ VALIDASI 3: Cek saldo cukup ═══
            var currentBalance = getItemBalance(savedData, refreshItemId);
            if (currentBalance < refreshPrice) {
                log.warn('SHOP', 'refresh — insufficient balance: have ' + currentBalance
                    + ', need ' + refreshPrice + ' (item ' + refreshItemId + ')');
                callback({}, 1);
                return;
            }

            // ═══ LOAD SHOP STATE ═══
            var sKey = shopStorageKey(userId);
            var shopState = db._get(sKey);

            // Normalize jika null/corrupt
            if (!shopState || typeof shopState !== 'object') {
                shopState = {
                    _id: 'shop_' + userId + '_' + Date.now(),
                    _buyTimes: {},
                    _autoRefreshTime: {},
                    _lastUpdate: Date.now()
                };
            }
            if (!shopState._buyTimes || typeof shopState._buyTimes !== 'object') {
                shopState._buyTimes = {};
            }
            if (!shopState._autoRefreshTime || typeof shopState._autoRefreshTime !== 'object') {
                shopState._autoRefreshTime = {};
            }

            var mtKey = String(marketType);

            // ═══ DEDUCT CURRENCY ═══
            var newBalance = deductItem(savedData, refreshItemId, refreshPrice);

            // ═══ RESET BUY TIMES & SET NEW REFRESH TIMER ═══
            var now = Date.now();
            shopState._buyTimes[mtKey] = {};
            shopState._autoRefreshTime[mtKey] = now + AUTO_REFRESH_INTERVAL_MS;
            shopState._lastUpdate = now;

            // ═══ SAVE ═══
            db._set(sKey, shopState);
            db._set(uKey, savedData);

            // ═══ BUILD RESPONSE ═══
            // _shop: update buyTimes & autoRefreshTime
            var shopResponse = {
                _id: shopState._id,
                _buyTimes: shopState._buyTimes,
                _autoRefreshTime: shopState._autoRefreshTime
            };

            // _changeInfo: item deduction (ABSOLUTE value)
            var changeItems = {};
            changeItems[String(refreshItemId)] = {
                _id: refreshItemId,
                _num: newBalance
            };

            log.info('SHOP', 'shop/refresh SUCCESS — ' + MARKET_TYPE_NAMES[marketType]
                + ' refreshed, cost ' + refreshPrice + 'x item ' + refreshItemId
                + ', new balance=' + newBalance);
            log.details('response', [
                ['userId', userId],
                ['marketType', String(marketType) + ' (' + MARKET_TYPE_NAMES[marketType] + ')'],
                ['refreshCost', refreshPrice + 'x item ' + refreshItemId],
                ['oldBalance', String(currentBalance)],
                ['newBalance', String(newBalance)],
                ['nextAutoRefresh', new Date(shopState._autoRefreshTime[mtKey]).toISOString()]
            ]);

            callback({
                _shop: shopResponse,
                _changeInfo: {
                    _items: changeItems
                }
            });

        } catch (err) {
            log.error('SHOP', 'refresh UNCAUGHT ERROR: ' + err.message);
            log.error('SHOP', 'Stack: ' + (err.stack || '(no stack)'));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('shop', 'refresh', handleRefresh);

    window.MainServer = MainServer;
})();