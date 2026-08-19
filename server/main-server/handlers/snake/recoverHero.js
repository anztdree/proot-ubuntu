/**
 * handlers/snake/recoverHero.js — Snake Dungeon Hero Recovery Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: snake/recoverHero
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Recover hero HP/energy di snake dungeon. User pakai item 146 (Bean)
 *   untuk restore hero yang sudah mati/low HP kembali ke full.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITE (L135194)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   // Client cek: user punya cukup Bean (item 146) sebelum call
 *   var t = ItemsCommonSingleton.getInstance().getItemNum(BEANID);  // BEANID = 146
 *   if (t < e.chosedList.length) → "Not enough beans" tip, abort
 *
 *   ts.processHandler({
 *       type: "snake", action: "recoverHero",
 *       userId: <userId>,
 *       heroIds: e.chosedList,     // array of hero instance IDs yang mau di-recover
 *       version: "1.0"
 *   }, function(t) {
 *       SnakeManager.getInstance().saveSnakeRecoverData(t)   // t._allTeam
 *       ItemsCommonSingleton.getInstance().resetTtemsCallBack(t)  // t._changeInfo
 *       e.doRefresh()
 *   })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L86464 saveSnakeRecoverData + resetTtemsCallBack)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _allTeam: {                        // updated hero state (all heroes, not just recovered)
 *           "<heroInstanceId>": {
 *               _curHp: <number>,          // full HP after recovery
 *               _totalHp: <number>,
 *               _energy: <number>          // 50 (start energy)
 *           },
 *           ...
 *       },
 *       _changeInfo: {                     // bean cost deducted
 *           _items: {
 *               "146": { _id: 146, _num: <ABSOLUTE balance> }
 *           }
 *       }
 *   })
 *
 *   Client saveSnakeRecoverData (L86464):
 *     if(e._allTeam) → deserialize each entry as SnakeHeroInfo, set .heroId = key
 *
 *   Client resetTtemsCallBack:
 *     baca e._changeInfo._items (OBJECT keyed by string itemID)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * COST: 1 Bean (item 146) per hero recovered
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   BEANID = 146 (verified L78726)
 *   Client cek: getItemNum(146) >= heroIds.length sebelum call
 *   Server deduct: balance - heroIds.length
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RECOVERY LOGIC
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Untuk setiap hero di heroIds:
 *     - Set _curHp = _totalHp (full HP)
 *     - Set _energy = 50 (start energy)
 *
 *   Return _allTeam dengan SEMUA hero (bukan hanya yang di-recover),
 *   karena client saveSnakeRecoverData replace seluruh allTeam.
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var BEAN_ID = 146;

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    function loadSnakeState(savedData) {
        if (!savedData.snake) {
            savedData.snake = {
                _id: '', _curLess: 1, _passLess: 0,
                _allTeam: {}, _gotRewardBox: []
            };
        }
        if (!savedData.snake._allTeam) savedData.snake._allTeam = {};
        return savedData.snake;
    }

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

    function handleRecoverHero(request, callback) {
        var userId = request && request.userId;
        var heroIds = request && request.heroIds;

        log.info('SNAKE', 'snake/recoverHero START — userId=' + (userId || '-')
            + ', heroes=' + (heroIds ? heroIds.length : 0));

        try {
            if (!userId) { callback({}, 1); return; }
            if (!heroIds || !Array.isArray(heroIds) || heroIds.length === 0) {
                callback({}, 1); return;
            }

            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) { callback({}, 1); return; }

            var snake = loadSnakeState(savedData);
            var allTeam = snake._allTeam || {};

            // Validate bean balance
            var beanBalance = getItemBalance(savedData, BEAN_ID);
            var cost = heroIds.length;  // 1 bean per hero

            if (beanBalance < cost) {
                log.warn('SNAKE', 'recoverHero — not enough beans: have=' + beanBalance + ' need=' + cost);
                // Return ret=0 kosong (sama seperti shop/buy pattern)
                callback({});
                return;
            }

            // Recover each hero: set curHp = totalHp, energy = 50
            for (var i = 0; i < heroIds.length; i++) {
                var heroId = String(heroIds[i]);
                var heroState = allTeam[heroId];
                if (heroState) {
                    heroState._curHp = heroState._totalHp || 0;
                    heroState._energy = 50;
                    log.info('SNAKE', 'recoverHero — hero ' + heroId
                        + ' recovered to HP=' + heroState._curHp + '/' + heroState._totalHp);
                } else {
                    log.warn('SNAKE', 'recoverHero — hero ' + heroId + ' not in _allTeam, skip');
                }
            }

            // Deduct beans
            var newBeanBalance = beanBalance - cost;
            setItemBalance(savedData, BEAN_ID, newBeanBalance);

            // Persist
            db._set(storageKey, savedData);

            // Build response
            var changeItems = {};
            changeItems[String(BEAN_ID)] = { _id: BEAN_ID, _num: newBeanBalance };

            var response = {
                _allTeam: allTeam,
                _changeInfo: { _items: changeItems }
            };

            log.info('SNAKE', 'recoverHero SUCCESS — '
                + heroIds.length + ' heroes recovered'
                + ', beans=' + beanBalance + '→' + newBeanBalance);

            callback(response);

        } catch (err) {
            log.error('SNAKE', 'recoverHero UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    MainServer.registerHandler('snake', 'recoverHero', handleRecoverHero);
})();
