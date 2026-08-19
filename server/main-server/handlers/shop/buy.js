/**
 * handlers/shop/buy.js
 *
 * Request:  { type:"shop", action:"buy", userId, marketType, goodId, times, version:"1.0" }
 * Response: { _buyTime:<number>, _changeInfo:{_items:{...}}, _addHeroes:[...] (if hero) }
 *
 * TASK SIDE-EFFECT (MAIN task 6035):
 *   Jika curMainTask[0]._state === DOING(1) AND taskType === "soulShopBuy"
 *   AND marketType === 4 (SOUL) AND goodsID === Number(taskPara2) (1309)
 *   → set _state = COMPLETE(2) + push mainTaskChange notify.
 *   No achievement chain for shop/buy (verified 0 matches in taskAchievement.json).
 *   No daily task for shop/buy (buyGold=6103 → gift/buyGold.js, shopping=6107 → market/buy.js).
 *
 * ============================================================
 * ANALYSIS EVIDENCE:
 * ============================================================
 *
 * [CALL SITE 1 — ShopItemListItem.buyBtnTap] L133618-133647:
 *   ts.processHandler({
 *     type:"shop", action:"buy", userId, marketType:e.type, goodId:e.index,
 *     times:1, version:"1.0"
 *   }, function(t) {
 *     ShopInfoManager.getInstance().setBuyTimes(e.type, e.index, t._buyTime),
 *     UIWindowManager.openCongratulationObtain(t);
 *   })
 *
 * [CALL SITE 2 — ShopBuyCountSelectPanel.confirmBtnTap] L130278-130297:
 *   Same request with times: e.currBuyCount
 *   Same callback pattern
 *
 * [REQUEST FIELDS]:
 *   marketType — MARKET_TYPE enum (L79581):
 *     TYPE_ARENA=2, TYPE_GUILD=3, TYPE_SOUL=4, TYPE_SNAKE=5,
 *     TYPE_VIP_MARKET=6, TYPE_SOUL_PLUS=7, TYPE_TEAM_DUNGEON=8
 *   goodId — shop item ID from shop JSON config (e.g. 171, 181)
 *     Set at L133589: e.index = e.shopJsonInfo.id
 *   times — number of purchases (1 or more)
 *
 * [RESPONSE FIELDS]:
 *   _buyTime — total times bought for this item (number)
 *     Used by setBuyTimes(marketType, goodId, _buyTime) at L133639
 *   _changeInfo._items — ABSOLUTE balance items (deducted currency + any other)
 *     Read by openCongratulationObtain (L56636-56651)
 *   _addHeroes — FULL hero data if goodsID is a hero (thingsType==="hero")
 *     Read by openCongratulationObtain → saveGainWithOutItems
 *
 * [SHOP JSON STRUCTURE] (e.g. soulShop.json):
 *   { "171": { id:171, isShow:1, goodsID:1421, num:1, coinID:111, price:750, count:1 } }
 *   goodsID = item ID from thingsID.json (can be hero if thingsType==="hero")
 *   coinID  = currency item ID used to pay
 *   price   = cost per purchase
 *   count   = max buy count (-1 = unlimited)
 *
 * [SHOP JSON PER MARKET_TYPE]:
 *   2 (ARENA)         → arenaShop_json
 *   3 (GUILD)         → guildShop_json
 *   4 (SOUL)          → soulShop_json
 *   5 (SNAKE)         → snakeShop_json
 *   7 (SOUL_PLUS)     → soulShopPlus_json
 *   8 (TEAM_DUNGEON)  → teamDungeonShop_json
 *
 * [ShopInfoManager.setBuyTimes] (L79581):
 *   setBuyTimes(marketType, goodId, buyTime)
 *   → shopInfo._buyTimes[marketType][goodId] = buyTime
 *
 * [ShopInfoManager.getBuyTimes] (L79581):
 *   getBuyTimes(marketType, goodId) → number (0 if not found)
 *
 * [STOCK CHECK] L133608-133613:
 *   var m = getBuyTimes(e.type, e.shopJsonInfo.id);
 *   var h = e.shopJsonInfo.count - m;  // remaining = max - bought
 *   if (h <= 0) → "sold out"
 *
 * [SHOP STATE STORAGE] (from getInfo.js):
 *   Key: shop:{userId}
 *   _buyTimes: { "2": { "171": 3, "181": 1 }, "4": { "171": 0 }, ... }
 *
 * [HERO REWARD] — if goodsID has thingsType==="hero" in thingsID.json:
 *   Must return _addHeroes with FULL hero data (makeHeroBasicAttr + buildHeroData)
 *   Same pattern as summonOne.js / buyCard.js
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.shop) {
        MainServer.handlers.shop = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var MARKET_TYPE_NAMES = {
        2: 'arenaShop',
        3: 'guildShop',
        4: 'soulShop',
        5: 'snakeShop',
        7: 'soulShopPlus',
        8: 'teamDungeonShop'
    };

    var SHOP_STORAGE_PREFIX = 'shop:';

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    function shopStorageKey(userId) {
        return SHOP_STORAGE_PREFIX + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached)
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
            log.error('RESOURCE', 'shop/buy failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'shop/buy failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getShopConfig(marketType) {
        var configName = MARKET_TYPE_NAMES[marketType];
        if (!configName) return null;
        return loadJson(configName);
    }

    function getThingsConfig(itemId) {
        var data = loadJson('thingsID');
        return data ? data[String(itemId)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  USER DATA HELPERS (same pattern as buyCard.js / hero/resolve.js)
    // ═══════════════════════════════════════════════════════════

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

    function setItemBalance(savedData, itemId, newBalance) {
        if (!savedData.totalProps) savedData.totalProps = {};
        if (!savedData.totalProps._items) savedData.totalProps._items = [];
        var items = savedData.totalProps._items;
        for (var i = 0; i < items.length; i++) {
            if (Number(items[i]._id) === Number(itemId)) {
                items[i]._num = newBalance;
                return;
            }
        }
        items.push({ _id: Number(itemId), _num: newBalance });
    }

    // ═══════════════════════════════════════════════════════════
    //  SHOP STATE HELPERS (same storage as getInfo.js)
    // ═══════════════════════════════════════════════════════════

    function loadShopState(userId) {
        var key = shopStorageKey(userId);
        var state = db._get(key);
        if (!state || typeof state !== 'object') {
            state = { _id: 'shop_' + userId, _buyTimes: {}, _autoRefreshTime: {} };
            db._set(key, state);
        }
        if (!state._buyTimes) state._buyTimes = {};
        if (!state._autoRefreshTime) state._autoRefreshTime = {};
        return state;
    }

    function getBuyTime(shopState, marketType, goodId) {
        var mtKey = String(marketType);
        if (shopState._buyTimes[mtKey] && shopState._buyTimes[mtKey][String(goodId)] !== undefined) {
            return Number(shopState._buyTimes[mtKey][String(goodId)]) || 0;
        }
        return 0;
    }

    function setBuyTime(shopState, marketType, goodId, newBuyTime) {
        var mtKey = String(marketType);
        if (!shopState._buyTimes[mtKey]) shopState._buyTimes[mtKey] = {};
        shopState._buyTimes[mtKey][String(goodId)] = newBuyTime;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO DATA BUILDING (same as buyCard.js — makeHeroBasicAttr + buildHeroData)
    // ═══════════════════════════════════════════════════════════

    function getHeroConfig(heroDisplayId) {
        var h = loadJson('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getHeroLevelAttr(level) {
        var la = loadJson('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    function getHeroQualityParam(quality) {
        var qp = loadJson('heroQualityParam');
        return qp ? qp[quality] : null;
    }

    function getHeroTypeParam(heroType) {
        var tp = loadJson('heroTypeParam');
        return tp ? tp[heroType] : null;
    }

    function getHeroEvolve(heroId) {
        var ev = loadJson('heroEvolve');
        return ev ? ev[String(heroId)] : null;
    }

    function getHeroWakeUp(heroId) {
        var wu = loadJson('heroWakeUp');
        return wu ? wu[String(heroId)] : null;
    }

    function makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel) {
        level = level || 1;
        evolveLevel = evolveLevel || 0;
        starLevel = starLevel || 0;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) return null;

        var quality = hc.quality || 'purple';
        var heroType = hc.heroType || 'critical';
        var la = getHeroLevelAttr(level) || {};
        var qp = getHeroQualityParam(quality) || {};
        var tp = getHeroTypeParam(heroType) || {};
        var evEntries = getHeroEvolve(heroDisplayId) || [];
        var wuEntries = getHeroWakeUp(heroDisplayId) || [];

        var talent = Number(hc.talent) || 0;

        var d = {
            _hp: 0, _attack: 0, _armor: 0, _speed: 0,
            _hit: 0, _dodge: 0, _block: 0, _damageReduce: 0, _armorBreak: 0,
            _controlResist: 0, _skillDamage: 0, _criticalDamage: 0, _blockEffect: 0,
            _critical: 0, _criticalResist: 0, _trueDamage: 0, _energy: 50,
            _power: 0, _extraArmor: 0, _hpPercent: 0, _armorPercent: 0,
            _attackPercent: 0, _speedPercent: 0, _orghp: 0, _superDamage: 0,
            _healPlus: 0, _healerPlus: 0, _damageDown: 0, _shielderPlus: 0,
            _damageUp: 0,
            _talent: talent,
            _level: level,
            _exp: 0,
            _evolveLevel: evolveLevel
        };

        var evList = Array.isArray(evEntries) ? evEntries : [];
        for (var ei = 0; ei < evList.length; ei++) {
            var ev = evList[ei];
            if (evolveLevel >= (ev.level || 0)) {
                d._hp += Number(ev.hp) || 0;
                d._attack += Number(ev.attack) || 0;
                d._armor += Number(ev.armor) || 0;
                d._speed += Number(ev.speed) || 0;
            }
        }

        var wuList = Array.isArray(wuEntries) ? wuEntries : [];
        for (var wi = 0; wi < wuList.length; wi++) {
            var wu = wuList[wi];
            if (starLevel >= (wu.star || 0)) {
                talent += Number(wu.talent) || 0;
                d._hp += Number(wu.hp) || 0;
                d._attack += Number(wu.attack) || 0;
                d._armor += Number(wu.armor) || 0;
                d._speed += Number(wu.speed) || 0;
            }
        }
        d._talent = talent;

        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        d._hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        d._attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        d._armor += baseArm;

        d._speed += Number(hc.speed) || 0;
        d._hit += Number(hc.hit) || 0;
        d._dodge += Number(hc.dodge) || 0;
        d._block += Number(hc.block) || 0;
        d._damageReduce += Number(hc.damageReduce) || 0;
        d._armorBreak += Number(hc.armorBreak) || 0;
        d._controlResist += Number(hc.controlResist) || 0;
        d._skillDamage += Number(hc.skillDamage) || 0;
        d._criticalDamage += Number(hc.criticalDamage) || 0;
        d._blockEffect += Number(hc.blockEffect) || 0;
        d._critical += Number(hc.critical) || 0;
        d._criticalResist += Number(hc.criticalResist) || 0;
        d._trueDamage += Number(hc.trueDamage) || 0;
        d._healPlus += Number(hc.healPlus) || 0;
        d._healerPlus += Number(hc.healerPlus) || 0;
        d._energy = 50;

        return d;
    }

    function buildHeroData(heroDisplayId, heroInstanceId) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) return null;

        var heroTag = hc.tag ? hc.tag.split(',') : [];
        var baseAttr = makeHeroBasicAttr(heroDisplayId, 1, 0, 0);
        if (!baseAttr) return null;

        return {
            _heroId: heroInstanceId,
            _heroDisplayId: heroDisplayId,
            _heroStar: 0,
            _expeditionMaxLevel: 0,
            _heroTag: heroTag,
            _fragment: 0,
            _superSkillResetCount: 0,
            _potentialResetCount: 0,
            _heroBaseAttr: baseAttr,
            _superSkillLevel: {},
            _potentialLevel: {},
            _qigong: [],
            _qigongTmp: [],
            _qigongStage: 1,
            _qigongTmpPower: 0,
            _totalCost: {
                _wakeUp: { _items: [] },
                _earring: { _items: [] },
                _levelUp: { _items: [] },
                _evolve: { _items: [] },
                _skill: { _items: [] },
                _qigong: { _items: [] },
                _heroBreak: { _items: [] }
            },
            _breakInfo: {
                _breakLevel: 1,
                _level: 0,
                _attr: { _items: [] }
            },
            _gemstoneSuitId: 0,
            _linkTo: [],
            _linkFrom: ''
        };
    }

    function generateHeroInstanceId(savedData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};
        var heros = savedData.heros._heros;
        var maxId = 0;
        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;
            var hid = Number(heros[key]._heroId) || 0;
            if (hid > maxId) maxId = hid;
        }
        return maxId + 1;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleBuy(request, callback) {
        var userId = request.userId;
        var marketType = Number(request.marketType);
        var goodId = request.goodId;
        var times = Number(request.times) || 1;

        log.info('HANDLER', 'shop/buy — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['marketType', String(marketType)],
            ['goodId', String(goodId)],
            ['times', String(times)],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'shop/buy — missing userId');
            callback({}, 1);
            return;
        }

        if (!MARKET_TYPE_NAMES[marketType]) {
            log.error('HANDLER', 'shop/buy — invalid marketType: ' + marketType);
            callback({}, 1);
            return;
        }

        if (!goodId && goodId !== 0) {
            log.error('HANDLER', 'shop/buy — missing goodId');
            callback({}, 1);
            return;
        }

        if (times < 1) {
            log.error('HANDLER', 'shop/buy — invalid times: ' + times);
            callback({}, 1);
            return;
        }

        // ── LOAD SHOP CONFIG ──
        var shopConfig = getShopConfig(marketType);
        if (!shopConfig) {
            log.error('HANDLER', 'shop/buy — shop config not found for marketType ' + marketType);
            callback({}, 1);
            return;
        }

        var shopItem = shopConfig[String(goodId)];
        if (!shopItem) {
            log.error('HANDLER', 'shop/buy — goodId ' + goodId + ' not found in ' + MARKET_TYPE_NAMES[marketType]);
            callback({}, 1);
            return;
        }

        var goodsID = Number(shopItem.goodsID);
        var numPerBuy = Number(shopItem.num) || 1;
        var coinID = Number(shopItem.coinID);
        var price = Number(shopItem.price) || 0;
        var maxCount = Number(shopItem.count); // -1 = unlimited

        log.info('HANDLER', 'shop/buy — item: goodsID=' + goodsID + ', num=' + numPerBuy + ', coinID=' + coinID + ', price=' + price + ', maxCount=' + maxCount);

        // ── LOAD THINGS CONFIG (to check if it's a hero) ──
        var thingsConfig = getThingsConfig(goodsID);
        var isHero = thingsConfig && thingsConfig.thingsType === 'hero';

        // ── LOAD USER DATA ──
        var userKey = userStorageKey(userId);
        var savedData = db._get(userKey);
        if (!savedData) {
            log.error('HANDLER', 'shop/buy — user data not found: ' + userKey);
            callback({}, 1);
            return;
        }

        // ── LOAD SHOP STATE ──
        var shopState = loadShopState(userId);
        var currentBuyTime = getBuyTime(shopState, marketType, goodId);

        // ── STOCK CHECK ──
        if (maxCount !== -1) {
            var remaining = maxCount - currentBuyTime;
            if (remaining < times) {
                log.warn('HANDLER', 'shop/buy — not enough stock. bought=' + currentBuyTime + ', max=' + maxCount + ', requested=' + times);
                callback({});
                return;
            }
        }

        // ── CURRENCY CHECK ──
        var totalCost = price * times;
        var currentBalance = getItemBalance(savedData, coinID);
        if (currentBalance < totalCost) {
            log.warn('HANDLER', 'shop/buy — not enough currency. coinID=' + coinID + ', have=' + currentBalance + ', need=' + totalCost);
            // Return ret=0 dengan response kosong — client tidak punya error handler untuk shop/buy
            // Client cek currency sendiri sebelum call (L133608), jadi seharusnya tidak sampai sini
            // Tapi kalau sampai sini, return success kosong supaya tidak muncul "Unknown Error"
            callback({});
            return;
        }

        // ── DEDUCT CURRENCY ──
        var newCurrencyBalance = currentBalance - totalCost;
        setItemBalance(savedData, coinID, newCurrencyBalance);

        // ── BUILD RESPONSE ──
        var changeItems = {};
        changeItems[String(coinID)] = {
            _id: coinID,
            _num: newCurrencyBalance
        };

        var addHeroes = null;

        if (isHero) {
            // ── HERO REWARD: build FULL hero data for each copy ──
            addHeroes = [];
            for (var t = 0; t < times; t++) {
                var totalNum = numPerBuy; // numPerBuy copies per "times" click
                for (var c = 0; c < totalNum; c++) {
                    var heroInstanceId = generateHeroInstanceId(savedData);
                    var heroData = buildHeroData(goodsID, heroInstanceId);
                    if (heroData) {
                        // Add to user's hero list
                        if (!savedData.heros._heros) savedData.heros._heros = {};
                        savedData.heros._heros[String(heroInstanceId)] = heroData;
                        addHeroes.push(heroData);
                        log.info('HANDLER', 'shop/buy — added hero displayId=' + goodsID + ' instanceId=' + heroInstanceId);
                    } else {
                        log.error('HANDLER', 'shop/buy — failed to build hero data for displayId=' + goodsID);
                    }
                }
            }
        } else {
            // ── ITEM REWARD: add to user inventory ──
            var totalItemNum = numPerBuy * times;
            var newBalance = getItemBalance(savedData, goodsID) + totalItemNum;
            setItemBalance(savedData, goodsID, newBalance);
            changeItems[String(goodsID)] = {
                _id: goodsID,
                _num: newBalance
            };
            log.info('HANDLER', 'shop/buy — added item ' + goodsID + ' x' + totalItemNum + ' → balance ' + newBalance);
        }

        // ── UPDATE BUY TIMES ──
        var newBuyTime = currentBuyTime + times;
        setBuyTime(shopState, marketType, goodId, newBuyTime);

        // ════════════════════════════════════════════════════════
        //  MAIN TASK UPDATE — soulShopBuy (task.json id=6035)
        // ════════════════════════════════════════════════════════
        //
        //  [TASK CONFIG] task.json id=6035:
        //    { type:"main", levelNeeded:29, taskType:"soulShopBuy",
        //      taskPara1:1, taskPara2:1309,
        //      nextTaskID:6036,
        //      reward1:103, num1:1350, reward2:131, num2:7000, reward3:102, num3:50000 }
        //
        //  [TRIGGER CONDITION] (verified via soulShop.json + main.min.js):
        //    marketType === 4 (SOUL Shop)
        //    AND goodsID === Number(taskPara2) (1309 — hero Tapion)
        //    soulShop.json goodId=351 → goodsID=1309, coinID=111, price=10, count=1
        //
        //  [CLIENT LISTENER] main.min.js L77080:
        //    "mainTaskChange" == n && UserInfoSingleton.getInstance().setMianTask(e._curMainTask)
        //
        //  [CLIENT STATE MACHINE] L62521-62525 setMianTask(e):
        //    for(var n in e) _mainTask._id = e[n]._id, _state = e[n]._state
        //
        //  [PATTERN] Identik dengan:
        //    - hero/resolve.js (decomposeHero, MAIN 6034)
        //    - backpack/randSummons.js (composeHero, MAIN 6005)
        //    - trial/checkBattleResult.js (templeTestBattle)
        //
        //  Note: No achievement chain for shop/buy (taskAchievement.json
        //  has 0 matches for shop/buy/gold/purchase taskType).
        //  No daily task for shop/buy (buyGold=6103 → gift/buyGold.js,
        //  shopping=6107 → market/buy.js — different handlers).
        //

        var taskUpdated = false;
        try {
            var cmt = savedData.curMainTask;
            var canCheckTask = cmt && Array.isArray(cmt) && cmt.length > 0
                && Number(cmt[0]._state) === 1; // TASK_STATE.DOING

            if (canCheckTask) {
                var taskCfg = loadJson('task');
                if (taskCfg) {
                    var mainTaskDef = taskCfg[String(cmt[0]._id)];
                    if (mainTaskDef && mainTaskDef.taskType === 'soulShopBuy') {
                        var needHeroId = Number(mainTaskDef.taskPara2) || 0;

                        // Condition: bought the right hero from Soul Shop
                        if (marketType === 4 && goodsID === needHeroId) {
                            cmt[0]._state = 2; // TASK_STATE.COMPLETE
                            taskUpdated = true;

                            log.info('HANDLER', 'shop/buy — Main task '
                                + cmt[0]._id + ' (soulShopBuy) DOING → COMPLETE'
                                + ' (bought hero ' + goodsID + ' from Soul Shop)');
                        } else {
                            log.info('HANDLER', 'shop/buy — soulShopBuy not triggered'
                                + ' (marketType=' + marketType + ' need=4,'
                                + ' goodsID=' + goodsID + ' need=' + needHeroId + ')');
                        }
                    }
                }
            }
        } catch (taskErr) {
            log.error('HANDLER', 'shop/buy — task check error: '
                + (taskErr && taskErr.message || taskErr));
        }

        // ── SAVE USER DATA (termasuk perubahan curMainTask jika ada) ──
        db._set(userKey, savedData);

        // ── SAVE SHOP STATE ──
        db._set(shopStorageKey(userId), shopState);

        log.info('HANDLER', 'shop/buy — SUCCESS. Bought ' + times + 'x goodId=' + goodId
            + '. Currency ' + coinID + ': ' + currentBalance + ' → ' + newCurrencyBalance
            + '. BuyTime: ' + currentBuyTime + ' → ' + newBuyTime
            + (taskUpdated ? ' [main task updated]' : ''));

        // ── PUSH mainTaskChange NOTIFY (setelah save agar state konsisten) ──
        // Format: { action:'mainTaskChange', _curMainTask:[{_id, _state}] }
        // Client L77080: setMianTask(e._curMainTask)
        if (taskUpdated && typeof MainServer.notify === 'function') {
            try {
                MainServer.notify({
                    action: 'mainTaskChange',
                    _curMainTask: [{
                        _id: cmt[0]._id,
                        _state: 2 // TASK_STATE.COMPLETE
                    }]
                });
                log.info('HANDLER', 'shop/buy — pushed mainTaskChange (state=2 COMPLETE)');
            } catch (notifyErr) {
                log.error('HANDLER', 'shop/buy — notify failed: '
                    + (notifyErr && notifyErr.message || notifyErr));
            }
        }

        // ── BUILD RESPONSE ──
        var response = {
            _buyTime: newBuyTime,
            _changeInfo: {
                _items: changeItems
            }
        };

        if (addHeroes && addHeroes.length > 0) {
            response._addHeroes = addHeroes;
        }

        log.details('response', [
            ['_buyTime', String(newBuyTime)],
            ['_changeInfo._items', JSON.stringify(changeItems)],
            ['_addHeroes', addHeroes ? (addHeroes.length + ' heroes') : '(none)']
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('shop', 'buy', handleBuy);

})();