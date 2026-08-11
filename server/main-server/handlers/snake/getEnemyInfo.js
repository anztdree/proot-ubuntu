/**
 * handlers/snake/getEnemyInfo.js — Snake Dungeon Enemy Info Handler
 * Super Warrior Z — MAIN SERVER
 *
 * Bot players dengan team pre-built.
 * Setiap floor punya bot固定 dengan hero team yang sama.
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var SNAKE_HERO_LEVEL = 40;
    var SNAKE_DUNGEON_MAX_LESSON = 10;

    // ═══════════════════════════════════════════════════════════
    //  BOT PLAYERS — 10 bots, 1 per floor
    // ═══════════════════════════════════════════════════════════

    var SNAKE_BOTS = {
        1:  { name: 'Enemy Floor 1',  heroes: [1201, 1202, 1206, 1207, 1209] },
        2:  { name: 'Enemy Floor 2',  heroes: [1201, 1202, 1206, 1301, 1302] },
        3:  { name: 'Enemy Floor 3',  heroes: [1301, 1302, 1305, 1307, 1308] },
        4:  { name: 'Enemy Floor 4',  heroes: [1301, 1302, 1305, 1309, 1310] },
        5:  { name: 'Enemy Floor 5',  heroes: [1307, 1308, 1309, 1310, 1402] },
        6:  { name: 'Enemy Floor 6',  heroes: [1402, 1403, 1404, 1405, 1301] },
        7:  { name: 'Enemy Floor 7',  heroes: [1402, 1403, 1404, 1405, 1410] },
        8:  { name: 'Enemy Floor 8',  heroes: [1402, 1403, 1410, 1411, 1412] },
        9:  { name: 'Enemy Floor 9',  heroes: [1503, 1504, 1506, 1507, 1508] },
        10: { name: 'Enemy Floor 10', heroes: [1503, 1504, 1506, 1507, 1508] }
    };

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJsonSync(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _resourceCache[name] = JSON.parse(xhr.responseText);
                return _resourceCache[name];
            }
        } catch (e) {
            log.error('RESOURCE', 'getEnemyInfo failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getSnakeDungeonConfig() { return loadJsonSync('snakeDungeon'); }
    function getHeroConfig(id) { var h = loadJsonSync('hero'); return h ? h[String(id)] : null; }
    function getHeroLevelAttr(level) { var la = loadJsonSync('heroLevelAttr'); return la ? la[String(level)] : null; }
    function getHeroTypeParam(type) { var tp = loadJsonSync('heroTypeParam'); return tp ? tp[String(type)] : null; }
    function getHeroQualityParam(quality) { var qp = loadJsonSync('heroQualityParam'); return qp ? qp[String(quality)] : null; }

    // ═══════════════════════════════════════════════════════════
    //  COMPUTE HERO HP
    // ═══════════════════════════════════════════════════════════

    function computeHeroHP(heroDisplayId, level, difficulty) {
        var hc = getHeroConfig(heroDisplayId) || {};
        var quality = hc.quality || 'purple';
        var heroType = hc.heroType || 'critical';
        var la = getHeroLevelAttr(level) || {};
        var tp = getHeroTypeParam(heroType) || {};
        var qp = getHeroQualityParam(quality) || {};

        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        baseHp *= (difficulty || 1);
        if (baseHp < 1000) baseHp = 1000;
        return Math.floor(baseHp);
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD ENEMY TEAM from BOT config
    // ═══════════════════════════════════════════════════════════
    //
    //  ⚠️ _teamInfo values use NON-underscore fields!
    //  Client: a.heroDisplayId, a.level, a.star, a.curHp, a.totalHp, a.skinId
    //

    function buildEnemyTeam(botConfig, level, difficulty) {
        var teamInfo = {};
        var totalPower = 0;
        var heroIds = botConfig.heroes;

        for (var i = 0; i < heroIds.length; i++) {
            var hp = computeHeroHP(heroIds[i], level, difficulty);
            teamInfo[String(i)] = {
                heroDisplayId: heroIds[i],
                level: level,
                star: 0,
                curHp: hp,
                totalHp: hp,
                skinId: 0
            };
            totalPower += hp;
        }
        return { teamInfo: teamInfo, totalPower: totalPower };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetEnemyInfo(request, callback) {
        var userId = request && request.userId;
        var lessId = Number(request && request.lessId);

        log.info('SNAKE', 'snake/getEnemyInfo START — userId=' + (userId || '-')
            + ', lessId=' + lessId);

        try {
            if (!userId) { callback({}, 1); return; }
            if (!lessId || lessId < 1 || lessId > SNAKE_DUNGEON_MAX_LESSON) {
                callback({}, 1); return;
            }

            var dungeonConfig = getSnakeDungeonConfig();
            if (!dungeonConfig) { callback({}, 1); return; }

            var stageConfig = dungeonConfig[String(lessId)];
            if (!stageConfig) { callback({}, 1); return; }

            var difficulty = Number(stageConfig.difficulty) || 1;
            var bot = SNAKE_BOTS[lessId];
            if (!bot) { callback({}, 1); return; }

            var teamData = buildEnemyTeam(bot, SNAKE_HERO_LEVEL, difficulty);
            var firstHeroId = bot.heroes[0];

            var response = {
                _nickName: bot.name,
                _headImage: 'hero_icon_' + firstHeroId,
                _level: SNAKE_HERO_LEVEL,
                _guildName: '',
                _totalPower: teamData.totalPower,
                _enemyUserId: 'bot_snake_' + lessId,
                _teamInfo: teamData.teamInfo,
                _superSkill: []
            };

            log.info('SNAKE', 'getEnemyInfo SUCCESS — '
                + 'lessId=' + lessId + ', bot=' + bot.name
                + ', difficulty=' + difficulty
                + ', totalPower=' + teamData.totalPower);
            log.details('response', [
                ['userId', userId],
                ['lessId', String(lessId)],
                ['bot.name', bot.name],
                ['difficulty', String(difficulty)],
                ['_totalPower', String(teamData.totalPower)],
                ['heroes', bot.heroes.join(', ')]
            ]);

            callback(response);

        } catch (err) {
            log.error('SNAKE', 'getEnemyInfo UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    MainServer.registerHandler('snake', 'getEnemyInfo', handleGetEnemyInfo);
})();
