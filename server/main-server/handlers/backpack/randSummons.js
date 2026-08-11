/**
 * handlers/backpack/randSummons.js — Hero Debris/Fragment Summon Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: backpack/randSummons
 * ============================================================
 *
 * Client call (main.min.js L119116-119139 — HeroDebrisSummon.summonBtnTimeTap):
 *   ts.processHandler({
 *     type: "backpack",
 *     action: "randSummons",
 *     userId: userId,
 *     itemId: choseitemID,
 *     num: mergeNum * currSummonCount,   // total fragments to consume
 *     version: "1.0"
 *   }, successCallback)
 *
 * Trigger: Player tap "Summon" pada HeroDebrisSummon window (fragment merge)
 *
 * TWO ITEM TYPES supported:
 *   1. heroPiece (heroPiece.json)       → fixed hero, belongTo = heroDisplayId
 *   2. randomHeroPiece (randomHeroPiece.json) → random hero from weighted pool
 *
 * Client priority (L119089-119098):
 *   randomHeroPiece[itemId] checked FIRST, then fallback to heroPiece[itemId]
 *
 * ============================================================
 * REQUEST FORMAT:
 * ============================================================
 * {
 *   type: "backpack",
 *   action: "randSummons",
 *   userId: "uuid",
 *   itemId: 2207,       // fragment/debris item ID
 *   num: 20,            // total fragments to consume (= mergeNum * summonCount)
 *   version: "1.0"
 * }
 *
 * ============================================================
 * RESPONSE FORMAT (VERIFIED from HAR — 5 samples):
 * ============================================================
 * {
 *   type: "backpack", action: "randSummons", userId: "...",
 *   itemId: "2320", num: 30, version: "1.0",
 *   _addHeroes: [
 *     {
 *       _heroId: "uuid-string",
 *       _heroDisplayId: 1320,
 *       _heroBaseAttr: { _level: 1, _evolveLevel: 0 },
 *       _heroStar: 0,
 *       _superSkillLevel: 0,
 *       _potentialLevel: {},
 *       _superSkillResetCount: 0,
 *       _potentialResetCount: 0,
 *       _qigong: { _items: {} },
 *       _qigongTmp: { _items: {} },
 *       _qigongTmpPower: 0,
 *       _qigongStage: 1,
 *       _breakInfo: { _breakLevel:1, _level:0, _attr:{_items:{}}, _version:"" },
 *       _totalCost: { _wakeUp:{_items:{}}, _earring:{_items:{}}, _levelUp:{_items:{}},
 *                     _evolve:{_items:{}}, _skill:{_items:{}}, _qigong:{_items:{}}, _heroBreak:{_items:{}} },
 *       _expeditionMaxLevel: 0,
 *       _gemstoneSuitId: 0,
 *       _linkTo: [],
 *       _linkFrom: "",
 *       _resonanceType: 0,
 *       _version: "202010131125"
 *     }
 *   ],
 *   _changeInfo: { _items: { "2320": { _id: 2320, _num: 0 } } }
 * }
 *
 * NOTES:
 *   - _addHeroes uses OBJECT format {_items:{}} for nested objects (NOT array {_items:[]})
 *   - _heroBaseAttr is MINIMAL: only _level + _evolveLevel (client fetches full stats via hero/getAttrs)
 *   - _heroId is UUID string (not number)
 *   - _changeInfo._items key = itemId as STRING
 *   - _changeInfo._items._num = REMAINING balance after deduction (ABSOLUTE, not delta)
 *
 * ============================================================
 * TASK ADVANCEMENT (composeHero):
 * ============================================================
 * Task 6005: { taskType:"composeHero", taskPara1:1, taskPara2:1207 }
 *   = "Summon 1 hero with heroDisplayId 1207"
 *
 * After adding heroes, check if curMainTask is composeHero type.
 * If so, count heroes matching taskPara2 in collection.
 * If count >= taskPara1 → advance state 1→2 (COMPLETE), push mainTaskChange.
 *
 * Pattern: same as autoLevelUp.js / checkBattleResult.js STEP 7e
 * ============================================================
 * CONFIG FILES USED:
 * ============================================================
 *   randomHeroPiece.json  — random fragment configs (30 entries)
 *     { id, quality, belongTo → randomHero ID, mergeNum }
 *   randomHero.json       — random hero definitions (30 entries)
 *     { id, quality, showIcon }
 *   randomHeroSummon.json — random hero pools per randomHero ID (7 pools)
 *     { "1811": [{ id, heroID, random (weight) }, ...] }
 *   heroPiece.json        — fixed fragment configs (159 entries)
 *     { id, belongTo → heroDisplayId, quality, mergeNum }
 *   task.json             — main task definitions
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;



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
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
            log.error('RESOURCE', 'randSummons failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'randSummons failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPERS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    /**
     * Get current item balance from totalProps._items (ARRAY format).
     * Client reads as ABSOLUTE value (SET, not +=).
     */
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
     * Set item balance to absolute value in totalProps._items.
     * If item exists → update _num. If not → add new entry.
     */
    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];

        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                items[i]._num = newBalance;
                return newBalance;
            }
        }
        items.push({ _id: itemId, _num: newBalance });
        return newBalance;
    }

    // ═══════════════════════════════════════════════════════════
    //  UUID GENERATOR
    // ═══════════════════════════════════════════════════════════

    function generateUUID() {
        // Simple UUID v4 — matches HAR format "41a6c076-cfbd-450b-a948-ebc082ed4ceb"
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO DATA BUILDER (minimal, matching HAR format)
    // ═══════════════════════════════════════════════════════════

    /**
     * buildHeroData(heroDisplayId)
     * Build minimal hero data object matching the exact HAR response format.
     * Client will fetch full stats via hero/getAttrs after receiving this.
     */
    function buildHeroData(heroDisplayId) {
        return {
            _heroId: generateUUID(),
            _heroDisplayId: Number(heroDisplayId),
            _heroBaseAttr: {
                _level: 1,
                _evolveLevel: 0
            },
            _heroStar: 0,
            _superSkillLevel: 0,
            _potentialLevel: {},
            _superSkillResetCount: 0,
            _potentialResetCount: 0,
            _qigong: { _items: {} },
            _qigongTmp: { _items: {} },
            _qigongTmpPower: 0,
            _qigongStage: 1,
            _breakInfo: {
                _breakLevel: 1,
                _level: 0,
                _attr: { _items: {} },
                _version: ""
            },
            _totalCost: {
                _wakeUp: { _items: {} },
                _earring: { _items: {} },
                _levelUp: { _items: {} },
                _evolve: { _items: {} },
                _skill: { _items: {} },
                _qigong: { _items: {} },
                _heroBreak: { _items: {} }
            },
            _expeditionMaxLevel: 0,
            _gemstoneSuitId: 0,
            _linkTo: [],
            _linkFrom: "",
            _resonanceType: 0,
            _version: "202010131125"
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  RANDOM HERO PICKER (for randomHeroPiece)
    // ═══════════════════════════════════════════════════════════

    /**
     * pickRandomHeroFromPool(randomHeroId)
     * Roll weighted random from randomHeroSummon[randomHeroId] pool.
     * Each entry: { id, heroID, random (weight) }
     *
     * @param {number} randomHeroId — e.g. 1811 (white random hero)
     * @returns {number|null} heroDisplayId
     */
    function pickRandomHeroFromPool(randomHeroId) {
        var rhs = loadJsonSync('randomHeroSummon');
        if (!rhs) return null;

        var pool = rhs[String(randomHeroId)];
        if (!pool || !Array.isArray(pool) || pool.length === 0) {
            log.error('RANDSUMMONS', 'No randomHeroSummon pool for randomHeroId=' + randomHeroId);
            return null;
        }

        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) {
            totalWeight += Number(pool[i].random) || 0;
        }

        if (totalWeight <= 0) {
            log.error('RANDSUMMONS', 'Total weight is 0 for randomHeroId=' + randomHeroId);
            return null;
        }

        var roll = Math.random() * totalWeight;
        var accumulated = 0;
        for (var j = 0; j < pool.length; j++) {
            accumulated += Number(pool[j].random) || 0;
            if (roll < accumulated) {
                return Number(pool[j].heroID);
            }
        }
        return Number(pool[pool.length - 1].heroID);
    }

    // ═══════════════════════════════════════════════════════════
    //  ADD HERO TO COLLECTION
    // ═══════════════════════════════════════════════════════════

    function addHeroToCollection(savedData, heroData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        var heros = savedData.heros._heros;
        var maxKey = -1;
        for (var k in heros) {
            if (heros.hasOwnProperty(k)) { var nk = Number(k); if (nk > maxKey) maxKey = nk; }
        }
        var heroKey = String(maxKey + 1);
        savedData.heros._heros[heroKey] = heroData;
        return heroKey;
    }

    // ═══════════════════════════════════════════════════════════
    //  FRAGMENT CONFIG LOOKUP
    // ═══════════════════════════════════════════════════════════

    /**
     * lookupFragmentConfig(itemId)
     * Cari itemId di randomHeroPiece.json dulu, lalu fallback heroPiece.json.
     * Return: { mergeNum, belongTo, isRandom } atau null.
     *
     * randomHeroPiece: belongTo = randomHero ID → random dari pool
     * heroPiece:       belongTo = heroDisplayId → fixed hero
     */
    function lookupFragmentConfig(itemId) {
        var rhp = loadJsonSync('randomHeroPiece');
        if (rhp && rhp[String(itemId)]) {
            var entry = rhp[String(itemId)];
            return {
                mergeNum: Number(entry.mergeNum) || 10,
                belongTo: Number(entry.belongTo) || 0,
                isRandom: true,
                quality: entry.quality || ''
            };
        }

        var hp = loadJsonSync('heroPiece');
        if (hp && hp[String(itemId)]) {
            var entry2 = hp[String(itemId)];
            return {
                mergeNum: Number(entry2.mergeNum) || 10,
                belongTo: Number(entry2.belongTo) || 0,
                isRandom: false,
                quality: entry2.quality || ''
            };
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    /**
     * handleRandSummons(request, callback)
     *
     * Hero fragment merge / random summon handler.
     *
     * Request:
     *   { type:"backpack", action:"randSummons",
     *     userId, itemId, num, version:"1.0" }
     *
     * Response:
     *   _addHeroes   — Array<HeroData> (1 hero per mergeNum consumed)
     *   _changeInfo  — { _items: { "itemId": { _id, _num (remaining) } } }
     */
    function handleRandSummons(request, callback) {
        var userId = request.userId;
        var itemId = Number(request.itemId) || 0;
        var num = Number(request.num) || 0;

        log.info('HANDLER', 'backpack/randSummons — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['itemId', String(itemId)],
            ['num', String(num)],
            ['version', request.version || '-']
        ]);

        // ── Validate ──
        if (!userId) {
            log.error('HANDLER', 'backpack/randSummons — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }
        if (!itemId) {
            log.error('HANDLER', 'backpack/randSummons — missing itemId');
            callback({ _error: 'missing_itemId' }, 1);
            return;
        }
        if (num <= 0) {
            log.error('HANDLER', 'backpack/randSummons — invalid num: ' + num);
            callback({ _error: 'invalid_num' }, 1);
            return;
        }

        // ── Lookup fragment config ──
        var fragCfg = lookupFragmentConfig(itemId);
        if (!fragCfg) {
            log.error('HANDLER', 'backpack/randSummons — itemId not found in heroPiece or randomHeroPiece: ' + itemId);
            callback({ _error: 'item_not_found' }, 1);
            return;
        }

        var mergeNum = fragCfg.mergeNum;
        var heroCount = Math.floor(num / mergeNum);
        var remainingFragments = num % mergeNum;

        if (heroCount <= 0) {
            log.warn('HANDLER', 'backpack/randSummons — num (' + num + ') < mergeNum (' + mergeNum + '), cannot summon');
            callback({ _error: 'not_enough_fragments' }, 1);
            return;
        }

        log.details('fragmentConfig', [
            ['itemId', String(itemId)],
            ['isRandom', String(fragCfg.isRandom)],
            ['quality', fragCfg.quality],
            ['belongTo', String(fragCfg.belongTo)],
            ['mergeNum', String(mergeNum)],
            ['num', String(num)],
            ['heroCount', String(heroCount)],
            ['remainingFragments', String(remainingFragments)]
        ]);

        // ── Load user data ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('HANDLER', 'backpack/randSummons — user data not found: ' + storageKey);
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        // ── Check item balance ──
        var currentBalance = getItemBalance(savedData, itemId);
        if (currentBalance < num) {
            log.warn('HANDLER', 'backpack/randSummons — not enough fragments: need ' + num + ' of ' + itemId + ', have ' + currentBalance);
            callback({ _error: 'not_enough_items' }, 1);
            return;
        }

        // ══════════════════════════════════════════════════════════
        //  GENERATE HEROES
        // ══════════════════════════════════════════════════════════

        var addHeroes = [];

        for (var i = 0; i < heroCount; i++) {
            var heroDisplayId;

            if (fragCfg.isRandom) {
                // Random hero — roll from randomHeroSummon pool
                heroDisplayId = pickRandomHeroFromPool(fragCfg.belongTo);
                if (!heroDisplayId) {
                    log.error('HANDLER', 'backpack/randSummons — failed to pick random hero for randomHeroId=' + fragCfg.belongTo);
                    callback({ _error: 'random_hero_failed' }, 1);
                    return;
                }
            } else {
                // Fixed hero — belongTo = heroDisplayId
                heroDisplayId = fragCfg.belongTo;
            }

            var heroData = buildHeroData(heroDisplayId);
            if (!heroData) {
                log.error('HANDLER', 'backpack/randSummons — failed to build hero data for displayId=' + heroDisplayId);
                callback({ _error: 'hero_build_failed' }, 1);
                return;
            }

            // Add hero to player collection
            addHeroToCollection(savedData, heroData);
            addHeroes.push(heroData);

            log.details('heroSummoned', [
                ['index', String(i + 1)],
                ['heroId', heroData._heroId],
                ['heroDisplayId', String(heroDisplayId)],
                ['isRandom', String(fragCfg.isRandom)]
            ]);
        }

        // ══════════════════════════════════════════════════════════
        //  DEDUCT ITEM BALANCE
        // ══════════════════════════════════════════════════════════

        var newBalance = currentBalance - (heroCount * mergeNum);
        setItemBalance(savedData, itemId, newBalance);

        // ══════════════════════════════════════════════════════════
        //  SAVE TO DATABASE
        // ══════════════════════════════════════════════════════════

        db._set(storageKey, savedData);

        // ══════════════════════════════════════════════════════════
        //  CHECK & ADVANCE MAIN TASK (composeHero)
        // ══════════════════════════════════════════════════════════
        //
        // Task 6005: { taskType:"composeHero", taskPara1:1, taskPara2:1207 }
        //   = "Summon 1 hero with heroDisplayId 1207"
        //
        // Pola sama dengan checkBattleResult.js STEP 7e & autoLevelUp.js

        try {
            var cmt = savedData.curMainTask;
            var canCheck = cmt && Array.isArray(cmt) && cmt.length > 0 && cmt[0]._state === 1;

            if (canCheck) {
                var taskCfg = loadJsonSync('task');
                var mainTaskDef = taskCfg && taskCfg[cmt[0]._id];

                if (mainTaskDef && mainTaskDef.taskType === 'composeHero') {
                    var needCount = Number(mainTaskDef.taskPara1) || 0;
                    var needHeroDisplayId = Number(mainTaskDef.taskPara2) || 0;

                    // Count heroes matching heroDisplayId in collection
                    var heroes = savedData.heros && savedData.heros._heros;
                    var matchCount = 0;

                    if (heroes) {
                        for (var hk in heroes) {
                            if (!heroes.hasOwnProperty(hk)) continue;
                            var hDisplayId = Number(heroes[hk]._heroDisplayId) || 0;
                            if (hDisplayId === needHeroDisplayId) {
                                matchCount++;
                            }
                        }
                    }

                    if (matchCount >= needCount) {
                        cmt[0]._state = 2; // COMPLETE

                        log.info('TASK', 'Task ' + cmt[0]._id + ' DOING → COMPLETE (composeHero)');
                        log.details('taskMatch', [
                            ['taskId', String(cmt[0]._id)],
                            ['needHeroDisplayId', String(needHeroDisplayId)],
                            ['needCount', String(needCount)],
                            ['matchCount', String(matchCount)]
                        ]);

                        // Push mainTaskChange → client L77080: setMianTask(e._curMainTask)
                        if (typeof MainServer.notify === 'function') {
                            MainServer.notify({
                                action: 'mainTaskChange',
                                _curMainTask: [{ _id: cmt[0]._id, _state: 2 }]
                            });
                            log.info('TASK', 'Pushed mainTaskChange state=2');
                        }
                    } else {
                        log.info('TASK', 'composeHero not yet — have ' + matchCount + '/' + needCount + ' of heroDisplayId ' + needHeroDisplayId);
                    }
                }
            }
        } catch (taskErr) {
            log.warn('TASK', 'composeHero check error: ' + (taskErr.message || taskErr));
        }

        // ══════════════════════════════════════════════════════════
        //  BUILD RESPONSE (exact HAR format)
        // ══════════════════════════════════════════════════════════

        var changeInfo = {};
        changeInfo[String(itemId)] = { _id: itemId, _num: newBalance };

        var response = {
            type: 'backpack',
            action: 'randSummons',
            userId: userId,
            itemId: String(itemId),
            num: num,
            version: '1.0',
            _addHeroes: addHeroes,
            _changeInfo: {
                _items: changeInfo
            }
        };

        log.info('HANDLER', 'backpack/randSummons SUCCESS');
        log.details('result', [
            ['userId', userId],
            ['itemId', String(itemId)],
            ['num', String(num)],
            ['heroCount', String(heroCount)],
            ['consumed', String(heroCount * mergeNum)],
            ['remainingBalance', String(newBalance)]
        ]);

        callback(response, 0);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('backpack', 'randSummons', handleRandSummons);
})();
