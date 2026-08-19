/**
 * handlers/equip/merge.js — Equipment Merge (Smithy Synthesis)
 * Super Warrior Z — MAIN SERVER (port 8001)
 *
 * ═══════════════════════════════════════════════════════════════════
 * KAMUS UTAMA: main.min.js
 * ═══════════════════════════════════════════════════════════════════
 *
 *  getEquipment() [line 61347]:
 *    for each equip[n] with mergeResult:
 *      t[equip[n].mergeResult] = equip[n]
 *      t[equip[n].mergeResult].mergeFrom = equip[n].id
 *    → Object key = RESULT id, .mergeFrom = SOURCE id, field lain = dari source
 *
 *  getEquipmentWithType(type, isRedPage) [line 61331]:
 *    for each equip[n] with mergeResult:
 *      (normal page: skip jika result quality == "red")
 *      push {equipId: mergeResult, from: id, mergeCostID, mergeCostNum, mergePlayerLevel}
 *    → UI list: equipId = RESULT, from = SOURCE
 *
 *  itemClick(t) [line 71673]:
 *    o = SmithyItemsList[t].info.equipId  (RESULT id)
 *    a = getConsumeItem(o) → getEquipment()[o].mergeFrom  (SOURCE id)
 *    composeItemCount = composeCount(o)  (max operasi)
 *    currentChooseItemID = o (RESULT id)
 *    currnetCostId = mergeCostID
 *    setTempCount(a) → tempCount = getItemNum(SOURCE)
 *
 *  consumeId(e) [line 63899]:
 *    return getEquipment()[e].mergeFrom  (RESULT → SOURCE)
 *
 *  consumeCount(e) [line 63893]:
 *    return mergeNum * e  (operasi × mergeNum = total source dikonsumsi)
 *
 *  upgradeBtnTimeTap() [line 71749]:
 *    n = composeItemCount  (jumlah operasi)
 *    o = consumeCount(n)   (total source = n * mergeNum)
 *    a = consumeId(currentChooseItemID)  (source id)
 *    request(o, a)
 *
 *  request(e, t) [line 71709]:
 *    ts.processHandler({type:"equip", action:"merge",
 *      userId, count: e, equipId: t, version:"1.0"}, successCb, errorCb)
 *    → count = total source dikonsumsi
 *    → equipId = SOURCE equip id
 *
 *  successCb:
 *    e._changItem._items → animasi
 *    e._changItem._items[Number(t)]._num → update UI (t = sourceId)
 *
 * ═══════════════════════════════════════════════════════════════════
 * MERGE MECHANIC
 * ═══════════════════════════════════════════════════════════════════
 *
 *  count = total source equip dikonsumsi = composeItemCount × mergeNum
 *  operations = count / mergeNum (selalu exact, client jamin kelipatan)
 *  source dikonsumsi: operations × mergeNum = count
 *  cost dikonsumsi:   operations × costNum
 *  result diproduksi: operations
 *
 *  mergeNum: source quality "red" → redequipMergeNum(2), else → equipMergeNum(3)
 *
 *  equip.json: TIDAK punya field "mergeFrom". mergeFrom dibuat runtime oleh client.
 *  Server: equipId (SOURCE) → baca equipCfg[equipId].mergeResult = RESULT id
 *
 * ═══════════════════════════════════════════════════════════════════
 * TASK PROCESSING
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Client tidak punya task increment — 100% server-side.
 *  1. Daily #6108 (merge, taskPara1:1)
 *  2. Main #6026 (mergeQuality, taskPara1:1, levelNeeded:23) + BUG2 fix
 *  3. Achievement — TIDAK di sini (auto by task/getReward.js)
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var TASK_STATE_DEFAULT  = 0;
    var TASK_STATE_DOING    = 1;
    var TASK_STATE_COMPLETE = 2;
    var TASK_STATE_FINISH   = 3;

    var PLAYERLEVELID = 104;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE
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
            log.error('MERGE', 'Failed to load ' + name + '.json: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE — Pattern: wearAuto.js
    //  savedData.totalProps._items = [{_id, _num}, ...]
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
                return;
            }
        }
        items.push({ _id: id, _num: val });
    }

    // ═══════════════════════════════════════════════════════════
    //  DAILY TASK — #6108 (taskType:"merge", taskPara1:1)
    // ═══════════════════════════════════════════════════════════

    function processDailyTask(savedData, ops) {
        var taskDailyCfg = loadJson('taskDaily');
        if (!taskDailyCfg) return;

        var matchedTask = null;
        var matchedTaskId = null;
        for (var tid in taskDailyCfg) {
            if (taskDailyCfg[tid].taskType === 'merge') {
                matchedTask = taskDailyCfg[tid];
                matchedTaskId = Number(tid);
                break;
            }
        }
        if (!matchedTask) return;

        if (!savedData._dailyTaskProgress) savedData._dailyTaskProgress = {};
        savedData._dailyTaskProgress['merge'] =
            (savedData._dailyTaskProgress['merge'] || 0) + ops;
        var curCount = savedData._dailyTaskProgress['merge'];

        log.details('MERGE', [
            ['dailyTask', 'merge count=' + curCount + ' (+' + ops + ')']
        ]);

        var targetCount = Number(matchedTask.taskPara1) || 1;
        if (!savedData._dailyTaskStates) savedData._dailyTaskStates = {};
        var prevState = savedData._dailyTaskStates[matchedTaskId];
        if (prevState === undefined || prevState === null) {
            var levelNeeded = Number(matchedTask.levelNeeded) || 1;
            var playerLevel = getBal(savedData, PLAYERLEVELID) || 1;
            prevState = (playerLevel >= levelNeeded) ? TASK_STATE_DOING : TASK_STATE_DEFAULT;
            savedData._dailyTaskStates[matchedTaskId] = prevState;
        }

        if (prevState === TASK_STATE_DOING && curCount >= targetCount) {
            savedData._dailyTaskStates[matchedTaskId] = TASK_STATE_COMPLETE;
            log.info('MERGE', 'Daily task ' + matchedTaskId + ' DOING -> COMPLETE');
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN TASK — #6026 (taskType:"mergeQuality", taskPara1:1)
    // ═══════════════════════════════════════════════════════════

    function processMainTask(savedData, ops) {
        var cmt = savedData.curMainTask;
        if (!cmt || !Array.isArray(cmt) || cmt.length === 0 || cmt[0]._state !== TASK_STATE_DOING) {
            return;
        }

        var taskCfg = loadJson('task');
        if (!taskCfg) return;

        var taskDef = taskCfg[String(cmt[0]._id)];
        if (!taskDef || taskDef.taskType !== 'mergeQuality') return;

        if (!savedData._mergeQualityProgress) {
            savedData._mergeQualityProgress = 0;
        }
        savedData._mergeQualityProgress = savedData._mergeQualityProgress + ops;
        var mergeCount = savedData._mergeQualityProgress;
        var needed = Number(taskDef.taskPara1) || 1;

        log.details('MERGE', [
            ['mainTask', 'mergeQuality ' + mergeCount + '/' + needed]
        ]);

        if (mergeCount >= needed) {
            cmt[0]._state = TASK_STATE_COMPLETE;
            log.info('MERGE', 'Main task ' + cmt[0]._id + ' DOING -> COMPLETE');
            if (typeof MainServer.notify === 'function') {
                MainServer.notify({
                    action: 'mainTaskChange',
                    _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_COMPLETE }]
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  BUG2 FIX — DEFAULT→DOING
    // ═══════════════════════════════════════════════════════════

    function bug2Fix(savedData) {
        try {
            var cmt = savedData.curMainTask;
            if (!cmt || !Array.isArray(cmt) || cmt.length === 0) return;
            if (cmt[0]._state !== TASK_STATE_DEFAULT) return;

            var tc = loadJson('task');
            var def = tc && tc[String(cmt[0]._id)];
            var levelNeeded = def ? (Number(def.levelNeeded) || 1) : 1;
            var currentLevel = getBal(savedData, PLAYERLEVELID) || 1;

            if (currentLevel >= levelNeeded) {
                cmt[0]._state = TASK_STATE_DOING;
                log.info('MERGE', 'BUG2: task ' + cmt[0]._id + ' DEFAULT -> DOING');
                if (typeof MainServer.notify === 'function') {
                    MainServer.notify({
                        action: 'mainTaskChange',
                        _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_DOING }]
                    });
                }
            }
        } catch (err) {
            log.warn('MERGE', 'BUG2 error: ' + (err.message || err));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER
    // ═══════════════════════════════════════════════════════════

    function handle(request, callback) {
        var userId = request.userId;
        var count = Number(request.count) || 0;
        var equipId = Number(request.equipId) || 0;

        log.info('MERGE', 'equip/merge processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['count', String(count)],
            ['equipId', String(equipId)]
        ]);

        if (!userId) {
            log.warn('MERGE', 'Missing userId');
            callback({}, 1);
            return;
        }

        if (count < 1) {
            log.warn('MERGE', 'Invalid count: ' + request.count);
            callback({}, 1);
            return;
        }

        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('MERGE', 'User data not found: ' + storageKey);
            callback({}, 1);
            return;
        }

        var equipCfg = loadJson('equip');
        if (!equipCfg) {
            log.error('MERGE', 'equip.json not found');
            callback({}, 1);
            return;
        }

        var sourceCfg = equipCfg[String(equipId)];
        if (!sourceCfg) {
            log.warn('MERGE', 'Invalid equipId: ' + equipId);
            callback({}, 1);
            return;
        }

        var resultId = sourceCfg.mergeResult;
        if (!resultId) {
            log.warn('MERGE', 'Equip ' + equipId + ' has no mergeResult (max tier)');
            callback({}, 1);
            return;
        }
        resultId = Number(resultId);

        var constantCfg = loadJson('constant');
        if (!constantCfg) {
            log.error('MERGE', 'constant.json not found');
            callback({}, 1);
            return;
        }

        var sourceQuality = sourceCfg.quality;
        var mergeNum;
        if (sourceQuality === 'red') {
            mergeNum = Number(constantCfg[1].redequipMergeNum) || 2;
        } else {
            mergeNum = Number(constantCfg[1].equipMergeNum) || 3;
        }

        var costId = Number(sourceCfg.mergeCostID);
        var costNum = Number(sourceCfg.mergeCostNum) || 0;
        var playerLevelNeeded = Number(sourceCfg.mergePlayerLevel) || 0;

        log.details('MERGE', [
            ['config', 'src=' + equipId + ' result=' + resultId +
                ' cost=' + costId + 'x' + costNum +
                ' mergeNum=' + mergeNum + ' quality=' + sourceQuality +
                ' lvlReq=' + playerLevelNeeded]
        ]);

        var playerLevel = getBal(savedData, PLAYERLEVELID) || 1;
        var sourceBalance = getBal(savedData, equipId);
        var costBalance = getBal(savedData, costId);
        var resultBalance = getBal(savedData, resultId);

        log.details('MERGE', [
            ['balances', 'src(' + equipId + ')=' + sourceBalance +
                ' cost(' + costId + ')=' + costBalance +
                ' result(' + resultId + ')=' + resultBalance +
                ' playerLvl=' + playerLevel]
        ]);

        if (playerLevel < playerLevelNeeded) {
            log.warn('MERGE', 'Player level ' + playerLevel + ' < ' + playerLevelNeeded);
            callback({}, 1);
            return;
        }

        // count = total source dikonsumsi (dari client: composeItemCount * mergeNum)
        // operations = count / mergeNum (selalu exact, client jamin kelipatan)
        var operations = Math.floor(count / mergeNum);
        if (operations < 1) {
            log.warn('MERGE', 'count=' + count + ' < mergeNum=' + mergeNum);
            callback({}, 1);
            return;
        }

        var totalSourceNeeded = operations * mergeNum;
        if (sourceBalance < totalSourceNeeded) {
            log.warn('MERGE', 'Source ' + equipId + ' ' + sourceBalance + ' < ' + totalSourceNeeded);
            callback({}, 1);
            return;
        }

        var totalCostNeeded = operations * costNum;
        if (costBalance < totalCostNeeded) {
            log.warn('MERGE', 'Cost ' + costId + ' ' + costBalance + ' < ' + totalCostNeeded);
            callback({}, 1);
            return;
        }

        var newSourceBalance = sourceBalance - totalSourceNeeded;
        var newCostBalance = costBalance - totalCostNeeded;
        var newResultBalance = resultBalance + operations;

        log.details('MERGE', [
            ['compute', 'src ' + sourceBalance + '->' + newSourceBalance +
                ' cost ' + costBalance + '->' + newCostBalance +
                ' result ' + resultBalance + '->' + newResultBalance]
        ]);

        setBal(savedData, equipId, newSourceBalance);
        setBal(savedData, costId, newCostBalance);
        setBal(savedData, resultId, newResultBalance);

        log.info('MERGE', 'OK ' + operations + 'op ' + equipId + '->' + resultId);

        try { processDailyTask(savedData, operations); }
        catch (e) { log.warn('MERGE', 'Daily task err: ' + (e.message || e)); }

        try { processMainTask(savedData, operations); }
        catch (e) { log.warn('MERGE', 'Main task err: ' + (e.message || e)); }

        try { bug2Fix(savedData); }
        catch (e) { log.warn('MERGE', 'BUG2 err: ' + (e.message || e)); }

        db._set(storageKey, savedData);

        // Response: echo request fields + _changItem._items (absolute balances)
        var changItems = {};
        changItems[String(equipId)] = { _id: equipId, _num: newSourceBalance };
        changItems[String(costId)]  = { _id: costId,  _num: newCostBalance };
        changItems[String(resultId)] = { _id: resultId, _num: newResultBalance };

        var response = {
            type: request.type,
            action: request.action,
            userId: request.userId,
            count: request.count,
            equipId: request.equipId,
            version: request.version,
            _changItem: {
                _items: changItems
            }
        };

        log.info('MERGE', 'Response sent');
        callback(response);
    }

    MainServer.registerHandler('equip', 'merge', handle);
    window.MainServer = MainServer;
})();