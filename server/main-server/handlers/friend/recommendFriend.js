/**
 * handlers/friend/recommendFriend.js — Recommend Friends Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: friend/recommendFriend
 * ============================================================
 *
 * Client call (main.min.js ~L84184):
 *   ts.processHandler({
 *     type: 'friend',
 *     action: 'recommendFriend',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     oldUids: [list of already-seen userIds to exclude],
 *     version: '1.0'
 *   }, callback(response))
 *
 * Client callback:
 *   saveRandomFriendData(response) → baca _recommendFriends
 *
 * Response fields:
 *   _recommendFriends: { [userId]: { _nickName, _headImage, _headEffect,
 *                    _headBox, _oriServerId, _serverId, _level, _vip,
 *                    _online, _offlineTime?, _guildName? } }
 *
 * ─────────────────────────────────────────────────────────────
 * STRATEGY:
 * Karena ini single-server (semua data di localStorage),
 * kita generate "recommended" friends dari:
 *   1. Semua user yang terdaftar di DB (user:{userId})
 *   2. Bukan diri sendiri
 *   3. Bukan sudah di friend list
 *   4. Bukan di oldUids (sudah pernah direkomendasikan)
 *   5. Ambil random 4-5 orang
 * ─────────────────────────────────────────────────────────────
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════════
    // HELPER
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get friend data for a user.
     */
    function getFriendData(userId) {
        var key = 'friend:' + userId;
        var data = db._get(key);

        if (!data) {
            data = {
                friends: [],
                blacklist: [],
                applyList: [],
                messages: {},
                inviteMessages: []
            };
            db._set(key, data);
        }

        return data;
    }

    /**
     * Get user profile from saved user data.
     */
    function getUserProfile(userId) {
        var storageKey = 'user:' + userId;
        var userData = db._get(storageKey);

        var level = 1;
        var vip = 0;
        if (userData && userData.totalProps && userData.totalProps._items) {
            var items = userData.totalProps._items;
            for (var i = 0; i < items.length; i++) {
                if (Number(items[i]._id) === 104) { level = Number(items[i]._num) || 1; }
                if (Number(items[i]._id) === 106) { vip = Number(items[i]._num) || 0; }
            }
        }

        if (userData && userData.user) {
            return {
                _nickName: userData.user._nickName || 'Player',
                _headImage: userData.user._headImage || 'hero_icon_1205',
                _headEffect: (userData.user._headEffect || 0),
                _headBox: (userData.user._headBox || 0),
                _oriServerId: (userData.user._oriServerId || 1),
                _serverId: 1,
                _level: level,
                _vip: vip,
                _online: true
            };
        }

        return {
            _nickName: 'Player',
            _headImage: 'hero_icon_1205',
            _headEffect: 0,
            _headBox: 0,
            _oriServerId: 1,
            _serverId: 1,
            _level: level,
            _vip: vip,
            _online: true
        };
    }

    /**
     * Collect all known userIds from DB.
     * Scans for keys matching 'user:{userId}'
     */
    function getAllKnownUserIds() {
        var userIds = [];
        // Use getAllKeys if available, otherwise return empty
        // (single-server environment — limited users)
        if (db._getAllKeys) {
            var keys = db._getAllKeys();
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                // Match pattern: user:{userId}
                if (key.indexOf('user:') === 0) {
                    var uid = key.substring('user:'.length);
                    userIds.push(uid);
                }
            }
        }
        return userIds;
    }

    /**
     * Simple Fisher-Yates partial shuffle — take N random items from array.
     */
    function getRandomItems(arr, count, excludeSet) {
        var available = [];
        for (var i = 0; i < arr.length; i++) {
            if (!excludeSet[arr[i]]) {
                available.push(arr[i]);
            }
        }

        // Shuffle available
        for (var j = available.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var temp = available[j];
            available[j] = available[k];
            available[k] = temp;
        }

        return available.slice(0, count);
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN HANDLER: friend/recommendFriend
    // ═══════════════════════════════════════════════════════════════

    function handleRecommendFriend(request, callback) {
        var userId = request.userId;
        var oldUids = request.oldUids || [];

        log.info('HANDLER', 'friend/recommendFriend processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['oldUids count', oldUids.length]
        ]);

        if (!userId) {
            log.error('HANDLER', 'Missing userId in recommendFriend');
            callback({ _error: 'missing_userId' });
            return;
        }

        // Build exclude set: self + friends + oldUids
        var friendData = getFriendData(userId);
        var excludeSet = {};
        excludeSet[userId] = true;

        for (var i = 0; i < friendData.friends.length; i++) {
            excludeSet[friendData.friends[i]] = true;
        }
        for (var j = 0; j < oldUids.length; j++) {
            excludeSet[oldUids[j]] = true;
        }

        // Get all known users
        var allUsers = getAllKnownUserIds();
        var recommendedIds = getRandomItems(allUsers, 4, excludeSet);

        // ── BOT FALLBACK: kalau user asli kurang, isi dengan bot ──
        var bots = [
            { uid: 'bot_warrior_01', _nickName: 'ShadowKnight', _headImage: 'hero_icon_1001', _level: 10 },
            { uid: 'bot_mage_02', _nickName: 'FlameWizard', _headImage: 'hero_icon_1003', _level: 15 },
            { uid: 'bot_archer_03', _nickName: 'WindRanger', _headImage: 'hero_icon_1008', _level: 20 },
            { uid: 'bot_tank_04', _nickName: 'IronGuard', _headImage: 'hero_icon_1009', _level: 25 },
            { uid: 'bot_warrior_05', _nickName: 'Warrior_5', _headImage: 'hero_icon_1001', _level: 45 },
            { uid: 'bot_mage_06', _nickName: 'Mage_6', _headImage: 'hero_icon_1003', _level: 45 },
            { uid: 'bot_archer_07', _nickName: 'Archer_7', _headImage: 'hero_icon_1008', _level: 45 },
            { uid: 'bot_tank_08', _nickName: 'Tank_8', _headImage: 'hero_icon_1009', _level: 45 },
            { uid: 'bot_assassin_09', _nickName: 'Assassin_9', _headImage: 'hero_icon_1102', _level: 45 },
            { uid: 'bot_support_10', _nickName: 'Support_10', _headImage: 'hero_icon_1103', _level: 45 },
            { uid: 'bot_berserker_11', _nickName: 'Berserker_11', _headImage: 'hero_icon_1104', _level: 45 },
            { uid: 'bot_paladin_12', _nickName: 'Paladin_12', _headImage: 'hero_icon_1105', _level: 45 },
            { uid: 'bot_druid_13', _nickName: 'Druid_13', _headImage: 'hero_icon_1106', _level: 45 },
            { uid: 'bot_necromancer_14', _nickName: 'Necromancer_14', _headImage: 'hero_icon_1107', _level: 45 },
            { uid: 'bot_monk_15', _nickName: 'Monk_15', _headImage: 'hero_icon_1201', _level: 45 },
            { uid: 'bot_bard_16', _nickName: 'Bard_16', _headImage: 'hero_icon_1202', _level: 45 },
            { uid: 'bot_summoner_17', _nickName: 'Summoner_17', _headImage: 'hero_icon_1203', _level: 45 },
            { uid: 'bot_gunner_18', _nickName: 'Gunner_18', _headImage: 'hero_icon_1204', _level: 45 },
            { uid: 'bot_lancer_19', _nickName: 'Lancer_19', _headImage: 'hero_icon_1205', _level: 45 },
            { uid: 'bot_samurai_20', _nickName: 'Samurai_20', _headImage: 'hero_icon_1206', _level: 45 },
            { uid: 'bot_ninja_21', _nickName: 'Ninja_21', _headImage: 'hero_icon_1207', _level: 45 },
            { uid: 'bot_runemaster_22', _nickName: 'Runemaster_22', _headImage: 'hero_icon_1209', _level: 45 },
            { uid: 'bot_spellblade_23', _nickName: 'Spellblade_23', _headImage: 'hero_icon_1210', _level: 45 },
            { uid: 'bot_warden_24', _nickName: 'Warden_24', _headImage: 'hero_icon_1214', _level: 45 },
            { uid: 'bot_voidwalker_25', _nickName: 'Voidwalker_25', _headImage: 'hero_icon_1215', _level: 45 },
            { uid: 'bot_flamewarden_26', _nickName: 'Flamewarden_26', _headImage: 'hero_icon_1216', _level: 45 },
            { uid: 'bot_frostmage_27', _nickName: 'Frostmage_27', _headImage: 'hero_icon_1217', _level: 45 },
            { uid: 'bot_stormcaller_28', _nickName: 'Stormcaller_28', _headImage: 'hero_icon_1301', _level: 45 },
            { uid: 'bot_shadowblade_29', _nickName: 'Shadowblade_29', _headImage: 'hero_icon_1302', _level: 45 },
            { uid: 'bot_lightbringer_30', _nickName: 'Lightbringer_30', _headImage: 'hero_icon_1305', _level: 45 }
        ];
        var botExclude = {};
        for (var b = 0; b < recommendedIds.length; b++) { botExclude[recommendedIds[b]] = true; }
        for (var bi = 0; bi < bots.length && recommendedIds.length < 4; bi++) {
            if (!excludeSet[bots[bi].uid] && !botExclude[bots[bi].uid]) {
                recommendedIds.push(bots[bi].uid);
            }
        }

        // Build response
        var recommendFriends = {};
        for (var r = 0; r < recommendedIds.length; r++) {
            var recId = recommendedIds[r];
            // Check if this is a bot
            var isBot = false;
            for (var bc = 0; bc < bots.length; bc++) {
                if (bots[bc].uid === recId) {
                    recommendFriends[recId] = {
                        _nickName: bots[bc]._nickName,
                        _headImage: bots[bc]._headImage,
                        _headEffect: 0,
                        _headBox: 0,
                        _oriServerId: 1,
                        _serverId: 1,
                        _level: bots[bc]._level,
                        _vip: 0,
                        _online: true
                    };
                    isBot = true;
                    break;
                }
            }
            if (!isBot) {
                recommendFriends[recId] = getUserProfile(recId);
            }
        }

        log.info('HANDLER', 'recommendFriend → ' + Object.keys(recommendFriends).length + ' recommended');

        callback({
            _recommendFriends: recommendFriends
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════

    MainServer.registerHandler('friend', 'recommendFriend', handleRecommendFriend);

    window.MainServer = MainServer;
})();
