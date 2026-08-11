/**
 * handlers/snake/sweep.js — Snake Dungeon Sweep Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: snake/sweep
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Sweep (quick clear) snake dungeon. User bayar diamond untuk auto-clear
 *   semua stage yang sudah di-pass, dapat semua reward + box dalam 1 klik.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITE (L135832)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   // Client cek: ada box unclaimed? (e.hasbox)
 *   // Client cek: VIP level >= snakeWipe[vipNeeded]
 *   // Client cek: diamond >= snakeWipe[snakeSweepCount+1].snakeWipePrice
 *
 *   ts.processHandler({
 *       type: "snake", action: "sweep",
 *       userId: <userId>,
 *       version: "1.0"
 *   }, function(t) {
 *       AllRefreshCount.getInstance().snakeSweepCount++
 *       SnakeManager.getInstance().clearRewardBoxGot()    // clear local box state
 *       ItemsCommonSingleton.getInstance().openCommonItemGetTips(t._changeInfo._items, [], n)
 *   })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L135836)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _changeInfo: {
 *           _items: { "<itemId>": { _id, _num } }   // ABSOLUTE balance
 *       }
 *   })
 *
 *   Client openCommonItemGetTips: baca _changeInfo._items (OBJECT keyed by string itemID)
 *   Client clearRewardBoxGot: clear local gotRewardBox (server juga clear)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONFIG: snakeWipe.json
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   snakeSweepCount = AllRefreshCount.snakeSweepCount (0-based, client track)
 *   Index snakeWipe[snakeSweepCount + 1] → next sweep tier
 *
 *   Key 1: snakeWipePrice=200,  vipNeeded=7
 *   Key 2: snakeWipePrice=300,  vipNeeded=10
 *   Key 3: snakeWipePrice=400,  vipNeeded=13
 *   Key 4: snakeWipePrice=500,  vipNeeded=15
 *   Key 5: snakeWipePrice=600,  vipNeeded=16
 *
 *   snakeWipeCostID = 101 (diamond)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REWARD LOGIC
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Sweep = auto-clear semua stage yang sudah di-pass (1..passLess).
 *   Reward = sum dari semua snakeDungeon[1..passLess].award1 × num1
 *   + semua snakeChest box rewards (box 1..4 yang lessonNeeded <= passLess)
 *
 *   Setelah sweep:
 *     - _gotRewardBox = [] (clear all box claims)
 *     - _allTeam = {} (reset hero state — full HP untuk next run)
 *     - _curLess = 1 (restart from stage 1)
 *     - _passLess = 0 (nothing passed yet in new run)
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var ITEM_DIAMOND = 101;

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

    function getSnakeDungeonConfig() { return loadJsonSync('snakeDungeon'); }
    function getSnakeChestConfig() { return loadJsonSync('snakeChest'); }
    function getSnakeWipeConfig() { return loadJsonSync('snakeWipe'); }

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

    function handleSweep(request, callback) {
        var userId = request && request.userId;

        log.info('SNAKE', 'snake/sweep START — userId=' + (userId || '-'));

        try {
            if (!userId) { callback({}, 1); return; }

            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) { callback({}, 1); return; }

            var snake = loadSnakeState(savedData);
            var passLess = snake._passLess || 0;

            // Must have passed at least 1 stage
            if (passLess < 1) {
                log.warn('SNAKE', 'sweep — no stages passed yet (passLess=' + passLess + ')');
                callback({});
                return;
            }

            // Load configs
            var dungeonConfig = getSnakeDungeonConfig();
            var chestConfig = getSnakeChestConfig();
            if (!dungeonConfig || !chestConfig) { callback({}, 1); return; }

            // ── Calculate rewards ──
            // Sum all stage rewards (1..passLess)
            var rewards = {};  // itemId → total amount

            for (var s = 1; s <= passLess; s++) {
                var stage = dungeonConfig[String(s)];
                if (!stage) continue;
                var awardId = Number(stage.award1) || 113;
                var awardNum = Number(stage.num1) || 10;
                rewards[awardId] = (rewards[awardId] || 0) + awardNum;
            }

            // Add all chest box rewards (box.lessonNeeded <= passLess)
            for (var b in chestConfig) {
                if (!chestConfig.hasOwnProperty(b)) continue;
                var box = chestConfig[b];
                var lessonNeeded = Number(box.lessonNeeded) || 0;
                if (lessonNeeded <= passLess) {
                    var boxAwardId = Number(box.award1) || 113;
                    var boxAwardNum = Number(box.num1) || 0;
                    rewards[boxAwardId] = (rewards[boxAwardId] || 0) + boxAwardNum;
                }
            }

            // ── Deduct diamond cost ──
            // Client track snakeSweepCount, send to server via implicit state
            // For trial: cost = 200 diamond (snakeWipe[1].snakeWipePrice)
            var wipeConfig = getSnakeWipeConfig();
            var wipePrice = 200;  // default
            if (wipeConfig) {
                var wipeEntry = wipeConfig['1'];
                if (wipeEntry) wipePrice = Number(wipeEntry.snakeWipePrice) || 200;
            }

            var diamondBalance = getItemBalance(savedData, ITEM_DIAMOND);
            if (diamondBalance < wipePrice) {
                log.warn('SNAKE', 'sweep — not enough diamonds: have=' + diamondBalance + ' need=' + wipePrice);
                callback({});
                return;
            }

            var newDiamondBalance = diamondBalance - wipePrice;
            setItemBalance(savedData, ITEM_DIAMOND, newDiamondBalance);

            // ── Add rewards to inventory ──
            var changeItems = {};
            changeItems[String(ITEM_DIAMOND)] = { _id: ITEM_DIAMOND, _num: newDiamondBalance };

            for (var itemId in rewards) {
                if (!rewards.hasOwnProperty(itemId)) continue;
                var amount = rewards[itemId];
                var currentBal = getItemBalance(savedData, Number(itemId));
                var newBal = currentBal + amount;
                setItemBalance(savedData, Number(itemId), newBal);
                changeItems[String(itemId)] = { _id: Number(itemId), _num: newBal };
            }

            // ── Reset snake state ──
            // After sweep: restart from stage 1, clear box claims, reset hero team
            // TAPI passLess TETAP — supaya box reward bisa di-claim setelah sweep
            // (box claimable kalau passLess >= lessonNeeded)
            snake._curLess = 1;
            // snake._passLess tetap (jangan reset ke 0)
            snake._allTeam = {};
            snake._gotRewardBox = [];

            // ── Persist ──
            db._set(storageKey, savedData);

            // ── Build response ──
            var rewardSummary = [];
            for (var rid in rewards) {
                rewardSummary.push(rid + 'x' + rewards[rid]);
            }

            log.info('SNAKE', 'sweep SUCCESS — passLess=' + passLess
                + ', diamond=' + diamondBalance + '→' + newDiamondBalance
                + ', rewards=[' + rewardSummary.join(', ') + ']'
                + ', snake reset to curLess=1 passLess=0');

            var response = {
                _changeInfo: { _items: changeItems }
            };

            callback(response);

        } catch (err) {
            log.error('SNAKE', 'sweep UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    MainServer.registerHandler('snake', 'sweep', handleSweep);
})();
