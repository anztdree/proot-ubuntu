/**
 * handlers/gift/getFrisetRechargeReward.js
 *
 * Action:  gift/getFrisetRechargeReward
 * Request: { type:"gift", action:"getFrisetRechargeReward", userId, version:"1.0" }
 *
 * Config: resource/json/firstRecharge.json
 *   "1":{id:1,rewardID:1421,num:1}       ← HERO (孙悟空超一) → _addHeroes
 *   "2":{id:2,rewardID:134,num:100}       ← godWater (basis)  → _changeInfo._items
 *   "3":{id:3,rewardID:132,num:500}       ← breakCapsule      → _changeInfo._items
 *   "4":{id:4,rewardID:131,num:20000}     ← expCapsule        → _changeInfo._items
 *   "5":{id:5,rewardID:102,num:100000}    ← gold              → _changeInfo._items
 *
 * Response:
 * {
 *   _addHeroes: [ { _heroId, _heroDisplayId, _heroStar, _heroBaseAttr, ... } ],
 *   _changeInfo: { _items: { "itemId": { _id, _num } } }
 * }
 *
 * Item 1421 thingsType="hero" → HARUS via _addHeroes supaya masuk HerosManager roster.
 *   Client: saveGainWithOutItems → SetHeroDataToModel → addToHeros
 *   Hero data format sama dengan summonOne.js buildSummonHeroData.
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

    // ── item balance helpers ──

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

    // ── hero data builder (sama dengan summonOne.js buildSummonHeroData) ──

    function getHeroConfig(id) {
        var h = loadJson('hero');
        return h ? h[String(id)] : null;
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

    function getHeroEvolve(id) {
        var ev = loadJson('heroEvolve');
        if (!ev) return [];
        return ev[String(id)] || [];
    }

    function getHeroWakeUp(id) {
        var wu = loadJson('heroWakeUp');
        if (!wu) return [];
        return wu[String(id)] || [];
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

        var hpK = Number(la.hp) || 0;
        var atkK = Number(la.attack) || 0;
        var armK = Number(la.armor) || 0;
        var spdK = Number(la.speed) || 0;
        var hitK = Number(la.hit) || 0;
        var dodgeK = Number(la.dodge) || 0;
        var blockK = Number(la.block) || 0;
        var blockEffK = Number(la.blockEffect) || 0;
        var critK = Number(la.critical) || 0;
        var critResK = Number(la.criticalResist) || 0;
        var critDmgK = Number(la.criticalDamage) || 0;
        var skillDmgK = Number(la.skillDamage) || 0;
        var armorBrkK = Number(la.armorBreak) || 0;
        var dmgReduceK = Number(la.damageReduce) || 0;
        var ctrlResK = Number(la.controlResist) || 0;

        var qHp = Number(qp.hp) || 0;
        var qAtk = Number(qp.attack) || 0;
        var qArm = Number(qp.armor) || 0;
        var qSpd = Number(qp.speed) || 0;

        var tHp = Number(tp.hp) || 0;
        var tAtk = Number(tp.attack) || 0;
        var tArm = Number(tp.armor) || 0;
        var tSpd = Number(tp.speed) || 0;

        var cfgSpd = Number(hc.speed) || 0;
        var cfgBalPower = Number(hc.balancePower) || 1;
        var cfgBalHp = Number(hc.balanceHp) || 1;
        var cfgBalAtk = Number(hc.balanceAttack) || 1;
        var cfgBalArm = Number(hc.balanceArmor) || 1;

        var baseHp = (hpK + qHp + tHp) * cfgBalHp;
        var baseAtk = (atkK + qAtk + tAtk) * cfgBalAtk;
        var baseArm = (armK + qArm + tArm) * cfgBalArm;
        var baseSpd = (spdK + qSpd + tSpd + cfgSpd) * cfgBalPower;

        d._orghp = baseHp;
        d._hp = baseHp + d._hp;
        d._attack = baseAtk + d._attack;
        d._armor = baseArm + d._armor;
        d._speed = baseSpd + d._speed;
        d._hit = hitK;
        d._dodge = dodgeK;
        d._block = blockK;
        d._blockEffect = blockEffK;
        d._critical = critK;
        d._criticalResist = critResK;
        d._criticalDamage = critDmgK;
        d._skillDamage = skillDmgK;
        d._armorBreak = armorBrkK;
        d._damageReduce = dmgReduceK;
        d._controlResist = ctrlResK;
        d._superDamage = 0;
        d._power = d._hp * 3 + d._attack * 4 + d._armor * 2 + d._speed * 1.5;

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

    function addHeroToCollection(savedData, heroData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};
        var heroKey = String(Object.keys(savedData.heros._heros).length);
        savedData.heros._heros[heroKey] = heroData;
        return heroKey;
    }

    // ── handler ──

    function handleGetFrisetRechargeReward(request, callback) {
        var userId = request.userId;

        if (!userId) { callback({}, 1); return; }

        var savedData = db._get('ms_user_' + userId + '_1');
        if (!savedData) { callback({}, 1); return; }

        if (!savedData.giftInfo) savedData.giftInfo = {};
        if (!savedData.giftInfo._fristRecharge)
            savedData.giftInfo._fristRecharge = { _canGetReward: false, _haveGotReward: false };

        var fr = savedData.giftInfo._fristRecharge;
        if (!fr._canGetReward) { callback({}, 1); return; }
        if (fr._haveGotReward) { callback({}, 1); return; }

        var config = loadJson('firstRecharge');
        if (!config) { callback({}, 1); return; }

        var addHeroes = [];
        var changeItems = {};

        // Load thingsID untuk cek thingsType
        var thingsID = loadJson('thingsID');

        for (var k in config) {
            var entry = config[k];
            var itemId = Number(entry.rewardID);
            var addNum = Number(entry.num);
            if (itemId <= 0 || addNum <= 0) continue;

            var ti = thingsID && thingsID[String(itemId)];
            var isHero = ti && ti.thingsType === 'hero';

            if (isHero) {
                // Hero → _addHeroes
                var heroInstanceId = generateHeroInstanceId(savedData);
                var heroData = buildHeroData(itemId, heroInstanceId);
                if (heroData) {
                    addHeroToCollection(savedData, heroData);
                    addHeroes.push(heroData);
                }
            } else {
                // Item biasa → _changeInfo._items
                var oldBal = getBal(savedData, itemId);
                var newBal = oldBal + addNum;
                setBal(savedData, itemId, newBal);
                changeItems[String(itemId)] = { _id: itemId, _num: newBal };
            }
        }

        fr._haveGotReward = true;
        db._set('ms_user_' + userId + '_1', savedData);

        var response = { _changeInfo: { _items: changeItems } };
        if (addHeroes.length > 0) response._addHeroes = addHeroes;

        callback(response);
    }

    MainServer.registerHandler('gift', 'getFrisetRechargeReward', handleGetFrisetRechargeReward);
    window.MainServer = MainServer;
})();