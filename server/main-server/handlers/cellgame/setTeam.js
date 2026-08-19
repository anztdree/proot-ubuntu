/**
 * handlers/cellGame/setTeam.js — Cell Game Set Team Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: cellGame/setTeam
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Set user's hero team untuk Cell Game (ShaLu Game). User pilih hero
 *   dari koleksinya (positions 1-10, 2 rows of 5), server simpan ke
 *   cellGameState._heroes sebagai CellGameHero objects.
 *
 *   Setelah setTeam sukses, client route ke ShaLuGame (battle scene).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [L107584-107594] ShaLuFastSetBattleTeam.sureTeamBtnTap:
 *     var t = {};
 *     for (var o in e.upHeroModelList) {
 *         if (e.upHeroModelList[o] != undefined) {
 *             t[o] = e.upHeroModelList[o].heroId;   // position → heroId (string)
 *         }
 *     }
 *     ts.processHandler({
 *         type: "cellGame",
 *         action: "setTeam",
 *         userId: e,
 *         team: t,                                  // { "1":"<heroId>", "2":"<heroId>", ... }
 *         version: "1.0"
 *     }, function(e) {
 *         AllRefreshCount.getInstance().cellgameHaveSetHero = true;
 *         BossPartManager.getInstance().setCellGameModelData(e);  // ⚠️ e = FULL CellGameModel (NOT wrapped in _info!)
 *         ts.closeWindow("ShaLuFastSetBattleTeam");
 *         UIWindowManager.openShaLuGame();
 *     }, function(e) {
 *         Logger.serverDebugLog("失败！！！");
 *     })
 *
 *   [L108920-108930] ShaLuSetBattleTeam (full team setting):
 *     Same pattern — team: n (dict position → heroId)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EVIDENCE: BUKTI BUKAN ASUMSI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * [setCellGameModelData] L82487-82489:
 *   e.prototype.setCellGameModelData = function(e) {
 *       t.lastBigBossInfo = t.CellGameModelData.enemies[8];
 *       t.CellGameModelData.deserialize(e);    // ← deserialize e DIRECTLY (not e._info)
 *       t.bossTimesBuy = e._buyTimes;
 *       0 == t.CellGameModelData.yesterdayLevel && (cellGameHaveGotReward = true)
 *   }
 *   → Response = FULL CellGameModel data (NOT wrapped in _info)
 *   → BEDA dengan getInfo yang wrap dalam { _info: {...} }
 *
 * [CellGameModel.deserialize] L82584-82604:
 *   Reads: _heroes (dict CellGameHero), _enemies (dict CellGameEnemy),
 *          _lastHeroes (dict), common fields
 *
 * [CellGameHero.deserialize] L82537-82541:
 *   Reads: _hero (BattleTeam), common fields
 *   → CellGameHero = { _hero: <BattleTeam> }
 *
 * [BattleTeam constructor] L86635-86704:
 *   Reads from input object:
 *     _heroDisplayId, _superSkillLevel, _fixSkillLevel, _fixPassiveLevel,
 *     _potentialLevel, _heroStar, _evolveLevel
 *     _attrs: { _items: [ { _id, _num }, ... ] }
 *   Also reads common fields → teamHeroItem:
 *     _heroId, _position, _heroLevel, _skinId, _weaponHaloId, _weaponHaloLevel
 *
 * [HERO_ATTR_TYPE enum] L53212:
 *   ATTR_HR=0 (current HP), ATTR_ATTACK=1, ATTR_ARMOR=2, ATTR_SPEED=3,
 *   ATTR_ENERGY=16, ATTR_ORGHP=22 (total HP)
 *
 * [User hero storage] (verified dari enterGame.js + hero/resolve.js):
 *   savedData.heros._heros["<arbitraryKey>"] = {
 *     _heroId, _heroDisplayId, _heroStar, _expeditionMaxLevel,
 *     _heroBaseAttr: { _hp, _attack, _armor, _speed, _hit, _dodge, _block,
 *                      _energy, _level, _exp, _evolveLevel, _talent },
 *     _superSkillLevel, _potentialLevel, _qigong, ...
 *   }
 *   Keys arbitrary — must iterate to find by _heroId (pattern dari resolve.js L197-205)
 *
 * [cellGame/getInfo.js] (sibling handler):
 *   State stored di savedData.cellGameState = {
 *     _curLevel, _curEnemy, _passLevel, _yesterdayLevel,
 *     _haveBeatLastLessonToday, _buyTimes, _heroes, _lastHeroes
 *   }
 *   setTeam UPDATE _heroes field, lalu return full state + dynamic enemies.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TASK INVOLVEMENT?
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ❌ TIDAK ADA TASK yang di-update di setTeam.
 *   - task.json: 0 match untuk "setTeam", "cellGameSet", "cellGameTeam"
 *   - cellGameBattle (task 6040) di-handle di checkBattleResult
 *   - setTeam hanya persist team, tidak trigger task progress
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REQUEST FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   {
 *     type: "cellGame",
 *     action: "setTeam",
 *     userId: <string>,
 *     team: { "<position>": "<heroInstanceId>", ... },  // positions 1-10
 *     version: "1.0"
 *   }
 *
 *   Position 1-5 = first row, 6-10 = second row (max 10 heroes)
 *   heroInstanceId = string (user's hero _heroId from collection)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ⚠️ BEDA dengan getInfo! Response = FULL CellGameModel data DIRECTLY
 *      (NOT wrapped in { _info: {...} })
 *
 *   callback({
 *     _id: <string>,
 *     _curEnemy: 1,
 *     _curLevel: 1,
 *     _passLevel: 0,
 *     _yesterdayLevel: 0,
 *     _haveBeatLastLessonToday: false,
 *     _buyTimes: 0,
 *     _heroes: { "<pos>": <CellGameHero> },    // UPDATED team
 *     _enemies: { "1"-"8": <CellGameEnemy> },  // dynamic dari cellGame.json
 *     _lastHeroes: {}
 *   })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STORAGE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   User data key: user:{userId}
 *   Field: savedData.cellGameState._heroes = {
 *     "<pos>": { _hero: <BattleTeam> },
 *     ...
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT ERROR HANDLING
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Callback BACA `e` langsung (setCellGameModelData(e)) — ret=1 + empty
 *   akan crash. Semua validation failure → return ret=0 dengan default state.
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.cellGame) {
        MainServer.handlers.cellGame = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS — verified dari main.min.js
    // ═══════════════════════════════════════════════════════════

    // HERO_ATTR_TYPE enum (L53212)
    var ATTR_HR = 0;        // current HP
    var ATTR_ATTACK = 1;
    var ATTR_ARMOR = 2;
    var ATTR_SPEED = 3;
    var ATTR_HIT = 4;
    var ATTR_DODGE = 5;
    var ATTR_BLOCK = 6;
    var ATTR_BLOCKEFFECT = 7;
    var ATTR_SKILLDAMAGE = 8;
    var ATTR_CRITICAL = 9;
    var ATTR_CRITICALRESIST = 10;
    var ATTR_CRITICALDAMAGE = 11;
    var ATTR_ENERGY = 16;
    var ATTR_ORGHP = 22;    // original/total HP

    // cellGame.json: 7 small enemies + 1 final boss = 8 enemies per level
    var ENEMY_COUNT = 8;

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJson(name) {
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
            log.error('RESOURCE', 'cellGame/setTeam failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'cellGame/setTeam failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getCellGameConfig() {
        return loadJson('cellGame');
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJson('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getHeroLevelAttr(level) {
        var la = loadJson('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO LOOKUP (pattern dari hero/resolve.js L197-205)
    // ═══════════════════════════════════════════════════════════

    function findHeroInStorage(savedData, heroId) {
        if (!savedData.heros || !savedData.heros._heros) return null;
        var heros = savedData.heros._heros;
        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;
            var hero = heros[key];
            if (hero._heroId === heroId || hero._heroId === Number(heroId) ||
                String(hero._heroId) === String(heroId)) {
                return { key: key, hero: hero };
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  BATTLE TEAM BUILDER (dari user hero data)
    // ═══════════════════════════════════════════════════════════
    //
    //  Build BattleTeam dari hero user di savedData.
    //  Pattern identik dengan arena/startBattle.js buildPlayerHeroBattleData:
    //    1. Cari _attrs pre-computed (paling akurat)
    //    2. Fallback ke _heroBaseAttr (computed by enterGame.js)
    //    3. Fallback ke dungeon-style formula
    //
    //  Output format (verified BattleTeam constructor L86635-86704):
    //    { _heroDisplayId, _heroStar, _heroLevel, _heroId, _position,
    //      _skinId, _weaponHaloId, _weaponHaloLevel, _evolveLevel,
    //      _attrs: { _items: [ { _id, _num }, ... ] } }
    //

    function getAttrNum(attrs, attrId) {
        if (!attrs || !attrs._items) return 0;
        var items = attrs._items;
        // _items bisa array atau object — handle keduanya
        if (Array.isArray(items)) {
            for (var i = 0; i < items.length; i++) {
                if (Number(items[i]._id) === Number(attrId)) {
                    return Number(items[i]._num) || 0;
                }
            }
        } else {
            for (var k in items) {
                if (Number(items[k]._id) === Number(attrId)) {
                    return Number(items[k]._num) || 0;
                }
            }
        }
        return 0;
    }

    function buildBattleTeamFromUserHero(foundHero, position) {
        if (!foundHero || !foundHero.hero) return null;
        var hero = foundHero.hero;

        var displayId = Number(hero._heroDisplayId);
        if (!displayId) {
            log.warn('CELLGAME', 'setTeam — hero missing _heroDisplayId: ' + hero._heroId);
            return null;
        }

        var heroCfg = getHeroConfig(displayId);
        if (!heroCfg) {
            log.warn('CELLGAME', 'setTeam — hero config not found for displayId ' + displayId);
            return null;
        }

        // Extract level, star, evolve from hero data
        var level = 1;
        var star = Number(hero._heroStar) || 0;
        var evolveLevel = 0;

        if (hero._heroBaseAttr) {
            level = Number(hero._heroBaseAttr._level) || 1;
            evolveLevel = Number(hero._heroBaseAttr._evolveLevel) || 0;
        }

        // Skin: pakai defaultSkin dari hero.json (mock — no custom skin tracking)
        var skinId = Number(heroCfg.defaultSkin) || 0;

        // ── Extract stats ──
        // Priority 1: pre-computed _attrs (includes equipment bonuses)
        // Priority 2: _heroBaseAttr (computed by enterGame.js)
        var hp, atk, armor, speed, hit, dodge, block, blockEffect;
        var crit, critResist, critDmg;
        var energy = 50;  // startMana default

        var preAttrs = hero._attrs;
        var hasPreAttrs = preAttrs && preAttrs._items && (
            (Array.isArray(preAttrs._items) ? preAttrs._items.length > 0 : Object.keys(preAttrs._items).length > 0)
        );

        if (hasPreAttrs) {
            hp = getAttrNum(preAttrs, ATTR_HR) || getAttrNum(preAttrs, ATTR_ORGHP);
            atk = getAttrNum(preAttrs, ATTR_ATTACK);
            armor = getAttrNum(preAttrs, ATTR_ARMOR);
            speed = getAttrNum(preAttrs, ATTR_SPEED);
            hit = getAttrNum(preAttrs, ATTR_HIT);
            dodge = getAttrNum(preAttrs, ATTR_DODGE);
            block = getAttrNum(preAttrs, ATTR_BLOCK);
            blockEffect = getAttrNum(preAttrs, ATTR_BLOCKEFFECT);
            crit = getAttrNum(preAttrs, ATTR_CRITICAL);
            critResist = getAttrNum(preAttrs, ATTR_CRITICALRESIST);
            critDmg = getAttrNum(preAttrs, ATTR_CRITICALDAMAGE);
        } else if (hero._heroBaseAttr) {
            var ba = hero._heroBaseAttr;
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
        } else {
            // Fallback: minimal stats
            hp = 1000;
            atk = 100;
            armor = 100;
            speed = Number(heroCfg.speed) || 180;
            hit = 0; dodge = 0; block = 0; blockEffect = 0;
            crit = 0; critResist = 0; critDmg = 0;
        }

        // Ensure HP has minimum value
        if (!hp || hp < 1) hp = 1000;

        // Build _attrs._items (BattleTeam attrItems)
        var attrItems = [
            { _id: ATTR_HR,             _num: hp },         // current HP
            { _id: ATTR_ATTACK,         _num: atk },
            { _id: ATTR_ARMOR,          _num: armor },
            { _id: ATTR_SPEED,          _num: speed },
            { _id: ATTR_HIT,            _num: hit },
            { _id: ATTR_DODGE,          _num: dodge },
            { _id: ATTR_BLOCK,          _num: block },
            { _id: ATTR_BLOCKEFFECT,    _num: blockEffect },
            { _id: ATTR_CRITICAL,       _num: crit },
            { _id: ATTR_CRITICALRESIST, _num: critResist },
            { _id: ATTR_CRITICALDAMAGE, _num: critDmg },
            { _id: ATTR_ENERGY,         _num: energy },     // startMana=50
            { _id: ATTR_ORGHP,          _num: hp }          // total/original HP
        ];

        return {
            _heroDisplayId: displayId,
            _heroStar: star,
            _heroLevel: level,
            _heroId: String(hero._heroId),
            _position: Number(position) || 1,
            _skinId: skinId,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _evolveLevel: evolveLevel,
            _attrs: { _items: attrItems }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  ENEMY BUILDER (sama dengan getInfo.js — untuk response)
    // ═══════════════════════════════════════════════════════════

    function buildEnemyBattleTeam(heroDisplayId, heroLevel, instanceId) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) return null;

        var skinId = Number(hc.defaultSkin) || 0;
        var la = getHeroLevelAttr(heroLevel) || {};

        var baseHp = Number(la.hp) || 100;
        var balanceHp = Number(hc.balanceHp) || 1;
        var totalHp = Math.floor(baseHp * balanceHp);

        return {
            _heroDisplayId: Number(heroDisplayId),
            _heroStar: 0,
            _heroLevel: Number(heroLevel) || 1,
            _heroId: String(instanceId),
            _position: 1,
            _skinId: skinId,
            _weaponHaloId: 0,
            _weaponHaloLevel: 0,
            _attrs: {
                _items: [
                    { _id: ATTR_HR,      _num: totalHp },
                    { _id: ATTR_ATTACK,  _num: Number(la.attack) || 50 },
                    { _id: ATTR_ARMOR,   _num: Number(la.armor) || 30 },
                    { _id: ATTR_SPEED,   _num: Number(hc.speed) || 200 },
                    { _id: ATTR_ENERGY,  _num: 50 },
                    { _id: ATTR_ORGHP,   _num: totalHp }
                ]
            }
        };
    }

    function buildEnemiesForLevel(curLevel) {
        var config = getCellGameConfig();
        if (!config) return {};

        var levelConfig = config[String(curLevel)];
        if (!levelConfig) return {};

        var enemies = {};
        for (var i = 1; i <= ENEMY_COUNT; i++) {
            var isFinal = (i === ENEMY_COUNT);
            var listKey = isFinal ? 'enemyListFinal' : 'enemyList' + i;
            var levelKey = isFinal ? 'enemyLevelFinal' : 'enemyLevel' + i;

            var heroDisplayId = Number(levelConfig[listKey]);
            var heroLevel = Number(levelConfig[levelKey]) || 1;

            if (!heroDisplayId) continue;

            var instanceId = 'cellgame_enemy_' + levelConfig.id + '_' + i;
            var battleTeam = buildEnemyBattleTeam(heroDisplayId, heroLevel, instanceId);

            if (battleTeam) {
                enemies[String(i)] = {
                    _teamInfo: { "1": battleTeam },
                    _super: [],
                    _curHp: 0,
                    _totalHp: 0
                };
            }
        }
        return enemies;
    }

    // ═══════════════════════════════════════════════════════════
    //  DEFAULT STATE (new user — sama dengan getInfo.js)
    // ═══════════════════════════════════════════════════════════

    function buildDefaultState() {
        return {
            _curLevel: 1,
            _curEnemy: 1,
            _passLevel: 0,
            _yesterdayLevel: 0,
            _haveBeatLastLessonToday: false,
            _buyTimes: 0,
            _heroes: {},
            _lastHeroes: {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD RESPONSE (FULL CellGameModel — NOT wrapped in _info)
    // ═══════════════════════════════════════════════════════════

    function buildResponseData(state) {
        var enemies = buildEnemiesForLevel(state._curLevel || 1);
        return {
            _id: 'cellgame_' + Date.now(),
            _curEnemy: Number(state._curEnemy) || 1,
            _curLevel: Number(state._curLevel) || 1,
            _passLevel: Number(state._passLevel) || 0,
            _yesterdayLevel: Number(state._yesterdayLevel) || 0,
            _haveBeatLastLessonToday: !!state._haveBeatLastLessonToday,
            _buyTimes: Number(state._buyTimes) || 0,
            _heroes: state._heroes || {},
            _enemies: enemies,
            _lastHeroes: state._lastHeroes || {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleSetTeam(request, callback) {
        // OUTER SAFETY NET — client callback BACA `e` langsung
        // (setCellGameModelData(e)), ret=1 + empty akan crash.
        try {
            _handleSetTeamImpl(request, callback);
        } catch (err) {
            log.error('CELLGAME', 'setTeam — UNCAUGHT EXCEPTION: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            // Return default state agar client tidak crash
            callback(buildResponseData(buildDefaultState()));
        }
    }

    function _handleSetTeamImpl(request, callback) {
        var userId = request && request.userId;
        var team = request && request.team;

        log.info('CELLGAME', 'setTeam — START (userId=' + (userId || '-') + ')');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['team', JSON.stringify(team || {})],
            ['version', (request && request.version) || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('CELLGAME', 'setTeam — missing userId');
            callback(buildResponseData(buildDefaultState()));
            return;
        }

        if (!team || typeof team !== 'object') {
            log.error('CELLGAME', 'setTeam — missing or invalid team');
            callback(buildResponseData(buildDefaultState()));
            return;
        }

        var teamSize = Object.keys(team).length;
        if (teamSize === 0) {
            log.error('CELLGAME', 'setTeam — team is empty');
            callback(buildResponseData(buildDefaultState()));
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('CELLGAME', 'setTeam — user data not found: ' + key);
            callback(buildResponseData(buildDefaultState()));
            return;
        }

        // ── LOAD OR INIT CELL GAME STATE ──
        if (!savedData.cellGameState) {
            savedData.cellGameState = buildDefaultState();
        }
        var state = savedData.cellGameState;

        // ── BUILD HEROES DICT ──
        // team = { "<pos>": "<heroInstanceId>", ... }
        // Output: state._heroes = { "<pos>": { _hero: <BattleTeam> }, ... }
        var newHeroes = {};
        var successCount = 0;
        var failedHeroes = [];

        for (var pos in team) {
            if (!team.hasOwnProperty(pos)) continue;
            var heroInstanceId = team[pos];

            // Skip null/undefined entries (user mungkin kirim sparse team)
            if (heroInstanceId === null || heroInstanceId === undefined || heroInstanceId === '') {
                continue;
            }

            // Find hero in user's collection
            var found = findHeroInStorage(savedData, heroInstanceId);
            if (!found) {
                log.warn('CELLGAME', 'setTeam — hero not found in collection: ' + heroInstanceId);
                failedHeroes.push(heroInstanceId);
                continue;
            }

            // Build BattleTeam from user hero data
            var battleTeam = buildBattleTeamFromUserHero(found, pos);
            if (!battleTeam) {
                log.warn('CELLGAME', 'setTeam — failed to build BattleTeam for hero ' + heroInstanceId);
                failedHeroes.push(heroInstanceId);
                continue;
            }

            // Wrap in CellGameHero format: { _hero: <BattleTeam> }
            newHeroes[String(pos)] = { _hero: battleTeam };
            successCount++;

            log.details('CELLGAME', [
                ['hero[' + pos + ']', 'displayId=' + battleTeam._heroDisplayId
                    + ' level=' + battleTeam._heroLevel
                    + ' star=' + battleTeam._heroStar
                    + ' hp=' + (battleTeam._attrs._items[0] ? battleTeam._attrs._items[0]._num : '?')]
            ]);
        }

        if (successCount === 0) {
            log.error('CELLGAME', 'setTeam — no heroes successfully built. Failed: '
                + JSON.stringify(failedHeroes));
            // Return current state (don't overwrite existing heroes with empty)
            callback(buildResponseData(state));
            return;
        }

        // ── UPDATE STATE ──
        state._heroes = newHeroes;

        // ── SAVE USER DATA ──
        db._set(key, savedData);

        log.info('CELLGAME', 'setTeam SUCCESS — '
            + successCount + ' heroes set, '
            + (failedHeroes.length > 0 ? 'failed=' + failedHeroes.length + ', ' : '')
            + 'curLevel=' + state._curLevel
            + ' → client routes to ShaLuGame');

        // ── BUILD RESPONSE ──
        // ⚠️ FULL CellGameModel data DIRECTLY (NOT wrapped in _info)
        var response = buildResponseData(state);

        log.details('response', [
            ['userId', userId],
            ['heroes.count', String(Object.keys(response._heroes).length)],
            ['enemies.count', String(Object.keys(response._enemies).length)],
            ['_curLevel', String(response._curLevel)],
            ['_curEnemy', String(response._curEnemy)],
            ['responseType', 'FULL CellGameModel (NOT wrapped in _info)']
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('cellGame', 'setTeam', handleSetTeam);

})();
