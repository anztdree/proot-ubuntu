/**
 * handlers/gift/getOnlineGift.js — Online Time Bonus Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: gift/getOnlineGift
 * ============================================================
 *
 * Client call (main.min.js ~L233773):
 *   ts.processHandler({
 *     type: 'gift',
 *     action: 'getOnlineGift',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     version: '1.0'
 *   }, callback(response))
 *
 * Triggered when player taps the online gift icon on Home screen.
 * Client checks timer FIRST — only sends request when nextTime <= serverTime.
 *
 * Response callback (main.min.js):
 *   1. UIWindowManager.openCongratulationObtain(t)
 *      → Shows reward popup using t._changeInfo._items
 *   2. WelfareInfoManager.getInstance().setOnlineGift(t._onlineGift)
 *      → Updates _curId and _nextTime
 *   3. e.setOnLineGift()
 *      → Re-renders UI, restarts countdown timer
 *
 * ============================================================
 * STATE (savedData.giftInfo._onlineGift)
 * ============================================================
 *   _curId: 0           → tier terakhir yang di-claim (0 = belum claim)
 *   _nextTime: <ms>     → timestamp kapan tier berikutnya bisa di-claim
 *
 * ============================================================
 * CONFIG: onlineBonus.json (linked list)
 * ============================================================
 *   "1": { id:1, time:300,   awardID:122,  num:3,    nextID:2 }
 *   "2": { id:2, time:600,   awardID:541,  num:1,    nextID:3 }
 *   "3": { id:3, time:1800,  awardID:1310, num:1,    nextID:4 }
 *   "4": { id:4, time:3600,  awardID:123,  num:1,    nextID:5 }
 *   "5": { id:5, time:7200,  awardID:101,  num:100,  nextID:6 }
 *   "6": { id:6, time:18000, awardID:4201, num:1,    nextID:7 }
 *   "7": { id:7, time:43200, awardID:132,  num:3000 }       ← FINAL (no nextID)
 *
 *   time = cooldown dalam DETIK dari claim SEBELUMNYA ke claim ini.
 *   _nextTime = now + onlineBonus[NEXT_tier].time * 1000
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 * {
 *   _changeInfo: {
 *     _items: {
 *       "122": { _id: 122, _num: 6 }        ← ABSOLUTE balance (SET)
 *     }
 *   },
 *   _onlineGift: {
 *     _curId: 1,                                ← tier yang baru di-claim
 *     _nextTime: 1704889200000                  ← ms untuk tier berikutnya, 0 kalau habis
 *   }
 * }
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
    //  RESOURCE CACHE & CONFIG LOADER
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJsonSync(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
            log.warn('ONLINEGIFT', 'Failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.warn('ONLINEGIFT', 'Failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getOnlineBonus() {
        return loadJsonSync('onlineBonus');
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
    //  HANDLER: gift/getOnlineGift
    // ═══════════════════════════════════════════════════════════

    function handleGetOnlineGift(request, callback) {
        var userId = request.userId;

        log.info('ONLINEGIFT', 'gift/getOnlineGift processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            // ── 1. Validate ──
            if (!userId) {
                log.warn('ONLINEGIFT', 'Missing userId');
                callback({}, 1);
                return;
            }

            // ── 2. Load savedData ──
            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.warn('ONLINEGIFT', 'User data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // ── 3. Read current online gift state ──
            if (!savedData.giftInfo) savedData.giftInfo = {};
            if (!savedData.giftInfo._onlineGift) {
                savedData.giftInfo._onlineGift = { _curId: 0, _nextTime: 0 };
            }

            var onlineGift = savedData.giftInfo._onlineGift;
            var curId = Number(onlineGift._curId) || 0;
            var nextTime = Number(onlineGift._nextTime) || 0;
            var nowMs = Date.now();

            log.details('state', [
                ['curId', String(curId)],
                ['nextTime', String(nextTime)],
                ['now', String(nowMs)]
            ]);

            // ── 4. Validate time — must be ready ──
            //    Sanity: jika _nextTime > 48 jam di masa depan, anggap corrupted
            //    dan izinkan claim (repair dilakukan di enterGame saat login berikutnya).
            var MAX_FUTURE_MS = 48 * 3600 * 1000;
            if (nextTime > 0 && nowMs < nextTime && (nextTime - nowMs) <= MAX_FUTURE_MS) {
                log.warn('ONLINEGIFT', 'Not ready yet — ' + Math.ceil((nextTime - nowMs) / 1000) + 's remaining');
                callback({}, 1);
                return;
            }
            if (nextTime > 0 && (nextTime - nowMs) > MAX_FUTURE_MS) {
                log.warn('ONLINEGIFT', '_nextTime corrupted (>' + Math.ceil((nextTime - nowMs) / 3600000) +
                    'h in future), allowing claim — curId=' + curId);
            }

            // ── 5. Load config ──
            var bonusTable = getOnlineBonus();
            if (!bonusTable) {
                log.error('ONLINEGIFT', 'onlineBonus.json not found');
                callback({}, 1);
                return;
            }

            // ── 6. Determine which tier to claim ──
            //    curId == 0 → claim tier 1 (first claim)
            //    curId != 0 → claim onlineBonus[curId].nextID (linked list)
            var claimTierId;
            if (curId === 0) {
                claimTierId = 1;
            } else {
                var curTier = bonusTable[String(curId)];
                if (!curTier) {
                    log.warn('ONLINEGIFT', 'Current tier ' + curId + ' not found in config');
                    callback({}, 1);
                    return;
                }
                claimTierId = curTier.nextID;
            }

            // ── 7. Validate claim tier exists ──
            if (!claimTierId) {
                log.warn('ONLINEGIFT', 'All tiers already claimed (curId=' + curId + ', no nextID)');
                callback({}, 1);
                return;
            }

            var claimTier = bonusTable[String(claimTierId)];
            if (!claimTier) {
                log.error('ONLINEGIFT', 'Claim tier ' + claimTierId + ' not found in config');
                callback({}, 1);
                return;
            }

            var awardID = Number(claimTier.awardID) || 0;
            var awardNum = Number(claimTier.num) || 0;

            log.details('claim', [
                ['tier', String(claimTierId)],
                ['awardID', String(awardID)],
                ['awardNum', String(awardNum)]
            ]);

            // ── 8. Award items to player ──
            var oldBal = getBal(savedData, awardID);
            var newBal = oldBal + awardNum;
            setBal(savedData, awardID, newBal);

            // ── 9. Update online gift state ──
            onlineGift._curId = claimTierId;

            // Calculate next tier's availability
            var nextTierId = claimTier.nextID;
            if (nextTierId) {
                var nextTier = bonusTable[String(nextTierId)];
                if (nextTier) {
                    onlineGift._nextTime = nowMs + ((Number(nextTier.time) || 0) * 1000);
                } else {
                    onlineGift._nextTime = 0;
                }
            } else {
                // Last tier claimed — no more rewards
                onlineGift._nextTime = 0;
            }

            // ── 10. Persist ──
            db._set(storageKey, savedData);

            // ── 11. Build response ──
            var changeItems = {};
            changeItems[String(awardID)] = {
                _id: awardID,
                _num: newBal
            };

            var response = {
                _changeInfo: { _items: changeItems },
                _onlineGift: {
                    _curId: onlineGift._curId,
                    _nextTime: onlineGift._nextTime
                }
            };

            log.info('ONLINEGIFT', 'success userId=' + userId +
                ' tier=' + claimTierId +
                ' award=' + awardID + 'x' + awardNum +
                ' bal=' + oldBal + '→' + newBal +
                ' nextTime=' + onlineGift._nextTime);

            callback(response);

        } catch (err) {
            log.error('ONLINEGIFT', 'UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('gift', 'getOnlineGift', handleGetOnlineGift);

    window.MainServer = MainServer;
})();
