/**
 * handlers/guild/createGuild.js — Create Guild Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: guild/createGuild
 * ============================================================
 *
 * 📖 KODE CLIENT (main.min(unminfy).js) — CreationTeam.CreationTeamBtnTap():
 * ─────────────────────────────────────────────────────────────
 *   Line ~138900-138908:
 *
 *   var l = UserInfoSingleton.getInstance().userId;
 *   ts.processHandler({
 *       type: "guild",
 *       action: "createGuild",
 *       userId: l,
 *       guildName: n,          // ← dari importText.text (input user)
 *       version: "1.0"
 *   }, function(e) {
 *       // ✅ CALLBACK SUKSES — client expect response ini:
 *       ItemsCommonSingleton.getInstance().resetTtemsCallBack(e),     // update items
 *       TeamInfoManager.getInstance().setMyTeamInfo(e._guildInfo),    // set guild data
 *       TeamInfoManager.getInstance().setGuildID(e._guildInfo._id),   // set guild ID
 *       ts.chatJoinRequest(e._guildInfo._chatRoomId),                 // ← JOIN CHAT ROOM!
 *       ts.loginInfo.serverItem.guildRoomId = e._guildInfo._chatRoomId, // ← SAVE CHAT ROOM
 *       TeamInfoManager.getInstance().setHaveReadBulletin(!0),        // mark bulletin read
 *       UIWindowManager.openTeamPanel(TeamTipsType.Create)            // show success panel
 *   })
 *
 * 📖 setMyTeamInfo() IMPLEMENTATION (EXACT dari main.min.js):
 * ─────────────────────────────────────────────────────────────
 *   e.prototype.setMyTeamInfo = function(e) {
 *       t.myTeamInfo._displayIndex = e._displayIndex,   // ← WAJIB!
 *       t.myTeamInfo._name = e._name,                   // ← WAJIB!
 *       t.myTeamInfo._icon = e._icon,                   // ← WAJIB!
 *       t.myTeamInfo._leftExp = e._leftExp,             // ← WAJIB!
 *       t.myTeamInfo._level = e._level,                  // ← WAJIB!
 *       t.myTeamInfo._des = e._des,                      // ← WAJIB!
 *       t.myTeamInfo._bulletin = e._bulletin,            // ← WAJIB!
 *       t.myTeamInfo._needAgree = e._needAgree,
 *       t.myTeamInfo._limitLevel = e._limitLevel,
 *       e._activePoints && t.setActivePoints(e._activePoints),
 *       t.setTeamMembers(e),                             // ←🔴 LOOP e._members!
 *       e._logs && t.setTeamLog(e._logs),
 *       t.setRequestMenbers(e),                          // ←🔴 LOOP e._requestMembers!
 *       ...
 *   }
 *
 * 📖 setTeamMembers() MAPPING (EXACT dari main.min.js):
 * ─────────────────────────────────────────────────────────────
 *   o._id = e._members[n]._id,
 *   o._title = e._members[n]._title,
 *   o._joinTime = e._members[n]._joinTime,
 *   e._members[n]._nickName && (o._nickName = e._members[n]._nickName),
 *   void 0 != e._members[n]._level && (o._level = e._members[n]._level),
 *   void 0 != e._members[n]._online && (o._online = e._members[n]._online),
 *   e._members[n]._offlineTime && (o._offlineTime = e._members[n]._offlineTime),
 *   e._members[n]._headImage && (o._headImage = e._members[n]._headImage),
 *   void 0 != e._members[n]._headEffect && (o._headEffect = e._members[n]._headEffect),
 *   void 0 != e._members[n]._headBox && (o._headBox = e._members[n]._headBox),
 *   void 0 != e._members[n]._vip && (o._vipLevel = e._members[n]._vip),    // ←🔴 _vip!
 *   void 0 != e._members[n]._serverId && (o._serverId = e._members[n]._serverId),
 *   void 0 != e._members[n]._oriServerId && (o._oriServerId = e._members[n]._oriServerId)
 *
 * ════════════════════════════════════════════════════════════════
 * RESPONSE YANG CLIENT EXPECT (WAJIB SEMPURNA!):
 * ════════════════════════════════════════════════════════════════
 *
 * {
 *   ret: 0,                          // 0=success, 1=error
 *   _guildInfo: {                    // ← GuildModel + TeamInfo + extra fields
 *       // --- GuildModel/TeamInfo fields (WAJIB untuk setMyTeamInfo!) ---
 *       _id: "<guild_id>",
 *       _displayIndex: 0,
 *       _name: "<guild_name>",
 *       _icon: <number>,
 *       _exp: 0,
 *       _leftExp: 0,                  // 🔴 WAJIB! Exp to next level (0 untuk guild baru)
 *       _level: 1,
 *       _des: "<description>",
 *       _bulletin: "",               // 🔴 WAJIB! Guild bulletin
 *       _needAgree: false,
 *       _limitLevel: 1,
 *       _captainNick: "<player_name>",
 *       _memberCount: 1,
 *       _memberLimit: 20,
 *       _activePoint: 0,
 *
 *       // --- 📌 MEMBER LIST (WAJIB untuk setTeamMembers!) ---
 *       _members: [                   // 🔴🔴🔴 ARRAY OF GUILDMEMBER!
 *           {
 *               _id: "<creator_user_id>",
 *               _title: 2,             // CAPTAIN
 *               _joinTime: <timestamp>,
 *               _nickName: "<player_name>",
 *               _headImage: "<hero_icon>",  // 🔴 HERO ICON!
 *               _level: <user_level>,      // 🔴 USER LEVEL!
 *               _vip: <vip_level>,         // 🔴 _vip (bukan _vipLevel!)
 *               _headEffect: 0,
 *               _headBox: 0,
 *               _serverId: 1,
 *               _oriServerId: 1,
 *               _online: true
 *           }
 *       ],
 *
 *       // --- Request Members (WAJIB untuk setRequestMenbers!) ---
 *       _requestMembers: [],           // 🔴 Empty array for new guild
 *
 *       // --- Extra fields untuk callback ---
 *       _chatRoomId: "<chat_room_id>", // 🔴 WAJIB! untuk chatJoinRequest
 *       _canJoinGuildTime: <timestamp>  // 🔴 WAJIB! untuk cooldown
 *   },
 *   _changeInfo: {                  // ← untuk resetTtemsCallBack
 *       _items: [{
 *           _id: 102,               // diamond item ID
 *           _num: <current_balance>  // balance setelah deduct
 *       }]
 *   }
 * }
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ════════════════════════════════════════════════════════════════
    // CONSTANTS (dari ReadJsonSingleton.getInstance().constant[1])
    // ════════════════════════════════════════════════════════════════
    
    var GUILD_CREATE_PRICE = 0;       // FREE untuk test! (aslinya: t.guildCreatePrice)
    var DIAMOND_ID = 102;              // Item ID diamond
    var MAX_GUILD_NAME_LENGTH = 12;    // aslinya: t.playerNameLength
    
    // Default icon options (client pick via UI)
    var DEFAULT_ICONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

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
                user: {
                    _nickName: 'Player',
                    _headImage: 'hero_icon_1205'
                },
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
     * Save user data to DB
     */
    function saveUserData(userId, userData) {
        var key = 'ms_user_' + userId + '_1';
        db._set(key, userData);
    }

    /**
     * Get item balance from totalProps._items
     */
    function getItemBalance(userData, itemId) {
        if (!userData || !userData.totalProps || !userData.totalProps._items) return 0;
        
        var items = userData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    /**
     * Deduct item from user's inventory
     */
    function deductItem(userData, itemId, amount) {
        if (!userData || !userData.totalProps || !userData.totalProps._items) return false;
        
        var items = userData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                var current = Number(items[i]._num) || 0;
                if (current < amount) return false;
                
                items[i]._num = current - amount;
                return true;
            }
        }
        return false;
    }

    /**
     * Generate unique guild ID
     */
    function generateGuildId() {
        return 'guild_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    }

    /**
     * Generate chat room ID for guild
     */
    function generateChatRoomId(guildId) {
        return 'guild_room_' + guildId;
    }

    /**
     * Validate guild name server-side
     */
    function validateGuildName(name) {
        if (!name || name.trim() === '') {
            return { valid: false, error: 'EMPTY_NAME' };
        }
        
        if (name.length > MAX_GUILD_NAME_LENGTH) {
            return { valid: false, error: 'NAME_TOO_LONG' };
        }
        
        if (/^\d+$/.test(name)) {
            return { valid: false, error: 'NUMBERS_ONLY' };
        }
        
        var blockedWords = ['admin', 'gm', 'game', 'system', 'fuck', 'shit'];
        var lowerName = name.toLowerCase();
        for (var i = 0; i < blockedWords.length; i++) {
            if (lowerName.indexOf(blockedWords[i]) > -1) {
                return { valid: false, error: 'BLOCKED_WORD' };
            }
        }
        
        return { valid: true, error: null };
    }

    /**
     * Create GuildMember object sesuai client expectation (setTeamMembers mapping!)
     * 
     * 📖 Client's setTeamMembers() mapping (EXACT dari main.min.js):
     * ─────────────────────────────────────────────────────────────
     *   o._id = e._members[n]._id,
     *   o._title = e._members[n]._title,
     *   o._joinTime = e._members[n]._joinTime,
     *   e._members[n]._nickName && (o._nickName = e._members[n]._nickName),
     *   void 0 != e._members[n]._level && (o._level = e._members[n]._level),
     *   void 0 != e._members[n]._online && (o._online = e._members[n]._online),
     *   e._members[n]._offlineTime && (o._offlineTime = e._members[n]._offlineTime),
     *   e._members[n]._headImage && (o._headImage = e._members[n]._headImage),
     *   void 0 != e._members[n]._headEffect && (o._headEffect = e._members[n]._headEffect),
     *   void 0 != e._members[n]._headBox && (o._headBox = e._members[n]._headBox),
     *   void 0 != e._members[n]._vip && (o._vipLevel = e._members[n]._vip),    // ←🔴 _vip!
     *   void 0 != e._members[n]._serverId && (o._serverId = e._members[n]._serverId),
     *   void 0 != e._members[n]._oriServerId && (o._oriServerId = e._members[n]._oriServerId)
     */
    function createGuildMemberFromUserData(userId, userData, title) {
        var member = {
            _id: userId,
            _title: title || MEMBER_TITLE.NORMAL,
            _joinTime: Date.now()
        };
        
        // 🔴🔴🔴 AMBIL DATA USER YANG SEBENARNYA DARI DB! BUKAN HARDCODE!!!
        if (userData && userData.user) {
            var u = userData.user;
            
            // Basic info
            if (u._nickName) member._nickName = u._nickName;
            
            // Hero/Avatar data (UNTUK TAMPILAN DI CLIENT!)
            if (u._headImage) member._headImage = u._headImage;
            
            // User stats
            if (typeof u._level !== 'undefined' && u._level !== null) member._level = u._level;
            
            // 🔴🔴🔴 VIP: Response pakai _vip (bukan _vipLevel!) sesuai client mapping!
            if (typeof u._vip !== 'undefined' && u._vip !== null) {
                member._vip = u._vip;
            } else if (typeof u._vipLevel !== 'undefined' && u._vipLevel !== null) {
                member._vip = u._vipLevel;
            }
            
            // Server info
            if (typeof u._serverId !== 'undefined' && u._serverId !== null) member._serverId = u._serverId;
            if (typeof u._oriServerId !== 'undefined' && u._oriServerId !== null) member._oriServerId = u._oriServerId;
            
            // Head decorations
            if (typeof u._headEffect !== 'undefined' && u._headEffect !== null) member._headEffect = u._headEffect;
            if (typeof u._headBox !== 'undefined' && u._headBox !== null) member._headBox = u._headBox;
        }
        
        // Default values HANYA kalau tidak ada di userData
        if (typeof member._headEffect === 'undefined') member._headEffect = 0;
        if (typeof member._headBox === 'undefined') member._headBox = 0;
        if (typeof member._vip === 'undefined') member._vip = 0;
        if (typeof member._serverId === 'undefined') member._serverId = 1;
        if (typeof member._oriServerId === 'undefined') member._oriServerId = 1;
        if (typeof member._online === 'undefined') member._online = true;
        
        log.info('HANDLER', '👤 Created GuildMember for: ' + userId +
            ' (' + (member._nickName || '?') + ')' +
            ', headImage: ' + (member._headImage || 'NONE') +
            ', level: ' + (member._level || '?') +
            ', vip: ' + member._vip);
        
        return member;
    }

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/createGuild
    // ════════════════════════════════════════════════════════════════

    function handleCreateGuild(request, callback) {
        var userId = request.userId;
        var guildName = request.guildName;

        log.info('HANDLER', '═══════════════════════════════════════');
        log.info('HANDLER', 'guild/createGuild processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['guildName', guildName || '-']
        ]);

        // ════════════════════════════════════════════════════════════════
        // VALIDATION
        // ════════════════════════════════════════════════════════════════
        
        if (!userId) {
            userId = 'test_user_001';
            log.info('HANDLER', 'Using default userId: ' + userId);
        }

        if (!guildName || guildName.trim() === '') {
            guildName = 'My Guild ' + Math.floor(Math.random() * 1000);
            log.info('HANDLER', 'Using default guildName: ' + guildName);
        }

        var validation = validateGuildName(guildName);
        if (!validation.valid && validation.error !== 'NUMBERS_ONLY') {
            if (validation.error === 'EMPTY_NAME') {
                guildName = 'My Guild';
            } else if (validation.error === 'NAME_TOO_LONG') {
                guildName = guildName.substring(0, MAX_GUILD_NAME_LENGTH);
            }
            log.info('HANDLER', 'Auto-fixed guild name: ' + guildName);
        }

        // Get user data
        var userData = getUserData(userId);

        // Check if user already in a guild (SKIP untuk test - allow recreate)
        if (userData.guild && userData.guild._guildId) {
            log.info('HANDLER', 'User already in guild, leaving old guild: ' + userData.guild._guildId);
        }

        // Check diamond balance (FREE untuk test!)

        // ════════════════════════════════════════════════════════════════
        // CREATE GUILD OBJECT (SESUAI GUILDMODEL + TEAMINFO + CLIENT EXPECTATION!)
        // ════════════════════════════════════════════════════════════════
        
        var newGuildId = generateGuildId();
        var chatRoomId = generateChatRoomId(newGuildId);
        var now = Date.now();
        
        // 🔴🔴🔴 Create captain member dengan DATA USER YANG SEBENARNYA!
        var captainMember = createGuildMemberFromUserData(userId, userData, MEMBER_TITLE.CAPTAIN);
        captainMember._joinTime = now;  // Override join time ke creation time
        
        // 📌 Create new guild object (SESUAI setMyTeamInfo expectation!)
        var newGuild = {
            // --- TeamInfo/GuildModel fields (WAJIB untuk setMyTeamInfo!) ---
            _id: newGuildId,
            _displayIndex: 0,
            _name: guildName.trim(),
            _icon: DEFAULT_ICONS[Math.floor(Math.random() * DEFAULT_ICONS.length)],
            _exp: 0,
            _leftExp: 0,                 // 🔴🔴🔴 WAJIB! Exp to next level (default 0 untuk guild baru)
            _level: 1,
            _des: 'Newly created guild!',
            _bulletin: '',              // 🔴🔴🔴 WAJIB! Empty string default
            _needAgree: false,
            _limitLevel: 1,
            _captainNick: userData.user ? userData.user._nickName : 'Captain',
            _memberCount: 1,
            _memberLimit: 20,
            _activePoint: 0,
            
            // 🔴🔴🔴🔴🔴 MEMBERS ARRAY! (WAJIB untuk setTeamMembers!)
            _members: [captainMember],
            
            // 🔴🔴🔴 REQUEST MEMBERS ARRAY! (WAJIB untuk setRequestMenbers!)
            _requestMembers: [],
            
            // --- Extra fields untuk client callback ---
            _chatRoomId: chatRoomId,                    // 🔴 WAJIB! untuk ts.chatJoinRequest()
            _canJoinGuildTime: now,                      // 🔴 WAJIB! untuk cooldown
            
            // Tracking fields untuk recovery
            _createdBy: userId,
            _createdAt: now
        };

        // Deduct diamonds (FREE untuk test)
        if (GUILD_CREATE_PRICE > 0) {
            deductItem(userData, DIAMOND_ID, GUILD_CREATE_PRICE);
        }

        // Update user's guild membership (sesuai UserGuildModel line 53707-53712)
        userData.guild._guildId = newGuildId;
        userData.guild._requestedGuild = [];
        userData.guild._isCaptain = true;
        userData.guild._haveReadBulletin = true;
        userData.guild._canJoinGuildTime = now;
        userData.guild._createGuildCD = false;
        userData.guild._joinTime = now;
        userData.guild._guildName = guildName;
        
        log.info('HANDLER', '💾 Saving user guild membership...');
        log.details('userGuildData', [
            ['_guildId', newGuildId],
            ['_isCaptain', 'true'],
            ['_guildName', guildName],
            ['_joinTime', now]
        ]);
        
        // Save user data
        saveUserData(userId, userData);
        
        // Verify
        var verifyUserData = getUserData(userId);
        var verifyGuildId = verifyUserData.guild ? verifyUserData.guild._guildId : 'NOT FOUND';
        log.info('HANDLER', '✅ VERIFY user save: _guildId = ' + verifyGuildId + 
            (verifyGuildId === newGuildId ? ' ✅ MATCH!' : ' ❌ MISMATCH!'));

        // ════════════════════════════════════════════════════════════════
        // PERSISTENCE: SAVE TO INDEXEDDB
        // ════════════════════════════════════════════════════════════════
        
        var GUILD_LIST_KEY = 'ms_guild_list';
        var MEMBERS_PREFIX = 'ms_guild_members_';
        
        log.info('HANDLER', '💾 Saving to IndexedDB...');
        
        // Save guild to guild list
        var existingGuilds = db._get(GUILD_LIST_KEY);
        if (!existingGuilds || typeof existingGuilds !== 'object') {
            existingGuilds = {};
        }
        existingGuilds[newGuildId] = newGuild;
        db._set(GUILD_LIST_KEY, existingGuilds);
        log.info('HANDLER', '✅ Guild saved to ms_guild_list: ' + newGuildId);
        
        // Save members list separately (for getMembers handler)
        var membersKey = MEMBERS_PREFIX + newGuildId;
        db._set(membersKey, newGuild._members);
        
        // Verify member save
        var verifyMembers = db._get(membersKey);
        log.info('HANDLER', '👑 CAPTAIN SAVED to ' + membersKey + '!');
        log.info('HANDLER', '✅ VERIFY: Members count = ' + 
            (verifyMembers ? verifyMembers.length : 0));
        
        if (verifyMembers && verifyMembers[0]) {
            log.info('HANDLER', '✅ VERIFY Captain:');
            log.details('captainData', [
                ['_id', verifyMembers[0]._id],
                ['_nickName', verifyMembers[0]._nickName || '?'],
                ['_title', verifyMembers[0]._title === MEMBER_TITLE.CAPTAIN ? 'CAPTAIN' : 'OTHER'],
                ['_headImage', verifyMembers[0]._headImage || 'NONE'],
                ['_level', verifyMembers[0]._level || '?'],
                ['_vip', verifyMembers[0]._vip || 0]
            ]);
        }
        
        log.info('HANDLER', '🎉 GUILD CREATED & PERSISTED');
        log.details('guildInfo', [
            ['Guild ID', newGuildId],
            ['Name', guildName],
            ['Captain', userId + ' (' + (userData.user ? userData.user._nickName : '?') + ')'],
            ['Chat Room', chatRoomId]
        ]);

        // Build change info for client (ItemsCommonSingleton.resetTtemsCallBack)
        var currentDiamonds = getItemBalance(userData, DIAMOND_ID);
        var changeInfo = {
            _items: [
                {
                    _id: DIAMOND_ID,
                    _num: currentDiamonds
                }
            ]
        };

        // Build response (SESUAI client expectation!)
        var response = {
            ret: 0,
            _guildInfo: newGuild,       // GuildModel with ALL required fields!
            _changeInfo: changeInfo     // Items update
        };

        log.info('HANDLER', '✅ GUILD CREATED SUCCESSFULLY');
        log.details('response', [
            ['ret', '0'],
            ['_guildInfo._id', newGuildId],
            ['_guildInfo._name', guildName],
            ['_guildInfo._members.length', newGuild._members.length],
            ['_guildInfo._chatRoomId', chatRoomId],
            ['_changeInfo._items[0]._num', currentDiamonds]
        ]);

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'createGuild', handleCreateGuild);

    window.MainServer = MainServer;
})();
