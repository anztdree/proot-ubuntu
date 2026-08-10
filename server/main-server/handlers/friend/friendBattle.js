/**
 * handlers/friend/friendBattle.js — Friend Battle (Sparring) Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══ CLIENT EVIDENCE (main.min.js) ═══
 *
 *   CALL SITE 1 — FriendInfo.friendBattleBtnTap (L64778-64791):
 *     Request: { type:"friend", action:"friendBattle", userId, friendId, team, "super", battleField:21 }
 *     Response read: t._battleId (L64788), t._rightTeam (L64789),
 *                    t._rightSuper (L64790), t._battleResult (L64791), t._rand
 *     Summary: items: void 0 (L64769) — ZERO reward
 *
 *   CALL SITE 2 — TeamworkFriendInfo (L64821-64835):
 *     Sama + friendServerId (optional, cross-server — ignored di mock)
 *
 *   CALL SITE 3 — maha/friendBattle (L63863) — BUKAN handler ini! (type="maha")
 *
 * ═══ RESPONSE FIELDS ═══
 *   _battleId     → string — unique ID (client saves to UserInfoSingleton, L64788)
 *   _battleResult → number — 0=WIN, 1=LOSE (L64791 → L64765 getBattleTypeWithResult)
 *   _rightTeam    → object — { "0":{...}, "1":{...} } enemy team (L64789)
 *   _rightSuper   → object — { "0":{_id,_level} } enemy super (L64790)
 *   _rand         → array  — random seed for battle engine (L64791)
 *
 *   TIDAK ADA: _changeInfo, _arena, _tasks — pure sparring, zero consequence
 *
 * ═══ DESIGN DECISIONS ═══
 *   - Win/lose: BATTLE SIMULATION — copy dari arena/startBattle.js (15 round combat)
 *   - Enemy team: reuse buildBotTeam() logic dari getFriendArenaDefenceTeam.js
 *   - Daily limit: UNLIMITED (sparring)
 *   - DB write: NONE (no state change)
 *   - Reward: NONE
 *   - Task tracking: NONE
 *
 * ═══ BATTLE SIMULATION — copy dari arena/startBattle.js L552-1017 ═══
 *   Server menjalankan battle simulation menggunakan _rand + team stats,
 *   menentukan pemenang: "siapa yang semua hero mati duluan".
 *   Bot polos: star 0, no equip, no passive, no awakening, skill level 1.
 *
 *   References:
 *     Client BattleLogic (main.min.js L4550-4865)
 *     constant.json: normalMana=50, beHitMana=10, beCriticalMana=20,
 *                    maxMana=100, startMana=50
 *     skill.json + skillEffectInstant.json: damage multipliers
 *     C_DEFUALT_ROUND_TOTAL=15, C_criticalDouble=1.3 (client L4648)
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var RET_CODES = {
        OK: 0,
        MISSING_PARAM: 10001,
        SERVER_ERROR: 99999
    };

    var DEFAULT_SUPER_SKILL_ID = 120561;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADERS (cached sync XHR)
    // ═══════════════════════════════════════════════════════════

    var _configCache = {};

    function _loadJson(url, label) {
        if (_configCache[url]) return _configCache[url];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _configCache[url] = JSON.parse(xhr.responseText);
            }
        } catch (e) {
            log.warn('FB', 'Failed to load ' + label + ' — ' + e.message);
        }
        return _configCache[url] || {};
    }

    function loadHeroCfg()           { return _loadJson('./resource/json/hero.json', 'hero.json'); }
    function loadHeroLevelAttrCfg()  { return _loadJson('./resource/json/heroLevelAttr.json', 'heroLevelAttr.json'); }
    function loadRobotPlayerCfg()    { return _loadJson('./resource/json/robotPlayer.json', 'robotPlayer.json'); }
    function loadSkillCfg()          { return _loadJson('./resource/json/skill.json', 'skill.json'); }
    function loadSkillEffectInstantCfg() { return _loadJson('./resource/json/skillEffectInstant.json', 'skillEffectInstant.json'); }
    function loadZPowerQualityParaCfg() { return _loadJson('./resource/json/zPowerQualityPara.json', 'zPowerQualityPara.json'); }

    // ═══════════════════════════════════════════════════════════
    //  BOT CONFIG — identik dengan getFriendArenaDefenceTeam.js
    // ═══════════════════════════════════════════════════════════

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

    var BOT_ROBOT_MAP = {
        'bot_warrior_01': '5001', 'bot_mage_02': '5002',
        'bot_archer_03': '5003', 'bot_tank_04': '5004',
        'bot_warrior_05': '5034', 'bot_mage_06': '5035',
        'bot_archer_07': '5036', 'bot_tank_08': '5037',
        'bot_assassin_09': '5038', 'bot_support_10': '5039',
        'bot_berserker_11': '5040', 'bot_paladin_12': '5041',
        'bot_druid_13': '5042', 'bot_necromancer_14': '5043',
        'bot_monk_15': '5044', 'bot_bard_16': '5045',
        'bot_summoner_17': '5046', 'bot_gunner_18': '5047',
        'bot_lancer_19': '5048', 'bot_samurai_20': '5049',
        'bot_ninja_21': '5050', 'bot_runemaster_22': '5051',
        'bot_spellblade_23': '5052', 'bot_warden_24': '5053',
        'bot_voidwalker_25': '5054', 'bot_flamewarden_26': '5123',
        'bot_frostmage_27': '5124', 'bot_stormcaller_28': '5125',
        'bot_shadowblade_29': '5126', 'bot_lightbringer_30': '5127'
    };

    function isBot(userId) {
        return BOT_IDS.indexOf(String(userId)) !== -1;
    }

    function getQualityPara(star) {
        var cfg = loadZPowerQualityParaCfg();
        var entry = cfg ? cfg[String(star)] : null;
        return entry ? (Number(entry.para) || 0.2) : 0.2;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENEMY TEAM BUILDERS — identik getFriendArenaDefenceTeam.js
    // ═══════════════════════════════════════════════════════════

    function lookupHero(heroId) {
        var heroCfg = loadHeroCfg();
        var idStr = String(heroId);
        if (heroCfg && heroCfg[idStr]) return heroCfg[idStr];
        if (heroCfg) {
            var keys = Object.keys(heroCfg);
            for (var k = 0; k < keys.length; k++) {
                if (Number(heroCfg[keys[k]].id) === Number(heroId)) {
                    return heroCfg[keys[k]];
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
     * Hitung attrs untuk hero — formula identik getFriendArenaDefenceTeam.js
     * Returns ARRAY [{_id, _num}, ...]
     * @see getFriendArenaDefenceTeam.js L183-278
     */
    function computeAttrs(heroId, level) {
        var heroData = lookupHero(heroId);
        if (!heroData) {
            heroData = { id: heroId, heroType: 'strength', type: 'strength',
                balanceHp: 1, balanceAttack: 1, balanceArmor: 1,
                speed: 180, energyMax: 100 };
        }

        var lvlAttrCfg = loadHeroLevelAttrCfg();
        var lvlData = lvlAttrCfg ? lvlAttrCfg[String(level)] : null;
        if (!lvlData) {
            lvlData = lvlAttrCfg ? lvlAttrCfg['1'] : { hp: 1240, attack: 125, armor: 205 };
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

    function buildTeamEntry(heroId, level) {
        var attrs = computeAttrs(heroId, level);
        var power = 0;
        for (var i = 0; i < attrs.length; i++) {
            if (attrs[i]._id === 21) { power = attrs[i]._num; break; }
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

    function buildBotTeam(botId) {
        var robotPlayerData = loadRobotPlayerCfg();
        var roboEntryId = BOT_ROBOT_MAP[botId];
        if (!roboEntryId || !robotPlayerData || !robotPlayerData[roboEntryId]) {
            log.warn('FB', 'No team config for bot ' + botId + ', using fallback');
            return { "0": buildTeamEntry(1001, 10) };
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

    // ═══════════════════════════════════════════════════════════
    //  BATTLE SIMULATION — copy dari arena/startBattle.js L552-1017
    // ═══════════════════════════════════════════════════════════
    //
    //  Server menjalankan battle simulation menggunakan _rand + team stats,
    //  menentukan pemenang: "siapa yang semua hero mati duluan".
    //  Bot polos: star 0, no equip, no passive, no awakening, skill level 1.
    //
    //  Random consumption per target (polos = 3 randoms):
    //    1. getOneRandom() → dodge check
    //    2. getOneRandom() → block check
    //    3. getOneRandom() → critical check
    //

    function generateRandArray(count) {
        var arr = [];
        for (var i = 0; i < count; i++) {
            arr.push(Math.round(1E5 * Math.random()) / 1E5);
        }
        return arr;
    }

    /**
     * Get damage multiplier for a skill at given level.
     * @see arena/startBattle.js L585-617
     */
    function getDamageMultiplier(skillId, skillLevel) {
        if (!skillId) return 1.0;
        var skillCfg = loadSkillCfg();
        var skillData = skillCfg && skillCfg[String(skillId)];
        if (!skillData || !skillData.eventTrigger) return 1.0;
        for (var g = 0; g < skillData.eventTrigger.length; g++) {
            var group = skillData.eventTrigger[g];
            if (!Array.isArray(group)) continue;
            for (var a = 0; a < group.length; a++) {
                var action = group[a];
                if (action && action.effectInstant) {
                    var effCfg = loadSkillEffectInstantCfg();
                    var eff = effCfg && effCfg[String(action.effectInstant)];
                    if (eff && eff.effect === 'damageAttack' && eff.keyValue2) {
                        var parts = String(eff.keyValue2).split(',');
                        for (var p = 0; p < parts.length; p++) {
                            var kv = parts[p].split(':');
                            if (Number(kv[0]) === skillLevel) {
                                return Number(kv[1]) || 1.0;
                            }
                        }
                        if (parts.length > 0) {
                            var first = parts[0].split(':');
                            return Number(first[1]) || 1.0;
                        }
                    }
                }
            }
        }
        return 1.0;
    }

    /**
     * Extract battle stat from _attrs._items by attr ID.
     * _items format: object keyed by string ID.
     * @see arena/startBattle.js L625-629
     */
    function getAttrNum(attrs, id) {
        if (!attrs || !attrs._items) return 0;
        var items = attrs._items;
        // Support both object format (keyed) and array format
        if (Array.isArray(items)) {
            for (var i = 0; i < items.length; i++) {
                if (Number(items[i]._id) === id) return Number(items[i]._num) || 0;
            }
        } else {
            var entry = items[String(id)];
            return entry ? (Number(entry._num) || 0) : 0;
        }
        return 0;
    }

    /**
     * Build player hero battle data for simulation.
     * Tries pre-computed _attrs (most accurate), fallback _heroBaseAttr, fallback formula.
     * @see arena/startBattle.js L640-792
     */
    function buildPlayerHeroBattleData(foundHero, pos) {
        var heroCfg = loadHeroCfg();
        var lvlAttrCfg = loadHeroLevelAttrCfg();

        var displayId = Number(foundHero._heroDisplayId || foundHero.heroDisplayId
                          || foundHero._heroId || foundHero.heroId) || 0;
        var level = Number((foundHero._heroBaseAttr && foundHero._heroBaseAttr._level)
                           || foundHero._heroLevel || foundHero.level) || 1;
        var star = Number(foundHero._heroStar || foundHero.star) || 0;

        var heroData = heroCfg && heroCfg[String(displayId)];
        if (!heroData) {
            log.warn('FB_SIM', 'Player hero displayId ' + displayId + ' not in hero.json');
            return null;
        }

        var attrs = foundHero._attrs;
        var hasAttrs = attrs && attrs._items && Object.keys(attrs._items).length > 0;

        var hp, atk, armor, speed, hit, dodge, block, blockEffect;
        var crit, critDmg, critResist, critDmgResist, blockThrough, energyMax;

        if (hasAttrs) {
            hp = getAttrNum(attrs, 0);
            atk = getAttrNum(attrs, 1);
            armor = getAttrNum(attrs, 2);
            speed = getAttrNum(attrs, 3);
            hit = getAttrNum(attrs, 4);
            dodge = getAttrNum(attrs, 5);
            block = getAttrNum(attrs, 6);
            blockEffect = getAttrNum(attrs, 7);
            crit = getAttrNum(attrs, 9);
            critResist = getAttrNum(attrs, 10);
            critDmg = getAttrNum(attrs, 11);
            critDmgResist = getAttrNum(attrs, 36);
            blockThrough = getAttrNum(attrs, 37);
            energyMax = getAttrNum(attrs, 41) || 100;
        } else if (foundHero._heroBaseAttr) {
            var ba = foundHero._heroBaseAttr;
            hp = Number(ba._hp) || 0;
            atk = Number(ba._attack) || 0;
            armor = Number(ba._armor) || 0;
            speed = Number(ba._speed) || 180;
            hit = Number(ba._hit) || 0;
            dodge = Number(ba._dodge) || 0;
            block = Number(ba._block) || 0;
            blockEffect = Number(ba._blockEffect) || 0;
            crit = Number(ba._critical) || 0;
            critResist = Number(ba._criticalResist) || 0;
            critDmg = Number(ba._criticalDamage) || 0;
            critDmgResist = 0;
            blockThrough = 0;
            energyMax = Number(ba._energy) || 100;
            level = Number(ba._level) || 1;
        } else {
            var lvlData = lvlAttrCfg && lvlAttrCfg[String(level)];
            if (!lvlData) {
                lvlData = lvlAttrCfg && lvlAttrCfg['1'];
                if (!lvlData) return null;
            }
            var laHp = Number(lvlData.hp) || 1240;
            var laArmor = Number(lvlData.armor) || 205;
            var heroType = heroData.heroType || heroData.type || 'strength';
            var typeCategory;
            if (heroType === 'critical' || heroType === 'criticalSingle' || heroType === 'hit') {
                typeCategory = 'ATK';
            } else if (heroType === 'body' || heroType === 'block' || heroType === 'dodge' ||
                       heroType === 'armor' || heroType === 'armorS' || heroType === 'bodyDamage') {
                typeCategory = 'TANK';
            } else {
                typeCategory = 'SKL';
            }
            var qualityPara = getQualityPara(star > 0 ? star : 1);
            if (typeCategory === 'SKL') {
                hp = Math.floor(laHp / 2 - 240) * qualityPara;
                atk = (13 * level + 47) * qualityPara;
                hit = level / 14000; crit = hit * 2.5; critDmg = crit * 1.5;
                dodge = 0; block = 0; blockEffect = 0; critResist = 0;
            } else if (typeCategory === 'ATK') {
                hp = Math.floor(laHp / 2 - 14 * level - 290) * qualityPara;
                atk = Math.round(12.25 * level + 51) * qualityPara;
                hit = level / 2000; crit = hit * 0.5; critDmg = 0.3;
                dodge = 0; block = 0; blockEffect = 0; critResist = 0;
            } else {
                hp = Math.floor(laHp / 2 + 412) * qualityPara;
                atk = Math.round(9 * level + 1) * qualityPara;
                hit = level / 3043; crit = hit * 0.5; critDmg = hit;
                dodge = level / 2500; block = level / 8000; blockEffect = 0;
                critResist = level / 6667;
            }
            armor = laArmor - 21;
            speed = Number(heroData.speed) || 180;
            critDmgResist = 0; blockThrough = 0;
            energyMax = Number(heroData.energyMax) || 100;
        }

        var normalDmgMult = 1.0, skillDmgMult = 1.3;
        if (heroData.normal) normalDmgMult = getDamageMultiplier(Number(heroData.normal), 1);
        if (heroData.skill)  skillDmgMult  = getDamageMultiplier(Number(heroData.skill), 1);
        var normalSkillData = heroData.normal && (loadSkillCfg() || {})[String(heroData.normal)];
        var accuracy = (normalSkillData && Number(normalSkillData.accuracy)) || 1;

        return {
            pos: pos, hp: hp, maxHp: hp, atk: atk, armor: armor, speed: speed,
            hit: hit, dodge: dodge, block: block, blockEffect: blockEffect,
            crit: crit, critDmg: critDmg, critResist: critResist,
            critDmgResist: critDmgResist, blockThrough: blockThrough,
            level: level, energy: 50, maxEnergy: 100,
            normalDmgMult: normalDmgMult, skillDmgMult: skillDmgMult,
            accuracy: accuracy, alive: true
        };
    }

    /**
     * Build enemy (bot) hero battle data from _rightTeam entry.
     * @see arena/startBattle.js L802-851
     */
    function buildEnemyHeroBattleData(rightTeamEntry, pos) {
        if (!rightTeamEntry || !rightTeamEntry._attrs || !rightTeamEntry._attrs._items) return null;

        var displayId = rightTeamEntry._heroDisplayId;
        var heroCfg = loadHeroCfg();
        var heroData = heroCfg && heroCfg[String(displayId)];

        var normalDmgMult = 1.0, skillDmgMult = 1.3, accuracy = 1;
        if (heroData) {
            if (heroData.normal) normalDmgMult = getDamageMultiplier(Number(heroData.normal), 1);
            if (heroData.skill)  skillDmgMult  = getDamageMultiplier(Number(heroData.skill), 1);
            var normalSkillData = heroData.normal && (loadSkillCfg() || {})[String(heroData.normal)];
            accuracy = (normalSkillData && Number(normalSkillData.accuracy)) || 1;
        }

        return {
            pos: pos,
            hp: getAttrNum(rightTeamEntry._attrs, 0),
            maxHp: getAttrNum(rightTeamEntry._attrs, 22) || getAttrNum(rightTeamEntry._attrs, 0),
            atk: getAttrNum(rightTeamEntry._attrs, 1),
            armor: getAttrNum(rightTeamEntry._attrs, 2),
            speed: getAttrNum(rightTeamEntry._attrs, 3),
            hit: getAttrNum(rightTeamEntry._attrs, 4),
            dodge: getAttrNum(rightTeamEntry._attrs, 5),
            block: getAttrNum(rightTeamEntry._attrs, 6),
            blockEffect: getAttrNum(rightTeamEntry._attrs, 7),
            crit: getAttrNum(rightTeamEntry._attrs, 9),
            critResist: getAttrNum(rightTeamEntry._attrs, 10),
            critDmg: getAttrNum(rightTeamEntry._attrs, 11),
            critDmgResist: getAttrNum(rightTeamEntry._attrs, 36),
            blockThrough: getAttrNum(rightTeamEntry._attrs, 37),
            level: rightTeamEntry._heroLevel || 1,
            energy: 50, maxEnergy: 100,
            normalDmgMult: normalDmgMult, skillDmgMult: skillDmgMult,
            accuracy: accuracy, alive: true
        };
    }

    /**
     * Server-side battle simulation — IDENTIK arena/startBattle.js L862-1017.
     * 15 round combat, speed-based turn order, dodge/block/crit, mana/skill system.
     * @returns {number} 0 = player WIN, 1 = player LOSE
     */
    function simulateBattle(playerHeroes, enemyHeroes, randArray) {
        var MAX_ROUND = 15;
        var CRIT_DOUBLE = 1.3;
        var START_MANA = 50;
        var MAX_MANA = 100;
        var NORMAL_MANA_GAIN = 50;
        var BE_HIT_MANA = 10;
        var BE_CRIT_MANA = 20;

        var randIdx = 0;
        var RAND_SIZE = randArray.length;

        function nextRand() {
            var r = randArray[randIdx % RAND_SIZE];
            randIdx++;
            return r;
        }

        var allHeroes = [];
        for (var i = 0; i < playerHeroes.length; i++) {
            if (!playerHeroes[i]) continue;
            playerHeroes[i].team = 'player';
            allHeroes.push(playerHeroes[i]);
        }
        for (var j = 0; j < enemyHeroes.length; j++) {
            if (!enemyHeroes[j]) continue;
            enemyHeroes[j].team = 'enemy';
            allHeroes.push(enemyHeroes[j]);
        }

        function getAliveOfTeam(teamTag) {
            var alive = [];
            for (var i = 0; i < allHeroes.length; i++) {
                if (allHeroes[i].team === teamTag && allHeroes[i].alive) alive.push(allHeroes[i]);
            }
            return alive;
        }

        function teamAllDead(teamTag) {
            for (var i = 0; i < allHeroes.length; i++) {
                if (allHeroes[i].team === teamTag && allHeroes[i].alive) return false;
            }
            return true;
        }

        function sortBySpeed() {
            allHeroes.sort(function (a, b) {
                if (!a.alive && !b.alive) return 0;
                if (!a.alive) return 1;
                if (!b.alive) return -1;
                return b.speed - a.speed;
            });
        }

        for (var round = 1; round <= MAX_ROUND; round++) {
            sortBySpeed();
            if (teamAllDead('player')) return 1;
            if (teamAllDead('enemy'))  return 0;

            for (var h = 0; h < allHeroes.length; h++) {
                var hero = allHeroes[h];
                if (!hero.alive) continue;

                var targets = (hero.team === 'player')
                    ? getAliveOfTeam('enemy')
                    : getAliveOfTeam('player');
                if (targets.length === 0) break;
                var target = targets[0];

                var dmgMult;
                if (hero.energy >= MAX_MANA && hero.skillDmgMult > 0) {
                    dmgMult = hero.skillDmgMult;
                    hero.energy = 0;
                } else {
                    dmgMult = hero.normalDmgMult;
                    hero.energy = Math.min(hero.energy + NORMAL_MANA_GAIN, MAX_MANA);
                }

                // Random 1: DODGE check
                var dodgeRand = nextRand();
                var accuracy = Math.min(Math.max(1 + hero.hit - target.dodge, 0.2), 1) * hero.accuracy;
                if (dodgeRand > accuracy) {
                    nextRand(); nextRand(); // consume block + crit
                    continue;
                }

                // Random 2: BLOCK check
                var blockRand = nextRand();
                var blockRate = Math.max(target.block - hero.blockThrough, 0);
                var isBlocked = (blockRand <= blockRate);

                // Random 3: CRITICAL check
                var critRand = nextRand();
                var critRate = Math.max(hero.crit - target.critResist, 0);
                var isCrit = (critRand <= critRate);

                // Armor reduction
                var lvlDiff = Math.max(0, target.level - 200);
                var levelFactor = 1500 + (550 + Math.pow(lvlDiff, 1.25)) * target.level;
                var armorReduction = target.armor / levelFactor;
                armorReduction = Math.min(armorReduction, 0.7);

                var damage = hero.atk * dmgMult * (1 - armorReduction);

                if (isCrit) {
                    var critMult = Math.max(CRIT_DOUBLE + hero.critDmg - target.critDmgResist, 1);
                    damage *= critMult;
                }
                if (isBlocked) {
                    damage *= Math.max(0.7 - target.blockEffect, 0);
                }

                damage = Math.max(Math.floor(damage), 1);
                target.hp -= damage;

                var energyGain = isCrit ? BE_CRIT_MANA : BE_HIT_MANA;
                target.energy = Math.min(target.energy + energyGain, MAX_MANA);

                if (target.hp <= 0) {
                    target.hp = 0;
                    target.alive = false;
                }

                if (teamAllDead('player')) return 1;
                if (teamAllDead('enemy'))  return 0;
            }
        }

        return 1; // Timeout → LOSE
    }

    // ═══════════════════════════════════════════════════════════
    //  MISC HELPERS
    // ═══════════════════════════════════════════════════════════

    function generateBattleId() {
        return Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('friend', 'friendBattle', function (request, callback) {
        try {
            var userId = request.userId;
            var friendId = request.friendId;

            // ═══ VALIDASI ═══
            if (!userId || !friendId) {
                log.warn('FB', 'Missing userId or friendId');
                callback({}, RET_CODES.MISSING_PARAM);
                return;
            }

            log.info('FB', 'Processing userId=' + userId + ' friendId=' + friendId +
                (request.friendServerId ? ' crossServer=' + request.friendServerId : ''));

            // ═══ 0) READ PLAYER DATA ═══
            var savedData = db._get('ms_user_' + userId + '_1');
            var playerHeros = (savedData && savedData.heros && savedData.heros._heros)
                            || (savedData && savedData._heros) || null;

            // ═══ 1) BUILD ENEMY TEAM — reuse getFriendArenaDefenceTeam logic ═══
            var rightTeam;

            if (isBot(friendId)) {
                rightTeam = buildBotTeam(friendId);
            } else {
                var friendData = db._get('ms_user_' + friendId + '_1');
                if (friendData && friendData._arenaTeam && Array.isArray(friendData._arenaTeam)) {
                    var arenaTeam = friendData._arenaTeam;
                    rightTeam = {};
                    for (var i = 0; i < 5; i++) {
                        var slot = arenaTeam[i];
                        if (!slot || !slot._id) continue;
                        var hId = Number(slot._id);
                        var friendLevel = 1;
                        if (friendData.totalProps && friendData.totalProps._items) {
                            var items = friendData.totalProps._items;
                            for (var jj = 0; jj < items.length; jj++) {
                                if (Number(items[jj]._id) === 104) {
                                    friendLevel = Number(items[jj]._num) || 1;
                                    break;
                                }
                            }
                        }
                        rightTeam[String(i)] = buildTeamEntry(hId, friendLevel);
                    }
                } else {
                    log.warn('FB', 'Real user ' + friendId + ' has no arena team, fallback to bot');
                    rightTeam = buildBotTeam(BOT_IDS[Math.floor(Math.random() * BOT_IDS.length)]);
                }
            }

            var enemyHeroCount = 0;
            for (var k in rightTeam) { if (rightTeam.hasOwnProperty(k)) enemyHeroCount++; }

            // ═══ 2) BUILD ENEMY SUPER SKILL ═══
            var rightSuper = { "0": { _id: DEFAULT_SUPER_SKILL_ID, _level: 1 } };

            // ═══ 3) GENERATE RANDOM SEED (100 floats 0-1, SAME array for sim + client) ═══
            var randArray = generateRandArray(100);

            // ═══ 4) BUILD PLAYER BATTLE DATA — from savedData.heros._heros ═══
            var playerBattleHeroes = [];
            if (request.team && Array.isArray(request.team) && playerHeros) {
                for (var pi = 0; pi < request.team.length; pi++) {
                    var pSlot = request.team[pi];
                    if (!pSlot || !pSlot.heroId) continue;
                    var pInstId = String(pSlot.heroId);
                    var pFound = null;
                    for (var phk in playerHeros) {
                        if (!playerHeros.hasOwnProperty(phk)) continue;
                        if (phk === pInstId) { pFound = playerHeros[phk]; break; }
                    }
                    if (pFound) {
                        var pbData = buildPlayerHeroBattleData(pFound, pi);
                        if (pbData) playerBattleHeroes.push(pbData);
                    } else {
                        log.warn('FB_SIM', 'Hero instance ' + pInstId + ' not found in player inventory');
                    }
                }
            }

            // ═══ 5) BUILD ENEMY BATTLE DATA — from rightTeam entries ═══
            var enemyBattleHeroes = [];
            for (var ep in rightTeam) {
                if (!rightTeam.hasOwnProperty(ep)) continue;
                var ebData = buildEnemyHeroBattleData(rightTeam[ep], Number(ep));
                if (ebData) enemyBattleHeroes.push(ebData);
            }

            // ═══ 6) RUN BATTLE SIMULATION ═══
            var battleResult;
            if (playerBattleHeroes.length === 0 || enemyBattleHeroes.length === 0) {
                battleResult = 1; // LOSE if no heroes
                log.warn('FB_SIM', 'No heroes — player=' + playerBattleHeroes.length +
                    ' enemy=' + enemyBattleHeroes.length);
            } else {
                battleResult = simulateBattle(playerBattleHeroes, enemyBattleHeroes, randArray);
            }

            log.info('FB_SIM', 'Simulation complete — ' +
                (battleResult === 0 ? 'WIN' : 'LOSE') +
                ' playerHeroes=' + playerBattleHeroes.length +
                ' enemyHeroes=' + enemyBattleHeroes.length);

            // ═══ 7) GENERATE BATTLE ID ═══
            var battleId = generateBattleId();

            // ═══ 8) BUILD RESPONSE ═══
            var response = {
                _battleId: battleId,
                _battleResult: battleResult,
                _rightTeam: rightTeam,
                _rightSuper: rightSuper,
                _rand: randArray
            };

            log.info('FB', 'Response ready — ' +
                (battleResult === 0 ? 'WIN' : 'LOSE') +
                ' enemyHeroes=' + enemyHeroCount);

            // ═══ 9) CALLBACK — NO DB WRITE ═══
            callback(response);

        } catch (err) {
            log.error('FB', 'friend/friendBattle UNCAUGHT ERROR', err);
            callback({}, RET_CODES.SERVER_ERROR);
        }
    });

    window.MainServer = MainServer;

})();