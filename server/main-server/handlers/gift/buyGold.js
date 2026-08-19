/**
 * handlers/gift/buyGold.js
 *
 * Client call (main.min.js L155426-155431):
 *   ts.processHandler({ type:"gift", action:"buyGold", userId, version:"1.0" }, callback)
 *
 * Callback (L155432-155433):
 *   var o = t._changeInfo._items;
 *   WelfareInfoManager.getInstance().setGoldBuyCount(n + 1)
 *   ItemsCommonSingleton.getInstance().openCommonItemGetTips(o)
 *
 * Flow:
 *   n = getGoldBuyCount()  →  o = goldBuy[n + 1]
 *   costNum <= 0 → gratis: gold = floor(goldBuyFree * goldPrice[userLevel].price * o.times)
 *   costNum >  0 → bayar: gold = floor(o.costNum * goldPrice[userLevel].price * o.times)
 *     kurangi diamond (item 101) sebanyak o.costNum
 *     tambah gold (item 102) sebanyak gold hasil hitung
 *
 * State: scheduleInfo._goldBuyCount (bukan giftInfo!)
 * Config: goldBuy.json, goldPrice.json, constant.json (goldBuyFree=20)
 */
(function () {
    'use strict';

    var MainServer = window.MainServer;
    var db = window.MainServerDB;

    if (!MainServer.handlers.gift) MainServer.handlers.gift = {};

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

    function getBal(sd, id) {
        var items = sd && sd.totalProps && sd.totalProps._items;
        if (!items) return 0;
        for (var i = 0; i < items.length; i++)
            if (Number(items[i]._id) === Number(id)) return Number(items[i]._num) || 0;
        return 0;
    }

    function setBal(sd, id, val) {
        if (!sd.totalProps) sd.totalProps = { _items: [] };
        if (!sd.totalProps._items) sd.totalProps._items = [];
        var items = sd.totalProps._items;
        for (var i = 0; i < items.length; i++)
            if (Number(items[i]._id) === Number(id)) { items[i]._num = val; return; }
        items.push({ _id: id, _num: val });
    }

    MainServer.registerHandler('gift', 'buyGold', function (request, callback) {
        var userId = request.userId;
        if (!userId) { callback({}, 1); return; }

        var savedData = db._get('user:' + userId);
        if (!savedData) { callback({}, 1); return; }

        // 1. Read buy count state (lives in scheduleInfo, NOT giftInfo)
        if (!savedData.scheduleInfo) savedData.scheduleInfo = {};
        var buyCount = Number(savedData.scheduleInfo._goldBuyCount) || 0;

        // 2. Load goldBuy config for next tier
        var goldBuy = loadJson('goldBuy');
        if (!goldBuy) { callback({}, 1); return; }
        var tier = goldBuy[String(buyCount + 1)];
        if (!tier) { callback({}, 1); return; }

        // 3. Validate VIP level
        var playerVipLevel = getBal(savedData, 106);
        if (playerVipLevel < Number(tier.VIPNeeded)) { callback({}, 1); return; }

        // 4. Load goldPrice by user level
        var goldPrice = loadJson('goldPrice');
        var constant = loadJson('constant');
        var userLevel = Number(getBal(savedData, 100)) || 1; // item 100 = userLevel
        var priceEntry = goldPrice && goldPrice[String(userLevel)];
        if (!priceEntry) priceEntry = goldPrice[String(constant && constant[1] && constant[1].maxUserLevel || 300)];
        if (!priceEntry) priceEntry = goldPrice['1'];
        var price = Number(priceEntry.price) || 0;

        // 5. Calculate gold reward
        var goldBuyFree = constant && constant[1] && Number(constant[1].goldBuyFree) || 20;
        var costNum = Number(tier.costNum) || 0;
        var times = Number(tier.times) || 1;
        var goldGain;
        if (costNum <= 0) {
            // Free purchase
            goldGain = Math.floor(goldBuyFree * price * times);
        } else {
            // Paid purchase — check diamond balance
            var diamondBal = getBal(savedData, 101);
            if (diamondBal < costNum) { callback({}, 1); return; }
            // Deduct diamond
            setBal(savedData, 101, diamondBal - costNum);
            goldGain = Math.floor(costNum * price * times);
        }

        // 6. Add gold (item 102)
        var oldGold = getBal(savedData, 102);
        var newGold = oldGold + goldGain;
        setBal(savedData, 102, newGold);

        // 7. Update buy count
        savedData.scheduleInfo._goldBuyCount = buyCount + 1;

        // 8. Persist
        db._set('user:' + userId, savedData);

        // 9. Response — _changeInfo._items (OBJECT format, ABSOLUTE balance)
        var changeItems = {};
        changeItems['102'] = { _id: 102, _num: newGold };
        if (costNum > 0) {
            changeItems['101'] = { _id: 101, _num: getBal(savedData, 101) };
        }

        callback({ _changeInfo: { _items: changeItems } });
    });

    window.MainServer = MainServer;
})();