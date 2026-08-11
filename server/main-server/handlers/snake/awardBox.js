/**
 * handlers/snake/awardBox.js — Snake Dungeon Award Box Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: snake/awardBox
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Claim reward box di snake dungeon. User tap box reward → server
 *   validasi → kasih reward → update _gotRewardBox.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITE (L135803)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ts.processHandler({
 *       type: "snake", action: "awardBox",
 *       userId: <userId>,
 *       boxId: e,              // box ID (1-4)
 *       version: "1.0"
 *   }, function(e) {
 *       SnakeManager.getInstance().setRewardBoxGot(e);  // e._gotRewardBox
 *       ItemsCommonSingleton.getInstance().openCommonItemGetTips(e._changeInfo._items, [], n)
 *   })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L135809 + setRewardBoxGot L86476)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _changeInfo: {
 *           _items: { "<itemId>": { _id, _num } }   // ABSOLUTE balance
 *       },
 *       _gotRewardBox: [<number>, ...]   // array of ALL claimed box IDs
 *   })
 *
 *   Client setRewardBoxGot (L86476):
 *     if(e._gotRewardBox) → copy array to snakeData.gotRewardBox
 *
 *   Client openCommonItemGetTips:
 *     baca e._changeInfo._items (OBJECT keyed by string itemID)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONFIG: snakeChest.json
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   4 boxes:
 *     Box 1: lessonNeeded=4,  award=113 (SnakeCoin) × 40
 *     Box 2: lessonNeeded=6,  award=113 × 60
 *     Box 3: lessonNeeded=8,  award=113 × 80
 *     Box 4: lessonNeeded=10, award=113 × 120
 *
 * ═══════════════════════════════════════════════════════════════════════
 * VALIDATION (client L135803-135806)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Client cek sebelum call:
 *     - curLess > lessonNeeded || curLess == passLess → box visible
 *     - !gotRewardBox.contains(boxId) → box claimable
 *
 *   Server harus validasi:
 *     - boxId valid (1-4)
 *     - curLess > lessonNeeded (stage sudah dilewati)
 *     - boxId tidak ada di _gotRewardBox (belum di-claim)
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    function loadSnakeState(savedData) {
        if (!savedData.snake) {
            savedData.snake = {
                _id: '', _curLess: 1, _passLess: 0,
                _allTeam: {}, _gotRewardBox: []
            };
        }
        if (!savedData.snake._gotRewardBox) savedData.snake._gotRewardBox = [];
        return savedData.snake;
    }

    var _resourceCache = {};
    function loadJsonSync(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _resourceCache[name] = JSON.parse(xhr.responseText);
                return _resourceCache[name];
            }
        } catch (e) {}
        return null;
    }

    function getSnakeChestConfig() { return loadJsonSync('snakeChest'); }

    function getItemBalance(savedData, itemId) {
        if (!savedData.totalProps || !savedData.totalProps._items) return 0;
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) return Number(items[i]._num) || 0;
        }
        return 0;
    }

    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) { items[i]._num = newBalance; return; }
        }
        items.push({ _id: Number(itemId), _num: newBalance });
    }

    function handleAwardBox(request, callback) {
        var userId = request && request.userId;
        var boxId = Number(request && request.boxId);

        log.info('SNAKE', 'snake/awardBox START — userId=' + (userId || '-')
            + ', boxId=' + boxId);

        try {
            if (!userId) { callback({}, 1); return; }
            if (!boxId || boxId < 1 || boxId > 4) {
                log.warn('SNAKE', 'awardBox — invalid boxId: ' + boxId);
                callback({}, 1); return;
            }

            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) { callback({}, 1); return; }

            var snake = loadSnakeState(savedData);
            var curLess = snake._curLess || 1;
            var passLess = snake._passLess || 0;
            var gotRewardBox = snake._gotRewardBox || [];

            // Load chest config
            var chestConfig = getSnakeChestConfig();
            if (!chestConfig) { callback({}, 1); return; }

            var boxConfig = chestConfig[String(boxId)];
            if (!boxConfig) { callback({}, 1); return; }

            var lessonNeeded = Number(boxConfig.lessonNeeded) || 0;

            // Validate: stage already passed
            // Client L135803: r = a[e].lessonNeeded; if(r >= n && o != n) → openAwardTip (locked)
            // n = curLess, o = passLess
            // Box visible kalau: curLess > lessonNeeded || curLess == passLess
            // TAPI setelah sweep, curLess=1 passLess=0 → semua box terlihat locked
            // Fix: pakai passLess sebagai acuan — kalau passLess >= lessonNeeded → box claimable
            if (passLess < lessonNeeded) {
                log.warn('SNAKE', 'awardBox — stage not reached: passLess=' + passLess
                    + ' lessonNeeded=' + lessonNeeded);
                // Return ret=0 kosong (jangan munculkan "Unknown Error")
                callback({});
                return;
            }

            // Validate: not already claimed
            if (gotRewardBox.indexOf(boxId) !== -1) {
                log.warn('SNAKE', 'awardBox — box already claimed: ' + boxId);
                callback({}, 1); return;
            }

            // Give reward
            var rewardItemId = Number(boxConfig.award1) || 113;
            var rewardNum = Number(boxConfig.num1) || 10;

            var currentBalance = getItemBalance(savedData, rewardItemId);
            var newBalance = currentBalance + rewardNum;
            setItemBalance(savedData, rewardItemId, newBalance);

            // Update gotRewardBox
            gotRewardBox.push(boxId);
            snake._gotRewardBox = gotRewardBox;

            // Persist
            db._set(storageKey, savedData);

            // Build response
            var changeItems = {};
            changeItems[String(rewardItemId)] = { _id: rewardItemId, _num: newBalance };

            var response = {
                _changeInfo: { _items: changeItems },
                _gotRewardBox: gotRewardBox
            };

            log.info('SNAKE', 'awardBox SUCCESS — box=' + boxId
                + ', reward=' + rewardItemId + 'x' + rewardNum
                + ', balance=' + currentBalance + '→' + newBalance
                + ', gotRewardBox=[' + gotRewardBox.join(',') + ']');

            callback(response);

        } catch (err) {
            log.error('SNAKE', 'awardBox UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    MainServer.registerHandler('snake', 'awardBox', handleAwardBox);
})();
