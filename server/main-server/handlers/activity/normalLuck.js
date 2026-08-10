/**
 * handlers/activity/normalLuck.js — NormalLuck Summon Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: activity/normalLuck
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TUGAS UTAMA:
 *   Execute summon pada NormalLuck pool (Theme Card Pool). Deduct cost,
 *   roll hero dari pool (act._randHero), add hero ke collection, return
 *   result. Buka SummonOneSuccess / SummonTenSuccess window di client.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT CALL SITES (main.min(unminfy).js):
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [L61903-61913] SummononSingleton.normalLuckOnceBtnClick (×1):
 *     ts.processHandler({
 *         type: "activity", action: "normalLuck",
 *         actId: e,                          // dari act._id = "3001"
 *         userId: <userId>,
 *         times: 1,
 *         costType: l,                       // 0=COSTLUCKICON (item 521),
 *                                            // 1=COSTDIAMOND (diamond 101)
 *         version: "1.0"
 *     }, function(n) {
 *         n.actId = e;                        // client set manual
 *         a.callBackCheckStartEffect(n, true, true, t, o);
 *     })
 *
 *   [L61925-61935] normalLuckTenBtnClick (×10):
 *     Sama, times: 10.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CLIENT RESPONSE PROCESSING (requestCallBackCheck L61747-61767)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   1. resetTtemsCallBack(e) → apply _changeInfo._items (ABSOLUTE balance)
 *   2. s = e._addTotal || e._addHeroes → array hero hasil summon
 *   3. l = e._energy → updated summon energy
 *   4. e._canFreeTime → free summon timer (optional, NormalLuck no free)
 *   5. Per hero di _addTotal:
 *        - SetHeroDataToModel(s[p], true) → save to HerosManager
 *        - checkHeroAlreadyGain → track new hero list
 *   6. requestCallBack(s, l, ...) → update SummonSingleton state
 *   7. Load dragon bones effect "baokai" (summon animation)
 *   8. loadHeroPicture(I, T) → preload hero images:
 *        - heroIconLong untuk semua hero
 *        - heroPicture untuk hero quality >= Orange
 *   9. Open window SummonOneSuccess / SummonTenSuccess
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESPONSE FORMAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   callback({
 *       _addTotal: [ <heroData>, ... ],     // Hero array (1-10 entries, empty if only pieces)
 *       _addPieces: [ <pieceData>, ... ],   // Piece/fragment array (NEW! for heroPiece.json items)
 *       _changeInfo: {
 *           _items: {
 *               "<itemId>": { _id, _num: <ABSOLUTE> }   // cost + piece balances
 *           }
 *       },
 *       _energy: <number>,                   // updated energy (+10 per summon)
 *       _canFreeTime: 0                      // NormalLuck no free summon
 *   })
 *
 *   pieceData format (untuk _addPieces):
 *     {
 *         _itemId: <number>,        // piece ID (e.g., 2600 = Shenron Shard)
 *         _num: <number>,           // quantity obtained
 *         _pieceName: <string>,     // piece name from heroPiece.json
 *         _quality: <string>,       // quality tier
 *         _belongTo: <number>       // corresponding hero ID
 *     }
 *
 *   Client set manual: n.actId = e (dari request, BUKAN dari response)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * COST SYSTEM (constant.json[1])
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   luckyPoolCostID = 521                  // currency item untuk lucky pool
 *
 *   NormalLuck ×1:
 *     costType=0 (COSTLUCKICON)  → item 521 × 1   (luckyPoolNormalCostNum1)
 *     costType=1 (COSTDIAMOND)   → diamond 101 × 220 (luckyPoolNormalCostDiamondNum1)
 *
 *   NormalLuck ×10:
 *     costType=0 (COSTLUCKICON)  → item 521 × 10  (luckyPoolNormalCostNum2)
 *     costType=1 (COSTDIAMOND)   → diamond 101 × 2200 (luckyPoolNormalCostDiamondNum2)
 *
 *   Client cek balance SEBELUM call server (L61895-61902):
 *     - Kalau item 521 cukup → costType=0
 *     - Kalau item 521 kurang, cek diamond 101 → costType=1
 *     - Kalau dua-duanya kurang → openMoneyNotEnough, BATAL call
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HERO POOL (act._randHero dari getActivityDetail)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Pool dikirim ke client via act._randHero di getActivityDetail response.
 *   Server HARUS hardcode pool yang sama di handler ini (karena tidak bisa
 *   akses client-side state).
 *
 *   Pool (verified dari draft/activity/getActivityDetail.js):
 *     Group "1" (totalWeight 1000):
 *       - 1600 (superOrange, Shenron)   weight 500  ← featured utama (dragon)
 *       - 1318 (orange)                 weight 150
 *       - 1301 (purple)                 weight 150
 *       - 1201 (blue)                   weight 100
 *       - 1102 (green)                  weight 50
 *       - 1001 (white)                  weight 50
 *
 *   ⚠️ Karena pool berisi dragon (hero 1600 = dragonSoulID), pakai kolom
 *      randomSubjectDragon di summonRandom.json untuk quality roll.
 *      (Client L95815: checkHeroIsDragon → switch randomSubject → randomSubjectDragon)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUALITY ROLL (summonRandom.json kolom randomSubjectDragon)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Rate per quality (dari summonRandom.json, kolom randomSubjectDragon):
 *     superOrange       = 0.01
 *     flickerOrange     = 0
 *     orange            = 0.08
 *     purple            = 0.3
 *     blue              = 0.57
 *     superOrangePiece  = 0.04   ← skip (piece, bukan hero)
 *     orangePiece       = 0      ← skip
 *
 *   Hero-only rates (setelah skip piece):
 *     superOrange = 0.01
 *     orange      = 0.08
 *     purple      = 0.3
 *     blue        = 0.57
 *     Total = 0.96
 *
 *   Normalized (agar total = 1.0):
 *     superOrange = 0.01 / 0.96 = 0.0104
 *     orange      = 0.08 / 0.96 = 0.0833
 *     purple      = 0.3  / 0.96 = 0.3125
 *     blue        = 0.57 / 0.96 = 0.5938
 *
 *   ⚠️ Pool tidak punya hero green/white, jadi kalau roll dapat green/white
 *      → fallback ke purple (atau hero terdekat yang ada di pool).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HERO DATA FORMAT (dari SetHeroDataToModel L85391)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Per hero di _addTotal:
 *     _heroId              — string, instance ID unik
 *     _heroDisplayId       — number, hero template ID (untuk load gambar)
 *     _heroStar            — number, default 0 untuk hero baru
 *     _expeditionMaxLevel  — number, default 0
 *     _heroTag             — array string
 *     _fragment            — number, default 0
 *     _superSkillResetCount — number, default 0
 *     _potentialResetCount — number, default 0
 *     _heroBaseAttr        — object { _items: [...] } (stats)
 *     _heroQuality         — number (untuk load gambar, BattleLogic.HERO_COLOR enum)
 *
 *   BattleLogic.HERO_COLOR (dari main.min.js L53636):
 *     White=1, Green=2, Blue=3, Purple=4, Orange=5, SilverOrange=6, SuperOrange=7
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ENERGY SYSTEM
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   NormalLuck TIDAK ada di summon.json (cuma 4 entry: summonSuper,
 *   summonSuperDiamond, summonNormal, summonFriend). Berarti NormalLuck
 *   TIDAK increase summon energy.
 *
 *   Response _energy = current energy (unchanged).
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

    /** LUCKPOOLCOSTTYPE enum (main.min.js L80316-80319) */
    var LUCKPOOLCOSTTYPE = {
        COSTLUCKICON: 0,   // pakai item 521
        COSTDIAMOND:  1    // pakai diamond 101
    };

    /** Item IDs */
    var ITEM_LUCKY_POOL_COIN = 521;   // constant.json[1].luckyPoolCostID
    var ITEM_DIAMOND = 101;           // DIAMONDID

    /** Cost per summon (constant.json[1]) */
    var COST_NUM_1 = 1;          // luckyPoolNormalCostNum1 (item 521 × 1)
    var COST_NUM_10 = 10;        // luckyPoolNormalCostNum2 (item 521 × 10)
    var COST_DIAMOND_1 = 220;    // luckyPoolNormalCostDiamondNum1 (diamond × 220)
    var COST_DIAMOND_10 = 2200;  // luckyPoolNormalCostDiamondNum2 (diamond × 2200)

    /** BattleLogic.HERO_COLOR enum (main.min.js L53636) */
    var HERO_COLOR = {
        White: 1,
        Green: 2,
        Blue: 3,
        Purple: 4,
        Orange: 5,
        SilverOrange: 6,
        SuperOrange: 7
    };

    /** Map string quality (hero.json) → HERO_COLOR number */
    var QUALITY_TO_COLOR = {
        'white': HERO_COLOR.White,
        'green': HERO_COLOR.Green,
        'blue': HERO_COLOR.Blue,
        'purple': HERO_COLOR.Purple,
        'orange': HERO_COLOR.Orange,
        'flickerOrange': HERO_COLOR.SilverOrange,
        'superOrange': HERO_COLOR.SuperOrange
    };

    /**
     * Hero pool untuk NormalLuck TAB 1 (poolId: 1) — Existing Pool.
     * HARUS match dengan yang dikirim di getActivityDetail.js.
     *
     * totalWeight = 500 + 150 + 150 + 100 + 50 + 50 = 1000
     */
    var NORMAL_LUCK_HERO_POOL = [
        { itemId: 1600, num: 1, weight: 500 },  // Shenron (superOrange)
        { itemId: 1318, num: 1, weight: 150 },  // orange
        { itemId: 1301, num: 1, weight: 150 },  // purple
        { itemId: 1201, num: 1, weight: 100 },  // blue
        { itemId: 1102, num: 1, weight: 50  },  // green
        { itemId: 1001, num: 1, weight: 50  }   // white
    ];

    var NORMAL_LUCK_TOTAL_WEIGHT = 1000;

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * TAB 2 (poolId: 2) — Dragon Ball Summon Return — TIER-BASED PROBABILITY
     * ═══════════════════════════════════════════════════════════════════════
     *
     * BERDASARKAN SCREENSHOT PERSENTASE YANG EXACT:
     *   ┌─────────────────────┬───────────┬────────────────────────────────┐
     *   │ TIER                │ RATE      │ REWARD                        │
     *   ├─────────────────────┼───────────┼────────────────────────────────┤
     *   │ SSS Hero Chance     │ 1.0%      │ Random dari 8 SSS Heroes       │
     *   │ Zarama Shard×5      │ 5%        │ 5× Shenron Shard (ID:2600)    │
     *   │ Zarama Shard×2      │ 12.5%     │ 2× Shenron Shard (ID:2600)    │
     *   │ Zarama Shard×1      │ 19%       │ 1× Shenron Shard (ID:2600)    │
     *   │ A Hero Chance       │ 62.5%     │ Random dari 5 Purple Heroes   │
     *   ├─────────────────────┼───────────┼────────────────────────────────┤
     *   │ TOTAL               │ 100%      │                                │
     *   └─────────────────────┴───────────┴────────────────────────────────┘
     *
     * HERO POOL DARI SCREENSHOT (14 icon di panel "Rewards"):
     *   Row 1 (5 SSS): Gotenks SS3(1512), Vegeta SSG(1609), Golden Frieza(1608),
     *                Whis(1602), Goku SSG(1601)
     *   Row 2 (2 SSS + 3 Purple): Majin Buu(1505), Goku SS3(1514),
     *                       Saiyan Child(1301), Tortoise(1205), Crane School(1309)
     *   Row 3 (2 Purple + Shenron + Shard): Purple(1310), Kami(1305),
     *                                  Shenron(1600), Zarama Shard(2600)
     */

    /** SSS Hero Pool untuk TAB 2 (7 heroes) — Tier "sssHero" rate: 3% TOTAL */
    var TAB2_SSS_HERO_POOL = [
        1512,  // Gotenks SS3
        1609,  // Vegeta SSG (Super Saiyan Red)
        1608,  // Golden Frieza
        1602,  // Whis
        1601,  // Goku SSG (Super Saiyan Red)
        1505,  // Majin Buu Fat
        1514   // Goku SS3
    ];

    /** Shenron Pool untuk TAB 2 — Tier "shenronHero" rate: 5% */
    var TAB2_SHENRON_POOL = [
        1600   // Shenron Dragon
    ];

    /** Purple/A Hero Pool untuk TAB 2 (5 heroes) — Tier "purpleHero" rate: 92% */
    var TAB2_PURPLE_HERO_POOL = [
        1301,  // Saiyan Child (Purple)
        1205,  // Tortoise (Purple)
        1309,  // Crane School (Purple)
        1310,  // Purple Hero (row 3)
        1305   // Kami / Namekian (Purple)
    ];

    /**
     * TIER DEFINITION untuk TAB 2 — HERO ONLY (NO SHARD!)
     *
     * Persentase EXACT sesuai permintaan user:
     *   SSS Hero (7 hero gabungan): 3%
     *   Shenron:                    5%
     *   A/Purple Hero (5 hero):     92%
     *   TOTAL:                      100%
     */
    var TAB2_TIERS = [
        { tierId: 'sssHero',     rate: 0.03, type: 'hero', quality: 'superOrange', pool: TAB2_SSS_HERO_POOL },      // 3% (TOTAL semua 7 SSS)
        { tierId: 'shenronHero', rate: 0.05, type: 'hero', quality: 'superOrange', pool: TAB2_SHENRON_POOL },      // 5% (Shenron)
        { tierId: 'purpleHero',  rate: 0.92, type: 'hero', quality: 'purple', pool: TAB2_PURPLE_HERO_POOL }       // 92% (5 Purple heroes)
    ];

    /** Total rate = 1.0 (100%) */
    var TAB2_TOTAL_RATE = 1.0;

    /**
     * Quality rates dari summonRandom.json kolom randomSubjectDragon.
     * Hero-only (piece di-skip), lalu di-normalize agar total = 1.0.
     *
     * Raw rates (randomSubjectDragon):
     *   superOrange      = 0.01
     *   orange           = 0.08
     *   purple           = 0.3
     *   blue             = 0.57
     *   (superOrangePiece, orangePiece di-skip)
     *
     * Total = 0.96
     * Normalized:
     *   superOrange = 0.01 / 0.96 ≈ 0.0104
     *   orange      = 0.08 / 0.96 ≈ 0.0833
     *   purple      = 0.3  / 0.96 ≈ 0.3125
     *   blue        = 0.57 / 0.96 ≈ 0.5938
     */
    var QUALITY_RATES = [
        { quality: 'superOrange', rate: 0.0104 },
        { quality: 'orange',      rate: 0.0833 },
        { quality: 'purple',      rate: 0.3125 },
        { quality: 'blue',        rate: 0.5938 }
    ];

    // ═══════════════════════════════════════════════════════════
    //  STORAGE & ITEM BALANCE HELPERS (pattern dari summonOne.js)
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
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
            log.error('RESOURCE', 'normalLuck failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'normalLuck failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJsonSync('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    /**
     * Get heroPiece config dari heroPiece.json.
     * Digunakan untuk handle Shenron Shard (ID 2600) dan fragment lainnya
     * yang TIDAK ada di hero.json tapi ada di heroPiece.json.
     *
     * heroPiece.json structure:
     *   { id, name, belongTo (heroId), quality, mergeNum, icon,
     *     thingsType: "heroPiece", soulPrice, price }
     */
    function getHeroPieceConfig(pieceId) {
        var hp = loadJsonSync('heroPiece');
        return hp ? hp[String(pieceId)] : null;
    }

    /**
     * Cek apakah itemId adalah heroPiece (fragment/shard).
     * HeroPiece punya thingsType === "heroPiece" dan TIDAK ada di hero.json.
     */
    function isHeroPiece(itemId) {
        var pieceConfig = getHeroPieceConfig(itemId);
        return pieceConfig && pieceConfig.thingsType === 'heroPiece';
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
    //  HERO BASE ATTR BUILDER — pattern dari summonOne.js
    // ═══════════════════════════════════════════════════════════

    function makeHeroBasicAttr(heroDisplayId, level, starLevel, evolveLevel) {
        level = level || 1;
        starLevel = starLevel || 0;
        evolveLevel = evolveLevel || 0;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('NORMAL_LUCK', 'Hero config not found: ' + heroDisplayId);
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
    //  QUALITY ROLL + HERO PICK
    // ═══════════════════════════════════════════════════════════
    //
    //  2-step random selection:
    //    1. Roll quality tier dari QUALITY_RATES (randomSubjectDragon,
    //       hero-only, normalized)
    //    2. Pick random hero dari NORMAL_LUCK_HERO_POOL yang match quality
    //       (weighted by _weight)
    //
    //  Kalau tidak ada hero yang match quality → fallback ke hero terdekat
    //  (mis. superOrange tidak ada → fallback ke orange, dst).
    //

    function rollQuality() {
        var totalRate = 0;
        for (var i = 0; i < QUALITY_RATES.length; i++) {
            totalRate += QUALITY_RATES[i].rate;
        }

        var roll = Math.random() * totalRate;
        var accumulated = 0;
        var selectedQuality = null;

        for (var q = 0; q < QUALITY_RATES.length; q++) {
            accumulated += QUALITY_RATES[q].rate;
            if (roll < accumulated) {
                selectedQuality = QUALITY_RATES[q].quality;
                break;
            }
        }

        if (!selectedQuality) {
            selectedQuality = QUALITY_RATES[QUALITY_RATES.length - 1].quality;
        }

        log.details('NORMAL_LUCK', [
            ['qualityRoll', 'rate=' + totalRate.toFixed(4) + ' roll=' + roll.toFixed(4)],
            ['selectedQuality', selectedQuality]
        ]);

        return selectedQuality;
    }

    /**
     * Pick random hero dari pool berdasarkan quality.
     * Support TAB 1 (poolId=1) dan TAB 2 (poolId=2).
     *
     * @param {string} targetQuality - Quality yang di-roll (superOrange, orange, dll)
     * @param {number} poolId - 1 = NormalLuck Tab 1, 2 = NormalLuck Tab 2
     * @returns {number} heroId yang terpilih
     */
    function pickHeroFromPool(targetQuality, poolId) {
        // Pilih pool berdasarkan poolId
        var pool = (poolId === 2) ? NORMAL_LUCK_HERO_POOL_TAB2 : NORMAL_LUCK_HERO_POOL;
        
        // Filter pool berdasarkan quality (dari hero.json)
        var matchingEntries = [];
        var totalWeight = 0;

        for (var i = 0; i < pool.length; i++) {
            var entry = pool[i];
            var hc = getHeroConfig(entry.itemId);
            if (!hc) continue;

            if (hc.quality === targetQuality) {
                matchingEntries.push(entry);
                totalWeight += entry.weight;
            }
        }

        // Fallback: kalau tidak ada hero yang match quality, ambil semua
        if (matchingEntries.length === 0) {
            log.warn('NORMAL_LUCK', 'No hero match quality "' + targetQuality + '" in pool ' + poolId + ' — fallback to full pool');
            for (var j = 0; j < pool.length; j++) {
                matchingEntries.push(pool[j]);
                totalWeight += pool[j].weight;
            }
        }

        // Weighted random pick
        var heroRoll = Math.random() * totalWeight;
        var heroAccum = 0;
        var pickedEntry = null;

        for (var k = 0; k < matchingEntries.length; k++) {
            heroAccum += matchingEntries[k].weight;
            if (heroRoll < heroAccum) {
                pickedEntry = matchingEntries[k];
                break;
            }
        }

        if (!pickedEntry) {
            pickedEntry = matchingEntries[matchingEntries.length - 1];
        }

        log.details('NORMAL_LUCK', [
            ['poolPick', 'quality=' + targetQuality + ' pool=' + poolId + ' size=' + matchingEntries.length],
            ['totalWeight', String(totalWeight)],
            ['pickedHero', String(pickedEntry.itemId)]
        ]);

        return pickedEntry.itemId;
    }

    /**
     * TAB 2 TIER-BASED ROLL — Dragon Ball Summon Return
     *
     * Menggunakan sistem TIER (bukan quality-based seperti TAB 1)!
     * Persentase exact sesuai permintaan user:
     *   SSS Hero: 3% (TOTAL 7 hero gabungan)
     *   Shenron: 5%
     *   Purple Hero: 92%
     *   Shard: DIHAPUS (hero only)
     *
     * @returns {{ heroId: number, num: number, quality: string, isPiece: boolean }}
     */
    function rollTab2Tier() {
        // ════════════════════════════════════════════════
        //  DEFENSIVE: Validasi TAB2_TIERS exist!
        // ════════════════════════════════════════════════
        if (!TAB2_TIERS || !TAB2_TIERS.length || !Array.isArray(TAB2_TIERS)) {
            log.error('TAB2_TIER', 'TAB2_TIERS is invalid or empty! Using fallback.');
            return {
                heroId: 1301,  // Fallback ke purple hero
                num: 1,
                quality: 'purple',
                isPiece: false
            };
        }

        // Roll untuk pilih tier
        var roll = Math.random();
        var accumulated = 0;
        var selectedTier = null;

        for (var t = 0; t < TAB2_TIERS.length; t++) {
            // DEFENSIVE: Cek tiap entry valid
            if (!TAB2_TIERS[t] || typeof TAB2_TIERS[t].rate !== 'number') {
                log.warn('TAB2_TIER', 'Invalid tier entry at index ' + t + ', skipping');
                continue;
            }
            
            accumulated += TAB2_TIERS[t].rate;
            if (roll < accumulated) {
                selectedTier = TAB2_TIERS[t];
                break;
            }
        }

        // ════════════════════════════════════════════════
        //  DEFENSIVE: Double-check selectedTier validity!
        // ════════════════════════════════════════════════
        if (!selectedTier || typeof selectedTier.type === 'undefined') {
            log.warn('TAB2_TIER', 'No tier selected or missing type, using last tier as fallback');
            selectedTier = TAB2_TIERS[TAB2_TIERS.length - 1];
            
            // Final safety check
            if (!selectedTier || typeof selectedTier.type === 'undefined') {
                log.error('TAB2_TIER', 'CRITICAL: Cannot find any valid tier! Using emergency fallback.');
                return {
                    heroId: 1301,  // Emergency fallback
                    num: 1,
                    quality: 'purple',
                    isPiece: false
                };
            }
        }

        log.details('TAB2_TIER', [
            ['tierRoll', 'roll=' + roll.toFixed(4) + ' selected=' + (selectedTier.tierId || 'unknown')],
            ['tierRate', 'rate=' + (selectedTier.rate || 0) + ' (' + ((selectedTier.rate || 0) * 100) + '%)'],
            ['tierType', 'type=' + (selectedTier.type || 'MISSING!')]
        ]);

        // Proses berdasarkan tipe tier
        if (selectedTier.type === 'shard') {
            // Return shard result
            return {
                heroId: selectedTier.shardId,   // 2600 = Shenron Shard
                num: selectedTier.shardNum,     // 5, 2, atau 1
                quality: 'superOrange',         // Shard adalah superOrange quality
                isPiece: true                   // Flag ini adalah piece, bukan hero
            };
        } else if (selectedTier.type === 'hero') {
            // Random pick hero dari pool
            var pool = selectedTier.pool;
            var randomIndex = Math.floor(Math.random() * pool.length);
            var heroId = pool[randomIndex];

            log.details('TAB2_TIER_HERO', [
                ['tierId', selectedTier.tierId],
                ['poolSize', String(pool.length)],
                ['pickedIndex', String(randomIndex)],
                ['pickedHeroId', String(heroId)]
            ]);

            return {
                heroId: heroId,
                num: 1,
                quality: selectedTier.quality,
                isPiece: false
            };
        }

        // Fallback (seharusnya tidak sampai sini)
        return {
            heroId: TAB2_SSS_HERO_POOL[0],
            num: 1,
            quality: 'superOrange',
            isPiece: false
        };
    }

    /**
     * Get random hero dengan quality roll + hero pick.
     * Support TAB 1 (poolId=1) dan TAB 2 (poolId=2).
     *
     * TAB 1: Quality-based roll (summonRandom.json rates)
     * TAB 2: Tier-based roll (exact screenshot percentages)
     *
     * @param {number} poolId - 1 = NormalLuck Tab 1, 2 = NormalLuck Tab 2
     * @returns {{ heroId: number, num: number, quality: string, isPiece: boolean }}
     */
    function getRandomHero(poolId) {
        if (poolId === 2) {
            // TAB 2: Gunakan TIER-BASED roll (screenshot percentages)
            return rollTab2Tier();
        } else {
            // TAB 1: Gunakan quality-based roll (original system)
            var quality = rollQuality();
            var heroId = pickHeroFromPool(quality, poolId || 1);
            return { heroId: heroId, num: 1, quality: quality, isPiece: false };
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD HERO DATA — pattern dari summonOne.js
    // ═══════════════════════════════════════════════════════════

    function buildSummonHeroData(heroDisplayId, heroInstanceId) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('NORMAL_LUCK', 'Cannot build hero data — config not found: ' + heroDisplayId);
            return null;
        }

        var heroTag = hc.tag ? hc.tag.split(',') : [];
        var baseAttr = makeHeroBasicAttr(heroDisplayId, 1, 0, 0);

        if (!baseAttr) {
            log.error('NORMAL_LUCK', 'Cannot build hero data — base attr failed: ' + heroDisplayId);
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

        log.details('NORMAL_LUCK', [
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

        log.details('NORMAL_LUCK', ['heroAdded', 'key=' + heroKey + ' displayId=' + heroData._heroDisplayId]);

        return heroKey;
    }

    // ═══════════════════════════════════════════════════════════
    //  COST HELPER
    // ═══════════════════════════════════════════════════════════

    function getCost(costType, times) {
        if (costType === LUCKPOOLCOSTTYPE.COSTLUCKICON) {
            // Pakai item 521
            var num = (times === 1) ? COST_NUM_1 : COST_NUM_10;
            return { itemId: ITEM_LUCKY_POOL_COIN, amount: num };
        } else {
            // Pakai diamond 101
            var dia = (times === 1) ? COST_DIAMOND_1 : COST_DIAMOND_10;
            return { itemId: ITEM_DIAMOND, amount: dia };
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleNormalLuck(request, callback) {
        var userId = request && request.userId;
        var actId = request && request.actId;
        var times = Number(request && request.times) || 1;
        var costType = Number(request && request.costType);

        log.info('NORMAL_LUCK', 'activity/normalLuck START — userId=' + (userId || '-')
            + ', actId=' + (actId || '-')
            + ', times=' + times
            + ', costType=' + costType);

        try {
            // ── VALIDATE userId ──
            if (!userId) {
                log.warn('NORMAL_LUCK', 'normalLuck — missing userId');
                callback({}, 1);
                return;
            }

            // ── VALIDATE times — hanya 1 atau 10 ──
            if (times !== 1 && times !== 10) {
                log.warn('NORMAL_LUCK', 'normalLuck — invalid times: ' + times + ' (only 1 or 10)');
                callback({}, 1);
                return;
            }

            // ── VALIDATE costType — hanya 0 atau 1 ──
            if (costType !== LUCKPOOLCOSTTYPE.COSTLUCKICON && costType !== LUCKPOOLCOSTTYPE.COSTDIAMOND) {
                log.warn('NORMAL_LUCK', 'normalLuck — invalid costType: ' + costType);
                callback({}, 1);
                return;
            }

            // ── Load user data ──
            var storageKey = userStorageKey(userId);
            var savedData = db._get(storageKey);
            if (!savedData) {
                log.warn('NORMAL_LUCK', 'normalLuck — user data not found: ' + storageKey);
                callback({}, 1);
                return;
            }

            // ── Compute cost ──
            var cost = getCost(costType, times);
            var currentBalance = getItemBalance(savedData, cost.itemId);

            log.details('NORMAL_LUCK', [
                ['cost', 'item=' + cost.itemId + ' amount=' + cost.amount + ' balance=' + currentBalance]
            ]);

            // ── Check balance ──
            if (currentBalance < cost.amount) {
                log.warn('NORMAL_LUCK', 'normalLuck — not enough balance: need ' + cost.amount
                    + ' of ' + cost.itemId + ', have ' + currentBalance);
                callback({}, 1);
                return;
            }

            // ── Deduct cost ──
            var newBalance = currentBalance - cost.amount;
            setItemBalance(savedData, cost.itemId, newBalance);

            log.details('NORMAL_LUCK', [
                ['deduct', 'item=' + cost.itemId + ' ' + currentBalance + '→' + newBalance]
            ]);

            // ════════════════════════════════════════════════════════
            //  DETECT POOL ID dari actId
            // ════════════════════════════════════════════════════════
            // actId format:
            //   "3001"    → Tab 1 (poolId = 1) — Existing NormalLuck
            //   "3001_2"  → Tab 2 (poolId = 2) — Dragon Ball Summon Return
            var poolId = 1;  // default Tab 1
            if (actId && typeof actId === 'string') {
                var parts = actId.split('_');
                if (parts.length > 1 && parts[1] === '2') {
                    poolId = 2;
                }
            }

            log.details('NORMAL_LUCK', ['poolDetection', 'actId=' + (actId || '-') + ' → poolId=' + poolId]);

            // ════════════════════════════════════════════════════════
            //  ROLL HEROES (1 atau 10)
            //  Support HERO (dari hero.json) dan HERO PIECE (dari heroPiece.json)
            // ════════════════════════════════════════════════════════

            var addTotal = [];      // Array of hero data (for _addTotal response)
            var heroResults = [];    // Track hero results for logging
            var pieceResults = [];   // Array of piece data (for item reward)

            for (var i = 0; i < times; i++) {
                var rollResult = getRandomHero(poolId);  // PASS poolId!
                var itemId = rollResult.heroId;
                var quality = rollResult.quality;
                var itemNum = rollResult.num || 1;  // Jumlah item (untuk shard: 5, 2, atau 1)
                var isPieceRoll = rollResult.isPiece || false;  // Flag dari TAB2 tier roll

                // ════════════════════════════════════════════════
                //  CEK: Apakah ini HERO PIECE (fragment/shard)?
                //  2 cara deteksi:
                //    1. Dari rollResult.isPiece (TAB2 tier-based roll)
                //    2. Dari isHeroPiece() check (fallback untuk TAB1)
                //  HeroPiece ada di heroPiece.json, BUKAN di hero.json
                //  Contoh: ID 2600 = Shenron Shard
                // ════════════════════════════════════════════════
                if (isPieceRoll || isHeroPiece(itemId)) {
                    var pieceConfig = getHeroPieceConfig(itemId);
                    if (!pieceConfig) {
                        log.error('NORMAL_LUCK', 'HeroPiece config missing for: ' + itemId);
                        continue;
                    }

                    // Add piece to user's item inventory (gunakan itemNum dari tier roll!)
                    var currentPieceBalance = getItemBalance(savedData, itemId);
                    var newPieceBalance = currentPieceBalance + itemNum;
                    setItemBalance(savedData, itemId, newPieceBalance);

                    // ════════════════════════════════════════════════
                    //  CRITICAL FIX: Gunakan belongTo (1600) sebagai displayId!
                    //  Client SetHeroDataToModel() akan load hero.json[displayId]
                    //  Kalau displayId tidak ada di hero.json → r = undefined → CRASH!
                    //
                    //  Shenron Shard (2600) punya belongTo = 1600 (Shenron Hero)
                    //  Jadi kita pakai 1600 supaya client bisa load config!
                    // ════════════════════════════════════════════════
                    var belongToHeroId = pieceConfig.belongTo || 1600; // Default ke Shenron
                    var pieceInstanceId = 'piece_' + itemId + '_' + Date.now() + '_' + i;
                    var pieceHeroData = {
                        _heroId: pieceInstanceId,
                        _heroDisplayId: belongToHeroId,    // ← PAKAI belongTo (1600), BUKAN shard ID (2600)!
                        _heroStar: 0,
                        _expeditionMaxLevel: 0,
                        _heroTag: ['piece', 'shard'],
                        _fragment: 0,
                        _superSkillResetCount: 0,
                        _potentialResetCount: 0,
                        _heroBaseAttr: { _items: [] },   // Minimal attr
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
                        _linkFrom: '',
                        // ═══════════════════════════════════════
                        //  SHARD-SPECIFIC FIELDS (untuk client render)
                        // ═══════════════════════════════════════
                        _isPiece: true,                   // Flag: ini piece/shard
                        _pieceItemId: itemId,             // Actual shard ID (2600)
                        _pieceName: pieceConfig.name,     // "龙神" / Shenron Shard
                        _pieceNum: itemNum,               // 5, 2, atau 1
                        _pieceQuality: pieceConfig.quality, // "superOrange"
                        _pieceBelongTo: pieceConfig.belongTo // 1600 (Shenron Hero ID)
                    };

                    // Masukkan ke addTotal SUPAYA CLIENT BISA TAMPILKAN!
                    addTotal.push(pieceHeroData);

                    // Track piece result (untuk _addPieces response juga)
                    pieceResults.push({
                        _itemId: itemId,
                        _num: itemNum,  // 5, 2, atau 1 (dari TAB2 tier definition)
                        _pieceName: pieceConfig.name,
                        _quality: pieceConfig.quality,
                        _belongTo: pieceConfig.belongTo
                    });

                    log.info('NORMAL_LUCK', 'Piece #' + (i + 1) + ' — pieceId=' + itemId
                        + ' name=' + pieceConfig.name
                        + ' quality=' + pieceConfig.quality
                        + ' amount=' + itemNum
                        + ' displayId=' + belongToHeroId + ' (belongTo)'
                        + ' → ADDED TO _addTotal for client display!');
                    continue;  // Skip normal hero processing
                }

                // ════════════════════════════════════════════════
                //  NORMAL HERO PROCESSING (hero.json)
                // ════════════════════════════════════════════════

                // Verify hero config exists in hero.json
                var heroConfig = getHeroConfig(itemId);
                if (!heroConfig) {
                    log.error('NORMAL_LUCK', 'Hero config missing for displayId: ' + itemId);
                    continue;
                }

                // Generate instance ID + build hero data
                var heroInstanceId = generateHeroInstanceId(savedData);
                var heroData = buildSummonHeroData(itemId, heroInstanceId);

                if (!heroData) {
                    log.error('NORMAL_LUCK', 'Failed to build hero data for: ' + itemId);
                    continue;
                }

                // Add to collection
                addHeroToCollection(savedData, heroData);

                // Track result
                addTotal.push(heroData);
                heroResults.push({
                    displayId: itemId,
                    instanceId: heroInstanceId,
                    quality: heroConfig.quality
                });

                log.info('NORMAL_LUCK', 'Hero #' + (i + 1) + ' — displayId=' + itemId
                    + ' quality=' + heroConfig.quality
                    + ' instanceId=' + heroInstanceId);
            }

            // ── Check if any result (hero OR piece) rolled successfully ──
            // Success kalau ada hero ATAU piece (boleh keduanya!)
            if (addTotal.length === 0 && pieceResults.length === 0) {
                log.error('NORMAL_LUCK', 'No hero or piece rolled successfully — refunding cost');
                setItemBalance(savedData, cost.itemId, currentBalance);
                callback({}, 1);
                return;
            }

            // ════════════════════════════════════════════════════════
            //  UPDATE SUMMON STATE
            // ════════════════════════════════════════════════════════

            // Ensure summon data structure
            if (!savedData.summon) {
                savedData.summon = {
                    _energy: 50,
                    _wishList: [],
                    _wishVersion: 0,
                    _canCommonFreeTime: 0,
                    _canSuperFreeTime: 0,
                    _summonTimes: {}
                };
            }

            // ── Update energy (+10 per summon × times) ──
            // Sama seperti SUPER summon — lihat summonOne.js L936-947.
            // summon.json[1].summonEnergy = 10 (untuk SUPER).
            // NormalLuck di server asli juga increase energy +10 per summon.
            // Client baca _energy dari response (L61753: l = e._energy).
            // Client set lokal: this._energy = t (L61663).
            var currentEnergy = Number(savedData.summon._energy) || 0;
            var energyGain = times * 10;  // +10 per summon
            var newEnergy = currentEnergy + energyGain;
            savedData.summon._energy = newEnergy;

            // ── Update _summonTimes[6] (NormalLuckPool) ──
            // Client baca _summonTimes[SummonType.ENERGY (=5)] di energyPrecent().
            // Tapi server juga track _summonTimes[6] untuk konsistensi data.
            if (!savedData.summon._summonTimes) savedData.summon._summonTimes = {};
            var sTypeKey = String(6);  // SummonType.NormalLuckPool = 6
            savedData.summon._summonTimes[sTypeKey] = (Number(savedData.summon._summonTimes[sTypeKey]) || 0) + times;

            log.details('NORMAL_LUCK', [
                ['energy', currentEnergy + ' +' + energyGain + ' = ' + newEnergy],
                ['summonTimes[' + sTypeKey + ']', savedData.summon._summonTimes[sTypeKey]]
            ]);

            // ── Update _curCount (UserNormalLuckActivity progress) ──
            // Increment by times (tracking untuk task milestone)
            if (!savedData.normalLuckActivity) {
                savedData.normalLuckActivity = { _curCount: 0 };
            }
            savedData.normalLuckActivity._curCount = (Number(savedData.normalLuckActivity._curCount) || 0) + times;

            // ════════════════════════════════════════════════════════
            //  PERSIST USER DATA
            // ════════════════════════════════════════════════════════

            db._set(storageKey, savedData);

            // ════════════════════════════════════════════════════════
            //  BUILD RESPONSE
            // ════════════════════════════════════════════════════════

            // _changeInfo: ABSOLUTE balance (SET, not delta)
            // Include: cost deduction + piece rewards (if any)
            var changeItems = {};
            changeItems[String(cost.itemId)] = { _id: cost.itemId, _num: newBalance };

            // Add piece balances to changeInfo (client needs to see new balance)
            for (var p = 0; p < pieceResults.length; p++) {
                var pieceId = pieceResults[p]._itemId;
                var pieceNewBal = getItemBalance(savedData, pieceId);
                changeItems[String(pieceId)] = { _id: pieceId, _num: pieceNewBal };
            }

            var response = {
                _addTotal: addTotal,           // Hero array (empty if only pieces)
                _addPieces: pieceResults,      // Piece/fragment array (NEW!)
                _changeInfo: { _items: changeItems },
                _energy: newEnergy,
                _canFreeTime: 0
            };

            log.info('NORMAL_LUCK', 'activity/normalLuck SUCCESS — '
                + addTotal.length + ' heroes, ' + pieceResults.length + ' pieces'
                + ', cost=' + cost.itemId + 'x' + cost.amount
                + ', balance=' + newBalance
                + ', energy=' + currentEnergy + '+' + energyGain + '=' + newEnergy);
            log.details('response', [
                ['userId', userId],
                ['actId', actId || '-'],
                ['times', String(times)],
                ['costType', costType + ' (' + (costType === 0 ? 'LUCKICON' : 'DIAMOND') + ')'],
                ['heroes.rolled', String(addTotal.length)],
                ['pieces.rolled', String(pieceResults.length)],
                ['cost.item', cost.itemId + ' x' + cost.amount],
                ['cost.balance', currentBalance + '→' + newBalance],
                ['energy', currentEnergy + '+' + energyGain + '=' + newEnergy],
                ['curCount', String(savedData.normalLuckActivity._curCount)]
            ]);

            // ── CALLBACK ──
            // Client set manual: n.actId = e (dari request, BUKAN dari response)
            callback(response);

        } catch (err) {
            log.error('NORMAL_LUCK', 'activity/normalLuck UNCAUGHT ERROR — '
                + (err && err.name) + ': ' + (err && err.message));
            callback({}, 1);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('activity', 'normalLuck', handleNormalLuck);
})();
