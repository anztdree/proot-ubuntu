/**
 * handlers/guild/getTreasureInfo.js — Get Treasure Info Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ════════════════════════════════════════════════════════════════
 * VERIFIKASI SUMBER UTAMA: main.min(unminfy).js
 * ════════════════════════════════════════════════════════════════
 *
 * 1. REQUEST: {type, action, userId, guildUUID, version}
 *    - L56492: openTeamPanel → getTreasureInfo
 *    - L64183: treasure battle → getTreasureInfo (after attack/fail)
 *    - L3564667: getTeamInfo → getTreasureInfo (enter treasure scene)
 *
 * 2. CALLBACK: GuildTreasureManager.getInstance().saveTreasureInfoData(t)
 *    L3560845: saveTreasureInfoData(e)
 *      a) t.treasureData.deserialize(e._treasure)
 *      b) e._memberLastArenaTeam → dict {userId: [DisplayHero,...], ...}
 *         Each item: DisplayHero.deserialize → {heroDisplayId, heroStar, heroLevel, skinId}
 *      c) e._memberLastArenaTeamSuper → dict {userId: superId, ...}
 *      d) e._memberLastArenaPower → dict {userId: powerNumber, ...}
 *
 * 3. GuildTreasure.deserialize(e) L3567495:
 *    - _defenceTeam: array of userId strings
 *    - _logs: array of GuildTreasureLog objects
 *    - _enemyGuild: dict {idx: GuildTreasureEnemyGuild}
 *    - _memberPoint: dict {userId: number}
 *    - _enemyGuildAttackList: array
 *    - common fields: matchRet, defaultCoin, bePlunderCoin, getCoin
 *
 * 4. GuildTreasureEnemyGuild.deserialize L3567900:
 *    - guildId, guildName, guildLevel, guildIcon (common → strip _)
 *    - totalCoin (common)
 *    - _defenceUsers: dict {userId: TeamUserItem}
 *
 * 5. TeamUserItem.deserialize L2129448:
 *    - serverId, oriServerId, userId, nickName, headImage,
 *      headEffect, headBox, guildName, level, vip, totalPower
 *    - _superSkill: array (special: kept as-is)
 *    - _teams: (special: kept as teams)
 *
 * 6. GUILD_TREASURE_MATCH_RET enum:
 *    UNKNOW=0, SUCCESS=1, LEVEL_NOT_ENOUGH=2,
 *    MEMBER_NOT_ENOUGH=3, GUILD_NOT_ENOUGH=4
 *
 * 7. HAR pattern confirms: echo request fields + _treasure +
 *    _memberLastArenaTeam + _memberLastArenaTeamSuper + _memberLastArenaPower
 * ════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/getTreasureInfo
    // ════════════════════════════════════════════════════════════════

    function handleGetTreasureInfo(request, callback) {
        var userId = request.userId;
        var guildUUID = request.guildUUID;

        log.info('HANDLER', 'guild/getTreasureInfo');
        log.details('request', [
            ['userId', userId || '-'],
            ['guildUUID', guildUUID || '-']
        ]);

        // Get user data for member info
        var userData = db._get('ms_user_' + userId + '_1');
        var userLevel = 1;
        var userNick = 'Player';
        var userHeadImage = 'hero_icon_1201';
        var userVip = 0;

        if (userData && userData.user) {
            userLevel = userData.user._level || 1;
            userNick = userData.user._nickName || 'Player';
            userHeadImage = userData.user._headImage || 'hero_icon_1201';
            userVip = userData.user._vipLevel || 0;
        }

        // ═══════════════════════════════════════════════════════════
        // Build _treasure object (GuildTreasure.deserialize format)
        // ═══════════════════════════════════════════════════════════
        var treasure = {
            _defenceTeam: [userId],
            _logs: [],
            _enemyGuild: {},
            _memberPoint: {},
            _matchRet: 3,          // MEMBER_NOT_ENOUGH (no match yet)
            _defaultCoin: 0,
            _bePlunderCoin: 0,
            _getCoin: 0,
            _enemyGuildAttackList: []
        };

        // ═══════════════════════════════════════════════════════════
        // Build _memberLastArenaTeam (dict {userId: [DisplayHero,...]})
        // DisplayHero: {heroDisplayId, heroStar, heroLevel, skinId}
        // ═══════════════════════════════════════════════════════════
        var memberLastArenaTeam = {};
        memberLastArenaTeam[userId] = [
            { heroDisplayId: 1201, heroStar: 0, heroLevel: 1, skinId: 0 },
            { heroDisplayId: 1202, heroStar: 0, heroLevel: 1, skinId: 0 },
            { heroDisplayId: 1203, heroStar: 0, heroLevel: 1, skinId: 0 },
            { heroDisplayId: 1204, heroStar: 0, heroLevel: 1, skinId: 0 },
            { heroDisplayId: 1205, heroStar: 0, heroLevel: 1, skinId: 0 }
        ];

        // ═══════════════════════════════════════════════════════════
        // Build _memberLastArenaTeamSuper (dict {userId: superId})
        // ═══════════════════════════════════════════════════════════
        var memberLastArenaTeamSuper = {};
        memberLastArenaTeamSuper[userId] = 0;

        // ═══════════════════════════════════════════════════════════
        // Build _memberLastArenaPower (dict {userId: powerNumber})
        // ═══════════════════════════════════════════════════════════
        var memberLastArenaPower = {};
        memberLastArenaPower[userId] = 1000;

        // ═══════════════════════════════════════════════════════════
        // RESPONSE
        // ═══════════════════════════════════════════════════════════
        var response = {
            type: 'guild',
            action: 'getTreasureInfo',
            userId: userId,
            guildUUID: guildUUID,
            version: request.version || '1.0',
            _treasure: treasure,
            _memberLastArenaTeam: memberLastArenaTeam,
            _memberLastArenaTeamSuper: memberLastArenaTeamSuper,
            _memberLastArenaPower: memberLastArenaPower
        };

        log.info('HANDLER', 'getTreasureInfo -> matchRet=3 (MEMBER_NOT_ENOUGH)');

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'getTreasureInfo', handleGetTreasureInfo);

    window.MainServer = MainServer;
})();
