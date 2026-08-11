/**
 * handlers/gift/getRewardInfo.js — Gift Reward Info Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: gift/getRewardInfo
 * ============================================================
 *
 * Client call (main.min(unminfy).js L57077-57092):
 *   openWelfarePanel(welfareType) →
 *     ts.processHandler({ type:'gift', action:'getRewardInfo', userId, version:'1.0' },
 *       function(t) {
 *         WelfareInfoManager.getInstance().setGiftInfo(t._info);
 *         ts.runScene("WelfarePanel", { parent:"Welfare", welfareType: e });
 *       })
 *
 * Called when player opens the Welfare panel.
 *
 * ============================================================
 * CLIENT PROCESSING — TWO-PASS FIELD CONSUMPTION
 * ============================================================
 *
 * PASS 1: setGiftInfo(e) at L79584 — reads from t._info:
 *   e._id              → giftInfo._id             (string)
 *   e._isBuyFund        → giftInfo._isBuyFund       (boolean)
 *   e._levelGiftCount   → giftInfo._levelGiftCount  ({[key]: number})
 *   e._levelBuyGift     → giftInfo._levelBuyGift    ({[key]: LevelBuyGiftItem})
 *       Each item: { _id, _buyCount, _finishTime }
 *       Processed via setLevelBuyGiftItem() at L79584
 *   e._fundGiftCount    → giftInfo._fundGiftCount   ({[key]: number})
 *
 * PASS 2: saveUserData at L77647-77651 — reads from e.giftInfo (login):
 *   setGotChannelWeeklyRewardTag(e.giftInfo)          → reads e.giftInfo._gotChannelWeeklyRewardTag
 *   setFirstRecharge(e.giftInfo._fristRecharge)       → reads e._canGetReward, e._haveGotReward
 *   setVIPRewrd(e.giftInfo._haveGotVipRewrd)          → iterates Object<string,boolean>
 *   setVIPPrerogativeGift(e.giftInfo._buyVipGiftCount)→ iterates Object<string,number>
 *   setOnlineGift(e.giftInfo._onlineGift)             → reads e._curId, e._nextTime
 *   giftInfo._gotBSAddToHomeReward                    → direct assign to UserInfoSingleton
 *   giftInfo._clickHonghuUrlTime                      → direct assign + || 0 fallback
 *
 * IMPORTANT: setGiftInfo() only reads the 5 fields above.
 *   But the response ALSO carries the saveUserData fields so they
 *   are refreshed when the Welfare panel is opened (since openWelfarePanel
 *   is the only place that re-fetches this data after login).
 *
 * ============================================================
 * WELFARE PANEL TABS — Data consumed from WelfareInfoManager
 * ============================================================
 *
 * Tab Sign (WelfareType=0): signInInfo → { _curCycle, _maxActiveDay, _lastActiveDate, _activeItem[] }
 *   → Data from e.checkin (login), NOT from getRewardInfo.
 *   → SignInItemListItem.processAll(): reads signInInfo + register JSON config
 *   → signInItemListItemTap() → server: checkin/checkin
 *
 * Tab LevelGift (WelfareType=2):
 *   → loadGift() L157061: reads getLevelGiftInfo() (= _levelGiftCount), getFundGiftInfo() (= _fundGiftCount)
 *   → LevelGiftListItem.processAll() L156579: reads hasBuyCount, hasBuyFundCount, checkBuyFund()
 *   → initLabelValue(): totalCount = sum(fundNum1) from levelBonus JSON where fundOutput1==101
 *   → receiveBtnTap() → server: gift/getLevelReward
 *   → bigRewardBtnTap() → server: gift/buyFund (hidden if _isBuyFund=true)
 *
 * Tab SuperVIP (WelfareType=3): Conditional on enableShowQQ + showQQVip <= userVipLevel
 *   → Uses showQQImg1/showQQImg2 for backgrounds
 *   → VIPPrerogativeGiftListItem: reads getVIPPrerogativeGift(id) = _buyVipGiftCount[id]
 *   → weeklyVipRewardBtnTap(): checkChannelRewardTag (giftInfo._gotChannelWeeklyRewardTag)
 *
 * Tab ChannelSpecial (WelfareType=4): Conditional on channelSpecial._show + _vip
 *   → Uses channelSpecial._bg, _icon, _btn1Url, _btn2Url
 *   → Red dot: !checkChannelRewardTag (giftInfo._gotChannelWeeklyRewardTag vs channelSpecial._weeklyRewardTag)
 *
 * ============================================================
 * MODEL DEFINITIONS (main.min.js)
 * ============================================================
 * GiftModel L88076: { _id, _levelGiftCount{}, _levelBuyGift{}, _goldBuyCount,
 *   _fristRecharge(FirstRechargeReward), _buyVipGiftCount{}, _onlineGift(OnlineGiftItem),
 *   _isBuyFund, _fundGiftCount{}, _gotChannelWeeklyRewardTag }
 * LevelBuyGiftItem L88083: { _id, _buyCount, _finishTime }
 * FirstRechargeReward L88090: { _canGetReward, _haveGotReward }
 * OnlineGiftItem L88097: { _curId, _nextTime }
 * CheckinModel L88055: { _id, _activeItem[], _curCycle, _maxActiveDay, _lastActiveDate }
 *
 * NOTE: _goldBuyCount is in GiftModel but comes from scheduleInfo._goldBuyCount
 *   via AllRefreshCount.initData() at L58006, NOT from this handler.
 *
 * ============================================================
 * STATE (savedData.giftInfo)
 * ============================================================
 *   Initialized in enterGame.js, modified by:
 *     - gift/getOnlineGift  → updates _onlineGift._curId, _nextTime
 *     - gift/buyFund        → sets _isBuyFund = true
 *     - gift/getLevelReward → updates _levelGiftCount, _fundGiftCount
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.gift) {
        MainServer.handlers.gift = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: gift/getRewardInfo
    // ═══════════════════════════════════════════════════════════

    function handleGetRewardInfo(request, callback) {
        var userId = request.userId;

        log.info('REWARDINFO', 'gift/getRewardInfo processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            // ── 1. Validate ──
            if (!userId) {
                log.warn('REWARDINFO', 'Missing userId');
                callback({}, 1);
                return;
            }

            // ── 2. Load savedData ──
            var storageKey = 'ms_user_' + userId + '_1';
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('REWARDINFO', 'User data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // ── 3. Ensure giftInfo exists (initialized by enterGame.js L1013-1024) ──
            //     enterGame only initializes: _gotChannelWeeklyRewardTag, _fristRecharge,
            //     _haveGotVipRewrd, _buyVipGiftCount, _onlineGift, _gotBSAddToHomeReward,
            //     _clickHonghuUrlTime. The setGiftInfo() fields (_id, _isBuyFund,
            //     _levelGiftCount, _levelBuyGift, _fundGiftCount) may be missing for
            //     users who haven't opened Welfare panel yet.
            if (!savedData.giftInfo) {
                log.warn('REWARDINFO', 'No giftInfo found — initializing full defaults');
                savedData.giftInfo = buildDefaultGiftInfo(userId);
                db._set(storageKey, savedData);
            }

            var giftInfo = savedData.giftInfo;

            // ── 4. Ensure ALL GiftModel fields exist (L88076-88082) ──
            //     Some fields are set by enterGame, others only by getRewardInfo or
            //     other gift handlers. We must ensure ALL are present.

            // setGiftInfo L79584: giftInfo._id = e._id
            if (!giftInfo._id) giftInfo._id = userId;

            // setGiftInfo L79584: giftInfo._isBuyFund = e._isBuyFund
            if (giftInfo._isBuyFund === undefined || giftInfo._isBuyFund === null) {
                giftInfo._isBuyFund = false;
            }

            // setGiftInfo L79584: for(var n in e._levelGiftCount) — iterated, copied
            if (!giftInfo._levelGiftCount) giftInfo._levelGiftCount = {};

            // setGiftInfo L79584: for(var n in e._levelBuyGift) → setLevelBuyGiftItem
            // Each item must have: _id, _buyCount, _finishTime
            if (!giftInfo._levelBuyGift) giftInfo._levelBuyGift = {};
            // Validate each _levelBuyGift entry has correct structure
            for (var lbk in giftInfo._levelBuyGift) {
                var lbi = giftInfo._levelBuyGift[lbk];
                if (lbi === null || typeof lbi !== 'object') {
                    giftInfo._levelBuyGift[lbk] = { _id: Number(lbk) || 0, _buyCount: 0, _finishTime: 0 };
                } else {
                    if (lbi._id === undefined) lbi._id = Number(lbk) || 0;
                    if (lbi._buyCount === undefined) lbi._buyCount = 0;
                    if (lbi._finishTime === undefined) lbi._finishTime = 0;
                }
            }

            // setGiftInfo L79584: for(var n in e._fundGiftCount) — iterated, copied
            if (!giftInfo._fundGiftCount) giftInfo._fundGiftCount = {};

            // saveUserData L77648: setVIPRewrd → iterates Object<string,boolean>
            if (!giftInfo._haveGotVipRewrd) giftInfo._haveGotVipRewrd = {};

            // saveUserData L77648: setVIPPrerogativeGift → iterates Object<string,number>
            if (!giftInfo._buyVipGiftCount) giftInfo._buyVipGiftCount = {};

            // saveUserData L77648: setFirstRecharge → reads _canGetReward, _haveGotReward
            if (!giftInfo._fristRecharge || typeof giftInfo._fristRecharge !== 'object') {
                giftInfo._fristRecharge = { _canGetReward: false, _haveGotReward: false };
            } else {
                if (giftInfo._fristRecharge._canGetReward === undefined) giftInfo._fristRecharge._canGetReward = false;
                if (giftInfo._fristRecharge._haveGotReward === undefined) giftInfo._fristRecharge._haveGotReward = false;
            }

            // saveUserData L77648: setOnlineGift → reads _curId, _nextTime
            // CRITICAL: _nextTime must be a valid timestamp (ms) for timer to work.
            // If 0 → timer immediately expired but _curId=0 → no gift claimable.
            if (!giftInfo._onlineGift || typeof giftInfo._onlineGift !== 'object') {
                giftInfo._onlineGift = { _curId: 0, _nextTime: 0 };
            } else {
                if (giftInfo._onlineGift._curId === undefined) giftInfo._onlineGift._curId = 0;
                if (giftInfo._onlineGift._nextTime === undefined) giftInfo._onlineGift._nextTime = 0;
            }

            // saveUserData L77648: setGotChannelWeeklyRewardTag → reads _gotChannelWeeklyRewardTag
            if (giftInfo._gotChannelWeeklyRewardTag === undefined || giftInfo._gotChannelWeeklyRewardTag === null) {
                giftInfo._gotChannelWeeklyRewardTag = '';
            }

            // saveUserData L77649: direct assign to UserInfoSingleton.gotBSAddToHomeReward
            if (giftInfo._gotBSAddToHomeReward === undefined || giftInfo._gotBSAddToHomeReward === null) {
                giftInfo._gotBSAddToHomeReward = false;
            }

            // saveUserData L77650: direct assign + || 0 fallback
            if (!giftInfo._clickHonghuUrlTime) giftInfo._clickHonghuUrlTime = 0;

            // GiftModel L88078: _goldBuyCount — NOT in giftInfo, comes from scheduleInfo
            // GiftModel L88078: this field exists in model but is set via:
            //   AllRefreshCount.initData(e.scheduleInfo) L58006 → setGoldBuyCount(e._goldBuyCount)
            // It lives in WelfareInfoManager._goldBuyCount, NOT in giftInfo._goldBuyCount.
            // We store it in savedData.scheduleInfo._goldBuyCount for daily reset.

            // ── 6. Persist any defaults/fixes ──
            db._set(storageKey, savedData);

            // ── 7. Repair online gift timer if corrupted ──
            //     Sama logic dengan repairOnlineGiftTimer di enterGame.js.
            //     Deteksi: _nextTime = 0 (bukan tier terakhir), NaN, negatif,
            //     atau > 48 jam di masa depan (corrupted).
            //
            //     CATATAN: Perbaikan ini hanya disimpan di server (db._set).
            //     Client TIDAK membaca _onlineGift dari getRewardInfo response
            //     karena setGiftInfo() (L79584) tidak membaca field tersebut.
            //     Jadi fix ini baru efektif setelah re-login (via saveUserData).
            repairOnlineGiftNextTime(giftInfo, storageKey, savedData);

            // ── 8. Build response ──
            //     Client at L57086: WelfareInfoManager.getInstance().setGiftInfo(t._info)
            //     Response must have _info wrapper.
            //
            //     setGiftInfo() reads 5 fields. BUT the response also carries
            //     saveUserData fields so they are refreshed when Welfare panel opens.
            //     WelfareInfoManager methods called by panel tabs access these:
            //       - getLevelGiftInfo()       → _levelGiftCount
            //       - getFundGiftInfo()         → _fundGiftCount
            //       - checkBuyFund()            → _isBuyFund
            //       - getOnLineCurId()          → _onlineGift._curId
            //       - getOnLineNextTime()       → _onlineGift._nextTime
            //       - getVIPPrerogativeGift(id) → _buyVipGiftCount[id]
            //       - getVIPRewardList()       → _haveGotVipRewrd
            //       - getFirstRecharge()        → _fristRecharge
            //       - ChannelWeeklyRewardTag    → _gotChannelWeeklyRewardTag
            var response = {
                _info: {
                    // ══ setGiftInfo (L79584) reads these 5 fields ══
                    _id: giftInfo._id,
                    _isBuyFund: !!giftInfo._isBuyFund,
                    _levelGiftCount: giftInfo._levelGiftCount,
                    _levelBuyGift: giftInfo._levelBuyGift,
                    _fundGiftCount: giftInfo._fundGiftCount,

                    // ══ saveUserData (L77647-77651) reads these fields ══
                    // ══ Also consumed by WelfarePanel tab UIs ══

                    // setFirstRecharge L79585 → reads _canGetReward, _haveGotReward
                    _fristRecharge: {
                        _canGetReward: !!giftInfo._fristRecharge._canGetReward,
                        _haveGotReward: !!giftInfo._fristRecharge._haveGotReward
                    },

                    // setVIPRewrd L79585 → iterates Object<string,boolean>
                    // Used by getVIPRewardList() → _haveGotVipRewrd map
                    _haveGotVipRewrd: giftInfo._haveGotVipRewrd,

                    // setVIPPrerogativeGift L79586 → iterates Object<string,number>
                    // Used by getVIPPrerogativeGift(id) in VIPPrerogativeGiftListItem L156174
                    _buyVipGiftCount: giftInfo._buyVipGiftCount,

                    // setOnlineGift L79585 → reads _curId, _nextTime
                    // Used by Home.setOnLineGift() L167389 for timer countdown
                    // _curId: current claimed stage (0=none yet)
                    // _nextTime: server timestamp (ms) when next gift available
                    _onlineGift: {
                        _curId: giftInfo._onlineGift._curId || 0,
                        _nextTime: giftInfo._onlineGift._nextTime || 0
                    },

                    // setGotChannelWeeklyRewardTag L79585 → reads _gotChannelWeeklyRewardTag
                    // Used by checkChannelRewardTag() for weekly reward red dot
                    _gotChannelWeeklyRewardTag: giftInfo._gotChannelWeeklyRewardTag,

                    // saveUserData L77649 → direct assign to UserInfoSingleton
                    _gotBSAddToHomeReward: !!giftInfo._gotBSAddToHomeReward,

                    // saveUserData L77650 → direct assign + || 0 fallback
                    _clickHonghuUrlTime: giftInfo._clickHonghuUrlTime || 0
                }
            };

            log.info('REWARDINFO', 'success userId=' + userId +
                ' isBuyFund=' + giftInfo._isBuyFund +
                ' levelGiftCount=' + JSON.stringify(giftInfo._levelGiftCount) +
                ' fundGiftCount=' + JSON.stringify(giftInfo._fundGiftCount) +
                ' levelBuyGift=' + Object.keys(giftInfo._levelBuyGift).length + ' items' +
                ' onlineGift.curId=' + giftInfo._onlineGift._curId +
                ' onlineGift.nextTime=' + giftInfo._onlineGift._nextTime +
                ' fristRecharge.canGet=' + giftInfo._fristRecharge._canGetReward +
                ' vipRewrd=' + Object.keys(giftInfo._haveGotVipRewrd).length + ' items');

            callback(response);

        } catch (err) {
            log.error('REWARDINFO', 'UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ONLINE GIFT TIMER REPAIR
    // ═══════════════════════════════════════════════════════════
    //
    //  Logic sama dengan repairOnlineGiftTimer di enterGame.js.
    //  Di-call saat getRewardInfo untuk memperbaiki _nextTime yang corrupted.
    //  Fix disimpan di server (db._set) dan akan efektif setelah re-login
    //  karena client setGiftInfo() tidak membaca _onlineGift dari response ini.
    //

    function repairOnlineGiftNextTime(giftInfo, storageKey, savedData) {
        if (!giftInfo._onlineGift || typeof giftInfo._onlineGift !== 'object') return;

        var ol = giftInfo._onlineGift;
        var curId = Number(ol._curId) || 0;
        var nextTime = Number(ol._nextTime) || 0;
        var nowMs = Date.now();

        // Valid range: 0 (claimable/habis) atau nowMs s/d nowMs + 48 jam
        var MAX_FUTURE_MS = 48 * 3600 * 1000;
        var needRepair = false;
        var repairReason = '';

        if (nextTime === 0) {
            var bonusTable = loadJsonSync('onlineBonus');
            if (bonusTable) {
                if (curId === 0) {
                    needRepair = true;
                    repairReason = 'curId=0, _nextTime=0 (uninitialized)';
                } else {
                    var curTier = bonusTable[String(curId)];
                    if (curTier && curTier.nextID) {
                        needRepair = true;
                        repairReason = 'curId=' + curId + ' has nextID but _nextTime=0';
                    }
                }
            } else if (curId === 0) {
                needRepair = true;
                repairReason = 'config not found, curId=0, _nextTime=0';
            }
        } else if (isNaN(nextTime) || nextTime < 0) {
            needRepair = true;
            repairReason = 'invalid value: ' + ol._nextTime;
        } else if (nextTime - nowMs > MAX_FUTURE_MS) {
            needRepair = true;
            repairReason = 'too far in future: ' + Math.ceil((nextTime - nowMs) / 3600000) + 'h';
        }

        if (!needRepair) return;

        log.info('REWARDINFO', 'onlineGift._nextTime CORRUPTED — ' + repairReason +
            ' (old=' + ol._nextTime + ')');

        var bonusTable = loadJsonSync('onlineBonus');
        if (!bonusTable) {
            ol._nextTime = nowMs + (300 * 1000);
            log.info('REWARDINFO', 'onlineGift repaired (no config): +300s → ' + ol._nextTime);
            db._set(storageKey, savedData);
            return;
        }

        if (curId === 0) {
            var tier1 = bonusTable['1'];
            if (tier1) {
                var tierTime = Number(tier1.time) || 300;
                ol._nextTime = nowMs + (tierTime * 1000);
                log.info('REWARDINFO', 'onlineGift repaired: curId=0 → +' + tierTime + 's = ' + ol._nextTime);
            }
        } else {
            var curTier = bonusTable[String(curId)];
            if (curTier && curTier.nextID) {
                var nextTier = bonusTable[String(curTier.nextID)];
                if (nextTier) {
                    var nextTimeSec = Number(nextTier.time) || 300;
                    ol._nextTime = nowMs + (nextTimeSec * 1000);
                    log.info('REWARDINFO', 'onlineGift repaired: curId=' + curId + ' → +' +
                        nextTimeSec + 's = ' + ol._nextTime);
                }
            } else {
                ol._nextTime = 0;
                log.info('REWARDINFO', 'onlineGift: curId=' + curId + ' is last tier, keeping 0');
            }
        }

        db._set(storageKey, savedData);
    }

    // ═══════════════════════════════════════════════════════════
    //  DEFAULTS — matches GiftModel constructor (L88076-88082)
    //            + enterGame.js initial structure (L1013-1024)
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJsonSync(jsonName) {
        if (_resourceCache[jsonName]) return _resourceCache[jsonName];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + jsonName + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[jsonName] = data;
                return data;
            }
            log.warn('REWARDINFO', 'Failed to load: ' + jsonName + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.warn('REWARDINFO', 'Failed to load: ' + jsonName + '.json — ' + e.message);
        }
        return null;
    }

    function buildDefaultGiftInfo(userId) {
        // Full defaults matching GiftModel constructor (L88076-88082)
        // + saveUserData fields (L77647-77651)
        return {
            // setGiftInfo fields (L79584)
            _id: userId || '',
            _isBuyFund: false,
            _levelGiftCount: {},
            _levelBuyGift: {},
            _fundGiftCount: {},

            // saveUserData fields (L77647-77651)
            _fristRecharge: {
                _canGetReward: false,
                _haveGotReward: false
            },
            _haveGotVipRewrd: {},
            _buyVipGiftCount: {},
            _onlineGift: {
                _curId: 0,
                _nextTime: 0
            },
            _gotChannelWeeklyRewardTag: '',
            _gotBSAddToHomeReward: false,
            _clickHonghuUrlTime: 0
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('gift', 'getRewardInfo', handleGetRewardInfo);

    window.MainServer = MainServer;
})();
