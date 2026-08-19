/**
 * handlers/guild/getGuildList.js — Get Guild List Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ════════════════════════════════════════════════════════════════
 * VERIFIKASI TERHADAP SUMBER UTAMA
 * ════════════════════════════════════════════════════════════════
 *
 * 1. CLIENT: main.min(unminfy).js
 *    - L56484-56500: requestTeamList() — request payload
 *    - L139011-139027: JoinTeam.requestTeamList() — pagination dengan isAll toggle
 *    - L3305420: setTeamInfoList(e) — iterasi `for(var o in n)` atas `e._guilds`
 *    - L3305420: setTeamInfo() — map 12 fields ke TeamInfo model
 *    - L3298857: getTotalCount() = `_totalCount` (0→1), getTeamCount() = `_teamCount`
 *    - L2126226: TeamInfo model — `_id, _displayIndex, _name, _icon, _exp, _des,
 *      _needAgree, _limitLevel, _captainNick, _level, _memberCount, _memberLimit, _activePoint`
 *
 * 2. HAR DECODED: guild_protocol_reference.json → getGuildList
 *    - Response: {type, action, userId, isAll, curPage, pageLen, version, _totalCount, _guilds}
 *    - _guilds = ARRAY of guild objects
 *    - _guilds[i] fields: _id, _displayIndex, _name, _icon, _leftExp, _des,
 *      _needAgree, _limitLevel, _level, _memberCount, _memberLimit, _activePoint, _captainNick
 *    - _totalCount = TOTAL HALAMAN (Math.ceil(totalGuilds / pageLen))
 *    - HAR sample: pageLen=6, 6 guilds returned, _totalCount=7
 *
 * 3. AUTO WIN: 1 guild clan ("Super Warriors")
 *    - _needAgree: false → langsung masuk tanpa approval
 *    - _limitLevel: 1 → level minimum rendah
 *
 * 4. KEY DIFFERENCE vs handler lama:
 *    - _guilds HARUS ARRAY (lama: Object keyed by _id)
 *    - _totalCount = total pages, bukan total guilds
 *    - Response HARUS echo request fields (type, action, userId, isAll, curPage, pageLen, version)
 *    - TIDAK ADA _myTeam — user yang sudah di guild TIDAK akan panggil getGuildList
 *      (client cek: L56467 `if(""==n||void 0==n) t.requestTeamList()`)
 *    - Guild field: server kirim _leftExp, client TeamInfo punya _exp — field extra diabaikan
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ════════════════════════════════════════════════════════════════
    // STORAGE & DATA
    // ════════════════════════════════════════════════════════════════

    var GUILD_LIST_KEY = 'guildList';

    // 1 guild clan system (server)
    var DEFAULT_GUILDS = [
        {
            _id: 'c203e281-0c49-4753-a663-27303d2348f1',
            _displayIndex: 1001,
            _name: 'Super Warriors',
            _icon: 1,
            _leftExp: 955800,
            _des: 'Come and join us!',
            _needAgree: false,
            _limitLevel: 1,
            _level: 10,
            _memberCount: 1,
            _memberLimit: 30,
            _activePoint: 0,
            _captainNick: 'Captain'
        }
    ];

    /**
     * Get ALL guilds merged: defaults + DB user-created
     */
    function getAllGuilds() {
        var dbGuilds = db._get(GUILD_LIST_KEY);
        var allGuilds = DEFAULT_GUILDS.slice(); // clone defaults

        if (dbGuilds && typeof dbGuilds === 'object') {
            // DB bisa berupa Array atau Object
            var arr = Array.isArray(dbGuilds) ? dbGuilds : Object.values(dbGuilds);
            for (var i = 0; i < arr.length; i++) {
                // Skip default guild IDs (jika ada di DB juga)
                var isDefault = false;
                for (var j = 0; j < DEFAULT_GUILDS.length; j++) {
                    if (DEFAULT_GUILDS[j]._id === arr[i]._id) { isDefault = true; break; }
                }
                if (!isDefault) {
                    allGuilds.push(arr[i]);
                }
            }
        } else if (!dbGuilds) {
            // DB kosong — seed defaults
            db._set(GUILD_LIST_KEY, DEFAULT_GUILDS);
        }

        return allGuilds;
    }

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/getGuildList
    // ════════════════════════════════════════════════════════════════

    function handleGetGuildList(request, callback) {
        var userId = request.userId;
        var isAll = request.isAll;
        var curPage = request.curPage || 1;
        var pageLen = request.pageLen || 6;

        log.info('HANDLER', 'guild/getGuildList');
        log.details('request', [
            ['userId', userId || '-'],
            ['isAll', String(isAll)],
            ['curPage', String(curPage)],
            ['pageLen', String(pageLen)]
        ]);

        // Get all guilds from storage
        var allGuilds = getAllGuilds();

        // Sort by _displayIndex ascending (sesuai HAR: 1001, 1002, 1003, ...)
        allGuilds.sort(function (a, b) {
            return (a._displayIndex || 0) - (b._displayIndex || 0);
        });

        // Paginate
        var totalCount = Math.max(1, Math.ceil(allGuilds.length / pageLen));
        var startIndex = (curPage - 1) * pageLen;
        var endIndex = Math.min(startIndex + pageLen, allGuilds.length);
        var pageGuilds = allGuilds.slice(startIndex, endIndex);

        // ═══════════════════════════════════════════════════════════
        // BUILD RESPONSE — sesuai HAR format persis
        // ═══════════════════════════════════════════════════════════
        // HAR proves: response = echo request fields + response data fields
        // _guilds = ARRAY (bukan Object!)
        // _totalCount = total HALAMAN (bukan total guild count)
        // ═══════════════════════════════════════════════════════════

        var response = {
            // Echo request fields (HAR bukti semua response include ini)
            type: 'guild',
            action: 'getGuildList',
            userId: userId,
            isAll: isAll,
            curPage: curPage,
            pageLen: pageLen,
            version: request.version || '1.0',

            // Response data fields
            _totalCount: totalCount,
            _guilds: pageGuilds
        };

        log.info('HANDLER', 'getGuildList -> ' + pageGuilds.length + '/' +
            allGuilds.length + ' guilds, page ' + curPage + '/' + totalCount);

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'getGuildList', handleGetGuildList);

    window.MainServer = MainServer;
})();
