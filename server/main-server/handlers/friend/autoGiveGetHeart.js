/**
 * handlers/friend/autoGiveGetHeart.js — Auto Give & Get All Hearts Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══ CLIENT EVIDENCE (main.min.js) ═══
 *
 *   CALL SITE — FriendHeat.receiveAndSendBtnTap (L115638-115651):
 *     Request: { type:"friend", action:"autoGiveGetHeart", userId, version }
 *     Callback chain:
 *       1. OneStepCallBack(t)       — L84082-84090 — update heart arrays
 *       2. openCongratulationObtain(t) — L56636-56651 — show reward popup
 *       3. e.doRefresh()              — L115626-115628 — re-render from memory
 *
 *   Pre-check (L84098-84116): checkOneStepState()
 *     canReceive = getHearts.length < friendMax && receiveHearts.length > 0
 *     canGive    = giveHearts.length < friendMax && myFriend.length > giveHearts.length
 *     → only calls server if canReceive || canGive
 *
 *   REWARD (confirmed by user + client evidence):
 *     GIVE 1 friend = +1 item 121 (FRIENDHEART)
 *     GET  1 friend = +1 item 121 (FRIENDHEART)
 *     Total = (friendsToGive + friendsToGet) × 1
 *
 *   Daily reset: generateRetrieveDay (L52766-52768), boundary 6:00 AM CST
 *   FRIENDHEART = 121 (L78708), friendMax = 30
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var FRIENDHEART_ID = 121;
    var FRIEND_MAX = 30;

    // ═══════════════════════════════════════════════════════════
    //  generateRetrieveDay — from enterGame.js L411-425
    //  Replicates client L52766-52768: ToolCommon.generateRetrieveDay()
    //  Hours before 6:00 AM CST belong to the PREVIOUS day.
    //  Output format: "YYYY-M-D" (NO zero-pad — must match client exactly)
    // ═══════════════════════════════════════════════════════════

    function generateRetrieveDay(date) {
        var utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
        var cstMs = utcMs + (8 * 3600000);
        var cstHour = Math.floor((cstMs % 86400000) / 3600000);
        if (cstHour < 6) {
            cstMs -= 86400000;
        }
        var adjusted = new Date(cstMs);
        return adjusted.getUTCFullYear() + '-' + (adjusted.getUTCMonth() + 1) + '-' + adjusted.getUTCDate();
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Build indexed object from state object for client response.
     * state = { "bot_warrior_01": true, "bot_mage_02": true, ... }
     * result = { "0": "bot_warrior_01", "1": "bot_mage_02", ... }
     *
     * Client L84087: for(var n in e._giveHearts) t.giveHearts.push(e._giveHearts[n])
     * → n = "0", VALUE = friendId → push friendId to array
     */
    function buildIndexedObject(stateObj) {
        var result = {};
        var idx = 0;
        for (var key in stateObj) {
            if (stateObj.hasOwnProperty(key) && stateObj[key]) {
                result[String(idx)] = key;
                idx++;
            }
        }
        return result;
    }

    /**
     * Get item balance from totalProps._items array.
     * totalProps._items = [ { _id, _num }, ... ] — absolute values.
     */
    function getItemBalance(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    /**
     * Set item balance in totalProps._items array (absolute value).
     */
    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        var idStr = String(itemId);
        for (var i = 0; i < items.length; i++) {
            if (String(items[i]._id) === idStr) {
                items[i]._num = newBalance;
                return;
            }
        }
        // Not found — push new entry
        items.push({ _id: idStr, _num: newBalance });
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER: friend/autoGiveGetHeart
    // ═══════════════════════════════════════════════════════════

    function handleAutoGiveGetHeart(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'friend/autoGiveGetHeart processing');
        log.details('request', [
            ['userId', userId || '-']
        ]);

        if (!userId) {
            log.error('HANDLER', 'Missing userId in autoGiveGetHeart');
            callback({ _error: 'missing_userId' });
            return;
        }

        // ─── Load user data ───
        var userKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(userKey);
        if (!savedData) {
            log.error('HANDLER', 'User not found: ' + userId);
            callback({ _error: 'user_not_found' });
            return;
        }

        // ─── Load friend list ───
        var friendKey = 'ms_friend_' + userId;
        var friendData = db._get(friendKey);
        if (!friendData || !friendData.friends || friendData.friends.length === 0) {
            log.info('HANDLER', 'No friends — returning empty response');
            callback({
                _receiveHearts: {},
                _giveHearts: {},
                _getHearts: {},
                _receiveHeartCount: 0,
                _giveHeartCount: 0
            });
            return;
        }

        var allFriends = friendData.friends;
        var friendCount = allFriends.length;

        // ─── Load / init _friendHeart state ───
        var state = savedData._friendHeart;
        var currentDate = generateRetrieveDay(new Date());

        if (!state) {
            // First time — fresh state, today's date
            state = {
                giveHearts: {},
                getHearts: {},
                date: currentDate
            };
            log.info('HANDLER', 'Fresh _friendHeart state initialized');
        } else if (state.date !== currentDate) {
            // Daily reset — day changed (crossed 6:00 AM CST boundary)
            log.info('HANDLER', 'Heart daily reset — ' + (state.date || '(none)') + ' -> ' + currentDate);
            state.giveHearts = {};
            state.getHearts = {};
            state.date = currentDate;
        }

        // ─── Calculate: which friends need give / get ───
        var maxOps = Math.min(friendCount, FRIEND_MAX);
        var currentGiveCount = 0;
        var currentGetCount = 0;
        for (var k in state.giveHearts) { if (state.giveHearts.hasOwnProperty(k)) currentGiveCount++; }
        for (var k2 in state.getHearts) { if (state.getHearts.hasOwnProperty(k2)) currentGetCount++; }

        var giveRemaining = maxOps - currentGiveCount;
        var getRemaining = maxOps - currentGetCount;

        var friendsToGive = [];
        var friendsToGet = [];

        for (var i = 0; i < allFriends.length; i++) {
            var friendId = allFriends[i];

            // Give: friend not yet given today
            if (giveRemaining > 0 && !state.giveHearts[friendId]) {
                friendsToGive.push(friendId);
                state.giveHearts[friendId] = true;
                giveRemaining--;
            }

            // Get: friend's heart not yet claimed today
            // In private server: all bots have "sent" hearts → all claimable
            if (getRemaining > 0 && !state.getHearts[friendId]) {
                friendsToGet.push(friendId);
                state.getHearts[friendId] = true;
                getRemaining--;
            }
        }

        var totalHeartsEarned = friendsToGive.length + friendsToGet.length;

        log.info('HANDLER', 'Heart result — give:' + friendsToGive.length +
            ' get:' + friendsToGet.length +
            ' total:' + totalHeartsEarned +
            ' friends:' + friendCount +
            ' maxOps:' + maxOps);

        // ─── Update item 121 balance ───
        if (totalHeartsEarned > 0) {
            var currentBalance = getItemBalance(savedData, FRIENDHEART_ID);
            var newBalance = currentBalance + totalHeartsEarned;
            setItemBalance(savedData, FRIENDHEART_ID, newBalance);

            log.info('HANDLER', 'FRIENDHEART ' + FRIENDHEART_ID +
                ': ' + currentBalance + ' -> ' + newBalance +
                ' (+' + totalHeartsEarned + ')');
        }

        // ─── Save state to DB ───
        savedData._friendHeart = state;
        db._set(userKey, savedData);

        // ─── Build response ───
        var response = {
            _receiveHearts: {},
            _giveHearts: buildIndexedObject(state.giveHearts),
            _getHearts: buildIndexedObject(state.getHearts),
            _receiveHeartCount: 0,
            _giveHeartCount: currentGiveCount + friendsToGive.length
        };

        // Only include _changeInfo if hearts were earned.
        // Without it, openCongratulationObtain skips popup — correct for no-op.
        if (totalHeartsEarned > 0) {
            var newBalance2 = getItemBalance(savedData, FRIENDHEART_ID);
            response._changeInfo = {
                _items: {}
            };
            response._changeInfo._items[String(FRIENDHEART_ID)] = {
                _id: FRIENDHEART_ID,
                _num: newBalance2
            };
        }

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('friend', 'autoGiveGetHeart', handleAutoGiveGetHeart);

    window.MainServer = MainServer;
})();