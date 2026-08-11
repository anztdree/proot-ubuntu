/**
 * handlers/cellGame/checkBattleResult.js — Cell Game Check Battle Result (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: cellGame/checkBattleResult
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Process hasil ShaLu battle. Determine WIN/LOSE dari checkResult (hero HP).
 *   WIN → give rewards + advance curEnemy/curLevel + trigger task 6040.
 *   LOSE → save hero HP state, no rewards.
 *
 *   ShaLu battle = 1v1 sequential (hero #1 fight boss, lalu hero #2, dst).
 *   checkBattleResult dipanggil:
 *     1. INTERMEDIATE (hero switch): hero mati, hero berikutnya lanjut.
 *        Response TIDAK dibaca client (L68534-68542).
 *     2. FINAL WIN: boss mati. Response dibaca untuk rewards + summary (L64993-65009).
 *     3. FINAL LOSE: semua hero mati. Response dibaca untuk summary (L64993-65009).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [L64984-65012] shaLuGameBattle battleEndFnc (FINAL WIN/LOSE):
 *     ts.processHandler({
 *         type: "cellGame",
 *         action: "checkBattleResult",
 *         userId, battleId, version: "1.0",
 *         "super": t,              // super skills used
 *         checkResult: n,          // [{ hero, hp }, ...]
 *         battleField: BattleLogic.GameFieldType.CELLGAME
 *     }, function(t) {
 *         var n = e.getBattleAwardItems(t);   // reads t._changeInfo._items
 *         UIWindowManager.openShaLuGame(0 == t._battleResult);  // 0=WIN
 *         var s = OpenGotoBattlePage.getBattleTypeWithResult(!0, !0, t._battleResult);
 *         ViewCommon.setSummaryPage(s, { items: n, ... });
 *     })
 *
 *   [L68525-68542] ShaluBattle.startShaLu (INTERMEDIATE hero switch):
 *     Same request, callback:
 *     function(a) {
 *         e.clean(), BattleLogic.BattleTeamManager.Clean(), n._shaluIndex++;
 *         // resume battle with next hero — response TIDAK dibaca
 *     }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EVIDENCE: BUKTI BUKAN ASUMSI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * [getBattleAwardItems] L63394-63412:
 *   e._changeInfo && (n = e._changeInfo._items);
 *   → Response MUST have _changeInfo._items for WIN
 *
 * [getBattleTypeWithResult] L159829-159831:
 *   0 == n → pveSuccess (WIN)
 *   1 == n → defeated (LOSE)
 *   → _battleResult: 0=WIN, 1=LOSE
 *
 * [openShaLuGame] L64998:
 *   UIWindowManager.openShaLuGame(0 == t._battleResult)
 *   → 0=WIN (open ShaLuGame with success), 1=LOSE
 *
 * [checkResult format] L68510-68516:
 *   for(var l in e.heroHealthMap) {
 *       s.push({ hero: l, hp: u });
 *   }
 *   → checkResult = [{ hero: <heroId>, hp: <remainingHp> }, ...]
 *
 * [ShaLuPassSuccessViewData] L109218-109222:
 *   t = BossPartManager.getInstance().getCellGameModelData();
 *   n = t.passLevel;
 *   t.haveBeatLastLessonToday ? ... : ...
 *   → passLevel + haveBeatLastLessonToday dibaca dari CellGameModel setelah WIN
 *
 * [task.json id=6040]:
 *   { type:"main", levelNeeded:32, taskType:"cellGameBattle",
 *     taskPara1:1, nextTaskID:6041 }
 *   → "Win 1 Cell Game battle" → COMPLETE on WIN
 *
 * [cellGame/startBattle.js] (sibling handler):
 *   State saved: cellGameState._currentBattle = {
 *     battleId, enemyDisplayId, enemyLevel, curLevel, curEnemy, isFinal,
 *     totalDamage, rewards: [{ itemId, num }], levelChestId, timestamp
 *   }
 *
 * [dungeon/checkBattleResult.js] (existing pattern L555-588):
 *   WIN/LOSE determination:
 *     - checkResult empty → LOSE
 *     - all hero HP=0 → LOSE
 *     - else → WIN
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TASK INVOLVEMENT (task.json id=6040, cellGameBattle)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   MAIN task 6040: cellGameBattle, taskPara1=1
 *   → "Win 1 Cell Game battle"
 *   → Pada WIN: jika curMainTask[0]._state === DOING(1) AND taskType === "cellGameBattle"
 *     → set _state = COMPLETE(2) + push mainTaskChange notify
 *
 *   Pattern IDENTIK dengan:
 *     - hero/resolve.js (decomposeHero, MAIN 6034)
 *     - trial/checkBattleResult.js (templeTestBattle, MAIN 6024)
 *     - shop/buy.js (soulShopBuy, MAIN 6035)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REQUEST FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   {
 *     type: "cellGame",
 *     action: "checkBattleResult",
 *     userId: <string>,
 *     battleId: <string>,
 *     version: "1.0",
 *     "super": [<superSkillId>, ...],
 *     checkResult: [{ hero: <heroId>, hp: <remainingHp> }, ...],
 *     battleField: <number>  // BattleLogic.GameFieldType.CELLGAME
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   WIN:
 *   {
 *     _battleResult: 0,
 *     _changeInfo: {
 *       _items: { "<itemId>": { _id, _num }, ... }   // ABSOLUTE balances
 *     }
 *   }
 *
 *   LOSE:
 *   {
 *     _battleResult: 1
 *     // NO _changeInfo
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STORAGE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   User data key: ms_user_<userId>_1
 *   Field: savedData.cellGameState = {
 *     _curLevel, _curEnemy, _passLevel, _yesterdayLevel,
 *     _haveBeatLastLessonToday, _buyTimes, _heroes, _lastHeroes,
 *     _currentBattle  ← saved by startBattle, consumed/cleared here
 *   }
 *
 *   On WIN:
 *     _curEnemy: 1-7 → _curEnemy++ | 8 → _curLevel++, _curEnemy=1
 *     _passLevel: max(_passLevel, _curLevel)
 *     _haveBeatLastLessonToday: true if final boss (curEnemy was 8)
 *     _heroes: update HP dari checkResult
 *     _currentBattle: cleared (set to null)
 *
 *   On LOSE:
 *     _heroes: update HP dari checkResult (some may be 0)
 *     _currentBattle: cleared (set to null)
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
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var ATTR_HR = 0;        // current HP
    var ATTR_ORGHP = 22;    // original/total HP

    var MAX_ENEMY_INDEX = 8;  // 7 small + 1 final

    // ═══════════════════════════════════════════════════════════
    //  STORAGE HELPER
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
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
            log.error('RESOURCE', 'cellGame/checkBattleResult failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'cellGame/checkBattleResult failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS (pattern dari hero/resolve.js)
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

    // ═══════════════════════════════════════════════════════════
    //  BATTLE OUTCOME DETERMINATION (ShaLu 1v1 sequential)
    // ═══════════════════════════════════════════════════════════
    //
    //  ShaLu battle = 1v1 sequential (hero #1 fight boss, lalu hero #2, dst).
    //  checkBattleResult dipanggil BEBERAPA kali:
    //    1. INTERMEDIATE (hero mati, hero berikutnya lanjut) — response TIDAK dibaca client
    //    2. FINAL WIN (boss mati) — response dibaca untuk rewards + summary
    //    3. FINAL LOSE (semua hero mati) — response dibaca untuk summary
    //
    //  Client logic (L47205-47213):
    //    BossMode ? bossObserver.Health <= 0 : checkTeamAllDead(enemy) → victoryFinish (WIN)
    //    checkTeamAllDead(own) → ShaluMode ? shaluFailed : failedFinish
    //
    //  ⚠️ Penting: bossObserver.Health != enemy hero HP di checkResult!
    //     Boss HP dikelola INTERNAL client (bossObserver). checkResult hanya
    //     berisi hero HP untuk display. Jadi server TIDAK BISA pakai enemy HP
    //     untuk determine WIN.
    //
    //  Heuristic server (dari checkResult):
    //    - User hero HP > 0 → WIN (hero selamat, boss pasti mati)
    //    - User hero HP = 0 → LOSE/INTERMEDIATE (hero mati)
    //
    //  Untuk LOSE:
    //    - INTERMEDIATE: client tidak baca response → aman
    //    - FINAL LOSE: client baca response → _battleResult: 1 (LOSE)
    //    - Retain _currentBattle (startBattle akan overwrite saat battle baru)
    //
    //  checkResult format: [{ hero: <heroId>, hp: <remainingHp> }, ...]
    //  hero = "Enemy_<pos>_<displayId>" untuk enemy, "Own_<pos>_<displayId>" untuk user hero
    //

    function determineBattleOutcome(checkResult) {
        if (!checkResult || !Array.isArray(checkResult) || checkResult.length === 0) {
            log.info('CELLGAME_RESULT', 'Result: LOSE (no checkResult)');
            return 'LOSE';
        }

        var userHeroAlive = false;
        for (var i = 0; i < checkResult.length; i++) {
            var entry = checkResult[i];
            var heroName = String(entry.hero || '');
            var hp = Number(entry.hp) || 0;

            // User hero = "Own_*", Enemy = "Enemy_*"
            if (heroName.indexOf('Own') === 0 || heroName.indexOf('Enemy') !== 0) {
                if (hp > 0) {
                    userHeroAlive = true;
                    break;
                }
            }
        }

        if (userHeroAlive) {
            log.info('CELLGAME_RESULT', 'Result: WIN (user hero alive)');
            return 'WIN';
        }

        log.info('CELLGAME_RESULT', 'Result: LOSE (all user heroes dead)');
        return 'LOSE';
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO HP UPDATE — update _heroes dari checkResult
    // ═══════════════════════════════════════════════════════════
    //
    //  cellGameState._heroes format (dari setTeam.js):
    //    { "<pos>": { _hero: <BattleTeam> }, ... }
    //  BattleTeam._attrs._items = OBJECT keyed by string attr ID
    //  ATTR_HR (0) = current HP
    //
    //  checkResult format: [{ hero: <heroId>, hp: <remainingHp> }, ...]
    //  hero = _heroId (string), match dengan BattleTeam._heroId
    //

    function updateHeroHp(state, checkResult) {
        if (!state._heroes || !checkResult) return;

        for (var pos in state._heroes) {
            if (!state._heroes.hasOwnProperty(pos)) continue;
            var cellGameHero = state._heroes[pos];
            if (!cellGameHero || !cellGameHero._hero) continue;

            var battleTeam = cellGameHero._hero;
            var heroId = String(battleTeam._heroId);

            // Cari HP baru dari checkResult
            var newHp = null;
            for (var i = 0; i < checkResult.length; i++) {
                if (String(checkResult[i].hero) === heroId) {
                    newHp = Number(checkResult[i].hp) || 0;
                    break;
                }
            }

            if (newHp !== null && battleTeam._attrs && battleTeam._attrs._items) {
                var hrKey = String(ATTR_HR);
                if (battleTeam._attrs._items[hrKey]) {
                    var oldHp = Number(battleTeam._attrs._items[hrKey]._num) || 0;
                    battleTeam._attrs._items[hrKey]._num = newHp;
                    log.details('CELLGAME_RESULT', [
                        ['heroHpUpdate', 'pos=' + pos + ' heroId=' + heroId + ' hp: ' + oldHp + '→' + newHp]
                    ]);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REWARD GRANT — give rewards dari _currentBattle.rewards
    // ═══════════════════════════════════════════════════════════

    function grantRewards(savedData, rewards) {
        var changeItems = {};
        if (!rewards || rewards.length === 0) {
            return changeItems;
        }

        for (var i = 0; i < rewards.length; i++) {
            var reward = rewards[i];
            var itemId = Number(reward.itemId);
            var num = Number(reward.num) || 0;
            if (!itemId || num <= 0) continue;

            var newBalance = addItems(savedData, itemId, num);
            changeItems[String(itemId)] = {
                _id: itemId,
                _num: newBalance   // ABSOLUTE balance
            };
            log.details('CELLGAME_RESULT', [
                ['reward', 'item ' + itemId + ': +' + num + ' → balance ' + newBalance]
            ]);
        }

        return changeItems;
    }

    // ═══════════════════════════════════════════════════════════
    //  LEVEL PROGRESSION — advance curEnemy/curLevel on WIN
    // ═══════════════════════════════════════════════════════════
    //
    //  Pada WIN:
    //    curEnemy 1-7 → curEnemy++ (next small boss)
    //    curEnemy 8 (final) → curLevel++, curEnemy=1, passLevel=max(passLevel, curLevel-1),
    //                          haveBeatLastLessonToday=true
    //
    //  passLevel = highest level passed (L109221: t.passLevel dibaca di ShaLuPassSuccess)
    //  haveBeatLastLessonToday = true kalau final boss beaten (L108427, L109222)
    //

    function advanceLevel(state) {
        var curEnemy = Number(state._curEnemy) || 1;
        var curLevel = Number(state._curLevel) || 1;
        var wasFinal = (curEnemy >= MAX_ENEMY_INDEX);

        if (wasFinal) {
            // Final boss beaten → advance level
            var newLevel = curLevel + 1;
            state._passLevel = Math.max(Number(state._passLevel) || 0, curLevel);
            state._curLevel = newLevel;
            state._curEnemy = 1;
            // ⚠️ JANGAN set haveBeatLastLessonToday = true!
            // L108427: haveBeatLastLessonToday=true → tombol battle DISABLED → STUCK!
            // Tidak ada daily reset mechanism di mock server.
            // Biarkan false agar user bisa battle lagi.

            log.info('CELLGAME_RESULT', 'Level advance: LV' + curLevel + ' → LV' + newLevel
                + ', passLevel=' + state._passLevel);
        } else {
            // Small boss beaten → advance enemy
            state._curEnemy = curEnemy + 1;
            log.info('CELLGAME_RESULT', 'Enemy advance: LV' + curLevel + ' enemy ' + curEnemy + ' → ' + state._curEnemy);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN TASK UPDATE — cellGameBattle (task.json id=6040)
    // ═══════════════════════════════════════════════════════════
    //
    //  task.json id=6040:
    //    { type:"main", levelNeeded:32, taskType:"cellGameBattle",
    //      taskPara1:1, nextTaskID:6041 }
    //  → "Win 1 Cell Game battle"
    //
    //  Pattern IDENTIK dengan hero/resolve.js (decomposeHero):
    //    1. Cek curMainTask[0]._state === 1 (DOING)
    //    2. Load task.json[curMainTask._id]
    //    3. Jika taskType === 'cellGameBattle' → set _state = 2 (COMPLETE)
    //    4. Push mainTaskChange notify
    //

    function processCellGameBattleTask(savedData) {
        var taskUpdated = false;
        try {
            var cmt = savedData.curMainTask;
            var canCheckTask = cmt && Array.isArray(cmt) && cmt.length > 0
                && Number(cmt[0]._state) === 1; // TASK_STATE.DOING

            if (canCheckTask) {
                var taskCfg = loadJson('task');
                if (taskCfg) {
                    var mainTaskDef = taskCfg[String(cmt[0]._id)];
                    if (mainTaskDef && mainTaskDef.taskType === 'cellGameBattle') {
                        cmt[0]._state = 2; // TASK_STATE.COMPLETE
                        taskUpdated = true;
                        log.info('CELLGAME_RESULT', 'Main task ' + cmt[0]._id
                            + ' (cellGameBattle) DOING → COMPLETE');
                    }
                }
            }
        } catch (taskErr) {
            log.error('CELLGAME_RESULT', 'Task check error: '
                + (taskErr && taskErr.message || taskErr));
        }
        return taskUpdated;
    }

    // ═══════════════════════════════════════════════════════════
    //  ACHIEVEMENT UPDATE — cellGame (taskAchievement.json chain 6441→6448)
    // ═══════════════════════════════════════════════════════════
    //
    //  Chain (taskType="cellGame", track total wins):
    //    6441: cellGame taskPara1=5   (root)
    //    6442: cellGame taskPara1=10  (child of 6441)
    //    6443: cellGame taskPara1=15  (child of 6442)
    //    6444: cellGame taskPara1=20  (child of 6443)
    //    6445: cellGame taskPara1=25  (child of 6444)
    //    6446: cellGame taskPara1=30  (child of 6445)
    //    6447: cellGame taskPara1=35  (child of 6446)
    //    6448: cellGame taskPara1=40  (child of 6447, terminal)
    //
    //  Logic (IDENTIK dengan hero/resolve.js achievement tracking):
    //    - Jika _taskProgress._achievements sudah di-init oleh getReward.js:
    //      - Walk chain dari 6441, find first non-FINISH entry (active achievement)
    //      - Increment _curCount += 1
    //      - Jika _curCount >= taskPara1, ensure state = COMPLETE(2)
    //    - Jika _taskProgress belum ada → SKIP (biarkan getReward.js init)
    //
    //  FIX BUG 12 (dari arena/startBattle.js): JANGAN buat _taskProgress
    //  jika belum ada — biarkan getReward.js init pertama kali.
    //

    function processCellGameAchievement(savedData) {
        var achievementUpdated = false;
        try {
            if (!savedData._taskProgress || !savedData._taskProgress._achievements) {
                log.info('CELLGAME_RESULT', '_taskProgress not initialized, '
                    + 'skipping achievement tracking (getReward will init on first access)');
                return false;
            }

            var achieveCfg = loadJson('taskAchievement');
            if (!achieveCfg) return false;

            // Walk chain 6441 → 6448, find first non-FINISH entry
            var chainStart = '6441';
            var currentId = chainStart;
            var activeId = null;
            var activeEntry = null;
            var activeCfg = null;
            var safety = 0;

            while (currentId && achieveCfg[currentId] && safety < 10) {
                safety++;
                var entry = savedData._taskProgress._achievements[currentId];
                if (!entry) break;  // not initialized yet

                if (Number(entry._state) !== 3) { // not FINISH
                    activeId = currentId;
                    activeEntry = entry;
                    activeCfg = achieveCfg[currentId];
                    break;
                }
                var nextId = achieveCfg[currentId].nextTaskID;
                currentId = nextId ? String(nextId) : null;
            }

            if (activeEntry && activeCfg && activeCfg.taskType === 'cellGame') {
                var oldCount = Number(activeEntry._curCount) || 0;
                var newCount = oldCount + 1;
                var achieveTarget = Number(activeCfg.taskPara1) || 1;

                activeEntry._curCount = newCount;

                // Ensure state is at least COMPLETE if target reached
                if (newCount >= achieveTarget && Number(activeEntry._state) < 2) {
                    activeEntry._state = 2; // COMPLETE
                }

                achievementUpdated = true;
                log.info('CELLGAME_RESULT', 'Achievement ' + activeId
                    + ' (cellGame) _curCount: ' + oldCount + ' → ' + newCount
                    + ' / ' + achieveTarget
                    + ' (state=' + activeEntry._state + ')');
            } else {
                log.info('CELLGAME_RESULT', 'No active cellGame achievement found'
                    + (activeId ? ' (activeId=' + activeId + ')' : ' (all FINISH or not initialized)'));
            }
        } catch (achieveErr) {
            log.error('CELLGAME_RESULT', 'Achievement tracking error: '
                + (achieveErr && achieveErr.message || achieveErr));
        }
        return achievementUpdated;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleCheckBattleResult(request, callback) {
        // OUTER SAFETY NET — client BACA t._battleResult + t._changeInfo.
        // ret=1 + empty akan crash getBattleAwardItems.
        try {
            _handleCheckBattleResultImpl(request, callback);
        } catch (err) {
            log.error('CELLGAME_RESULT', 'UNCAUGHT EXCEPTION: '
                + (err && err.name) + ': ' + (err && err.message)
                + (err && err.stack ? '\n' + err.stack : ''));
            // Return LOSE response (safe — no rewards, no crash)
            callback({ _battleResult: 1 });
        }
    }

    function _handleCheckBattleResultImpl(request, callback) {
        var userId = request && request.userId;
        var battleId = request && request.battleId;
        var checkResult = request && request.checkResult;

        log.info('CELLGAME_RESULT', 'START (userId=' + (userId || '-')
            + ', battleId=' + (battleId || '-') + ')');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['battleId', battleId || '(null)'],
            ['checkResult', JSON.stringify(checkResult || [])],
            ['version', (request && request.version) || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('CELLGAME_RESULT', 'missing userId');
            callback({ _battleResult: 1 });
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('CELLGAME_RESULT', 'user data not found: ' + key);
            callback({ _battleResult: 1 });
            return;
        }

        // ── LOAD CELL GAME STATE ──
        var state = savedData.cellGameState;
        if (!state) {
            log.error('CELLGAME_RESULT', 'cellGameState not found');
            callback({ _battleResult: 1 });
            return;
        }

        // ── LOAD BATTLE STATE ──
        var battle = state._currentBattle;
        if (!battle) {
            log.error('CELLGAME_RESULT', '_currentBattle not found — no battle in progress');
            callback({ _battleResult: 1 });
            return;
        }

        // ── DETERMINE BATTLE OUTCOME ──
        // WIN = user hero HP > 0 (hero selamat, boss pasti mati)
        // LOSE = semua user hero HP = 0 (hero mati — INTERMEDIATE atau FINAL LOSE)
        var outcome = determineBattleOutcome(checkResult);

        // ── UPDATE HERO HP dari checkResult ──
        updateHeroHp(state, checkResult);

        if (outcome === 'WIN') {
            // ════════════════════════════════════════════════════════
            //  WIN — give rewards + advance level + trigger task
            // ════════════════════════════════════════════════════════

            // Safety: battle bisa null kalau _currentBattle sudah di-clear
            if (!battle) {
                log.warn('CELLGAME_RESULT', 'WIN but _currentBattle null — returning WIN without rewards');
                db._set(key, savedData);
                callback({ _battleResult: 0, _changeInfo: { _items: {} } });
                return;
            }

            // 1. Grant rewards dari _currentBattle.rewards
            var changeItems = grantRewards(savedData, battle.rewards);

            // 2. Advance curEnemy/curLevel
            advanceLevel(state);

            // 3. Trigger MAIN task 6040 (cellGameBattle)
            var taskUpdated = processCellGameBattleTask(savedData);

            // 3b. Trigger ACHIEVEMENT chain 6441-6448 (cellGame)
            var achievementUpdated = processCellGameAchievement(savedData);

            // 4. Clear _currentBattle HANYA saat final boss (enemy 8) WIN
            var wasFinalBoss = (Number(battle.curEnemy) >= MAX_ENEMY_INDEX);
            if (wasFinalBoss) {
                state._currentBattle = null;
                log.info('CELLGAME_RESULT', 'Final boss defeated — _currentBattle cleared');
            } else {
                // Small boss: clear juga agar tidak double-reward kalau client kirim ulang
                // startBattle berikutnya akan create _currentBattle baru
                state._currentBattle = null;
                log.info('CELLGAME_RESULT', 'Small boss defeated — _currentBattle cleared (startBattle will recreate)');
            }

            // 5. Save user data
            db._set(key, savedData);

            // 6. Push mainTaskChange notify (jika task updated)
            // Safety: cek curMainTask valid sebelum akses
            if (taskUpdated && typeof MainServer.notify === 'function') {
                try {
                    var cmtNotify = savedData.curMainTask;
                    if (cmtNotify && Array.isArray(cmtNotify) && cmtNotify.length > 0 && cmtNotify[0]) {
                        MainServer.notify({
                            action: 'mainTaskChange',
                            _curMainTask: [{
                                _id: cmtNotify[0]._id,
                                _state: 2
                            }]
                        });
                        log.info('CELLGAME_RESULT', 'pushed mainTaskChange (state=2 COMPLETE)');
                    }
                } catch (notifyErr) {
                    log.error('CELLGAME_RESULT', 'notify failed: ' + notifyErr.message);
                }
            }

            // 7. Build response
            var response = {
                _battleResult: 0,  // WIN
                _changeInfo: {
                    _items: changeItems
                }
            };

            log.info('CELLGAME_RESULT', 'WIN — rewards=' + Object.keys(changeItems).length
                + ' items, curLevel=' + state._curLevel + ', curEnemy=' + state._curEnemy
                + ', passLevel=' + state._passLevel
                + (taskUpdated ? ' [main task updated]' : '')
                + (achievementUpdated ? ' [achievement updated]' : ''));
            log.details('response', [
                ['userId', userId],
                ['_battleResult', '0 (WIN)'],
                ['_changeInfo._items', JSON.stringify(changeItems)],
                ['curLevel', String(state._curLevel)],
                ['curEnemy', String(state._curEnemy)],
                ['passLevel', String(state._passLevel)],
                ['haveBeatLastLessonToday', String(state._haveBeatLastLessonToday)]
            ]);

            callback(response);

        } else {
            // ════════════════════════════════════════════════════════
            //  LOSE — hero mati (INTERMEDIATE atau FINAL LOSE)
            //  JANGAN clear _currentBattle! INTERMEDIATE butuh lanjut battle.
            //  FINAL LOSE juga retain — startBattle akan overwrite saat battle baru.
            //  JANGAN advance level, JANGAN give rewards.
            // ════════════════════════════════════════════════════════

            // Save user data (hero HP updated, _currentBattle DIPERTAHANKAN)
            db._set(key, savedData);

            var response = {
                _battleResult: 1  // LOSE
                // NO _changeInfo
            };

            log.info('CELLGAME_RESULT', 'LOSE — hero HP saved, _currentBattle retained');
            log.details('response', [
                ['userId', userId],
                ['_battleResult', '1 (LOSE)'],
                ['_changeInfo', '(none)'],
                ['_currentBattle', 'retained (not cleared)']
            ]);

            callback(response);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('cellGame', 'checkBattleResult', handleCheckBattleResult);

})();
