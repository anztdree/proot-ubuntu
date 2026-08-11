/**
 * ═══════════════════════════════════════════════════════════════════
 *  HANDLER: hangup/gain  (v5 — FINAL, traced baris per baris dari main.min.js)
 *  Super Warrior Z — Private Server
 * ═══════════════════════════════════════════════════════════════════
 *
 *  ══════════════════════════════════════════════════════════════════
 *  CLIENT FLOW (gainTap — main.min.js baris ~6398557):
 *  ══════════════════════════════════════════════════════════════════
 *
 *  1. ts.processHandler({type:"hangup", action:"gain", userId, version:"1.0"})
 *
 *  2. RESPONSE = {
 *       _changeInfo: { _items: { "102": {_id:102, _num:<ABS>}, ... } },
 *       _lastGainTime: <OLD timestamp ms>,
 *       _exCount: <number>,
 *       _clickGlobalWarBuffTag: <string>
 *     }
 *
 *  3. var o = response._changeInfo._items;  // OBJECT, key=string ID
 *
 *  4. n = BattleCallBack.getBattleAwardItems(response, false)
 *     → Iterasi _changeInfo._items
 *     → Filter OUT: PLAYERLEVELID (104), PLAYEREXPERIENCEID (103)
 *     → Hitung delta: _num - getItemNum(_id)  (hanya jika delta > 0)
 *     → t=false → TIDAK panggil setItem (singleton TIDAK diupdate di sini)
 *     → Return: { "102": delta, "131": delta, ... }  (display items)
 *
 *  5. ts.openWindow("HomeGainTips", {
 *       items: n,                           // → GainList (4 guaranteed rewards)
 *       _lastGainTime: response._lastGainTime,
 *       exCount: response._exCount,         // → getRandItemNum() (display count)
 *       showGoodPlayer: <bool>
 *     })
 *
 *     HomeGainTipsViewData.initData:
 *       - GainList: dari params.items (delta dari getBattleAwardItems)
 *       - initRandomRewardList: dari lesson[id].idleRandomShow (UI ICONS saja!)
 *       - getActivityItem: dari ActivitySingleton (bonus UI icons)
 *
 *  6. HomeGainTips close callback →
 *     ItemsCommonSingleton.getInstance().openCommonItemGetTips(o, void 0, fn)
 *     → Iterasi _changeInfo._items
 *     → Untuk setiap item:
 *         - Lookup thingsID[T]
 *         - Jika ada: setItem(Number(v), t[v]._num) → UPDATE singleton balance
 *         - Jika thingsType != "jewelSpecial" dan delta > 0:
 *           push ke reward popup array
 *         - Filter: TIDAK tampilkan PLAYERLEVELID, PLAYEREXPERIENCEID,
 *           PLAYERVIPEXPERIENCEID, PLAYERVIPEXPALLID, PLAYERVIPLEVELID,
 *           PlayerHeadIcon
 *
 *  ══════════════════════════════════════════════════════════════════
 *  LESSON CONFIG (lesson.json per lesson stage):
 *  ══════════════════════════════════════════════════════════════════
 *
 *  idleReward1..4 = item ID untuk 4 slot guaranteed reward
 *    Contoh: 102(gold), 103(exp), 131(exp capsule), 132(evolve capsule)
 *  rewardNum1..4 = rate per DETIK (float)
 *    Contoh: 2.78, 0.33, 0.775, 0.0056
 *  idleRandomAward = table ID di lessonIdleAward.json
 *  idleRandomShow = comma-separated item IDs untuk UI icon display
 *
 *  ══════════════════════════════════════════════════════════════════
 *  RANDOM DROP TABLE (lessonIdleAward.json):
 *  ══════════════════════════════════════════════════════════════════
 *
 *  Array of entries per table, grouped by `group` field.
 *  Setiap group punya 2 entries: [itemEntry, emptyEntry]
 *  - itemEntry: { award: <itemId>, num: <qty>, random: <0-99999> }
 *  - emptyEntry: { award: "", random: <0-99999> }
 *  - Roll: Math.random()*100000 < item.random → DROP
 *
 *  Award ID types:
 *    < 1000  → Material items (134, 136, 137, 138, 150, dll)
 *    >= 1001 → Equipment POOL IDs → lookup lessonEquipAward.json
 *
 *  ITEM 150 (isIntermediary=1):
 *    - Mineral Crystal, thingsType=basis
 *    - random=0 di stage awal, random=1000 di stage lebih tinggi
 *    - Bisa drop dari idle jika random > 0 (stage-dependent)
 *
 *  EQUIPMENT POOL IDs (1001+):
 *    - Server HARUS resolve pool → actual equipID dari lessonEquipAward.json
 *    - Resolved equipment MASUK ke _changeInfo._items + DB balance
 *    - Client menerima equipment via getBattleAwardItems + openCommonItemGetTips
 *    - _exCount = total random drops (material + resolved equipment)
 *
 *  ══════════════════════════════════════════════════════════════════
 *  HEROES / HERO PIECES:
 *  ══════════════════════════════════════════════════════════════════
 *
 *  HEROES (thingsType type 15) dan HERO PIECES (type 16):
 *    - TIDAK ADA di lessonIdleAward.json → TIDAK bisa drop dari gain
 *    - TIDAK ADA di lessonEquipAward.json → TIDAK bisa drop dari equip pool
 *    - HANYA bisa didapat dari: summon, wish, exchange, activity reward
 *    - gain.js TIDAK PERNAH meng-generate hero/hero piece items
 *
 *  ══════════════════════════════════════════════════════════════════
 *  VIP & IDLE TIME (main.min.js HomeGainTipsViewData.GetTimeLeft2BySecond):
 *  ══════════════════════════════════════════════════════════════════
 *
 *  maxIdle = idleVipPlus[vipLevel].idleMaxTime || constant[1].idle (28800)
 *  effectiveTime = min(elapsed, maxIdle)
 *  multiplier = 1 + idleVipPlus[vipLevel].idleAwardPlus + globalWarBuff
 *
 *  Client menghitung _lastGainTime untuk display:
 *    timeLeft = min(serverTime - _lastGainTime, maxIdle)
 *
 *  Server HARUS mengirim _lastGainTime = NILAI LAMA (sebelum update)
 *  karena client menggunakannya untuk menghitung waktu offline.
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var TASK_STATE_DEFAULT  = 0;
    var TASK_STATE_DOING    = 1;
    var TASK_STATE_COMPLETE = 2;
    var PLAYERLEVELID = 104;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADER (cached synchronous XHR)
    // ═══════════════════════════════════════════════════════════

    var _resCache = {};

    function loadJson(name) {
        if (_resCache[name]) return _resCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resCache[name] = data;
                return data;
            }
            log.warn('GAIN', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('GAIN', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE — read/write totalProps._items (ARRAY format)
    //  ═══════════════════════════════════════════════════════════
    //
    //  Server storage: totalProps._items = [{_id, _num}, ...]
    //  Client reads:   setBackpack → for-in → setItem(id, num)

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
            if (Number(items[i]._id) === Number(id)) { items[i]._num = val; return; }
        }
        items.push({ _id: id, _num: val });
    }

    // ═══════════════════════════════════════════════════════════
    //  RANDOM DROP — lessonIdleAward.json grouped weighted roll
    // ═══════════════════════════════════════════════════════════
    //
    //  Struktur: Array of entries, grouped by `group` field.
    //  Setiap group punya [itemEntry, emptyEntry].
    //  itemEntry.random + emptyEntry.random = weight total group (TIDAK selalu 100000)
    //  Roll: random() * (itemR + emptyR) < itemR → item drops.
    //
    //  Dipanggil sekali per 300 detik (idleAwardEveryTime dari constant.json).
    //  Jadi numRolls = floor(effSec / 300).
    //  - Material: qty di-accumulate per hit (semakin lama = semakin banyak)
    //  - Equipment: chance di-accumulate per roll (semakin lama = peluang lebih tinggi)
    //
    //  Returns:
    //    matDrops: { itemId: qty } — all items (material + resolved equip)
    //    totalDrops: number — total unique drop events for _exCount

    var EQUIP_POOL_MIN = 1001;
    var IDLE_AWARD_EVERY = 300;  // constant.json idleAwardEveryTime

    function rollDrops(tableId, numRolls) {
        var matDrops = {}, totalDrops = 0;
        if (!tableId || numRolls <= 0) return { matDrops: matDrops, totalDrops: totalDrops };
        var tbl = loadJson('lessonIdleAward');
        if (!tbl) return { matDrops: matDrops, totalDrops: totalDrops };
        var arr = tbl[String(tableId)];
        if (!arr || !Array.isArray(arr)) return { matDrops: matDrops, totalDrops: totalDrops };

        // Group by `group` field
        var grp = {};
        for (var i = 0; i < arr.length; i++) {
            var g = arr[i].group;
            if (!grp[g]) grp[g] = [];
            grp[g].push(arr[i]);
        }

        // Roll N kali (1 per 300 detik)
        for (var roll = 0; roll < numRolls; roll++) {
            var gks = Object.keys(grp);
            for (var gi = 0; gi < gks.length; gi++) {
                var entries = grp[gks[gi]];

                // Cari item entry (award non-empty) dan empty entry
                var item = null, empty = null;
                for (var j = 0; j < entries.length; j++) {
                    if (entries[j].award && entries[j].award !== '') {
                        item = entries[j];
                    } else {
                        empty = entries[j];
                    }
                }
                if (!item) continue;

                var itemR = Number(item.random) || 0;
                var emptyR = empty ? (Number(empty.random) || 0) : 0;
                var totalR = itemR + emptyR;
                if (totalR <= 0 || itemR <= 0) continue;

                // Roll: random() * (itemR + emptyR) < itemR
                if (Math.random() * totalR < itemR) {
                    var aid = Number(item.award), qty = Number(item.num) || 1;

                    if (aid >= EQUIP_POOL_MIN) {
                        // Equipment pool — resolve to actual equipment via lessonEquipAward.json
                        var eqTbl = loadJson('lessonEquipAward');
                        var poolArr = eqTbl && eqTbl[String(aid)];
                        if (poolArr && poolArr.length > 0) {
                            var totalW = 0;
                            for (var ei = 0; ei < poolArr.length; ei++) {
                                totalW += Number(poolArr[ei].random) || 0;
                            }
                            if (totalW > 0) {
                                var eqRoll = Math.random() * totalW;
                                var cumW = 0;
                                var eqResolved = false;
                                for (var ei = 0; ei < poolArr.length; ei++) {
                                    cumW += Number(poolArr[ei].random) || 0;
                                    if (eqRoll < cumW) {
                                        var eqId = Number(poolArr[ei].equipID);
                                        matDrops[eqId] = (matDrops[eqId] || 0) + qty;
                                        totalDrops++;
                                        log.details('GAIN', [
                                            ['eqDrop', 'roll' + (roll + 1) + ' pool ' + aid + ' → equip ' + eqId + ' x' + qty]
                                        ]);
                                        eqResolved = true;
                                        break;
                                    }
                                }
                                if (!eqResolved) {
                                    totalDrops++;
                                    log.details('GAIN', [
                                        ['eqDropFail', 'roll' + (roll + 1) + ' pool ' + aid + ' boundary miss']
                                    ]);
                                }
                            } else {
                                totalDrops++;
                                log.details('GAIN', [
                                    ['eqPoolZero', 'roll' + (roll + 1) + ' pool ' + aid + ' totalWeight=0']
                                ]);
                            }
                        } else {
                            totalDrops++;
                            log.details('GAIN', [
                                ['eqPoolMiss', 'roll' + (roll + 1) + ' pool ' + aid + ' not found']
                            ]);
                        }
                    } else {
                        // Material item — accumulate qty
                        matDrops[aid] = (matDrops[aid] || 0) + qty;
                        totalDrops++;
                        log.details('GAIN', [
                            ['matDrop', 'roll' + (roll + 1) + ' ' + aid + ' x' + qty]
                        ]);
                    }
                }
            }
        }
        return { matDrops: matDrops, totalDrops: totalDrops };
    }

    // ═══════════════════════════════════════════════════════════
    //  TASK ADVANCEMENT — lessonIdleAward
    // ═══════════════════════════════════════════════════════════
    //
    //  1. Daily #6102 (taskType:"lessonIdleAward", taskPara1:3)
    //     → claim hangup reward 3 times per day
    //
    //  2. Main  #6031 (taskType:"lessonIdleAward", taskPara1:1, levelNeeded:26)
    //     → claim hangup reward 1 time (main quest)
    //
    //  Pattern: sama dengan equip/merge.js (processDailyTask + processMainTask)

    function processLessonIdleAwardDaily(sd) {
        var taskDailyCfg = loadJson('taskDaily');
        if (!taskDailyCfg) return;

        var matchedTask = null;
        var matchedTaskId = null;
        for (var tid in taskDailyCfg) {
            if (taskDailyCfg[tid].taskType === 'lessonIdleAward') {
                matchedTask = taskDailyCfg[tid];
                matchedTaskId = Number(tid);
                break;
            }
        }
        if (!matchedTask) return;

        if (!sd._dailyTaskProgress) sd._dailyTaskProgress = {};
        sd._dailyTaskProgress['lessonIdleAward'] =
            (sd._dailyTaskProgress['lessonIdleAward'] || 0) + 1;
        var curCount = sd._dailyTaskProgress['lessonIdleAward'];

        log.details('GAIN', [
            ['dailyTask', 'lessonIdleAward count=' + curCount]
        ]);

        var targetCount = Number(matchedTask.taskPara1) || 1;
        if (!sd._dailyTaskStates) sd._dailyTaskStates = {};
        var prevState = sd._dailyTaskStates[matchedTaskId];
        if (prevState === undefined || prevState === null) {
            var levelNeeded = Number(matchedTask.levelNeeded) || 1;
            var playerLevel = getBal(sd, PLAYERLEVELID) || 1;
            prevState = (playerLevel >= levelNeeded) ? TASK_STATE_DOING : TASK_STATE_DEFAULT;
            sd._dailyTaskStates[matchedTaskId] = prevState;
        }

        if (prevState === TASK_STATE_DOING && curCount >= targetCount) {
            sd._dailyTaskStates[matchedTaskId] = TASK_STATE_COMPLETE;
            log.info('GAIN', 'Daily task ' + matchedTaskId + ' DOING -> COMPLETE');
        }
    }

    function processLessonIdleAwardMain(sd) {
        var cmt = sd.curMainTask;
        if (!cmt || !Array.isArray(cmt) || cmt.length === 0 || cmt[0]._state !== TASK_STATE_DOING) {
            return;
        }

        var taskCfg = loadJson('task');
        if (!taskCfg) return;

        var taskDef = taskCfg[String(cmt[0]._id)];
        if (!taskDef || taskDef.taskType !== 'lessonIdleAward') return;

        // taskPara1=1, setiap gain call = 1 claim → langsung COMPLETE
        cmt[0]._state = TASK_STATE_COMPLETE;
        log.info('GAIN', 'Main task ' + cmt[0]._id + ' DOING -> COMPLETE');

        if (typeof MainServer.notify === 'function') {
            MainServer.notify({
                action: 'mainTaskChange',
                _curMainTask: [{ _id: cmt[0]._id, _state: TASK_STATE_COMPLETE }]
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hangup/gain
    // ═══════════════════════════════════════════════════════════

    function handleGain(request, callback) {
        var userId = request.userId;

        // ── 1. Validate ──
        if (!userId) {
            log.warn('GAIN', 'no userId');
            callback({}, 1);
            return;
        }

        // ── 2. Load savedData ──
        var key = 'ms_user_' + userId + '_1';
        var sd = db._get(key);
        if (!sd) {
            log.warn('GAIN', 'no savedData for userId=' + userId);
            callback({}, 1);
            return;
        }
        if (!sd.hangup) sd.hangup = {};

        // ── 3. Read _lastGainTime (OLD value — client uses for display) ──
        var lastT = sd.hangup._lastGainTime;
        var nowMs = Date.now();
        if (!lastT || typeof lastT !== 'number' || lastT <= 0) {
            lastT = nowMs;
        }
        var elapsedSec = Math.floor((nowMs - lastT) / 1000);

        log.details('GAIN', [
            ['userId', userId],
            ['lastGainTime', String(lastT)],
            ['now', String(nowMs)],
            ['elapsedSec', String(elapsedSec)]
        ]);

        // ── 4. VIP level → max idle time + multiplier ──
        //
        //  Client (HomeGainTipsViewData.GetTimeLeft2BySecond):
        //    maxIdle = idleVipPlus[vipLevel].idleMaxTime || constant[1].idle
        //  Client (HomeGainTips.setVipEfficiencyLab):
        //    vipPlus = idleVipPlus[vipLevel].idleAwardPlus
        var vip = getBal(sd, 106);
        var vipCfg = loadJson('idleVipPlus');
        var maxIdle = 28800;
        var vipPlus = 0;

        // idleVipPlus is 1-indexed: key = vipLevel+1 for vipLevel 0+
        var vipKey = String(vip + 1);
        if (vipCfg && vipCfg[vipKey]) {
            maxIdle = Number(vipCfg[vipKey].idleMaxTime) || 28800;
            vipPlus = Number(vipCfg[vipKey].idleAwardPlus) || 0;
        } else {
            var cc = loadJson('constant');
            if (cc && cc['1'] && cc['1'].idle) maxIdle = Number(cc['1'].idle) || 28800;
        }
        var effSec = Math.min(elapsedSec, maxIdle);

        // Global war buff (dari savedData.globalWarBuff)
        var warBuff = Number(sd.globalWarBuff) || 0;
        var mult = 1 + vipPlus + warBuff;

        log.details('GAIN', [
            ['vip', String(vip)],
            ['maxIdle', String(maxIdle)],
            ['vipPlus', String(vipPlus)],
            ['warBuff', String(warBuff)],
            ['mult', String(mult)],
            ['effSec', String(effSec)]
        ]);

        // ── 5. Current lesson → reward config ──
        var curLess = sd.hangup._curLess || 10101;
        var lessCfg = loadJson('lesson');
        if (!lessCfg) {
            log.error('GAIN', 'lesson.json not found');
            callback({}, 1);
            return;
        }
        var les = lessCfg[String(curLess)] || lessCfg['10101'];
        if (!les) {
            log.error('GAIN', 'lesson ' + curLess + ' not found');
            callback({}, 1);
            return;
        }

        // ── 6. Calculate 4 guaranteed idle reward slots ──
        //
        //  lesson.json: idleReward1..4 = item ID, rewardNum1..4 = rate per second
        //  Formula: gain = floor(rewardNum * effSec * mult)
        //  Result → _changeInfo._items (ABSOLUTE balance), totalProps._items (DB)
        //
        //  Contoh lesson 10101:
        //    idleReward1=102 (gold),     rewardNum1=2.78/sec
        //    idleReward2=103 (playerExp), rewardNum2=0.33/sec
        //    idleReward3=131 (expCapsule),rewardNum3=0.775/sec
        //    idleReward4=132 (evolveCaps),rewardNum4=0.0056/sec
        var ci = {};

        for (var s = 1; s <= 4; s++) {
            var rId = Number(les['idleReward' + s]);
            var rRate = Number(les['rewardNum' + s]);
            if (!rId || rId <= 0 || isNaN(rRate) || rRate <= 0) continue;

            var gain = Math.floor(rRate * effSec * mult);
            if (gain <= 0) continue;

            var oldBal = getBal(sd, rId);
            var newBal = oldBal + gain;
            setBal(sd, rId, newBal);

            // _changeInfo._items: OBJECT, key = string ID, value = {_id, _num: ABSOLUTE}
            ci[String(rId)] = { _id: rId, _num: newBal };

            log.details('GAIN', [
                ['slot', String(s)],
                ['item', String(rId)],
                ['rate', String(rRate)],
                ['gain', String(gain)],
                ['bal', oldBal + '→' + newBal]
            ]);
        }

        // ── 6b. Process PLAYER LEVEL from accumulated EXP ──
        //
        //  ═══ CRITICAL BUG FIX ═══
        //  Client does NOT compute level from EXP.
        //  Server MUST send item 104 (PLAYERLEVELID) in _changeInfo._items.
        //
        //  Evidence (main.min.js):
        //    setItem (L118397): n.items[e] = t — stores directly, no computation
        //    getUserLevel (L96314): getItemNum(PLAYERLEVELID) — reads stored value
        //    getNextLevelPrecene (L96321): currentExp / expNeeded[currentLevel]
        //    getBattleAddExp (L96350): sum(expNeeded[old..new-1]) + newExp - oldExp
        //
        //  Level-up model:
        //    userUpgrade[level].expNeeded = EXP cost to advance FROM this level
        //    EXP is "progress within current level" (NOT cumulative across levels)
        //    When totalExp >= expNeeded: level++, totalExp -= expNeeded
        //    Repeat until totalExp < expNeeded or level >= maxUserLevel
        //
        //  Contoh:
        //    Player level 1, exp 79, userUpgrade[1].expNeeded = 60
        //    → 79 >= 60 → level 2, exp = 79-60 = 19
        //    → 19 < 150 (userUpgrade[2].expNeeded) → stop

        var PLAYEREXPERIENCEID = 103;
        var curLevel = getBal(sd, PLAYERLEVELID) || 1;
        var totalExp = getBal(sd, PLAYEREXPERIENCEID) || 0;

        var upgradeTable = loadJson('userUpgrade');
        var constCfg = loadJson('constant');
        var maxUserLevel = 300;

        if (constCfg && constCfg['1'] && constCfg['1'].maxUserLevel) {
            maxUserLevel = Number(constCfg['1'].maxUserLevel) || 300;
        }

        if (upgradeTable && totalExp > 0 && curLevel < maxUserLevel) {
            var oldLevel = curLevel;

            while (curLevel < maxUserLevel) {
                var lvlEntry = upgradeTable[String(curLevel)];
                if (!lvlEntry) break;
                var needed = Number(lvlEntry.expNeeded) || 0;
                if (needed <= 0) break;
                if (totalExp < needed) break;
                totalExp -= needed;
                curLevel++;
            }

            if (curLevel > oldLevel) {
                // Level-up occurred — update DB balances
                setBal(sd, PLAYEREXPERIENCEID, totalExp);
                setBal(sd, PLAYERLEVELID, curLevel);

                // Overwrite _changeInfo._items with post-level-up values
                ci[String(PLAYEREXPERIENCEID)] = { _id: PLAYEREXPERIENCEID, _num: totalExp };
                ci[String(PLAYERLEVELID)] = { _id: PLAYERLEVELID, _num: curLevel };

                log.details('GAIN', [
                    ['levelUp', 'PLAYER ' + oldLevel + ' → ' + curLevel],
                    ['expRemaining', String(totalExp)]
                ]);
            }
        }

        // Always ensure item 104 (PLAYERLEVELID) is in response
        // Client setItem(104, num) stores it directly; needed for level display
        if (!ci[String(PLAYERLEVELID)]) {
            ci[String(PLAYERLEVELID)] = {
                _id: PLAYERLEVELID,
                _num: curLevel
            };
        }

        // ── 7. Random drops from lessonIdleAward table ──
        //
        //  Material items (< 1001) → _changeInfo._items + DB
        //  Equipment pools (>= 1001) → resolve via lessonEquipAward.json
        //    → resolved equipID → _changeInfo._items + DB (sama seperti material)
        //  HEROES and HERO PIECES: TIDAK ADA di lessonIdleAward.json,
        //    jadi TIDAK MUNGKIN muncul dari random drops.
        var exCount = 0;
        if (les.idleRandomAward && effSec > 0) {
            var numRolls = Math.floor(effSec / IDLE_AWARD_EVERY);
            var rr = rollDrops(String(les.idleRandomAward), numRolls);

            log.details('GAIN', [
                ['randomTable', String(les.idleRandomAward)],
                ['numRolls', String(numRolls) + ' (effSec=' + effSec + ' / ' + IDLE_AWARD_EVERY + ')']
            ]);

            // All drops (material + resolved equipment) → _changeInfo._items + DB balance
            var mks = Object.keys(rr.matDrops);
            for (var d = 0; d < mks.length; d++) {
                var dId = Number(mks[d]), dQty = rr.matDrops[mks[d]];
                var dOld = getBal(sd, dId), dNew = dOld + dQty;
                setBal(sd, dId, dNew);
                ci[String(dId)] = { _id: dId, _num: dNew };

                var dropTag = dId >= EQUIP_POOL_MIN ? 'eqDrop' : 'matDrop';
                log.details('GAIN', [
                    [dropTag, dId + ' x' + dQty + ' (' + dOld + '→' + dNew + ')']
                ]);
            }

            // Total random drop count (materials + resolved equipment)
            exCount = rr.totalDrops;

            log.details('GAIN', [
                ['randomTable', String(les.idleRandomAward)],
                ['totalDrops', String(mks.length) + ' items (material+equip)'],
                ['exCount', String(exCount)]
            ]);
        }

        // ── 8. Update _lastGainTime in DB to now ──
        sd.hangup._lastGainTime = nowMs;

        // ── BUG2 FIX: Re-check levelNeeded (DEFAULT→DOING) after level-up ──
        try {
            var cmt = sd.curMainTask;
            if (cmt && Array.isArray(cmt) && cmt.length > 0 && cmt[0]._state === 0) {
                var tcfg = loadJson('task');
                var tdef = tcfg && tcfg[cmt[0]._id];
                var ln = tdef ? (Number(tdef.levelNeeded) || 1) : 1;
                if (curLevel >= ln) {
                    cmt[0]._state = 1;
                    if (typeof MainServer.notify === 'function') {
                        MainServer.notify({
                            action: 'mainTaskChange',
                            _curMainTask: [{ _id: cmt[0]._id, _state: 1 }]
                        });
                        log.info('GAIN', 'BUG2 FIX: Task ' + cmt[0]._id + ' DEFAULT->DOING (level ' + curLevel + '>=' + ln + ')');
                    }
                }
            }
        } catch (b2e) {
            log.warn('GAIN', 'BUG2 check error: ' + (b2e.message || b2e));
        }

        // ── 8b. Task advancement: lessonIdleAward ──
        try { processLessonIdleAwardDaily(sd); }
        catch (e) { log.warn('GAIN', 'Daily task err: ' + (e.message || e)); }

        try { processLessonIdleAwardMain(sd); }
        catch (e) { log.warn('GAIN', 'Main task err: ' + (e.message || e)); }

        db._set(key, sd);

        // ── 9. Build response ──
        //
        //  _changeInfo._items: OBJECT keyed by string item ID
        //    Berisi: gold(102), playerExp(103), expCapsule(131),
        //            evolveCapsule(132), material random drops (134,136,137,138,150),
        //            dan resolved equipment dari pools (3001+)
        //    TIDAK berisi: equipment pool IDs (1001+), heroes, hero pieces
        //
        //  _lastGainTime: NILAI LAMA (sebelum update ke nowMs)
        //    Client menghitung: timeLeft = min(serverTime - _lastGainTime, maxIdle)
        //
        //  _exCount: jumlah total random drops (untuk display "got X items")
        var resp = {
            _changeInfo: { _items: ci },
            _lastGainTime: lastT,
            _exCount: exCount,
            _clickGlobalWarBuffTag: sd.hangup._clickGlobalWarBuffTag || ''
        };

        log.info('GAIN', 'OK userId=' + userId +
            ' items=' + Object.keys(ci).length +
            ' exCount=' + exCount +
            ' elapsed=' + elapsedSec + 's' +
            ' eff=' + effSec + 's' +
            ' mult=' + mult.toFixed(3) +
            ' vip=' + vip);

        callback(resp);
    }

    MainServer.registerHandler('hangup', 'gain', handleGain);
    window.MainServer = MainServer;
})();
