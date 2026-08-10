/**
 * handlers/gift/getVipReward.js
 *
 * Request: { type:"gift", action:"getVipReward", userId, giftId:<0-based VIP index>, version:"1.0" }
 * giftId = currVipLevel - 1 (client)
 * Config: vipUpgrade.json[giftId] → reward1/num1 .. reward4/num4
 * 18 tier (id 0-17). Tier dengan hero reward → _addHeroes, lainnya → _changeInfo._items
 * State: giftInfo._haveGotVipRewrd[giftId] = true
 */
(function () {
    'use strict';

    var MainServer = window.MainServer;
    var db = window.MainServerDB;
    var VIP_LEVEL_ID = 106;

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

    // ═══ Hero config helpers (same as summon handlers) ═══

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

    // ═══ makeHeroBasicAttr — sama persis summon handler ═══

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

    // ═══ buildHeroData — sama persis summon handler buildSummonHeroData ═══

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

    // ═══ Handler ═══

    MainServer.registerHandler('gift', 'getVipReward', function (request, callback) {
        var userId = request.userId;
        var giftId = request.giftId;

        if (!userId) { callback({}, 1); return; }
        if (giftId === undefined || giftId === null) { callback({}, 1); return; }

        var savedData = db._get('ms_user_' + userId + '_1');
        if (!savedData) { callback({}, 1); return; }

        if (!savedData.giftInfo) savedData.giftInfo = {};
        if (!savedData.giftInfo._haveGotVipRewrd) savedData.giftInfo._haveGotVipRewrd = {};

        if (savedData.giftInfo._haveGotVipRewrd[String(giftId)]) { callback({}, 1); return; }

        var vipUpgrade = loadJson('vipUpgrade');
        if (!vipUpgrade) { callback({}, 1); return; }
        var tier = vipUpgrade[String(giftId)];
        if (!tier) { callback({}, 1); return; }

        // Validate VIP level
        var playerVipLevel = getBal(savedData, VIP_LEVEL_ID);
        var requiredVipLevel = Number(tier.id) + 1;
        if (playerVipLevel < requiredVipLevel) { callback({}, 1); return; }

        // Distribute rewards
        var thingsID = loadJson('thingsID');
        var addHeroes = {};
        var changeItems = {};

        for (var r = 1; r <= 4; r++) {
            var itemId = Number(tier['reward' + r]);
            var num = Number(tier['num' + r]);
            if (itemId <= 0 || num <= 0) continue;

            var ti = thingsID && thingsID[String(itemId)];

            if (ti && ti.thingsType === 'hero') {
                // Generate hero key (max existing + 1)
                if (!savedData.heros) savedData.heros = { _heros: {} };
                if (!savedData.heros._heros) savedData.heros._heros = {};
                var herosMap = savedData.heros._heros;
                var maxKey = -1;
                for (var hk in herosMap) {
                    if (herosMap.hasOwnProperty(hk)) { var nkh = Number(hk); if (nkh > maxKey) maxKey = nkh; }
                }
                var heroKey = String(maxKey + 1);
                var heroId = Number(heroKey) + 1;

                // Build FULL hero data from hero.json config
                var heroData = buildHeroData(itemId, heroId);
                if (heroData) {
                    savedData.heros._heros[heroKey] = heroData;
                    addHeroes[heroKey] = heroData;
                }
            } else {
                var oldBal = getBal(savedData, itemId);
                var newBal = oldBal + num;
                setBal(savedData, itemId, newBal);
                changeItems[String(itemId)] = { _id: itemId, _num: newBal };
            }
        }

        // Mark claimed + persist
        savedData.giftInfo._haveGotVipRewrd[String(giftId)] = true;
        db._set('ms_user_' + userId + '_1', savedData);

        // Response
        var response = { _changeInfo: { _items: changeItems } };
        if (Object.keys(addHeroes).length > 0) response._addHeroes = addHeroes;

        callback(response);
    });

    window.MainServer = MainServer;
})();