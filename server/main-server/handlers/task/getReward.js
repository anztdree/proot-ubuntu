/**
 * handlers/task/getReward.js
 * Super Warrior Z — MAIN SERVER (port 8001)
 *
 * ============================================================
 * HANDLER: task/getReward
 * TYPE: task  |  ACTION: getReward
 *
 * Tanggung jawab: Menerima request klaim hadiah task dari client,
 * memvalidasi, memberikan reward, mengupdate state, dan mengembalikan
 * response sesuai protokol client.
 *
 * ============================================================
 * CALL SITES (kamus main.min(unminfy).js)
 * ============================================================
 * L173252-173265  achievement_receiveBtnTap   → taskClass=3, taskIds=[single]
 * L173300-173318  akeyGainBtnTap(achievement)  → taskClass=3, taskIds=[multi]
 * L173679-173690  task_receiveBtnTap          → taskClass=2, taskIds=[single]
 * L173774-173792  akeyGainBtnTap(daily)       → taskClass=2, taskIds=[multi]
 * L173793-173804  totalTaskBtnTap             → taskClass=2, taskIds=[single]
 * L173805-173821  totalTaskEvent              → taskClass=2, taskIds=[single]
 * L173945-173960  TaskMainTips.request        → taskClass=1, taskIds=[single]
 *
 * ============================================================
 * REQUEST
 * ============================================================
 * { type:"task", action:"getReward", userId, taskClass, taskIds:[...], version:"1.0" }
 *
 * ============================================================
 * RESPONSE — bergantung taskClass
 * ============================================================
 *
 * MAIN (taskClass=1):
 *   _nextTasks: [{ _id: nextId, _state: 1 }]
 *   _changeInfo: { _items: { "itemId": { _id, _num: ABSOLUTE } } }
 *   Client: L173956 setMainTaskWithComplete(n._nextTasks)
 *
 * DAILY (taskClass=2):
 *   _finishTasks: [id1, id2]
 *   _nextTasks: [{ _id, _state: 3 }, ...]
 *   _changeInfo: { _items: { "itemId": { _id, _num: ABSOLUTE } } }
 *   Client: L173791 refreshTaskList(t._finishTasks[n])
 *   Client: L173803 firstTaskInfoRefresh(taskId, t._nextTasks)
 *
 * ACHIEVEMENT (taskClass=3):
 *   _finishTasks: [id1]
 *   _nextTask: { _id, _curCount, _targetCount, _state }
 *   _changeInfo: { _items: { "itemId": { _id, _num: ABSOLUTE } } }
 *   Client: L173264 refreshAchievementList(e.taskId, t._nextTask)
 *   Client: L173347 addNewAchievement(t._nextTask) — jika _nextTask ada
 *
 * ============================================================
 * CRITICAL: _changeInfo._items
 * ============================================================
 * Object keyed by STRING item ID. _num = ABSOLUTE NEW BALANCE.
 * Client L56636: openCongratulationObtain(t) cek t._changeInfo.
 * Jika kosong → log "没有任何东西！！！" dan skip popup reward.
 *
 * ============================================================
 * TASK STATE (kamus L62602-62605)
 * ============================================================
 * TASK_STATE.DEFAULT  = 0  (locked)
 * TASK_STATE.DOING    = 1  (active, in progress)
 * TASK_STATE.COMPLETE = 2  (done, await claim)
 * TASK_STATE.FINISH   = 3  (claimed)
 *
 * ============================================================
 * TASK CLASS (kamus L173395-173398)
 * ============================================================
 * TASK_CLASS.UNKNOW      = 0
 * TASK_CLASS.MAIN        = 1
 * TASK_CLASS.DAILY       = 2
 * TASK_CLASS.ACHIEVEMENT = 3
 *
 * ============================================================
 * CONFIG FILES
 * ============================================================
 * task.json            → 44 main tasks (6001-6044), chain linear
 * taskDaily.json       → 28 daily tasks (6101-6131), 1 reward slot
 * taskAchievement.json → 127 achievements (6201-6531), 1 reward slot, chain groups
 *
 * Reward pattern:
 *   Main task: reward1/num1 + reward2/num2 + reward3/num3 (2-3 slots, reward3="" = kosong)
 *   Daily:     reward1/num1 saja (reward2/3 tidak ada di JSON)
 *   Achievement: reward1/num1 saja
 *
 * ============================================================
 * STORAGE DESIGN
 * ============================================================
 * Task progress disimpan di dalam user data (IndexedDB key: ms_user_{userId}_1)
 * di bawah field baru: _taskProgress
 *
 *   savedData._taskProgress = {
 *     _daily: {
 *       "6101": { _id: 6101, _curCount: 5, _targetCount: 5, _state: 2 },
 *       "6102": { _id: 6102, _curCount: 3, _targetCount: 3, _state: 2 },
 *       ...
 *     },
 *     _dailyDate: "2026-06-20",     ← tanggal inisialisasi, untuk daily reset
 *     _achievements: {
 *       "6201": { _id: 6201, _curCount: 60, _targetCount: 60, _state: 2 },
 *       ...
 *     }
 *   }
 *
 * Main task progress TIDAK di sini — sudah ada di savedData.curMainTask.
 *
 * Inisialisasi: Jika _taskProgress belum ada saat getReward dipanggil,
 * handler akan menginisialisasi dari config dengan state=2 (COMPLETE)
 * agar mock server bisa langsung digunakan tanpa perlu queryTask terlebih dahulu.
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var TASK_CLASS_MAIN        = 1;
    var TASK_CLASS_DAILY       = 2;
    var TASK_CLASS_ACHIEVEMENT = 3;

    var TASK_STATE_DEFAULT  = 0;
    var TASK_STATE_DOING    = 1;
    var TASK_STATE_COMPLETE = 2;
    var TASK_STATE_FINISH   = 3;

    var MAX_REWARD_SLOTS = 3;

    // Item ID constants (kamus L78639-78644)
    var PLAYEREXPERIENCEID = 103;   // EXP — remaining exp toward next level
    var PLAYERLEVELID      = 104;   // Player level (getUserLevel reads this)
    var PLAYERVIPLEVELID   = 106;   // VIP level
    var MAX_USER_LEVEL      = 300;   // constant.json [1].maxUserLevel

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE & CONFIG LOADER
    // ═══════════════════════════════════════════════════════════

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _cache[name] = JSON.parse(xhr.responseText);
                return _cache[name];
            }
        } catch (e) {
            log.error('TASK', 'Failed to load ' + name + '.json: ' + e.message);
        }
        return null;
    }

    /**
     * Ambil config untuk task ID tertentu dari file yang sesuai.
     * @param {number} taskId
     * @param {string} configType — 'task' | 'taskDaily' | 'taskAchievement'
     * @returns {object|null} config entry atau null
     */
    function getTaskConfig(taskId, configType) {
        var data = loadJson(configType);
        if (!data) return null;
        return data[String(taskId)] || null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS
    //  Server storage: savedData.totalProps._items = [{_id, _num}, ...]
    //  Sama pattern dengan getLevelReward.js L152-168
    // ═══════════════════════════════════════════════════════════

    function getBal(sd, id) {
        var items = sd && sd.totalProps && sd.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    function setBal(sd, id, val) {
        if (!sd.totalProps) sd.totalProps = { _items: [] };
        if (!sd.totalProps._items) sd.totalProps._items = [];
        var items = sd.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(id)) {
                items[i]._num = val;
                return val;
            }
        }
        items.push({ _id: id, _num: val });
        return val;
    }

    /**
     * Tambah item ke inventory dan catat di changeItems untuk response.
     * @param {object} savedData — user data dari IndexedDB
     * @param {object} changeItems — akumulasi response _changeInfo._items
     * @param {number} itemId — ID item dari config
     * @param {number} amount — jumlah yang ditambahkan
     * @returns {number} new absolute balance
     */
    function grantReward(savedData, changeItems, itemId, amount) {
        if (!itemId || itemId <= 0 || !amount || amount <= 0) return 0;
        var oldBal = getBal(savedData, itemId);
        var newBal = oldBal + amount;
        setBal(savedData, itemId, newBal);
        changeItems[String(itemId)] = { _id: itemId, _num: newBal };
        log.details('REWARD', ['item', String(itemId), '+' + String(amount), '=' + String(newBal)]);
        return newBal;
    }

    // ═══════════════════════════════════════════════════════════
    //  LEVEL-UP SYSTEM
    // ═══════════════════════════════════════════════════════════
    //
    // Sistem EXP → Level (kamus L62464-62476):
    //
    //   PLAYEREXPERIENCEID (103) = remaining exp dalam level saat ini
    //   PLAYERLEVELID (104)      = level player saat ini
    //   userUpgrade.json[level].expNeeded = exp untuk naik dari level ke level+1
    //   maxUserLevel = 300 (constant.json)
    //
    //   getUserLevel()  L62464: return getItemNum(PLAYERLEVELID)
    //   getUserExp()    L62466: return getItemNum(PLAYEREXPERIENCEID)
    //   getNextLevelPrecene() L62468: exp / expNeeded[currentLevel]
    //
    //   Home.userLevelUp() L167306:
    //     uesrLastLevel = level sebelum reward
    //     currentLevel = getUserLevel() → baca item 104
    //     if (currentLevel > uesrLastLevel) → openWindow("UserLevelUp")
    //
    //   Jadi: client mendeteksi level up dari PERUBAHAN item 104.
    //   Server WAJIB menghitung dan mengupdate 103 + 104 jika exp cukup.
    //
    // ═══════════════════════════════════════════════════════════

    /**
     * Proses level-up setelah semua reward diberikan.
     * Jika exp (103) >= expNeeded[level], naikkan level (104).
     * Bisa naik multiple level sekaligus.
     *
     * Algoritma:
     *   while (exp >= expNeeded[level] && level < MAX_USER_LEVEL):
     *     exp -= expNeeded[level]
     *     level += 1
     *
     * @param {object} savedData — user data (totalProps._items akan diupdate)
     * @param {object} changeItems — response _changeInfo._items (akan diupdate)
     * @returns {{ leveled: boolean, oldLevel: number, newLevel: number, newExp: number }}
     */
    function processLevelUp(savedData, changeItems) {
        var oldLevel = getBal(savedData, PLAYERLEVELID) || 1;
        if (oldLevel < 1) oldLevel = 1;
        var exp = getBal(savedData, PLAYEREXPERIENCEID);
        var level = oldLevel;
        var userUpgrade = loadJson('userUpgrade');

        if (!userUpgrade) {
            log.warn('LEVELUP', 'userUpgrade.json not found, skipping level-up check');
            return { leveled: false, oldLevel: oldLevel, newLevel: oldLevel, newExp: exp };
        }

        // Cek apakah ada perubahan exp sama sekali
        // (jika tidak ada reward exp, skip)
        if (exp <= 0 || level >= MAX_USER_LEVEL) {
            return { leveled: false, oldLevel: oldLevel, newLevel: level, newExp: exp };
        }

        // Loop level-up
        while (level < MAX_USER_LEVEL) {
            var levelEntry = userUpgrade[String(level)];
            if (!levelEntry) break; // tidak ada data level ini

            var expNeeded = Number(levelEntry.expNeeded) || 0;
            if (expNeeded <= 0) break; // safety

            if (exp >= expNeeded) {
                exp -= expNeeded;
                level++;
                log.details('LEVELUP', ['level ' + (level - 1) + '→' + level,
                    'needed ' + expNeeded + ', remaining exp=' + exp]);
            } else {
                break; // exp tidak cukup untuk level berikutnya
            }
        }

        // Cap di max level
        if (level > MAX_USER_LEVEL) {
            level = MAX_USER_LEVEL;
            exp = 0;
        }

        var leveled = (level > oldLevel);

        if (leveled) {
            // Update savedData
            setBal(savedData, PLAYERLEVELID, level);
            setBal(savedData, PLAYEREXPERIENCEID, exp);

            // Update response (client baca ini untuk deteksi level-up)
            changeItems[String(PLAYERLEVELID)] = { _id: PLAYERLEVELID, _num: level };
            changeItems[String(PLAYEREXPERIENCEID)] = { _id: PLAYEREXPERIENCEID, _num: exp };

            log.info('LEVELUP', 'Player leveled up: ' + oldLevel + ' → ' + level +
                ' (exp remaining: ' + exp + ')');
        }

        return { leveled: leveled, oldLevel: oldLevel, newLevel: level, newExp: exp };
    }

    // ═══════════════════════════════════════════════════════════
    //  TASK PROGRESS STORAGE
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    function getTodayStr() {
        var d = new Date();
        var yyyy = d.getUTCFullYear();
        var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(d.getUTCDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }

    /**
     * Memastikan _taskProgress ada di savedData.
     * Jika belum ada, inisialisasi dari config.
     *
     * Untuk MOCK SERVER: inisialisasi dengan state=COMPLETE (2) dan
     * curCount=targetCount, sehingga semua task bisa langsung di-claim.
     */
    function ensureTaskProgress(savedData) {
        if (savedData._taskProgress) {
            // Cek apakah daily perlu reset (hari berganti)
            if (savedData._taskProgress._dailyDate !== getTodayStr()) {
                initDailyProgress(savedData);
                savedData._taskProgress._dailyDate = getTodayStr();
            }
            return;
        }

        savedData._taskProgress = {
            _daily: {},
            _dailyDate: getTodayStr(),
            _achievements: {}
        };

        initDailyProgress(savedData);
        initAchievementProgress(savedData);
    }

    /**
     * Inisialisasi daily task progress dari taskDaily.json.
     * Semua task di-set COMPLETE (state=2) dengan curCount=targetCount.
     */
    function initDailyProgress(savedData) {
        var dailyConfig = loadJson('taskDaily');
        if (!dailyConfig) return;

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

        log.info('TASK', 'Daily task progress initialized: ' +
            Object.keys(savedData._taskProgress._daily).length + ' tasks (COMPLETE)');
    }

    /**
     * Inisialisasi achievement progress dari taskAchievement.json.
     * Hanya task pertama dari setiap chain yang di-set COMPLETE.
     * sisanya DEFAULT (locked).
     */
    function initAchievementProgress(savedData) {
        var achieveConfig = loadJson('taskAchievement');
        if (!achieveConfig) return;

        savedData._taskProgress._achievements = {};

        // Temukan semua "root" achievement — task yang TIDAK menjadi nextTaskID milik task lain
        var isChild = {};
        for (var id in achieveConfig) {
            var nextId = achieveConfig[id].nextTaskID;
            if (nextId) isChild[String(nextId)] = true;
        }

        // Temukan juga semua root per chain (task yang tidak punya prev)
        for (var id in achieveConfig) {
            var cfg = achieveConfig[id];
            if (!isChild[id]) {
                // Root achievement — set COMPLETE agar bisa langsung di-claim
                var target = Number(cfg.taskPara2) || Number(cfg.taskPara1) || 1;
                savedData._taskProgress._achievements[id] = {
                    _id: Number(id),
                    _curCount: target,
                    _targetCount: target,
                    _state: TASK_STATE_COMPLETE
                };
            } else {
                // Child achievement — set DEFAULT (locked), akan terbuka setelah parent di-claim
                var target2 = Number(cfg.taskPara2) || Number(cfg.taskPara1) || 1;
                savedData._taskProgress._achievements[id] = {
                    _id: Number(id),
                    _curCount: 0,
                    _targetCount: target2,
                    _state: TASK_STATE_DEFAULT
                };
            }
        }

        var rootCount = 0;
        for (var id in savedData._taskProgress._achievements) {
            if (savedData._taskProgress._achievements[id]._state === TASK_STATE_COMPLETE) rootCount++;
        }
        log.info('TASK', 'Achievement progress initialized: ' +
            Object.keys(savedData._taskProgress._achievements).length + ' achievements (' +
            rootCount + ' roots COMPLETE, rest locked)');
    }

    // ═══════════════════════════════════════════════════════════
    //  REWARD COLLECTION — baca semua slot reward dari config
    // ═══════════════════════════════════════════════════════════

    /**
     * Kumpulkan dan berikan semua reward dari config task.
     * Main task punya 2-3 slot (reward1-3/num1-3).
     * Daily & achievement punya 1 slot (reward1/num1).
     * Config main task: reward3="" berarti slot kosong → skip.
     *
     * @param {object} cfg — task config entry
     * @param {object} savedData — user data
     * @param {object} changeItems — akumulasi response items
     * @returns {number} total reward count yang diberikan
     */
    function collectRewards(cfg, savedData, changeItems) {
        var granted = 0;
        for (var slot = 1; slot <= MAX_REWARD_SLOTS; slot++) {
            var itemId = Number(cfg['reward' + slot]);
            var amount = Number(cfg['num' + slot]);

            // Skip slot kosong:
            // - daily/achievement: key tidak ada di JSON → undefined → falsy
            // - main task: reward3="" → Number("")=0 → falsy
            if (!itemId || itemId <= 0) continue;
            if (!amount || amount <= 0) continue;

            grantReward(savedData, changeItems, itemId, amount);
            granted++;
        }
        return granted;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN TASK LOGIC (taskClass = 1)
    // ═══════════════════════════════════════════════════════════
    //
    // Main task chain: 6001→6002→...→6044 (linear, nextTaskID).
    // Progress disimpan di savedData.curMainTask = [{ _id, _state }].
    // enterGame.js L1529: default curMainTask = [{ _id: 6001, _state: 1 }].
    //
    // Client L173950-173960:
    //   request: taskIds:[currentMainTask._id], taskClass:TASK_CLASS.MAIN
    //   response._nextTasks → setMainTaskWithComplete(n._nextTasks)
    //   response → openCongratulationObtain(n, callback → setMainTask())
    //
    // Response: { _nextTasks: [{ _id: nextId, _state: 1 }], _changeInfo: { _items } }

    function handleMainTask(savedData, taskIds, changeItems) {
        var curMainTask = savedData.curMainTask;
        if (!curMainTask || !curMainTask.length || !curMainTask[0]) {
            log.error('TASK', 'curMainTask missing or empty');
            return null;
        }

        var currentId = Number(curMainTask[0]._id);
        var currentState = Number(curMainTask[0]._state);

        // Validasi: taskIds harus berisi current main task ID
        var requestedId = Number(taskIds[0]);
        if (requestedId !== currentId) {
            log.error('TASK', 'Main task mismatch: requested=' + requestedId + ' current=' + currentId);
            return null;
        }

        // Validasi: state harus COMPLETE (2)
        if (currentState !== TASK_STATE_COMPLETE) {
            log.error('TASK', 'Main task not COMPLETE: id=' + currentId + ' state=' + currentState);
            return null;
        }

        // Load config untuk current task
        var cfg = getTaskConfig(currentId, 'task');
        if (!cfg) {
            log.error('TASK', 'Main task config not found: ' + currentId);
            return null;
        }

        // Berikan rewards
        var granted = collectRewards(cfg, savedData, changeItems);
        if (granted === 0) {
            log.error('TASK', 'No rewards granted for main task ' + currentId);
            return null;
        }

        // Advance ke task berikutnya
        var nextId = cfg.nextTaskID ? Number(cfg.nextTaskID) : 0;
        var response;

        if (nextId > 0) {
            // Ada next task → set current ke DOING
            curMainTask[0] = { _id: nextId, _state: TASK_STATE_DOING };
            response = { _nextTasks: [{ _id: nextId, _state: TASK_STATE_DOING }] };
            log.info('TASK', 'Main task advanced: ' + currentId + ' → ' + nextId);
        } else {
            // Akhir chain (6044) → set state FINISH, tidak ada next
            curMainTask[0] = { _id: currentId, _state: TASK_STATE_FINISH };
            response = { _nextTasks: [] };
            log.info('TASK', 'Main task chain completed at ' + currentId);
        }

        return response;
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY TASK LOGIC (taskClass = 2)
    // ═══════════════════════════════════════════════════════════
    //
    // Progress disimpan di savedData._taskProgress._daily.
    // Config: taskDaily.json (28 tasks, ID 6101-6131).
    //
    // Client L173783-173792 (akeyGainBtnTap, multi-claim):
    //   request: taskIds:[...completeTaskIds], taskClass:TASK_CLASS.DAILY
    //   response._finishTasks → refreshTaskList(t._finishTasks[n]) → set state=3
    //   response._nextTasks → firstTaskInfoRefresh(taskId, t._nextTasks) → update total bar
    //
    // Client L173796-173804 (totalTaskBtnTap, single total task):
    //   Sama format, tapi untuk "complete N daily tasks" bonus reward
    //
    // Response: { _finishTasks: [...], _nextTasks: [...], _changeInfo: { _items } }

    function handleDailyTask(savedData, taskIds, changeItems) {
        var daily = savedData._taskProgress._daily;
        var finishTasks = [];
        var nextTasks = [];

        for (var i = 0; i < taskIds.length; i++) {
            var taskId = String(taskIds[i]);
            var progress = daily[taskId];

            if (!progress) {
                log.warn('TASK', 'Daily task ' + taskId + ' not found in progress, skipping');
                continue;
            }

            if (progress._state !== TASK_STATE_COMPLETE) {
                log.warn('TASK', 'Daily task ' + taskId + ' not COMPLETE (state=' + progress._state + '), skipping');
                continue;
            }

            // Load config untuk reward
            var cfg = getTaskConfig(Number(taskId), 'taskDaily');
            if (!cfg) {
                log.error('TASK', 'Daily task config not found: ' + taskId);
                continue;
            }

            // Berikan rewards
            var granted = collectRewards(cfg, savedData, changeItems);
            if (granted === 0) {
                log.warn('TASK', 'No rewards for daily task ' + taskId);
                continue;
            }

            // Update state → FINISH
            progress._state = TASK_STATE_FINISH;
            finishTasks.push(Number(taskId));
            nextTasks.push({
                _id: Number(taskId),
                _state: TASK_STATE_FINISH
            });

            log.info('TASK', 'Daily task claimed: ' + taskId + ' (' + granted + ' rewards)');
        }

        if (finishTasks.length === 0) {
            log.error('TASK', 'No daily tasks were successfully claimed');
            return null;
        }

        return {
            _finishTasks: finishTasks,
            _nextTasks: nextTasks
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  ACHIEVEMENT LOGIC (taskClass = 3)
    // ═══════════════════════════════════════════════════════════
    //
    // Progress disimpan di savedData._taskProgress._achievements.
    // Config: taskAchievement.json (127 achievements, ID 6201-6531).
    // Achievement punya chain: 6201→6202→...→6207 (end), dst.
    //
    // Client L173252-173265 (achievement_receiveBtnTap, single):
    //   request: taskIds:[taskId], taskClass:TASK_CLASS.ACHIEVEMENT
    //   response._finishTasks → refreshAchievementList(e.taskId, t._nextTask)
    //   response._nextTask → addNewAchievement(t._nextTask) jika ada
    //
    // Client L173300-173318 (akeyGainBtnTap, multi):
    //   response._finishTasks → loop: refreshAchievementList(t._finishTasks[n], t._nextTasks[n])
    //   response._nextTasks → array: setiap element _nextTask
    //
    // Response (single): { _finishTasks: [id], _nextTask: {...}, _changeInfo }
    // Response (multi):   { _finishTasks: [id1,...], _nextTasks: [{...},...], _changeInfo }
    //   Note: client multi (L173314-173316) pakai t._finishTasks[n] dan t._nextTasks[n]
    //   Client single (L173264) pakai t._nextTask (tunggal, bukan array)
    //   Keduanya dipanggil dari tempat berbeda → handler harus mendukung keduanya.
    //   Solusi: selalu kirim _finishTasks + _nextTasks (array) + _nextTask (single).
    //   Client single pakai _nextTask, client multi pakai _nextTasks.
    //   Tidak ada konflik karena client hanya membaca field yang dia butuh.

    function handleAchievement(savedData, taskIds, changeItems) {
        var achievements = savedData._taskProgress._achievements;
        var achieveConfig = loadJson('taskAchievement');
        if (!achieveConfig) {
            log.error('TASK', 'taskAchievement.json not found');
            return null;
        }

        var finishTasks = [];
        var nextTasksArr = [];  // untuk multi-claim (L173314-173316)
        var singleNextTask = null;  // untuk single-claim (L173264)

        for (var i = 0; i < taskIds.length; i++) {
            var taskId = String(taskIds[i]);
            var progress = achievements[taskId];

            if (!progress) {
                log.warn('TASK', 'Achievement ' + taskId + ' not found in progress, skipping');
                continue;
            }

            if (progress._state !== TASK_STATE_COMPLETE) {
                log.warn('TASK', 'Achievement ' + taskId + ' not COMPLETE (state=' + progress._state + '), skipping');
                continue;
            }

            // Load config
            var cfg = achieveConfig[taskId];
            if (!cfg) {
                log.error('TASK', 'Achievement config not found: ' + taskId);
                continue;
            }

            // Berikan rewards
            var granted = collectRewards(cfg, savedData, changeItems);
            if (granted === 0) {
                log.warn('TASK', 'No rewards for achievement ' + taskId);
                continue;
            }

            // Update state → FINISH
            progress._state = TASK_STATE_FINISH;
            finishTasks.push(Number(taskId));

            // Advance chain: cari next achievement
            var nextId = cfg.nextTaskID ? Number(cfg.nextTaskID) : 0;
            var nextEntry = null;

            if (nextId > 0 && achieveConfig[String(nextId)]) {
                var nextCfg = achieveConfig[String(nextId)];
                var nextTarget = Number(nextCfg.taskPara2) || Number(nextCfg.taskPara1) || 1;

                // Unlock next achievement → set COMPLETE (mock: langsung bisa klaim)
                if (!achievements[String(nextId)]) {
                    achievements[String(nextId)] = {
                        _id: nextId,
                        _curCount: nextTarget,
                        _targetCount: nextTarget,
                        _state: TASK_STATE_COMPLETE
                    };
                } else {
                    achievements[String(nextId)]._state = TASK_STATE_COMPLETE;
                    achievements[String(nextId)]._curCount = nextTarget;
                }

                nextEntry = {
                    _id: nextId,
                    _curCount: nextTarget,
                    _targetCount: nextTarget,
                    _state: TASK_STATE_COMPLETE
                };

                log.info('TASK', 'Achievement chain advanced: ' + taskId + ' → ' + nextId);
            } else {
                log.info('TASK', 'Achievement chain ended at ' + taskId);
            }

            nextTasksArr.push(nextEntry);
            // _nextTask = entry terakhir (client single claim pakai ini)
            singleNextTask = nextEntry;

            log.info('TASK', 'Achievement claimed: ' + taskId + ' (' + granted + ' rewards)');
        }

        if (finishTasks.length === 0) {
            log.error('TASK', 'No achievements were successfully claimed');
            return null;
        }

        var result = {
            _finishTasks: finishTasks
        };

        // Kirim keduanya agar client single & multi bisa membaca
        if (nextTasksArr.length > 0) {
            result._nextTasks = nextTasksArr;
        }
        if (singleNextTask) {
            result._nextTask = singleNextTask;
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetReward(request, callback) {
        var userId = request.userId;
        var taskClass = Number(request.taskClass);
        var taskIds = request.taskIds;

        log.info('TASK', 'task/getReward — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['taskClass', String(taskClass)],
            ['taskIds', JSON.stringify(taskIds)],
            ['version', request.version || '-']
        ]);

        // ── VALIDASI REQUEST ──
        if (!userId) {
            log.error('TASK', 'Missing userId');
            callback({}, 1);
            return;
        }

        if (!taskClass || taskClass < 1 || taskClass > 3) {
            log.error('TASK', 'Invalid taskClass: ' + taskClass);
            callback({}, 1);
            return;
        }

        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            log.error('TASK', 'Missing or empty taskIds');
            callback({}, 1);
            return;
        }

        // ── LOAD USER DATA ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('TASK', 'User data not found: ' + storageKey);
            callback({}, 1);
            return;
        }

        // ── ENSURE TASK PROGRESS EXISTS ──
        // Inisialisasi dari config jika belum ada.
        // Untuk MAIN task: pastikan curMainTask ada.
        // Untuk DAILY/ACHIEVEMENT: pastikan _taskProgress ada.
        try {
            ensureTaskProgress(savedData);

            if (taskClass === TASK_CLASS_MAIN && (!savedData.curMainTask || !savedData.curMainTask.length)) {
                // Fallback: init main task ke 6001 DOING
                savedData.curMainTask = [{ _id: 6001, _state: TASK_STATE_DOING }];
                log.warn('TASK', 'curMainTask was empty, initialized to 6001');
            }
        } catch (initErr) {
            log.error('TASK', 'Failed to initialize task progress: ' + initErr.message);
            callback({}, 1);
            return;
        }

        // ── PROCESS BERDASARKAN TASK CLASS ──
        var changeItems = {};
        var taskResult = null;

        try {
            if (taskClass === TASK_CLASS_MAIN) {
                // Untuk MAIN: set state COMPLETE dulu agar bisa di-claim (mock behavior)
                if (savedData.curMainTask[0]._state === TASK_STATE_DOING) {
                    savedData.curMainTask[0]._state = TASK_STATE_COMPLETE;
                    log.info('TASK', 'Main task set to COMPLETE for mock claim: id=' + savedData.curMainTask[0]._id);
                }
                taskResult = handleMainTask(savedData, taskIds, changeItems);
            } else if (taskClass === TASK_CLASS_DAILY) {
                taskResult = handleDailyTask(savedData, taskIds, changeItems);
            } else if (taskClass === TASK_CLASS_ACHIEVEMENT) {
                taskResult = handleAchievement(savedData, taskIds, changeItems);
            }
        } catch (err) {
            log.error('TASK', 'UNCAUGHT ERROR during processing', err);
            callback({}, 1);
            return;
        }

        if (!taskResult) {
            log.error('TASK', 'Processing failed — no result');
            callback({}, 1);
            return;
        }

        // ── PROCESS LEVEL-UP ──
        // Sebelum SAVE — proses level-up agar perubahan exp/level ikut tersimpan.
        // Ini mengupdate item 103 (exp) dan 104 (level) di savedData.
        var changeItemsForResponse = {};
        for (var k in changeItems) changeItemsForResponse[k] = changeItems[k];
        var levelResult = processLevelUp(savedData, changeItemsForResponse);

        // ── SAVE USER DATA (termasuk hasil level-up) ──
        try {
            db._set(storageKey, savedData);
            log.info('TASK', 'User data saved' +
                (levelResult.leveled ? ' (level-up: ' + levelResult.oldLevel + '→' + levelResult.newLevel + ')' : ''));
        } catch (saveErr) {
            log.error('TASK', 'Failed to save user data: ' + saveErr.message);
            callback({}, 1);
            return;
        }

        // ── BUILD RESPONSE ──
        var response = {};

        // Copy task-specific fields
        for (var key in taskResult) {
            response[key] = taskResult[key];
        }

        // Add _changeInfo (WAJIB — client cek ini untuk popup reward)
        // Termasuk update exp (103) dan level (104) jika ada level-up
        response._changeInfo = { _items: changeItemsForResponse };

        log.info('TASK', 'task/getReward — SUCCESS');
        log.details('response', [
            ['taskClass', String(taskClass)],
            ['finishTasks', JSON.stringify(response._finishTasks || [])],
            ['changeItems', JSON.stringify(Object.keys(response._changeInfo._items))],
            ['hasNextTask', response._nextTask ? 'yes' : 'no'],
            ['hasNextTasks', response._nextTasks ? 'yes' : 'no'],
            ['leveledUp', levelResult.leveled ? 'YES ' + levelResult.oldLevel + '→' + levelResult.newLevel : 'no']
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('task', 'getReward', handleGetReward);

    window.MainServer = MainServer;
})();