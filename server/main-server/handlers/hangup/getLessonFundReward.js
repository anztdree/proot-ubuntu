/**
 * handlers/hangup/getLessonFundReward.js
 * Super Warrior Z — Private Server
 *
 * ══════════════════════════════════════════════════════════════════
 * HANDLER: { type:"hangup", action:"getLessonFundReward", chapterId, userId, version:"1.0" }
 * ══════════════════════════════════════════════════════════════════
 *
 * Klaim reward Lesson Fund per chapter milestone.
 * Hanya bisa di-claim setelah buyLessonFund berhasil (_buyFund = true).
 *
 * ══════════════════════════════════════════════════════════════════
 * CLIENT FLOW (CommonPrivilegeRewardListItem.receiveBtnTap)
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. receiveBtnTap() → levelPrivilegeRequest(levelID)
 *
 * 2. ts.processHandler({
 *        type: "hangup",
 *        action: "getLessonFundReward",
 *        chapterId: levelID,        // 801, 802, ... 831
 *        userId: ...,
 *        version: "1.0"
 *    }, function(e) {
 *        UIWindowManager.openCongratulationObtain(e);
 *        // → baca e._changeInfo._items → tampilkan popup reward
 *        // → saveGainWithOutItems(e) → handle _addHeroes dll (kosong di sini)
 *
 *        TSEvent.getInstance().dispatch(refreshPrivilegeTasks, {
 *            itemId: levelID
 *        });
 *        // → refreshStateWithList(itemId)
 *        //   → haveGotReward = true, receivedImage show, receiveBtn hide
 *        //   → receiveFnc(levelID) → OnHookSingleton.setCurChapterPrivilegeState(levelID)
 *        //     → _haveGotFundReward[levelID] = true (client-side)
 *    })
 *
 * ══════════════════════════════════════════════════════════════════
 * CONFIG: LevelPrivilege.json
 * ══════════════════════════════════════════════════════════════════
 *
 * Key = id (801-809, 821-831), tiap entry:
 *   { id:801, levelID:801, award:101, num:2000 }
 *
 *   levelID = chapter ID → key ke chapter.json (nama chapter)
 *   award   = item ID yang diberikan (101 = diamond)
 *   num     = jumlah item
 *
 *   Total 19 milestone chapter.
 *   Semua memberikan diamond 2000 saat ini.
 *
 * ══════════════════════════════════════════════════════════════════
 * UI STATE (client-side, untuk referensi)
 * ══════════════════════════════════════════════════════════════════
 *
 * privilegeState (_buyFund):
 *   false → lockedImage visible, receiveBtn hidden
 *   true  → lockedImage hidden, receiveBtn visible (if canGetReward)
 *
 * canGetReward = (maxPassChapter >= levelID)
 *   false → receiveBtn disabled
 *   true  → receiveBtn enabled
 *
 * haveGotReward (_haveGotFundReward[levelID]):
 *   true → receiveBtn hidden, receivedImage visible
 *
 * ══════════════════════════════════════════════════════════════════
 * STATE (savedData.hangup)
 * ══════════════════════════════════════════════════════════════════
 *
 * _buyFund: boolean — harus true (sudah beli fund)
 * _haveGotFundReward: { "801": true, "802": true, ... } — sudah di-claim
 * _maxPassChapter: number — chapter tertinggi yang sudah di-clear
 *   → server WAJIB cek: _maxPassChapter >= chapterId
 *
 * ══════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ══════════════════════════════════════════════════════════════════
 * {
 *   _changeInfo: {
 *     _items: {
 *       "101": { _id: 101, _num: <ABSOLUTE balance diamond> }
 *     }
 *   }
 * }
 *
 * Client: UIWindowManager.openCongratulationObtain(response)
 *   → baca _changeInfo._items → popup "Got 2000 Diamond"
 *   → ItemsCommonSingleton setItem → update client cache
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
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
        } catch (e) {}
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  ITEM BALANCE — read/write totalProps._items (ARRAY format)
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
            if (Number(items[i]._id) === Number(id)) { items[i]._num = val; return; }
        }
        items.push({ _id: id, _num: val });
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hangup/getLessonFundReward
    // ═══════════════════════════════════════════════════════════

    function handleGetLessonFundReward(request, callback) {
        var userId = request.userId;
        var chapterId = request.chapterId;

        log.info('GETLFR', 'hangup/getLessonFundReward processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['chapterId', String(chapterId || '-')],
            ['version', request.version || '-']
        ]);

        try {
            // ── 1. Validate ──
            if (!userId) {
                log.warn('GETLFR', 'Missing userId');
                callback({}, 1);
                return;
            }
            if (!chapterId) {
                log.warn('GETLFR', 'Missing chapterId');
                callback({}, 1);
                return;
            }

            var chId = Number(chapterId);
            if (isNaN(chId) || chId <= 0) {
                log.warn('GETLFR', 'Invalid chapterId: ' + chapterId);
                callback({}, 1);
                return;
            }

            // ── 2. Load savedData ──
            var key = 'user:' + userId;
            var sd = db._get(key);

            if (!sd) {
                log.warn('GETLFR', 'User data not found: ' + key);
                callback({}, 1);
                return;
            }

            if (!sd.hangup) sd.hangup = {};

            // ── 3. Check fund purchased ──
            if (!sd.hangup._buyFund) {
                log.warn('GETLFR', 'Fund not purchased userId=' + userId);
                callback({}, 1);
                return;
            }

            // ── 4. Check not already claimed ──
            if (!sd.hangup._haveGotFundReward) sd.hangup._haveGotFundReward = {};
            if (sd.hangup._haveGotFundReward[String(chId)]) {
                log.warn('GETLFR', 'Already claimed chapterId=' + chId + ' userId=' + userId);
                callback({}, 1);
                return;
            }

            // ── 5. Check chapter reached (maxPassChapter >= chapterId) ──
            var maxPassChapter = Number(sd.hangup._maxPassChapter) || 0;
            if (maxPassChapter < chId) {
                log.warn('GETLFR', 'Chapter not reached: maxPass=' + maxPassChapter + ' < requested=' + chId);
                callback({}, 1);
                return;
            }

            // ── 6. Load reward config (LevelPrivilege.json) ──
            var privCfg = loadJson('LevelPrivilege');
            if (!privCfg) {
                log.error('GETLFR', 'LevelPrivilege.json not found');
                callback({}, 1);
                return;
            }

            var reward = privCfg[String(chId)];
            if (!reward) {
                log.warn('GETLFR', 'No reward config for chapterId=' + chId);
                callback({}, 1);
                return;
            }

            // ── 7. Grant reward ──
            var awardId = Number(reward.award);
            var awardNum = Number(reward.num) || 1;

            var oldBal = getBal(sd, awardId);
            var newBal = oldBal + awardNum;
            setBal(sd, awardId, newBal);

            log.details('GETLFR', [
                ['award', String(awardId)],
                ['num', String(awardNum)],
                ['bal', oldBal + ' → ' + newBal]
            ]);

            // ── 8. Mark as claimed ──
            sd.hangup._haveGotFundReward[String(chId)] = true;

            // ── 9. Persist ──
            db._set(key, sd);

            log.info('GETLFR', 'OK userId=' + userId +
                ' chapterId=' + chId +
                ' award=' + awardId +
                ' num=' + awardNum +
                ' bal=' + oldBal + '→' + newBal);

            // ── 10. Build response ──
            //    openCongratulationObtain(response):
            //      → baca _changeInfo._items → popup reward
            //      → setItem(id, num) → update client cache
            //      → dispatch refreshPrivilegeTasks → update UI list
            var resp = {
                _changeInfo: {
                    _items: {}
                }
            };
            resp._changeInfo._items[String(awardId)] = {
                _id: awardId,
                _num: newBal
            };

            callback(resp);

        } catch (err) {
            log.error('GETLFR', 'UNCAUGHT ERROR', err);
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hangup', 'getLessonFundReward', handleGetLessonFundReward);

    window.MainServer = MainServer;
})();