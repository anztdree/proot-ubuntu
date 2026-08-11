/**
 * handlers/activity/heroHelpBuy.js — Hero Exchange Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: activity/heroHelpBuy
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Execute hero exchange pada event HERO_HELP (Hero coming for Rescue).
 *   User mengorbankan hero spesifik + diamond → mendapat hero baru.
 *
 *   Config saat ini (dari getActivityDetail.js):
 *     - Item 0: Cost = Shenron (1600) × 1 + 8888 diamond → Reward = Gotenks SS3 (1512)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITE (main.min(unminfy).js L92487-92493)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Dipanggil dari ExchangeHeroActListItem.SureFunc(e, t):
 *     e = itemId (Number — dict key)
 *     t = chosedHeros (Array<string> hero instance IDs)
 *
 *   ts.processHandler({
 *       type: "activity",
 *       action: "heroHelpBuy",
 *       actId: a.heroHelpActivityData.id,    // act.id (string)
 *       userId: <userId>,
 *       itemId: e,                            // Number — dict key
 *       heroIds: t                             // Array<string> chosen hero IDs
 *       // ⚠️ TIDAK ADA version field!
 *   }, function(t) {
 *       a.userHeroHelpActivityData.haveGotReward[e] = !0;     // mark claimed locally
 *       for (var r in t.heroIds)                               // ⚠️ NON-underscore!
 *           HeroCommon.removeHeroBackWithServerData(t.heroIds[r], {}, n, !0);
 *       t._linkHeroes && HerosManager.getInstance().setDecomposeHeroLink(t._linkHeroes);
 *       UIWindowManager.openCongratulationObtain(t);            // baca t._changeInfo, t._addHeroes
 *       o.refreshData();
 *   })
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT (verified L92495-92498 + §9 referensi HERO_HELP)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       heroIds: ["<heroId>", ...],          // ⚠️ NON-underscore! Array string (echo request)
 *       _changeInfo: {                        // ✅ WAJIB (minimal salah satu reward field)
 *           _items: [
 *               { _id: 101, _num: -8888 }      // diamond cost (negative = consumed)
 *           ]
 *       },
 *       _addHeroes: [ <HeroDataModel> ],      // optional — reward hero
 *       _linkHeroes: [...]                     // optional — link partners yang perlu re-compute
 *   })
 *
 *   ⚠️ openCongratulationObtain WAJIB ada minimal 1 reward field
 *      (_changeInfo atau _addHeroes atau _addXxx lain).
 *      Kalau tidak ada, popup diskip silent (L56637).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * GOTCHAS KRITIS (verified dari referensi HERO_HELP §11)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   1. heroIds pakai NON-underscore — satu-satunya field non-underscore
 *   2. _changeInfo._items[] pakai UNDERSCORE (_id, _num)
 *   3. _num negative = consumed, positive = gained
 *   4. itemId di request = Number (dict key di-cast ke Number)
 *   5. heroIds di request = Array<string> (hero instance IDs)
 *   6. Server HARUS persist uact._haveGotReward[String(itemId)] = true
 *   7. TIDAK ada version field di request
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var ACTIVITY_TYPE = {
        HERO_HELP: 3013
    };

    var HERO_HELP_ACT_ID = '3013';
    var ITEM_DIAMOND = 101;

    /**
     * HeroHelpActivityItem config — HARUS match dengan yang di
     * getActivityDetail.js (HERO_HELP_ITEMS array).
     *
     * KEY = rewardHeroId (string) — supaya sinkron dengan rotasi harian.
     * Rotasi di getActivityDetail.js memakai key "0","1","2" sebagai slot,
     * tapi heroHelpBuy menerima itemId dari client yang = slot index.
     * Jadi kita butuh mapping DUA arah:
     *   - Slot "0","1","2" (dari client) → rewardHeroId
     *   - rewardHeroId (dari DB haveGotReward) → cost config
     *
     * Cost untuk semua: Shenron (1600) x 1 + 8888 diamond
     * Reward: hero SSS (superOrange)
     *
     * 42 heroes — limited heroes excluded (1600, 1603, 1619, 1634-1658)
     */
    var HERO_HELP_POOL = {
        '1505': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1512': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1513': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1514': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1515': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1516': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1601': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1602': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1604': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1605': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1606': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1607': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1608': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1609': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1610': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1611': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1612': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1613': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1614': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1615': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1616': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1617': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1618': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1620': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1621': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1622': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1623': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1624': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1625': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1626': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1627': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1628': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1629': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1630': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1631': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1632': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1633': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1640': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1641': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1642': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1643': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1644': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 },
        '1645': { costHero: 1, costDiamond: 8888, displayId: 1600, heroClass: 0, heroQuality: 0 }
    };

    /**
     * Rotasi config — HARUS match getActivityDetail.js
     */
    var HERO_RESCUE_ROTATION_PER_DAY = 3;
    var HERO_RESCUE_WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

    /**
     * Pool array — same order as getActivityDetail.js HERO_HELP_ITEMS.
     * Index 0-41, 42 heroes total.
     */
    var HERO_HELP_POOL_ARRAY = [
        1505, 1512, 1513, 1514, 1515, 1516,
        1601, 1602, 1604, 1605, 1606, 1607,
        1608, 1609, 1610, 1611, 1612, 1613,
        1614, 1615, 1616, 1617, 1618, 1620,
        1621, 1622, 1623, 1624, 1625, 1626,
        1627, 1628, 1629, 1630, 1631, 1632,
        1633, 1640, 1641, 1642, 1643, 1644,
        1645
    ];

    /**
     * Get today's 3 hero IDs (same logic as getActivityDetail.js).
     * Returns array of 3 hero IDs.
     */
    function getTodayRotationHeroIds() {
        var now = Date.now();
        var wibMs = now + HERO_RESCUE_WIB_OFFSET_MS;
        var dayIndex = Math.floor(wibMs / (24 * 60 * 60 * 1000));
        var poolLen = HERO_HELP_POOL_ARRAY.length;
        var startIndex = (dayIndex * HERO_RESCUE_ROTATION_PER_DAY) % poolLen;
        var result = [];
        for (var i = 0; i < HERO_RESCUE_ROTATION_PER_DAY; i++) {
            result.push(HERO_HELP_POOL_ARRAY[(startIndex + i) % poolLen]);
        }
        return result;
    }

    /**
     * Resolve itemId (slot index 0/1/2 dari client) → rewardHeroId.
     */
    function resolveItemIdToHeroId(itemId) {
        var todayHeroes = getTodayRotationHeroIds();
        var idx = Number(itemId);
        if (idx >= 0 && idx < todayHeroes.length) {
            return todayHeroes[idx];
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  STORAGE & ITEM BALANCE HELPERS (pattern dari summonOne.js)
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    function activityUserKey(userId, actType) {
        return 'ms_userAct_' + userId + '_' + actType;
    }

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
    //  CONFIG LOADER (sync, cached) — pattern dari summonOne.js
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
            log.error('RESOURCE', 'heroHelpBuy failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'heroHelpBuy failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJsonSync('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getHeroLevelAttr(level) {
        var la = loadJsonSync('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    function getHeroQualityParam(quality) {
        var qp = loadJsonSync('heroQualityParam');
        return qp ? qp[String(quality)] : null;
    }

    function getHeroTypeParam(heroType) {
        var tp = loadJsonSync('heroTypeParam');
        return tp ? tp[String(heroType)] : null;
    }

    function getHeroEvolve(heroDisplayId) {
        var ev = loadJsonSync('heroEvolve');
        if (!ev) return [];
        var result = [];
        for (var k in ev) {
            if (!ev.hasOwnProperty(k)) continue;
            if (Number(ev[k].heroId) === Number(heroDisplayId)) {
                result.push(ev[k]);
            }
        }
        return result;
    }

    function getHeroWakeUp(heroDisplayId) {
        var wu = loadJsonSync('heroWakeUp');
        if (!wu) return [];
        var result = [];
        for (var k in wu) {
            if (!wu.hasOwnProperty(k)) continue;
            if (Number(wu[k].heroId) === Number(heroDisplayId)) {
                result.push(wu[k]);
            }
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO BASE ATTR BUILDER — pattern dari summonOne.js / normalLuck.js
    // ═══════════════════════════════════════════════════════════

    function makeHeroBasicAttr(heroDisplayId, level, starLevel, evolveLevel) {
        level = level || 1;
        starLevel = starLevel || 0;
        evolveLevel = evolveLevel || 0;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('HERO_HELP', 'Hero config not found: ' + heroDisplayId);
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

        // Flat stats dari hero config
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

    // ═══════════════════════════════════════════════════════════
    //  BUILD HERO DATA — pattern dari summonOne.js / normalLuck.js
    // ═══════════════════════════════════════════════════════════

    function buildSummonHeroData(heroDisplayId, heroInstanceId) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('HERO_HELP', 'Cannot build hero data — config not found: ' + heroDisplayId);
            return null;
        }

        var heroTag = hc.tag ? hc.tag.split(',') : [];
        var baseAttr = makeHeroBasicAttr(heroDisplayId, 1, 0, 0);

        if (!baseAttr) {
            log.error('HERO_HELP', 'Cannot build hero data — base attr failed: ' + heroDisplayId);
            return null;
        }

        var heroData = {
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

        log.details('HERO_HELP', [
            ['buildHeroData', 'displayId=' + heroDisplayId + ' instanceId=' + heroInstanceId],
            ['quality', hc.quality || '-'],
            ['heroType', hc.heroType || '-'],
            ['talent', String(hc.talent || 0)]
        ]);

        return heroData;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO INSTANCE ID GENERATION — pattern dari summonOne.js
    // ═══════════════════════════════════════════════════════════

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

    function addHeroToCollection(savedData, heroData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        var heros = savedData.heros._heros;
        var maxKey = -1;
        for (var k in heros) {
            if (heros.hasOwnProperty(k)) { var nk = Number(k); if (nk > maxKey) maxKey = nk; }
        }
        var heroKey = String(maxKey + 1);
        savedData.heros._heros[heroKey] = heroData;

        log.details('HERO_HELP', ['heroAdded', 'key=' + heroKey + ' displayId=' + heroData._heroDisplayId]);

        return heroKey;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO COST VALIDATION & REMOVAL
    // ═══════════════════════════════════════════════════════════
    //
    //  Client filter (ActivityExChangeTipViewData.getChoseHeroList L103061-103081):
    //    - Hero must NOT be in expedition (expeditionMaxLevel == 0)
    //    - Hero must be 0-star (heroStar == 0)
    //    - Hero must be level 1 (heroBaseAttr.level == 1)
    //    - If displayId truthy: heroDisplayId must match
    //    - Else: heroQuality + heroClass must match
    //
    //  Server harus validate hal yang sama sebelum remove.
    //

    function findHeroInCollection(savedData, heroInstanceId) {
        if (!savedData.heros || !savedData.heros._heros) return null;
        var heros = savedData.heros._heros;
        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;
            if (String(heros[key]._heroId) === String(heroInstanceId)) {
                return { key: key, hero: heros[key] };
            }
        }
        return null;
    }

    function validateCostHero(heroData, itemConfig) {
        if (!heroData) return false;

        // Check displayId (specific hero mode)
        if (itemConfig.displayId) {
            if (Number(heroData._heroDisplayId) !== Number(itemConfig.displayId)) {
                log.warn('HERO_HELP', 'Hero displayId mismatch: expected=' + itemConfig.displayId
                    + ' got=' + heroData._heroDisplayId);
                return false;
            }
        } else {
            // class+quality mode (displayId=0)
            // Client L103078-103080: if(s.heroQuality != n) continue;
            //   n = aimHeroQuality (from itemConfig.heroQuality)
            //   s.heroQuality = HeroCommon.colorToHeroColor(hero.json[displayId].quality)
            //
            // HERO_COLOR enum (L44620-44630):
            //   White=1, Green=2, Blue=3, Purple=4, Orange=5, SilverOrange=6, SuperOrange=7
            //
            // So heroQuality=5 means S (orange) quality heroes only.
            var hc = getHeroConfig(heroData._heroDisplayId);
            if (!hc) {
                log.warn('HERO_HELP', 'Hero config not found for displayId=' + heroData._heroDisplayId);
                return false;
            }

            // Convert hero.json quality string → numeric (matches HeroCommon.colorToHeroColor L53530-53554)
            var QUALITY_MAP = {
                'white': 1, 'green': 2, 'blue': 3, 'purple': 4,
                'orange': 5, 'flickerOrange': 6, 'superOrange': 7
            };
            var heroQualityNum = QUALITY_MAP[hc.quality] || 0;

            // Check quality match (if itemConfig.heroQuality is set)
            if (itemConfig.heroQuality && heroQualityNum !== Number(itemConfig.heroQuality)) {
                log.warn('HERO_HELP', 'Hero quality mismatch: expected=' + itemConfig.heroQuality
                    + ' got=' + heroQualityNum + ' (' + hc.quality + ')'
                    + ' for displayId=' + heroData._heroDisplayId);
                return false;
            }

            // Check class match (if itemConfig.heroClass is set and not CLASS_NULL=0)
            if (itemConfig.heroClass && Number(itemConfig.heroClass) !== 0) {
                // heroType from hero.json (string like 'critical', 'body', etc.)
                // Client converts to HERO_CLASS enum — skip server-side check for simplicity
                // Client already filters via getChoseHeroList before sending
            }
        }

        // Check fresh hero (0-star, level 1, not in expedition)
        var star = Number(heroData._heroStar) || 0;
        var expeditionMax = Number(heroData._expeditionMaxLevel) || 0;
        var level = 0;
        if (heroData._heroBaseAttr && heroData._heroBaseAttr._level) {
            level = Number(heroData._heroBaseAttr._level) || 0;
        }

        if (expeditionMax > 0) {
            log.warn('HERO_HELP', 'Hero in expedition: ' + heroData._heroId);
            return false;
        }
        if (star !== 0) {
            log.warn('HERO_HELP', 'Hero not 0-star: ' + heroData._heroId + ' star=' + star);
            return false;
        }
        if (level !== 1) {
            log.warn('HERO_HELP', 'Hero not level 1: ' + heroData._heroId + ' level=' + level);
            return false;
        }

        return true;
    }

    function removeHeroFromCollection(savedData, heroInstanceId) {
        if (!savedData.heros || !savedData.heros._heros) return false;
        var heros = savedData.heros._heros;
        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;
            if (String(heros[key]._heroId) === String(heroInstanceId)) {
                delete heros[key];
                log.details('HERO_HELP', ['heroRemoved', 'key=' + key + ' instanceId=' + heroInstanceId]);
                return true;
            }
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  UACT STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    function loadUact(userId) {
        var key = activityUserKey(userId, ACTIVITY_TYPE.HERO_HELP);
        var uact = db._get(key);
        if (!uact) {
            uact = {
                _haveGotReward: {},
                _startTime: 0,
                _endTime: 0,
                _activityId: HERO_HELP_ACT_ID,
                _loopTag: ''
            };
            db._set(key, uact);
        }
        if (!uact._haveGotReward) uact._haveGotReward = {};
        return uact;
    }

    function saveUact(userId, uact) {
        var key = activityUserKey(userId, ACTIVITY_TYPE.HERO_HELP);
        db._set(key, uact);
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleHeroHelpBuy(request, callback) {
        var userId = request && request.userId;
        var actId = request && request.actId;
        var itemId = Number(request && request.itemId);
        var heroIds = request && request.heroIds;

        log.info('HERO_HELP', 'activity/heroHelpBuy START — userId=' + (userId || '-')
            + ', actId=' + (actId || '-')
            + ', itemId=' + itemId
            + ', heroIds=' + (heroIds ? heroIds.length + ' heroes' : '-'));

        try {
            // ── VALIDATE userId ──
            if (!userId) {
                log.warn('HERO_HELP', 'heroHelpBuy — missing userId');
                callback({}, 1);
                return;
            }

            // ── VALIDATE actId ──
            if (String(actId) !== HERO_HELP_ACT_ID) {
                log.warn('HERO_HELP', 'heroHelpBuy — invalid actId: ' + actId
                    + ' (expected: ' + HERO_HELP_ACT_ID + ')');
                callback({}, 1);
                return;
            }

            // ── VALIDATE itemId → resolve ke heroId via rotasi ──
            var itemKey = String(itemId);
            var rewardHeroId = resolveItemIdToHeroId(itemId);
            if (!rewardHeroId) {
                log.warn('HERO_HELP', 'heroHelpBuy — invalid itemId: ' + itemId
                    + ' (not in today\'s rotation)');
                callback({}, 1);
                return;
            }
            var itemConfig = HERO_HELP_POOL[String(rewardHeroId)];
            if (!itemConfig) {
                log.warn('HERO_HELP', 'heroHelpBuy — heroId not in pool: ' + rewardHeroId);
                callback({}, 1);
                return;
            }

            // ── VALIDATE heroIds ──
            if (!heroIds || !Array.isArray(heroIds) || heroIds.length === 0) {
                log.warn('HERO_HELP', 'heroHelpBuy — missing or empty heroIds');
                callback({}, 1);
                return;
            }

            if (heroIds.length !== itemConfig.costHero) {
                log.warn('HERO_HELP', 'heroHelpBuy — heroIds count mismatch: expected='
                    + itemConfig.costHero + ' got=' + heroIds.length);
                callback({}, 1);
                return;
            }

            // ── Load user data ──
            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) {
                log.warn('HERO_HELP', 'heroHelpBuy — user data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // ── Load uact ──
            var uact = loadUact(userId);

            // ── CEK sudah claim (per slot index, persisten) ──
            // Client pakai haveGotReward[itemId] dimana itemId = slot index ("0","1","2")
            if (uact._haveGotReward[itemKey]) {
                log.warn('HERO_HELP', 'heroHelpBuy — already claimed: itemId=' + itemKey);
                callback({}, 1);
                return;
            }

            // ── Validate cost heroes ──
            var costHeroEntries = [];
            for (var i = 0; i < heroIds.length; i++) {
                var entry = findHeroInCollection(savedData, heroIds[i]);
                if (!entry) {
                    log.warn('HERO_HELP', 'heroHelpBuy — hero not found in collection: ' + heroIds[i]);
                    callback({}, 1);
                    return;
                }
                if (!validateCostHero(entry.hero, itemConfig)) {
                    log.warn('HERO_HELP', 'heroHelpBuy — hero validation failed: ' + heroIds[i]);
                    callback({}, 1);
                    return;
                }
                costHeroEntries.push(entry);
            }

            // ── Validate diamond balance ──
            var currentDiamond = getItemBalance(savedData, ITEM_DIAMOND);
            if (currentDiamond < itemConfig.costDiamond) {
                log.warn('HERO_HELP', 'heroHelpBuy — not enough diamonds: need='
                    + itemConfig.costDiamond + ' have=' + currentDiamond);
                callback({}, 1);
                return;
            }

            log.details('HERO_HELP', [
                ['validation', 'PASSED'],
                ['cost.heroes', heroIds.length + ' × displayId=' + itemConfig.displayId],
                ['cost.diamond', itemConfig.costDiamond + ' (balance=' + currentDiamond + ')'],
                ['reward.heroId', rewardHeroId]
            ]);

            // ════════════════════════════════════════════════════════
            //  PROCESS EXCHANGE
            // ════════════════════════════════════════════════════════

            // 1. Remove cost heroes from collection
            for (var j = 0; j < costHeroEntries.length; j++) {
                var ce = costHeroEntries[j];
                delete savedData.heros._heros[ce.key];
                log.details('HERO_HELP', ['removeCostHero', 'key=' + ce.key + ' instanceId=' + ce.hero._heroId]);
            }

            // 2. Deduct diamonds
            var newDiamondBalance = currentDiamond - itemConfig.costDiamond;
            setItemBalance(savedData, ITEM_DIAMOND, newDiamondBalance);

            // 3. Generate reward hero instance
            var rewardHeroInstanceId = generateHeroInstanceId(savedData);
            var rewardHeroData = buildSummonHeroData(rewardHeroId, rewardHeroInstanceId);

            if (!rewardHeroData) {
                log.error('HERO_HELP', 'heroHelpBuy — failed to build reward hero data for displayId=' + rewardHeroId);
                // Refund: restore diamonds
                setItemBalance(savedData, ITEM_DIAMOND, currentDiamond);
                callback({}, 1);
                return;
            }

            // 4. Add reward hero to collection
            addHeroToCollection(savedData, rewardHeroData);

            // 5. Mark item as claimed (per slot index)
            uact._haveGotReward[itemKey] = true;

            // 6. Persist user data + uact
            db._set(storageKey, savedData);
            saveUact(userId, uact);

            // ════════════════════════════════════════════════════════
            //  BUILD RESPONSE
            // ════════════════════════════════════════════════════════

            // heroIds: NON-underscore! Echo dari request (consumed hero IDs)
            var responseHeroIds = heroIds.slice();  // copy array

            // _changeInfo: diamond cost (absolute balance after deduction)
            var changeItems = {};
            changeItems[String(ITEM_DIAMOND)] = {
                _id: ITEM_DIAMOND,
                _num: newDiamondBalance   // ABSOLUTE balance (SET, not delta)
            };

            var response = {
                heroIds: responseHeroIds,           // ⚠️ NON-underscore!
                _changeInfo: {
                    _items: changeItems
                },
                _addHeroes: [rewardHeroData]        // reward hero (1 Shenron for special, 1 SSS for default)
                // _linkHeroes: []                  // optional (trial: skip — no link system)
            };

            log.info('HERO_HELP', 'activity/heroHelpBuy SUCCESS — '
                + 'item=' + itemKey
                + ', consumed=' + heroIds.length + ' heroes'
                + ', diamond=' + currentDiamond + '→' + newDiamondBalance
                + ', reward=hero displayId=' + rewardHeroId
                + ' instanceId=' + rewardHeroInstanceId);
            log.details('response', [
                ['userId', userId],
                ['actId', actId],
                ['itemId', String(itemId)],
                ['heroIds (NON-underscore)', responseHeroIds.length + ' entries'],
                ['_changeInfo._items.101._num', String(newDiamondBalance) + ' (absolute balance)'],
                ['_addHeroes[0]._heroId', String(rewardHeroInstanceId)],
                ['_addHeroes[0]._heroDisplayId', String(rewardHeroId)],
                ['uact._haveGotReward["' + itemKey + '"]', 'true']
            ]);

            // ── CALLBACK ──
            callback(response);

        } catch (err) {
            log.error('HERO_HELP', 'activity/heroHelpBuy UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('activity', 'heroHelpBuy', handleHeroHelpBuy);
})();
