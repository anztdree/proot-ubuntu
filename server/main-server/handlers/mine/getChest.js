/**
 * getChest.js — Mine Get Chest Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS (1 file, 1 action):
 *   Request:  { type:"mine", action:"getChest", userId, targetX, targetY, version:"1.0" }
 *   Response: { _changeInfo: { _items: { [itemId]: { _id, _num } } } }
 *
 *   1. Validasi: mineModel ada, coords valid, cell punya chest item
 *   2. Tentukan tipe chest (SILVER_CHEST / GOLDEN_CHEST)
 *   3. Lookup reward dari mineChest.json berdasarkan _curLevel
 *   4. Tambahkan item ke inventory (getItemBalance + setItemBalance)
 *   5. Advance daily task 6121 (mineChest) & main quest 6028 (mine)
 *   6. Hapus item dari cell (splice index 1) — cell jadi [fog] saja
 *   7. Simpan, return _changeInfo dengan ABSOLUTE balance
 *
 *   Catatan user: "reward chest akan bertambah sesuai dengan floor"
 *   → mineChest.json punya 80 entry (key "1"-"80"), masing-masing dengan
 *     silverNum1/goldenNum1 yang naik per floor.
 * ============================================================
 *
 * EVIDENCE DARI main.min(unminfy).js:
 *
 *   [PEMANGGILAN] L105642-105660 openBox(e, t, n, o, a):
 *     e = map child element, t = targetX, n = targetY,
 *     o = MineType.GoldBox(1) / MineType.SilverBox(2),
 *     a = boolean (openAll flag, skip animation)
 *
 *     Jika a (openAll mode):
 *       → deleteDataInfo(t, n) saja, TIDAK kirim request
 *       → reward sudah diberikan oleh openAll handler
 *
 *     Jika !a (normal click):
 *       → ts.processHandler({
 *           type:"mine", action:"getChest",
 *           userId, targetX:t, targetY:n, version:"1.0"
 *         }, successCb, failCb)
 *
 *     successCb(e):
 *       setBoxCount(o)        → decrement _MineModel._boxCount[MineType]
 *       deleteDataInfo(t, n)  → _MineModel._map[t][n].splice(1,1) — hapus item
 *       openBoxAnimation(...) → visual effect
 *       openCongratulationObtain(e, cb)
 *         → L56637: if(!_changeInfo) return → AMAN jika response kosong
 *         → L56639: i = t._changeInfo._items
 *         → L56642-56651: for(c in i) → setItem(i[c]._id, i[c]._num) — ABSOLUTE
 *       initTheWildAdventureUI() → refresh UI
 *       ariseEnemyAndBox(o) → update sisa chest/enemy indicator
 *       boxSurplusCountAnimation() → animasi count box
 *
 *   [CLIENT deleteDataInfo] TheWildAdventureManager.prototype.deleteDataInfo:
 *     n._MineModel._map[e][t][1] && n._MineModel._map[e][t].splice(1, 1)
 *     → Hapus item di index 1 dari cell. Cell jadi [fog] saja.
 *     → Server HARUS lakukan hal yang sama agar data konsisten.
 *
 *   [CLIENT setBoxCount] TheWildAdventureManager.prototype.setBoxCount:
 *     n._MineModel._boxCount[e] -= (t || 1)
 *     → Decrement box count. Tapi ini client-side tracking,
 *       server TIDAK perlu kirim _boxCount — client hitung ulang
 *       dari _map di setMineModelInfo().
 *
 *   [MineType enum]:
 *     MineType.Other = 0, MineType.GoldBox = 1, MineType.SilverBox = 2
 *
 *   [RESPONSE FORMAT] — openCongratulationObtain (L56636-56651):
 *     e._changeInfo._items → { [String(itemId)]: { _id: Number, _num: Number } }
 *     Client: for(c in i) { i[c]._id, i[c]._num } → setItem(id, num)
 *     KEY HARUS String, value._id = Number, value._num = Number (ABSOLUTE balance)
 *
 *   [mineChest.json CONFIG]:
 *     80 entries, key "1"-"80" (floor/level).
 *     Silver chest: silverAward1 + silverNum1
 *     Golden chest: goldenAward1 + goldenNum1, goldenAward2 + goldenNum2
 *     Semua golden chest punya 2 reward (award1 DAN award2).
 *     silverNum NAIK per floor (10→15→20→...→80).
 *     goldenNum1 JUGA NAIK per floor (16→22→...→215).
 *     goldenNum2 SELALU 1.
 *
 *   [ITEM BALANCE PATTERN] dari shop/buy.js:
 *     savedData.totalProps._items[] → [{ _id, _num }, ...]
 *     getItemBalance(savedData, itemId) → baca current balance
 *     setItemBalance(savedData, itemId, newBalance) → tulis
 *     Response _changeInfo._items = ABSOLUTE balance (BUKAN delta)
 *     Key = String(itemId)
 *
 *   [DAILY TASK 6121] taskDaily.json:
 *     { id:6121, taskType:"mineChest", taskPara1:5, levelNeeded:25 }
 *     → Buka 5 chest per hari. Pattern: arena/startBattle.js advanceArenaDailyTask.
 *
 *   [MAIN QUEST 6028] task.json:
 *     { id:6028, taskType:"mine", taskPara1:1, levelNeeded:25, nextTaskID:6029 }
 *     → Kunjungi mine (buka chest) 1x. Pattern: arena/startBattle.js checkMainQuestAdvance.
 *
 *   [TASK STATE]: DEFAULT(0) → DOING(1) → COMPLETE(2) → FINISH(3)
 *   [PLAYERLEVELID]: 104 (bukan 101!)
 *
 *   [STORAGE]:
 *     savedData._mineModel → map & state (di dalam user:{userId})
 *     savedData.totalProps._items → inventory
 *     savedData._taskProgress._daily["6121"] → daily task progress
 *     savedData.curMainTask → main quest array
 *     savedData._mineChestProgress → main quest chest counter
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  JSON LOADING
    // ═══════════════════════════════════════════════════════════

    var _jsonCache = {};

    function loadJson(name) {
        if (_jsonCache[name]) return _jsonCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _jsonCache[name] = data;
                return data;
            }
            log.error('MINE', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('MINE', 'loadJson ' + name + ': ' + e.message);
        }
        return null;
    }

    var mineChestJson = loadJson('mineChest');
    var taskDailyCfg = loadJson('taskDaily');
    var taskCfg = loadJson('task');

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var ITEM_TYPE = {
        UNKNOW: 0, DOOR: 1, ENEMY: 2,
        SILVER_CHEST: 3, GOLDEN_CHEST: 4, BOSS: 5
    };

    var MAP_COLS = 7;  // x: 0..6
    var MAP_ROWS = 8;  // y: 0..7

    // Task state — SAMA PERSIS arena/startBattle.js L171-174
    var TASK_STATE_DEFAULT  = 0;
    var TASK_STATE_DOING    = 1;
    var TASK_STATE_COMPLETE = 2;
    var TASK_STATE_FINISH   = 3;

    // PLAYERLEVELID = 104 (bukan 101!) — SAMA PERSIS arena/startBattle.js L1053
    var PLAYERLEVELID = 104;

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS (sama dengan shop/buy.js)
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

    // ═══════════════════════════════════════════════════════════
    //  QUEST HELPERS
    // ═══════════════════════════════════════════════════════════
    //
    // Pattern identik: arena/startBattle.js L1027-1323
    // FIX BUG 8/11/12/13: daily reset, stale ref, jangan buat _taskProgress

    function getTodayStr() {
        var d = new Date();
        var yyyy = d.getUTCFullYear();
        var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(d.getUTCDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }

    function getPlayerLevel(savedData) {
        if (savedData.totalProps && savedData.totalProps._items) {
            var items = savedData.totalProps._items;
            for (var k = 0; k < items.length; k++) {
                if (items[k]._id === PLAYERLEVELID) {
                    return Number(items[k]._num) || 1;
                }
            }
        }
        return 1;
    }

    /**
     * Advance daily task 6121 (mineChest) — buka 5 chest/hari.
     * Pattern: arena/startBattle.js advanceArenaDailyTask() L1227-1323
     */
    function advanceMineChestDailyTask(savedData) {
        if (!taskDailyCfg) {
            log.details('MINE', 'dailyTask — taskDaily.json not loaded, skip');
            return null;
        }

        // Find taskDaily entry dengan taskType='mineChest' (6121)
        var matchedTask = null;
        var matchedTaskId = null;
        for (var tid in taskDailyCfg) {
            if (taskDailyCfg[tid].taskType === 'mineChest') {
                matchedTask = taskDailyCfg[tid];
                matchedTaskId = Number(tid);
                break;
            }
        }
        if (!matchedTask) {
            log.details('MINE', 'dailyTask — no taskDaily entry for mineChest');
            return null;
        }

        var targetCount = Number(matchedTask.taskPara1) || 1;
        var taskIdStr = String(matchedTaskId);
        var levelNeeded = Number(matchedTask.levelNeeded) || 1;

        // FIX BUG 12: JANGAN buat _taskProgress, biarkan getReward init
        if (!savedData._taskProgress) {
            log.details('MINE', 'dailyTask — _taskProgress not initialized, skip');
            return null;
        }

        var today = getTodayStr();

        // FIX BUG 8/11: Full daily reset
        if (savedData._taskProgress._dailyDate !== today) {
            // Re-init all daily tasks (auto COMPLETE) lalu override 6121
            var dailyConfig = taskDailyCfg;
            savedData._taskProgress._daily = {};
            for (var id in dailyConfig) {
                var cfg = dailyConfig[id];
                var target = Number(cfg.taskPara1) || 1;
                savedData._taskProgress._daily[id] = {
                    _id: Number(id),
                    _curCount: target,
                    _targetCount: target,
                    _state: TASK_STATE_COMPLETE
                };
            }

            // FIX BUG 11: Baca ulang reference setelah reset
            var dailyAfterReset = savedData._taskProgress._daily;
            var playerLevel = getPlayerLevel(savedData);
            var resetState = (playerLevel >= levelNeeded)
                ? TASK_STATE_DOING : TASK_STATE_DEFAULT;

            dailyAfterReset[taskIdStr] = {
                _id: matchedTaskId,
                _curCount: 0,
                _targetCount: targetCount,
                _state: resetState
            };
            savedData._taskProgress._dailyDate = today;

            log.info('MINE', 'dailyTask — daily reset, task ' + matchedTaskId + ' → ' +
                (resetState === TASK_STATE_DOING ? 'DOING' : 'DEFAULT') +
                '/0 (level ' + playerLevel + ' vs needed ' + levelNeeded + ')');
        }

        // Ensure entry exists
        var dailyTasks = savedData._taskProgress._daily;
        if (!dailyTasks[taskIdStr]) {
            var playerLevel = getPlayerLevel(savedData);
            var initialState = (playerLevel >= levelNeeded)
                ? TASK_STATE_DOING : TASK_STATE_DEFAULT;
            dailyTasks[taskIdStr] = {
                _id: matchedTaskId,
                _curCount: 0,
                _targetCount: targetCount,
                _state: initialState
            };
        }

        var taskEntry = dailyTasks[taskIdStr];
        var prevState = taskEntry._state;

        // FIX BUG 2: Re-check levelNeeded, DEFAULT→DOING
        if (prevState === TASK_STATE_DEFAULT) {
            var playerLevel = getPlayerLevel(savedData);
            if (playerLevel >= levelNeeded) {
                taskEntry._state = TASK_STATE_DOING;
                taskEntry._curCount = 0;
                prevState = TASK_STATE_DOING;
                log.info('MINE', 'dailyTask — task ' + matchedTaskId +
                    ' DEFAULT → DOING (level ' + playerLevel + ' >= ' + levelNeeded + ')');
            } else {
                return null;
            }
        }

        // Skip COMPLETE/FINISH
        if (prevState === TASK_STATE_COMPLETE || prevState === TASK_STATE_FINISH) return null;

        // Increment progress
        taskEntry._curCount = (taskEntry._curCount || 0) + 1;
        var curCount = taskEntry._curCount;

        log.details('MINE', [
            ['dailyTask', 'taskId=' + matchedTaskId + ' type=mineChest' +
                ' cur=' + curCount + '/' + targetCount]
        ]);

        // Transition DOING → COMPLETE
        if (taskEntry._state === TASK_STATE_DOING && curCount >= targetCount) {
            taskEntry._state = TASK_STATE_COMPLETE;
            log.info('MINE', 'dailyTask — task ' + matchedTaskId +
                ' DOING → COMPLETE (cur=' + curCount + '>=' + targetCount + ')');
            return {
                taskType: 'mineChest',
                taskId: matchedTaskId,
                oldState: TASK_STATE_DOING,
                newState: TASK_STATE_COMPLETE
            };
        }

        return null;
    }

    /**
     * Check & advance main quest 6028 (taskType='mine', taskPara1=1).
     * Pattern: arena/startBattle.js checkMainQuestAdvance() L1432-1540
     */
    function checkMineMainQuest(savedData) {
        try {
            var cmt = savedData.curMainTask;
            if (!cmt || !Array.isArray(cmt) || cmt.length === 0) return;

            var currentState = Number(cmt[0]._state);

            // BUG2 FIX: DEFAULT→DOING
            if (currentState === TASK_STATE_DEFAULT) {
                var def = taskCfg && taskCfg[String(cmt[0]._id)];
                var lvlNeeded = def ? (Number(def.levelNeeded) || 1) : 1;
                var plvl = getPlayerLevel(savedData);

                if (plvl >= lvlNeeded) {
                    cmt[0]._state = TASK_STATE_DOING;
                    log.info('MINE', 'mainQuest — task ' + cmt[0]._id +
                        ' DEFAULT → DOING (level ' + plvl + '>=' + lvlNeeded + ')');
                    if (typeof MainServer.notify === 'function') {
                        MainServer.notify({
                            action: 'mainTaskChange',
                            _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_DOING }]
                        });
                    }
                    currentState = TASK_STATE_DOING;
                } else {
                    return;
                }
            }

            // Hanya proses DOING
            if (currentState !== TASK_STATE_DOING) return;

            // Load task config
            var def = taskCfg && taskCfg[String(cmt[0]._id)];
            if (!def) return;

            // Match taskType === 'mine'
            if (def.taskType !== 'mine') return;

            // Track progress (pattern: _arenaVictoryProgress / _dungeonVictoryProgress)
            if (!savedData._mineChestProgress) savedData._mineChestProgress = {};
            savedData._mineChestProgress['mine'] =
                (savedData._mineChestProgress['mine'] || 0) + 1;

            var count = savedData._mineChestProgress['mine'];
            var needed = Number(def.taskPara1) || 1;

            log.details('MINE', [
                ['mainQuest', 'id=' + cmt[0]._id + ' type=mine' +
                    ' chests=' + count + '/' + needed]
            ]);

            if (count >= needed) {
                cmt[0]._state = TASK_STATE_COMPLETE;
                log.info('MINE', 'mainQuest — task ' + cmt[0]._id +
                    ' DOING → COMPLETE');
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_COMPLETE }]
                    });
                }
            }
        } catch (e) {
            log.error('MINE', 'mainQuest error: ' + e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(data, callback) {
        var userId = data.userId;
        var targetX = data.targetX;
        var targetY = data.targetY;

        // ── 1. LOAD USER DATA ──
        var savedData = db._get('user:' + userId);
        if (!savedData) {
            log.error('MINE', 'getChest — no user data for ' + userId);
            callback({}, 1);
            return;
        }

        var model = savedData._mineModel;
        if (!model) {
            log.error('MINE', 'getChest — no mineModel for ' + userId);
            callback({}, 1);
            return;
        }

        // ── 2. VALIDASI COORDS ──
        if (targetX < 0 || targetX >= MAP_COLS || targetY < 0 || targetY >= MAP_ROWS) {
            log.warn('MINE', 'getChest — out of bounds [' + targetX + ',' + targetY +
                '] user=' + userId);
            callback({}, 1);
            return;
        }

        var cell = model._map[targetX][targetY];
        if (!cell || !cell[1]) {
            log.warn('MINE', 'getChest — no item at [' + targetX + ',' + targetY +
                '] user=' + userId);
            callback({}, 1);
            return;
        }

        var item = cell[1];
        var itemType = item._type;

        // ── 3. VALIDASI CHEST TYPE ──
        if (itemType !== ITEM_TYPE.SILVER_CHEST && itemType !== ITEM_TYPE.GOLDEN_CHEST) {
            log.warn('MINE', 'getChest — not a chest type=' + itemType +
                ' at [' + targetX + ',' + targetY + '] user=' + userId);
            callback({}, 1);
            return;
        }

        // ── 4. LOOKUP REWARD DARI mineChest.json ──
        // Key = _curLevel (floor saat ini). Catatan user: "reward bertambah sesuai floor"
        var level = model._curLevel || 1;
        var chestCfg = mineChestJson ? mineChestJson[String(level)] : null;

        if (!chestCfg) {
            log.error('MINE', 'getChest — no chest config for level ' + level +
                ' user=' + userId);
            callback({}, 1);
            return;
        }

        // Tentukan reward berdasarkan tipe chest
        var rewards = []; // [{ itemId: Number, num: Number }, ...]

        if (itemType === ITEM_TYPE.SILVER_CHEST) {
            // Silver chest: 1 reward — silverAward1 + silverNum1
            var silverItemId = Number(chestCfg.silverAward1);
            var silverNum = Number(chestCfg.silverNum1);
            if (silverItemId > 0 && silverNum > 0) {
                rewards.push({ itemId: silverItemId, num: silverNum });
            }
        } else {
            // GOLDEN_CHEST: 2 reward — goldenAward1 + goldenNum1 DAN goldenAward2 + goldenNum2
            var goldItemId1 = Number(chestCfg.goldenAward1);
            var goldNum1 = Number(chestCfg.goldenNum1);
            if (goldItemId1 > 0 && goldNum1 > 0) {
                rewards.push({ itemId: goldItemId1, num: goldNum1 });
            }

            var goldItemId2 = Number(chestCfg.goldenAward2);
            var goldNum2 = Number(chestCfg.goldenNum2);
            if (goldItemId2 > 0 && goldNum2 > 0) {
                rewards.push({ itemId: goldItemId2, num: goldNum2 });
            }
        }

        if (rewards.length === 0) {
            log.error('MINE', 'getChest — no valid reward in config level=' + level +
                ' chestType=' + itemType + ' user=' + userId);
            callback({}, 1);
            return;
        }

        // ── 5. TAMBAH KE INVENTORY ──
        var changeItems = {};

        for (var r = 0; r < rewards.length; r++) {
            var rw = rewards[r];
            var currentBalance = getItemBalance(savedData, rw.itemId);
            var newBalance = currentBalance + rw.num;
            setItemBalance(savedData, rw.itemId, newBalance);

            // Key HARUS String, value _id = Number, _num = ABSOLUTE balance
            changeItems[String(rw.itemId)] = {
                _id: rw.itemId,
                _num: newBalance
            };
        }

        // ── 6. ADVANCE QUEST ──
        try {
            var dailyResult = advanceMineChestDailyTask(savedData);
            if (dailyResult) {
                log.info('MINE', 'getChest — daily task updated: ' + dailyResult.taskId +
                    ' → COMPLETE');
            }
        } catch (e) {
            log.error('MINE', 'getChest — daily task error: ' + e.message);
        }

        try {
            checkMineMainQuest(savedData);
        } catch (e) {
            log.error('MINE', 'getChest — main quest error: ' + e.message);
        }

        // ── 7. HAPUS ITEM DARI CELL ──
        // Sama dengan client deleteDataInfo: _map[x][y].splice(1, 1)
        // Cell yang semula [fog, {item}] jadi [fog]
        model._map[targetX][targetY].splice(1, 1);

        // ── 8. SIMPAN ──
        savedData._mineModel = model;
        db._set('user:' + userId, savedData);

        // ── 9. LOG ──
        var chestTypeName = (itemType === ITEM_TYPE.SILVER_CHEST) ? 'silver' : 'golden';
        var rewardStr = '';
        for (var r = 0; r < rewards.length; r++) {
            if (r > 0) rewardStr += ', ';
            rewardStr += 'item=' + rewards[r].itemId + ' x' + rewards[r].num;
        }

        log.details('MINE', [
            ['action', 'getChest'],
            ['userId', userId],
            ['pos', targetX + ',' + targetY],
            ['chest', chestTypeName],
            ['level', String(level)],
            ['rewards', rewardStr]
        ]);

        // ── 10. RESPONSE ──
        // Client L56636-56651 openCongratulationObtain:
        //   if(!_changeInfo) return → kalau tidak ada _changeInfo, skip popup
        //   i = t._changeInfo._items → iterate with for-in
        //   setItem(i[c]._id, i[c]._num) → ABSOLUTE balance
        callback({
            _changeInfo: { _items: changeItems }
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('mine', 'getChest', handle);
})();