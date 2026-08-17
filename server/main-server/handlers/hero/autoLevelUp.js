/**
 * handlers/hero/autoLevelUp.js — Hero Auto Level-Up Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: hero/autoLevelUp
 * ============================================================
 *
 * Client call (main.min.js):
 *   ts.processHandler({
 *     type: 'hero', action: 'autoLevelUp',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     heroId: choseHeroId,
 *     version: '1.0',
 *     times: 1    // 1 = single, 100 = auto/max
 *   }, callback(response))
 *
 * Response callback (main.min.js levelUpCallBack):
 *   1. setHeroLevelUpDataChange(response, hero)
 *      → response._heroLevel → hero.heroBaseAttr.level = response._heroLevel
 *      → response._evolveLevel → hero.heroBaseAttr.evolveLevel (ONLY if present)
 *   2. setTotalAttrs(response, hero)
 *      → setBaseAttr(response._baseAttr, hero) — reads _baseAttr._items (OBJECT)
 *        Client applies talent: hp *= talent, attack *= talent
 *      → reads _totalAttr._items (OBJECT) → hero.totalAttr
 *      → setTotalCost(response._totalCost, hero) — 7 sections
 *   3. resetTtemsCallBack(response) — reads _changeInfo._items (ABSOLUTE balances)
 *
 * ============================================================
 * RESPONSE FORMAT (VERIFIED from HAR & main.min.js)
 * ============================================================
 * {
 *   type: 'hero', action: 'autoLevelUp', userId, heroId, version: '1.0', times,
 *   _heroLevel: 2,
 *   _totalAttr: { _items: { "0":{_id:0,_num:val}, ... } },  // 42 items, OBJECT
 *   _baseAttr: { _items: { "0":{_id:0,_num:val}, ... } },  // 35 items, OBJECT
 *   _totalCost: {
 *     _wakeUp:    { _items: {} },
 *     _earring:   { _items: {} },
 *     _levelUp:   { _items: { "102":{_id:102,_num:93}, "131":{_id:131,_num:20} } },
 *     _evolve:    { _items: {} },
 *     _skill:     { _items: {} },
 *     _qigong:    { _items: {} },
 *     _heroBreak: { _items: {} }
 *   },
 *   _changeInfo: { _items: { "102":{_id:102,_num:165398}, "131":{_id:131,_num:29778} } },
 *   _linkHeroesTotalAttr: {},
 *   _linkHeroesBasicAttr: {}
 * }
 *
 * _changeInfo = ABSOLUTE balance after deduction (client does setItem(id, num))
 * _totalCost._levelUp = cost of THIS action (NOT accumulated)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;
    var heroStats = MainServer.heroStats;
    var loadJson = heroStats.loadJson;

    if (!MainServer.handlers.hero) {
        MainServer.handlers.hero = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM ID CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var ITEM_IDS = {
        GOLDID: 102,
        EXPERIENCECAPSULEID: 131
    };

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE HELPERS (using centralized loadJson from heroStats.js)
    // ═══════════════════════════════════════════════════════════

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJson('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getHeroEvolve(heroId) {
        var ev = loadJson('heroEvolve');
        return ev ? ev[String(heroId)] : null;
    }

    function getHeroLevelUpCost(quality, level) {
        var costTable = loadJson('heroLevelUp' + capitalize(quality));
        if (!costTable) return null;
        return costTable[String(level)] || null;
    }

    function getHeroMaxLevel(displayId) {
        var id = String(displayId);
        var bookRed = loadJson('heroBookRed');
        if (bookRed && bookRed[id]) {
            return parseInt(bookRed[id].level, 10) || 0;
        }
        var book = loadJson('heroBook');
        if (book && book[id]) {
            return parseInt(book[id].level, 10) || 0;
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM HELPERS
    // ═══════════════════════════════════════════════════════════

    function getItemNum(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        // Support both array and object formats
        if (Array.isArray(items)) {
            for (var i = 0; i < items.length; i++) {
                if (items[i]._id === itemId) return Number(items[i]._num) || 0;
            }
        } else {
            for (var key in items) {
                if (items[key]._id === itemId) return Number(items[key]._num) || 0;
            }
        }
        return 0;
    }

    function deductItem(savedData, itemId, amount) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        var item = null;
        if (Array.isArray(items)) {
            for (var i = 0; i < items.length; i++) {
                if (items[i]._id === itemId) { item = items[i]; break; }
            }
        } else {
            for (var key in items) {
                if (items[key]._id === itemId) { item = items[key]; break; }
            }
        }
        if (!item) return 0;
        var current = Number(item._num) || 0;
        var deduct = Math.min(current, amount);
        item._num = current - deduct;
        return deduct;
    }

    // ═══════════════════════════════════════════════════════════
    //  RESPONSE BUILDERS
    // ═══════════════════════════════════════════════════════════

    function buildEmptyTotalCost() {
        return {
            _wakeUp:    { _items: {} },
            _earring:   { _items: {} },
            _levelUp:   { _items: {} },
            _evolve:    { _items: {} },
            _skill:     { _items: {} },
            _qigong:    { _items: {} },
            _heroBreak: { _items: {} }
        };
    }

    /**
     * buildChangeInfo(savedData)
     * Returns ABSOLUTE balances of affected items after deduction.
     * Client: setItem(id, num) → this.items[id] = num
     */
    function buildChangeInfo(savedData) {
        var items = {};
        var exp = getItemNum(savedData, ITEM_IDS.EXPERIENCECAPSULEID);
        var gold = getItemNum(savedData, ITEM_IDS.GOLDID);
        items[String(ITEM_IDS.EXPERIENCECAPSULEID)] = { _id: ITEM_IDS.EXPERIENCECAPSULEID, _num: exp };
        items[String(ITEM_IDS.GOLDID)] = { _id: ITEM_IDS.GOLDID, _num: gold };
        return items;
    }

    /**
     * Build the standard response object.
     * Stats come from heroStats.computeHeroStats (full 7-step pipeline).
     */
    function buildResponse(userId, heroId, times, newLevel, totalCost, savedData) {
        var statResult = heroStats.computeHeroStats(heroId, savedData);

        if (!statResult) {
            log.warn('HANDLER', 'hero/autoLevelUp — computeHeroStats returned null for heroId: ' + heroId);
            return {};
        }

        return {
            type: 'hero',
            action: 'autoLevelUp',
            userId: userId,
            heroId: heroId,
            version: '1.0',
            times: times,
            _heroLevel: newLevel,
            _totalAttr: { _items: statResult.totalItems },
            _baseAttr: { _items: statResult.baseItems },
            _totalCost: totalCost,
            _changeInfo: { _items: buildChangeInfo(savedData) },
            _linkHeroesTotalAttr: {},
            _linkHeroesBasicAttr: {}
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hero/autoLevelUp
    // ═══════════════════════════════════════════════════════════

    function handleAutoLevelUp(request, callback) {
        var userId = request.userId;
        var heroId = request.heroId;
        var times = Number(request.times) || 1;

        log.info('HANDLER', 'hero/autoLevelUp processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['heroId', heroId || '-'],
            ['times', String(times)],
            ['version', request.version || '-']
        ]);

        try {
            // ── 1. Validate ──
            if (!userId || !heroId) {
                log.warn('HANDLER', 'hero/autoLevelUp — missing userId or heroId');
                callback({});
                return;
            }

            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);
            if (!savedData) {
                log.warn('HANDLER', 'hero/autoLevelUp — user data not found');
                callback({});
                return;
            }

            // ── 2. Find hero (centralized from heroStats.js) ──
            var found = heroStats.findHeroInStorage(savedData, heroId);
            if (!found || !found.hero) {
                log.warn('HANDLER', 'hero/autoLevelUp — hero not found: ' + heroId);
                callback({});
                return;
            }

            var hero = found.hero;
            var displayId = hero._heroDisplayId || Number(hero._heroId);
            var hc = getHeroConfig(displayId);
            var quality = (hc && hc.quality) || 'purple';
            var baseAttr = hero._heroBaseAttr || {};
            var currentLevel = Number(baseAttr._level) || 1;
            var evolveLevel = Number(baseAttr._evolveLevel) || 0;
            var starLevel = Number(hero._heroStar) || 0;

            log.details('hero_state', [
                ['displayId', String(displayId)],
                ['quality', quality],
                ['currentLevel', String(currentLevel)],
                ['evolveLevel', String(evolveLevel)],
                ['starLevel', String(starLevel)]
            ]);

            // ── 3. Max level check ──
            var maxLevel = getHeroMaxLevel(displayId);
            if (maxLevel > 0 && currentLevel >= maxLevel) {
                log.info('HANDLER', 'hero/autoLevelUp — already at max level: ' + maxLevel);
                callback(buildResponse(userId, heroId, times, currentLevel, buildEmptyTotalCost(), savedData));
                return;
            }

            // ── 4. Calculate effective max times (respect max level + evolve blocking) ──
            var effectiveMaxLevel = maxLevel > 0 ? maxLevel : 9999;
            var targetTimes = Math.min(times, effectiveMaxLevel - currentLevel);

            for (var checkLevel = currentLevel; checkLevel < currentLevel + targetTimes; checkLevel++) {
                var evEntries = getHeroEvolve(displayId) || [];
                for (var ei = 0; ei < evEntries.length; ei++) {
                    var ev = evEntries[ei];
                    if (Number(ev.level) === checkLevel && checkLevel > evolveLevel) {
                        targetTimes = Math.min(targetTimes, checkLevel - currentLevel);
                        break;
                    }
                }
                if (targetTimes <= 0) break;
            }

            if (targetTimes <= 0) {
                log.info('HANDLER', 'hero/autoLevelUp — blocked by evolve/star at level ' + currentLevel);
                callback(buildResponse(userId, heroId, times, currentLevel, buildEmptyTotalCost(), savedData));
                return;
            }

            // ── 5. Calculate cost per level & check resources ──
            var qualityIndex = { white: 1, green: 2, blue: 3, purple: 4, orange: 5, flickerOrange: 6, superOrange: 7 };
            var qIndex = qualityIndex[quality] || 4;
            var levelUpMulTable = loadJson('heroLevelUpMul');

            var currentExpBalance = getItemNum(savedData, ITEM_IDS.EXPERIENCECAPSULEID);
            var currentGoldBalance = getItemNum(savedData, ITEM_IDS.GOLDID);

            var actualTimes = 0;
            var totalExpCost = 0;
            var totalGoldCost = 0;

            for (var t = 0; t < targetTimes; t++) {
                var lvl = currentLevel + t;
                var costEntry = getHeroLevelUpCost(quality, lvl);
                if (!costEntry) break;

                var singleExp = Number(costEntry.num1) || 0;
                var singleGold = Number(costEntry.num2) || 0;

                // Apply heroLevelUpMul multiplier (per evolveLevel)
                if (levelUpMulTable) {
                    var mulEntries = levelUpMulTable[String(qIndex)];
                    if (Array.isArray(mulEntries)) {
                        for (var mi = 0; mi < mulEntries.length; mi++) {
                            var mul = mulEntries[mi];
                            if (Number(mul.evolveLevel) === evolveLevel) {
                                var mulVal = Number(mul.hpMul) || 1;
                                singleExp = Math.floor(singleExp * mulVal);
                                singleGold = Math.floor(singleGold * mulVal);
                                break;
                            }
                        }
                    }
                }

                // Check if player can afford
                if (totalExpCost + singleExp > currentExpBalance) break;
                if (totalGoldCost + singleGold > currentGoldBalance) break;

                totalExpCost += singleExp;
                totalGoldCost += singleGold;
                actualTimes++;
            }

            if (actualTimes === 0) {
                log.info('HANDLER', 'hero/autoLevelUp — not enough resources');
                callback(buildResponse(userId, heroId, times, currentLevel, buildEmptyTotalCost(), savedData));
                return;
            }

            // ── 6. Deduct costs ──
            deductItem(savedData, ITEM_IDS.EXPERIENCECAPSULEID, totalExpCost);
            deductItem(savedData, ITEM_IDS.GOLDID, totalGoldCost);

            // ── 7. Update hero level ──
            var newLevel = currentLevel + actualTimes;
            baseAttr._level = newLevel;

            // ── 8. Accumulate _totalCost into hero data (for reborn refund) ──
            if (!found.hero._totalCost) {
                found.hero._totalCost = buildEmptyTotalCost();
            }
            if (totalExpCost > 0 || totalGoldCost > 0) {
                var lvlUp = found.hero._totalCost._levelUp;
                if (!lvlUp) {
                    found.hero._totalCost._levelUp = { _items: {} };
                    lvlUp = found.hero._totalCost._levelUp;
                }
                if (!lvlUp._items) lvlUp._items = {};
                if (totalExpCost > 0) {
                    var expKey = String(ITEM_IDS.EXPERIENCECAPSULEID);
                    var expOld = lvlUp._items[expKey] ? Number(lvlUp._items[expKey]._num) : 0;
                    lvlUp._items[expKey] = { _id: ITEM_IDS.EXPERIENCECAPSULEID, _num: expOld + totalExpCost };
                }
                if (totalGoldCost > 0) {
                    var goldKey = String(ITEM_IDS.GOLDID);
                    var goldOld = lvlUp._items[goldKey] ? Number(lvlUp._items[goldKey]._num) : 0;
                    lvlUp._items[goldKey] = { _id: ITEM_IDS.GOLDID, _num: goldOld + totalGoldCost };
                }
            }

            // ── 9. Save ──
            db._set(storageKey, savedData);

            // ── 10. Check & advance main task (upGradeHeroLevel) ──
            try {
                var cmt = savedData.curMainTask;
                var canCheck = cmt && Array.isArray(cmt) && cmt.length > 0 && cmt[0]._state === 1;

                if (canCheck) {
                    var tcCfg = loadJson('task');
                    var tcDef = tcCfg && tcCfg[cmt[0]._id];

                    if (tcDef && tcDef.taskType === 'upGradeHeroLevel') {
                        var tcNeedCount = Number(tcDef.taskPara1) || 0;
                        var tcNeedLevel = Number(tcDef.taskPara2) || 0;
                        var tcHeroes = savedData.heros && savedData.heros._heros;
                        var tcCount = 0;

                        if (tcHeroes) {
                            for (var tcK in tcHeroes) {
                                if (!tcHeroes.hasOwnProperty(tcK)) continue;
                                var tcH = tcHeroes[tcK];
                                var tcLvl = Number((tcH._heroBaseAttr && tcH._heroBaseAttr._level) || 0);
                                if (tcLvl >= tcNeedLevel) tcCount++;
                            }
                        }

                        if (tcCount >= tcNeedCount) {
                            cmt[0]._state = 2;
                            log.info('TASK', 'Task ' + cmt[0]._id + ' DOING → COMPLETE (upGradeHeroLevel)');
                            log.details('taskMatch', [
                                ['taskId', String(cmt[0]._id)],
                                ['needCount', String(tcNeedCount)],
                                ['needLevel', String(tcNeedLevel)],
                                ['heroCount', String(tcCount)]
                            ]);

                            if (typeof MainServer.notify === 'function') {
                                MainServer.notify({
                                    action: 'mainTaskChange',
                                    _curMainTask: [{ _id: cmt[0]._id, _state: 2 }]
                                });
                                log.info('TASK', 'Pushed mainTaskChange state=2');
                            }
                        } else {
                            log.info('TASK', 'upGradeHeroLevel not yet — have ' + tcCount + '/' + tcNeedCount + ' heroes at level ' + tcNeedLevel);
                        }
                    }
                }
            } catch (tcErr) {
                log.warn('TASK', 'upGradeHeroLevel check error: ' + (tcErr.message || tcErr));
            }

            // ── 11. Build _totalCost for response (cost of THIS action only) ──
            var levelUpCostItems = {};
            if (totalExpCost > 0) {
                levelUpCostItems[String(ITEM_IDS.EXPERIENCECAPSULEID)] = {
                    _id: ITEM_IDS.EXPERIENCECAPSULEID, _num: totalExpCost
                };
            }
            if (totalGoldCost > 0) {
                levelUpCostItems[String(ITEM_IDS.GOLDID)] = {
                    _id: ITEM_IDS.GOLDID, _num: totalGoldCost
                };
            }

            var totalCost = buildEmptyTotalCost();
            totalCost._levelUp = { _items: levelUpCostItems };

            // ── 12. Build response (stats from heroStats.js centralized compute) ──
            log.info('HANDLER', 'hero/autoLevelUp success');
            log.details('result', [
                ['heroId', heroId],
                ['oldLevel', String(currentLevel)],
                ['newLevel', String(newLevel)],
                ['actualTimes', String(actualTimes)],
                ['expCost', String(totalExpCost)],
                ['goldCost', String(totalGoldCost)],
                ['expBalance', String(currentExpBalance - totalExpCost)],
                ['goldBalance', String(currentGoldBalance - totalGoldCost)]
            ]);

            callback(buildResponse(userId, heroId, times, newLevel, totalCost, savedData));

        } catch (err) {
            log.error('HANDLER', 'hero/autoLevelUp UNCAUGHT ERROR', err);
            callback({});
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'autoLevelUp', handleAutoLevelUp);

})();
