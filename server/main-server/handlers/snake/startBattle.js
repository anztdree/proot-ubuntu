/**
 * handlers/snake/startBattle.js — Snake Dungeon Start Battle Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: snake/startBattle
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Susun enemy team + generate battle ID + return battle data untuk
 *   snake dungeon battle. Client simulate battle locally, lalu kirim
 *   hasil ke dungeon/checkBattleResult (via RunSceneWithBattle).
 *
 *   Snake battle = PVP-style (player team vs enemy team).
 *   Hero HP/energy persistent antar stage (disimpan di _allTeam).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js):
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [L64919] SummonSingleton — snake PVP battle path:
 *     ts.processHandler({
 *         type: "snake", action: "startBattle",
 *         userId: <userId>,
 *         version: "1.0",
 *         team: e,                              // array of { _heroId, _position }
 *         "super": t,                           // array of super skill IDs
 *         battleField: BattleLogic.GameFieldType.SNAKEDUNGEON
 *     }, function(o) {
 *         UserInfoSingleton.getInstance().battleId = o._battleId
 *         UserInfoSingleton.getInstance().setMyTeamByType(LAST_TEAM_TYPE.SNAKE, e, t)
 *         SnakeManager.getInstance().afterBattleDataChange(o)
 *         var a = o._leftTeam, r = t
 *         RunSceneWithBattle.battleWithPVPAndLeftTeam(a, r, s, n,
 *             o._rightTeam, o._rightSuper, o._rand, ...)
 *     })
 *
 *   [L135475] SnakeChapterInfo.battleBtnTap:
 *     ts.processHandler({
 *         type: "snake", action: "startBattle",
 *         userId: <userId>,
 *         version: "1.0",
 *         team: a,                              // array of { _heroId, _position }
 *         "super": l,                           // array of super skill IDs
 *         battleField: BattleLogic.GameFieldType.SNAKEDUNGEON
 *     }, function(t) {
 *         UserInfoSingleton.getInstance().battleId = t._battleId
 *         e.snakeMange.saveTmpReward(t)
 *         SnakeManager.getInstance().saveSnakeData(t)
 *         e.oneBattleEnd(t._battleResult)
 *     })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L64919 + L135475 callbacks)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _battleId: <string>,            // unique battle ID
 *       _battleResult: <number>,        // 0=lose, 1=win (pre-determined by server)
 *       _leftTeam: [<heroData>, ...],   // player team battle data (5 entries)
 *       _rightTeam: [<heroData>, ...],  // enemy team battle data (5 entries)
 *       _rightSuper: [<number>, ...],   // enemy super skills
 *       _rand: [<number>, ...],         // random numbers for battle sim (100 entries)
 *       _changeInfo: {                  // item changes (reward/cost)
 *           _items: { "<itemId>": { _id, _num } }
 *       },
 *       _snake: {                       // updated snake state (same as getSnakeInfo)
 *           _id, _curLess, _passLess, _allTeam, _gotRewardBox
 *       }
 *   })
 *
 *   Client reads (L64919):
 *     o._battleId         → UserInfoSingleton.battleId
 *     o._leftTeam         → RunSceneWithBattle (player team for battle scene)
 *     o._rightTeam        → RunSceneWithBattle (enemy team for battle scene)
 *     o._rightSuper       → RunSceneWithBattle (enemy super skills)
 *     o._rand             → RunSceneWithBattle (shared random for battle sim)
 *     SnakeManager.afterBattleDataChange(o):
 *       o._battleResult   → setBattleFinal(result, changeInfo)
 *       o._changeInfo     → setBattleFinal + saveTmpReward
 *
 *   Client reads (L135475):
 *     t._battleId         → UserInfoSingleton.battleId
 *     t._battleResult     → oneBattleEnd(result)
 *     SnakeManager.saveSnakeData(t):
 *       t._snake          → SnakeModel.deserialize (update curLess, passLess, allTeam)
 *     SnakeManager.saveTmpReward(t):
 *       t._changeInfo     → process item changes
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BATTLE HERO DATA FORMAT (per entry in _leftTeam / _rightTeam)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Pattern sama dengan arena/startBattle.js existing handler.
 *   Client RunSceneWithBattle deserialize setiap entry.
 *
 *   Entry shape (simplified):
 *   {
 *       heroDisplayId: <number>,
 *       level: <number>,
 *       star: <number>,
 *       curHp: <number>,
 *       maxHp: <number>,
 *       skinId: <number>,
 *       attr: { _items: [ {_id, _num}, ... ] }  // battle stats
 *   }
 *
 *   ⚠️ Fields use NON-underscore (client reads directly, no deserialize).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * _leftTeam (player team)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Built from request.team (array of { _heroId, _position }).
 *   Server lookup user's hero data, compute battle stats.
 *
 *   HP/energy dari snake._allTeam (persistent state):
 *     - Kalau hero ada di _allTeam: pakai curHp/totalHp/energy dari sana
 *     - Kalau belum ada (first battle): pakai full HP dari hero stats
 *
 * ═══════════════════════════════════════════════════════════════════════
 * _rightTeam (enemy team)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Generated sama seperti getEnemyInfo — 5 random hero dari pool.
 *   Difficulty dari snakeDungeon.json[curLess].difficulty.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BATTLE RESULT LOGIC
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Trial: WIN always (1). Nanti bisa di-toggle.
 *   Setelah WIN:
 *     - _passLess = _curLess (stage passed)
 *     - _curLess = min(_curLess + 1, maxLesson)
 *     - _allTeam updated (hero HP/energy after battle)
 *
 *   Setelah LOSE:
 *     - _curLess tetap (retry stage)
 *     - _allTeam updated (hero HP mungkin berkurang)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONFIG
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   constant.json[1]:
 *     snakeHeroLevel = 40
 *     snakeDungeonMaxLesson = 10
 *     snakeTimes = 1
 *
 *   snakeDungeon.json[lessId]:
 *     id, difficulty (0.2-0.81), award1, num1, battleBackGround
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var SNAKE_HERO_LEVEL = 40;
    var SNAKE_DUNGEON_MAX_LESSON = 10;
    var TEAM_SIZE = 5;
    var RAND_COUNT = 100;

    // ═══════════════════════════════════════════════════════════
    //  BOT PLAYERS — 10 bots, 1 per floor (same as getEnemyInfo.js)
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
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    function loadSnakeState(savedData) {
        if (!savedData.snake) {
            savedData.snake = {
                _id: '',
                _curLess: 1,
                _passLess: 0,
                _allTeam: {},
                _gotRewardBox: []
            };
        }
        if (!savedData.snake._allTeam) savedData.snake._allTeam = {};
        if (!savedData.snake._gotRewardBox) savedData.snake._gotRewardBox = [];
        return savedData.snake;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
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
            log.error('RESOURCE', 'snake/startBattle failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getSnakeDungeonConfig() {
        return loadJsonSync('snakeDungeon');
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJsonSync('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getHeroLevelAttr(level) {
        var la = loadJsonSync('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    function getHeroTypeParam(heroType) {
        var tp = loadJsonSync('heroTypeParam');
        return tp ? tp[String(heroType)] : null;
    }

    function getHeroQualityParam(quality) {
        var qp = loadJsonSync('heroQualityParam');
        return qp ? qp[String(quality)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENEMY HERO POOL (same as getEnemyInfo.js)
    // ═══════════════════════════════════════════════════════════

    var _enemyHeroPool = null;

    function getEnemyHeroPool() {
        if (_enemyHeroPool) return _enemyHeroPool;
        var heroConfig = loadJsonSync('hero');
        if (!heroConfig) return [];
        _enemyHeroPool = [];
        for (var key in heroConfig) {
            if (!heroConfig.hasOwnProperty(key)) continue;
            var hc = heroConfig[key];
            if (hc.clientType !== 'hero') continue;
            var q = hc.quality || '';
            if (q === 'blue' || q === 'purple' || q === 'orange' || q === 'flickerOrange') {
                _enemyHeroPool.push({
                    displayId: Number(key),
                    quality: q,
                    heroType: hc.heroType || 'critical',
                    balanceHp: Number(hc.balanceHp) || 1,
                    balanceAttack: Number(hc.balanceAttack) || 1,
                    balanceArmor: Number(hc.balanceArmor) || 1
                });
            }
        }
        return _enemyHeroPool;
    }

    function pickRandomHeroes(count) {
        var pool = getEnemyHeroPool();
        if (pool.length === 0) return [];
        var result = [], used = {};
        for (var i = 0; i < count; i++) {
            var attempts = 0, pick;
            do {
                pick = pool[Math.floor(Math.random() * pool.length)];
                attempts++;
            } while (used[pick.displayId] && attempts < 50);
            used[pick.displayId] = true;
            result.push(pick);
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  COMPUTE HERO STATS (HP/attack/armor)
    // ═══════════════════════════════════════════════════════════

    function computeHeroStats(heroEntry, level, difficulty) {
        var la = getHeroLevelAttr(level) || {};
        var tp = getHeroTypeParam(heroEntry.heroType) || {};
        var qp = getHeroQualityParam(heroEntry.quality) || {};

        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (heroEntry.balanceHp || 1);
        baseHp *= (difficulty || 1);
        if (baseHp < 1000) baseHp = 1000;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (heroEntry.balanceAttack || 1);
        baseAtk *= (difficulty || 1);
        if (baseAtk < 100) baseAtk = 100;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (heroEntry.balanceArmor || 1);
        baseArm *= (difficulty || 1);
        if (baseArm < 50) baseArm = 50;

        return { hp: Math.floor(baseHp), attack: Math.floor(baseAtk), armor: Math.floor(baseArm) };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD BATTLE HERO ENTRY (for _leftTeam / _rightTeam)
    // ═══════════════════════════════════════════════════════════
    //
    //  ⚠️ CRITICAL: Fields use UNDERSCORE prefix!
    //  Client getTeamWithBattle (L169908-169916) reads:
    //    i._heroDisplayId, i._skinId, i._skills
    //
    //  _skills structure (L169917-169924):
    //    array of { _type, _id }
    //    _type: 0=normal, 1=proactive, 2=passive, 3=super
    //
    //  Skill IDs from hero.json:
    //    normal  = heroConfig.normal (e.g. 120191)
    //    skill   = heroConfig.skill (e.g. 120101)
    //    passive = heroConfig.skillPassive1 (e.g. 120111)
    //    super   = heroConfig.potential1 (e.g. 120141)
    //

    function buildBattleHeroEntry(heroDisplayId, level, star, curHp, maxHp) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.warn('SNAKE', 'Hero not found in hero.json: ' + heroDisplayId + ' — skipping');
            return null;
        }

        var quality = hc.quality || 'purple';
        var heroType = hc.heroType || 'critical';
        var heroEntry = {
            displayId: heroDisplayId,
            quality: quality,
            heroType: heroType,
            balanceHp: Number(hc.balanceHp) || 1,
            balanceAttack: Number(hc.balanceAttack) || 1,
            balanceArmor: Number(hc.balanceArmor) || 1
        };
        var stats = computeHeroStats(heroEntry, level, 1);

        // Build _skills — OBJECT keyed by skillId string (NOT array!)
        // Pattern: sama dengan arena/startBattle.js L391-399
        var skills = {};
        if (hc.normal) {
            skills[String(hc.normal)] = { _type: 0, _id: Number(hc.normal), _level: 1 };
        }
        if (hc.skill) {
            skills[String(hc.skill)] = { _type: 1, _id: Number(hc.skill), _level: 1 };
        }

        var defaultSkin = Number(hc.defaultSkin) || 0;
        var energyMax = Number(hc.energyMax) || 100;

        // Build _attrs._items — OBJECT keyed by string attr ID (NOT array!)
        // Pattern: sama dengan arena/startBattle.js L497-526
        var items = {};
        items['0']  = { _id: 0,  _num: stats.hp };
        items['1']  = { _id: 1,  _num: stats.attack };
        items['2']  = { _id: 2,  _num: stats.armor };
        items['3']  = { _id: 3,  _num: Number(hc.speed) || 180 };
        items['4']  = { _id: 4,  _num: 0 };
        items['5']  = { _id: 5,  _num: 0 };
        items['6']  = { _id: 6,  _num: 0 };
        items['7']  = { _id: 7,  _num: 0 };
        items['8']  = { _id: 8,  _num: 0 };
        items['9']  = { _id: 9,  _num: 0 };
        items['10'] = { _id: 10, _num: 0 };
        items['11'] = { _id: 11, _num: 0 };
        items['12'] = { _id: 12, _num: 0 };
        items['13'] = { _id: 13, _num: 0 };
        items['14'] = { _id: 14, _num: 0 };
        items['15'] = { _id: 15, _num: 0 };
        items['16'] = { _id: 16, _num: 50 };
        items['21'] = { _id: 21, _num: 0 };
        items['22'] = { _id: 22, _num: stats.hp };
        items['41'] = { _id: 41, _num: energyMax };

        return {
            _heroDisplayId: heroDisplayId,
            _heroLevel: level,
            _heroStar: star || 0,
            _skinId: defaultSkin,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _skills: skills,
            _attrs: { _items: items }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD LEFT TEAM (player team)
    // ═══════════════════════════════════════════════════════════
    //
    //  From request.team (array of { _heroId, _position }).
    //  Lookup user's hero collection, compute battle stats.
    //  HP/energy from snake._allTeam (persistent state).
    //

    function buildLeftTeam(savedData, requestTeam, snakeState) {
        var leftTeam = [];
        if (!savedData.heros || !savedData.heros._heros) return leftTeam;

        var heros = savedData.heros._heros;
        var allTeam = snakeState._allTeam || {};

        for (var i = 0; i < requestTeam.length; i++) {
            var teamEntry = requestTeam[i];
            // Skip null entries (client sends [hero, null, null, null, null])
            if (!teamEntry || typeof teamEntry !== 'object') continue;
            
            // Client sends { heroId: 1322 } (NON-underscore) or { _heroId: 1322 }
            var heroInstanceId = teamEntry.heroId || teamEntry._heroId;
            var position = Number(teamEntry.position || teamEntry._position) || i;
            
            if (!heroInstanceId) continue;

            // Find hero in collection
            var heroData = null;
            for (var key in heros) {
                if (String(heros[key]._heroId) === String(heroInstanceId)) {
                    heroData = heros[key];
                    break;
                }
            }
            if (!heroData) continue;

            var displayId = Number(heroData._heroDisplayId);
            var level = (heroData._heroBaseAttr && heroData._heroBaseAttr._level) || 1;
            var star = Number(heroData._heroStar) || 0;

            // Get persistent HP from snake._allTeam
            var snakeHero = allTeam[String(heroInstanceId)];
            var curHp = 0, maxHp = 0;
            if (snakeHero) {
                curHp = Number(snakeHero._curHp) || 0;
                maxHp = Number(snakeHero._totalHp) || 0;
            }

            var entry = buildBattleHeroEntry(displayId, level, star, curHp, maxHp);
            if (!entry) continue;
            entry._heroId = String(heroInstanceId);
            leftTeam[position] = entry;
        }

        // JANGAN fill gaps dengan null!
        // Client getTeamWithBattle (L169906) pakai for(var r in e) →
        // iterasi semua index termasuk null → crash saat akses i._heroDisplayId.
        // Biarkan array sparse (index kosong tidak ada = skip oleh for...in).

        return leftTeam;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD RIGHT TEAM (enemy team)
    // ═══════════════════════════════════════════════════════════

    function buildRightTeam(lessId, difficulty) {
        var bot = SNAKE_BOTS[lessId];
        if (!bot) return [];
        
        var rightTeam = [];
        for (var i = 0; i < bot.heroes.length; i++) {
            var heroDisplayId = bot.heroes[i];
            var entry = buildBattleHeroEntry(heroDisplayId, SNAKE_HERO_LEVEL, 0, 0, 0);
            if (!entry) continue;
            rightTeam[i] = entry;
        }
        return rightTeam;
    }

    // ═══════════════════════════════════════════════════════════
    //  GENERATE RAND ARRAY (for battle sim)
    // ═══════════════════════════════════════════════════════════

    function generateRand() {
        var rand = [];
        for (var i = 0; i < RAND_COUNT; i++) {
            rand.push(Math.round(1E5 * Math.random()) / 1E5);  // float 0-1 (match arena/startBattle.js)
        }
        return rand;
    }

    // ═══════════════════════════════════════════════════════════
    //  UPDATE SNAKE STATE AFTER BATTLE
    // ═══════════════════════════════════════════════════════════

    function updateSnakeStateAfterBattle(snake, requestTeam, battleResult, leftTeam) {
        var allTeam = snake._allTeam || {};

        // Update hero HP/energy in _allTeam
        for (var i = 0; i < requestTeam.length; i++) {
            var teamEntry = requestTeam[i];
            // Skip null entries
            if (!teamEntry || typeof teamEntry !== 'object') continue;
            
            var heroInstanceId = String(teamEntry.heroId || teamEntry._heroId);
            var position = Number(teamEntry.position || teamEntry._position) || i;
            var battleEntry = leftTeam[position];
            if (battleEntry && battleEntry._attrs && battleEntry._attrs._items) {
                var hp = Number(battleEntry._attrs._items['0']._num) || 0;
                allTeam[heroInstanceId] = {
                    _curHp: Math.max(0, Math.floor(hp * 0.8)),
                    _totalHp: hp,
                    _energy: 50
                };
            }
        }

        // Advance stage on WIN (0=WIN)
        if (battleResult === 0) {
            snake._passLess = snake._curLess;
            if (snake._curLess < SNAKE_DUNGEON_MAX_LESSON) {
                snake._curLess++;
            }
        }

        snake._allTeam = allTeam;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleStartBattle(request, callback) {
        var userId = request && request.userId;
        var team = request && request.team;
        var superSkills = request && request['super'];

        log.info('SNAKE', 'snake/startBattle START — userId=' + (userId || '-'));

        try {
            // ── VALIDATE userId ──
            if (!userId) {
                log.warn('SNAKE', 'startBattle — missing userId');
                callback({}, 1);
                return;
            }

            // ── VALIDATE team ──
            if (!team || !Array.isArray(team) || team.length === 0) {
                log.warn('SNAKE', 'startBattle — missing or empty team');
                callback({}, 1);
                return;
            }

            // ── Load user data ──
            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) {
                log.warn('SNAKE', 'startBattle — user data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // ── Load snake state ──
            var snake = loadSnakeState(savedData);
            var curLess = snake._curLess || 1;

            // ── Load dungeon config ──
            var dungeonConfig = getSnakeDungeonConfig();
            if (!dungeonConfig) {
                log.error('SNAKE', 'startBattle — failed to load snakeDungeon.json');
                callback({}, 1);
                return;
            }

            var stageConfig = dungeonConfig[String(curLess)];
            if (!stageConfig) {
                log.warn('SNAKE', 'startBattle — no config for lessId=' + curLess);
                callback({}, 1);
                return;
            }

            var difficulty = Number(stageConfig.difficulty) || 1;

            // ── Build left team (player) ──
            var leftTeam = buildLeftTeam(savedData, team, snake);

            // ── Build right team (enemy) ──
            var rightTeam = buildRightTeam(curLess, difficulty);

            // ── Generate battle data ──
            var battleId = 'snake_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            var rand = generateRand();

            // Trial: always WIN — 0=WIN, 1=LOSE (verified arena/startBattle.js L16)
            var battleResult = 0;

            // ── Update snake state ──
            // 0=WIN, 1=LOSE — only advance on WIN (0)
            updateSnakeStateAfterBattle(snake, team, battleResult, leftTeam);

            // ── Build reward (snakeDungeon award) ──
            var rewardItemId = Number(stageConfig.award1) || 113;
            var rewardNum = Number(stageConfig.num1) || 10;

            // Add reward to inventory
            if (!savedData.totalProps) savedData.totalProps = { _items: [] };
            if (!savedData.totalProps._items) savedData.totalProps._items = [];
            var items = savedData.totalProps._items;
            var found = false;
            for (var i = 0; i < items.length; i++) {
                if (Number(items[i]._id) === rewardItemId) {
                    items[i]._num = (Number(items[i]._num) || 0) + rewardNum;
                    found = true;
                    break;
                }
            }
            if (!found) {
                items.push({ _id: rewardItemId, _num: rewardNum });
            }

            // ── Build _changeInfo ──
            var changeItems = {};
            changeItems[String(rewardItemId)] = { _id: rewardItemId, _num: 0 };
            // Find updated balance
            for (var j = 0; j < items.length; j++) {
                if (Number(items[j]._id) === rewardItemId) {
                    changeItems[String(rewardItemId)]._num = items[j]._num;
                    break;
                }
            }

            // ── Persist ──
            db._set(storageKey, savedData);

            // ════════════════════════════════════════════════════════
            //  TASK UPDATE — 2 jenis task snakeDungeonLesson
            // ════════════════════════════════════════════════════════
            //
            //  1. MAIN TASK (task.json id=6032, taskType=snakeDungeonLesson, taskPara1=1):
            //     Clear snake dungeon 1x → set curMainTask COMPLETE + Notify
            //
            //  2. DAILY TASK (taskDaily.json id=6116, taskType=snakeDungeonLesson, taskPara1=6):
            //     Clear snake dungeon 6x → increment _dailyTaskProgress
            //     (queryTask handler baca progress + set state)
            //

            // ── 1. Main task update ──
            var taskUpdated = false;
            if (battleResult === 0 && savedData.curMainTask && Array.isArray(savedData.curMainTask) && savedData.curMainTask.length > 0) {
                var currentTask = savedData.curMainTask[0];
                var TASK_STATE_COMPLETE = 2;
                var TASK_STATE_FINISH = 3;

                if (currentTask._state !== TASK_STATE_COMPLETE && currentTask._state !== TASK_STATE_FINISH) {
                    // Load task config
                    var taskConfig = loadJsonSync('task');
                    if (taskConfig) {
                        var taskData = taskConfig[String(currentTask._id)];
                        if (taskData && taskData.taskType === 'snakeDungeonLesson') {
                            currentTask._state = TASK_STATE_COMPLETE;
                            savedData.curMainTask = [currentTask];
                            taskUpdated = true;

                            log.info('SNAKE', 'Main task ' + currentTask._id + ' (snakeDungeonLesson) → COMPLETE');

                            // Kirim Notify mainTaskChange
                            MainServer.log.notify('mainTaskChange', {
                                _curMainTask: savedData.curMainTask
                            });
                        }
                    }
                }
            }

            // ── 2. Daily task update ──
            if (battleResult === 0) {
                if (!savedData._dailyTaskProgress) savedData._dailyTaskProgress = {};
                if (!savedData._dailyTaskStates) savedData._dailyTaskStates = {};

                var progress = Number(savedData._dailyTaskProgress['snakeDungeonLesson']) || 0;
                progress++;
                savedData._dailyTaskProgress['snakeDungeonLesson'] = progress;

                // Cek daily task 6116 (taskPara1=6)
                var dailyConfig = loadJsonSync('taskDaily');
                if (dailyConfig) {
                    var dailyTask = dailyConfig['6116'];
                    if (dailyTask && progress >= Number(dailyTask.taskPara1)) {
                        // Task complete — set state
                        if (!savedData._dailyTaskStates['6116']) {
                            savedData._dailyTaskStates['6116'] = {};
                        }
                        savedData._dailyTaskStates['6116']._state = TASK_STATE_COMPLETE || 2;
                        savedData._dailyTaskStates['6116']._curCount = progress;

                        log.info('SNAKE', 'Daily task 6116 (snakeDungeonLesson) → COMPLETE (progress=' + progress + '/' + dailyTask.taskPara1 + ')');
                    } else {
                        log.info('SNAKE', 'Daily task 6116 progress: ' + progress + '/' + (dailyTask ? dailyTask.taskPara1 : '?'));
                    }
                }

                // Persist task update
                db._set(storageKey, savedData);
            }

            // ── Build response ──
            var response = {
                _battleId: battleId,
                _battleResult: battleResult,
                _leftTeam: leftTeam,
                _rightTeam: rightTeam,
                _rightSuper: [],
                _rand: rand,
                _changeInfo: { _items: changeItems },
                _snake: {
                    _id: snake._id || '',
                    _curLess: snake._curLess,
                    _passLess: snake._passLess,
                    _allTeam: snake._allTeam,
                    _gotRewardBox: snake._gotRewardBox || []
                }
            };

            log.info('SNAKE', 'startBattle SUCCESS — '
                + 'curLess=' + curLess + '→' + snake._curLess
                + ', passLess=' + snake._passLess
                + ', battleResult=WIN (0)'
                + ', reward=' + rewardItemId + 'x' + rewardNum);
            log.details('response', [
                ['userId', userId],
                ['stage', curLess + ' (difficulty=' + difficulty + ')'],
                ['_battleId', battleId],
                ['_battleResult', 'WIN (0)'],
                ['_leftTeam.count', leftTeam.filter(function(e) { return e; }).length + ' heroes'],
                ['_rightTeam.count', rightTeam.length + ' heroes'],
                ['_rand.count', rand.length],
                ['reward', rewardItemId + ' x' + rewardNum],
                ['snake.curLess', snake._curLess],
                ['snake.passLess', snake._passLess]
            ]);

            callback(response);

        } catch (err) {
            log.error('SNAKE', 'startBattle UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('snake', 'startBattle', handleStartBattle);
})();
