/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: hangup/checkBattleResult
 *  Super Warrior Z — Private Server
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  TUGAS: Menentukan hasil battle (WIN/LOSE), memberikan reward dari
 *  lesson.json, dan meng-advance lesson progression.
 *
 *  DUA MODE:
 *    GUIDE  — isGuide:true, selalu WIN, request minimal
 *    NORMAL — battle data lengkap, tentukan WIN/LOSE dari checkResult
 *
 *  CALL SITES (3 total, semua di client):
 *    1. Guide step 2107 (L104876) → saveGuideTeam → checkBattleResult(isGuide:true)
 *       - chaterID: 1, tutorialLesson[0] = 10101
 *    2. Guide step 2508 (L105815) → saveGuideTeam → checkBattleResult(isGuide:true)
 *       - chaterID: 2, tutorialLesson[1] = 10102
 *    3. Normal hangup (L97739)  → startGeneral → battle → checkBattleResult
 *       - battleId, super, checkResult, battleField, runaway
 *
 *  REQUEST FORMAT:
 *    GUIDE:  { type:'hangup', action:'checkBattleResult', userId, version:'1.0', isGuide:true }
 *    NORMAL: { type:'hangup', action:'checkBattleResult', userId, battleId, version:'1.0',
 *             super:[...], checkResult:[...], battleField:20, runaway:false }
 *
 *  RESPONSE FORMAT:
 *    {
 *        ret: 0,
 *        _battleResult: 0,                    // 0=WIN, 1=LOSE
 *        _changeInfo: {                       // HANYA jika WIN
 *            _items: {                        // OBJECT (bukan Array!)
 *                "102": { _id: 102, _num: <ABSOLUTE> },
 *                "103": { _id: 103, _num: <ABSOLUTE> },
 *                ...
 *            }
 *        },
 *        _curLess: <nextLessonID>,             // Lesson ID berikutnya
 *        _maxPassLesson: <currentLessonID>    // Lesson yang baru dikalahkan
 *    }
 *
 *  EVIDENCE:
 *    - resetTtemsCallBack (L118412-118419): for-in iterate _changeInfo._items (OBJECT)
 *    - getBattleAwardItems (L97686-97708):  for-in iterate _changeInfo._items (OBJECT)
 *    - Guide 2107 callback (L104881-104912): reads _battleResult, _changeInfo, _curLess, _maxPassLesson
 *    - Normal callback (L97749-97765):       reads _battleResult, _changeInfo, _curLess, _maxPassLesson, _maxPassChapter
 *    - checkBattleFinishInner (L76368):     WIN if enemy dead, LOSE if our team dead OR round >= TotalRound
 *    - BattleManager.runaway (L224262):      runaway flag → sent as parameter to battleEndFnc
 *
 *  ITEM IDs (L116237 + thingsID.json):
 *    101 = Diamond      (DIAMONDID)
 *    102 = Gold         (GOLDID)
 *    103 = Player EXP   (PLAYEREXPERIENCEID)
 *    104 = Player Level (PLAYERLEVELID)
 *    131 = EXP Capsule  (EXPERIENCECAPSULEID)
 *    132 = Evolve Capsule(EVOLVECAPSULEID)
 *    3001-3500 = Equipment items
 *
 *  LESSON REWARD FORMAT (lesson.json):
 *    award1..award5 = item ID
 *    num1..num5 = item quantity (ADDITIVE amount, bukan absolute)
 *    nextID = lesson ID berikutnya
 *    nextChapter = chapter ID berikutnya
 *
 *  LESSON PROGRESSION:
 *    Initial (enterGame): _curLess=10101, _maxPassLesson=0, _maxPassChapter=801
 *    After WIN (normal):   _curLess = lesson.nextID, _maxPassLesson = current lesson ID
 *    After WIN (chapter change): _curLess = curLess (STAY), _maxPassLesson = curLess
 *      → isCurrentChapterLastLesson() = true → client buka ChapterMain → interlude
 *      → player tap interlude → hangup/nextChapter advance _curLess ke first lesson next chapter
 *    After LOSE: tetap (tidak advance)
 *
 *  WIN/LOSE DETERMINATION (NORMAL mode):
 *    Client battle engine sudah menentukan WIN/LOSE via battleVictory (L76364).
 *    Server menerima checkResult = hero HP map dari client.
 *    Heuristic: semua hero HP=0 → LOSE, runaway=true → LOSE, else → WIN.
 *
 *  STORAGE:
 *    - savedData.hangup._curLess, _maxPassLesson, _maxPassChapter
 *    - savedData.totalProps._items (ARRAY) → balance untuk setiap item
 *
 * ================================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADER (same pattern as enterGame.js)
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    /**
     * loadJsonSync(name) — Load JSON config, cached.
     * @param {string} name — filename TANPA .json extension
     * @returns {object|null}
     */
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
        } catch (e) {
            log.error('RESOURCE', 'Failed to load ' + name + '.json: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM ID CONSTANTS (L116237)
    // ═══════════════════════════════════════════════════════════

    var ITEM_IDS = {
        DIAMONDID: 101,
        GOLDID: 102,
        PLAYEREXPERIENCEID: 103,
        PLAYERLEVELID: 104,
        EXPERIENCECAPSULEID: 131,
        EVOLVECAPSULEID: 132,
        EQUIPMINID: 3001,
        EQUIPMAXID: 3500
    };

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Read item balance from totalProps._items
    // ═══════════════════════════════════════════════════════════
    //
    //  Server storage format: totalProps._items = [{_id, _num}, ...] (ARRAY)
    //  Client reads via setBackpack (L114912): iterasi, setItem(id, num)
    //  Client reads via getItemNum (L118404): items[id] || 0
    //

    /**
     * getItemBalance(savedData, itemId) — Read current item balance.
     * @param {object} savedData — user data from db
     * @param {number} itemId — item ID (101, 102, 103, etc.)
     * @returns {number} current balance (0 if not found)
     */
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

    /**
     * setItemBalance(savedData, itemId, newBalance) — Update item balance.
     * @param {object} savedData — user data from db (MUTATED)
     * @param {number} itemId — item ID
     * @param {number} newBalance — new ABSOLUTE balance
     */
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
    //  HELPER: Compute level-up from EXP (Bug1 fix)
    // ═══════════════════════════════════════════════════════════

    function computeLevelUp(savedData) {
        var curLevel = getItemBalance(savedData, ITEM_IDS.PLAYERLEVELID) || 1;
        var totalExp = getItemBalance(savedData, ITEM_IDS.PLAYEREXPERIENCEID) || 0;
        var upgradeTable = loadJsonSync('userUpgrade');
        var constCfg = loadJsonSync('constant');
        var maxLevel = 300;
        if (constCfg && constCfg['1'] && constCfg['1'].maxUserLevel) {
            maxLevel = Number(constCfg['1'].maxUserLevel) || 300;
        }
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
                setItemBalance(savedData, ITEM_IDS.PLAYEREXPERIENCEID, totalExp);
                setItemBalance(savedData, ITEM_IDS.PLAYERLEVELID, curLevel);
                log.info('LEVELUP', 'PLAYER ' + oldLevel + ' -> ' + curLevel + ' (expRemaining=' + totalExp + ')');
            }
        }
        return curLevel;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Build _changeInfo._items from lesson rewards
    // ═══════════════════════════════════════════════════════════
    //
    //  lesson.json format (per lesson):
    //    award1: 103, num1: 20    → item 103 +20 units
    //    award2: 102, num2: 1000  → item 102 +1000 units
    //    ...
    //    award5: 101, num5: 20    → item 101 +20 units
    //
    //  Response _changeInfo._items format: OBJECT (NOT Array!)
    //  Keys = string item ID, Values = {_id, _num} with ABSOLUTE balance.
    //
    //  Evidence:
    //    resetTtemsCallBack (L118412): for (var o in n) → iterate OBJECT
    //    getBattleAwardItems (L97686): for (var u in n) → iterate OBJECT
    //

    /**
     * buildRewardItems(savedData, lesson) — Compute rewards and update totalProps.
     *
     * For each award slot (1-5) in lesson config:
     *   1. Read current balance from totalProps._items
     *   2. Add reward amount (num) to current balance
     *   3. Update totalProps._items with new ABSOLUTE balance
     *   4. Add to _changeInfo._items OBJECT
     *
     * @param {object} savedData — user data (MUTATED)
     * @param {object} lesson — lesson config from lesson.json
     * @returns {object} _changeInfo._items as OBJECT
     */
    function buildRewardItems(savedData, lesson) {
        var changeItems = {};

        for (var slot = 1; slot <= 5; slot++) {
            var awardId = lesson['award' + slot];
            var awardNum = lesson['num' + slot];

            // Skip empty slots (some lessons may not have all 5 awards)
            if (awardId === undefined || awardId === null || awardNum === undefined || awardNum === null) {
                continue;
            }

            awardId = Number(awardId);
            awardNum = Number(awardNum);

            // Skip zero-amount awards
            if (awardNum <= 0) continue;

            // Compute new ABSOLUTE balance
            var currentBalance = getItemBalance(savedData, awardId);
            var newBalance = currentBalance + awardNum;

            // Update server storage (totalProps._items)
            setItemBalance(savedData, awardId, newBalance);

            // Add to response _changeInfo._items (OBJECT, key = string ID)
            changeItems[String(awardId)] = {
                _id: awardId,
                _num: newBalance
            };

            log.details('reward', [
                ['item', String(awardId)],
                ['itemName', resolveItemName(awardId)],
                ['currentBalance', String(currentBalance)],
                ['rewardAmount', String(awardNum)],
                ['newBalance', String(newBalance)]
            ]);
        }

        return changeItems;
    }

    /**
     * resolveItemName(itemId) — Debug helper for item names.
     */
    function resolveItemName(itemId) {
        var names = {};
        names[ITEM_IDS.DIAMONDID] = 'Diamond';
        names[ITEM_IDS.GOLDID] = 'Gold';
        names[ITEM_IDS.PLAYEREXPERIENCEID] = 'PlayerEXP';
        names[ITEM_IDS.PLAYERLEVELID] = 'PlayerLevel';
        names[ITEM_IDS.EXPERIENCECAPSULEID] = 'EXPCapsule';
        names[ITEM_IDS.EVOLVECAPSULEID] = 'EvolveCapsule';
        return names[itemId] || ('Item_' + itemId);
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Initialize hangup data structure
    // ═══════════════════════════════════════════════════════════
    //
    //  Default values from enterGame.js (L114886-114899):
    //    _curLess: 10101
    //    _maxPassLesson: 10101
    //    _haveGotChapterReward: {}
    //    _maxPassChapter: 801
    //    _clickGlobalWarBuffTag: ''
    //    _buyFund: false
    //    _haveGotFundReward: {}

    function ensureHangupStructure(savedData) {
        if (!savedData.hangup) {
            savedData.hangup = {
                _curLess: 10101,
                _maxPassLesson: 0,
                _haveGotChapterReward: {},
                _maxPassChapter: 801,
                _clickGlobalWarBuffTag: '',
                _buyFund: false,
                _haveGotFundReward: {}
            };
            log.details('init', ['hangup', 'Initialized default hangup structure']);
            return;
        }

        // Ensure individual fields exist (defensive)
        // NOTE: Gunakan == null (bukan !val) karena 0 adalah value valid untuk _maxPassLesson
        if (savedData.hangup._curLess == null) savedData.hangup._curLess = 10101;
        if (savedData.hangup._maxPassLesson == null) savedData.hangup._maxPassLesson = 0;
        if (savedData.hangup._maxPassChapter == null) savedData.hangup._maxPassChapter = 801;
        if (!savedData.hangup._haveGotChapterReward) savedData.hangup._haveGotChapterReward = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hangup/checkBattleResult
    // ═══════════════════════════════════════════════════════════

    /**
     * handleCheckBattleResult(request, callback)
     *
     * Menentukan hasil battle, memberikan reward, dan meng-advance lesson.
     *
     * GUIDE MODE (isGuide:true):
     *   1. Selalu WIN (_battleResult=0)
     *   2. Baca lesson config dari _curLess
     *   3. Berikan rewards (award1-num1 s/d award5-num5)
     *   4. Advance _curLess ke nextID
     *   5. Update _maxPassLesson = lesson yang dikalahkan
     *   6. Response: _battleResult, _changeInfo._items, _curLess, _maxPassLesson
     *
     * NORMAL MODE:
     *   1. Tentukan WIN/LOSE dari checkResult:
     *      - runaway=true → LOSE
     *      - semua hero HP=0 → LOSE
     *      - else → WIN
     *   2. Jika WIN: sama seperti guide + update _maxPassChapter
     *   3. Jika LOSE: _battleResult=1, TANPA _changeInfo, TANPA advancement
     *
     * @param {object} request
     * @param {function} callback
     */
    function handleCheckBattleResult(request, callback) {
        var userId = request.userId;
        var isGuide = request.isGuide === true;

        log.info('HANDLER', 'hangup/checkBattleResult processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['mode', isGuide ? 'GUIDE' : 'NORMAL'],
            ['isGuide', String(isGuide)],
            ['battleId', request.battleId || '-'],
            ['runaway', String(request.runaway || false)],
            ['checkResult', request.checkResult ? JSON.stringify(request.checkResult).substring(0, 200) : '-'],
            ['super', request.super ? JSON.stringify(request.super).substring(0, 200) : '-']
        ]);

        // ── STEP 1: Validate userId ──
        if (!userId) {
            log.warn('HANDLER', 'hangup/checkBattleResult — missing userId');
            callback(buildErrorResponse(request));
            return;
        }

        // ── STEP 2: Read user data from persistent storage ──
        var storageKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.warn('HANDLER', 'hangup/checkBattleResult — user data not found in DB');
            log.details('note', [
                ['reason', 'enterGame may not have completed yet'],
                ['action', 'Returning error — cannot process battle result without user data']
            ]);
            callback(buildErrorResponse(request));
            return;
        }

        // ── STEP 3: Ensure hangup structure exists ──
        ensureHangupStructure(savedData);

        // ── STEP 4: Read current lesson ID ──
        var curLess = savedData.hangup._curLess;

        log.details('lesson', [
            ['curLess', String(curLess)],
            ['maxPassLesson', String(savedData.hangup._maxPassLesson)],
            ['maxPassChapter', String(savedData.hangup._maxPassChapter)]
        ]);

        // ── STEP 5: Load lesson config from lesson.json ──
        var lessonConfig = loadJsonSync('lesson');
        if (!lessonConfig) {
            log.error('HANDLER', 'hangup/checkBattleResult — failed to load lesson.json');
            callback(buildErrorResponse(request));
            return;
        }

        var lesson = lessonConfig[String(curLess)];
        if (!lesson) {
            log.error('HANDLER', 'hangup/checkBattleResult — lesson not found in config: ' + curLess);
            log.details('note', [
                ['reason', 'curLess value is invalid or lesson has been removed from config'],
                ['fallback', 'Returning error — cannot compute rewards']
            ]);
            callback(buildErrorResponse(request));
            return;
        }

        log.details('lessonConfig', [
            ['lessonId', String(lesson.id)],
            ['lessonName', String(lesson.lessonName)],
            ['thisChapter', String(lesson.thisChapter)],
            ['nextID', String(lesson.nextID)],
            ['nextChapter', String(lesson.nextChapter)]
        ]);

        // ── STEP 6: Determine WIN / LOSE ──
        //
        // GUIDE mode:
        //   - Client L104880: isGuide:true → selalu WIN
        //   - Battle TIDAK berjalan di client (skip battle animation)
        //   - Response HARUS _battleResult=0
        //
        // NORMAL mode:
        //   - Client battle engine menentukan WIN/LOSE via battleVictory (L76364)
        //   - checkBattleFinishInner (L76368):
        //     * Boss HP ≤ 0 → victoryFinish (WIN)
        //     * Enemy team all dead → victoryFinish (WIN)
        //     * Our team all dead → failedFinish (LOSE)
        //     * Round ≥ TotalRound → failedFinish (LOSE)
        //   - checkResult = array of {hero: heroId, hp: remainingHp} (L162910-162917)
        //   - runaway = BattleManager.getInstance().runaway (L224262)
        //
        //   Server heuristic:
        //     1. runaway=true → LOSE (player surrendered)
        //     2. ALL heroes hp=0 → LOSE (team wiped)
        //     3. Otherwise → WIN (enemy defeated)

        var battleResult = 0; // 0 = WIN
        var isWin = true;

        if (isGuide) {
            battleResult = 0;
            isWin = true;
            log.details('result', ['mode', 'GUIDE — always WIN']);
        } else {
            var runaway = request.runaway === true;
            var checkResult = request.checkResult;

            if (runaway) {
                isWin = false;
                battleResult = 1;
                log.details('result', ['mode', 'NORMAL — LOSE (player ran away)']);
            } else if (checkResult && Array.isArray(checkResult) && checkResult.length > 0) {
                // Check if ALL heroes are dead (hp = 0 or missing)
                var allDead = true;
                for (var i = 0; i < checkResult.length; i++) {
                    var heroHp = checkResult[i].hp;
                    if (heroHp > 0) {
                        allDead = false;
                        break;
                    }
                }

                if (allDead) {
                    isWin = false;
                    battleResult = 1;
                    log.details('result', ['mode', 'NORMAL — LOSE (all heroes dead)']);
                } else {
                    isWin = true;
                    battleResult = 0;
                    log.details('result', ['mode', 'NORMAL — WIN (enemy defeated)']);
                }
            } else {
                // No checkResult data — default to WIN
                isWin = true;
                battleResult = 0;
                log.warn('HANDLER', 'hangup/checkBattleResult — no checkResult, defaulting to WIN');
            }

            log.details('battleData', [
                ['checkResultLength', String(checkResult ? checkResult.length : 0)],
                ['runaway', String(runaway)]
            ]);
        }

        // ── STEP 7: Build response ──

        var response = buildResponse(request, battleResult);

        if (isWin) {
            // ── STEP 7a: WIN — compute rewards from lesson.json ──
            //
            // lesson.json structure per lesson:
            //   award1: 103, num1: 20       → Player EXP +20
            //   award2: 102, num2: 1000     → Gold +1000
            //   award3: 3001, num3: 3       → Equipment 3001 ×3
            //   award4: 3002, num4: 3       → Equipment 3002 ×3
            //   award5: 101, num5: 20       → Diamond +20
            //
            // ALL items (basis + equipment) go to:
            //   - _changeInfo._items (response) → OBJECT with ABSOLUTE balances
            //   - totalProps._items (storage)  → ARRAY with ABSOLUTE balances
            //
            // Evidence:
            //   setBackpack (L114912): reads totalProps._items → setItem(id, num)
            //   resetTtemsCallBack (L118412): for-in _changeInfo._items → setItem(id, num)
            //   getBestEquipWithPos (L131076): finds equipment from ItemsCommonSingleton.items
            //     which is populated from totalProps._items on login

            var changeItems = buildRewardItems(savedData, lesson);

            // ── Level-up processing ──
            // computeLevelUp selalu jalan untuk savedData (persistence).
            // GUIDE mode: response kirim raw EXP (dari buildRewardItems) + level baru.
            //   Client guide (L69186, L70021): delta = serverAbs - clientCurrent → positif.
            // NORMAL mode: response kirim post-level-up EXP + level baru.
            //   Client normal (getBattleAddExp L62493): handle reduced EXP dengan benar.

            var newLevel = computeLevelUp(savedData);
            changeItems[String(ITEM_IDS.PLAYERLEVELID)] = { _id: ITEM_IDS.PLAYERLEVELID, _num: newLevel };

            if (!isGuide) {
                changeItems[String(ITEM_IDS.PLAYEREXPERIENCEID)] = { _id: ITEM_IDS.PLAYEREXPERIENCEID, _num: getItemBalance(savedData, ITEM_IDS.PLAYEREXPERIENCEID) };
            }

            response._changeInfo = {
                _items: changeItems
            };

            log.details('rewards', [
                ['itemsCount', String(Object.keys(changeItems).length)],
                ['itemsDetail', JSON.stringify(changeItems)]
            ]);

            // ── STEP 7b: Advance lesson progression ──
            //
            // Evidence:
            //   Guide callback (L104892): OnHookSingleton.lastSection = e._curLess
            //   Normal callback (L97751): OnHookSingleton.lastSection = t._curLess
            //
            // _curLess → the NEXT lesson to play (from lesson.nextID)
            // _maxPassLesson → the lesson we just beat (current)

            var nextId = lesson.nextID ? Number(lesson.nextID) : curLess;

            // Chapter change detection:
            //   lesson.json: last lesson of chapter punya nextChapter != thisChapter
            //   Contoh: 10106 { thisChapter:801, nextChapter:802, nextID:10201 }
            var isChapterChange = lesson.nextChapter && Number(lesson.nextChapter) !== Number(lesson.thisChapter);

            // _curLess: lesson yang AKAN dimainkan selanjutnya
            //   Normal (dalam chapter): = nextId → advance ke lesson berikutnya
            //   Chapter change: = curLess → STAY di last lesson!
            //     → lastSection == maxPassLesson → isCurrentChapterLastLesson() = true
            //     → client tampilkan "xiayizhang" animation → buka ChapterMain → interlude
            //     → player tap interlude → hangup/nextChapter handler yang advance _curLess
            //
            // WHY STAY: Jika _curLess = nextId saat chapter change, client akan
            //   langsung battle lesson next chapter TANPA menampilkan interlude/chapter transition.
            //   Dan nextChapter handler tidak bisa break loop karena client tidak membaca
            //   _maxPassLesson dari response nextChapter (L160054-160055 hanya baca e._curLess).
            //
            // Evidence:
            //   Client L59379: isCurrentChapterLastLesson() → _lastSection == _maxPassLesson
            //   Client L63462: lastSection = t._curLess, maxPassLesson = t._maxPassLesson
            //   Client L160055: nextChapter callback HANYA baca e._curLess
            savedData.hangup._curLess = isChapterChange ? curLess : nextId;

            // _maxPassLesson: SELALU = curLess (lesson yang baru dikalahkan)
            // Tidak perlu conditional — nilai ini konsisten untuk semua case.
            // Setelah nextChapter dipanggil: _curLess berubah, _maxPassLesson tetap
            // → isCurrentChapterLastLesson() = false → exploring dimulai
            savedData.hangup._maxPassLesson = curLess;

            response._curLess = isChapterChange ? curLess : nextId;
            response._maxPassLesson = curLess;

            // ── STEP 7c: Update _maxPassChapter (NORMAL mode ONLY) ──
            //
            // Guide mode callback (L104892) does NOT read _maxPassChapter.
            // Normal mode callback (L97751) DOES read _maxPassChapter.
            //
            // But we still update savedData for consistency.

            if (!isGuide) {
                var nextChapter = lesson.nextChapter ? Number(lesson.nextChapter) : (savedData.hangup._maxPassChapter || 801);
                savedData.hangup._maxPassChapter = nextChapter;
                response._maxPassChapter = nextChapter;

                log.details('progression', [
                    ['advancedFrom', String(curLess)],
                    ['curLessNow', String(savedData.hangup._curLess)],
                    ['maxPassLesson', String(curLess)],
                    ['chapterChangedTo', String(nextChapter)]
                ]);
            } else {
                // Guide mode: update savedData but DON'T include in response
                // (client ignores it for guide, but keep savedData consistent)
                var guideNextChapter = lesson.nextChapter ? Number(lesson.nextChapter) : (savedData.hangup._maxPassChapter || 801);
                savedData.hangup._maxPassChapter = guideNextChapter;

                log.details('progression', [
                    ['advancedFrom', String(curLess)],
                    ['curLessNow', String(savedData.hangup._curLess)],
                    ['maxPassLesson', String(curLess)],
                    ['guide', 'true — _maxPassChapter updated in storage only']
                ]);
            }
        } else {
            // ── STEP 7d: LOSE — no rewards, no advancement ──
            //
            // Normal mode callback (L97750-97751):
            //   n && (...) — entire reward block only executes if WIN
            //   So on LOSE, _changeInfo, _curLess, _maxPassLesson, _maxPassChapter
            //   are NOT read from response.
            //
            // For consistency, still include unchanged values in response.

            response._curLess = curLess;
            response._maxPassLesson = savedData.hangup._maxPassLesson || curLess;

            if (!isGuide) {
                response._maxPassChapter = savedData.hangup._maxPassChapter || 801;
            }

            // NO _changeInfo — client checks if (e._changeInfo) before processing

            log.details('result', ['LOSE', 'No rewards, no lesson advancement']);
        }

        // ── STEP 7e: Check & advance main task (lesson-type tasks) ──
        //
        // If the player just cleared a lesson that matches the current main task's
        // taskPara1, transition the task from DOING (1) → COMPLETE (2).
        //
        // Flow:
        //   1. Player clears lesson 10102 (stage 1-2)
        //   2. checkBattleResult advances _curLess to 10103
        //   3. THIS step: checks if task 6001 (taskType:"lesson", taskPara1:10102) matches
        //   4. If match → task state 1→2 (COMPLETE), push mainTaskChange
        //   5. Client receives push → shows green "claim" on task bar
        //   6. Player clicks claim → task/getReward handler → grants rewards → next task
        //
        // The `curLess` variable here is the lesson ID BEFORE advancement (the one just beaten).
        // Evidence:
        //   task.json 6001: { taskType:"lesson", taskPara1:10102 }
        //   L77080: "mainTaskChange" push → setMianTask(e._curMainTask)

        if (isWin) {
            try {
                var cmt = savedData.curMainTask;
                var canCheck = cmt && Array.isArray(cmt) && cmt.length > 0 && cmt[0]._state === 1;

                if (canCheck) {
                    var taskCfg = loadJsonSync('task');
                    var mainTaskDef = taskCfg && taskCfg[cmt[0]._id];

                    if (mainTaskDef && mainTaskDef.taskType === 'lesson') {
                        var requiredLesson = Number(mainTaskDef.taskPara1);
                        var passedLesson = Number(savedData.hangup._maxPassLesson) || 0;

                        // MATCH: beaten lesson == required, OR already passed (catch-up for stuck progress)
                        if (Number(curLess) === requiredLesson || passedLesson >= requiredLesson) {
                            cmt[0]._state = 2; // TASK_STATE.COMPLETE

                            log.info('TASK', 'Task ' + cmt[0]._id + ' DOING → COMPLETE (lesson cleared)');
                            log.details('taskMatch', [
                                ['taskId', String(cmt[0]._id)],
                                ['requiredLesson', String(requiredLesson)],
                                ['beatenLesson', String(curLess)],
                                ['maxPassLesson', String(passedLesson)]
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
                            log.info('TASK', 'No task match — beaten=' + curLess +
                                ' required=' + requiredLesson + ' maxPass=' + passedLesson);
                        }
                    }
                } else {
                    log.info('TASK', 'Skip check — curMainTask=' + JSON.stringify(cmt));
                }
            } catch (taskErr) {
                log.warn('TASK', 'Error: ' + (taskErr.message || taskErr));
            }

            // ── BUG2 FIX: Re-check levelNeeded (DEFAULT→DOING) ──
            try {
                var cmt2 = savedData.curMainTask;
                if (cmt2 && Array.isArray(cmt2) && cmt2.length > 0 && cmt2[0]._state === 0) {
                    var tc2 = loadJsonSync('task');
                    var def2 = tc2 && tc2[cmt2[0]._id];
                    var ln2 = def2 ? (Number(def2.levelNeeded) || 1) : 1;
                    var currentLevel = getItemBalance(savedData, ITEM_IDS.PLAYERLEVELID) || 1;
                    if (currentLevel >= ln2) {
                        cmt2[0]._state = 1;
                        if (typeof MainServer.notify === 'function') {
                            MainServer.notify({
                                action: 'mainTaskChange',
                                _curMainTask: [{ _id: cmt2[0]._id, _state: 1 }]
                            });
                            log.info('TASK', 'BUG2 FIX: Task ' + cmt2[0]._id + ' DEFAULT->DOING (level ' + currentLevel + '>=' + ln2 + ')');
                        }
                    }
                }
            } catch (bug2err) {
                log.warn('TASK', 'BUG2 check error: ' + (bug2err.message || bug2err));
            }
        }

        // ── STEP 8: Persist to database ──
        db._set(storageKey, savedData);

        log.info('HANDLER', 'hangup/checkBattleResult SUCCESS');
        log.details('finalResponse', [
            ['userId', userId],
            ['mode', isGuide ? 'GUIDE' : 'NORMAL'],
            ['_battleResult', String(battleResult)],
            ['_curLess', String(response._curLess)],
            ['_maxPassLesson', String(response._maxPassLesson)],
            ['_maxPassChapter', response._maxPassChapter ? String(response._maxPassChapter) : '(not included)'],
            ['hasChangeInfo', response._changeInfo ? 'YES' : 'NO (LOSE)'],
            ['storageKey', storageKey]
        ]);

        // ── STEP 9: Return response ──
        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  RESPONSE BUILDERS
    // ═══════════════════════════════════════════════════════════
    //
    //  Pattern dari real server (HAR evidence):
    //    1. Echo ALL request fields
    //    2. Add response-specific fields
    //
    //  Client membaca response fields secara langsung (L104882, L97750):
    //    e._battleResult, e._changeInfo, e._curLess, e._maxPassLesson
    //
    //  JADI: response harus punya semua field yang client baca,
    //  ditambah echo field dari request.

    /**
     * buildResponse(request, battleResult) — Build success response.
     *
     * @param {object} request — original request
     * @param {number} battleResult — 0=WIN, 1=LOSE
     * @returns {object}
     */
    function buildResponse(request, battleResult) {
        var resp = {
            ret: 0,
            _battleResult: battleResult
        };

        // Echo request fields
        if (request.type) resp.type = request.type;
        if (request.action) resp.action = request.action;
        if (request.userId) resp.userId = request.userId;
        if (request.version) resp.version = request.version;

        // Echo mode-specific fields
        if (request.isGuide) resp.isGuide = request.isGuide;
        if (request.battleId) resp.battleId = request.battleId;
        if (request.battleField) resp.battleField = request.battleField;
        if (request.runaway !== undefined) resp.runaway = request.runaway;

        return resp;
    }

    /**
     * buildErrorResponse(request) — Build error response.
     * Client error callback (L97763) → UIWindowManager.runSceneHome()
     * So errors should still allow game to continue.
     */
    function buildErrorResponse(request) {
        var resp = {
            ret: 1
        };

        if (request.type) resp.type = request.type;
        if (request.action) resp.action = request.action;
        if (request.userId) resp.userId = request.userId;
        if (request.version) resp.version = request.version;

        return resp;
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hangup', 'checkBattleResult', handleCheckBattleResult);

    window.MainServer = MainServer;
})();
