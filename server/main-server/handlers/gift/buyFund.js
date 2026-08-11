/**
 * handlers/gift/buyFund.js — Level Gift Fund Purchase Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS & TANGGUNG JAWAB (1 file, 1 action):
 * ============================================================
 * Handler untuk: { type:"gift", action:"buyFund", userId, version:"1.0" }
 *
 * Ini adalah handler pembayaran IAP (In-App Purchase) untuk "Level Gift Fund".
 * Fund = paket berbayar yang membuka "Big Reward" di setiap tier level gift.
 * Setelah membeli fund, player bisa klaim fund reward (fundOutput1/fundNum1)
 * di setiap tier via gift/getLevelReward.
 *
 * ALUR KERJA HANDLER INI:
 *   1. Validate request (userId)
 *   2. Load savedData, cek apakah sudah pernah buyFund (_isBuyFund)
 *   3. Jika sudah beli → reject (sudah punya fund)
 *   4. Jika belum beli → set _isBuyFund = true di savedData.giftInfo
 *   5. Save user data
 *   6. Kirim Notify 'payFinish' via socket (GOOD_TYPE.LEVELGIFT_FUND = 7)
 *      → Client WelfarePanel.payFinish() menerima ini
 *      → disposePushNotification(GOOD_TYPE.LEVELGIFT_FUND) → checkBuyFund()
 *      → setAlreadyBuyFund() → giftInfo._isBuyFund = true (client-side)
 *      → bigRewardBtn.visible = false (sembunyikan tombol beli)
 *      → updateUI() → re-render list (lockImgVisible hilang, fund reward terbuka)
 *   7. Return prePayRet response → client ts.payToSdk(data) → buka SDK payment
 *
 * ============================================================
 * PEMANGGIL DI CLIENT (main.min.js)
 * ============================================================
 *
 * Pemanggil 1: WelfarePanel.bigRewardBtnTap() (L156309-156323)
 *   - Tombol "Beli Fund" di atas panel Level Gift
 *   - Hanya visible kalau !checkBuyFund() (L156241)
 *   - Setelah berhasil → tombol hilang (L156249)
 *
 * Pemanggil 2: LevelGiftListItem.openBuyFundTips() (L156629-156644)
 *   - Dipanggil dari receiveBtnTap() L156616:
 *     if(lockImgVisible && hasBuyCount==1) → openBuyFundTips()
 *   - lockImgVisible = !checkBuyFund() = !isBuyFund
 *   - Jadi: normal reward sudah diklaim TAPI fund belum dibeli → redirect beli
 *   - UIWindowManager.buyTips(t, 0, 0, "", callback) → dialog konfirmasi
 *   - User konfirmasi → kirim request ke server
 *
 * KEDUA pemanggil mengirim request yang SAMA:
 *   ts.processHandler({
 *       type: "gift",
 *       action: "buyFund",
 *       userId: UserInfoSingleton.getInstance().userId,
 *       version: "1.0"
 *   }, function(e) {
 *       e.prePayRet && 0 === e.prePayRet.errorCode
 *           ? ts.payToSdk(e.prePayRet.data)    // ← buka SDK payment
 *           : Logger.serverDebugLog("预支付失败", e.prePayRet)
 *   }, function(e) {
 *       Logger.serverDebugLog("失败！！！")
 *   })
 *
 * ============================================================
 * SETELAH PEMBAYARAN SDK SELESAI — ALUR CLIENT
 * ============================================================
 *
 * 1. SDK callback → TSUIController.payFinishCallback (L77104-77117):
 *    if (e._code == 0) {
 *        ReportBsH5FaceBookSdkInfo("track", "Purchase", ...);
 *        // FIRST RECHARGE HANDLING (khusus recharge, bukan fund)
 *        WelfareInfoManager.getInstance().disposePushNotification(e);  // ← KEY
 *        ts.refreshNodePayFinish(e);
 *    }
 *
 * 2. disposePushNotification (L79585) untuk GOOD_TYPE.LEVELGIFT_FUND (=7):
 *    case GOOD_TYPE.LEVELGIFT_FUND: e.getInstance().checkBuyFund(); break;
 *
 * 3. WelfarePanel.payFinish (L156247-156249):
 *    e._goodType == GOOD_TYPE.LEVELGIFT_FUND && (
 *        WelfareInfoManager.getInstance().setAlreadyBuyFund(),  // _isBuyFund = true
 *        t.bigRewardBtn.visible = !1                         // sembunyikan tombol beli
 *    )
 *    t.updateUI()  // re-render list: lockImgVisible=false, fund terbuka
 *
 * PERHATIAN:disposePushNotification memanggil checkBuyFund(), BUKAN setAlreadyBuyFund().
 * checkBuyFund() hanya mengembalikan giftInfo._isBuyFund.
 * Yang benar-benar SET isBuyFund = true adalah:
 *   (a) payFinish L156248: setAlreadyBuyFund() → client-side
 *   (b) Handler ini: giftInfo._isBuyFund = true → server-side (disimpan di db)
 *
 * Jadi server WAJIB set _isBuyFund = true SEBELUM kirim notify payFinish,
 * karena saat payFinish client dipanggil, client sudah baca state dari memory.
 * Tapi setelah buka Welfare panel lagi (getRewardInfo), state dari server yang dipakai.
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 * {
 *   prePayRet: {
 *     errorCode: 0,                    // 0 = success, non-0 = gagal
 *     data: {                          // ← dikirim ke ts.payToSdk(data)
 *       orderId: "...",                // unique order ID
 *       goodsId: 1,                    // dari levelBonusBuy.json id
 *       price: 14.99,                  // harga dari levelBonusBuy.json (USD)
 *       currency: "USD",
 *       roleId: "abc123",
 *       roleName: "Player1",
 *       roleLevel: 50,
 *       roleVip: 3,
 *       serverName: "Local 1",
 *       productName: "Level Gift Fund",
 *       productId: "levelGiftFund"
 *     }
 *   }
 * }
 *
 * Client check (L156639):
 *   e.prePayRet && 0 === e.prePayRet.errorCode → ts.payToSdk(e.prePayRet.data)
 * Jika prePayRet.errorCode != 0 → log "预支付失败"
 *
 * ============================================================
 * CONFIG: levelBonusBuy.json
 * ============================================================
 * {
 *   "1": {
 *     "id": 1,
 *     "CNY": 88,
 *     "USD": 14.99,
 *     "KRW": 19000,
 *     "VND": 329000,
 *     "IRR": 4499900,
 *     "name": "levelBonusBuy_name_1"
 *   }
 * }
 * Hanya 1 entry. Harga sesuai currency (ts.currency).
 *
 * ============================================================
 * STATE (savedData.giftInfo)
 * ============================================================
 *   _isBuyFund: boolean
 *     - false → belum beli fund (default)
 *     - true  → sudah beli, fund reward bisa di-claim
 *     - Dibaca: checkBuyFund() L79585, lockImgVisible L157078
 *     - Di-set oleh handler ini + client payFinish L156248
 *
 * ============================================================
 * GOOD_TYPE enum (L88139)
 * ============================================================
 *   GOOD_TYPE.LEVELGIFT_FUND = 7
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var GOOD_TYPE_LEVELGIFT_FUND = 7;
    var PLAYERLEVELID = 104;
    var PLAYERVIPLEVELID = 106;

    if (!MainServer.handlers.gift) {
        MainServer.handlers.gift = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _cache[name] = JSON.parse(xhr.responseText);
                return _cache[name];
            }
        } catch (e) {}
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE — read totalProps._items (ARRAY format)
    // ═══════════════════════════════════════════════════════════

    function getBal(sd, id) {
        var items = sd && sd.totalProps && sd.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: gift/buyFund
    // ═══════════════════════════════════════════════════════════

    function handleBuyFund(request, callback) {
        var userId = request.userId;

        log.info('BUYFUND', 'gift/buyFund processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            // ── 1. Validate ──
            if (!userId) {
                log.warn('BUYFUND', 'Missing userId');
                callback({ prePayRet: { errorCode: 1 } });
                return;
            }

            // ── 2. Load savedData ──
            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('BUYFUND', 'User data not found: ' + storageKey);
                callback({ prePayRet: { errorCode: 1 } });
                return;
            }

            // ── 3. Ensure giftInfo structure ──
            if (!savedData.giftInfo) savedData.giftInfo = {};
            var giftInfo = savedData.giftInfo;

            // ── 4. Check if already purchased ──
            if (giftInfo._isBuyFund) {
                log.warn('BUYFUND', 'Already purchased fund userId=' + userId);
                callback({ prePayRet: { errorCode: 1 } });
                return;
            }

            // ── 5. Load config ──
            var levelBonusBuy = loadJson('levelBonusBuy');
            var fundConfig = levelBonusBuy ? levelBonusBuy['1'] : null;

            var price = 14.99; // default fallback
            var productName = 'Level Gift Fund';

            if (fundConfig) {
                // Harga sesuai currency. ts.currency di-set di login response (L77645)
                // Client L156234: ReadJsonSingleton.getInstance().levelBonusBuy[1]
                // Client L156235: ToolCommon.getPriceInfoWithCurrency(t[ts.currency])
                // Di sini kita pakai USD sebagai default, SDK akan handle currency conversion
                price = Number(fundConfig.USD) || 14.99;
                productName = fundConfig.name || productName;
            }

            // ── 6. Set _isBuyFund = true (server-side state) ──
            giftInfo._isBuyFund = true;

            // ── 7. Persist ──
            db._set(storageKey, savedData);

            log.info('BUYFUND', 'Fund purchased userId=' + userId + ' price=' + price + ' USD');

            // ── 8. Send Notify 'payFinish' via socket ──
            //    Client (L77104-77117): if _code==0 → disposePushNotification + refreshNodePayFinish
            //    disposePushNotification GOOD_TYPE.LEVELGIFT_FUND (L79585):
            //      → checkBuyFund() (cek state client-side)
            //    WelfarePanel.payFinish (L156247-156249):
            //      → setAlreadyBuyFund() → _isBuyFund = true (client memory)
            //      → bigRewardBtn.visible = false
            //      → updateUI()
            var payFinishPayload = {
                action: 'payFinish',
                _code: 0,
                _goodType: GOOD_TYPE_LEVELGIFT_FUND,
                _goodId: 1,
                _detail: {}
            };

            MainServer.log.notify('payFinish', payFinishPayload);

            log.info('BUYFUND', 'Notify payFinish sent — _code=0, _goodType=' + GOOD_TYPE_LEVELGIFT_FUND);

            // ── 9. Build prePayRet response ──
            //    Client (L156639):
            //      e.prePayRet && 0 === e.prePayRet.errorCode ? ts.payToSdk(e.prePayRet.data) : ...
            //    payToSdk (L77138-77139):
            //      TSBrowser.executeFunction("paySdk", e)
            //      payToSdk akan menambahkan: roleId, roleName, roleLevel, roleVip, serverName
            var userInfo = {
                roleId: String(savedData.user ? savedData.user._id : userId),
                roleName: String(savedData.user ? savedData.user._nickName : ''),
                roleLevel: getBal(savedData, PLAYERLEVELID) || 1,
                roleVip: getBal(savedData, PLAYERVIPLEVELID) || 0
            };

            var prePayData = {
                orderId: 'fund_' + userId + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10),
                goodsId: 1,
                price: price,
                currency: 'USD',
                productId: 'levelGiftFund',
                productName: productName,
                serverName: 'Local 1'
            };

            // payToSdk L77138-77139 menambahkan field ini secara otomatis:
            // e.roleId = UserInfoSingleton.getInstance().userId
            // e.roleName = UserInfoSingleton.getInstance().userNickName
            // e.roleLevel = UserInfoSingleton.getInstance().getUserLevel()
            // e.roleVip = UserInfoSingleton.getInstance().userVipLevel
            // e.serverName = ts.loginInfo.serverName

            var response = {
                prePayRet: {
                    errorCode: 0,
                    data: prePayData
                }
            };

            log.info('BUYFUND', 'success — prePayRet sent, SDK payment will follow');
            log.details('prePayRet', [
                ['errorCode', '0'],
                ['orderId', prePayData.orderId],
                ['price', String(price) + ' USD'],
                ['roleId', userInfo.roleId],
                ['roleLevel', String(userInfo.roleLevel)],
                ['roleVip', String(userInfo.roleVip)]
            ]);

            callback(response);

        } catch (err) {
            log.error('BUYFUND', 'UNCAUGHT ERROR', err);
            callback({ prePayRet: { errorCode: 1 } });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('gift', 'buyFund', handleBuyFund);

    window.MainServer = MainServer;
})();