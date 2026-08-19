/**
 * handlers/friend/getFriends.js — Get Friends List Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: friend/getFriends
 * ============================================================
 *
 * Client call (main.min.js ~L84170):
 *   ts.processHandler({
 *     type: 'friend',
 *     action: 'getFriends',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     version: '1.0'
 *   }, callback(response))
 *
 * Dipanggil saat:
 *   - Tab 0 (Friend List): buka halaman Friend
 *   - Tab 3 (Blacklist): buka halaman Blacklist
 *
 * Client callback:
 *   - saveFriendData(response)  → baca _friends, _receiveHearts, _giveHearts, _getHearts
 *   - saveBlackListData(response) → baca _blackList
 *
 * Response fields:
 *   _friends: { [userId]: { _nickName, _headImage, _headEffect, _headBox,
 *               _oriServerId, _serverId, _level, _vip, _online,
 *               _offlineTime?, _guildName? } }
 *   _blackList: { [userId]: { _nickName, _headImage, ... } }
 *   _receiveHearts: []
 *   _giveHearts: []
 *   _getHearts: []
 *
 * Data source: db key 'friend:{userId}'
 *   → { friends:[], blacklist:[], applyList:[], messages:{}, inviteMessages:[] }
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
            log.error('GETFRIENDS', 'loadJson error: ' + e.message);
        }
        return null;
    }

    var ITEM_IDS = {
        PLAYERLEVELID: 104,
        PLAYERVIPLEVELID: 106
    };

    // Bot IDs (match recommendFriend.js & applyFriend.js)
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

    var BOT_PROFILES = {
        'bot_warrior_01': { _nickName: 'ShadowKnight', _headImage: 'hero_icon_1001', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 10, _vip: 0, _online: true },
        'bot_mage_02':    { _nickName: 'FlameWizard',  _headImage: 'hero_icon_1003', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 15, _vip: 0, _online: true },
        'bot_archer_03':  { _nickName: 'WindRanger',   _headImage: 'hero_icon_1008', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 20, _vip: 0, _online: true },
        'bot_tank_04':    { _nickName: 'IronGuard',    _headImage: 'hero_icon_1009', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 25, _vip: 0, _online: true },
        'bot_warrior_05': { _nickName: 'Warrior_5',    _headImage: 'hero_icon_1001', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_mage_06':    { _nickName: 'Mage_6',       _headImage: 'hero_icon_1003', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_archer_07':  { _nickName: 'Archer_7',     _headImage: 'hero_icon_1008', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_tank_08':    { _nickName: 'Tank_8',       _headImage: 'hero_icon_1009', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_assassin_09': { _nickName: 'Assassin_9',  _headImage: 'hero_icon_1102', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_support_10': { _nickName: 'Support_10',   _headImage: 'hero_icon_1103', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_berserker_11': { _nickName: 'Berserker_11', _headImage: 'hero_icon_1104', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_paladin_12': { _nickName: 'Paladin_12',   _headImage: 'hero_icon_1105', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_druid_13':   { _nickName: 'Druid_13',     _headImage: 'hero_icon_1106', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_necromancer_14': { _nickName: 'Necromancer_14', _headImage: 'hero_icon_1107', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_monk_15':    { _nickName: 'Monk_15',      _headImage: 'hero_icon_1201', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_bard_16':    { _nickName: 'Bard_16',      _headImage: 'hero_icon_1202', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_summoner_17': { _nickName: 'Summoner_17',  _headImage: 'hero_icon_1203', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_gunner_18':  { _nickName: 'Gunner_18',    _headImage: 'hero_icon_1204', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_lancer_19':  { _nickName: 'Lancer_19',    _headImage: 'hero_icon_1205', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_samurai_20': { _nickName: 'Samurai_20',   _headImage: 'hero_icon_1206', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_ninja_21':   { _nickName: 'Ninja_21',     _headImage: 'hero_icon_1207', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_runemaster_22': { _nickName: 'Runemaster_22', _headImage: 'hero_icon_1209', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_spellblade_23': { _nickName: 'Spellblade_23', _headImage: 'hero_icon_1210', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_warden_24':  { _nickName: 'Warden_24',    _headImage: 'hero_icon_1214', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_voidwalker_25': { _nickName: 'Voidwalker_25', _headImage: 'hero_icon_1215', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_flamewarden_26': { _nickName: 'Flamewarden_26', _headImage: 'hero_icon_1216', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_frostmage_27': { _nickName: 'Frostmage_27', _headImage: 'hero_icon_1217', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_stormcaller_28': { _nickName: 'Stormcaller_28', _headImage: 'hero_icon_1301', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_shadowblade_29': { _nickName: 'Shadowblade_29', _headImage: 'hero_icon_1302', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true },
        'bot_lightbringer_30': { _nickName: 'Lightbringer_30', _headImage: 'hero_icon_1305', _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1, _level: 45, _vip: 0, _online: true }
    };

    function isBot(userId) {
        return BOT_IDS.indexOf(String(userId)) !== -1;
    }

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
     * Get user profile from saved user data.
     * Konsisten dengan recommendFriend.js: baca level/vip dari totalProps._items
     */
    function getUserProfile(userId) {
        // Bot profile
        if (isBot(userId)) {
            return BOT_PROFILES[userId] || {
                _nickName: 'Bot', _headImage: 'hero_icon_1205', _headEffect: 0, _headBox: 0,
                _oriServerId: 1, _serverId: 1, _level: 1, _vip: 0, _online: true
            };
        }

        var storageKey = 'user:' + userId;
        var userData = db._get(storageKey);

        var level = 1;
        var vip = 0;
        if (userData && userData.totalProps && userData.totalProps._items) {
            var items = userData.totalProps._items;
            for (var i = 0; i < items.length; i++) {
                if (Number(items[i]._id) === ITEM_IDS.PLAYERLEVELID) level = Number(items[i]._num) || 1;
                if (Number(items[i]._id) === ITEM_IDS.PLAYERVIPLEVELID) vip = Number(items[i]._num) || 0;
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

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: friend/getFriends
    // ════════════════════════════════════════════════════════════════

    function handleGetFriends(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'friend/getFriends processing');
        log.details('request', [
            ['userId', userId || '-']
        ]);

        if (!userId) {
            log.error('HANDLER', 'Missing userId in getFriends');
            callback({ _error: 'missing_userId' });
            return;
        }

        var data = getFriendData(userId);

        // Build _friends object — { [friendId]: profile }
        var friends = {};
        for (var i = 0; i < data.friends.length; i++) {
            var friendId = data.friends[i];
            friends[friendId] = getUserProfile(friendId);
        }

        // Build _blackList object — { [blacklistId]: profile }
        var blackList = {};
        for (var j = 0; j < data.blacklist.length; j++) {
            var blId = data.blacklist[j];
            blackList[blId] = getUserProfile(blId);
        }

        log.info('HANDLER', 'getFriends → ' + Object.keys(friends).length + ' friends, ' +
            Object.keys(blackList).length + ' blacklist');

        callback({
            _friends: friends,
            _blackList: blackList,
            _receiveHearts: [],
            _giveHearts: [],
            _getHearts: []
        });
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════

    MainServer.registerHandler('friend', 'getFriends', handleGetFriends);

    window.MainServer = MainServer;
})();
