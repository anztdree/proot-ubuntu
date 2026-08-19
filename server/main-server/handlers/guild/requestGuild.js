/**
 * handlers/guild/requestGuild.js — Request Join Guild Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: guild/requestGuild
 * ============================================================
 *
 * Client call (main.min(unminfy).js):
 *
 *   CASE 1: User click "Join" on specific guild (ApplyForTeamPanel.joinBtnTap):
 *     ts.processHandler({
 *       type: 'guild',
 *       action: 'requestGuild',
 *       userId: <userId>,
 *       guildUUIDs: ['<single_guild_id>'],  // 1 guild only
 *       version: '1.0'
 *     }, callback(response))
 *
 *   CASE 2: User click "Apply All" (JoinTeam.aKeyApplicationBtnTap):
 *     ts.processHandler({
 *       type: 'guild',
 *       action: 'requestGuild',
 *       userId: <userId>,
 *       guildUUIDs: ['id1', 'id2', ...],  // ALL visible guilds
 *       version: '1.0'
 *     }, callback(response))
 *
 * Dipanggil saat:
 *   - User apply join ke 1 guild spesifik
 *   - User "Apply All" — apply ke semua guild yang visible
 *
 * Client callback:
 *   TeamInfoManager.getInstance().setRequestTeamIDList(t)
 *   → Update _requestedGuild list
 *   → Baca _requestSuccessCount untuk tips (apply all case)
 *
 * Response fields:
 *   _requestedGuild: [<guildId>, ...]  — list of guild IDs user applied to
 *   _requestSuccessCount: <number>     — jumlah request yang sukses
 *   ret: 0 = success, 1 = error
 *
 * Logic:
 *   - Jika guild _needAgree = false → auto join langsung!
 *   - Jika guild _needAgree = true → tambah ke request list
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ════════════════════════════════════════════════════════════════
    // GUILD DATA — BACA DARI INDEXEDDB! (Bukan hardcoded!)
    // ════════════════════════════════════════════════════════════════
    
    // Default sample guilds (fallback)
    var DEFAULT_GUILDS = {
        'clan_001': {
            _id: 'clan_001',
            _name: 'Clan 1',
            _icon: 1,
            _level: 10,
            _memberCount: 5,
            _memberLimit: 20,
            _needAgree: false,
            _captainNick: 'Leader1'
        },
        'clan_002': {
            _id: 'clan_002',
            _name: 'Clan 2',
            _icon: 2,
            _level: 15,
            _memberCount: 8,
            _memberLimit: 25,
            _needAgree: false,
            _captainNick: 'Leader2'
        }
    };
    
    var GUILD_LIST_KEY = 'guildList';
    
    /**
     * Get ALL guilds from DB + defaults merged
     */
    function getAllGuilds() {
        var dbGuilds = db._get(GUILD_LIST_KEY);
        var allGuilds = {};
        
        for (var id in DEFAULT_GUILDS) {
            allGuilds[id] = DEFAULT_GUILDS[id];
        }
        
        if (dbGuilds && typeof dbGuilds === 'object' && !Array.isArray(dbGuilds)) {
            for (var guildId in dbGuilds) {
                allGuilds[guildId] = dbGuilds[guildId];
            }
        }
        
        return allGuilds;
    }

    /**
     * Get user's guild data from DB
     */
    function getUserGuildData(userId) {
        var key = 'user:' + userId;
        var userData = db._get(key);
        
        if (!userData) {
            userData = { user: {}, guild: {}, totalProps: { _items: [] } };
            db._set(key, userData);
        }
        
        if (!userData.guild) {
            userData.guild = {
                _guildId: '',
                _requestedGuild: []
            };
        }
        
        if (!userData.guild._requestedGuild) {
            userData.guild._requestedGuild = [];
        }
        
        return userData;
    }

    /**
     * Save user's guild data to DB
     */
    function saveUserGuildData(userId, userData) {
        var key = 'user:' + userId;
        db._set(key, userData);
    }

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/requestGuild
    // ════════════════════════════════════════════════════════════════

    function handleRequestGuild(request, callback) {
        var userId = request.userId;
        var guildUUIDs = request.guildUUIDs;  // Array of guild IDs to apply to

        log.info('HANDLER', 'guild/requestGuild processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['guildUUIDs', JSON.stringify(guildUUIDs || [])]
        ]);

        // ════════════════════════════════════════════════════════════════
        // RELAXED VALIDATION — Auto-fix untuk test!
        // ════════════════════════════════════════════════════════════════
        
        // Jika userId kosong, gunakan default
        if (!userId) {
            userId = 'test_user_001';
            log.info('HANDLER', 'Using default userId: ' + userId);
        }
        
        // Jika guildUUIDs bukan array, convert ke array
        if (!Array.isArray(guildUUIDs)) {
            if (typeof guildUUIDs === 'string' && guildUUIDs) {
                guildUUIDs = [guildUUIDs];
            } else if (!guildUUIDs) {
                // Default: apply ke semua guild
                guildUUIDs = Object.keys(DEFAULT_GUILDS);
                log.info('HANDLER', 'No guildUUIDs, applying to all default guilds');
            } else {
                guildUUIDs = [guildUUIDs];
            }
        }
        
        if (guildUUIDs.length === 0) {
            guildUUIDs = Object.keys(DEFAULT_GUILDS);  // Gunakan DEFAULT_GUILDS (sebelum ALL_GUILDS define)
        }

        // Get current user data
        var userData = getUserGuildData(userId);
        var currentGuildId = userData.guild._guildId || '';
        var requestedGuild = userData.guild._requestedGuild || [];
        var successCount = 0;
        
        // 🔥 FIX: Get ALL guilds from DB!
        var ALL_GUILDS = getAllGuilds();

        // Process each guild request
        for (var i = 0; i < guildUUIDs.length; i++) {
            var targetGuildId = guildUUIDs[i];
            var guild = ALL_GUILDS[targetGuildId];  // 🔥 FIX: Baca dari DB!

            // Check if guild exists
            if (!guild) {
                log.info('HANDLER', 'Guild not found: ' + targetGuildId);
                continue;
            }

            // Check if already in this guild
            if (currentGuildId === targetGuildId) {
                log.info('HANDLER', 'User already in guild: ' + targetGuildId);
                continue;
            }

            // Check if already requested this guild
            if (requestedGuild.indexOf(targetGuildId) > -1) {
                log.info('HANDLER', 'Already requested guild: ' + targetGuildId);
                continue;
            }

            // Process based on _needAgree setting
            if (guild._needAgree) {
                // Need approval → add to request list
                requestedGuild.push(targetGuildId);
                log.info('HANDLER', 'Applied to guild (needs approval): ' + targetGuildId);
            } else {
                // Auto approve → JOIN DIRECTLY!
                currentGuildId = targetGuildId;
                
                // Remove from requested list if was there
                var idx = requestedGuild.indexOf(targetGuildId);
                if (idx > -1) {
                    requestedGuild.splice(idx, 1);
                }
                
                log.info('HANDLER', 'Auto-joined guild: ' + targetGuildId);
            }

            successCount++;
        }

        // Save updated data
        userData.guild._guildId = currentGuildId;
        userData.guild._requestedGuild = requestedGuild;
        
        // 🔥 FIX: Set additional fields for persistence!
        if (currentGuildId) {
            userData.guild._joinTime = Date.now();  // Track join time
            userData.guild._isCaptain = false;      // Not captain (joined, not created)
        }
        
        log.info('HANDLER', '💾 SAVING user guild data...');
        
        saveUserGuildData(userId, userData);
        
        // 🔥🔥🔥 SAVE USER TO GUILD MEMBER LIST!!!
        // Kalau user join guild, harus ditambahkan ke member list!
        if (currentGuildId) {
            var MEMBERS_PREFIX = 'guildMembers:';
            var membersKey = MEMBERS_PREFIX + currentGuildId;
            var existingMembers = db._get(membersKey);
            
            if (!existingMembers || !Array.isArray(existingMembers)) {
                existingMembers = [];
            }
            
            // Cek apakah user sudah di list
            var alreadyMember = false;
            for (var m = 0; m < existingMembers.length; m++) {
                if (existingMembers[m]._id === userId) {
                    alreadyMember = true;
                    break;
                }
            }
            
            if (!alreadyMember) {
                // Tambahkan user sebagai NORMAL member (bukan captain)
                var newMember = {
                    _id: userId,
                    _title: 0,              // NORMAL member
                    _joinTime: Date.now(),
                    _headEffect: 0,
                    _headBox: 0,
                    _vipLevel: 0,
                    _serverId: 1,
                    _oriServerId: 1,
                    _nickName: userData.user ? userData.user._nickName : 'Player'
                };
                
                existingMembers.push(newMember);
                db._set(membersKey, existingMembers);
                
                log.info('HANDLER', '👤 Added user to member list: ' + currentGuildId);
                log.info('HANDLER', '✅ Total members now: ' + existingMembers.length);
            } else {
                log.info('HANDLER', 'ℹ️ User already in member list: ' + currentGuildId);
            }
        }
        
        // 🔥 VERIFY: Baca balik untuk pastikan tersimpan!
        var verifyData = getUserGuildData(userId);
        log.info('HANDLER', '✅ VERIFY after save: _guildId = ' + 
            (verifyData.guild ? verifyData.guild._guildId : 'NO GUILD FIELD'));

        // Build response
        var response = {
            ret: 0,
            _requestedGuild: requestedGuild,
            _requestSuccessCount: successCount
        };

        // ════════════════════════════════════════════════════════════════
        // AUTO APPROVE: Jika guild _needAgree = false → JOIN LANGSUNG!
        // Return _guildInfo & _guildId supaya client tau user SUDAH MASUK CLAN!
        // ════════════════════════════════════════════════════════════════
        if (currentGuildId && ALL_GUILDS[currentGuildId]) {
            // Full guild info — client pakai ini untuk update TeamInfoManager
            response._guildInfo = ALL_GUILDS[currentGuildId];
            response._guildId = currentGuildId;
            
            log.info('HANDLER', '✅ AUTO-JOINED GUILD: ' + currentGuildId + 
                ' (' + ALL_GUILDS[currentGuildId]._name + ')');
        }

        log.info('HANDLER', 'requestGuild → success: ' + successCount + '/' + guildUUIDs.length +
            ', requested: ' + JSON.stringify(requestedGuild) +
            (currentGuildId ? ', joined: ' + currentGuildId : ''));

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'requestGuild', handleRequestGuild);

    window.MainServer = MainServer;
})();
