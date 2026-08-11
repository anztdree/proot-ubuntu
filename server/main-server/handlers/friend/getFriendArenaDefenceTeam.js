/**
 * handlers/friend/getFriendArenaDefenceTeam.js
 * Super Warrior Z — MAIN SERVER
 *
 * ═══ CLIENT CALL SITES (main.min.js) ═══
 *   - showFriendInfo (L84210) → opens FriendInfo window
 *   - showBlacklistFriendInfo (L84241) → opens BlacklistPlayerInfo
 *   - getOtherPlayerArenaHeroInfo (L84266) → builds ArenaOtherTeam for battle
 *   - mine/requestBattle (L105590) → opens AdventureEnemyInfo popup (PvP mine)
 *
 * ═══ REQUEST ═══
 *   { type:"friend", action:"getFriendArenaDefenceTeam", userId, friendId,
 *     queryServerId?:number, realTime?:boolean, version:"1.0" }
 *
 * ═══ RESPONSE ═══
 *   {
 *     _userBasic: { _nickName, _headImage, _headEffect, _headBox,
 *                   _level, _vip, _guildName, _oriServerId },
 *     _team: { "0": { _heroDisplayId, _heroStar, _heroLevel, _power,
 *                     _id, _heroId, _skinId, _weaponHaloId, _weaponHaloLevel,
 *                     _attrs: { _items: [{_id, _num}, ...] } } },
 *     _lastDenfenceSuperSkill: { "0": { _id: 120561, _level: 1 } },
 *     friendId: string
 *   }
 *
 * ═══ RESOURCES ═══
 *   - hero.json → hero type, balanceHp, speed, skills
 *   - heroLevelAttr.json → base HP/ATK/Armor per level
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var _resourceCache = {};

    function loadJsonSync(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
            log.warn('FRIEND_DEF', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('FRIEND_DEF', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    var heroesData = loadJsonSync('hero');
    var levelAttrData = loadJsonSync('heroLevelAttr');
    var robotPlayerData = loadJsonSync('robotPlayer');

    var ITEM_IDS = {
        PLAYERLEVELID: 104,
        PLAYERVIPLEVELID: 106
    };

    // Default super skill — green quality, basic
    var DEFAULT_SUPER_SKILL_ID = 120561;

    // Bot IDs & profiles (match recommendFriend.js)
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

    // ── Robot config mapping ──
    // Map bot ke robotPlayer.json entry ID untuk team defense
    var BOT_ROBOT_MAP = {
        // Tier Rendah — config Lv20, hero Lv10
        'bot_warrior_01': '5001',
        'bot_mage_02':    '5002',
        'bot_archer_03':  '5003',
        'bot_tank_04':    '5004',
        // Tier Menengah — config Lv30, hero Lv30
        'bot_warrior_05':    '5034',
        'bot_mage_06':       '5035',
        'bot_archer_07':     '5036',
        'bot_tank_08':       '5037',
        'bot_assassin_09':   '5038',
        'bot_support_10':    '5039',
        'bot_berserker_11':  '5040',
        'bot_paladin_12':    '5041',
        'bot_druid_13':      '5042',
        'bot_necromancer_14': '5043',
        'bot_monk_15':       '5044',
        'bot_bard_16':       '5045',
        'bot_summoner_17':   '5046',
        'bot_gunner_18':     '5047',
        'bot_lancer_19':     '5048',
        'bot_samurai_20':    '5049',
        'bot_ninja_21':      '5050',
        // Tier Menengah Atas — config Lv30, hero Lv30 (hero 1400-series)
        'bot_runemaster_22':  '5051',
        'bot_spellblade_23': '5052',
        'bot_warden_24':     '5053',
        'bot_voidwalker_25': '5054',
        // Tier Tinggi — config Lv40, hero Lv40
        'bot_flamewarden_26':  '5123',
        'bot_frostmage_27':    '5124',
        'bot_stormcaller_28':  '5125',
        'bot_shadowblade_29':  '5126',
        'bot_lightbringer_30': '5127'
    };

    function isBot(userId) {
        return BOT_IDS.indexOf(String(userId)) !== -1;
    }

    function lookupHero(heroId) {
        var idStr = String(heroId);
        if (heroesData && heroesData[idStr]) return heroesData[idStr];
        if (heroesData) {
            var keys = Object.keys(heroesData);
            for (var k = 0; k < keys.length; k++) {
                if (Number(heroesData[keys[k]].id) === Number(heroId)) {
                    return heroesData[keys[k]];
                }
            }
        }
        return null;
    }

    function getTypeCategory(heroType) {
        if (heroType === 'critical' || heroType === 'criticalSingle' || heroType === 'hit') return 'ATK';
        if (heroType === 'body' || heroType === 'block' || heroType === 'dodge' ||
            heroType === 'armor' || heroType === 'armorS' || heroType === 'bodyDamage') return 'TANK';
        return 'SKL';
    }

    /**
     * Hitung attrs untuk hero enemy — formula sama dengan dungeon.
     * Returns ARRAY [{_id, _num}, ...] karena client baca _attrs._items[index]
     */
    function computeAttrs(heroId, level) {
        var heroData = lookupHero(heroId);
        if (!heroData) {
            heroData = { id: heroId, heroType: 'strength', type: 'strength',
                balanceHp: 1, balanceAttack: 1, balanceArmor: 1,
                speed: 180, energyMax: 100 };
        }

        var lvlData = levelAttrData ? levelAttrData[String(level)] : null;
        if (!lvlData) {
            lvlData = levelAttrData ? levelAttrData['1'] : { hp: 1240, attack: 125, armor: 205 };
        }

        var laHp = Number(lvlData.hp) || 1240;
        var laArmor = Number(lvlData.armor) || 205;
        var heroType = heroData.heroType || heroData.type || 'strength';
        var typeCat = getTypeCategory(heroType);

        var hpBase, atkBase;
        if (typeCat === 'SKL') {
            hpBase = Math.floor(laHp / 2 - 240);
            atkBase = 13 * level + 47;
        } else if (typeCat === 'ATK') {
            hpBase = Math.floor(laHp / 2 - 14 * level - 290);
            atkBase = Math.round(12.25 * level + 51);
        } else {
            hpBase = Math.floor(laHp / 2 + 412);
            atkBase = Math.round(9 * level + 1);
        }

        // difficulty multiplier = 1 (standar)
        var finalHp = hpBase;
        var finalAtk = atkBase;
        var finalArmor = laArmor - 21;
        var speed = Number(heroData.speed) || 180;

        var hit, crit, critDmg, dodge, block, critResist;
        if (typeCat === 'SKL') {
            hit = level / 14000;
            crit = hit * 2.5;
            critDmg = crit * 1.5;
            dodge = 0; block = 0; critResist = 0;
        } else if (typeCat === 'ATK') {
            hit = level / 2000;
            crit = hit * 0.5;
            critDmg = 0.3;
            dodge = 0; block = 0; critResist = 0;
        } else {
            hit = level / 3043;
            crit = hit * 0.5;
            critDmg = hit;
            dodge = level / 2500;
            block = level / 8000;
            critResist = level / 6667;
        }

        var balancePower = Number(heroData.balancePower) || 1;
        var ATK_W = { critical:20, criticalSingle:20, hit:20, skill:15, body:15,
            block:15, armor:15, armorDamage:15, armorS:15, bodyDamage:15,
            dodge:15, strength:15, dot:15 };
        var atkW = ATK_W[heroType] || 15;
        var power = Math.floor(finalHp * balancePower + finalAtk * atkW + finalArmor);

        // Return sebagai ARRAY — client baca _attrs._items[index]
        return [
            { _id: 0,  _num: finalHp },
            { _id: 1,  _num: finalAtk },
            { _id: 2,  _num: finalArmor },
            { _id: 3,  _num: speed },
            { _id: 4,  _num: hit },
            { _id: 5,  _num: dodge },
            { _id: 6,  _num: block },
            { _id: 7,  _num: 0 },
            { _id: 8,  _num: 0 },
            { _id: 9,  _num: crit },
            { _id: 10, _num: critResist },
            { _id: 11, _num: critDmg },
            { _id: 12, _num: 0 },
            { _id: 13, _num: 0 },
            { _id: 14, _num: 0 },
            { _id: 15, _num: 0 },
            { _id: 16, _num: 50 },
            { _id: 21, _num: power },
            { _id: 22, _num: finalHp },
            { _id: 23, _num: 0 },
            { _id: 24, _num: 0 },
            { _id: 25, _num: 0 },
            { _id: 26, _num: 0 },
            { _id: 28, _num: 0 },
            { _id: 29, _num: 0 },
            { _id: 31, _num: 0 },
            { _id: 36, _num: 0 },
            { _id: 37, _num: 0 },
            { _id: 41, _num: Number(heroData.energyMax) || 100 }
        ];
    }

    /**
     * Build hero entry untuk _team[position].
     * Format: { _heroDisplayId, _heroStar, _heroLevel, _power,
     *           _id, _heroId, _skinId, _weaponHaloId, _weaponHaloLevel,
     *           _attrs: { _items: [...] } }
     */
    function buildTeamEntry(heroId, level) {
        var attrs = computeAttrs(heroId, level);
        var power = 0;
        for (var i = 0; i < attrs.length; i++) {
            if (attrs[i]._id === 21) {
                power = attrs[i]._num;
                break;
            }
        }

        return {
            _heroDisplayId: heroId,
            _heroStar: 0,
            _heroLevel: level,
            _power: power,
            _id: String(heroId),
            _heroId: String(heroId),
            _skinId: 0,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _attrs: { _items: attrs }
        };
    }

    /**
     * Build bot team berdasarkan BOT_TEAMS config.
     */
    function buildBotTeam(botId) {
        var roboEntryId = BOT_ROBOT_MAP[botId];
        if (!roboEntryId || !robotPlayerData || !robotPlayerData[roboEntryId]) {
            log.warn('FRIEND_DEF', 'No team config for bot ' + botId);
            return {};
        }

        var entry = robotPlayerData[roboEntryId];
        var heroIds = (entry.enemyList || '').split(',');
        var heroLevels = (entry.enemyLevel || '').split(',');

        var team = {};
        for (var i = 0; i < 5 && i < heroIds.length; i++) {
            var hId = Number(heroIds[i]);
            var hLv = Number(heroLevels[i]) || 1;
            if (!hId) continue;
            team[String(i)] = buildTeamEntry(hId, hLv);
        }
        return team;
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
     * Build _userBasic untuk real user (dari DB).
     */
    function getUserProfile(userId) {
        if (isBot(userId)) {
            return BOT_PROFILES[userId] || {
                _nickName: 'Bot', _headImage: 'hero_icon_1205', _headEffect: 0, _headBox: 0,
                _oriServerId: 1, _serverId: 1, _level: 1, _vip: 0, _online: true
            };
        }
        var storageKey = 'ms_user_' + userId + '_1';
        var userData = db._get(storageKey);
        var level = 1, vip = 0;
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
            _nickName: 'Player', _headImage: 'hero_icon_1205',
            _headEffect: 0, _headBox: 0, _oriServerId: 1, _serverId: 1,
            _level: level, _vip: vip, _online: true
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('friend', 'getFriendArenaDefenceTeam', function (request, callback) {
        var userId = request.userId;
        var friendId = request.friendId;

        if (!userId || !friendId) {
            log.warn('FRIEND_DEF', 'Missing userId or friendId');
            callback({}, 1);
            return;
        }

        log.info('FRIEND_DEF', 'Processing userId=' + userId + ' friendId=' + friendId);

        // ── 1) Build _userBasic ──
        var userBasic = getUserProfile(friendId);

        // ── 2) Build _team ──
        var team = {};

        if (isBot(friendId)) {
            // Bot path — from hardcoded team config
            team = buildBotTeam(friendId);
        } else {
            // Real user path — from savedData._arenaTeam
            var friendData = db._get('ms_user_' + friendId + '_1');
            if (friendData) {
                var arenaTeam = friendData._arenaTeam;
                if (arenaTeam && Array.isArray(arenaTeam)) {
                    for (var i = 0; i < 5; i++) {
                        var slot = arenaTeam[i];
                        if (!slot || !slot._id) continue;
                        var hId = Number(slot._id);
                        team[String(i)] = buildTeamEntry(hId, userBasic._level || 1);
                    }
                }
            }
        }

        // ── 3) Build _lastDenfenceSuperSkill ──
        var superSkill = { "0": { _id: DEFAULT_SUPER_SKILL_ID, _level: 1 } };

        // ── 4) Build response ──
        var resp = {
            _userBasic: userBasic,
            _team: team,
            _lastDenfenceSuperSkill: superSkill,
            friendId: friendId
        };

        var heroCount = 0;
        for (var k in team) heroCount++;

        log.info('FRIEND_DEF', 'OK friend=' + friendId +
            ' nick=' + userBasic._nickName +
            ' lv=' + userBasic._level +
            ' heroes=' + heroCount +
            ' isBot=' + (isBot(friendId) ? 'yes' : 'no'));

        callback(resp, 0);
    });

})();
