/**
 * handlers/hero/resolve.js
 *
 * Request:  { type:"hero", action:"resolve", userId, heros:[heroId1,heroId2,...], version:"1.0" }
 * Response: { _changeInfo: { _items: { "111": { _id:111, _num:<ABSOLUTE_BALANCE> } } } }
 *           _linkHeroes is optional — omitted for server (client handles gracefully)
 *
 * TASK SIDE-EFFECTS (2 jenis task):
 *
 *   1. MAIN task 6034 (task.json, decomposeHero, taskPara1=1):
 *      Jika curMainTask[0]._state === DOING(1) AND taskType === "decomposeHero"
 *      AND resolvedCount >= 1 → set _state = COMPLETE(2) + push mainTaskChange notify.
 *
 *   2. ACHIEVEMENT chain 6251→6252→6253→6254 (taskAchievement.json, decomposeHero,
 *      taskPara1=50/100/200/1000):
 *      Jika _taskProgress._achievements sudah di-init oleh getReward.js:
 *      - Walk chain dari 6251, find first non-FINISH entry (= active achievement)
 *      - Increment _curCount += resolvedCount
 *      - Jika _curCount >= taskPara1, ensure state = COMPLETE(2)
 *      Jika _taskProgress belum ada → SKIP (biarkan getReward init, BUG 12 fix).
 *
 * CLIENT ERROR HANDLING:
 *   Client callback (L106163, L172315, L173037) has NO error handler.
 *   ret=1 causes "Unknown Error" popup. ALL validation failures return ret=0
 *   with { _changeInfo: { _items: {} } } to avoid client crash.
 *
 * ============================================================
 * ANALYSIS EVIDENCE:
 * ============================================================
 *
 * [CALL SITE 1 — Altar Decompose] L106155-106164:
 *   requestDecomposeHero(heros) → processHandler({type:"hero",action:"resolve",userId,heros:e,version:"1.0"}, cb)
 *   cb(n):
 *     t.removeHero(e, n)
 *       → HerosManager.getInstance().removeHeroFromList(e[o])  for each hero
 *       → reads n._changeInfo._items
 *       → handles n._addHeroes (optional, for rebirth not decompose)
 *       → ItemsCommonSingleton.getInstance().openCommonItemGetTips(r, a, ...)
 *     n._linkHeroes && HerosManager.getInstance().setDecomposeHeroLink(n._linkHeroes)
 *
 * [CALL SITE 2 — SummonOneSuccess Decompose] L172307-172317:
 *   sendDesposeRequest() → processHandler({type:"hero",action:"resolve",userId,heros:alreadyHasHeros,version:"1.0"}, cb)
 *   cb(t):
 *     SummonSingleton.getInstance().playDisappearEffect(heroGroup, canDescArrIndex, alreadyHasHeros, t, true)
 *       → at end: UIWindowManager.openCongratulationObtain(t)
 *     e.removeHero(alreadyHasHeros)
 *
 * [CALL SITE 3 — SummonTenSuccess Decompose] L173029-1739:
 *   Same pattern as call site 2, with cardGroup instead of heroGroup
 *
 * [HERO_COLOR enum] L44620-44630:
 *   White=1, Green=2, Blue=3, Purple=4, Orange=5, SilverOrange=6, SuperOrange=7
 *
 * [colorToHeroColor] L53530-53554:
 *   "white"→1, "green"→2, "blue"→3, "purple"→4, "orange"→5,
 *   "flickerOrange"→6, "superOrange"→7
 *
 * [heroResolve.json]:
 *   quality 1 (white)       → resolveTo:111, num:1
 *   quality 2 (green)       → resolveTo:111, num:2
 *   quality 3 (blue)        → resolveTo:111, num:5
 *   quality 4 (purple)      → resolveTo:111, num:25
 *   quality 5 (orange)      → resolveTo:111, num:250
 *   quality 6 (flickerOrange)→ resolveTo:111, num:1000
 *   quality 7 (superOrange)  → resolveTo:111, num:5000
 *
 * [Item 111] thingsID.json: "soulStone" (灵魂石), thingsType:"basis"
 *
 * [SetHeroDataToModel] L85391-85417:
 *   heroQuality = HeroCommon.colorToHeroColor(hero.json[displayId].quality)
 *   Quality comes from hero.json, NOT stored in server hero data
 *
 * [User Data Hero Storage]:
 *   savedData.heros._heros = { <arbitraryKey>: { _heroId, _heroDisplayId, ... }, ... }
 *   Keys in _heros are NOT _heroId — they are arbitrary (sequential/random).
 *   Must ITERATE all entries and match by _heroId OR _heroDisplayId.
 *   Evidence: autoLevelUp.js findHeroInStorage (L596-605) iterates all keys
 *   and checks: hero._heroId === heroId || hero._heroDisplayId === Number(heroId)
 *
 * [Item Storage] (from previous handlers):
 *   savedData.totalProps._items = [{ _id, _num }, ...] (ARRAY)
 *   _changeInfo._items uses ABSOLUTE balance in _num
 *
 * [_linkHeroes] L85269-85275:
 *   Format: [ { hero: <fullHeroData>, basicAttr: <attrObj>, totalAttr: <attrObj> }, ... ]
 *   Used when decomposed hero was in a resonance link — linked heroes need stat recalculation
 *   For server: safely omitted (client checks n._linkHeroes && ... before using)
 *
 * [Summon Decompose Filter] L173026-173027:
 *   Only allows Purple (4) and below for summon decompose
 *   Altar decompose allows any quality (with confirmation dialog for orange+)
 *
 * [openCongratulationObtain] L56636-56651:
 *   Requires t._changeInfo or t._addHeroes etc. to show reward popup
 *   Reads t._changeInfo._items for item display
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.hero) {
        MainServer.handlers.hero = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    /** Quality string → heroResolve.json numeric key (matches colorToHeroColor L53530-53554) */
    var QUALITY_MAP = {
        'white': 1,
        'green': 2,
        'blue': 3,
        'purple': 4,
        'orange': 5,
        'flickerOrange': 6,
        'superOrange': 7
    };

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached — same pattern as buyCard.js)
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
            log.error('RESOURCE', 'hero/resolve failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'hero/resolve failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  USER DATA HELPERS (same pattern as buyCard.js / getVipReward.js)
    // ═══════════════════════════════════════════════════════════

    function getItemBalance(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                return;
            }
        }
        items.push({ _id: Number(itemId), _num: newBalance });
    }

    function addItems(savedData, itemId, amount) {
        var old = getItemBalance(savedData, itemId);
        var newVal = old + amount;
        setItemBalance(savedData, itemId, newVal);
        return newVal;
    }

    /**
     * findHeroInStorage — iterates ALL keys in _heros to find hero by _heroId or _heroDisplayId.
     * Keys in _heros are arbitrary (NOT _heroId), so direct lookup fails.
     * Pattern taken from autoLevelUp.js findHeroInStorage (L596-605) — VERIFIED WORKING.
     *
     * @param {Object} savedData — full user save
     * @param {string|number} heroId — the heroId passed by client (can be _heroId or _heroDisplayId)
     * @returns {{ hero: Object, key: string } | null}
     */
    function findHeroInStorage(savedData, heroId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return null;
        var heroes = savedData.heros._heros;
        for (var k in heroes) {
            if (!heroes.hasOwnProperty(k)) continue;
            var hero = heroes[k];
            if (hero._heroId === heroId || hero._heroId === Number(heroId) ||
                hero._heroDisplayId === Number(heroId) || String(hero._heroDisplayId) === String(heroId)) {
                return { hero: hero, key: k };
            }
        }
        return null;
    }

    /**
     * removeHeroFromUserData — finds hero by iterating, then deletes by its actual key.
     * @param {Object} savedData — full user save
     * @param {string|number} heroId — the heroId passed by client
     * @returns {boolean} true if hero was found and removed
     */
    function removeHeroFromUserData(savedData, heroId) {
        var found = findHeroInStorage(savedData, heroId);
        if (found) {
            delete savedData.heros._heros[found.key];
            return true;
        }
        return false;
    }

    /**
     * getHeroQualityNumber — converts hero.json quality string to numeric quality
     * Matches HeroCommon.colorToHeroColor (L53530-53554) + HERO_COLOR enum (L44620-44630)
     * @param {string} qualityStr — from hero.json, e.g. "white","green","blue","purple","orange","flickerOrange","superOrange"
     * @returns {number} 1-7, or 0 if unknown
     */
    function getHeroQualityNumber(qualityStr) {
        return QUALITY_MAP[qualityStr] || 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleResolve(request, callback) {
        // ═══════════════════════════════════════════════════════════
        //  OUTER SAFETY NET — client hero/resolve callback has NO
        //  error handler (L106163, L172315, L173037). ret=1 causes
        //  "Unknown Error" popup. Catch any uncaught exception and
        //  return ret=0 with valid empty _changeInfo to avoid crash.
        // ═══════════════════════════════════════════════════════════
        try {
            _handleResolveImpl(request, callback);
        } catch (err) {
            log.error('HANDLER', 'hero/resolve — UNCAUGHT EXCEPTION: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            // Return ret=0 with valid empty structure (client reads _changeInfo._items)
            callback({ _changeInfo: { _items: {} } });
        }
    }

    function _handleResolveImpl(request, callback) {
        var userId = request.userId;
        var heros = request.heros;

        log.info('HANDLER', 'hero/resolve — START v2 (task+achievement)');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['heros', JSON.stringify(heros || [])],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        // Client callback has NO error handler — ret=1 causes "Unknown Error".
        // Return ret=0 with valid empty _changeInfo on validation failure.
        if (!userId) {
            log.error('HANDLER', 'hero/resolve — missing userId');
            callback({ _changeInfo: { _items: {} } });
            return;
        }

        if (!heros || !Array.isArray(heros) || heros.length === 0) {
            log.error('HANDLER', 'hero/resolve — heros is empty or not an array');
            callback({ _changeInfo: { _items: {} } });
            return;
        }

        // ── LOAD CONFIG ──
        var heroResolveConfig = loadJson('heroResolve');
        if (!heroResolveConfig) {
            log.error('HANDLER', 'hero/resolve — failed to load heroResolve.json');
            callback({ _changeInfo: { _items: {} } });
            return;
        }

        var heroConfig = loadJson('hero');
        if (!heroConfig) {
            log.error('HANDLER', 'hero/resolve — failed to load hero.json');
            callback({ _changeInfo: { _items: {} } });
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HANDLER', 'hero/resolve — user data not found: ' + key);
            callback({ _changeInfo: { _items: {} } });
            return;
        }

        // Ensure heros structure exists
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        // ── PROCESS EACH HERO ──
        // Accumulate fragment rewards: { itemId: totalNum }
        var fragmentRewards = {};
        var resolvedCount = 0;
        var errors = [];

        for (var i = 0; i < heros.length; i++) {
            var heroId = heros[i];

            // 1. Look up hero in user data (iterate all keys — keys are arbitrary, NOT heroId)
            var found = findHeroInStorage(savedData, heroId);
            if (!found) {
                log.error('HANDLER', 'hero/resolve — hero not found in user data: ' + heroId);
                errors.push('hero_not_found:' + heroId);
                continue;
            }
            var heroData = found.hero;

            // 2. Get heroDisplayId
            var heroDisplayId = Number(heroData._heroDisplayId);
            if (!heroDisplayId) {
                log.error('HANDLER', 'hero/resolve — invalid _heroDisplayId for hero ' + heroId + ': ' + heroData._heroDisplayId);
                errors.push('invalid_displayId:' + heroId);
                continue;
            }

            // 3. Look up hero.json to get quality string
            var heroEntry = heroConfig[String(heroDisplayId)];
            if (!heroEntry) {
                log.error('HANDLER', 'hero/resolve — hero config not found for displayId: ' + heroDisplayId);
                errors.push('config_not_found:' + heroDisplayId);
                continue;
            }

            var qualityStr = heroEntry.quality; // e.g. "white", "green", "blue", "purple", "orange", "flickerOrange", "superOrange"

            // 4. Convert quality string → numeric key (1-7)
            var qualityNum = getHeroQualityNumber(qualityStr);
            if (!qualityNum) {
                log.error('HANDLER', 'hero/resolve — unknown quality "' + qualityStr + '" for hero displayId ' + heroDisplayId);
                errors.push('unknown_quality:' + qualityStr);
                continue;
            }

            // 5. Look up heroResolve.json[qualityNum] to get resolveTo item and num
            var resolveEntry = heroResolveConfig[String(qualityNum)];
            if (!resolveEntry) {
                log.error('HANDLER', 'hero/resolve — no resolve config for quality ' + qualityNum);
                errors.push('no_resolve_config:q' + qualityNum);
                continue;
            }

            var resolveToItemId = Number(resolveEntry.resolveTo); // 111 (soulStone)
            var fragmentNum = Number(resolveEntry.num) || 0;

            // 6. Accumulate fragments
            if (!fragmentRewards[resolveToItemId]) {
                fragmentRewards[resolveToItemId] = 0;
            }
            fragmentRewards[resolveToItemId] += fragmentNum;

            // 7. Remove hero from user data
            var removed = removeHeroFromUserData(savedData, heroId);
            if (removed) {
                resolvedCount++;
                log.info('HANDLER', 'hero/resolve — resolved hero ' + heroId + ' (displayId=' + heroDisplayId + ', quality=' + qualityStr + '/' + qualityNum + ') → +' + fragmentNum + ' x item ' + resolveToItemId);
            } else {
                log.error('HANDLER', 'hero/resolve — failed to remove hero ' + heroId + ' from user data');
                errors.push('remove_failed:' + heroId);
            }
        }

        // ── CHECK IF ANY HEROES WERE ACTUALLY RESOLVED ──
        // FIX: ret=1 causes client "Unknown Error" (no error handler at L106163).
        // Return ret=0 with valid empty _changeInfo so client removeHero() still runs.
        if (resolvedCount === 0) {
            log.error('HANDLER', 'hero/resolve — no heroes were resolved. Errors: '
                + JSON.stringify(errors) + ' — returning ret=0 with empty _changeInfo');
            callback({ _changeInfo: { _items: {} } });
            return;
        }

        // ── UPDATE ITEM BALANCES ──
        var changeItems = {};
        var rewardItemIds = Object.keys(fragmentRewards);
        for (var j = 0; j < rewardItemIds.length; j++) {
            var itemId = rewardItemIds[j];
            var amount = fragmentRewards[itemId];
            var newBalance = addItems(savedData, Number(itemId), amount);
            changeItems[itemId] = {
                _id: Number(itemId),
                _num: newBalance
            };
            log.info('HANDLER', 'hero/resolve — item ' + itemId + ': +' + amount + ' → new balance ' + newBalance);
        }

        // ════════════════════════════════════════════════════════
        //  MAIN TASK UPDATE — decomposeHero (task.json id=6034)
        // ════════════════════════════════════════════════════════
        //
        //  [TASK CONFIG] task.json id=6034:
        //    { type:"main", levelNeeded:29, taskType:"decomposeHero",
        //      taskPara1:1, nextTaskID:6035,
        //      reward1:103, num1:1300, reward2:111, num2:10 }
        //
        //  [CLIENT LISTENER] main.min.js L77080:
        //    "mainTaskChange" == n && UserInfoSingleton.getInstance().setMianTask(e._curMainTask)
        //
        //  [CLIENT STATE MACHINE] L62521-62525 setMianTask(e):
        //    for(var n in e) _mainTask._id = e[n]._id, _state = e[n]._state
        //
        //  [PATTERN] Identik dengan:
        //    - trial/checkBattleResult.js L427-468 (templeTestBattle)
        //    - arena/startBattle.js L1434-1535 (arena)
        //    - backpack/randSummons.js L501-553 (composeHero)
        //
        //  Logika:
        //    1. Cek savedData.curMainTask[0]._state === 1 (DOING)
        //    2. Load task.json[curMainTask[0]._id]
        //    3. Jika taskType === 'decomposeHero' DAN resolvedCount >= taskPara1
        //       → set _state = 2 (COMPLETE)
        //    4. Push mainTaskChange notify (client update UI realtime)
        //
        //  taskPara1=1 → setiap resolvedCount >= 1 langsung COMPLETE.
        //
        //  ══════════════════════════════════════════════════════
        //  JENIS TASK 2 — ACHIEVEMENT (taskAchievement.json chain 6251→6254)
        //  ══════════════════════════════════════════════════════
        //
        //  Chain:
        //    6251: decomposeHero taskPara1=50   (root)
        //    6252: decomposeHero taskPara1=100  (child of 6251)
        //    6253: decomposeHero taskPara1=200  (child of 6252)
        //    6254: decomposeHero taskPara1=1000 (child of 6253, terminal)
        //
        //  getReward.js initAchievementProgress (L395-429) sets ROOT (6251)
        //  to COMPLETE on first access (auto-complete pattern). Chain advances on claim.
        //
        //  HERE: Track REAL progress — increment _curCount on the ACTIVE
        //  achievement (first non-FINISH in chain). Compatible with server:
        //    - If state already COMPLETE (auto), _curCount goes above target (harmless)
        //    - If state is DOING (real tracking), _curCount increments toward target
        //    - If _curCount >= taskPara1, ensure state = COMPLETE
        //
        //  FIX BUG 12 (from arena/startBattle.js): JANGAN buat _taskProgress
        //  jika belum ada — biarkan getReward.js yang init pertama kali.
        //  Jika _taskProgress belum ada, SKIP achievement tracking.
        //
        var achievementUpdated = false;
        try {
            if (savedData._taskProgress && savedData._taskProgress._achievements) {
                var achieveCfg = loadJson('taskAchievement');
                if (achieveCfg) {
                    // Walk chain 6251 → 6252 → 6253 → 6254, find first non-FINISH
                    var chainStart = '6251';
                    var currentId = chainStart;
                    var activeId = null;
                    var activeEntry = null;
                    var activeCfg = null;
                    var safety = 0; // prevent infinite loop

                    while (currentId && achieveCfg[currentId] && safety < 10) {
                        safety++;
                        var entry = savedData._taskProgress._achievements[currentId];
                        if (!entry) {
                            // Not initialized yet — skip (getReward will init)
                            break;
                        }
                        if (Number(entry._state) !== 3) { // not FINISH
                            activeId = currentId;
                            activeEntry = entry;
                            activeCfg = achieveCfg[currentId];
                            break;
                        }
                        // FINISH → move to next in chain
                        var nextId = achieveCfg[currentId].nextTaskID;
                        currentId = nextId ? String(nextId) : null;
                    }

                    if (activeEntry && activeCfg && activeCfg.taskType === 'decomposeHero') {
                        var oldCount = Number(activeEntry._curCount) || 0;
                        var newCount = oldCount + resolvedCount;
                        var achieveTarget = Number(activeCfg.taskPara1) || 1;

                        activeEntry._curCount = newCount;

                        // Ensure state is at least COMPLETE if target reached
                        if (newCount >= achieveTarget && Number(activeEntry._state) < 2) {
                            activeEntry._state = 2; // COMPLETE
                        }

                        achievementUpdated = true;
                        log.info('HANDLER', 'hero/resolve — Achievement '
                            + activeId + ' (decomposeHero) _curCount: '
                            + oldCount + ' → ' + newCount
                            + ' / ' + achieveTarget
                            + ' (state=' + activeEntry._state + ')');
                    } else {
                        log.info('HANDLER', 'hero/resolve — No active decomposeHero achievement found'
                            + (activeId ? ' (activeId=' + activeId + ' but not decomposeHero)' : ' (all FINISH or not initialized)'));
                    }
                }
            } else {
                log.info('HANDLER', 'hero/resolve — _taskProgress not initialized yet, '
                    + 'skipping achievement tracking (getReward will init on first access)');
            }
        } catch (achieveErr) {
            log.error('HANDLER', 'hero/resolve — achievement tracking error: '
                + (achieveErr && achieveErr.message || achieveErr));
        }

        var taskUpdated = false;
        try {
            var cmt = savedData.curMainTask;
            var canCheckTask = cmt && Array.isArray(cmt) && cmt.length > 0
                && Number(cmt[0]._state) === 1; // TASK_STATE.DOING

            if (canCheckTask) {
                var taskCfg = loadJson('task');
                if (taskCfg) {
                    var mainTaskDef = taskCfg[String(cmt[0]._id)];
                    if (mainTaskDef && mainTaskDef.taskType === 'decomposeHero') {
                        var needCount = Number(mainTaskDef.taskPara1) || 1;

                        if (resolvedCount >= needCount) {
                            cmt[0]._state = 2; // TASK_STATE.COMPLETE
                            taskUpdated = true;

                            log.info('HANDLER', 'hero/resolve — Main task '
                                + cmt[0]._id + ' (decomposeHero) DOING → COMPLETE'
                                + ' (resolved ' + resolvedCount + '/' + needCount + ')');
                        } else {
                            log.info('HANDLER', 'hero/resolve — decomposeHero not yet — '
                                + resolvedCount + '/' + needCount);
                        }
                    }
                }
            }
        } catch (taskErr) {
            log.error('HANDLER', 'hero/resolve — task check error: '
                + (taskErr && taskErr.message || taskErr));
        }

        // ── SAVE USER DATA (termasuk perubahan curMainTask & achievement) ──
        db._set(key, savedData);
        log.info('HANDLER', 'hero/resolve — user data saved. Resolved '
            + resolvedCount + ' heroes.'
            + (taskUpdated ? ' [main task updated]' : '')
            + (achievementUpdated ? ' [achievement updated]' : ''));

        // ── PUSH mainTaskChange NOTIFY (setelah save agar state konsisten) ──
        // Format: { action:'mainTaskChange', _curMainTask:[{_id, _state}] }
        // Client L77080: setMianTask(e._curMainTask)
        // NOTE: cmt reference masih valid karena var adalah function-scoped.
        // Tapi kalau try throw sebelum assignment, cmt undefined — guard dgn taskUpdated.
        if (taskUpdated && typeof MainServer.notify === 'function') {
            try {
                MainServer.notify({
                    action: 'mainTaskChange',
                    _curMainTask: [{
                        _id: cmt[0]._id,
                        _state: 2 // TASK_STATE.COMPLETE
                    }]
                });
                log.info('HANDLER', 'hero/resolve — pushed mainTaskChange (state=2 COMPLETE)');
            } catch (notifyErr) {
                log.error('HANDLER', 'hero/resolve — notify failed: '
                    + (notifyErr && notifyErr.message || notifyErr));
            }
        }

        // ── BUILD RESPONSE ──
        // _linkHeroes is intentionally omitted for server.
        // Client code checks: n._linkHeroes && HerosManager.getInstance().setDecomposeHeroLink(n._linkHeroes)
        // so undefined/null is safely handled — the client's own removeHeroInResonance()
        // clears resonance slots client-side when removeHeroFromList() is called.
        var response = {
            _changeInfo: {
                _items: changeItems
            }
        };

        log.details('response', [
            ['_changeInfo._items', JSON.stringify(changeItems)],
            ['resolvedCount', String(resolvedCount)],
            ['errors', JSON.stringify(errors)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'resolve', handleResolve);

})();