/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: trial/checkBattleResult
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TUGAS UTAMA (14 tugas)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Menentukan hasil Temple Trial battle (WIN/LOSE), memberikan reward,
 *  meng-advance floor (_lastLess), update _lastTime, dan meng-process
 *  main quest (templeTestBattle + templeTestLesson).
 *
 *  Handler ini JUGA:
 *  - Compute EXP level-up jika reward mengandung EXP (item 103)
 *  - Process main quest templeTestBattle (#6024, win count)
 *  - Process main quest templeTestLesson (#6029/#6037/#6039/#6041, floor reach)
 *
 *  Handler ini TIDAK:
 *  - Mengurangi battle times (→ trial/startBattle)
 *  - Advance daily task (→ trial/startBattle)
 *  - Process achievement (→ task/getReward.js dengan mock completion)
 *  - Buy times / fund / daily reward (→ handler lain)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  CLIENT CALL SITE (main.min.js L64250-64276)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  BattleCallBack.templeTrialBattle → inner function s(super, checkResult,
 *    combatStatisticsTeam, superCombatStatisticsList, runaway)
 *    ↓
 *  ts.processHandler({
 *    type: "trial",
 *    action: "checkBattleResult",
 *    userId: UserInfoSingleton.getInstance().userId,
 *    battleId: UserInfoSingleton.getInstance().battleId,    // dari startBattle
 *    version: "1.0",
 *    "super": t,                 // array of super skill data
 *    checkResult: n,             // array of {hero, hp} objects
 *    battleField: BattleLogic.GameFieldType.TEMPLETEST,     // = 7
 *    runaway: a                  // boolean
 *  }, successCb, errorCb)
 *
 *  SUCCESS CALLBACK (L64262-64273):
 *    1. 0 == t._battleResult → TrialManager.isPlayAnimation = true
 *    2. TrialManager.setTempleTrialInfo(t) → baca t._model
 *    3. s = BattleCallBack.getBattleAwardItems(t) → baca t._changeInfo._items
 *    4. Tampilkan summary page dengan items & combat statistics
 *
 *  ERROR CALLBACK (L64274-64276):
 *    - Langsung kembali ke TempleTrial scene (tanpa summary)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  RESPONSE FORMAT
 *  ══════════════════════════════════════════════════════════════════
 *
 *  WIN (_battleResult: 0):
 *  {
 *      _battleResult: 0,
 *      _model: {
 *          _id: <userId>,
 *          _haveTimes: <number>,
 *          _timesStartRecover: <ms timestamp>,
 *          _lastLess: <number>,              // floor yang baru di-advance
 *          _lastTime: <ms timestamp>,
 *          _buyFund: <boolean>,
 *          _haveGotFundReward: <object>
 *      },
 *      _changeInfo: {
 *          _items: {
 *              "itemId": { _id: <id>, _num: <ABSOLUTE balance> },
 *              ...
 *          }
 *      }
 *  }
 *
 *  LOSE (_battleResult: 1):
 *  { _battleResult: 1 }
 *  — TIDAK ada _model, TIDAK ada _changeInfo
 *
 *  Client setTempleTrialInfo (L79584):
 *    - Hanya dieksekusi jika t._model ada
 *    - Copy: _id, _haveTimes, _timesStartRecover, _lastLess, _lastTime,
 *            _buyFund, _haveGotFundReward
 *    - Juga panggil setTrialCount(_haveTimes, _timesStartRecover)
 *
 *  Client getBattleAwardItems (L63394-63412):
 *    - Baca t._changeInfo._items (hanya jika ada)
 *    - Untuk setiap item: skip 103/104, bandingkan balance lama vs baru
 *      untuk hitung delta (tampilkan sebagai reward di summary)
 *    - Mutate ItemsCommonSingleton dengan _num (ABSOLUTE)
 *    - Untuk EXP(103): hitung delta via getBattleAddExp, tampilkan EXP gain
 *
 *  ══════════════════════════════════════════════════════════════════
 *  WIN/LOSE DETERMINATION (sama pattern dungeon/checkBattleResult)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Client battle engine menentukan WIN/LOSE secara lokal (PVE).
 *  Server menerima checkResult (hero HP map) dan menggunakan heuristic:
 *    1. runaway === true  → LOSE
 *    2. checkResult kosong/null → LOSE
 *    3. Semua hero hp <= 0 → LOSE
 *    4. Else → WIN (trust client battle engine)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  FLOOR INFERENCE
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Client TIDAK mengirim floorId/trialID di checkBattleResult request.
 *  Server infer: floorId = savedData.trialState._lastLess + 1
 *  (Sama persis logic di startBattle dan client TrialManager L149280)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  REWARD STRUCTURE (dari templeTest.json)
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Setiap floor punya award1/num1 s/d award4/num4.
 *  awardNum menunjukkan jumlah slot aktif (3 atau 4).
 *  Semua reward FIXED — tidak ada random drop.
 *  Contoh floor 1: award1=132(Gold) num1=265, award2=133 num2=10,
 *                   award3=2841 num3=5
 *  Contoh floor 900: award1=132 num1=765, award2=133 num2=17700,
 *                     award3=2851 num3=10, award4=2861 num4=20
 *
 *  ══════════════════════════════════════════════════════════════════
 *  MAIN QUEST PROCESSING
 *  ══════════════════════════════════════════════════════════════════
 *
 *  templeTestBattle (#6024):
 *    taskType: "templeTestBattle", taskPara1: 1, levelNeeded: 23
 *    → "Menang 1x Temple Trial battle"
 *    → WIN-based: track win count di savedData._templeVictoryProgress
 *    → Jika count >= 1 → DOING → COMPLETE + MainServer.notify
 *
 *  templeTestLesson (#6029/#6037/#6039/#6041):
 *    6029: taskPara1=5,  levelNeeded=26  → "Capai floor 5"
 *    6037: taskPara1=8,  levelNeeded=32  → "Capai floor 8"
 *    6039: taskPara1=12, levelNeeded=32  → "Capai floor 12"
 *    6041: taskPara1=20, levelNeeded=32  → "Capai floor 20"
 *    → WIN-based: cek _lastLess (SUDAH di-advance) >= taskPara1
 *    → Bisa LEWAT: jika player sudah di floor 50, langsung COMPLETE
 *    → DOING → COMPLETE + MainServer.notify
 *
 *  Catatan: Hanya 1 main task aktif (curMainTask[0]).
 *  Client tidak punya tracking variable untuk taskType ini.
 *  String "templeTestLesson" bahkan TIDAK ADA di client code.
 *  Semua logic 100% server-side.
 *
 *  Lifecycle:
 *    Login → UserDataParser.setMainTask(e) → setMianTask(e.curMainTask)
 *    Push  → "mainTaskChange" → setMianTask(e._curMainTask)
 *    Claim → task/getReward TASK_CLASS.MAIN(1) → setMainTaskWithComplete(n._nextTasks)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  TASK_STATE
 *  ══════════════════════════════════════════════════════════════════
 *
 *  DEFAULT(0): task ter-lock, level belum cukup
 *  DOING(1):   task aktif, progress belum selesai
 *  COMPLETE(2): task selesai, menunggu claim
 *  FINISH(3):  reward sudah di-claim
 *
 *  ══════════════════════════════════════════════════════════════════
 *  BATTLE TIMES — TIDAK DITANGANI DI SINI
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Times sudah dikurangi di trial/startBattle (WIN atau LOSE sama-sama
 *  mengurangi 1x karena battle sudah dimulai).
 *  Di sini TIDAK ada pengurangan times.
 *  _haveTimes di response _model tetap di-return (untuk setTempleTrialInfo).
 *
 *  ══════════════════════════════════════════════════════════════════
 *  JSON RESOURCES YANG DI-LOAD
 *  ══════════════════════════════════════════════════════════════════
 *
 *  ✅ templeTest.json     — reward config per floor (award1-num1 s/d award4-num4)
 *  ✅ userUpgrade.json    — EXP level-up computation (expNeeded per level)
 *  ✅ task.json           — main quest #6024, #6029, #6037, #6039, #6041
 *
 *  ❌ TIDAK DI-LOAD:
 *    constant.json        — tidak perlu (times sudah di-startBattle)
 *    taskDaily.json       — tidak perlu (daily task sudah di-advance di startBattle)
 *    taskAchievement.json — tidak perlu (achievement di-handle task/getReward.js
 *                           dengan mock completion pattern)
 *    hero.json            — tidak perlu (tidak build enemy team)
 *    heroLevelAttr.json   — tidak perlu (tidak build enemy team)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  PERBEDAAN DARI dungeon/checkBattleResult
 *  ══════════════════════════════════════════════════════════════════
 *
 *  1. Floor inference: Client kirim dungeonType+level (dungeon) vs
 *     server infer _lastLess+1 (trial)
 *  2. Times: Di checkBattleResult WIN only (dungeon) vs
 *     SUDAH di startBattle, TIDAK di sini (trial)
 *  3. Progression: _curMaxLevel/_lastLevel per type (dungeon) vs
 *     _lastLess global floor counter (trial)
 *  4. Response: _lastLevel/_curMaxLevel/_haveTimes/_buyTimes (dungeon) vs
 *     _model:{_id,_haveTimes,_timesStartRecover,_lastLess,_lastTime,
 *             _buyFund,_haveGotFundReward} (trial)
 *  5. Task types: experienceDungeonVictory/breachDungeonVictory (dungeon) vs
 *     templeTestBattle(win count) + templeTestLesson(floor reach) (trial)
 *  6. Random drops: equip/sign weighted drops (dungeon) vs
 *     TIDAK ADA — reward 100% fixed dari config (trial)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  DB KEY
 *  ══════════════════════════════════════════════════════════════════
 *
 *  user:{userId}
 *
 * ================================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var MAXTEMPLELESS = 900;       // client L78752
    var PLAYEREXPID = 103;         // item ID untuk player EXP
    var PLAYERLEVELID = 104;       // item ID untuk player level

    var TASK_STATE = { DEFAULT: 0, DOING: 1, COMPLETE: 2, FINISH: 3 };

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADER (cached synchronous XHR)
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
        } catch (e) {
            log.error('TRIAL_RESULT', 'Failed to load ' + name + '.json: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS (sama pattern dungeon/checkBattleResult)
    // ═══════════════════════════════════════════════════════════
    //
    //  savedData.totalProps._items = [{_id, _num}, ...] (ARRAY)
    //  Response _changeInfo._items = { "itemId": {_id, _num}, ... } (OBJECT, ABSOLUTE)
    //

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
        if (!savedData.totalProps) {
            savedData.totalProps = { _items: [] };
        }
        if (!savedData.totalProps._items) {
            savedData.totalProps._items = [];
        }
        var items = savedData.totalProps._items;
        var found = false;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                found = true;
                break;
            }
        }
        if (!found) {
            items.push({ _id: itemId, _num: newBalance });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Compute level-up from EXP
    //  (identik dungeon/checkBattleResult L219-241)
    // ═══════════════════════════════════════════════════════════

    function computeLevelUp(savedData) {
        var curLevel = getItemBalance(savedData, PLAYERLEVELID) || 1;
        var totalExp = getItemBalance(savedData, PLAYEREXPID) || 0;
        var upgradeTable = loadJson('userUpgrade');
        var maxLevel = 300;
        if (upgradeTable && totalExp > 0 && curLevel < maxLevel) {
            var oldLevel = curLevel;
            while (curLevel < maxLevel) {
                var entry = upgradeTable[String(curLevel)];
                if (!entry) break;
                var needed = Number(entry.expNeeded) || 0;
                if (needed <= 0 || totalExp < needed) break;
                totalExp -= needed;
                curLevel++;
            }
            if (curLevel > oldLevel) {
                setItemBalance(savedData, PLAYEREXPID, totalExp);
                setItemBalance(savedData, PLAYERLEVELID, curLevel);
                log.info('TRIAL_RESULT', 'PLAYER LEVEL ' + oldLevel + ' -> ' + curLevel);
            }
        }
        return curLevel;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Build _changeInfo._items from award1-num1 ... award4-num4
    //  (identik dungeon/checkBattleResult L247-281)
    // ═══════════════════════════════════════════════════════════

    function addRewardItem(savedData, changeItems, itemId, amount) {
        if (!itemId || amount <= 0) return;
        itemId = Number(itemId);
        amount = Number(amount);

        var currentBalance = getItemBalance(savedData, itemId);
        var newBalance = currentBalance + amount;
        setItemBalance(savedData, itemId, newBalance);

        changeItems[String(itemId)] = {
            _id: itemId,
            _num: newBalance
        };

        log.details('TRIAL_REWARD', [
            ['item', String(itemId)],
            ['amount', String(amount)],
            ['oldBalance', String(currentBalance)],
            ['newBalance', String(newBalance)]
        ]);
    }

    function buildRewardItems(savedData, floorCfg) {
        var changeItems = {};
        for (var slot = 1; slot <= 5; slot++) {
            var awardId = floorCfg['award' + slot];
            var awardNum = floorCfg['num' + slot];
            if (awardId === undefined || awardId === null ||
                awardNum === undefined || awardNum === null) {
                continue;
            }
            addRewardItem(savedData, changeItems, awardId, awardNum);
        }
        return changeItems;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: WIN/LOSE determination
    //  (identik dungeon/checkBattleResult L555-588)
    // ═══════════════════════════════════════════════════════════
    //
    //  Client battle engine determines WIN/LOSE. Server receives
    //  checkResult (hero HP map). Heuristic:
    //    - runaway=true → LOSE
    //    - checkResult empty/null → LOSE
    //    - all hero HP=0 → LOSE
    //    - else → WIN (trust client battle engine)
    //

    function determineWinLose(request) {
        // Explicit runaway
        if (request.runaway === true) {
            log.info('TRIAL_RESULT', 'Result: LOSE (runaway)');
            return false;
        }

        var checkResult = request.checkResult;
        if (!checkResult || !Array.isArray(checkResult) || checkResult.length === 0) {
            log.info('TRIAL_RESULT', 'Result: LOSE (no checkResult)');
            return false;
        }

        // Check if all heroes have 0 HP
        var allDead = true;
        for (var i = 0; i < checkResult.length; i++) {
            var hero = checkResult[i];
            // checkResult entries: {hero, hp} — field is "hero" not "heroId"
            var hp = hero.hp !== undefined ? Number(hero.hp) :
                     hero.HP !== undefined ? Number(hero.HP) : -1;
            if (hp > 0) {
                allDead = false;
                break;
            }
        }

        if (allDead) {
            log.info('TRIAL_RESULT', 'Result: LOSE (all heroes dead)');
            return false;
        }

        log.info('TRIAL_RESULT', 'Result: WIN');
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Main quest processing — templeTestBattle
    // ═══════════════════════════════════════════════════════════
    //
    //  Task #6024: taskType="templeTestBattle", taskPara1=1
    //  → "Menang 1x Temple Trial battle"
    //  → WIN-based, track count di _templeVictoryProgress
    //
    //  Pattern identik dungeon processDungeonVictoryTask (L602-649)
    //  bedanya: dungeon pakai per-type progress, trial pakai global
    //  per-taskType progress.
    //

    function processTempleTestBattleTask(savedData) {
        var cmt = savedData.curMainTask;
        if (!cmt || !Array.isArray(cmt) || cmt.length === 0 || cmt[0]._state !== TASK_STATE.DOING) {
            return;
        }

        var taskCfg = loadJson('task');
        if (!taskCfg) {
            log.warn('TRIAL_RESULT', 'task.json not found, skipping main quest');
            return;
        }

        var taskDef = taskCfg[String(cmt[0]._id)];
        if (!taskDef || taskDef.taskType !== 'templeTestBattle') return;

        // Initialize victory progress counter
        if (!savedData._templeVictoryProgress) {
            savedData._templeVictoryProgress = {};
        }
        savedData._templeVictoryProgress['templeTestBattle'] =
            (savedData._templeVictoryProgress['templeTestBattle'] || 0) + 1;

        var winCount = savedData._templeVictoryProgress['templeTestBattle'];
        var needed = Number(taskDef.taskPara1) || 1;

        log.details('TRIAL_RESULT', [
            ['mainTask', 'templeTestBattle wins=' + winCount + '/' + needed]
        ]);

        if (winCount >= needed) {
            cmt[0]._state = TASK_STATE.COMPLETE;
            log.info('TRIAL_RESULT', 'Main task ' + cmt[0]._id +
                ' (templeTestBattle) DOING -> COMPLETE (wins=' + winCount + ')');

            if (typeof MainServer.notify === 'function') {
                MainServer.notify({
                    action: 'mainTaskChange',
                    _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE.COMPLETE }]
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Main quest processing — templeTestLesson
    // ═══════════════════════════════════════════════════════════
    //
    //  Task #6029: taskPara1=5,  levelNeeded=26  → "Capai floor 5"
    //  Task #6037: taskPara1=8,  levelNeeded=32  → "Capai floor 8"
    //  Task #6039: taskPara1=12, levelNeeded=32  → "Capai floor 12"
    //  Task #6041: taskPara1=20, levelNeeded=32  → "Capai floor 20"
    //
    //  Kondisi: savedData.trialState._lastLess >= taskPara1
    //  (_lastLess SUDAH di-advance sebelum fungsi ini dipanggil)
    //
    //  Bisa LEWAT: player sudah di floor 50, task butuh floor 5
    //  → langsung COMPLETE.
    //
    //  String "templeTestLesson" TIDAK ADA di client code.
    //  100% server-side logic.
    //

    function processTempleTestLessonTask(savedData, currentFloor) {
        var cmt = savedData.curMainTask;
        if (!cmt || !Array.isArray(cmt) || cmt.length === 0 || cmt[0]._state !== TASK_STATE.DOING) {
            return;
        }

        var taskCfg = loadJson('task');
        if (!taskCfg) {
            log.warn('TRIAL_RESULT', 'task.json not found, skipping templeTestLesson check');
            return;
        }

        var taskDef = taskCfg[String(cmt[0]._id)];
        if (!taskDef || taskDef.taskType !== 'templeTestLesson') return;

        var targetFloor = Number(taskDef.taskPara1) || 1;

        log.details('TRIAL_RESULT', [
            ['mainTask', 'templeTestLesson floor=' + currentFloor +
                ' target=' + targetFloor]
        ]);

        if (currentFloor >= targetFloor) {
            cmt[0]._state = TASK_STATE.COMPLETE;
            log.info('TRIAL_RESULT', 'Main task ' + cmt[0]._id +
                ' (templeTestLesson) DOING -> COMPLETE (floor=' +
                currentFloor + '>=' + targetFloor + ')');

            if (typeof MainServer.notify === 'function') {
                MainServer.notify({
                    action: 'mainTaskChange',
                    _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE.COMPLETE }]
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: BUG2 fix — DEFAULT→DOING transition after level-up
    //  (identik dungeon/checkBattleResult L655-680)
    // ═══════════════════════════════════════════════════════════
    //
    //  Setelah EXP level-up, cek apakah curMainTask yang masih
    //  DEFAULT sekarang level-nya sudah cukup → transisi ke DOING.
    //

    function bug2Fix(savedData) {
        try {
            var cmt = savedData.curMainTask;
            if (!cmt || !Array.isArray(cmt) || cmt.length === 0) return;
            if (cmt[0]._state !== TASK_STATE.DEFAULT) return;

            var tc = loadJson('task');
            var def = tc && tc[String(cmt[0]._id)];
            var levelNeeded = def ? (Number(def.levelNeeded) || 1) : 1;
            var currentLevel = getItemBalance(savedData, PLAYERLEVELID) || 1;

            if (currentLevel >= levelNeeded) {
                cmt[0]._state = TASK_STATE.DOING;
                log.info('TRIAL_RESULT', 'BUG2 fix: task ' + cmt[0]._id +
                    ' DEFAULT -> DOING (level ' + currentLevel + '>=' + levelNeeded + ')');
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE.DOING }]
                    });
                }
            }
        } catch (err) {
            log.warn('TRIAL_RESULT', 'BUG2 fix error: ' + (err.message || err));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ENSURE TRIAL STATE
    //  ═══════════════════════════════════════════════════════════
    //
    //  Seharusnya sudah ada dari getState/startBattle,
    //  tapi handle graceful kalau tidak ada.

    function ensureTrialState(savedData, userId) {
        if (!savedData.trialState) {
            log.info('TRIAL_RESULT', 'trialState missing, initializing default for: ' + userId);
            savedData.trialState = {
                _id: userId,
                _haveTimes: 10,
                _timesStartRecover: Date.now(),
                _lastLess: 0,
                _lastTime: 0,
                _buyFund: false,
                _haveGotFundReward: {}
            };
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: trial/checkBattleResult
    // ═══════════════════════════════════════════════════════════

    function handleTrialCheckBattleResult(request, callback) {
        var userId = request.userId;

        log.info('TRIAL_RESULT', 'Processing trial/checkBattleResult');
        log.details('TRIAL_RESULT', [
            ['userId', userId || '-'],
            ['battleId', request.battleId || '-'],
            ['checkResult', request.checkResult ? JSON.stringify(request.checkResult).substring(0, 300) : '-'],
            ['runaway', String(request.runaway || false)]
        ]);

        // ── TUGAS #1: Validate userId ──
        if (!userId) {
            log.warn('TRIAL_RESULT', 'Missing userId');
            callback({}, 1);
            return;
        }

        // ── TUGAS #2: Load savedData ──
        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('TRIAL_RESULT', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }

        // Ensure trialState exists
        ensureTrialState(savedData, userId);

        // ── TUGAS #3: Infer floorId ──
        // Client TIDAK mengirim floorId. Server infer dari _lastLess + 1.
        var floorId = (savedData.trialState._lastLess || 0) + 1;

        if (floorId < 1 || floorId > MAXTEMPLELESS) {
            log.error('TRIAL_RESULT', 'Invalid floorId=' + floorId +
                ' (must be 1-' + MAXTEMPLELESS + ')');
            callback({}, 1);
            return;
        }

        log.details('TRIAL_RESULT', [
            ['floor', String(floorId)],
            ['prevLastLess', String(savedData.trialState._lastLess)]
        ]);

        // ── TUGAS #4: Load templeTest.json for reward config ──
        var templeTestCfg = loadJson('templeTest');
        if (!templeTestCfg) {
            log.error('TRIAL_RESULT', 'templeTest.json not found');
            callback({}, 1);
            return;
        }

        var floorCfg = templeTestCfg[String(floorId)];
        if (!floorCfg) {
            log.error('TRIAL_RESULT', 'Floor ' + floorId + ' not found in templeTest.json');
            callback({}, 1);
            return;
        }

        // ── TUGAS #5: Determine WIN/LOSE ──
        var isWin = determineWinLose(request);

        // ── TUGAS #6: LOSE — minimal response ──
        if (!isWin) {
            db._set(storageKey, savedData);
            log.info('TRIAL_RESULT', 'LOSE userId=' + userId + ' floor=' + floorId);
            callback({ _battleResult: 1 });
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  WIN PATH — give rewards, advance floor, process tasks
        // ═══════════════════════════════════════════════════════

        log.info('TRIAL_RESULT', 'WIN userId=' + userId + ' floor=' + floorId);

        // ── TUGAS #7: Build reward items from award1-num1 ... award4-num4 ──
        var changeItems = buildRewardItems(savedData, floorCfg);

        // ── TUGAS #8: Compute EXP level-up ──
        computeLevelUp(savedData);

        // Always include EXP and Level in response (client getBattleAwardItems
        // expects them for delta computation — L63394-63412)
        var playerExp = getItemBalance(savedData, PLAYEREXPID);
        var playerLevel = getItemBalance(savedData, PLAYERLEVELID);
        changeItems[String(PLAYEREXPID)] = { _id: PLAYEREXPID, _num: playerExp };
        changeItems[String(PLAYERLEVELID)] = { _id: PLAYERLEVELID, _num: playerLevel };

        // ── TUGAS #9: Advance floor (_lastLess) ──
        savedData.trialState._lastLess = floorId;
        log.info('TRIAL_RESULT', 'Floor advanced: _lastLess -> ' + floorId);

        // ── TUGAS #10: Update _lastTime ──
        savedData.trialState._lastTime = Date.now();

        // ── TUGAS #11: Process main quest — templeTestBattle (#6024) ──
        try {
            processTempleTestBattleTask(savedData);
        } catch (taskErr) {
            log.warn('TRIAL_RESULT', 'templeTestBattle task error: ' + (taskErr.message || taskErr));
        }

        // ── TUGAS #12: Process main quest — templeTestLesson (#6029/#6037/#6039/#6041) ──
        // _lastLess SUDAH di-advance di Tugas #9, jadi gunakan floorId langsung
        try {
            processTempleTestLessonTask(savedData, floorId);
        } catch (taskErr) {
            log.warn('TRIAL_RESULT', 'templeTestLesson task error: ' + (taskErr.message || taskErr));
        }

        // ── BUG2 fix — DEFAULT→DOING after level-up ──
        try {
            bug2Fix(savedData);
        } catch (bug2Err) {
            log.warn('TRIAL_RESULT', 'BUG2 error: ' + (bug2Err.message || bug2Err));
        }

        // ── TUGAS #13: Save all changes ──
        db._set(storageKey, savedData);

        // ── TUGAS #14: Build & return WIN response ──
        var resp = {
            _battleResult: 0,
            _model: {
                _id: savedData.trialState._id,
                _haveTimes: savedData.trialState._haveTimes,
                _timesStartRecover: savedData.trialState._timesStartRecover || 0,
                _lastLess: savedData.trialState._lastLess,
                _lastTime: savedData.trialState._lastTime,
                _buyFund: savedData.trialState._buyFund,
                _haveGotFundReward: savedData.trialState._haveGotFundReward || {}
            },
            _changeInfo: {
                _items: changeItems
            }
        };

        log.info('TRIAL_RESULT', 'OK WIN userId=' + userId +
            ' floor=' + floorId +
            ' lastLess=' + savedData.trialState._lastLess +
            ' haveTimes=' + savedData.trialState._haveTimes);

        callback(resp);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('trial', 'checkBattleResult', handleTrialCheckBattleResult);

    window.MainServer = MainServer;
})();