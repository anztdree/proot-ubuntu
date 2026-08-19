/**
 * handlers/guild/guildSign.js — Guild Sign-In Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VERIFIKASI SUMBER UTAMA: main.min(unminfy).js + resource/json configs
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ══════════ CONFIG SOURCES (resource/json) ══════════
 *
 * 1. guildRegister.json — 3 sign-in tiers:
 *    "1": {id:1, costID:102, num:20000, rewardID:114, rewardNum:200,  guildExp:150, vipNeeded:0}
 *    "2": {id:2, costID:101, num:50,    rewardID:114, rewardNum:500,  guildExp:300, vipNeeded:1}
 *    "3": {id:3, costID:101, num:300,   rewardID:114, rewardNum:2000, guildExp:600, vipNeeded:3}
 *
 *    costID 102 = GOLDID (L78637)
 *    costID 101 = DIAMONDID (L78636)
 *    rewardID 114 = guildCoin / 战队币 (thingsID.json keyName="guildCoin", nameGM="战队币")
 *                 Blue quality basis item (same for all 3 tiers)
 *                 WARNING: itemOrigin.json[114] says "PLUS_BACKPACK" but that's
 *                 the ORIGIN CATEGORY (how item was added to game), NOT the item identity.
 *                 Always verify item identity via thingsID.json keyName/nameGM.
 *
 * 2. guildActivePoint.json — Sign active point:
 *    "1": {id:1, type:"战队签到", activePoint:50}
 *    TeamActivePoint.Sign = 1 (L54031)
 *
 * 3. guild.json — Guild level config (expNeeded + memberNum per level):
 *    Level 1:  expNeeded=1500,  memberNum=20
 *    Level 2:  expNeeded=1800,  memberNum=21
 *    ...
 *    Level 9:  expNeeded=19500, memberNum=28
 *    Level 10: (no expNeeded = MAX), memberNum=30
 *    Client reads: ReadJsonSingleton.getInstance().guild[level] (L139288)
 *    Client displays: accumulated / expNeeded (L139297), progress bar = accumulated/expNeeded
 *
 * 4. guildOpen.json — Feature unlock by guild level:
 *    Hall(Lv1), Tech(Lv1), BOSS(Lv1), Satan(Lv3), Grab(Lv4), Shop(Lv8), DragonBall(Lv8)
 *    Client checks: guildOpen[].level <= myTeamInfo._level (client-side auto)
 *
 * ══════════ CLIENT CONSTANTS (main.min.js) ══════════
 *
 * 5. DIAMONDID = 101  (L78636)
 * 6. GOLDID   = 102  (L78637)
 * 7. GUILD_LOG_TYPE (L53785):
 *    OTHER=0, GOLD_SIGN=1, DIAMOND_SIGN=2, CREATE_GUILD=3,
 *    GIVE_VICE_CAPTAIN=4, GIVE_CAPTAIN=5, BE_CAPTAIN=6,
 *    QUIT_GUILD=7, JOIN_GUILD=8
 * 8. TeamActivePoint (L54031): Sign=1, TeamBoss=2, TeamTreasure=3, SaDanRedPacket=4
 *
 * ══════════ REQUEST — main.min.js L140739 ══════════
 *
 * 9. ts.processHandler({
 *        type: "guild",
 *        action: "guildSign",
 *        userId: t,                        // UserInfoSingleton.userId
 *        guildUUID: n,                     // TeamInfoManager.getGuildID()
 *        signType: e.guildRegisterInfo.id, // 1/2/3 from guildRegister JSON
 *        version: "1.0"
 *    }, callback)
 *
 *    Client pre-checks BEFORE sending (L140728-140761):
 *    a) VIP check: guildRegister[signType].vipNeeded <= userVipLevel
 *    b) If costID == DIAMONDID: show confirm dialog with cost amount
 *    c) If costID == GOLDID: show confirm dialog (no amount shown)
 *    d) Else: proceed directly (free sign-in, no confirm)
 *
 * ══════════ RESPONSE — main.min.js L140746-140749 ══════════
 *
 * 10. Client callback processes:
 *
 *    a) ItemsCommonSingleton.openCommonItemGetTips(n._changeInfo._items, ...)
 *       → Shows reward popup with items from _changeInfo._items
 *       → Format: {String(itemId): {_id: itemId, _num: remainingCount}}
 *       → _num = remaining item count AFTER transaction (NOT delta/negative)
 *       → ONLY reward items go here — NOT cost items!
 *       → openCommonItemGetTips displays ALL items in _items as "rewards gained"
 *       → If cost item (diamond/gold) is included, it shows as a reward — BUG!
 *       → L56639: iterates _items, reads each _id and _num
 *       → L56751: resetTtemsCallBack sets each item to _num value in inventory
 *       → Cost deduction (gold/diamond) handled by server separately, NOT via _items
 *
 *    b) TeamInfoManager.setMyTeamLevel(n._guildLevel)
 *       → this.myTeamInfo._level = n._guildLevel (L79582)
 *       → Updates guild level displayed in UI
 *
 *    c) TeamInfoManager.setMyTeamExp(n._guildLeftExp)
 *       → this.myTeamInfo._leftExp = n._guildLeftExp (L79582)
 *       → Updates guild exp bar (ACCUMULATED exp in current level)
 *       → Client displays: accumulated / guild[level].expNeeded (L139297)
 *       → Progress bar: scaleX = accumulated / expNeeded (L139298)
 *
 *    d) TeamInfoManager.setTeamLog(n._guildLog)
 *       → L79582: REPLACES entire _logs array with response array
 *       → Each entry: new GuildLog POJO with _time, _info, _nickName, _type, _param2
 *       → _param2 passed through ReadJsonSingleton.getlanguage() for translation
 *
 *    e) TeamInfoManager.playerSignInID(e.guildRegisterInfo.id)
 *       → Records which signType player signed today (client-side state)
 *
 *    f) TeamInfoManager.changeActivePoint(t, n._activePoint)
 *       → t = userId, n._activePoint = user's total active points after sign
 *       → Updates myTeamInfo._activePoints[userId]
 *
 * ══════════ GUILD LOG TYPE MAPPING (CRITICAL!) ══════════
 *
 * 11. _guildLog._type is NOT signType directly!
 *     It must map via costID → GUILD_LOG_TYPE:
 *       costID 102 (GOLDID)   → GUILD_LOG_TYPE.GOLD_SIGN   = 1
 *       costID 101 (DIAMONDID) → GUILD_LOG_TYPE.DIAMOND_SIGN = 2
 *
 *     signType 1 (costID=102) → log type 1 (GOLD_SIGN)   ✓
 *     signType 2 (costID=101) → log type 2 (DIAMOND_SIGN) ✓
 *     signType 3 (costID=101) → log type 2 (DIAMOND_SIGN) ✓
 *                          NOT log type 3 (that's CREATE_GUILD!)
 *
 * 12. L140946: For GOLD_SIGN/DIAMOND_SIGN logs, guildContent template uses
 *     {0} = _nickName, {1} = _param2 (translated guildRegister.name)
 *
 * 13. L141857: Sign-in logs filter:
 *     (log._type == GUILD_LOG_TYPE.DIAMOND_SIGN || log._type == GUILD_LOG_TYPE.GOLD_SIGN)
 *     Only type 1 and 2 appear in sign-in record list
 *
 * ══════════ _changeInfo._items FORMAT ══════════
 *
 * 14. Object keyed by String(itemId), each value = {_id, _num}
 *     _num = remaining count in inventory AFTER the transaction
 *     Client iterates with for(var key in items) and reads items[key]._id
 *     For sign-in, ONLY the REWARD item:
 *       - Reward item (guildCoin 114): remaining = old + reg.rewardNum
 *     DO NOT include cost item (gold/diamond) — it would show as reward in popup!
 *     Cost deduction is handled server-side, not via _changeInfo._items.
 *     NOTE: Must use bracket notation (items[id] = ...) for ES5 compat.
 *           Computed property names ( {[expr]: ...} ) are ES6-only.
 *
 * ══════════ guildRegister.name AS _param2 ══════════
 *
 * 15. L79582: _param2 is passed through ReadJsonSingleton.getlanguage()
 *     So the server sends the RAW language key (e.g. "guildRegister_name_1")
 *     and the client translates it to the player's language.
 *
 * ══════════ SIGN-IN FREQUENCY (SERVER-SIDE LOGIC) ══════════
 *
 * 16. Client state (L58000): _guildCheckInType = 0 (single number)
 *     - judgePlayerSignIn() returns _checkInType (L79582)
 *     - playerSignInID(e) sets _checkInType = e (L79582)
 *     - Client only stores WHICH tier, NOT how many times.
 *     - Frequency/count logic is 100% SERVER-SIDE.
 *
 * 17. SIGN-IN FREQUENCY RULES (server-side only):
 *     - signType 1 (gold):     1x per day
 *     - signType 2 (diamond):  1x per day
 *     - signType 3 (diamond):  3x per day  ← NOT 1x!
 *     Draft server is stateless and always allows (no count check).
 *
 * ══════════ GUILD EXP PERSISTENCE ══════════
 *
 * 18. Guild state (_level, _leftExp, _memberLimit) stored in guildList.
 *     - createGuild initializes: _level=1, _leftExp=0, _memberLimit=20
 *     - getGuildDetail reads from guildList and returns via _guildInfo
 *     - getMembers reads from guildList and returns _level, _leftExp
 *     - guildSign MUST read current state, apply exp, level-up, SAVE BACK
 *     - If guild not in guildList, fallback to level=1, leftExp=0
 *
 * 19. Level-up benefits (from guild.json + guildOpen.json):
 *     - _memberLimit increases per guild.json memberNum
 *     - Feature unlocks per guildOpen.json (client checks automatically)
 *     - Server updates _memberLimit in guildList on level-up
 * ════════════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ════════════════════════════════════════════════════════════════
    // STORAGE KEYS (same as createGuild.js, getGuildDetail.js, getMembers.js)
    // ════════════════════════════════════════════════════════════════

    var GUILD_LIST_KEY = 'guildList';
    var USER_KEY_PREFIX = 'user:';

    // ════════════════════════════════════════════════════════════════
    // CONSTANTS FROM main.min.js
    // ════════════════════════════════════════════════════════════════

    /** DIAMONDID = 101 (L78636) */
    var DIAMONDID = 101;
    /** GOLDID = 102 (L78637) */
    var GOLDID = 102;
    /** MAX_GUILD_LEVEL — guild.json has no expNeeded at level 10 */
    var MAX_GUILD_LEVEL = 10;

    /**
     * GUILD_LOG_TYPE enum (L53785)
     * OTHER=0, GOLD_SIGN=1, DIAMOND_SIGN=2, CREATE_GUILD=3,
     * GIVE_VICE_CAPTAIN=4, GIVE_CAPTAIN=5, BE_CAPTAIN=6,
     * QUIT_GUILD=7, JOIN_GUILD=8
     */
    var GUILD_LOG_TYPE = {
        OTHER: 0,
        GOLD_SIGN: 1,
        DIAMOND_SIGN: 2,
        CREATE_GUILD: 3,
        GIVE_VICE_CAPTAIN: 4,
        GIVE_CAPTAIN: 5,
        BE_CAPTAIN: 6,
        QUIT_GUILD: 7,
        JOIN_GUILD: 8
    };

    // ════════════════════════════════════════════════════════════════
    // CONFIG FROM resource/json/guildRegister.json
    // Source: ReadJsonSingleton.getInstance().guildRegister (L60217-60219)
    // Loaded via: this.getJsonWithLanguage("guildRegister", ["name"])
    // Keyed by id ("1", "2", "3" as strings in JSON object)
    // ════════════════════════════════════════════════════════════════

    var GUILD_REGISTER = {
        1: {
            id: 1,
            costID: 102,          // GOLDID — gold sign-in
            num: 20000,           // cost: 20,000 gold
            rewardID: 114,        // guildCoin (战队币) — thingsID.json keyName="guildCoin"
            rewardNum: 200,       // reward: 200 guild coins
            guildExp: 150,        // guild exp gained
            vipNeeded: 0,         // no VIP required
            name: 'guildRegister_name_1'  // language key for _param2
        },
        2: {
            id: 2,
            costID: 101,          // DIAMONDID — diamond sign-in
            num: 50,              // cost: 50 diamonds
            rewardID: 114,        // guildCoin (战队币) — thingsID.json keyName="guildCoin"
            rewardNum: 500,       // reward: 500 guild coins
            guildExp: 300,        // guild exp gained
            vipNeeded: 1,         // VIP 1 required
            name: 'guildRegister_name_2'  // language key for _param2
        },
        3: {
            id: 3,
            costID: 101,          // DIAMONDID — diamond sign-in (premium)
            num: 300,             // cost: 300 diamonds
            rewardID: 114,        // guildCoin (战队币) — thingsID.json keyName="guildCoin"
            rewardNum: 2000,      // reward: 2,000 guild coins
            guildExp: 600,        // guild exp gained
            vipNeeded: 3,         // VIP 3 required
            name: 'guildRegister_name_3'  // language key for _param2
        }
    };

    // ════════════════════════════════════════════════════════════════
    // CONFIG FROM resource/json/guildActivePoint.json
    // Source: ReadJsonSingleton.getInstance().guildActivePoint (L60760-60762)
    // TeamActivePoint.Sign = 1 (L54031)
    // ════════════════════════════════════════════════════════════════

    /** Active point awarded for guild sign-in (config id=1) */
    var SIGN_ACTIVE_POINT = 50;

    // ════════════════════════════════════════════════════════════════
    // CONFIG FROM resource/json/guild.json
    // Source: ReadJsonSingleton.getInstance().guild (L139288)
    // Used in teamLobbyInfo (L139285-139304) to show exp bar:
    //   e.teamExp.text = leftExp + "/" + guild[level].expNeeded
    //   e.expMask.scaleX = leftExp / expNeeded
    // ════════════════════════════════════════════════════════════════

    /**
     * Guild level config — each level has expNeeded and memberNum.
     * Level 10 is max (no expNeeded field).
     * Source: resource/json/guild.json
     * Client reads: ReadJsonSingleton.getInstance().guild[level] (L139288)
     */
    var GUILD_LEVEL = {
        1:  { id: 1,  expNeeded: 1500,  memberNum: 20 },
        2:  { id: 2,  expNeeded: 1800,  memberNum: 21 },
        3:  { id: 3,  expNeeded: 2100,  memberNum: 22 },
        4:  { id: 4,  expNeeded: 2400,  memberNum: 23 },
        5:  { id: 5,  expNeeded: 5400,  memberNum: 24 },
        6:  { id: 6,  expNeeded: 9000,  memberNum: 25 },
        7:  { id: 7,  expNeeded: 13200, memberNum: 26 },
        8:  { id: 8,  expNeeded: 18000, memberNum: 27 },
        9:  { id: 9,  expNeeded: 19500, memberNum: 28 },
        10: { id: 10, memberNum: 30 }  // max level, no expNeeded
    };

    // ════════════════════════════════════════════════════════════════
    // CONFIG FROM resource/json/guildOpen.json
    // Feature unlock by guild level (client checks automatically):
    //   Hall(Lv1), Tech(Lv1), BOSS(Lv1), Satan(Lv3), Grab(Lv4), Shop(Lv8), DragonBall(Lv8)
    // Used only for log messages on level-up.
    // ════════════════════════════════════════════════════════════════

    var GUILD_OPEN = [
        null, // index 0 unused
        { level: 1, nameNew: 'Hall' },         // guildOpen_name_1
        { level: 8, nameNew: 'Shop' },         // guildOpen_name_2
        { level: 1, nameNew: 'Tech' },         // guildOpen_name_3
        { level: 1, nameNew: 'BOSS' },         // guildOpen_name_4
        { level: 3, nameNew: 'Satan' },        // guildOpen_name_5
        { level: 4, nameNew: 'Grab' },         // guildOpen_name_6
        { level: 8, nameNew: 'DragonBall' }    // guildOpen_name_7
    ];

    // ════════════════════════════════════════════════════════════════
    // HELPER: Map costID → GUILD_LOG_TYPE
    // ════════════════════════════════════════════════════════════════

    function getLogTypeFromCostID(costID) {
        if (costID === GOLDID) {
            return GUILD_LOG_TYPE.GOLD_SIGN;       // 1
        }
        if (costID === DIAMONDID) {
            return GUILD_LOG_TYPE.DIAMOND_SIGN;    // 2
        }
        return GUILD_LOG_TYPE.OTHER;               // 0
    }

    // ════════════════════════════════════════════════════════════════
    // HELPER: Get guild from guildList
    // Same pattern as getGuildDetail.js L175-183
    // ════════════════════════════════════════════════════════════════

    function getGuildFromList(guildId) {
        var guildList = db._get(GUILD_LIST_KEY);
        if (guildList && guildList[guildId]) {
            return guildList[guildId];
        }
        return null;
    }

    /**
     * Save guild back to guildList.
     * guildList is keyed by guildId (same as createGuild.js)
     */
    function saveGuildToList(guildId, guildData) {
        var guildList = db._get(GUILD_LIST_KEY);
        if (!guildList) {
            guildList = {};
        }
        guildList[guildId] = guildData;
        db._set(GUILD_LIST_KEY, guildList);
    }

    // ════════════════════════════════════════════════════════════════
    // HELPER: Get user nickname from DB
    // ════════════════════════════════════════════════════════════════

    function getUserNickname(userId) {
        var userData = db._get(USER_KEY_PREFIX + userId);
        if (userData && userData.user && userData.user._nickName) {
            return userData.user._nickName;
        }
        return 'Player';
    }

    // ════════════════════════════════════════════════════════════════
    // HELPER: Apply guild exp gain with multi-level-up support
    // ════════════════════════════════════════════════════════════════
    //
    // _leftExp = ACCUMULATED exp in current level (NOT remaining!)
    // Proof from main.min.js L139292-139299:
    //   var r = e.teamInfo._leftExp;
    //   e.teamExp.text = r + "/" + s.expNeeded;   // "accumulated / needed"
    //   e.expMask.scaleX = r / s.expNeeded;         // progress bar fills UP
    // createGuild.js: _leftExp = 0 for new guild → empty bar ✓
    //
    // Algorithm:
    //   newLeftExp = currentLeftExp + expGained    // ADD exp (accumulate)
    //   while newLeftExp >= GUILD_LEVEL[newLevel].expNeeded:
    //       newLeftExp -= expNeeded                  // carry over overflow
    //       newLevel++
    //
    // At max level (10): no expNeeded, leftExp = 0
    // ════════════════════════════════════════════════════════════════

    function applyGuildExp(currentLevel, currentLeftExp, expGained) {
        var newLevel = currentLevel;
        var newLeftExp = currentLeftExp + expGained;  // ADD exp (accumulated progress)
        var oldLevel = currentLevel;
        var levelUps = [];  // track each level gained for logging

        // Handle level-ups (possibly multiple, e.g. tier 3 gives 600 exp)
        while (newLevel < MAX_GUILD_LEVEL) {
            var levelConfig = GUILD_LEVEL[newLevel];
            if (!levelConfig || !levelConfig.expNeeded) {
                // Max level (10) — no expNeeded, cap leftExp at 0
                newLeftExp = 0;
                break;
            }
            if (newLeftExp >= levelConfig.expNeeded) {
                // Level up! Carry over overflow to next level
                newLeftExp -= levelConfig.expNeeded;
                newLevel++;
                var nextConfig = GUILD_LEVEL[newLevel];
                levelUps.push({
                    level: newLevel,
                    memberNum: nextConfig ? nextConfig.memberNum : 30,
                    expNeeded: nextConfig ? nextConfig.expNeeded || 0 : 0
                });
            } else {
                break;  // Not enough exp for next level
            }
        }

        return {
            newLevel: newLevel,
            newLeftExp: newLeftExp,
            oldLevel: oldLevel,
            leveledUp: newLevel > oldLevel,
            levelUps: levelUps
        };
    }

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/guildSign
    // ════════════════════════════════════════════════════════════════

    function handleGuildSign(request, callback) {
        var userId = request.userId;
        var guildUUID = request.guildUUID;
        var signType = request.signType || 1;

        // ═══════════════════════════════════════════════════════════
        // Lookup sign-in config from guildRegister
        // Client reads: ReadJsonSingleton.getInstance().guildRegister (L140730)
        // ═══════════════════════════════════════════════════════════
        var reg = GUILD_REGISTER[signType];
        if (!reg) {
            log.warn('HANDLER', 'guild/guildSign: invalid signType=' + signType + ', falling back to 1');
            signType = 1;
            reg = GUILD_REGISTER[1];
        }

        var expGained = reg.guildExp;  // 150 / 300 / 600
        var logType = getLogTypeFromCostID(reg.costID);

        log.info('HANDLER', 'guild/guildSign');
        log.details('request', [
            ['userId', userId || '-'],
            ['guildUUID', guildUUID || '-'],
            ['signType', String(signType)],
            ['costID', String(reg.costID) + (reg.costID === DIAMONDID ? '(DIAMONDID)' : reg.costID === GOLDID ? '(GOLDID)' : '')],
            ['costNum', String(reg.num)],
            ['rewardID', String(reg.rewardID)],
            ['rewardNum', String(reg.rewardNum)],
            ['guildExp', String(expGained)],
            ['vipNeeded', String(reg.vipNeeded)],
            ['logType', String(logType) + ' (' + (logType === GUILD_LOG_TYPE.GOLD_SIGN ? 'GOLD_SIGN' : logType === GUILD_LOG_TYPE.DIAMOND_SIGN ? 'DIAMOND_SIGN' : 'OTHER') + ')']
        ]);

        // ═══════════════════════════════════════════════════════════
        // READ GUILD STATE FROM DB (guildList)
        // Same pattern as getGuildDetail.js, getMembers.js, createGuild.js
        // ═══════════════════════════════════════════════════════════
        //
        // Guild object in guildList (created by createGuild.js):
        //   _id, _displayIndex, _name, _icon, _exp, _leftExp, _level,
        //   _des, _bulletin, _needAgree, _limitLevel, _captainNick,
        //   _memberCount, _memberLimit, _activePoint, _members, etc.
        //
        // If guild not found in DB (e.g. guild created before this handler
        // was updated), fallback to safe defaults.

        var guild = getGuildFromList(guildUUID);
        var currentLevel, currentLeftExp;

        if (guild) {
            currentLevel = guild._level || 1;
            currentLeftExp = guild._leftExp || 0;
            log.details('guild state from DB', [
                ['_level', String(currentLevel)],
                ['_leftExp', String(currentLeftExp)],
                ['_memberLimit', String(guild._memberLimit || '?')]
            ]);
        } else {
            // Guild not in DB — use safe defaults
            currentLevel = 1;
            currentLeftExp = 0;
            log.warn('HANDLER', 'Guild not found in guildList: ' + guildUUID + ', using defaults (level=1, leftExp=0)');
        }

        // ═══════════════════════════════════════════════════════════
        // APPLY GUILD EXP GAIN + LEVEL-UP
        // ═══════════════════════════════════════════════════════════

        var result = applyGuildExp(currentLevel, currentLeftExp, expGained);

        log.details('exp calculation', [
            ['before', 'Lv' + currentLevel + ' leftExp=' + currentLeftExp],
            ['expGained', String(expGained)],
            ['after', 'Lv' + result.newLevel + ' leftExp=' + result.newLeftExp],
            ['leveledUp', result.leveledUp ? 'YES' : 'no']
        ]);

        // ═══════════════════════════════════════════════════════════
        // SAVE UPDATED GUILD STATE TO DB
        // ═══════════════════════════════════════════════════════════
        //
        // Must persist _level, _leftExp, _memberLimit so that:
        // - getMembers returns updated values on next call
        // - getGuildDetail returns updated _guildInfo
        // - getGuildList shows correct _memberLimit
        //
        // _memberLimit = GUILD_LEVEL[newLevel].memberNum
        // Client reads memberNum from guild.json[level] in teamLobbyInfo (L139296)
        // but getGuildList uses _memberLimit from guild object.

        if (guild) {
            guild._level = result.newLevel;
            guild._leftExp = result.newLeftExp;

            // Always sync _memberLimit with guild.json config for current level
            var levelConfig = GUILD_LEVEL[result.newLevel];
            if (levelConfig) {
                guild._memberLimit = levelConfig.memberNum;
            }

            saveGuildToList(guildUUID, guild);

            // ═══ POST-SAVE VERIFICATION ═══
            // Read back from DB to confirm persistence
            var verifyGuild = getGuildFromList(guildUUID);
            if (verifyGuild) {
                log.info('HANDLER', 'SAVE VERIFY: _level=' + verifyGuild._level +
                    ' _leftExp=' + verifyGuild._leftExp +
                    ' _memberLimit=' + (verifyGuild._memberLimit || '?'));
            } else {
                log.error('HANDLER', 'SAVE VERIFY FAILED: guild not found after save!');
            }

            if (result.leveledUp) {
                log.info('HANDLER', 'GUILD LEVEL UP! Lv' + result.oldLevel + ' -> Lv' + result.newLevel +
                    ' (memberLimit: ' + (GUILD_LEVEL[result.oldLevel] ? GUILD_LEVEL[result.oldLevel].memberNum : '?') +
                    ' -> ' + guild._memberLimit + ')');

                // Log benefits for each level gained
                for (var i = 0; i < result.levelUps.length; i++) {
                    var lu = result.levelUps[i];
                    var benefits = ['memberLimit=' + lu.memberNum];

                    // Check if any guildOpen feature unlocks at this level
                    for (var j = 1; j < GUILD_OPEN.length; j++) {
                        if (GUILD_OPEN[j] && GUILD_OPEN[j].level === lu.level) {
                            benefits.push('UNLOCK ' + GUILD_OPEN[j].nameNew);
                        }
                    }

                    log.info('HANDLER', '  Lv' + lu.level + ' benefit: ' + benefits.join(', '));
                }
            }
        } else {
            // Guild not in DB — we still return correct values to client
            // but can't persist. Log warning.
            log.warn('HANDLER', 'Cannot persist guild exp — guild not in guildList');
        }

        // ═══════════════════════════════════════════════════════════
        // _changeInfo._items: REWARD items ONLY (REMAINING counts)
        // ═══════════════════════════════════════════════════════════
        //
        // Client processing (L140749):
        //   ItemsCommonSingleton.openCommonItemGetTips(n._changeInfo._items, ...)
        //   → Shows reward popup displaying ALL items in _items as "rewards"
        //   → Then updates inventory via resetTtemsCallBack
        //
        // CRITICAL: ONLY put reward items here!
        //   openCommonItemGetTips shows every item as a gained reward.
        //   If cost item (diamond/gold) is included, it incorrectly shows
        //   as "you gained X diamonds!" — which is the OPPOSITE of what happened.
        //
        // Format: {String(itemId): {_id: itemId, _num: remainingCount}}
        // _num = item count in inventory AFTER the transaction
        //   NOT delta, NOT negative — absolute remaining count
        //
        // For sign-in, ONLY the reward item:
        //   - guildCoin (114): remaining = oldBalance + reg.rewardNum
        //
        // Cost deduction (gold/diamond) is handled server-side separately.
        // Draft server uses simulated reasonable balance.
        // ═══════════════════════════════════════════════════════════

        // Simulated current guildCoin balance (dummy value)
        var dummyGuildCoinBalance = 5000;

        // Build _items object — REWARD ONLY, no cost items!
        // Using bracket notation (ES5 compatible, NOT computed property names)
        var items = {};
        items[reg.rewardID] = {
            _id: reg.rewardID,
            _num: dummyGuildCoinBalance + reg.rewardNum  // remaining after addition
        };

        var changeInfo = {
            _items: items
        };

        // ═══════════════════════════════════════════════════════════
        // _guildLog: updated guild log ARRAY
        // ═══════════════════════════════════════════════════════════
        //
        // Client processing (L140749):
        //   TeamInfoManager.setTeamLog(n._guildLog)
        //
        // setTeamLog definition (L79582):
        //   CLEARS existing _logs array, then rebuilds from response:
        //   for (var n in e) {
        //       o._time = e[n]._time;
        //       o._info = e[n]._info;
        //       o._nickName = e[n]._nickName;
        //       o._type = e[n]._type;
        //       o._param2 = ReadJsonSingleton.getlanguage(e[n]._param2);
        //   }
        //
        // GuildLog POJO (L53721) — NOT Serializable:
        //   this._time = 0, this._info = "", this._nickName = "",
        //   this._type = GUILD_LOG_TYPE.OTHER
        //
        // _type MUST be GUILD_LOG_TYPE (1 or 2), NOT signType!
        // _param2: RAW language key, client translates via getlanguage()
        //
        // Note: Real server returns FULL log array (all existing + new entry).
        //       Draft server returns single new log entry.
        // ═══════════════════════════════════════════════════════════

        var nickName = getUserNickname(userId);

        var guildLog = [
            {
                _time: Date.now(),
                _type: logType,          // GUILD_LOG_TYPE: 1=GOLD_SIGN or 2=DIAMOND_SIGN
                _nickName: nickName,     // signer's nickname from DB
                _param2: reg.name         // language key: "guildRegister_name_1/2/3"
                                       // client translates via getlanguage()
            }
        ];

        // ═══════════════════════════════════════════════════════════
        // RESPONSE
        // ═══════════════════════════════════════════════════════════
        //
        // Fields consumed by client (L140747-140749):
        //
        // n._changeInfo._items  → reward popup + inventory update
        // n._guildLevel         → TeamInfoManager.setMyTeamLevel()
        //                         → this.myTeamInfo._level = n._guildLevel
        // n._guildLeftExp       → TeamInfoManager.setMyTeamExp()
        //                         → this.myTeamInfo._leftExp = n._guildLeftExp
        //                         → ACCUMULATED exp in current level
        //                         → displayed as "accumulated/expNeeded" (L139297)
        //                         → progress bar: scaleX = accumulated / expNeeded
        // n._guildLog           → TeamInfoManager.setTeamLog() (replaces ALL)
        // n._activePoint        → TeamInfoManager.changeActivePoint(userId, value)
        //                        → sets myTeamInfo._activePoints[userId] = value
        // ═══════════════════════════════════════════════════════════

        var response = {
            // Echo request fields
            type: 'guild',
            action: 'guildSign',
            userId: userId,
            guildUUID: guildUUID,
            signType: signType,
            version: request.version || '1.0',

            // Response data
            _changeInfo: changeInfo,
            _guildLevel: result.newLevel,         // guild level AFTER exp gain (from DB + calculation)
            _guildLeftExp: result.newLeftExp,     // accumulated exp AFTER gain (persisted)
            _activePoint: SIGN_ACTIVE_POINT,      // user's total active points (50 for Sign)
            _guildLog: guildLog                   // updated guild log array
        };

        log.info('HANDLER', 'guildSign -> guildLevel=' + response._guildLevel +
            ' guildLeftExp=' + response._guildLeftExp +
            ' expGained=' + expGained +
            ' activePoint=' + response._activePoint +
            ' logType=' + logType + ' (' + (logType === GUILD_LOG_TYPE.GOLD_SIGN ? 'GOLD_SIGN' : logType === GUILD_LOG_TYPE.DIAMOND_SIGN ? 'DIAMOND_SIGN' : 'OTHER') + ')' +
            (result.leveledUp ? ' LEVEL_UP!' : ''));
        log.details('_changeInfo._items', [
            ['reward(guildCoin ' + reg.rewardID + ')', 'remaining=' + (dummyGuildCoinBalance + reg.rewardNum)]
        ]);
        log.details('_guildLog[0]', [
            ['_time', String(guildLog[0]._time)],
            ['_type', String(guildLog[0]._type)],
            ['_nickName', guildLog[0]._nickName],
            ['_param2', guildLog[0]._param2]
        ]);

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'guildSign', handleGuildSign);

    window.MainServer = MainServer;
})();
