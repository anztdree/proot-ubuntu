/**
 * ═══════════════════════════════════════════════════════════
 *  HANDLER: hangup/nextChapter
 *  Super Warrior Z — Private Server
 * ═══════════════════════════════════════════════════════════
 *
 *  TUGAS: Meng-advance _curLess ke first lesson chapter berikutnya
 *  setelah player menyelesaikan semua lesson di chapter saat ini
 *  dan men-tap interlude (chapter transition screen) di ChapterMain.
 *
 *  CALL SITE (1 total, di client):
 *    ChapterMain L160049-160056 — clickInterludeGroup
 *    Dipanggil SAAT:
 *      1. Player menang last lesson chapter → checkBattleResult
 *      2. isCurrentChapterLastLesson() = true (lastSection == maxPassLesson)
 *      3. Dragon animation "xiayizhang" dimainkan
 *      4. Player tap explore area → openLessonSelect → ChapterMain
 *      5. Player tap chapter item → interlude muncul
 *      6. Player tap interlude → THIS handler dipanggil
 *
 *  REQUEST FORMAT:
 *    { type:'hangup', action:'nextChapter', userId, version:'1.0' }
 *    NOTE: Tidak ada chapterId atau lessonId — server tahu dari _curLess
 *
 *  RESPONSE FORMAT:
 *    {
 *        ret: 0,
 *        _curLess: <number>   // ID first lesson chapter berikutnya
 *    }
 *
 *  CLIENT CALLBACK (L160054-160055):
 *    function(e) {
 *        ts.destroyHomeSceneImageRes(),          // no-op
 *        OnHookSingleton.getInstance().lastSection = e._curLess,  // HANYA field yang dibaca
 *        UIWindowManager.runSceneHome(!0)        // isNewChapter=true
 *    }
 *
 *  SETELAH RESPONSE, CLIENT AKAN:
 *    1. lastSection = _curLess (first lesson chapter baru)
 *    2. runSceneHome(true) → isNewChapter=true
 *    3. newAdventure() → "new adventure" animation
 *    4. exploreDragonState():
 *       - isCurrentChapterLastLesson() → HARUS false!
 *       - Jika true → LOOP INFINITE (xiayizhang lagi)
 *       - Jika false + isNewChapter → "tansuozhong" exploring → auto-battle
 *
 *  KRITIS: _maxPassLesson TIDAK di-update oleh handler ini
 *  (client tidak membacanya dari response). Tapi server-side
 *  _maxPassLesson sudah < _curLess karena checkBattleResult
 *  men-set keduanya ke curLess, lalu nextChapter mengubah
 *  _curLess saja.
 *
 *  FLOW LENGKAP:
 *    checkBattleResult (beat 10106, chapter 801→802):
 *      _curLess = 10106, _maxPassLesson = 10106 (stay on last lesson)
 *      _maxPassChapter = 802
 *    Client: lastSection=10106, maxPassLesson=10106
 *      isCurrentChapterLastLesson() → true → "xiayizhang" animation
 *    User tap → ChapterMain → interlude → nextChapter called
 *    nextChapter:
 *      _curLess = 10201 (first lesson of chapter 802)
 *    Client: lastSection=10201, maxPassLesson=10106
 *      isCurrentChapterLastLesson() → 10201==10106 → false ✅
 *      isNewChapter=true → "tansuozhong" exploring → auto-battle 10201
 *
 *  DEPENDENSI:
 *    - lesson.json: field nextID, nextChapter, thisChapter, previousID
 *    - checkBattleResult.js: harus set _curLess=curLess saat chapter change
 *      (bukan _curLess=nextId)
 *
 *  STORAGE:
 *    - savedData.hangup._curLess → di-update ke first lesson next chapter
 *    - savedData.hangup._maxPassChapter → di-update ke next chapter ID
 *
 * ================================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE LOADER
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
        } catch (e) {
            log.error('RESOURCE', 'Failed to load ' + name + '.json: ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Find first lesson of a chapter
    // ═══════════════════════════════════════════════════════════
    //
    //  Method: Cari lesson dengan thisChapter == targetChapter
    //  yang memiliki previousID di chapter BERBEDA (atau null/undefined).
    //  Ini menandakan lesson tersebut adalah first lesson chapter tersebut.
    //
    //  Fallback: Jika tidak ketemu, cari lesson dengan thisChapter == targetChapter
    //  dan ID terkecil.
    //
    //  Evidence:
    //    lesson.json pattern:
    //      "10106": { thisChapter:801, nextID:10201, nextChapter:802, previousID:10105 }
    //      "10201": { thisChapter:802, nextID:10202, nextChapter:802, previousID:10106 }
    //    First lesson of 802 (10201) punya previousID = 10106 (chapter 801)
    //

    /**
     * findFirstLessonOfChapter(lessonConfig, chapterId)
     * @param {object} lessonConfig — lesson.json object
     * @param {number} chapterId — target chapter ID
     * @returns {number|null} lesson ID or null if not found
     */
    function findFirstLessonOfChapter(lessonConfig, chapterId) {
        var targetChapter = Number(chapterId);
        var candidate = null;
        var candidateId = Infinity;

        for (var lessonId in lessonConfig) {
            if (!lessonConfig.hasOwnProperty(lessonId)) continue;
            var lesson = lessonConfig[lessonId];

            if (Number(lesson.thisChapter) !== targetChapter) continue;

            // Primary: previousID points to a DIFFERENT chapter (or missing)
            // This indicates it's the first lesson of this chapter
            var prevId = lesson.previousID ? Number(lesson.previousID) : null;
            var isBoundary = false;

            if (prevId === null || prevId === undefined) {
                // No previous lesson — must be first
                isBoundary = true;
            } else {
                // Check if previous lesson is in a different chapter
                var prevLesson = lessonConfig[String(prevId)];
                if (prevLesson && Number(prevLesson.thisChapter) !== targetChapter) {
                    isBoundary = true;
                }
            }

            if (isBoundary) {
                var id = Number(lessonId);
                if (id < candidateId) {
                    candidateId = id;
                    candidate = id;
                }
            }
        }

        // Fallback: if no boundary lesson found (shouldn't happen), pick smallest ID in chapter
        if (candidate === null) {
            for (var lessonId2 in lessonConfig) {
                if (!lessonConfig.hasOwnProperty(lessonId2)) continue;
                var lesson2 = lessonConfig[lessonId2];
                if (Number(lesson2.thisChapter) !== targetChapter) continue;
                var id2 = Number(lessonId2);
                if (id2 < candidateId) {
                    candidateId = id2;
                    candidate = id2;
                }
            }
        }

        return candidate;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hangup/nextChapter
    // ═══════════════════════════════════════════════════════════

    function handleNextChapter(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'hangup/nextChapter processing');
        log.details('request', [
            ['userId', userId || '-']
        ]);

        // ── STEP 1: Validate userId ──
        if (!userId) {
            log.warn('HANDLER', 'hangup/nextChapter — missing userId');
            callback(buildErrorResponse(request));
            return;
        }

        // ── STEP 2: Read user data ──
        var storageKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.warn('HANDLER', 'hangup/nextChapter — user data not found');
            callback(buildErrorResponse(request));
            return;
        }

        // ── STEP 3: Ensure hangup structure ──
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
        }

        // ── STEP 4: Read current lesson ──
        var curLess = savedData.hangup._curLess;
        log.details('current', [
            ['curLess', String(curLess)],
            ['maxPassLesson', String(savedData.hangup._maxPassLesson)],
            ['maxPassChapter', String(savedData.hangup._maxPassChapter)]
        ]);

        // ── STEP 5: Load lesson config ──
        var lessonConfig = loadJsonSync('lesson');
        if (!lessonConfig) {
            log.error('HANDLER', 'hangup/nextChapter — failed to load lesson.json');
            callback(buildErrorResponse(request));
            return;
        }

        var currentLesson = lessonConfig[String(curLess)];
        if (!currentLesson) {
            log.error('HANDLER', 'hangup/nextChapter — lesson not found: ' + curLess);
            callback(buildErrorResponse(request));
            return;
        }

        // ── STEP 6: Determine target chapter and first lesson ──
        //
        // _curLess saat ini seharusnya berada di LAST lesson chapter
        // (karena checkBattleResult men-set _curLess=curLess saat chapter change).
        //
        // lesson[_curLess].nextChapter = ID chapter berikutnya
        // lesson[_curLess].nextID = ID first lesson chapter berikutnya
        //
        // Method 1 (primary): Gunakan nextID langsung
        //   — Hanya valid jika _curLess = last lesson chapter (nextChapter != thisChapter)
        //
        // Method 2 (fallback): Jika _curLess sudah di chapter baru,
        //   cari first lesson of current chapter via findFirstLessonOfChapter()

        var targetChapterId = currentLesson.nextChapter ? Number(currentLesson.nextChapter) : null;
        var thisChapterId = Number(currentLesson.thisChapter);
        var firstLessonOfNextChapter = null;

        if (targetChapterId && targetChapterId !== thisChapterId) {
            // _curLess is on the LAST lesson of current chapter
            // nextChapter points to the NEXT chapter
            // nextID points to the FIRST lesson of the next chapter
            //
            // Evidence: lesson.json
            //   "10106": { thisChapter:801, nextChapter:802, nextID:10201 }
            firstLessonOfNextChapter = currentLesson.nextID ? Number(currentLesson.nextID) : null;

            log.details('method', [
                ['approach', 'DIRECT — using nextID from last lesson'],
                ['currentLesson', String(curLess)],
                ['thisChapter', String(thisChapterId)],
                ['nextChapter', String(targetChapterId)],
                ['nextID (first lesson)', String(firstLessonOfNextChapter)]
            ]);
        } else {
            // _curLess is ALREADY in the target chapter
            // (e.g., checkBattleResult already advanced _curLess to next chapter)
            // Find the first lesson of THIS chapter
            firstLessonOfNextChapter = findFirstLessonOfChapter(lessonConfig, thisChapterId);

            log.details('method', [
                ['approach', 'SEARCH — _curLess already in target chapter'],
                ['currentLesson', String(curLess)],
                ['thisChapter', String(thisChapterId)],
                ['found first lesson', String(firstLessonOfNextChapter)]
            ]);
        }

        if (!firstLessonOfNextChapter) {
            log.error('HANDLER', 'hangup/nextChapter — could not determine first lesson of next chapter');
            callback(buildErrorResponse(request));
            return;
        }

        // Validate: first lesson must exist in lesson config
        var targetLesson = lessonConfig[String(firstLessonOfNextChapter)];
        if (!targetLesson) {
            log.error('HANDLER', 'hangup/nextChapter — target lesson not found in config: ' + firstLessonOfNextChapter);
            callback(buildErrorResponse(request));
            return;
        }

        // ── STEP 7: Update server-side data ──
        savedData.hangup._curLess = firstLessonOfNextChapter;

        // Update _maxPassChapter to the new chapter
        // Client TIDAK membaca _maxPassChapter dari nextChapter response,
        // tapi perlu di-update server-side untuk:
        //   1. Persistence (next login, enterGame response)
        //   2. Chapter reward claiming (getChapterReward handler)
        var newChapterId = Number(targetLesson.thisChapter);
        if (newChapterId > (savedData.hangup._maxPassChapter || 0)) {
            savedData.hangup._maxPassChapter = newChapterId;
        }

        // _maxPassLesson TIDAK diubah — client tidak membacanya dari response ini
        // Nilai _maxPassLesson tetap = lesson terakhir yang dikalahkan (last lesson prev chapter)
        // Ini memastikan: setelah response, client side:
        //   lastSection (= _curLess) != maxPassLesson
        //   → isCurrentChapterLastLesson() = false
        //   → exploreDragonState masuk branch "exploring" (bukan "nextChapter" loop)

        // ── STEP 8: Persist ──
        db._set(storageKey, savedData);

        // ── STEP 9: Build response ──
        //
        // Client HANYA membaca e._curLess dari response ini.
        // Tapi kita echo request fields + tambahkan _curLess.
        //
        // Evidence: L160054-160055
        //   OnHookSingleton.getInstance().lastSection = e._curLess

        var response = {
            ret: 0,
            _curLess: firstLessonOfNextChapter
        };

        // Echo request fields (real server pattern)
        if (request.type) response.type = request.type;
        if (request.action) response.action = request.action;
        if (request.userId) response.userId = request.userId;
        if (request.version) response.version = request.version;

        log.info('HANDLER', 'hangup/nextChapter SUCCESS');
        log.details('response', [
            ['userId', userId],
            ['oldCurLess', String(curLess)],
            ['newCurLess', String(firstLessonOfNextChapter)],
            ['newChapter', String(newChapterId)],
            ['maxPassLesson', String(savedData.hangup._maxPassLesson)],
            ['maxPassChapter', String(savedData.hangup._maxPassChapter)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  RESPONSE BUILDER
    // ═══════════════════════════════════════════════════════════

    function buildErrorResponse(request) {
        var resp = { ret: 1 };
        if (request.type) resp.type = request.type;
        if (request.action) resp.action = request.action;
        if (request.userId) resp.userId = request.userId;
        return resp;
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hangup', 'nextChapter', handleNextChapter);

    window.MainServer = MainServer;
})();