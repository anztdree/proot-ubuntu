/**
 * handlers/gift/getLevelReward.js — Level Gift Reward Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: gift/getLevelReward
 * ============================================================
 *
 * CLIENT CALL — LevelGiftListItem.receiveBtnTap() (L156614-156628):
 *   ts.processHandler({
 *     type: "gift",
 *     action: "getLevelReward",
 *     userId: UserInfoSingleton.getInstance().userId,
 *     giftId: e.giftId,          ← levelBonus.json entry id (1-20)
 *     version: "1.0"
 *   }, function(t) {
 *       UIWindowManager.openCongratulationObtain(t),
 *       WelfareInfoManager.getInstance().setLevelGiftInfoByID(e.giftId, t._levelGiftCount),
 *       WelfareInfoManager.getInstance().setFundGiftInfoByID(e.giftId, t._fundGiftCount ? t._fundGiftCount : 0),
 *       e.executeUpdataUIFunc()
 *   }, function(e) {
 *       Logger.serverDebugLog("领取等级礼包失败！！！")
 *   })
 *
 * ============================================================
 * CLIENT FLOW — Dua fase klaim per giftId
 * ============================================================
 *
 * Fase 1: Normal Reward (goodsID1-3/num1-3)
 *   - Tombol muncul saat player level >= giftLevel
 *   - Client guard L156616: if(lockImgVisible && hasBuyCount==1) → buka buyFund dialog (NO server call)
 *     lockImgVisible = !checkBuyFund() = !isBuyFund
 *   - Jika !lockImgVisible (isBuyFund=true) atau hasBuyCount!=1 → kirim request ke server
 *   - Server: levelGiftCount[giftId] belum ada → beri 3 item normal → set levelGiftCount[giftId]=1
 *
 * Fase 2: Fund Reward (fundOutput1/fundNum1)
 *   - Hanya bisa setelah: (a) normal sudah di-claim, (b) player sudah buyFund
 *   - Tombol muncul: hasBuyCount==1 (normal sudah claim), o.visible = true
 *   - Client guard L156616: lockImgVisible(false karena isBuyFund=true) → lewat, kirim request
 *   - Server: levelGiftCount[giftId]>=1, fundGiftCount[giftId] belum ada → beri 1 item fund → set fundGiftCount[giftId]=1
 *
 * UI state di processAll() L156579-156585:
 *   - Button visible: level <= userLevel DAN !(hasBuyFundCount==1 && hasBuyCount==1)
 *   - hasReceiveImg visible: hasBuyFundCount==1 && hasBuyCount==1 (semua sudah claim)
 *   - n (normal part) visible: hasBuyCount != 1
 *   - o (fund part) visible: hasBuyCount == 1
 *   - achiveImg visible: level <= userLevel (level tercapai)
 *
 * ============================================================
 * STATE (savedData.giftInfo)
 * ============================================================
 *   _levelGiftCount: { [giftId]: <number> }
 *     - 0 / undefined / falsy → belum claim normal reward
 *     - truthy (client cek: n && n >= 1 via existLevelGiftItem) → sudah claim
 *     - Dipakai: hasBuyCount di initLevelGiftList L157079
 *
 *   _fundGiftCount: { [giftId]: <number> }
 *     - 0 / undefined / falsy → belum claim fund reward
 *     - truthy → sudah claim
 *     - Dipakai: hasBuyFundCount di initLevelGiftList L157080
 *
 *   _isBuyFund: boolean
 *     - false → belum beli fund (fund reward terkunci, lockImgVisible=true)
 *     - true → sudah beli fund (fund reward bisa di-claim)
 *     - Dipakai: checkBuyFund() L157078, lockImgVisible L157078
 *
 * ============================================================
 * CONFIG: levelBonus.json
 * ============================================================
 *   "1": { id:1, level:10, goodsID1:101, num1:100, goodsID2:134, num2:100,
 *          goodsID3:102, num3:50000, fundOutput1:3301, fundNum1:1 }
 *   "2": { id:2, level:20, ... }
 *   ...sampai "20": { id:20, level:200, ... }
 *
 *   Normal reward: goodsID1/num1, goodsID2/num2, goodsID3/num3 (selalu 3 slot)
 *   Fund reward:  fundOutput1/fundNum1 (1 slot, cuma bisa kalau isBuyFund)
 *
 * ============================================================
 * PLAYER LEVEL — baca dari totalProps._items where _id==104 (PLAYERLEVELID)
 * ============================================================
 *   UserInfoSingleton.getUserLevel() L62464:
 *     return ItemsCommonSingleton.getInstance().getItemNum(PLAYERLEVELID)
 *   Jadi player level = totalProps._items cari _id===104, ambil _num
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 * {
 *   _changeInfo: {
 *     _items: {
 *       "101": { _id: 101, _num: 1234 },    ← ABSOLUTE balance (SET by client)
 *       "134": { _id: 134, _num: 567 },
 *       "102": { _id: 102, _num: 999999 }
 *     }
 *   },
 *   _levelGiftCount: 1,     ← value untuk giftId ini (client: giftInfo._levelGiftCount[giftId] = t)
 *   _fundGiftCount: 0       ← value untuk giftId ini (client: giftInfo._fundGiftCount[giftId] = t || 0)
 * }
 *
 * openCongratulationObtain(t) L56636:
 *   - Cek t._changeInfo || t._addHeroes || ... (minimal salah satu ada)
 *   - t._changeInfo && (i = t._changeInfo._items)
 *   - ItemsCommonSingleton.openCommonItemGetTips(i, ...) → render popup
 *   - Jika tidak ada _changeInfo → log "没有任何东西！！！" dan skip popup
 *
 * ============================================================
 * STATE MODIFIED BY THIS HANDLER
 * ============================================================
 *   gift/getLevelReward → updates _levelGiftCount[giftId], _fundGiftCount[giftId]
 *   (per getRewardInfo.js L91 documentation)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;
    var PLAYERLEVELID = 104;

    if (!MainServer.handlers.gift) {
        MainServer.handlers.gift = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE & CONFIG LOADER
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
    //  ITEM BALANCE — read/write totalProps._items (ARRAY format)
    //  Server storage: totalProps._items = [{_id, _num}, ...]
    //  Client reads:   setItem(id, num) → items[id] = num (SET, not +=)
    // ═══════════════════════════════════════════════════════════

    function getBal(sd, id) {
        var items = sd && sd.totalProps && sd.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    function setBal(sd, id, val) {
        if (!sd.totalProps) sd.totalProps = { _items: [] };
        if (!sd.totalProps._items) sd.totalProps._items = [];
        var items = sd.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) { items[i]._num = val; return; }
        }
        items.push({ _id: id, _num: val });
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: gift/getLevelReward
    // ═══════════════════════════════════════════════════════════

    function handleGetLevelReward(request, callback) {
        var userId = request.userId;
        var giftId = request.giftId;

        log.info('LEVELREWARD', 'gift/getLevelReward processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['giftId', giftId !== undefined ? giftId : '-'],
            ['version', request.version || '-']
        ]);

        try {
            // ── 1. Validate ──
            if (!userId) {
                log.warn('LEVELREWARD', 'Missing userId');
                callback({}, 1);
                return;
            }
            if (giftId === undefined || giftId === null) {
                log.warn('LEVELREWARD', 'Missing giftId');
                callback({}, 1);
                return;
            }

            var giftIdStr = String(giftId);

            // ── 2. Load savedData ──
            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('LEVELREWARD', 'User data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // ── 3. Ensure giftInfo structure ──
            if (!savedData.giftInfo) savedData.giftInfo = {};
            var giftInfo = savedData.giftInfo;
            if (!giftInfo._levelGiftCount) giftInfo._levelGiftCount = {};
            if (!giftInfo._fundGiftCount) giftInfo._fundGiftCount = {};
            if (giftInfo._isBuyFund === undefined) giftInfo._isBuyFund = false;

            // ── 4. Load config ──
            var levelBonus = loadJson('levelBonus');
            if (!levelBonus) {
                log.error('LEVELREWARD', 'levelBonus.json not found');
                callback({}, 1);
                return;
            }

            var tier = levelBonus[giftIdStr];
            if (!tier) {
                log.warn('LEVELREWARD', 'Invalid giftId: ' + giftIdStr);
                callback({}, 1);
                return;
            }

            var requiredLevel = Number(tier.level) || 0;

            // ── 5. Validate player level ──
            //    getUserLevel() L62464: return getItemNum(PLAYERLEVELID) where PLAYERLEVELID=104
            var playerLevel = getBal(savedData, PLAYERLEVELID);
            if (playerLevel < requiredLevel) {
                log.warn('LEVELREWARD', 'Player level ' + playerLevel + ' < required ' + requiredLevel);
                callback({}, 1);
                return;
            }

            // ── 6. Determine claim phase based on current state ──
            var normalClaimed = giftInfo._levelGiftCount[giftIdStr];
            var fundClaimed = giftInfo._fundGiftCount[giftIdStr];

            // both already claimed
            if (normalClaimed && fundClaimed) {
                log.warn('LEVELREWARD', 'Already fully claimed giftId=' + giftIdStr);
                callback({}, 1);
                return;
            }

            var changeItems = {};
            var claimType; // 'normal' or 'fund'

            if (!normalClaimed) {
                // ── PHASE 1: Claim normal reward (goodsID1-3 / num1-3) ──
                claimType = 'normal';

                for (var slot = 1; slot <= 3; slot++) {
                    var itemId = Number(tier['goodsID' + slot]) || 0;
                    var num = Number(tier['num' + slot]) || 0;
                    if (itemId <= 0 || num <= 0) continue;

                    var oldBal = getBal(savedData, itemId);
                    var newBal = oldBal + num;
                    setBal(savedData, itemId, newBal);

                    changeItems[String(itemId)] = { _id: itemId, _num: newBal };
                }

                // Mark normal reward claimed
                giftInfo._levelGiftCount[giftIdStr] = 1;

                log.details('claim', [
                    ['type', 'normal'],
                    ['giftId', giftIdStr],
                    ['items', JSON.stringify(changeItems)]
                ]);

            } else {
                // ── PHASE 2: Claim fund reward (fundOutput1 / fundNum1) ──
                //    Normal sudah claim, fund belum → cek isBuyFund
                if (!giftInfo._isBuyFund) {
                    log.warn('LEVELREWARD', 'Fund not purchased, cannot claim fund reward giftId=' + giftIdStr);
                    callback({}, 1);
                    return;
                }

                claimType = 'fund';

                var fundItemId = Number(tier.fundOutput1) || 0;
                var fundNum = Number(tier.fundNum1) || 0;

                if (fundItemId <= 0 || fundNum <= 0) {
                    log.error('LEVELREWARD', 'Fund reward config invalid giftId=' + giftIdStr + ' fundOutput1=' + tier.fundOutput1 + ' fundNum1=' + tier.fundNum1);
                    callback({}, 1);
                    return;
                }

                var oldFundBal = getBal(savedData, fundItemId);
                var newFundBal = oldFundBal + fundNum;
                setBal(savedData, fundItemId, newFundBal);

                changeItems[String(fundItemId)] = { _id: fundItemId, _num: newFundBal };

                // Mark fund reward claimed
                giftInfo._fundGiftCount[giftIdStr] = 1;

                log.details('claim', [
                    ['type', 'fund'],
                    ['giftId', giftIdStr],
                    ['items', JSON.stringify(changeItems)]
                ]);
            }

            // ── 7. Persist ──
            db._set(storageKey, savedData);

            // ── 8. Build response ──
            //    Client L156624-156625:
            //      setLevelGiftInfoByID(giftId, t._levelGiftCount) → giftInfo._levelGiftCount[giftId] = t
            //      setFundGiftInfoByID(giftId, t._fundGiftCount ? t._fundGiftCount : 0) → giftInfo._fundGiftCount[giftId] = t||0
            //    openCongratulationObtain(t) → butuh t._changeInfo._items
            var response = {
                _changeInfo: { _items: changeItems },
                _levelGiftCount: giftInfo._levelGiftCount[giftIdStr],
                _fundGiftCount: giftInfo._fundGiftCount[giftIdStr] || 0
            };

            log.info('LEVELREWARD', 'success userId=' + userId +
                ' giftId=' + giftIdStr +
                ' claim=' + claimType +
                ' level=' + playerLevel + '>=' + requiredLevel +
                ' levelGiftCount=' + response._levelGiftCount +
                ' fundGiftCount=' + response._fundGiftCount);

            callback(response);

        } catch (err) {
            log.error('LEVELREWARD', 'UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('gift', 'getLevelReward', handleGetLevelReward);

    window.MainServer = MainServer;
})();