/**
 * handlers/friend/getApplyList.js — Get Friend Apply List Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: friend/getApplyList
 * ============================================================
 *
 * Client call (main.min.js ~L84196):
 *   ts.processHandler({
 *     type: 'friend',
 *     action: 'getApplyList',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     version: '1.0'
 *   }, callback(response))
 *
 * Client callback:
 *   saveApplyFriendData(response) → baca _applyList
 *
 * Response fields:
 *   _applyList: { [userId]: { _nickName, _headImage, _headEffect, _headBox,
 *               _oriServerId, _serverId, _level, _vip, _online,
 *               _offlineTime?, _guildName? } }
 *
 * Data source: db key 'ms_friend_{userId}'
 *   → { friends:[], blacklist:[], applyList:[] }
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    /**
     * Get friend data for a user.
     */
    function getFriendData(userId) {
        var key = 'ms_friend_' + userId;
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
        var storageKey = 'ms_user_' + userId + '_1';
        var userData = db._get(storageKey);

        if (userData && userData.user) {
            return {
                _nickName: userData.user._nickName || 'Player',
                _headImage: userData.user._headImage || 'hero_icon_1205',
                _headEffect: (userData.user._headEffect || 0),
                _headBox: (userData.user._headBox || 0),
                _oriServerId: (userData.user._oriServerId || 1),
                _serverId: 1,
                _level: (userData.level || 1),
                _vip: (userData.vip || 0),
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
            _level: 1,
            _vip: 0,
            _online: true
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN HANDLER: friend/getApplyList
    // ═══════════════════════════════════════════════════════════════

    function handleGetApplyList(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'friend/getApplyList processing');
        log.details('request', [
            ['userId', userId || '-']
        ]);

        if (!userId) {
            log.error('HANDLER', 'Missing userId in getApplyList');
            callback({ _error: 'missing_userId' });
            return;
        }

        var data = getFriendData(userId);

        // Build _applyList object — { [applicantId]: profile }
        var applyList = {};
        for (var i = 0; i < data.applyList.length; i++) {
            var applicantId = data.applyList[i];
            applyList[applicantId] = getUserProfile(applicantId);
        }

        log.info('HANDLER', 'getApplyList → ' + Object.keys(applyList).length + ' applicants');

        callback({
            _applyList: applyList
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // REGISTER
    // ═══════════════════════════════════════════════════════════════

    MainServer.registerHandler('friend', 'getApplyList', handleGetApplyList);

    window.MainServer = MainServer;
})();
