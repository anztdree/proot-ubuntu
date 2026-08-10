/**
 * handlers/guild/getGuildDetail.js — Get Guild Detail Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: guild/getGuildDetail
 * ============================================================
 *
 * 📖 KODE CLIENT (main.min(unminfy).js) — 3 LOKASI PANGGIL:
 * ─────────────────────────────────────────────────────────────
 *
 * [1] LINE 56471-56478 — openTeam() (buka guild panel):
 * ─────────────────────────────────────────────────────────────
 *   ts.processHandler({
 *       type: "guild",
 *       action: "getGuildDetail",
 *       userId: o,           // UserInfoSingleton.userId
 *       guildUUID: a,        // TeamInfoManager.getGuildID()
 *       version: "1.0"
 *   }, function(t) {
 *       TeamInfoManager.getInstance().setMyTeamInfo(t._guildInfo),
 *       e.openTeamPanel()
 *   })
 *
 * [2] LINE 133552-133559 — clickTeamTreasure() (guild treasure):
 * ─────────────────────────────────────────────────────────────
 *   ts.processHandler({
 *       type: "guild",
 *       action: "getGuildDetail",
 *       userId: t,
 *       guildUUID: n,
 *       version: "1.0"
 *   }, function(e) {
 *       TeamInfoManager.getInstance().setMyTeamInfo(e._guildInfo),
 *       GuildTreasureManager.getInstance().getTeamInfo(...)
 *   })
 *
 * [3] LINE 139050-139057 — notify("guildAgree") (setelah approve member):
 * ─────────────────────────────────────────────────────────────
 *   ts.processHandler({
 *       type: "guild",
 *       action: "getGuildDetail",
 *       userId: t,
 *       guildUUID: n,
 *       version: "1.0"
 *   }, function(e) {
 *       TeamInfoManager.getInstance().setMyTeamInfo(e._guildInfo),
 *       ts.chatJoinRequest(e._guildInfo._chatRoomId),           // ←🔴 CHAT!
 *       ts.loginInfo.serverItem.guildRoomId = e._guildInfo._chatRoomId,
 *       TeamInfoManager.getInstance().setCanJoinGuiswTime(e._guildInfo._canJoinGuildTime), // ←🔴 COOLDOWN!
 *       ...UIWindowManager.openTeamPanel(...)
 *   })
 *
 * ════════════════════════════════════════════════════════════════
 * RESPONSE YANG CLIENT EXPECT (100% SAMA DENGAN createGuild!):
 * ════════════════════════════════════════════════════════════════
 *
 * {
 *   _guildInfo: {                    // ← GuildModel + TeamInfo + extra
 *       // --- setMyTeamInfo() fields (WAJIB!) ---
 *       _id: "<guild_id>",
 *       _displayIndex: 0,
 *       _name: "<guild_name>",
 *       _icon: <number>,
 *       _exp: 0,
 *       _leftExp: 0,
 *       _level: 1,
 *       _des: "<description>",
 *       _bulletin: "<bulletin_text>",
 *       _needAgree: false,
 *       _limitLevel: 1,
 *
 *       // --- Member list (setTeamMembers!) ---
 *       _members: [                   // ← Array of GuildMember!
 *           { _id, _title, _joinTime, _nickName, _headImage, _level, _vip, ... }
 *       ],
 *
 *       // --- Request members (setRequestMenbers!) ---
 *       _requestMembers: [],          // ← Array
 *
 *       // --- Extra fields (dari callback #3!) ---
 *       _chatRoomId: "<room_id>",     // ←🔴 WAJIB! chatJoinRequest()
 *       _canJoinGuildTime: <timestamp> // ←🔴 WAJIB! setCanJoinGuiswTime()
 *   }
 * }
 *
 * 📖 setMyTeamInfo() IMPLEMENTATION (main.min.js):
 * ─────────────────────────────────────────────────────────────
 *   e.prototype.setMyTeamInfo = function(e) {
 *       t.myTeamInfo._displayIndex = e._displayIndex,
 *       t.myTeamInfo._name = e._name,
 *       t.myTeamInfo._icon = e._icon,
 *       t.myTeamInfo._leftExp = e._leftExp,
 *       t.myTeamInfo._level = e._level,
 *       t.myTeamInfo._des = e._des,
 *       t.myTeamInfo._bulletin = e._bulletin,
 *       t.myTeamInfo._needAgree = e._needAgree,
 *       t.myTeamInfo._limitLevel = e._limitLevel,
 *       e._activePoints && t.setActivePoints(e._activePoints),
 *       t.setTeamMembers(e),         // ← loop e._members
 *       e._logs && t.setTeamLog(e._logs),
 *       t.setRequestMenbers(e),      // ← loop e._requestMembers
 *       ...
 *   }
 *
 * 📖 setTeamMembers() MAPPING (main.min.js) — EXACTLY 13 FIELDS:
 * ─────────────────────────────────────────────────────────────
 *   o._id = e._members[n]._id,                                          // [1]
 *   o._title = e._members[n]._title,                                    // [2]
 *   o._joinTime = e._members[n]._joinTime,                              // [3]
 *   e._members[n]._nickName && (o._nickName = e._members[n]._nickName), // [9]
 *   void 0 != e._members[n]._level && (o._level = ...),                // [10]
 *   void 0 != e._members[n]._online && (o._online = ...),              // [11]
 *   e._members[n]._offlineTime && (o._offlineTime = ...),              // [12]
 *   e._members[n]._headImage && (o._headImage = ...),                  // [13]
 *   void 0 != e._members[n]._headEffect && (o._headEffect = ...),      // [4]
 *   void 0 != e._members[n]._headBox && (o._headBox = ...),            // [5]
 *   void 0 != e._members[n]._vip && (o._vipLevel = ...),               // [6] ← _vip!
 *   void 0 != e._members[n]._serverId && (o._serverId = ...),          // [7]
 *   void 0 != e._members[n]._oriServerId && (o._oriServerId = ...)     // [8]
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ════════════════════════════════════════════════════════════════
    // STORAGE KEYS & CONSTANTS
    // ════════════════════════════════════════════════════════════════

    var GUILD_LIST_KEY = 'ms_guild_list';           // Guild list storage
    var MEMBERS_PREFIX = 'ms_guild_members_';      // Members per guild

    // GUILD_MEMBER_TITLE enum (LINE 53781-53784)
    var MEMBER_TITLE = {
        NORMAL: 0,
        VICE_CAPTAIN: 1,
        CAPTAIN: 2
    };

    // ════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS — INDEXEDDB OPERATIONS
    // ════════════════════════════════════════════════════════════════

    /**
     * Get user's current data from DB
     */
    function getUserData(userId) {
        var key = 'ms_user_' + userId + '_1';
        var userData = db._get(key);

        if (!userData) {
            userData = {
                user: { _nickName: 'Player' },
                guild: {},
                totalProps: { _items: [] }
            };
            db._set(key, userData);
            log.info('HANDLER', '📝 Created new user data for: ' + userId);
        }

        if (!userData.guild) {
            userData.guild = {};
        }

        return userData;
    }

    /**
     * Get guild info from ms_guild_list
     */
    function getGuildFromList(guildId) {
        var guildList = db._get(GUILD_LIST_KEY);

        if (guildList && guildList[guildId]) {
            return guildList[guildId];
        }

        return null;
    }

    // ════════════════════════════════════════════════════════════════
    // 🔴🔴🔴 SYNC MEMBER DATA WITH USER DATA FROM DB! (CRITICAL!)
    // ════════════════════════════════════════════════════════════════
    /**
     * 🔴🔴🔴 INI FUNGSI PALING PENTING!
     *
     * Setiap kali membaca member, kita HARUS sync dengan data user terbaru
     * dari IndexedDB karena user bisa:
     * - Level up (_level berubah)
     * - Upgrade VIP (_vip berubah)
     * - Ganti avatar/hero (_headImage berubah)
     * - Ganti nickname (_nickName berubah)
     * - Ganti server (_serverId, _oriServerId berubah)
     * - Pakai head decoration (_headEffect, _headBox berubah)
     *
     * Tanpa ini, member data akan STALE (data lama yang tidak update!)
     */
    function syncMemberWithUserData(member) {
        if (!member || !member._id) {
            log.error('HANDLER', '❌ syncMemberWithUserData: invalid member!');
            return member;
        }

        var userId = member._id;
        var userData = getUserData(userId);
        
        if (!userData || !userData.user) {
            log.info('HANDLER', '⚠️ No userData found for member: ' + userId + ', keeping existing data');
            return member;
        }

        var u = userData.user;
        var updated = false;
        var updatedFields = [];

        // [9] _nickName — User bisa ganti nickname!
        if (u._nickName && u._nickName !== member._nickName) {
            var oldNick = member._nickName;
            member._nickName = u._nickName;
            updatedFields.push('_nickName: ' + (oldNick || '?') + ' → ' + u._nickName);
            updated = true;
        }

        // [10] _level — User LEVEL UP! Ini PALING PENTING!
        if (typeof u._level !== 'undefined' && u._level !== null && u._level !== member._level) {
            var oldLevel = member._level;
            member._level = u._level;
            updatedFields.push('_level: ' + (oldLevel || '?') + ' → ' + u._level);
            updated = true;
        }

        // [6] _vip — User upgrade VIP!
        var newVip = (typeof u._vip !== 'undefined' && u._vip !== null) ? u._vip :
                    (typeof u._vipLevel !== 'undefined' && u._vipLevel !== null) ? u._vipLevel : null;
        if (newVip !== null && newVip !== member._vip) {
            var oldVip = member._vip;
            member._vip = newVip;
            updatedFields.push('_vip: ' + (oldVip || 0) + ' → ' + newVip);
            updated = true;
        }

        // [13] _headImage — User ganti hero/avatar!
        if (u._headImage && u._headImage !== member._headImage) {
            var oldHead = member._headImage;
            member._headImage = u._headImage;
            updatedFields.push('_headImage: ' + (oldHead || '?') + ' → ' + u._headImage);
            updated = true;
        }

        // [7] _serverId — User pindah server?
        if (typeof u._serverId !== 'undefined' && u._serverId !== null && u._serverId !== member._serverId) {
            member._serverId = u._serverId;
            updatedFields.push('_serverId → ' + u._serverId);
            updated = true;
        }

        // [8] _oriServerId — Original server berubah?
        if (typeof u._oriServerId !== 'undefined' && u._oriServerId !== null && u._oriServerId !== member._oriServerId) {
            member._oriServerId = u._oriServerId;
            updatedFields.push('_oriServerId → ' + u._oriServerId);
            updated = true;
        }

        // [4] _headEffect — User pakai decoration effect?
        if (typeof u._headEffect !== 'undefined' && u._headEffect !== null && u._headEffect !== member._headEffect) {
            member._headEffect = u._headEffect;
            updatedFields.push('_headEffect → ' + u._headEffect);
            updated = true;
        }

        // [5] _headBox — User pakai decoration box/frame?
        if (typeof u._headBox !== 'undefined' && u._headBox !== null && u._headBox !== member._headBox) {
            member._headBox = u._headBox;
            updatedFields.push('_headBox → ' + u._headBox);
            updated = true;
        }

        // LOGGING
        if (updated) {
            log.info('HANDLER', '🔄 SYNCED member data for: ' + userId + ' (' + (member._nickName || '?') + ')');
            for (var i = 0; i < updatedFields.length; i++) {
                log.info('HANDLER', '   ✅ ' + updatedFields[i]);
            }
        }

        return member;
    }

    /**
     * 🔴🔴🔴 ENSURE GUILDMEMBER HAS ALL 13 FIELDS! (CRITICAL FIX!)
     * 
     * Client's setTeamMembers() expects EXACTLY these 13 fields:
     * ──────────────────────────────────────────────────────────────
     * From GuildMember Constructor (8 fields - ALWAYS required):
     *   [1]  _id           (string)
     *   [2]  _title        (number: 0=NORMAL, 1=VICE, 2=CAPTAIN)
     *   [3]  _joinTime     (number: timestamp)
     *   [4]  _headEffect   (number: default 0)
     *   [5]  _headBox      (number: default 0)
     *   [6]  _vip          (number: default 0) ← Response uses _vip, not _vipLevel!
     *   [7]  _serverId     (number: default 1)
     *   [8]  _oriServerId  (number: default 1)
     *
     * From setTeamMembers Runtime Mapping (5 conditional fields):
     *   [9]  _nickName     (string: default 'Player')
     *   [10] _level        (number: default 1) 🔴🔴🔴 THIS WAS MISSING!
     *   [11] _online       (boolean: default true)
     *   [12] _offlineTime  (number: default 0)
     *   [13] _headImage    (string: default 'hero_icon_1205')
     *
     * 📖 Client mapping (main.min.js setTeamMembers):
     *   o._id = e._members[n]._id                                    // [1]
     *   o._title = e._members[n]._title                              // [2]
     *   o._joinTime = e._members[n]._joinTime                        // [3]
     *   e._members[n]._nickName && (o._nickName = ...)               // [9]
     *   void 0 != e._members[n]._level && (o._level = ...)          // [10]
     *   void 0 != e._members[n]._online && (o._online = ...)        // [11]
     *   e._members[n]._offlineTime && (o._offlineTime = ...)         // [12]
     *   e._members[n]._headImage && (o._headImage = ...)             // [13]
     *   void 0 != e._members[n]._headEffect && (o._headEffect = ...) // [4]
     *   void 0 != e._members[n]._headBox && (o._headBox = ...)       // [5]
     *   void 0 != e._members[n]._vip && (o._vipLevel = ...)          // [6]
     *   void 0 != e._members[n]._serverId && (o._serverId = ...)     // [7]
     *   void 0 != e._members[n]._oriServerId && (o._oriServerId = ...) // [8]
     */
    function ensureCompleteGuildMember(member) {
        if (!member || typeof member !== 'object') {
            log.error('HANDLER', '❌ ensureCompleteGuildMember: invalid member!');
            return null;
        }

        var now = Date.now();
        var fixed = false;
        var missingFields = [];

        // ════════════════════════════════════════════════════════════════
        // CONSTRUCTOR FIELDS (8 fields) — WAJIB ADA!
        // ════════════════════════════════════════════════════════════════

        // [1] _id — WAJIB! Kalau kosong, ini bug!
        if (typeof member._id === 'undefined' || member._id === null || member._id === '') {
            member._id = 'unknown_' + now;
            missingFields.push('_id');
            fixed = true;
        }

        // [2] _title — Default NORMAL (0)
        if (typeof member._title === 'undefined' || member._title === null) {
            member._title = MEMBER_TITLE.NORMAL;
            missingFields.push('_title');
            fixed = true;
        }

        // [3] _joinTime — Default now
        if (typeof member._joinTime === 'undefined' || member._joinTime === null) {
            member._joinTime = now;
            missingFields.push('_joinTime');
            fixed = true;
        }

        // [4] _headEffect — Default 0
        if (typeof member._headEffect === 'undefined' || member._headEffect === null) {
            member._headEffect = 0;
            missingFields.push('_headEffect');
            fixed = true;
        }

        // [5] _headBox — Default 0
        if (typeof member._headBox === 'undefined' || member._headBox === null) {
            member._headBox = 0;
            missingFields.push('_headBox');
            fixed = true;
        }

        // [6] _vip — 🔴🔴🔴 RESPONSE PAKAI _vip (bukan _vipLevel!)
        // Client maps: o._vipLevel = e._members[n]._vip
        if (typeof member._vip === 'undefined' || member._vip === null) {
            // Coba fallback ke _vipLevel kalau ada di data lama
            if (typeof member._vipLevel !== 'undefined' && member._vipLevel !== null) {
                member._vip = member._vipLevel;
                log.info('HANDLER', '🔄 Migrated _vipLevel → _vip for: ' + member._id);
            } else {
                member._vip = 0;
            }
            missingFields.push('_vip');
            fixed = true;
        }

        // [7] _serverId — Default 1
        if (typeof member._serverId === 'undefined' || member._serverId === null) {
            member._serverId = 1;
            missingFields.push('_serverId');
            fixed = true;
        }

        // [8] _oriServerId — Default 1
        if (typeof member._oriServerId === 'undefined' || member._oriServerId === null) {
            member._oriServerId = 1;
            missingFields.push('_oriServerId');
            fixed = true;
        }

        // ════════════════════════════════════════════════════════════════
        // RUNTIME MAPPING FIELDS (5 fields) — Dari setTeamMembers()
        // ════════════════════════════════════════════════════════════════

        // [9] _nickName — Default 'Player'
        if (typeof member._nickName === 'undefined' || member._nickName === null || member._nickName === '') {
            member._nickName = 'Player';
            missingFields.push('_nickName');
            fixed = true;
        }

        // [10] _level — 🔴🔴🔴 INI YANG BUG! Default 1
        if (typeof member._level === 'undefined' || member._level === null) {
            member._level = 1;
            missingFields.push('_level');  // 🔴🔴🔴 LOG THIS!
            fixed = true;
        }

        // [11] _online — Default true
        if (typeof member._online === 'undefined' || member._online === null) {
            member._online = true;
            missingFields.push('_online');
            fixed = true;
        }

        // [12] _offlineTime — Default 0
        if (typeof member._offlineTime === 'undefined' || member._offlineTime === null) {
            member._offlineTime = 0;
            missingFields.push('_offlineTime');
            fixed = true;
        }

        // [13] _headImage — Default hero icon
        if (typeof member._headImage === 'undefined' || member._headImage === null || member._headImage === '') {
            member._headImage = 'hero_icon_1205';
            missingFields.push('_headImage');
            fixed = true;
        }

        // ════════════════════════════════════════════════════════════════
        // LOGGING
        // ════════════════════════════════════════════════════════════════

        if (fixed) {
            log.info('HANDLER', '🔧 Fixed incomplete GuildMember: ' + (member._id || '?'));
            log.info('HANDLER', '   Missing fields: [' + missingFields.join(', ') + ']');
            log.info('HANDLER', '   Result: Lvl=' + member._level +
                ', VIP=' + member._vip +
                ', Online=' + (member._online ? 'Y' : 'N') +
                ', Head=' + (member._headImage || '?') +
                ', Nick=' + (member._nickName || '?'));
        }

        return member;
    }

    /**
     * Get members for specific guild dari IndexedDB
     * 🔴🔴🔴 FIXED: Now SYNC & validates ALL 13 fields per member!
     */
    function getGuildMembers(guildId) {
        var key = MEMBERS_PREFIX + guildId;
        var members = db._get(key);

        log.info('HANDLER', '📖 Reading members from: ' + key);

        if (members && Array.isArray(members) && members.length > 0) {
            log.info('HANDLER', '✅ Loaded ' + members.length + ' members from DB');

            // 🔴🔴🔴 FIX: SYNC & Validate EVERY member!
            var processedMembers = [];
            var syncedCount = 0;
            var fixedCount = 0;

            for (var i = 0; i < members.length; i++) {
                var originalMember = members[i];
                
                // 🔴🔴🔴 STEP 1: SYNC dengan data user terbaru dari DB!
                // Ini PALING PENTING supaya data tidak stale!
                var syncedMember = syncMemberWithUserData(originalMember);
                
                // 🔴🔴🔴 STEP 2: Pastikan semua 13 field ada (tambah default kalau perlu)
                var validatedMember = ensureCompleteGuildMember(syncedMember);

                if (validatedMember) {
                    processedMembers.push(validatedMember);
                    
                    // Check if any field was fixed
                    var requiredFields = ['_id', '_title', '_joinTime', '_nickName', '_level', 
                        '_online', '_offlineTime', '_headImage', '_headEffect', '_headBox', 
                        '_vip', '_serverId', '_oriServerId'];
                    
                    for (var f = 0; f < requiredFields.length; f++) {
                        if (typeof originalMember[requiredFields[f]] === 'undefined' || 
                            originalMember[requiredFields[f]] === null) {
                            fixedCount++;
                            break;
                        }
                    }
                }
            }

            if (fixedCount > 0) {
                log.info('HANDLER', '🔧 Fixed ' + fixedCount + '/' + members.length + ' members with missing fields!');
            }
            
            // Save processed data back to DB (kalau ada perubahan)
            db._set(key, processedMembers);
            log.info('HANDLER', '💾 Saved processed members back to DB');

            return processedMembers;  // ✅ Return synced & validated members!
        }

        // ❌ Tidak ada data → coba recovery dari guild list
        log.info('HANDLER', '⚠️ No members in DB, attempting recovery...');

        var guildInfo = getGuildFromList(guildId);
        if (guildInfo && guildInfo._createdBy) {
            var creatorId = guildInfo._createdBy;
            var creatorUserData = getUserData(creatorId);

            // Buat captain member dengan data user LENGKAP!
            members = [createGuildMember(creatorId, creatorUserData, MEMBER_TITLE.CAPTAIN)];
            members[0]._joinTime = guildInfo._createdAt || Date.now();

            // Save ke DB supaya next time langsung ketemu
            db._set(key, members);
            log.info('HANDLER', '💾 Recovered and saved captain for: ' + guildId);

            return members;
        }

        log.info('HANDLER', '❌ No data at all for guild: ' + guildId);
        return [];
    }

    /**
     * Create GuildMember object sesuai client expectation (setTeamMembers mapping!)
     *
     * 📖 Client's setTeamMembers() mapping (EXACT dari main.min.js):
     * ─────────────────────────────────────────────────────────────
     *   o._id = e._members[n]._id,                                          // [1]
     *   o._title = e._members[n]._title,                                    // [2]
     *   o._joinTime = e._members[n]._joinTime,                              // [3]
     *   e._members[n]._nickName && (o._nickName = e._members[n]._nickName), // [9]
     *   void 0 != e._members[n]._level && (o._level = ...),                // [10]
     *   void 0 != e._members[n]._online && (o._online = ...),              // [11]
     *   e._members[n]._offlineTime && (o._offlineTime = ...),              // [12]
     *   e._members[n]._headImage && (o._headImage = ...),                  // [13]
     *   void 0 != e._members[n]._headEffect && (o._headEffect = ...),      // [4]
     *   void 0 != e._members[n]._headBox && (o._headBox = ...),            // [5]
     *   void 0 != e._members[n]._vip && (o._vipLevel = ...),               // [6] ← _vip!
     *   void 0 != e._members[n]._serverId && (o._serverId = ...),          // [7]
     *   void 0 != e._members[n]._oriServerId && (o._oriServerId = ...)     // [8]
     *
     * 📖 EXACTLY 13 FIELDS — NO MORE, NO LESS! (100% SESUAI CLIENT EXPECTATION!)
     */
    function createGuildMember(userId, userData, title) {
        var now = Date.now();
        
        var member = {
            // === CONSTRUCTOR FIELDS (8 fields) ===
            _id: userId,                    // [1] WAJIB!
            _title: title || MEMBER_TITLE.NORMAL, // [2] Default NORMAL
            _joinTime: now,                 // [3] Timestamp
            
            // === RUNTIME MAPPING FIELDS (5 fields) ===
            _online: true,                  // [11] Default online
            _offlineTime: 0                 // [12] Default offline time
        };

        // 🔴🔴🔴 AMBIL DATA USER YANG SEBENARNYA DARI DB! BUKAN HARDCODE!!!
        if (userData && userData.user) {
            var u = userData.user;

            // [9] _nickName — Basic info (WAJIB!)
            if (u._nickName) member._nickName = u._nickName;

            // [13] _headImage — Hero/Avatar data (UNTUK TAMPILAN DI CLIENT!)
            if (u._headImage) member._headImage = u._headImage;

            // [10] _level — User stats (WAJIB!) 🔴🔴🔴
            if (typeof u._level !== 'undefined' && u._level !== null) member._level = u._level;

            // [6] _vip — 🔴🔴🔴 Response pakai _vip (bukan _vipLevel!) sesuai client mapping!
            if (typeof u._vip !== 'undefined' && u._vip !== null) {
                member._vip = u._vip;
            } else if (typeof u._vipLevel !== 'undefined' && u._vipLevel !== null) {
                member._vip = u._vipLevel;
            }

            // [7] _serverId — Server info
            if (typeof u._serverId !== 'undefined' && u._serverId !== null) member._serverId = u._serverId;
            
            // [8] _oriServerId — Original server
            if (typeof u._oriServerId !== 'undefined' && u._oriServerId !== null) member._oriServerId = u._oriServerId;

            // [4] _headEffect — Head decoration effect
            if (typeof u._headEffect !== 'undefined' && u._headEffect !== null) member._headEffect = u._headEffect;
            
            // [5] _headBox — Head decoration box/frame
            if (typeof u._headBox !== 'undefined' && u._headBox !== null) member._headBox = u._headBox;
        }

        // ══════════════════════════════════════════════════════════════
        // 🔴🔴🔴 DEFAULT VALUES WAJIB UNTUK SEMUA 13 FIELD!
        // Kalau tidak ada di userData, PASTIKAN field tetap ada dengan default!
        // ══════════════════════════════════════════════════════════════
        
        // Constructor defaults:
        if (typeof member._headEffect === 'undefined') member._headEffect = 0;       // [4]
        if (typeof member._headBox === 'undefined') member._headBox = 0;             // [5]
        if (typeof member._vip === 'undefined') member._vip = 0;                    // [6]
        if (typeof member._serverId === 'undefined') member._serverId = 1;           // [7]
        if (typeof member._oriServerId === 'undefined') member._oriServerId = 1;    // [8]
        
        // Runtime mapping defaults:
        if (typeof member._nickName === 'undefined') member._nickName = 'Player';           // [9]
        if (typeof member._level === 'undefined') member._level = 1;                       // [10] 🔴🔴🔴
        if (typeof member._online === 'undefined') member._online = true;                 // [11]
        if (typeof member._offlineTime === 'undefined') member._offlineTime = 0;          // [12]
        if (typeof member._headImage === 'undefined') member._headImage = 'hero_icon_1205'; // [13]

        log.info('HANDLER', '👤 Created GuildMember: ' + userId +
            ' (' + (member._nickName || '?') + ')' +
            ', Lvl:' + (member._level || '?') +
            ', VIP:' + (member._vip || 0) +
            ', Online:' + (member._online ? 'Y' : 'N') +
            ', Head:' + (member._headImage || '?'));

        return member;
    }

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/getGuildDetail
    // ════════════════════════════════════════════════════════════════

    function handleGetGuildDetail(request, callback) {
        var userId = request.userId;
        var guildUUID = request.guildUUID;

        log.info('HANDLER', '═══════════════════════════════════════');
        log.info('HANDLER', 'guild/getGuildDetail processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['guildUUID', guildUUID || '-']
        ]);

        // ════════════════════════════════════════════════════════════════
        // VALIDATION & DEFAULTS
        // ════════════════════════════════════════════════════════════════

        if (!userId) {
            userId = 'test_user_001';
            log.info('HANDLER', 'Using default userId: ' + userId);
        }

        if (!guildUUID) {
            // 🔥 Coba dapatkan guildId dari user data!
            var tempUserData = getUserData(userId);
            if (tempUserData.guild && tempUserData.guild._guildId) {
                guildUUID = tempUserData.guild._guildId;
                log.info('HANDLER', 'Got guildUUID from user data: ' + guildUUID);
            } else {
                log.error('HANDLER', '❌ No guildUUID provided and user not in guild!');
                callback({ ret: 1, _error: 'guild_not_found' });
                return;
            }
        }

        // ════════════════════════════════════════════════════════════════
        // GET GUILD INFO FROM INDEXEDDB
        // ════════════════════════════════════════════════════════════════

        var guildInfo = getGuildFromList(guildUUID);

        if (!guildInfo) {
            log.error('HANDLER', '❌ Guild not found in ms_guild_list: ' + guildUUID);
            callback({ ret: 1, _error: 'guild_not_found' });
            return;
        }

        log.info('HANDLER', '✅ Found guild: ' + guildUUID + ' (' + (guildInfo._name || 'unnamed') + ')');

        // ════════════════════════════════════════════════════════════════
        // GET MEMBERS FROM INDEXEDDB (VALIDATED!)
        // ════════════════════════════════════════════════════════════════

        var members = getGuildMembers(guildUUID);  // ✅ Returns validated members!

        // ════════════════════════════════════════════════════════════════
        // ENSURE CURRENT USER IS IN MEMBERS LIST (kalau user adalah member)
        // ════════════════════════════════════════════════════════════════

        var currentUserData = getUserData(userId);
        var userGuildId = currentUserData.guild ? currentUserData.guild._guildId : '';
        var isCaptain = currentUserData.guild ? currentUserData.guild._isCaptain : false;

        if (userGuildId === guildUUID) {
            // User ADALAH member guild ini → ensure ada di list!
            log.info('HANDLER', '🎯 User IS member of this guild!');

            var found = false;
            for (var i = 0; i < members.length; i++) {
                if (members[i]._id === userId) {
                    // Update title kalau perlu
                    if (isCaptain && members[i]._title !== MEMBER_TITLE.CAPTAIN) {
                        members[i]._title = MEMBER_TITLE.CAPTAIN;
                        log.info('HANDLER', '👑 Updated user to CAPTAIN');
                    }
                    found = true;
                    break;
                }
            }

            if (!found) {
                // User tidak ada di list → tambahkan!
                var newMember = createGuildMember(userId, currentUserData, isCaptain ? MEMBER_TITLE.CAPTAIN : MEMBER_TITLE.NORMAL);

                // Captain selalu di posisi pertama!
                if (isCaptain) {
                    members.unshift(newMember);
                    log.info('HANDLER', '👑 Added CAPTAIN at position 0: ' + userId);
                } else {
                    members.push(newMember);
                    log.info('HANDLER', '👤 Added member: ' + userId);
                }

                // Save updated members ke DB
                var membersKey = MEMBERS_PREFIX + guildUUID;
                db._set(membersKey, members);
                log.info('HANDLER', '💾 Saved updated members to DB');
            }
        }

        // ════════════════════════════════════════════════════════════════
        // BUILD RESPONSE — SESUAI CLIENT EXPECTATION (setMyTeamInfo!)
        // ════════════════════════════════════════════════════════════════

        // 📌 Build _guildInfo object (100% sesuai createGuild response format!)
        // 📖 GuildModel Constructor (Line 53754-53759) DEFINES ALL THESE FIELDS:
        //   _displayIndex, _name, _icon, _leftExp, _level, _des, _bulletin,
        //   _members[], _logs[], _needAgree, _limitLevel, _requestMembers[],
        //   _activePoints{}, _nextPropaganda
        var guildInfoResponse = {
            // === CORE GUILDMODEL FIELDS (WAJIB!) ===
            _id: guildUUID,
            _displayIndex: guildInfo._displayIndex || 0,
            _name: guildInfo._name || '',
            _icon: guildInfo._icon || 1,
            _exp: guildInfo._exp || 0,
            _leftExp: guildInfo._leftExp || 0,             // ← 0 untuk guild baru!
            _level: guildInfo._level || 1,
            _des: guildInfo._des || '',
            _bulletin: guildInfo._bulletin || '',
            _needAgree: typeof guildInfo._needAgree !== 'undefined' ? guildInfo._needAgree : false,
            _limitLevel: guildInfo._limitLevel || 1,

            // 🔴🔴🔴 GUILDMODEL FIELDS (Line 53756)!
            _logs: guildInfo._logs || [],                    // Guild logs array!
            _activePoints: guildInfo._activePoints || {},    // Active points object!
            _nextPropaganda: guildInfo._nextPropaganda || 0, // Next propaganda time!

            // Extra fields (tidak di setMyTeamInfo tapi tetap masukkan)
            _captainNick: guildInfo._captainNick || '',
            _memberCount: members.length,
            _memberLimit: guildInfo._memberLimit || 20,
            _activePoint: guildInfo._activePoint || 0,

            // 🔴🔴🔴 MEMBERS ARRAY! (WAJIB untuk setTeamMembers!)
            _members: members,

            // 🔴🔴🔴 REQUEST MEMBERS ARRAY! (WAJIB untuk setRequestMenbers!)
            _requestMembers: guildInfo._requestMembers || [],

            // 🔴🔴🔴 EXTRA FIELDS (WAJIB untuk callback #3!)
            _chatRoomId: guildInfo._chatRoomId || '',           // ← chatJoinRequest()
            _canJoinGuildTime: guildInfo._canJoinGuildTime || 0  // ← setCanJoinGuiswTime()
        };

        // Log hasil
        log.info('HANDLER', '═══════════════════════════════════════');
        log.info('HANDLER', '✅ getGuildDetail COMPLETE:');
        log.info('HANDLER', '   Guild: ' + guildUUID + ' (' + (guildInfo._name || '?') + ')');
        log.info('HANDLER', '   Members count: ' + members.length);
        log.info('HANDLER', '   Guild Level: ' + guildInfoResponse._level);
        log.info('HANDLER', '   Chat Room: ' + (guildInfoResponse._chatRoomId || '(none)'));
        log.info('HANDLER', '   Logs count: ' + (guildInfoResponse._logs ? guildInfoResponse._logs.length : 0));
        log.info('HANDLER', '   ActivePoints: ' + (guildInfoResponse._activePoints ? 'SET' : '(empty)'));
        log.info('HANDLER', '   NextPropaganda: ' + guildInfoResponse._nextPropaganda);

        if (members.length > 0) {
            log.info('HANDLER', '   Member list (with ALL 13 fields):');
            for (var k = 0; k < Math.min(members.length, 5); k++) {
                var m = members[k];
                var titleStr = m._title === MEMBER_TITLE.CAPTAIN ? 'CAPTAIN' :
                               m._title === MEMBER_TITLE.VICE_CAPTAIN ? 'VICE' : 'NORMAL';
                log.info('HANDLER', '     [' + k + '] ' + (m._nickName || m._id) +
                    ' (' + titleStr + ')' +
                    ' Lvl:' + (m._level || '?') +
                    ' VIP:' + (m._vip || 0) +
                    ' Online:' + (m._online ? 'Y' : 'N') +
                    ' Head:' + (m._headImage || '?') +
                    ' Offline:' + (m._offlineTime || 0));
            }
            if (members.length > 5) {
                log.info('HANDLER', '     ... and ' + (members.length - 5) + ' more');
            }
        }

        // Build final response
        var response = {
            _guildInfo: guildInfoResponse
        };

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'getGuildDetail', handleGetGuildDetail);

    window.MainServer = MainServer;
})();
