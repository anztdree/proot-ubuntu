/**
 * handlers/hangup/buyLessonFund.js
 * Super Warrior Z — Private Server
 *
 * ══════════════════════════════════════════════════════════════════
 * HANDLER: { type:"hangup", action:"buyLessonFund", userId, version:"1.0" }
 * ══════════════════════════════════════════════════════════════════
 *
 * IAP (In-App Purchase) untuk "Lesson Fund" / "Level Privilege".
 * Fund = paket berbayar yang membuka reward di setiap chapter milestone.
 * Setelah membeli, player bisa klaim reward per chapter via getLessonFundReward.
 *
 * ══════════════════════════════════════════════════════════════════
 * CLIENT FLOW (CommonPrivilegeReward.privilgeBtnTap)
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. User tap tombol "Beli" di window CommonPrivilegeReward
 *    → UIWindowManager.buyPrivilegeTips(tips, image, rewardList, price, callback)
 *
 * 2. User konfirmasi → callback dipanggil:
 *    ts.processHandler({
 *        type: "hangup",
 *        action: "buyLessonFund",
 *        userId: ...,
 *        version: "1.0"
 *    }, function(e) {
 *        e.prePayRet && 0 === e.prePayRet.errorCode
 *            ? ts.payToSdk(e.prePayRet.data)     // buka SDK payment
 *            : Logger.serverDebugLog("预支付失败", e.prePayRet)
 *    })
 *
 * 3. SDK payment selesai → TSUIController.payFinishCallback:
 *    if (e._code == 0) {
 *        WelfareInfoManager.getInstance().disposePushNotification(e);
 *        ts.refreshNodePayFinish(e);
 *    }
 *
 * 4. disposePushNotification GOOD_TYPE.LESSON_FUND (=8):
 *    OnHookSingleton.getInstance().setBuyFund(!0)
 *    → _buyFund = true di client memory
 *
 * 5. CommonPrivilegeReward.payFinish:
 *    if (e._goodType == GOOD_TYPE.LESSON_FUND) {
 *        OnHookSingleton.getInstance().setBuyFund(!0);
 *        privilegeState = true  → tombol beli hilang, tombol claim muncul
 *        initList() + refreshList()
 *    }
 *
 * ══════════════════════════════════════════════════════════════════
 * SETELAH BUY → KLAIM REWARD
 * ══════════════════════════════════════════════════════════════════
 *
 * Setelah buyFund, player bisa klaim reward per chapter:
 *   CommonPrivilegeRewardListItem.receiveBtnTap()
 *   → levelPrivilegeRequest(levelID)
 *   → ts.processHandler({
 *         type: "hangup",
 *         action: "getLessonFundReward",
 *         chapterId: levelID,     // dari LevelPrivilege.json .levelID
 *         userId: ...,
 *         version: "1.0"
 *     }, function(e) {
 *         UIWindowManager.openCongratulationObtain(e);
 *         TSEvent.getInstance().dispatch(refreshPrivilegeTasks, { itemId: levelID })
 *     })
 *
 * ══════════════════════════════════════════════════════════════════
 * CONFIG
 * ══════════════════════════════════════════════════════════════════
 *
 * LevelPrivilegeBuy.json[1]:
 *   { id:1, CNY:128, USD:19.99, KRW:25000, VND:449000, IRR:5999900 }
 *   Harga sesuai currency (ts.currency).
 *
 * LevelPrivilege.json:
 *   Key = id (801-831), tiap entry:
 *   { id, levelID, award:101, num:2000 }
 *   → reward: 2000 diamond (item 101) per chapter milestone
 *
 * chapter.json:
 *   Dipakai client untuk menampilkan nama chapter di UI privilege list.
 *
 * ══════════════════════════════════════════════════════════════════
 * STATE (savedData.hangup)
 * ══════════════════════════════════════════════════════════════════
 *
 * _buyFund: boolean
 *   false → belum beli (default)
 *   true  → sudah beli, fund reward bisa di-claim
 *   Dibaca: OnHookSingleton.getBuyFund(), deserialize setOnHook
 *   Di-set: handler ini (server) + payFinish client
 *
 * _haveGotFundReward: object { "801": true, "802": true, ... }
 *   Key = levelID dari LevelPrivilege.json
 *   value = true kalau sudah di-claim
 *   Dibaca: OnHookSingleton.getCurChapterPrivilegeState(), deserialize setOnHook
 *   Di-set: getLessonFundReward handler + client setCurChapterPrivilegeState
 *
 * ══════════════════════════════════════════════════════════════════
 * GOOD_TYPE (client enum L88137)
 * ══════════════════════════════════════════════════════════════════
 *   GOOD_TYPE.LESSON_FUND = 8
 *
 * ══════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ══════════════════════════════════════════════════════════════════
 * {
 *   prePayRet: {
 *     errorCode: 0,
 *     data: {
 *       orderId: "fund_<userId>_<ts>_<random>",
 *       goodsId: 1,
 *       price: 19.99,
 *       currency: "USD",
 *       productId: "lessonFund",
 *       productName: "LevelPrivilegeBuy_name_1",
 *       serverName: "Local 1"
 *     }
 *   }
 * }
 *
 * Client check: e.prePayRet && 0 === e.prePayRet.errorCode → ts.payToSdk(data)
 * Jika error → log "预支付失败"
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var GOOD_TYPE_LESSON_FUND = 8;
    var PLAYERLEVELID = 104;
    var PLAYERVIPLEVELID = 106;

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
    //  HANDLER: hangup/buyLessonFund
    // ═══════════════════════════════════════════════════════════

    function handleBuyLessonFund(request, callback) {
        var userId = request.userId;

        log.info('BUYLF', 'hangup/buyLessonFund processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            // ── 1. Validate ──
            if (!userId) {
                log.warn('BUYLF', 'Missing userId');
                callback({ prePayRet: { errorCode: 1 } });
                return;
            }

            // ── 2. Load savedData ──
            var key = 'ms_user_' + userId + '_1';
            var sd = db._get(key);

            if (!sd) {
                log.warn('BUYLF', 'User data not found: ' + key);
                callback({ prePayRet: { errorCode: 1 } });
                return;
            }

            // ── 3. Ensure hangup structure ──
            if (!sd.hangup) sd.hangup = {};

            // ── 4. Check if already purchased ──
            if (sd.hangup._buyFund) {
                log.warn('BUYLF', 'Already purchased lesson fund userId=' + userId);
                callback({ prePayRet: { errorCode: 1 } });
                return;
            }

            // ── 5. Load config (LevelPrivilegeBuy.json) ──
            var buyCfg = loadJson('LevelPrivilegeBuy');
            var fundConfig = buyCfg ? buyCfg['1'] : null;

            var price = 19.99;
            var productName = 'LevelPrivilegeBuy_name_1';

            if (fundConfig) {
                price = Number(fundConfig.USD) || 19.99;
                productName = fundConfig.name || productName;
            }

            // ── 6. Set _buyFund = true (server-side state) ──
            //    HARUS sebelum notify payFinish, karena saat payFinish
            //    client dipanggil, client sudah baca state dari memory.
            sd.hangup._buyFund = true;

            // ── 7. Persist ──
            db._set(key, sd);

            log.info('BUYLF', 'Lesson fund purchased userId=' + userId + ' price=' + price + ' USD');

            // ── 8. Send Notify 'payFinish' via socket ──
            //    Client disposePushNotification GOOD_TYPE.LESSON_FUND (8):
            //      → OnHookSingleton.getInstance().setBuyFund(!0)
            //    Client CommonPrivilegeReward.payFinish:
            //      → privilegeState = true, tombol beli → tombol claim
            //      → initList() + refreshList()
            var payFinishPayload = {
                action: 'payFinish',
                _code: 0,
                _goodType: GOOD_TYPE_LESSON_FUND,
                _goodId: 1,
                _detail: {}
            };

            log.notify('BUYLF', payFinishPayload);
            log.info('BUYLF', 'Notify payFinish sent — _code=0, _goodType=' + GOOD_TYPE_LESSON_FUND);

            // ── 9. Build prePayRet response ──
            //    Client: e.prePayRet && 0 === e.prePayRet.errorCode
            //      → ts.payToSdk(e.prePayRet.data)
            //    payToSdk otomatis menambahkan:
            //      roleId, roleName, roleLevel, roleVip, serverName
            var prePayData = {
                orderId: 'lessonFund_' + userId + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10),
                goodsId: 1,
                price: price,
                currency: 'USD',
                productId: 'lessonFund',
                productName: productName,
                serverName: 'Local 1'
            };

            var response = {
                prePayRet: {
                    errorCode: 0,
                    data: prePayData
                }
            };

            log.details('prePayRet', [
                ['errorCode', '0'],
                ['orderId', prePayData.orderId],
                ['price', String(price) + ' USD'],
                ['roleId', String(userId)],
                ['roleLevel', String(getBal(sd, PLAYERLEVELID) || 1)],
                ['roleVip', String(getBal(sd, PLAYERVIPLEVELID) || 0)]
            ]);

            callback(response);

        } catch (err) {
            log.error('BUYLF', 'UNCAUGHT ERROR', err);
            callback({ prePayRet: { errorCode: 1 } });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hangup', 'buyLessonFund', handleBuyLessonFund);

    window.MainServer = MainServer;
})();