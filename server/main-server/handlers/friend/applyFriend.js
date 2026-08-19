/**
 * handlers/friend/applyFriend.js
 * Super Warrior Z — MAIN SERVER
 *
 * Client call (L84140-84148):
 *   ts.processHandler({
 *     type: "friend",
 *     action: "applyFriend",
 *     userId: myUserId,
 *     friendId: targetUserId,
 *     version: "1.0"
 *   }, callback)
 *
 * Callback: t && t() — no response fields read, just ack.
 *
 * TUGAS:
 *   1. Push applicant (userId) into target's applyList, save DB.
 *   2. Jika target adalah BOT (dari recommendFriend) → AUTO ACCEPT:
 *      - Tambah ke friends list kedua pihak (user + bot)
 *      - Hapus dari applyList
 *   3. Check main task: if taskType="friendApply" & state=1 → advance to state=2
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var _resCache = {};
    function loadJson(name) {
        if (_resCache[name]) return _resCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _resCache[name] = JSON.parse(xhr.responseText);
                return _resCache[name];
            }
        } catch (e) {
            log.error('APPLYFRIEND', 'loadJson error: ' + e.message);
        }
        return null;
    }

    // Bot IDs dari recommendFriend.js
    var BOT_IDS = [
        'bot_warrior_01', 'bot_mage_02', 'bot_archer_03', 'bot_tank_04',
        'bot_warrior_05', 'bot_mage_06', 'bot_archer_07', 'bot_tank_08',
        'bot_assassin_09', 'bot_support_10', 'bot_berserker_11', 'bot_paladin_12',
        'bot_druid_13', 'bot_necromancer_14', 'bot_monk_15', 'bot_bard_16',
        'bot_summoner_17', 'bot_gunner_18', 'bot_lancer_19', 'bot_samurai_20',
        'bot_ninja_21', 'bot_runemaster_22', 'bot_spellblade_23', 'bot_warden_24',
        'bot_voidwalker_25', 'bot_flamewarden_26', 'bot_frostmage_27', 'bot_stormcaller_28',
        'bot_shadowblade_29', 'bot_lightbringer_30'
    ];

    function isBot(userId) {
        return BOT_IDS.indexOf(String(userId)) !== -1;
    }

    function getFriendData(userId) {
        var key = 'friend:' + userId;
        var data = db._get(key);
        if (!data) {
            data = { friends: [], blacklist: [], applyList: [], messages: {}, inviteMessages: [] };
            db._set(key, data);
        }
        return data;
    }

    function handleApplyFriend(request, callback) {
        var userId = request.userId;
        var friendId = request.friendId;

        if (!userId || !friendId) {
            log.warn('HANDLER', 'applyFriend — missing userId or friendId');
            callback({}, 1);
            return;
        }

        friendId = String(friendId);
        userId = String(userId);

        // ── 1. Push applicant to target's applyList ──
        var targetKey = 'friend:' + friendId;
        var targetData = db._get(targetKey);

        if (!targetData) {
            targetData = { friends: [], blacklist: [], applyList: [], messages: {}, inviteMessages: [] };
        }

        var alreadyFriend = targetData.friends.indexOf(userId) !== -1;
        var alreadyApplied = targetData.applyList.indexOf(userId) !== -1;

        if (!alreadyFriend && !alreadyApplied) {
            targetData.applyList.push(userId);
            db._set(targetKey, targetData);
            log.info('HANDLER', 'applyFriend → userId=' + userId + ' applied to friendId=' + friendId);
        } else {
            log.info('HANDLER', 'applyFriend → already friend/applied: ' + friendId);
        }

        // ── 2. AUTO ACCEPT jika target adalah BOT ──
        if (isBot(friendId)) {
            log.info('HANDLER', 'applyFriend → AUTO ACCEPT bot ' + friendId);

            // Get bot friend data (create if not exists)
            var botFriendKey = 'friend:' + friendId;
            var botFriendData = db._get(botFriendKey);
            if (!botFriendData) {
                botFriendData = { friends: [], blacklist: [], applyList: [], messages: {}, inviteMessages: [] };
            }

            // Add user to bot's friends
            if (botFriendData.friends.indexOf(userId) === -1) {
                botFriendData.friends.push(userId);
            }
            // Remove from bot's applyList
            var applyIdx = botFriendData.applyList.indexOf(userId);
            if (applyIdx !== -1) {
                botFriendData.applyList.splice(applyIdx, 1);
            }
            db._set(botFriendKey, botFriendData);

            // Add bot to user's friends
            var userFriendData = getFriendData(userId);
            if (userFriendData.friends.indexOf(friendId) === -1) {
                userFriendData.friends.push(friendId);
            }
            // Remove from user's applyList (in case)
            var uApplyIdx = userFriendData.applyList.indexOf(friendId);
            if (uApplyIdx !== -1) {
                userFriendData.applyList.splice(uApplyIdx, 1);
            }
            db._set('friend:' + userId, userFriendData);

            log.info('HANDLER', 'applyFriend → AUTO ACCEPTED: ' + userId + ' <-> ' + friendId);
        }

        // ── 3. Check & advance main task (taskType=friendApply) ──
        try {
            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);
            var cmt = savedData && savedData.curMainTask;
            if (cmt && Array.isArray(cmt) && cmt.length > 0 && cmt[0]._state === 1) {
                var taskCfg = loadJson('task');
                var taskDef = taskCfg && taskCfg[cmt[0]._id];
                if (taskDef && taskDef.taskType === 'friendApply') {
                    cmt[0]._state = 2;
                    db._set(storageKey, savedData);
                    if (typeof MainServer.notify === 'function') {
                        MainServer.notify({
                            action: 'mainTaskChange',
                            _curMainTask: [{ _id: cmt[0]._id, _state: 2 }]
                        });
                        log.info('TASK', 'applyFriend → Task ' + cmt[0]._id + ' DOING→COMPLETE');
                    }
                }
            }
        } catch (taskErr) {
            log.warn('TASK', 'applyFriend task check error: ' + (taskErr.message || taskErr));
        }

        callback({});
    }

    MainServer.registerHandler('friend', 'applyFriend', handleApplyFriend);
    window.MainServer = MainServer;
})();
