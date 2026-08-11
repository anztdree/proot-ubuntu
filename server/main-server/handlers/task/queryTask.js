/**
 * handlers/task/queryTask.js — Query Task List Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: task/queryTask
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Return daftar task user berdasarkan taskClass (DAILY / ACHIEVEMENT / MAIN).
 *   Client pakai untuk render TaskMain panel (daily) atau AchievementMain panel.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js):
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [L56820] runSceneEveryDayTaskOrAchievement (ACHIEVEMENT mode):
 *     ts.processHandler({
 *         type: "task", action: "queryTask",
 *         userId: <userId>,
 *         taskClass: TASK_CLASS.ACHIEVEMENT  // = 3
 *     }, function(t) {
 *         ts.runScene("AchievementMain", {
 *             parent: "task",
 *             value: t._tasks,
 *             isAchievement: true
 *         })
 *     })
 *
 *   [L56830] runSceneEveryDayTaskOrAchievement (DAILY mode):
 *     ts.processHandler({
 *         type: "task", action: "queryTask",
 *         userId: <userId>,
 *         taskClass: TASK_CLASS.DAILY  // = 2
 *     }, function(t) {
 *         ts.runScene("TaskMain", {
 *             parent: "task",
 *             value: t._tasks,
 *             isAchievement: false
 *         })
 *     })
 *
 *   [L173725] refreshTaskListWithCloseWindow:
 *     ts.processHandler({
 *         type: "task", action: "queryTask",
 *         userId: <userId>,
 *         taskClass: TASK_CLASS.DAILY  // = 2
 *     }, function(n) {
 *         t.initList(n._tasks);
 *         t.params.value = n._tasks;
 *     })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ENUMS (verified dari main.min.js)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   TASK_CLASS (L173395):
 *     UNKNOW = 0, MAIN = 1, DAILY = 2, ACHIEVEMENT = 3
 *
 *   TASK_STATE (L62602):
 *     DEFAULT = 0  (locked / not started)
 *     DOING = 1    (in progress)
 *     COMPLETE = 2 (can claim reward)
 *     FINISH = 3   (already claimed)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L56822, L56833, L173727)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _tasks: {
 *           "<taskId>": {
 *               _id: <number>,
 *               _curCount: <number>,
 *               _targetCount: <number>,
 *               _state: <number>
 *           },
 *           ...
 *       }
 *   })
 *
 *   Client (TaskMainViewData.initList L174030) cross-reference
 *   response._tasks dengan config taskDaily.json / taskAchievement.json:
 *     - n[s].reward1     → item reward
 *     - n[s].num1        → item reward count
 *     - n[s].name        → task name
 *     - n[s].levelNeeded → unlock level
 *     - n[s].sort        → sort order
 *     - n[s].linkTo      → link to action
 *     - n[s].taskType    → filter (skip "dailyTask" type in TaskMain)
 *     - n[s].isHide      → skip hidden tasks
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONFIG FILES
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   task.json (44 entries, type="main"):
 *     id, type, levelNeeded, image, taskType, taskPara1, taskTime,
 *     linkTo, linkToShow, rewardNum, reward1, num1, reward2, num2, reward3, num3,
 *     nextTaskID, name, describe1, describe2
 *
 *   taskDaily.json (28 entries, type="daily"):
 *     id, type, sort, levelNeeded, taskType, taskPara1, taskTime,
 *     rewardNum, reward1, num1, reward2, num2, reward3, num3,
 *     linkTo, name, isHide (optional)
 *
 *   taskAchievement.json (127 entries, type="achievement"):
 *     id, type, levelNeeded, listPara, taskType, taskPara1, taskPara2,
 *     taskTime, rewardNum, reward1, num1, nextTaskID, name
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TASK STATE LOGIC
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Client (TaskItem.initGroup L173470):
 *     state == 0 (DEFAULT) → show unlockGroup (locked)
 *     state == 1 (DOING)   → show normalGroup + pageBtn (in progress)
 *     state == 2 (COMPLETE)→ show receiveGroup + receiveBtn (can claim)
 *     state == 3 (FINISH)  → show completeGroup (claimed)
 *
 *   Client juga cek level (TaskMainViewData.initList L174060):
 *     if (levelNeeded > userLevel) → state = 0 (forced DEFAULT/locked)
 *
 *   Trial:
 *     - DAILY tasks: return semua task dari taskDaily.json
 *       - state = DOING (1) untuk task yang levelNeeded <= userLevel
 *       - state = DEFAULT (0) untuk task yang levelNeeded > userLevel
 *       - curCount = 0 (no progress tracking yet)
 *       - targetCount = taskPara1 (dari config)
 *
 *     - ACHIEVEMENT tasks: return semua task dari taskAchievement.json
 *       - state = DOING (1) untuk task yang levelNeeded <= userLevel
 *       - state = DEFAULT (0) untuk task yang levelNeeded > userLevel
 *       - curCount = 0
 *       - targetCount = taskPara2 (dari config)
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS — verified dari main.min.js
    // ═══════════════════════════════════════════════════════════

    var TASK_CLASS = {
        UNKNOW: 0,
        MAIN: 1,
        DAILY: 2,
        ACHIEVEMENT: 3
    };

    var TASK_STATE = {
        DEFAULT: 0,
        DOING: 1,
        COMPLETE: 2,
        FINISH: 3
    };

    var PLAYER_LEVEL_ID = 104;

    // ═══════════════════════════════════════════════════════════
    //  STORAGE & ITEM HELPERS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    function getUserLevel(savedData) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 1;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === PLAYER_LEVEL_ID) {
                return Number(items[i]._num) || 1;
            }
        }
        return 1;
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
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
            log.error('RESOURCE', 'queryTask failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'queryTask failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getDailyTaskConfig() {
        return loadJsonSync('taskDaily');
    }

    function getAchievementConfig() {
        return loadJsonSync('taskAchievement');
    }

    // NOTE: MAIN tasks (taskClass=1) TIDAK di-handle di queryTask.
    // Main tasks di-handle via enterGame.js (curMainTask) + task/getReward (MAIN).
    // queryTask hanya untuk DAILY (2) dan ACHIEVEMENT (3).

    // ═══════════════════════════════════════════════════════════
    //  TASK STATE STORAGE
    // ═══════════════════════════════════════════════════════════

    function taskStorageKey(userId, taskClass) {
        return 'ms_task_' + userId + '_' + taskClass;
    }

    function loadTaskState(userId, taskClass) {
        var key = taskStorageKey(userId, taskClass);
        var state = db._get(key);
        if (!state || typeof state !== 'object') {
            state = {};
            db._set(key, state);
        }
        return state;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD TASK ENTRY
    // ═══════════════════════════════════════════════════════════

    function buildTaskEntry(taskConfig, taskState, userLevel, isAchievement) {
        var taskId = Number(taskConfig.id);
        var levelNeeded = Number(taskConfig.levelNeeded) || 1;

        var targetCount;
        if (isAchievement) {
            targetCount = Number(taskConfig.taskPara2) || Number(taskConfig.taskPara1) || 1;
        } else {
            targetCount = Number(taskConfig.taskPara1) || 1;
        }

        var savedEntry = taskState[String(taskId)] || {};
        var savedState = Number(savedEntry._state);
        var curCount = Number(savedEntry._curCount) || 0;

        var state;
        if (levelNeeded > userLevel) {
            state = TASK_STATE.DEFAULT;
        } else if (savedState === TASK_STATE.FINISH) {
            state = TASK_STATE.FINISH;
        } else if (savedState === TASK_STATE.COMPLETE) {
            state = TASK_STATE.COMPLETE;
        } else if (curCount >= targetCount) {
            state = TASK_STATE.COMPLETE;
        } else {
            state = TASK_STATE.DOING;
        }

        return {
            _id: taskId,
            _curCount: curCount,
            _targetCount: targetCount,
            _state: state
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleQueryTask(request, callback) {
        var userId = request && request.userId;
        var taskClass = Number(request && request.taskClass);

        log.info('TASK', 'task/queryTask START — userId=' + (userId || '-')
            + ', taskClass=' + taskClass);

        try {
            if (!userId) {
                log.warn('TASK', 'queryTask — missing userId');
                callback({}, 1);
                return;
            }

            // MAIN (1) TIDAK di-handle di queryTask — main tasks via enterGame curMainTask
            if (taskClass !== TASK_CLASS.DAILY &&
                taskClass !== TASK_CLASS.ACHIEVEMENT) {
                log.warn('TASK', 'queryTask — invalid taskClass: ' + taskClass
                    + ' (only 2=DAILY, 3=ACHIEVEMENT supported)');
                callback({}, 1);
                return;
            }

            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) {
                log.warn('TASK', 'queryTask — user data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            var userLevel = getUserLevel(savedData);

            var config;
            var isAchievement = false;
            var configName;

            if (taskClass === TASK_CLASS.DAILY) {
                config = getDailyTaskConfig();
                configName = 'taskDaily';
            } else if (taskClass === TASK_CLASS.ACHIEVEMENT) {
                config = getAchievementConfig();
                configName = 'taskAchievement';
                isAchievement = true;
            }

            if (!config) {
                log.error('TASK', 'queryTask — failed to load ' + configName + '.json');
                callback({}, 1);
                return;
            }

            var taskState = loadTaskState(userId, taskClass);

            var tasks = {};
            var taskCount = 0;
            var completeCount = 0;
            var finishCount = 0;

            for (var key in config) {
                if (!config.hasOwnProperty(key)) continue;
                var taskConfig = config[key];

                if (Number(taskConfig.isHide) === 1) continue;

                var entry = buildTaskEntry(taskConfig, taskState, userLevel, isAchievement);
                tasks[String(entry._id)] = entry;
                taskCount++;

                if (entry._state === TASK_STATE.COMPLETE) completeCount++;
                if (entry._state === TASK_STATE.FINISH) finishCount++;
            }

            log.info('TASK', 'queryTask SUCCESS — '
                + configName + ': ' + taskCount + ' tasks'
                + ', doing=' + (taskCount - completeCount - finishCount)
                + ', complete=' + completeCount
                + ', finish=' + finishCount
                + ', userLevel=' + userLevel);
            log.details('response', [
                ['userId', userId],
                ['taskClass', taskClass + ' (' + ({1:'MAIN',2:'DAILY',3:'ACHIEVEMENT'})[taskClass] + ')'],
                ['config', configName + '.json'],
                ['tasks.count', taskCount],
                ['tasks.complete', completeCount],
                ['tasks.finish', finishCount],
                ['userLevel', userLevel]
            ]);

            callback({ _tasks: tasks });

        } catch (err) {
            log.error('TASK', 'queryTask UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('task', 'queryTask', handleQueryTask);
})();
