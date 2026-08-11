/**
 * handlers/equip/activeWeapon.js — Active Weapon Slot Handler (DRAFT v3)
 * Super Warrior Z — MAIN SERVER
 *
 * TUGAS UTAMA:
 *   UNLOCK weapon slot untuk hero. HANYA unlock — TIDAK auto-equip!
 *
 *   Client callback (L122547-122548) HANYA memproses:
 *     - setTotalAttrsByHeroId(t, t.heroId)     → refresh hero stats
 *     - changeEquipCallBack(t)                  → tampilkan equip di slot
 *     - doRefresh() + showUnLockEffect()        → UI refresh
 *
 *   Callback TIDAK memanggil resetTtemsCallBack → TIDAK memproses _changeInfo!
 *   Jadi activeWeapon TIDAK boleh deduct inventory.
 *
 *   Setelah unlock, user tap lagi → client buka WeaponChosePage (L122563)
 *   untuk manual equip via handler lain.
 *
 * EVIDENCE:
 *   L122538: if(void 0 == a || a.weaponState != WEAPONSTATE.allReadyActivated)
 *            → NOT activated → call activeWeapon (UNLOCK)
 *   L122551-122567: ELSE (already activated) → open WeaponChosePage/WeaponInfo
 *            → manual equip via beda handler
 *
 *   L122547-122548 callback:
 *     setTotalAttrsByHeroId(t, t.heroId)        → baca t._totalAttr
 *     changeEquipCallBack(t)                    → baca t._equipItem + t.heroId
 *     ⚠️ TIDAK ADA resetTtemsCallBack → _changeInfo TIDAK diproses!
 *
 * RESPONSE:
 *   {
 *     heroId: <string>,              // NON-underscore (L85171, L82892)
 *     _totalAttr: { _items: {...} }, // 42 attrs (base stats, NO equip bonus)
 *     _equipItem: {                  // current equip state (empty if none)
 *       _suitItems: [...],           // existing equip (from savedData)
 *       _suitAttrs: [],
 *       _equipAttrs: [],
 *       _earrings: { _id:0, _level:0, _attrs:{_items:{}} },
 *       _weaponState: 1              // allReadyActivated (UNLOCKED)
 *     }
 *   }
 *   ⚠️ NO _changeInfo — client tidak memprosesnya!
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.equip) {
        MainServer.handlers.equip = {};
    }

    var WEAPONSTATE_ALL_READY_ACTIVATED = 1;

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

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
        } catch (e) {}
        return null;
    }

    function findHeroInStorage(savedData, heroId) {
        if (!savedData.heros || !savedData.heros._heros) return null;
        for (var key in savedData.heros._heros) {
            if (!savedData.heros._heros.hasOwnProperty(key)) continue;
            var hero = savedData.heros._heros[key];
            if (String(hero._heroId) === String(heroId)) {
                return { key: key, hero: hero };
            }
        }
        return null;
    }

    // Hero base attrs — pattern dari shop/buy.js makeHeroBasicAttr
    function makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel) {
        level = level || 1; evolveLevel = evolveLevel || 0; starLevel = starLevel || 0;
        var hc = loadJson('hero');
        var heroData = hc ? hc[String(heroDisplayId)] : null;
        if (!heroData) return null;

        var la = loadJson('heroLevelAttr');
        var lvlData = la ? la[String(level)] : null;
        var qp = loadJson('heroQualityParam');
        var qData = qp ? qp[String(heroData.quality || 'purple')] : null;
        var tp = loadJson('heroTypeParam');
        var tData = tp ? tp[String(heroData.heroType || 'critical')] : null;

        var d = {
            _hp: 0, _attack: 0, _armor: 0, _speed: 0,
            _hit: 0, _dodge: 0, _block: 0, _damageReduce: 0, _armorBreak: 0,
            _controlResist: 0, _skillDamage: 0, _criticalDamage: 0, _blockEffect: 0,
            _critical: 0, _criticalResist: 0, _trueDamage: 0, _energy: 50,
            _power: 0, _extraArmor: 0, _orghp: 0,
            _talent: Number(heroData.talent) || 0,
            _level: level, _exp: 0, _evolveLevel: evolveLevel
        };

        var baseHp = (Number(lvlData && lvlData.hp) || 0) * (Number(tData && tData.hpParam) || 0) + (Number(tData && tData.hpBais) || 0);
        baseHp *= (Number(qData && qData.hpParam) || 1) * (Number(heroData.balanceHp) || 1);
        d._hp = baseHp;

        var baseAtk = (Number(lvlData && lvlData.attack) || 0) * (Number(tData && tData.attackParam) || 0) + (Number(tData && tData.attackBais) || 0);
        baseAtk *= (Number(qData && qData.attackParam) || 1) * (Number(heroData.balanceAttack) || 1);
        d._attack = baseAtk;

        var baseArm = (Number(lvlData && lvlData.armor) || 0) * (Number(tData && tData.armorParam) || 0) + (Number(tData && tData.armorBais) || 0);
        baseArm *= (Number(qData && qData.armorParam) || 1) * (Number(heroData.balanceArmor) || 1);
        d._armor = baseArm;

        d._speed = Number(heroData.speed) || 0;
        d._hit = Number(heroData.hit) || 0;
        d._dodge = Number(heroData.dodge) || 0;
        d._block = Number(heroData.block) || 0;
        d._damageReduce = Number(heroData.damageReduce) || 0;
        d._armorBreak = Number(heroData.armorBreak) || 0;
        d._controlResist = Number(heroData.controlResist) || 0;
        d._skillDamage = Number(heroData.skillDamage) || 0;
        d._criticalDamage = Number(heroData.criticalDamage) || 0;
        d._blockEffect = Number(heroData.blockEffect) || 0;
        d._critical = Number(heroData.critical) || 0;
        d._criticalResist = Number(heroData.criticalResist) || 0;
        d._trueDamage = Number(heroData.trueDamage) || 0;
        d._energy = 50;

        return d;
    }

    function buildTotalAttrItems(heroBaseAttr, existingEquipAttrs) {
        if (!heroBaseAttr) return {};

        var hp = Math.floor(Number(heroBaseAttr._hp) || 0);
        var atk = Math.floor(Number(heroBaseAttr._attack) || 0);
        var armor = Math.floor(Number(heroBaseAttr._armor) || 0);
        var speed = Number(heroBaseAttr._speed) || 0;
        var hit = Number(heroBaseAttr._hit) || 0;
        var dodge = Number(heroBaseAttr._dodge) || 0;
        var block = Number(heroBaseAttr._block) || 0;
        var blockEffect = Number(heroBaseAttr._blockEffect) || 0;
        var skillDamage = Number(heroBaseAttr._skillDamage) || 0;
        var critical = Number(heroBaseAttr._critical) || 0;
        var criticalResist = Number(heroBaseAttr._criticalResist) || 0;
        var criticalDamage = Number(heroBaseAttr._criticalDamage) || 0;
        var armorBreak = Number(heroBaseAttr._armorBreak) || 0;
        var damageReduce = Number(heroBaseAttr._damageReduce) || 0;
        var controlResist = Number(heroBaseAttr._controlResist) || 0;
        var trueDamage = Number(heroBaseAttr._trueDamage) || 0;
        var energy = Number(heroBaseAttr._energy) || 50;
        var extraArmor = 0;

        // Add existing equip flat attrs (if any)
        if (existingEquipAttrs && Array.isArray(existingEquipAttrs)) {
            for (var i = 0; i < existingEquipAttrs.length; i++) {
                var attr = existingEquipAttrs[i];
                var id = Number(attr._id || attr.id);
                var num = Number(attr._num || attr.num) || 0;
                switch (id) {
                    case 0: hp += num; break;
                    case 1: atk += num; break;
                    case 2: armor += num; break;
                    case 3: speed += num; break;
                    case 4: hit += num; break;
                    case 5: dodge += num; break;
                    case 6: block += num; break;
                    case 7: blockEffect += num; break;
                    case 8: skillDamage += num; break;
                    case 9: critical += num; break;
                    case 10: criticalResist += num; break;
                    case 11: criticalDamage += num; break;
                    case 12: armorBreak += num; break;
                    case 13: damageReduce += num; break;
                    case 14: controlResist += num; break;
                    case 15: trueDamage += num; break;
                    case 26: extraArmor += num; break;
                }
            }
        }

        var power = Math.floor(hp + atk * 15 + armor);
        var orgHp = hp;

        var items = {};
        items['0'] = { _id: 0, _num: hp };
        items['1'] = { _id: 1, _num: atk };
        items['2'] = { _id: 2, _num: armor };
        items['3'] = { _id: 3, _num: speed };
        items['4'] = { _id: 4, _num: hit };
        items['5'] = { _id: 5, _num: dodge };
        items['6'] = { _id: 6, _num: block };
        items['7'] = { _id: 7, _num: blockEffect };
        items['8'] = { _id: 8, _num: skillDamage };
        items['9'] = { _id: 9, _num: critical };
        items['10'] = { _id: 10, _num: criticalResist };
        items['11'] = { _id: 11, _num: criticalDamage };
        items['12'] = { _id: 12, _num: armorBreak };
        items['13'] = { _id: 13, _num: damageReduce };
        items['14'] = { _id: 14, _num: controlResist };
        items['15'] = { _id: 15, _num: trueDamage };
        items['16'] = { _id: 16, _num: energy };
        items['17'] = { _id: 17, _num: 0 };
        items['18'] = { _id: 18, _num: 0 };
        items['19'] = { _id: 19, _num: 0 };
        items['20'] = { _id: 20, _num: 0 };
        items['21'] = { _id: 21, _num: power };
        items['22'] = { _id: 22, _num: orgHp };
        items['23'] = { _id: 23, _num: 0 };
        items['24'] = { _id: 24, _num: 0 };
        items['25'] = { _id: 25, _num: 0 };
        items['26'] = { _id: 26, _num: extraArmor };
        items['27'] = { _id: 27, _num: 0 };
        items['28'] = { _id: 28, _num: 0 };
        items['29'] = { _id: 29, _num: 0 };
        items['30'] = { _id: 30, _num: 0 };
        items['31'] = { _id: 31, _num: 0 };
        for (var i2 = 32; i2 <= 40; i2++) {
            items[String(i2)] = { _id: i2, _num: 0 };
        }
        items['41'] = { _id: 41, _num: 100 };

        return items;
    }

    function handleActiveWeapon(request, callback) {
        try {
            _handleActiveWeaponImpl(request, callback);
        } catch (err) {
            log.error('EQUIP_ACTIVE', 'UNCAUGHT: ' + (err && err.message));
            callback({
                heroId: (request && request.heroId) || '',
                _totalAttr: { _items: {} },
                _equipItem: {
                    _suitItems: [], _suitAttrs: [], _equipAttrs: [],
                    _earrings: { _id: 0, _level: 0, _attrs: { _items: {} } },
                    _weaponState: WEAPONSTATE_ALL_READY_ACTIVATED
                }
            });
        }
    }

    function _handleActiveWeaponImpl(request, callback) {
        var userId = request && request.userId;
        var heroId = request && request.heroId;

        log.info('EQUIP_ACTIVE', 'START (userId=' + (userId || '-')
            + ', heroId=' + (heroId || '-') + ')');

        if (!userId || !heroId) {
            log.error('EQUIP_ACTIVE', 'missing userId or heroId');
            callback({
                heroId: String(heroId || ''),
                _totalAttr: { _items: {} },
                _equipItem: { _suitItems: [], _suitAttrs: [], _equipAttrs: [],
                    _earrings: { _id: 0, _level: 0, _attrs: { _items: {} } },
                    _weaponState: WEAPONSTATE_ALL_READY_ACTIVATED }
            });
            return;
        }

        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('EQUIP_ACTIVE', 'user data not found');
            callback({
                heroId: String(heroId), _totalAttr: { _items: {} },
                _equipItem: { _suitItems: [], _suitAttrs: [], _equipAttrs: [],
                    _earrings: { _id: 0, _level: 0, _attrs: { _items: {} } },
                    _weaponState: WEAPONSTATE_ALL_READY_ACTIVATED }
            });
            return;
        }

        var found = findHeroInStorage(savedData, heroId);
        if (!found) {
            log.error('EQUIP_ACTIVE', 'hero not found: ' + heroId);
            callback({
                heroId: String(heroId), _totalAttr: { _items: {} },
                _equipItem: { _suitItems: [], _suitAttrs: [], _equipAttrs: [],
                    _earrings: { _id: 0, _level: 0, _attrs: { _items: {} } },
                    _weaponState: WEAPONSTATE_ALL_READY_ACTIVATED }
            });
            return;
        }
        var heroData = found.hero;

        // ── INIT equip._suits ──
        if (!savedData.equip) savedData.equip = { _suits: {} };
        if (!savedData.equip._suits) savedData.equip._suits = {};

        var suitKey = String(heroId);
        var suitData = savedData.equip._suits[suitKey];
        if (!suitData) {
            suitData = { _suitItems: [], _suitAttrs: [], _equipAttrs: [], _earrings: {}, _weaponState: 0 };
            savedData.equip._suits[suitKey] = suitData;
        }
        if (!Array.isArray(suitData._suitItems)) suitData._suitItems = [];
        if (!Array.isArray(suitData._suitAttrs)) suitData._suitAttrs = [];
        if (!Array.isArray(suitData._equipAttrs)) suitData._equipAttrs = [];
        if (!suitData._earrings || typeof suitData._earrings !== 'object') suitData._earrings = {};

        // ── UNLOCK weapon slot (weaponState 0 → 1) ──
        // TIDAK auto-equip! TIDAK deduct inventory!
        // Client callback TIDAK memproses _changeInfo (L122547-122548).
        suitData._weaponState = WEAPONSTATE_ALL_READY_ACTIVATED;

        // ── COMPUTE hero base attrs + existing equip ──
        var heroDisplayId = Number(heroData._heroDisplayId);
        var level = 1, starLevel = 0, evolveLevel = 0;
        if (heroData._heroBaseAttr) {
            level = Number(heroData._heroBaseAttr._level) || 1;
            evolveLevel = Number(heroData._heroBaseAttr._evolveLevel) || 0;
        }
        starLevel = Number(heroData._heroStar) || 0;

        var heroBaseAttr = makeHeroBasicAttr(heroDisplayId, level, evolveLevel, starLevel);
        // ── BUILD _equipItem (current state, weaponState=1) ──
        var equipItem = {
            _suitItems: suitData._suitItems,
            _suitAttrs: suitData._suitAttrs,
            _equipAttrs: suitData._equipAttrs,
            _earrings: { _id: 0, _level: 0, _attrs: { _items: {} } },
            _weaponState: WEAPONSTATE_ALL_READY_ACTIVATED
        };

        // ── SAVE ──
        db._set(key, savedData);

        // ── RESPONSE ──
        // ⚠️ TIDAK kirim _totalAttr! activeWeapon cuma buka slot, BUKAN ubah power.
        // L85204: kalau _totalAttr undefined → o undefined → skip (tidak otak atik power).
        // Client keep current power dari enterGame.
        // Hanya kirim heroId + _equipItem (weaponState=1).
        var response = {
            heroId: String(heroId),
            _equipItem: equipItem
        };

        log.info('EQUIP_ACTIVE', 'SUCCESS — heroId=' + heroId
            + ', weaponState=1 (UNLOCKED)'
            + ', suitItems=' + suitData._suitItems.length);

        callback(response);
    }

    MainServer.registerHandler('equip', 'activeWeapon', handleActiveWeapon);

})();
