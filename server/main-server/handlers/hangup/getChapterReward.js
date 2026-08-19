/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 *  HANDLER: hangup/getChapterReward
 *  Super Warrior Z — Private Server
 * ═══════════════════════════════════════════════════════════════════════════════════
 *
 *  TUGAS:
 *    Memberikan chapter completion reward (1x per chapter, saat chapter sudah cleared).
 *    Menandai chapter reward sebagai sudah di-claim.
 *    Memberikan 2 item reward sesuai chapter.json config.
 *
 *  CLIENT FLOW (ChapterMain.clickReceiveAward — L160057-160086):
 *  ═════════════════════════════════════════════════════════════════════════════════
 *
 *    IF maxPassChapter >= chapterId:
 *      IF haveGotChapterReward[chapterId] === true:
 *        → tampilkan tips "sudah diambil" (BarTypeTips, chapterMain/id4)
 *      ELSE:
 *        → REQUEST ke server
 *        → RESPONSE: _changeInfo._items (ABSOLUTE balances)
 *        → client: haveGotChapterReward[chapterId] = true  (LOCAL ONLY, L160070)
 *        → client: openCongratulationObtain(response)      (L160070)
 *        → client: changeSelectTabBar(curChapterType, false) (L160070)
 *
 *    ELSE (maxPassChapter < chapterId — chapter belum cleared):
 *      → BUKAN request ke server!
 *      → Client menampilkan preview reward dari chapter.json (local only)
 *      → ts.openWindow("ReceiveAwardPanel", { parent:"Pack", awardList: {...} })
 *
 *  ═════════════════════════════════════════════════════════════════════════════════
 *  REQUEST FORMAT (L160064-160068):
 *  ═════════════════════════════════════════════════════════════════════════════════
 *
 *    {
 *      type: "hangup",
 *      action: "getChapterReward",
 *      userId: <string>,
 *      chapterId: <number>    // chapter ID (801, 802, ... 874)
 *    }
 *
 *  ═════════════════════════════════════════════════════════════════════════════════
 *  RESPONSE FORMAT (dibaca oleh openCongratulationObtain — L56636):
 *  ═════════════════════════════════════════════════════════════════════════════════
 *
 *    {
 *      _changeInfo: {
 *        _items: {
 *          "<itemId1>": { _id: <itemId1>, _num: <ABSOLUTE balance> },
 *          "<itemId2>": { _id: <itemId2>, _num: <ABSOLUTE balance> }
 *
 *          Contoh: "2207": { _id: 2207, _num: 20 }, "101": { _id: 101, _num: 1200 }
 *        }
 *      }
 *    }
 *
 *    CRITICAL: _num = ABSOLUTE balance (SET), BUKAN delta.
 *    Client: UIWindowManager.openCongratulationObtain → openCommonItemGetTips
 *           → for-in _items → setItem(id, num)  [SET absolute balance]
 *           → delta = _num - oldLocalBalance  [popup shows delta only]
 *
 *  ═════════════════════════════════════════════════════════════════════════════════
 *  CHAPTER REWARD CONFIG (chapter.json):
 *  ═════════════════════════════════════════════════════════════════════════════════
 *
 *    Setiap chapter punya 2 reward:
 *      chapterReward1 = item ID pertama (contoh: 2207, 502, 151, 1301, ...)
 *      num1           = jumlah item pertama (contoh: 20, 1, 1, ...)
 *      chapterReward2 = item ID kedua   (contoh: 101 = Diamond)
 *      num2           = jumlah item kedua (contoh: 200)
 *
 *    Difficulty breakdown:
 *      difficulty=1: 9 chapters (801-809),  reward1 = equipment/fragment, reward2 = 200 diamond
 *      difficulty=2: 11 chapters (821-831), reward1 = 502, reward2 = 200 diamond
 *      difficulty=3: 13 chapters (841-853), reward1 = 502, reward2 = 200 diamond
 *      difficulty=4: 14 chapters (861-874), reward1 = 502, reward2 = 200 diamond
 *
 *  ═════════════════════════════════════════════════════════════════════════════════
 *  STORAGE:
 *  ═════════════════════════════════════════════════════════════════════════════════
 *
 *    savedData.hangup._maxPassChapter      = highest cleared chapter ID
 *    savedData.hangup._haveGotChapterReward = { "801": true, "802": true, ... }
 *    savedData.totalProps._items           = ARRAY [{_id, _num}, ...] (item balances)
 *
 *    Initial (enterGame L1042-1049):
 *      _haveGotChapterReward = {}
 *      _maxPassChapter = 801 (atau dari constant.startChapter)
 *
 *  ═════════════════════════════════════════════════════════════════════════════════
 *  VALIDATION (SERVER-SIDE):
 *  ═════════════════════════════════════════════════════════════════════════════════
 *
 *    1. chapterId valid di chapter.json?
 *    2. maxPassChapter >= chapterId? (sudah cleared)
 *    3. haveGotChapterReward[chapterId] belum true? (belum di-claim)
 *    4. Jika valid → berikan reward, tandai claimed
 *    5. Jika sudah di-claim → return error / return empty _changeInfo
 *
 *  ═════════════════════════════════════════════════════════════════════════════════
 *  IMPORTANT NOTES:
 *  ═════════════════════════════════════════════════════════════════════════════════
 *
 *    - Client juga melakukan local check: haveGotChapterReward[chapterId] === true
 *      → tampilkan tips "sudah diambil", TIDAK kirim request.
 *      Tapi server HARUS tetap validasi (anti-cheat).
 *
 *    - Client local set haveGotChapterReward[chapterId] = true SETELAH response sukses (L160070).
 *      Ini hanya di memory, tidak disimpan ke server.
 *      Server-lah yang menyimpan state permanen di savedData.hangup._haveGotChapterReward.
 *
 *    - Client TIDAK mengirim request jika maxPassChapter < chapterId (L160059).
 *      Tapi server HARUS tetap cek.
 *
 *    - Response format WAJIB punya _changeInfo._items agar openCongratulationObtain
 *      bisa menampilkan reward popup.
 *
 * ================================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.hangup) {
        MainServer.handlers.hangup = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  JSON LOADER
    // ═══════════════════════════════════════════════════════════

    var _cache = {};

    function loadJson(name) {
        if (_cache[name]) return _cache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _cache[name] = data;
                return data;
            }
            log.error('CHAPTER_REWARD', 'Failed to load ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('CHAPTER_REWARD', 'Failed to load ' + name + '.json — ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Get current item balance from savedData.totalProps._items
     * Format: ARRAY [{_id, _num}, ...]
     * @returns {number} current balance, 0 if not found
     */
    function getItemBalance(savedData, itemId) {
        if (!savedData || !savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                return Number(items[i]._num) || 0;
            }
        }
        return 0;
    }

    /**
     * Set item balance (absolute) in savedData.totalProps._items
     * If item not found, adds new entry.
     * @returns {number} new balance
     */
    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = { _items: [] };
        if (!savedData.totalProps._items) savedData.totalProps._items = [];

        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === itemId) {
                items[i]._num = newBalance;
                return newBalance;
            }
        }
        items.push({ _id: itemId, _num: newBalance });
        return newBalance;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetChapterReward(request, callback) {
        var userId = request.userId;
        var chapterId = request.chapterId;

        // ── VALIDATE INPUTS ──
        if (!userId || !chapterId) {
            log.warn('CHAPTER_REWARD', 'Missing params — userId=' + userId + ' chapterId=' + chapterId);
            callback({ _error: 'missing_params' }, 1);
            return;
        }

        var chapterKey = String(chapterId);

        // ── LOAD CONFIG ──
        var chapterConfig = loadJson('chapter');
        if (!chapterConfig || !chapterConfig[chapterKey]) {
            log.error('CHAPTER_REWARD', 'Invalid chapterId=' + chapterId + ' — not found in chapter.json');
            callback({ _error: 'invalid_chapter' }, 1);
            return;
        }

        var chapter = chapterConfig[chapterKey];
        var reward1Id = Number(chapter.chapterReward1);
        var reward1Num = Number(chapter.num1);
        var reward2Id = Number(chapter.chapterReward2);
        var reward2Num = Number(chapter.num2);

        // ── LOAD USER DATA ──
        var persistKey = 'user:' + userId;
        var savedData = db._get(persistKey);
        if (!savedData) {
            log.error('CHAPTER_REWARD', 'User not found — userId=' + userId);
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        if (!savedData.hangup) {
            log.error('CHAPTER_REWARD', 'hangup data not initialized for userId=' + userId);
            callback({ _error: 'hangup_not_init' }, 1);
            return;
        }

        var maxPassChapter = Number(savedData.hangup._maxPassChapter) || 801;
        var haveGotChapterReward = savedData.hangup._haveGotChapterReward || {};

        // ── VALIDATE: chapter already cleared? ──
        if (maxPassChapter < Number(chapterId)) {
            log.warn('CHAPTER_REWARD', 'Chapter not yet cleared — chapterId=' + chapterId + ' maxPassChapter=' + maxPassChapter);
            callback({ _error: 'chapter_not_cleared' }, 1);
            return;
        }

        // ── VALIDATE: reward not already claimed? ──
        if (haveGotChapterReward[chapterKey]) {
            log.warn('CHAPTER_REWARD', 'Reward already claimed — chapterId=' + chapterId);
            callback({ _error: 'already_claimed' }, 1);
            return;
        }

        // ── GIVE REWARDS ──
        // Add rewards to item balances
        var oldBalance1 = getItemBalance(savedData, reward1Id);
        var newBalance1 = oldBalance1 + reward1Num;
        setItemBalance(savedData, reward1Id, newBalance1);

        var oldBalance2 = getItemBalance(savedData, reward2Id);
        var newBalance2 = oldBalance2 + reward2Num;
        setItemBalance(savedData, reward2Id, newBalance2);

        // ── MARK AS CLAIMED ──
        haveGotChapterReward[chapterKey] = true;
        savedData.hangup._haveGotChapterReward = haveGotChapterReward;

        // ── PERSIST ──
        db._set(persistKey, savedData);

        // ── BUILD RESPONSE ──
        // _changeInfo._items = OBJECT format, key = string itemId, _num = ABSOLUTE balance
        var response = {
            _changeInfo: {
                _items: {}
            }
        };

        response._changeInfo._items[String(reward1Id)] = {
            _id: reward1Id,
            _num: newBalance1
        };
        response._changeInfo._items[String(reward2Id)] = {
            _id: reward2Id,
            _num: newBalance2
        };

        log.info('CHAPTER_REWARD', 'Claimed chapterId=' + chapterId
            + ' reward1=' + reward1Id + 'x' + reward1Num
            + ' reward2=' + reward2Id + 'x' + reward2Num
            + ' → bal1=' + newBalance1 + ' bal2=' + newBalance2);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hangup', 'getChapterReward', handleGetChapterReward);
    window.MainServer = MainServer;
})();