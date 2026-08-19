/**
 * handlers/guild/getMembers.js — Get Guild Members Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ════════════════════════════════════════════════════════════════
 * VERIFIKASI TERHADAP SUMBER UTAMA
 * ════════════════════════════════════════════════════════════════
 *
 * 1. CLIENT: main.min(unminfy).js
 *    - L6152835: request → {type, action, userId, guildUUID, version}
 *    - Callback:
 *      setTeamMembers(t)   → iterasi `for(var n in e._members)` — DICT!
 *      setMyTeamHeadIcon(t._icon)
 *      setMyTeamLevel(t._level)
 *      setMyTeamExp(t._leftExp)
 *      setTeamName(t._name)
 *      setTeamDes(t._des)
 *      setTeamBulletin(t._bulletin)
 *
 *    - L3302076: setTeamMembers(e)
 *      for(var n in e._members) → _members = DICT keyed by userId
 *      Maps: _id, _title, _joinTime, _nickName, _level, _online,
 *            _offlineTime, _headImage, _headEffect, _headBox,
 *            _vip → _vipLevel, _serverId, _oriServerId
 *
 *    - L2124129: GuildMember model constructor:
 *      _id, _title, _joinTime, _headEffect, _headBox, _vipLevel, _serverId, _oriServerId
 *
 * 2. HAR DECODED: getMembers
 *    - _members = DICT {userId: memberObj, ...}
 *    - Member fields: _id, _title, _joinTime, _nickName, _headImage,
 *      _headEffect, _headBox, _level, _vip, _online, _offlineTime,
 *      _guildName, _serverId, _oriServerId
 *    - Guild info fields: _icon, _level, _leftExp, _name, _des, _bulletin
 *    - Echo: type, action, userId, guildUUID, version
 *
 * 3. MOCK: 1 guild, 1 member (the user as captain)
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var GUILD_LIST_KEY = 'guildList';
    var USER_KEY_PREFIX = 'user:';

    /**
     * Get user data from DB for a given userId
     */
    function getUserData(userId) {
        return db._get(USER_KEY_PREFIX + userId);
    }

    /**
     * Get guild info from guild list by guildId
     */
    function getGuildInfo(guildId) {
        var allGuilds = db._get(GUILD_LIST_KEY);
        if (!allGuilds) return null;
        var arr = Array.isArray(allGuilds) ? allGuilds : Object.values(allGuilds);
        for (var i = 0; i < arr.length; i++) {
            if (arr[i]._id === guildId) return arr[i];
        }
        return null;
    }

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/getMembers
    // ════════════════════════════════════════════════════════════════

    function handleGetMembers(request, callback) {
        var userId = request.userId;
        var guildUUID = request.guildUUID;

        log.info('HANDLER', 'guild/getMembers');
        log.details('request', [
            ['userId', userId || '-'],
            ['guildUUID', guildUUID || '-']
        ]);

        if (!guildUUID) {
            log.error('HANDLER', 'Missing guildUUID');
            callback({ type: 'guild', action: 'getMembers', userId: userId, guildUUID: guildUUID, version: request.version || '1.0', _members: {}, _name: '', _icon: 1, _level: 1, _leftExp: 0, _des: '', _bulletin: '' });
            return;
        }

        // Get guild info
        var guild = getGuildInfo(guildUUID);
        var guildName = guild ? guild._name : 'Super Warriors';
        var guildIcon = guild ? guild._icon : 1;
        var guildLevel = guild ? guild._level : 10;
        var guildLeftExp = guild ? (guild._leftExp || 0) : 955800;
        var guildDes = guild ? (guild._des || '') : 'Come and join us!';
        var guildBulletin = guild ? (guild._bulletin || 'Welcome!') : 'Welcome!';

        // Build members dict — 1 member: the requesting user as captain
        var userData = getUserData(userId);
        var userLevel = 1;
        var userNick = 'Player';
        var userHeadImage = 'hero_icon_1201';
        var userVip = 0;
        var userServerId = 2067;
        var userOriServerId = 2067;

        if (userData) {
            if (userData.user) {
                userLevel = userData.user._level || 1;
                userNick = userData.user._nickName || 'Player';
                userHeadImage = userData.user._headImage || 'hero_icon_1201';
                userVip = userData.user._vipLevel || 0;
            }
        }

        var members = {};
        members[userId] = {
            _id: userId,
            _title: 2,                    // CAPTAIN
            _joinTime: Date.now() - 86400000,  // 1 day ago
            _nickName: userNick,
            _headImage: userHeadImage,
            _headEffect: 0,
            _headBox: 0,
            _level: userLevel,
            _vip: userVip,
            _online: true,
            _offlineTime: 0,
            _guildName: guildName,
            _serverId: userServerId,
            _oriServerId: userOriServerId
        };

        // Response: echo request + guild info + members dict
        var response = {
            // Echo request fields
            type: 'guild',
            action: 'getMembers',
            userId: userId,
            guildUUID: guildUUID,
            version: request.version || '1.0',

            // Guild info fields (setTeamMembers reads these from `t`)
            _name: guildName,
            _icon: guildIcon,
            _level: guildLevel,
            _leftExp: guildLeftExp,
            _des: guildDes,
            _bulletin: guildBulletin,

            // Members: DICT keyed by userId
            _members: members
        };

        log.info('HANDLER', 'getMembers -> ' + Object.keys(members).length + ' member(s) in ' + guildName);

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'getMembers', handleGetMembers);

    window.MainServer = MainServer;
})();
