/**
 * handlers/recharge/recharge.js — Recharge Handler (DRAFT v1 — for review)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS & TANGGUNG JAWAB FILE INI (1 file, 1 action):
 *   Handler untuk request: { type:"recharge", action:"recharge", userId, goodsId, version:"1.0" }
 *   Response:              { prePayRet: { errorCode, data } }
 *
 *   Server WAJIB (ALL-IN-ONE — handle semua di handler ini):
 *     1. Validate request (userId, goodsId)
 *     2. Load config recharge.json
 *     3. Cek first-time purchase (per-goodsId)
 *     4. Process:
 *        a. Add diamond (item 101) — firstPresent atau normalPresent
 *        b. Add VIP Exp All (item 107) — Math.floor(price * 10)
 *        c. Recalculate VIP Level (item 106) — dari vipUpgrade.json cumulative thresholds
 *        d. Update recharge._haveBought[goodsId] = true
 *        e. Update giftInfo._fristRecharge._canGetReward = true (jika first recharge ever)
 *     5. Save user data
 *     6. Kirim Notify 'payFinish' via socket
 *     7. Kirim Notify 'vipLevel' jika VIP level naik
 *     8. Return prePayRet: { errorCode: 0, data: {...} }
 * ============================================================
 *
 * VIP EXP FORMULA (main.min.js L155868-155877):
 *   1 USD = 10 VIP exp → vipExp = Math.floor(price * 10)
 *   VIP exp stored di item 107 (PLAYERVIPEXPALLID)
 *   VIP level stored di item 106 (PLAYERVIPLEVELID)
 *
 *   VIP level = highest level where cumulative_exp <= total_vip_exp
 *   Cumulative thresholds dari vipUpgrade.json (sum of expNeeded)
 *
 * CONFIG FILES:
 *   recharge.json — 14 entries (goodsId, price, diamond, fristPresent, normalPresent, show, name)
 *   vipUpgrade.json — 18 entries (VIP level 0-17, expNeeded per level)
 *
 * EVIDENCE DARI main.min(unminfy).js:
 *   [PEMANGGILAN] L156689-156701: recharge/recharge → prePayRet → payToSdk
 *   [payToSdk] L77138-77139: window.paySdk(data)
 *   [Notify payFinish] L77037, L77104-77117:
 *     _code=0 → openCongratulationObtain(e._detail) + disposePushNotification(e)
 *   [disposePushNotification GOOD_TYPE.RECHARGE] L79585:
 *     newRechargeModel._haveBought = e._detail._haveBought
 *   [openCongratulationObtain] L56636-56651:
 *     baca t._changeInfo._items → openCommonItemGetTips → setItem(Number(key), _num)
 *     ⚠️ _items HARUS OBJECT keyed by string item ID, bukan ARRAY!
 *   [VIP exp display] L155868-155877:
 *     a = getItemNum(PLAYERVIPEXPALLID) // item 107
 *     r = cumulative expNeeded for current VIP level
 *     (r - a) / 10 = USD needed to next level
 *   [VIP level getter] L62392-62394:
 *     userVipLevel = getItemNum(PLAYERVIPLEVELID) // item 106
 *   [Notify vipLevel] L77043:
 *     WelfareInfoManager.getInstance().addVipLogInfo(e)
 *   [GOOD_TYPE enum] L88137: RECHARGE = 1
 *   [enterGame recharge field] enterGame.js L1287: r.recharge = { _id:'', _haveBought:{} }
 *   [enterGame firstRecharge field] enterGame.js L1276: r.giftInfo._fristRecharge = { _canGetReward:false, _haveGotReward:false }
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.recharge) {
        MainServer.handlers.recharge = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var GOOD_TYPE_RECHARGE = 1;

    var ITEM_IDS = {
        DIAMONDID: 101,
        PLAYERLEVELID: 104,
        PLAYERVIPEXPERIENCEID: 105,
        PLAYERVIPLEVELID: 106,
        PLAYERVIPEXPALLID: 107
    };

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

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
            log.error('RESOURCE', 'recharge failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'recharge failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getRechargeConfig(goodsId) {
        var data = loadJsonSync('recharge');
        return data ? data[String(goodsId)] : null;
    }

    /**
     * Load vipUpgrade.json dan return sorted array of {level, cumulative}.
     *
     * expNeeded[N] = exp untuk naik dari level N ke level N+1.
     * Jadi cumulative[level] = sum(expNeeded[0..level-1]) = total exp untuk REACH level ini.
     *   VIP 0: 0 exp (default)
     *   VIP 1: expNeeded[0] = 9 exp
     *   VIP 2: expNeeded[0] + expNeeded[1] = 50 exp
     *   VIP 12: 12000 exp
     */
    function getVipUpgradeTable() {
        var data = loadJsonSync('vipUpgrade');
        if (!data) return [];

        var entries = [];
        var cumulative = 0;
        var keys = Object.keys(data).sort(function (a, b) { return parseInt(a) - parseInt(b); });

        for (var i = 0; i < keys.length; i++) {
            var level = parseInt(keys[i]);
            // Push SEBELUM add — cumulative = total exp untuk REACH level ini
            entries.push({ level: level, cumulative: cumulative });
            var expNeeded = Number(data[keys[i]].expNeeded) || 0;
            cumulative += expNeeded;
        }

        return entries;
    }

    /**
     * Calculate VIP level dari total VIP exp.
     * VIP level = highest level where cumulative <= totalExp.
     */
    function calculateVipLevel(totalExp, vipTable) {
        var level = 0;
        for (var i = 0; i < vipTable.length; i++) {
            if (totalExp >= vipTable[i].cumulative) {
                level = vipTable[i].level;
            } else {
                break;
            }
        }
        return level;
    }

    // ═══════════════════════════════════════════════════════════
    //  USER DATA HELPERS
    // ═══════════════════════════════════════════════════════════

    function getItemBalance(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = { _items: [] };
        if (!savedData.totalProps._items) savedData.totalProps._items = [];

        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                return;
            }
        }
        items.push({ _id: Number(itemId), _num: newBalance });
    }

    function hasBoughtGoods(savedData, goodsId) {
        if (!savedData.recharge || !savedData.recharge._haveBought) return false;
        return !!savedData.recharge._haveBought[String(goodsId)];
    }

    function markGoodsAsBought(savedData, goodsId) {
        if (!savedData.recharge) savedData.recharge = { _id: '', _haveBought: {} };
        if (!savedData.recharge._haveBought) savedData.recharge._haveBought = {};
        savedData.recharge._haveBought[String(goodsId)] = true;
    }

    function getUserInfo(savedData) {
        var info = {
            roleId: '',
            roleName: '',
            roleLevel: 1,
            roleVip: 0
        };

        if (savedData.user) {
            info.roleId = String(savedData.user._id || '');
            info.roleName = String(savedData.user._nickName || '');
        }

        info.roleLevel = getItemBalance(savedData, ITEM_IDS.PLAYERLEVELID) || 1;
        info.roleVip = getItemBalance(savedData, ITEM_IDS.PLAYERVIPLEVELID) || 0;

        return info;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleRecharge(request, callback) {
        var userId = request.userId;
        var goodsId = Number(request.goodsId);

        log.info('HANDLER', 'recharge/recharge — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['goodsId', String(goodsId)],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'recharge/recharge — missing userId');
            callback({ prePayRet: { errorCode: 1, errorMsg: 'missing_userId' } });
            return;
        }
        if (!goodsId || goodsId <= 0) {
            log.error('HANDLER', 'recharge/recharge — missing or invalid goodsId');
            callback({ prePayRet: { errorCode: 1, errorMsg: 'invalid_goodsId' } });
            return;
        }

        // ── LOAD RECHARGE CONFIG ──
        var rechargeConfig = getRechargeConfig(goodsId);
        if (!rechargeConfig) {
            log.error('HANDLER', 'recharge/recharge — goodsId ' + goodsId + ' not found in recharge.json');
            callback({ prePayRet: { errorCode: 1, errorMsg: 'goods_not_found' } });
            return;
        }

        var price = Number(rechargeConfig.rmb) || 0;
        var baseDiamond = Number(rechargeConfig.diamond) || 0;
        var firstPresent = Number(rechargeConfig.fristPresent) || 0;
        var normalPresent = Number(rechargeConfig.normalPresent) || baseDiamond;

        log.details('RECHARGE_CONFIG', [
            ['goodsId', String(goodsId)],
            ['name', rechargeConfig.name || ''],
            ['price', String(price) + ' USD'],
            ['baseDiamond', String(baseDiamond)],
            ['firstPresent', String(firstPresent)],
            ['normalPresent', String(normalPresent)]
        ]);

        // ── LOAD USER DATA ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('HANDLER', 'recharge/recharge — user data not found: ' + storageKey);
            callback({ prePayRet: { errorCode: 1, errorMsg: 'user_not_found' } });
            return;
        }

        // ── CHECK FIRST-TIME PURCHASE (per-goodsId) ──
        var isFirstPurchase = !hasBoughtGoods(savedData, goodsId);

        // diamondReward = base diamond + bonus (firstPresent atau normalPresent)
        // fristPresent/normalPresent di config adalah BONUS, bukan total!
        // First buy:  diamond + fristPresent
        // Repeat buy: diamond + normalPresent
        var diamondReward = isFirstPurchase
            ? (baseDiamond + firstPresent)
            : (baseDiamond + normalPresent);

        // ── CHECK FIRST RECHARGE EVER (global, untuk firstRechargeInfo) ──
        var hasAnyRecharge = savedData.recharge && savedData.recharge._haveBought &&
            Object.keys(savedData.recharge._haveBought).length > 0;
        var isFirstRechargeEver = !hasAnyRecharge;

        log.info('RECHARGE', 'Purchase type: ' + (isFirstPurchase ? 'FIRST (x' + rechargeConfig.show + ')' : 'NORMAL') +
            ' | First recharge ever: ' + (isFirstRechargeEver ? 'YES' : 'NO'));
        log.info('RECHARGE', 'Diamond reward: ' + diamondReward);

        // ══════════════════════════════════════════════════════════
        //  PROCESS DIAMOND + VIP EXP + VIP LEVEL
        // ============================================================

        // 1. Add diamond (item 101)
        var currentDiamond = getItemBalance(savedData, ITEM_IDS.DIAMONDID);
        var newDiamond = currentDiamond + diamondReward;
        setItemBalance(savedData, ITEM_IDS.DIAMONDID, newDiamond);

        log.info('RECHARGE', 'Diamond: ' + currentDiamond + ' + ' + diamondReward + ' = ' + newDiamond);

        // 2. Add VIP Exp All (item 107) — Math.floor(price * 10)
        var vipExpGain = Math.floor(price * 10);
        var currentVipExpAll = getItemBalance(savedData, ITEM_IDS.PLAYERVIPEXPALLID);
        var newVipExpAll = currentVipExpAll + vipExpGain;
        setItemBalance(savedData, ITEM_IDS.PLAYERVIPEXPALLID, newVipExpAll);

        log.info('RECHARGE', 'VIP Exp: ' + currentVipExpAll + ' + ' + vipExpGain + ' = ' + newVipExpAll);

        // 3. Recalculate VIP Level (item 106)
        var vipTable = getVipUpgradeTable();
        var oldVipLevel = getItemBalance(savedData, ITEM_IDS.PLAYERVIPLEVELID);
        var newVipLevel = calculateVipLevel(newVipExpAll, vipTable);
        setItemBalance(savedData, ITEM_IDS.PLAYERVIPLEVELID, newVipLevel);

        log.info('RECHARGE', 'VIP Level: ' + oldVipLevel + ' → ' + newVipLevel +
            (newVipLevel > oldVipLevel ? ' (LEVEL UP!)' : ''));

        // 4. Mark goodsId sebagai sudah dibeli
        markGoodsAsBought(savedData, goodsId);

        // 5. Update firstRecharge info jika first recharge ever
        if (isFirstRechargeEver && savedData.giftInfo && savedData.giftInfo._fristRecharge) {
            savedData.giftInfo._fristRecharge._canGetReward = true;
            log.info('RECHARGE', 'First recharge ever — _canGetReward set to true');
        }

        // 6. Save user data
        db._set(storageKey, savedData);

        log.info('RECHARGE', 'Payment processed & saved to DB');

        // ══════════════════════════════════════════════════════════
        //  KIRIM NOTIFY 'payFinish'
        // ============================================================
        // Client (main.min.js L77037, L77104-77117):
        //   if (0 == e._code) {
        //       ReportBsH5FaceBookSdkInfo("track", "Purchase", { currency:"USD", value: e._detail._totalPrice });
        //       firstRechargeInfo._canGetReward = true;
        //       openCongratulationObtain(e._detail);
        //       disposePushNotification(e);
        //       refreshNodePayFinish(e);
        //   }
        //
        // openCongratulationObtain (L56636-56651):
        //   baca t._changeInfo._items → openCommonItemGetTips → setItem(Number(key), _num)
        //   ⚠️ _items HARUS OBJECT keyed by string item ID!
        //
        // disposePushNotification (L79585) untuk GOOD_TYPE.RECHARGE:
        //   newRechargeModel._haveBought = e._detail._haveBought
        // ============================================================

        var changeItems = {};
        changeItems[String(ITEM_IDS.DIAMONDID)] = { _id: ITEM_IDS.DIAMONDID, _num: newDiamond };
        changeItems[String(ITEM_IDS.PLAYERVIPEXPALLID)] = { _id: ITEM_IDS.PLAYERVIPEXPALLID, _num: newVipExpAll };
        changeItems[String(ITEM_IDS.PLAYERVIPLEVELID)] = { _id: ITEM_IDS.PLAYERVIPLEVELID, _num: newVipLevel };

        var haveBought = {};
        haveBought[String(goodsId)] = true;

        var payFinishPayload = {
            action: 'payFinish',
            _code: 0,
            _goodType: GOOD_TYPE_RECHARGE,
            _goodId: goodsId,
            _detail: {
                _totalPrice: price,
                _changeInfo: {
                    _items: changeItems
                },
                _haveBought: haveBought
            }
        };

        MainServer.log.notify('payFinish', payFinishPayload);

        log.info('RECHARGE', 'Notify payFinish sent — _code=0, _goodType=' + GOOD_TYPE_RECHARGE +
            ', _goodId=' + goodsId + ', diamond=' + newDiamond + ', vipExp=' + newVipExpAll +
            ', vipLevel=' + newVipLevel);

        // ══════════════════════════════════════════════════════════
        //  KIRIM NOTIFY 'vipLevel' (jika VIP level naik)
        // ============================================================
        // Client (main.min.js L77043):
        //   if ("vipLevel" == n) return void WelfareInfoManager.getInstance().addVipLogInfo(e);
        //
        // addVipLogInfo baca: e._displayId, e._userName
        // _displayId = index ke noticeContent.json untuk VIP log message
        // ============================================================

        if (newVipLevel > oldVipLevel) {
            var vipLevelPayload = {
                action: 'vipLevel',
                _displayId: newVipLevel,  // VIP level sebagai displayId untuk noticeContent
                _userName: savedData.user ? savedData.user._nickName : ''
            };

            MainServer.log.notify('vipLevel', vipLevelPayload);

            log.info('RECHARGE', 'Notify vipLevel sent — VIP ' + oldVipLevel + ' → ' + newVipLevel);
        }

        // ══════════════════════════════════════════════════════════
        //  BUILD prePayRet RESPONSE
        // ============================================================
        // Client (L156697-156698):
        //   e.prePayRet && 0 === e.prePayRet.errorCode ? ts.payToSdk(e.prePayRet.data) : ...
        //
        // payToSdk (L77138-77139):
        //   TSBrowser.executeFunction("paySdk", e)
        //   payToSdk akan menambahkan: roleId, roleName, roleLevel, roleVip, serverName
        // ============================================================

        var userInfo = getUserInfo(savedData);

        var prePayData = {
            orderId: 'rch_' + userId + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10),
            goodsId: goodsId,
            price: price,
            currency: 'USD',
            roleId: userInfo.roleId,
            roleName: userInfo.roleName,
            roleLevel: userInfo.roleLevel,
            roleVip: newVipLevel,  // pakai VIP level TERBARU
            serverName: 'Local 1',
            productName: rechargeConfig.name || ('Recharge Pack ' + goodsId),
            productId: goodsId
        };

        var response = {
            prePayRet: {
                errorCode: 0,
                data: prePayData
            }
        };

        log.info('HANDLER', 'recharge/recharge — SUCCESS');
        log.details('prePayRet', [
            ['errorCode', '0'],
            ['orderId', prePayData.orderId],
            ['goodsId', String(goodsId)],
            ['price', String(price) + ' USD'],
            ['roleId', userInfo.roleId],
            ['roleName', userInfo.roleName],
            ['roleLevel', String(userInfo.roleLevel)],
            ['roleVip', String(newVipLevel)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('recharge', 'recharge', handleRecharge);

    window.MainServer = MainServer;
})();
