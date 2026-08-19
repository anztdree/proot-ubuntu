/**
 * handlers/monthCard/buyCard.js
 *
 * Request:  { type:"monthCard", action:"buyCard", userId, cardType:1-4, version:"1.0" }
 * Response: { prePayRet: { errorCode:0, data:{...} } }
 *
 * ============================================================
 * ANALYSIS EVIDENCE:
 * ============================================================
 *
 * [CALL SITE] L155794-155806:
 *   buyMonthCard(cardType) → processHandler({type:"monthCard",action:"buyCard",userId,cardType,version:"1.0"}, cb)
 *   cb: e.prePayRet && 0 === e.prePayRet.errorCode ? ts.payToSdk(e.prePayRet.data) : log("预支付失败")
 *   Error cb: log("失败！！！")
 *
 * [MONTH_CARD_TYPE enum] L88111-88114:
 *   MCT_NULL=0, SHORT=1, LONG=2, NO_LIMIT=3, EVO_MONTHCARD=4
 *
 * [UI BUY BUTTONS] L155788-155793:
 *   buyBtn1 → SHORT (1), buyBtn2 → EVO_MONTHCARD (4), buyBtn3 → NO_LIMIT (3)
 *   LONG (2) has NO buy button in UI — but handler should still accept it.
 *
 * [MonthCardPanel.initMonthCard] L155636-155696:
 *   Reads monthCard.json via ReadJsonSingleton.getInstance().monthCard
 *   Checks monthCardInfo._card[config.id]._endTime vs serverTime
 *   If _endTime > now → show active card (time remaining + claim btn)
 *   If _endTime <= now or not exist → show buy button
 *   Displays buyAwardID1 as gift preview (L155685-155696)
 *   VIP exp display: Math.floor(config[currency] * constant[1].vipExpPara)
 *
 * [payFinish NOTIFY] L77104-77117:
 *   if (0 == e._code):
 *     ReportBsH5FaceBookSdkInfo("track","Purchase",{currency:"USD",value:e._detail._totalPrice})
 *     WelfareInfoManager.firstRechargeInfo._canGetReward = true
 *     openCongratulationObtain(e._detail)  ← reads _detail._changeInfo._items AND _detail._addHeroes
 *     disposePushNotification(e)
 *     refreshNodePayFinish(e)
 *
 * [disposePushNotification MONTH_CARD] L79585:
 *   case GOOD_TYPE.MONTH_CARD:
 *     var i = t._detail._card, s = new CardItem;
 *     s._endTime = i._endTime;
 *     n.monthCardInfo._card[t._goodId] = s;
 *     break;
 *
 * [openCongratulationObtain] L56636-56651:
 *   Checks: t._changeInfo || t._addHeroes || t._addSigns || t._addWeapons || t._addStones || t._addGenkis
 *   Reads: t._changeInfo._items → OBJECT keyed by STRING item ID, each {_id, _num: ABSOLUTE}
 *   saveGainWithOutItems(t) processes _addHeroes via SetHeroDataToModel → addToHeros → getAttrs
 *
 * [saveGainWithOutItems _addHeroes] L56673-56693:
 *   for(var a in e._addHeroes):
 *     SetHeroDataToModel(e._addHeroes[a], true) → r = {heroId, heroDisplayId, heroStar, heroBaseAttr, ...}
 *     addToHeros(r.heroId, r)
 *     Then calls hero/getAttrs for all new hero IDs
 *
 * [monthCard NOTIFY] L77042:
 *   action:"monthCard" → WelfareInfoManager.addMonthCardLogInfo(e)
 *   Expects: {_cardId: cardType, _userName: nickName}
 *   setMonthCardLog reads noticeContent.json:
 *     SHORT(1) → noticeContent[2], LONG(2) → noticeContent[3],
 *     NO_LIMIT(3) → noticeContent[4], EVO_MONTHCARD(4) → noticeContent[61]
 *
 * [GOOD_TYPE enum] L88139:
 *   MONTH_CARD = 2
 *
 * [MonthCardModel] L88122-88128:
 *   { _id: "", _card: {} }
 *
 * [CardItem] L88115-88120:
 *   { _endTime: 0 }
 *
 * [enterGame monthCard init] enterGame.js L1286:
 *   r.monthCard = { _id: '', _card: {} }
 *
 * [setMonthCardInfo] (WelfareInfoManager):
 *   monthCardInfo._id = e._id, monthCardInfo._card = {}
 *   for(n in e._card): new CardItem → _endTime = e._card[n]._endTime
 *
 * ============================================================
 * monthCard.json CONFIG (4 entries):
 * ============================================================
 *   Card 1 (SHORT):       USD=4.99, diamond=300,  buyAwardID1=4304(weapon)  x1, time=30d,   daily: award1ID=101(diamond) x100
 *   Card 2 (LONG):        USD=14.99, diamond=820,  no buyAward,                          time=30d,   daily: award1ID=101(diamond) x300
 *   Card 3 (NO_LIMIT):    USD=14.99, diamond=980,  buyAwardID1=1420(HERO!)   x1, time=999999d, daily: award1ID=101(diamond) x200
 *   Card 4 (EVO_MONTHCARD): USD=4.99, diamond=0,   buyAwardID1=101 x2200, buyAwardID2=499 x3, time=30d, daily: award1ID=499 x1
 *
 *   ⚠️ Hero 1420 (贝吉塔超一) → MUST use _addHeroes with FULL hero data (makeHeroBasicAttr + buildHeroData)
 *   ⚠️ Weapon 4304 (界王神剑·压迫) → regular item reward via _changeInfo._items
 *   ⚠️ Item 499 (blue usable) → regular item reward via _changeInfo._items
 *   ⚠️ Item 101 = DIAMONDS (from recharge handler DIAMONDID=101)
 *
 * ============================================================
 * SERVER PROCESSING:
 * ============================================================
 *   1. Validate request (userId, cardType 1-4)
 *   2. Load monthCard.json[cardType]
 *   3. Load user data from IndexedDB
 *   4. Check if card already active (monthCard._card[cardType]._endTime > now) → reject
 *   5. Process instant rewards:
 *      a. diamond field → add to item 101 balance
 *      b. buyAwardID1/buyNum1 → hero? → _addHeroes (FULL data) : → _changeInfo._items
 *      c. buyAwardID2/buyNum2 → _changeInfo._items (if exists)
 *   6. Calculate VIP exp: Math.floor(USD * 10), update item 107 & 106
 *   7. Calculate endTime: Date.now() + (time_days * 86400000)
 *   8. Save monthCard._card[cardType] = {_endTime: endTime}
 *   9. Update firstRecharge flag if first ever purchase
 *   10. Save user data
 *   11. Send payFinish notify (_goodType=2, _detail._card, _detail._changeInfo, _detail._addHeroes)
 *   12. Send monthCard broadcast notify
 *   13. Send vipLevel notify if VIP level changed
 *   14. Return prePayRet: {errorCode:0, data:{...}}
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.monthCard) {
        MainServer.handlers.monthCard = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var GOOD_TYPE_MONTH_CARD = 2;

    var ITEM_IDS = {
        DIAMONDID: 101,
        PLAYERLEVELID: 104,
        PLAYERVIPLEVELID: 106,
        PLAYERVIPEXPALLID: 107
    };

    /** Valid card types */
    var VALID_CARD_TYPES = [1, 2, 3, 4];

    /** noticeContent.json index per cardType for broadcast */
    var NOTICE_CONTENT_MAP = {
        1: 2,   // SHORT → noticeContent[2]
        2: 3,   // LONG → noticeContent[3]
        3: 4,   // NO_LIMIT → noticeContent[4]
        4: 61   // EVO_MONTHCARD → noticeContent[61]
    };

    function userStorageKey(userId) {
        return 'user:' + userId;
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
            log.error('RESOURCE', 'monthCard/buyCard failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'monthCard/buyCard failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getMonthCardConfig(cardType) {
        var data = loadJson('monthCard');
        return data ? data[String(cardType)] : null;
    }

    function getThingsConfig(itemId) {
        var data = loadJson('thingsID');
        return data ? data[String(itemId)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  VIP LEVEL CALCULATION (same as recharge handler)
    // ═══════════════════════════════════════════════════════════

    function getVipUpgradeTable() {
        var data = loadJson('vipUpgrade');
        if (!data) return [];
        var entries = [];
        var cumulative = 0;
        var keys = Object.keys(data).sort(function (a, b) { return parseInt(a) - parseInt(b); });
        for (var i = 0; i < keys.length; i++) {
            var level = parseInt(keys[i]);
            entries.push({ level: level, cumulative: cumulative });
            cumulative += Number(data[keys[i]].expNeeded) || 0;
        }
        return entries;
    }

    function calculateVipLevel(totalExp, vipTable) {
        var level = 0;
        for (var i = 0; i < vipTable.length; i++) {
            if (totalExp >= vipTable[i].cumulative) {
                level = vipTable[i].level;
            } else {
                break;
            }
        }
        return level;
    }

    // ═══════════════════════════════════════════════════════════
    //  USER DATA HELPERS
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

    function addItems(savedData, itemId, amount) {
        var old = getItemBalance(savedData, itemId);
        var newVal = old + amount;
        setItemBalance(savedData, itemId, newVal);
        return newVal;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO DATA BUILDING (same as summon handler / getVipReward)
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

    /**
     * makeHeroBasicAttr — IDENTICAL to summonOne.js L396-498
     * Computes 30+ stat fields from hero.json, heroLevelAttr.json,
     * heroQualityParam.json, heroTypeParam.json, heroEvolve.json, heroWakeUp.json
     */
    function makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel) {
        level = level || 1;
        evolveLevel = evolveLevel || 0;
        starLevel = starLevel || 0;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('HERO', 'Hero config not found: ' + heroDisplayId);
            return null;
        }

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

        // Evolve bonuses
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

        // WakeUp/Star bonuses
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

        // Base stats: level × type × quality × balance
        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        d._hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        d._attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        d._armor += baseArm;

        // Flat stats from hero config
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

    /**
     * buildHeroData — IDENTICAL to summonOne.js L651-699 (buildSummonHeroData)
     * Builds complete hero object with all fields required for
     * SetHeroDataToModel, addToHeros, upgrade, levelup, gear.
     */
    function buildHeroData(heroDisplayId, heroInstanceId) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('HERO', 'Cannot build hero data — config not found: ' + heroDisplayId);
            return null;
        }

        var heroTag = hc.tag ? hc.tag.split(',') : [];
        var baseAttr = makeHeroBasicAttr(heroDisplayId, 1, 0, 0);

        if (!baseAttr) {
            log.error('HERO', 'Cannot build hero data — base attr failed: ' + heroDisplayId);
            return null;
        }

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

    /**
     * generateHeroInstanceId(savedData)
     * Max existing _heroId + 1.
     */
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

    function handleBuyCard(request, callback) {
        var userId = request.userId;
        var cardType = Number(request.cardType);

        log.info('HANDLER', 'monthCard/buyCard — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['cardType', String(cardType)],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'monthCard/buyCard — missing userId');
            callback({ prePayRet: { errorCode: 1, errorMsg: 'missing_userId' } });
            return;
        }
        if (VALID_CARD_TYPES.indexOf(cardType) === -1) {
            log.error('HANDLER', 'monthCard/buyCard — invalid cardType: ' + cardType);
            callback({ prePayRet: { errorCode: 1, errorMsg: 'invalid_cardType' } });
            return;
        }

        // ── LOAD CONFIG ──
        var cardConfig = getMonthCardConfig(cardType);
        if (!cardConfig) {
            log.error('HANDLER', 'monthCard/buyCard — cardType ' + cardType + ' not found in monthCard.json');
            callback({ prePayRet: { errorCode: 1, errorMsg: 'card_not_found' } });
            return;
        }

        var priceUSD = Number(cardConfig.USD) || 0;
        var diamondBonus = Number(cardConfig.diamond) || 0;
        var timeDays = Number(cardConfig.time) || 30;
        var buyAwardID1 = Number(cardConfig.buyAwardID1) || 0;
        var buyNum1 = Number(cardConfig.buyNum1) || 0;
        var buyAwardID2 = Number(cardConfig.buyAwardID2) || 0;
        var buyNum2 = Number(cardConfig.buyNum2) || 0;

        log.details('CARD_CONFIG', [
            ['cardType', String(cardType)],
            ['id', String(cardConfig.id)],
            ['USD', '$' + priceUSD],
            ['diamond', String(diamondBonus)],
            ['time', timeDays + ' days'],
            ['buyAward1', buyAwardID1 + ' x' + buyNum1],
            ['buyAward2', buyAwardID2 + ' x' + buyNum2]
        ]);

        // ── LOAD USER DATA ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.error('HANDLER', 'monthCard/buyCard — user data not found: ' + storageKey);
            callback({ prePayRet: { errorCode: 1, errorMsg: 'user_not_found' } });
            return;
        }

        // ── CHECK IF CARD ALREADY ACTIVE ──
        if (savedData.monthCard && savedData.monthCard._card) {
            var existingCard = savedData.monthCard._card[String(cardType)];
            if (existingCard && existingCard._endTime) {
                var now = Date.now();
                if (existingCard._endTime > now) {
                    log.warn('HANDLER', 'monthCard/buyCard — card ' + cardType + ' already active, endTime=' + existingCard._endTime);
                    callback({ prePayRet: { errorCode: 1, errorMsg: 'card_already_active' } });
                    return;
                }
            }
        }

        // ── INITIALIZE DATA STRUCTURES ──
        if (!savedData.monthCard) savedData.monthCard = { _id: '', _card: {} };
        if (!savedData.monthCard._card) savedData.monthCard._card = {};

        // ══════════════════════════════════════════════════════════
        //  PROCESS BUY REWARDS
        // ============================================================
        var changeItems = {};   // _changeInfo._items — OBJECT keyed by STRING itemId
        var addHeroes = {};     // _addHeroes — OBJECT keyed by STRING heroKey

        // 1. Diamond bonus from config "diamond" field
        if (diamondBonus > 0) {
            var newDiamondBal = addItems(savedData, ITEM_IDS.DIAMONDID, diamondBonus);
            changeItems[String(ITEM_IDS.DIAMONDID)] = { _id: ITEM_IDS.DIAMONDID, _num: newDiamondBal };
            log.info('REWARD', 'Diamond bonus: +' + diamondBonus + ' → total=' + newDiamondBal);
        }

        // Load thingsID for hero detection
        var thingsID = loadJson('thingsID');

        // 2. buyAwardID1 / buyNum1
        if (buyAwardID1 > 0 && buyNum1 > 0) {
            var ti1 = thingsID && thingsID[String(buyAwardID1)];
            if (ti1 && ti1.thingsType === 'hero') {
                // ── HERO REWARD — FULL DATA REQUIRED ──
                if (!savedData.heros) savedData.heros = { _heros: {} };
                if (!savedData.heros._heros) savedData.heros._heros = {};

                var heroInstanceId = generateHeroInstanceId(savedData);
                var heroData = buildHeroData(buyAwardID1, heroInstanceId);

                if (heroData) {
                    // Find next key for _heros collection (max existing numeric key + 1)
                    var herosMap = savedData.heros._heros;
                    var maxKey = -1;
                    for (var hk in herosMap) {
                        if (herosMap.hasOwnProperty(hk)) {
                            var nkh = Number(hk);
                            if (nkh > maxKey) maxKey = nkh;
                        }
                    }
                    var heroKey = String(maxKey + 1);

                    savedData.heros._heros[heroKey] = heroData;
                    addHeroes[heroKey] = heroData;

                    log.info('REWARD', 'Hero added: displayId=' + buyAwardID1 +
                        ' instanceId=' + heroInstanceId + ' key=' + heroKey +
                        ' quality=' + (ti1.quality || '?'));
                } else {
                    log.error('REWARD', 'Failed to build hero data for displayId=' + buyAwardID1);
                }
            } else {
                // ── REGULAR ITEM REWARD ──
                var newBal1 = addItems(savedData, buyAwardID1, buyNum1);
                changeItems[String(buyAwardID1)] = { _id: buyAwardID1, _num: newBal1 };
                log.info('REWARD', 'Item: ' + buyAwardID1 + ' +' + buyNum1 + ' → total=' + newBal1);
            }
        }

        // 3. buyAwardID2 / buyNum2 (if exists)
        if (buyAwardID2 > 0 && buyNum2 > 0) {
            var ti2 = thingsID && thingsID[String(buyAwardID2)];
            if (ti2 && ti2.thingsType === 'hero') {
                // Hero reward (unlikely for award2, but handle it)
                if (!savedData.heros) savedData.heros = { _heros: {} };
                if (!savedData.heros._heros) savedData.heros._heros = {};

                var heroInstanceId2 = generateHeroInstanceId(savedData);
                var heroData2 = buildHeroData(buyAwardID2, heroInstanceId2);

                if (heroData2) {
                    var herosMap2 = savedData.heros._heros;
                    var maxKey2 = -1;
                    for (var hk2 in herosMap2) {
                        if (herosMap2.hasOwnProperty(hk2)) {
                            var nkh2 = Number(hk2);
                            if (nkh2 > maxKey2) maxKey2 = nkh2;
                        }
                    }
                    var heroKey2 = String(maxKey2 + 1);

                    savedData.heros._heros[heroKey2] = heroData2;
                    addHeroes[heroKey2] = heroData2;

                    log.info('REWARD', 'Hero (award2): displayId=' + buyAwardID2 +
                        ' instanceId=' + heroInstanceId2 + ' key=' + heroKey2);
                }
            } else {
                var newBal2 = addItems(savedData, buyAwardID2, buyNum2);
                changeItems[String(buyAwardID2)] = { _id: buyAwardID2, _num: newBal2 };
                log.info('REWARD', 'Item (award2): ' + buyAwardID2 + ' +' + buyNum2 + ' → total=' + newBal2);
            }
        }

        // ══════════════════════════════════════════════════════════
        //  VIP EXP & LEVEL
        // ============================================================
        var vipExpGain = Math.floor(priceUSD * 10);
        var oldVipExpAll = getItemBalance(savedData, ITEM_IDS.PLAYERVIPEXPALLID);
        var newVipExpAll = oldVipExpAll + vipExpGain;
        setItemBalance(savedData, ITEM_IDS.PLAYERVIPEXPALLID, newVipExpAll);

        var vipTable = getVipUpgradeTable();
        var oldVipLevel = getItemBalance(savedData, ITEM_IDS.PLAYERVIPLEVELID);
        var newVipLevel = calculateVipLevel(newVipExpAll, vipTable);
        setItemBalance(savedData, ITEM_IDS.PLAYERVIPLEVELID, newVipLevel);

        log.info('VIP', 'Exp: ' + oldVipExpAll + ' +' + vipExpGain + ' = ' + newVipExpAll +
            ' | Level: ' + oldVipLevel + ' → ' + newVipLevel +
            (newVipLevel > oldVipLevel ? ' (LEVEL UP!)' : ''));

        // Also include VIP items in changeItems for openCongratulationObtain display
        changeItems[String(ITEM_IDS.PLAYERVIPEXPALLID)] = { _id: ITEM_IDS.PLAYERVIPEXPALLID, _num: newVipExpAll };
        changeItems[String(ITEM_IDS.PLAYERVIPLEVELID)] = { _id: ITEM_IDS.PLAYERVIPLEVELID, _num: newVipLevel };

        // ══════════════════════════════════════════════════════════
        //  CALCULATE END TIME & SAVE CARD
        // ============================================================
        var endTime = Date.now() + (timeDays * 86400000);
        savedData.monthCard._card[String(cardType)] = { _endTime: endTime };

        log.info('CARD', 'Card ' + cardType + ' activated — endTime=' + endTime +
            ' (' + timeDays + ' days)');

        // ══════════════════════════════════════════════════════════
        //  FIRST RECHARGE TRACKING
        // ============================================================
        // payFinish handler (L77108) ALWAYS sets firstRechargeInfo._canGetReward = true
        // For persistence, we also update savedData
        if (savedData.giftInfo && savedData.giftInfo._fristRecharge) {
            if (!savedData.giftInfo._fristRecharge._canGetReward) {
                savedData.giftInfo._fristRecharge._canGetReward = true;
                log.info('RECHARGE', 'First recharge ever — _canGetReward set to true');
            }
        }

        // ══════════════════════════════════════════════════════════
        //  SAVE USER DATA
        // ============================================================
        db._set(storageKey, savedData);
        log.info('DB', 'User data saved');

        // ══════════════════════════════════════════════════════════
        //  SEND payFinish NOTIFY
        // ============================================================
        // Client (L77104-77117):
        //   if (0 == e._code) {
        //     openCongratulationObtain(e._detail)  ← reads _detail._changeInfo._items AND _detail._addHeroes
        //     disposePushNotification(e)           ← MONTH_CARD: sets monthCardInfo._card[goodId]._endTime
        //     refreshNodePayFinish(e)
        //   }
        //
        // disposePushNotification MONTH_CARD (L79585):
        //   var i = t._detail._card, s = new CardItem;
        //   s._endTime = i._endTime;
        //   n.monthCardInfo._card[t._goodId] = s;
        //
        // openCongratulationObtain (L56636-56651):
        //   saveGainWithOutItems(t) → processes _addHeroes via SetHeroDataToModel
        //   t._changeInfo._items → for display in popup
        // ============================================================

        var payFinishDetail = {
            _totalPrice: priceUSD,
            _card: { _endTime: endTime },
            _changeInfo: {
                _items: changeItems
            }
        };

        // Add heroes if any
        if (Object.keys(addHeroes).length > 0) {
            payFinishDetail._addHeroes = addHeroes;
        }

        var payFinishPayload = {
            action: 'payFinish',
            _code: 0,
            _goodType: GOOD_TYPE_MONTH_CARD,
            _goodId: cardType,
            _detail: payFinishDetail
        };

        MainServer.log.notify('payFinish', payFinishPayload);
        log.info('NOTIFY', 'payFinish sent — _code=0, _goodType=' + GOOD_TYPE_MONTH_CARD +
            ', _goodId=' + cardType + ', _totalPrice=$' + priceUSD +
            ', heroes=' + Object.keys(addHeroes).length +
            ', items=' + Object.keys(changeItems).length);

        // ══════════════════════════════════════════════════════════
        //  SEND monthCard BROADCAST NOTIFY
        // ============================================================
        // Client (L77042): action:"monthCard" → addMonthCardLogInfo(e)
        // Expects: {_cardId, _userName}
        // setMonthCardLog reads noticeContent.json for broadcast message
        // ============================================================

        var monthCardNotifyPayload = {
            action: 'monthCard',
            _cardId: cardType,
            _userName: savedData.user ? (savedData.user._nickName || '') : ''
        };

        MainServer.log.notify('monthCard', monthCardNotifyPayload);
        log.info('NOTIFY', 'monthCard broadcast sent — cardType=' + cardType);

        // ══════════════════════════════════════════════════════════
        //  SEND vipLevel NOTIFY (if VIP level changed)
        // ============================================================
        // Client (L77043): action:"vipLevel" → addVipLogInfo(e)
        // Expects: {_displayId, _userName}
        // ============================================================

        if (newVipLevel > oldVipLevel) {
            var vipLevelPayload = {
                action: 'vipLevel',
                _displayId: newVipLevel,
                _userName: savedData.user ? (savedData.user._nickName || '') : ''
            };

            MainServer.log.notify('vipLevel', vipLevelPayload);
            log.info('NOTIFY', 'vipLevel sent — ' + oldVipLevel + ' → ' + newVipLevel);
        }

        // ══════════════════════════════════════════════════════════
        //  BUILD prePayRet RESPONSE
        // ============================================================
        // Client (L155802-155803):
        //   e.prePayRet && 0 === e.prePayRet.errorCode ? ts.payToSdk(e.prePayRet.data) : ...
        //
        // payToSdk (L77138-77139):
        //   TSBrowser.executeFunction("paySdk", e)
        //   In mock: no SDK → fails silently, but payFinish already delivered goods
        // ============================================================

        var prePayData = {
            orderId: 'mc_' + userId + '_' + cardType + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10),
            cardType: cardType,
            price: priceUSD,
            currency: 'USD',
            roleId: String(userId),
            roleName: savedData.user ? (savedData.user._nickName || '') : '',
            roleLevel: getItemBalance(savedData, ITEM_IDS.PLAYERLEVELID) || 1,
            roleVip: newVipLevel,
            serverName: 'Local 1',
            productName: 'monthCard_name_' + cardType,
            productId: 'monthcard_' + cardType
        };

        var response = {
            prePayRet: {
                errorCode: 0,
                data: prePayData
            }
        };

        log.info('HANDLER', 'monthCard/buyCard — SUCCESS');
        log.details('prePayRet', [
            ['errorCode', '0'],
            ['orderId', prePayData.orderId],
            ['cardType', String(cardType)],
            ['price', '$' + priceUSD],
            ['endTime', String(endTime)],
            ['diamondBonus', String(diamondBonus)],
            ['heroes', String(Object.keys(addHeroes).length)],
            ['items', String(Object.keys(changeItems).length)],
            ['vipLevel', String(newVipLevel)],
            ['vipExp', String(newVipExpAll)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('monthCard', 'buyCard', handleBuyCard);

    window.MainServer = MainServer;
})();