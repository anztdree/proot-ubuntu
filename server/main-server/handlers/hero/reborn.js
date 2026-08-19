/**
 * handlers/hero/reborn.js — Hero Rebirth Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: hero/reborn
 * ============================================================
 *
 * Client call (main.min.js L106281-106287):
 *   ts.processHandler({
 *     type: 'hero',
 *     action: 'reborn',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     heros: e,           // array of hero instance IDs
 *     keepStar: t.heroRetainStar,  // boolean
 *     version: '1.0'
 *   }, callback(response))
 *
 * Response callback (main.min.js L106287-106289):
 *   1. t.removeHero(e, n)  → L106166-106260
 *      a. HerosManager.getInstance().removeHeroFromList(e[o]) — remove each hero
 *      b. n._changeInfo._items — update item balances via resetTtemsCallBack
 *      c. n._addHeroes — create new hero via SetHeroDataToModel + addToHeros
 *         → then calls hero/getAttrs for the new hero
 *      d. n._linkHeroes — optional resonance link update
 *   2. n._linkHeroes && HerosManager.getInstance().setDecomposeHeroLink(n._linkHeroes)
 *
 * ============================================================
 * DIAMOND COST (constant.json L75-81):
 * ============================================================
 *   rebirthWhite=0, rebirthGreen=0, rebirthBlue=0,
 *   rebirthPurple=5, rebirthOrange=20,
 *   rebirthFlickerOrange=50, rebirthSuperOrange=100
 *
 *   Cost dihitung dari kualitas TERTINGGI di antara hero yg dipilih.
 *   Client: ToolCommon.getHeroRebirthPrice(heroQuality) → L52098-52107
 *     → quality "white"→1 ... "superOrange"→7  → constant["rebirthXxx"]
 *
 * ============================================================
 * REFUND ITEMS (gainItemList L106060-106075):
 * ============================================================
 *   Dari hero.totalCost (7 sections: _wakeUp, _earring, _levelUp, _evolve,
 *   _skill, _qigong, _heroBreak):
 *
 *   If !keepStar:
 *     - Semua _wakeUp items (star-up materials) → refund penuh
 *     - Hero displayId sebagai item (level=1, star=0) → hanya UI display
 *   If keepStar:
 *     - Hero displayId dengan star asli → hanya UI display
 *   BOTH:
 *     - Semua _levelUp items (EXP capsule 131, gold 102, dll)
 *     - Semua _evolve items (evolve materials)
 *     - Semua _qigong items (EnergyStone=136: 80% refund, sisanya 100%)
 *     - Semua _heroBreak items
 *
 * ============================================================
 * EQUIPMENT UNEQUIP (BUG FIX):
 * ============================================================
 *   Saat hero di-reborn, semua equipment yg terpasang harus di-unequip
 *   di SERVER (bukan hanya client-side):
 *
 *   1) Sign/Imprint: savedData.imprint._items → cari yg _heroId == heroId → set ""
 *   2) Weapon:       savedData.weapon._items  → cari yg _heroId == heroId → set ""
 *   3) Genki:        savedData.genki._items   → cari yg _heroId == heroId → set ""
 *   4) Equip Gems:   savedData.gemstone._items → cari yg _heroId == heroId → set ""
 *
 *   5) Suit Items (armor, ID 3001-3500):  ← CONSUMABLE! Berbeda dari 1-4.
 *      savedData.equip._suits[heroId]._suitItems → baca setiap _id
 *      → addItems(savedData, equipId, +1) → kembalikan ke backpack
 *      → delete equip._suits[heroId] → hapus entry orphaned
 *      → kirim balance baru via _changeInfo._items
 *
 *      WHY: wearAuto deducts suit items from backpack (_num-1).
 *      Client removeHero does NOT handle suit items — server WAJIB.
 *
 *   Evidence: getHeroSign L106911, getHeroEquip L106918, removeHero L106166
 *
 * ============================================================
 * RESPONSE FORMAT:
 * ============================================================
 * {
 *   _changeInfo: {
 *     _items: { "101": {_id:101, _num:<ABSOLUTE_DIAMOND>},
 *               "102": {_id:102, _num:<ABSOLUTE_GOLD>},
 *               ... }
 *   },
 *   _addHeroes: [ { _heroId (SAMA dengan hero lama), _heroDisplayId, _heroStar, _heroBaseAttr:
 *     { _level:1, _hp, _attack, ... }, _totalCost: {...}, ... } ],
 *   _linkHeroes: undefined  // optional, client handles gracefully
 * }
 *
 * ============================================================
 * HERO DATA STORAGE (savedData.heros._heros):
 * ============================================================
 *   Format: { "<arbitraryKey>": { _heroId, _heroDisplayId, _heroStar,
 *     _heroBaseAttr: { _level, _hp, ... }, _totalCost: {
 *       _wakeUp: { _items: [...] }, _levelUp: { _items: [...] }, ... },
 *     ... }, ... }
 *
 *   Keys di _heros TIDAK sama dengan _heroId — harus ITERASI.
 *
 * ============================================================
 * ITEM STORAGE (savedData.totalProps._items):
 * ============================================================
 *   Format: [ { _id: <number>, _num: <number> }, ... ] (ARRAY)
 *   _changeInfo._items menggunakan ABSOLUTE balance.
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.hero) {
        MainServer.handlers.hero = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    /** Item IDs (matching autoLevelUp.js + main.min.js L78651) */
    var ITEM_IDS = {
        DIAMONDID: 101,
        GOLDID: 102,
        PLAYERLEVELID: 104,
        EXPERIENCECAPSULEID: 131,
        ENERGYSTONE: 136
    };

    /**
     * HERO_COLOR enum (main.min.js L44620-44635)
     * White=1, Green=2, Blue=3, Purple=4, Orange=5, SilverOrange=6, SuperOrange=7
     */
    var HERO_COLOR = {
        Unknown: 0,
        White: 1,
        Green: 2,
        Blue: 3,
        Purple: 4,
        Orange: 5,
        SilverOrange: 6,
        SuperOrange: 7
    };

    /**
     * Quality string → numeric HERO_COLOR (matches colorToHeroColor L52046-52047)
     */
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
     * Rebirth diamond cost by color (constant.json L75-81)
     * Index by HERO_COLOR numeric value:
     *   [0]=Unknown, [1]=White, [2]=Green, [3]=Blue, [4]=Purple,
     *   [5]=Orange, [6]=SilverOrange, [7]=SuperOrange
     */
    var REBIRTH_COST = [0, 0, 0, 0, 5, 20, 50, 100];

    /**
     * _totalCost section names (7 sections)
     * HeroTotalCost.deserialize L133362
     */
    var TOTAL_COST_SECTIONS = [
        '_wakeUp',
        '_levelUp',
        '_evolve',
        '_qigong',
        '_heroBreak'
    ];
    // NOTE: _earring dan _skill TIDAK di-refund oleh gainItemList client.
    // Ring/earring refund dihitung via getRingExpend() dari config JSON,
    // bukan dari totalCost._earring. Skill upgrade mungkin tidak refundable.

    // ═══════════════════════════════════════════════════════════
    //  RESOURCE CACHE & CONFIG LOADER
    // ═══════════════════════════════════════════════════════════

    var _resourceCache = {};

    function loadJsonSync(name) {
        if (_resourceCache[name]) return _resourceCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                _resourceCache[name] = data;
                return data;
            }
        } catch (e) {
            log.warn('RESOURCE', 'Failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJsonSync('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    function getConstant() {
        var c = loadJsonSync('constant');
        return c ? c[1] : null;
    }

    function getHeroLevelAttr(level) {
        var la = loadJsonSync('heroLevelAttr');
        return la ? la[String(level)] : null;
    }

    function getHeroQualityParam(quality) {
        var qp = loadJsonSync('heroQualityParam');
        return qp ? qp[quality] : null;
    }

    function getHeroTypeParam(heroType) {
        var tp = loadJsonSync('heroTypeParam');
        return tp ? tp[heroType] : null;
    }

    function getHeroEvolve(heroDisplayId) {
        var ev = loadJsonSync('heroEvolve');
        return ev ? ev[String(heroDisplayId)] : null;
    }

    function getHeroWakeUp(heroDisplayId) {
        var wu = loadJsonSync('heroWakeUp');
        return wu ? wu[String(heroDisplayId)] : null;
    }

    // ═══════════════════════════════════════════════════════════
    //  USER DATA HELPERS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'user:' + userId;
    }

    /**
     * getItemBalance — read item balance from totalProps._items array
     */
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

    /**
     * setItemBalance — set absolute item balance
     */
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

    /**
     * deductItem — deduct amount from item balance
     * @returns {number} new balance after deduction
     */
    function deductItem(savedData, itemId, amount) {
        var old = getItemBalance(savedData, itemId);
        var newVal = old - amount;
        if (newVal < 0) newVal = 0;
        setItemBalance(savedData, itemId, newVal);
        return newVal;
    }

    /**
     * addItems — add amount to item balance
     * @returns {number} new balance after addition
     */
    function addItems(savedData, itemId, amount) {
        var old = getItemBalance(savedData, itemId);
        var newVal = old + amount;
        setItemBalance(savedData, itemId, newVal);
        return newVal;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO LOOKUP HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * findHeroInStorage — iterates ALL keys in _heros to find hero
     * by _heroId (string/number) or _heroDisplayId.
     *
     * Keys in _heros are arbitrary (NOT _heroId), so direct lookup fails.
     * Pattern from autoLevelUp.js L596-605 — VERIFIED WORKING.
     *
     * @param {Object} savedData — full user save
     * @param {string|number} heroId — the heroId passed by client
     * @returns {Object|null} { hero: heroData, key: storageKey } or null
     */
    function findHeroInStorage(savedData, heroId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return null;
        var heroes = savedData.heros._heros;
        for (var k in heroes) {
            if (!heroes.hasOwnProperty(k)) continue;
            var hero = heroes[k];
            // Match by _heroId (string or number) OR _heroDisplayId
            if (hero._heroId === heroId ||
                hero._heroId === Number(heroId) ||
                String(hero._heroId) === String(heroId) ||
                hero._heroDisplayId === Number(heroId) ||
                String(hero._heroDisplayId) === String(heroId)) {
                return { hero: hero, key: k };
            }
        }
        return null;
    }

    /**
     * removeHeroFromUserData — delete hero by _heroId from _heros
     * @returns {boolean} true if hero was found and removed
     */
    function removeHeroFromUserData(savedData, heroId) {
        var found = findHeroInStorage(savedData, heroId);
        if (found) {
            delete savedData.heros._heros[found.key];
            return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  EQUIPMENT UNEQUIP HELPERS
    // ═══════════════════════════════════════════════════════════
    //
    //  Saat hero di-reborn, semua equipment yg terpasang di hero itu
    //  harus di-unequip di SERVER. Ini penting agar data persisten
    //  tetap konsisten setelah page refresh.
    //
    //  Evidence:
    //    - getHeroSign L106911:  signItem.heroId == heroId
    //    - getHeroEquip L106918: weapon.heroId == heroId
    //    - removeHero L106166:   s.heroId = "" (client-side unequip)
    //

    /**
     * unequipSigns — Set _heroId = "" untuk semua sign yg terpasang di hero
     *
     * savedData.imprint._items: array of { _id, _heroId, _displayId, ... }
     *
     * Evidence: getHeroSign L106911-106916
     *   SignInfoManager.getInstance().getAllSignInfo() → iterate, match heroId
     *   Client: s.heroId = "" (removeHero L106172)
     *
     * @param {Object} savedData
     * @param {string} heroInstanceId — hero _heroId value
     */
    function unequipSigns(savedData, heroInstanceId) {
        if (!savedData.imprint || !savedData.imprint._items) return;
        var signs = savedData.imprint._items;
        var unequipped = 0;
        for (var i = 0; i < signs.length; i++) {
            var sign = signs[i];
            if (sign._heroId === heroInstanceId || String(sign._heroId) === String(heroInstanceId)) {
                sign._heroId = '';
                unequipped++;
                log.info('REBORN', 'Unequipped sign id=' + sign._id + ' displayId=' + sign._displayId + ' from hero ' + heroInstanceId);
            }
        }
        if (unequipped > 0) {
            log.info('REBORN', 'Unequipped ' + unequipped + ' signs from hero ' + heroInstanceId);
        }
    }

    /**
     * unequipWeapons — Set _heroId = "" untuk semua weapon yg terpasang di hero
     *
     * savedData.weapon._items: object of { _heroId, _displayId, ... }
     *
     * Evidence: getOldWeapon L82765-82771
     *   EquipInfoManager.getInstance().WeaponDataArray[n].heroId == e
     *   Client: u.heroId = "" (removeHero L106180)
     *
     * @param {Object} savedData
     * @param {string} heroInstanceId — hero _heroId value
     */
    function unequipWeapons(savedData, heroInstanceId) {
        if (!savedData.weapon || !savedData.weapon._items) return;
        var weapons = savedData.weapon._items;
        var unequipped = 0;
        for (var key in weapons) {
            if (!weapons.hasOwnProperty(key)) continue;
            var weapon = weapons[key];
            if (weapon._heroId === heroInstanceId || String(weapon._heroId) === String(heroInstanceId)) {
                weapon._heroId = '';
                unequipped++;
                log.info('REBORN', 'Unequipped weapon id=' + key + ' displayId=' + weapon._displayId + ' from hero ' + heroInstanceId);
            }
        }
        if (unequipped > 0) {
            log.info('REBORN', 'Unequipped ' + unequipped + ' weapons from hero ' + heroInstanceId);
        }
    }

    /**
     * unequipGenki — Set _heroId = "" untuk semua genki yg terpasang di hero
     *
     * savedData.genki._items: array of { _id, _heroId, _heroPos, _displayId, ... }
     *
     * Evidence: getOldGenKiList L82773-82779
     *   EquipInfoManager.getInstance().genkiDataModel.items[o].heroId == e
     *   Client: p.heroId = "", p.heroPos = 0 (removeHero L106199)
     *
     * @param {Object} savedData
     * @param {string} heroInstanceId — hero _heroId value
     */
    function unequipGenki(savedData, heroInstanceId) {
        if (!savedData.genki || !savedData.genki._items) return;
        var genkiItems = savedData.genki._items;
        var unequipped = 0;
        for (var i = 0; i < genkiItems.length; i++) {
            var genki = genkiItems[i];
            if (genki._heroId === heroInstanceId || String(genki._heroId) === String(heroInstanceId)) {
                genki._heroId = '';
                genki._heroPos = 0;
                unequipped++;
                log.info('REBORN', 'Unequipped genki id=' + genki._id + ' displayId=' + genki._displayId + ' from hero ' + heroInstanceId);
            }
        }
        if (unequipped > 0) {
            log.info('REBORN', 'Unequipped ' + unequipped + ' genki items from hero ' + heroInstanceId);
        }
    }

    /**
     * unequipEquipGems — Set _heroId = "" untuk equip gems yg terpasang di hero
     *
     * savedData.gemstone._items: array of GemstoneItem
     * Masing-masing item memiliki _heroId dan _jewPosition
     *
     * Evidence: saveGemStone L83560-83567
     *   e.gemstone._items[n] → deserialize jadi GemstoneItem
     *   GemstoneItem punya .heroId (= _heroId di server) dan .jewPosition (= _jewPosition)
     *
     * Evidence: getHeroEquip L106920-106924
     *   EquipInfoManager.getInstance().getEquipGemByPosAndHeroId(r, e)
     *   Mencari gemstone dgn jewPosition == r && heroId == e
     *
     * @param {Object} savedData
     * @param {string} heroInstanceId — hero _heroId value
     */

    function unequipEquipGems(savedData, heroInstanceId) {
        if (!savedData.gemstone || !savedData.gemstone._items) return;
        var gems = savedData.gemstone._items;
        var unequipped = 0;
        for (var i = 0; i < gems.length; i++) {
            var gem = gems[i];
            if (gem._heroId === heroInstanceId || String(gem._heroId) === String(heroInstanceId)) {
                gem._heroId = '';
                unequipped++;
                log.info('REBORN', 'Unequipped equipGem id=' + gem._id + ' displayId=' + gem._displayId + ' pos=' + gem._jewPosition + ' from hero ' + heroInstanceId);
            }
        }
        if (unequipped > 0) {
            log.info('REBORN', 'Unequipped ' + unequipped + ' equip gems from hero ' + heroInstanceId);
        }
    }

    /**
     * unequipSuitItems — Return suit items (armor) from hero to backpack
     * and delete the equip._suits[heroInstanceId] entry.
     *
     * Suit items (ID 3001-3500) are CONSUMABLE — deducted from backpack
     * when equipped via wearAuto, MUST be returned when hero is reborn.
     *
     * Evidence:
     *   - wearAuto.js L680-691: consumes suit items (oldBal - 1)
     *   - wearAuto.js L663-676: returns old suit items (oldBal + 1)
     *   - wearAuto.js L693-706: stores refs in equip._suits[heroId]._suitItems
     *   - openCommonItemGetTips L79577: _changeInfo._items → setItem() (ABSOLUTE)
     *   - getHeroEquip L106918-106924: reads suitItems for preview ONLY
     *   - removeHero L106166-106224: NO suit item handling on client side
     *
     * CRITICAL: removeHero in client does NOT handle suit items.
     * Server MUST return suit items via _changeInfo._items.
     *
     * @param {Object} savedData
     * @param {string} heroInstanceId — hero _heroId value
     * @returns {Object} { itemId: count, ... } items returned to backpack
     */
    function unequipSuitItems(savedData, heroInstanceId) {
        var returned = {};

        if (!savedData.equip || !savedData.equip._suits) return returned;
        var suits = savedData.equip._suits;

        // Find the suit entry — key = heroInstanceId (string)
        var suitEntry = null;
        var suitKey = null;
        if (suits[heroInstanceId]) {
            suitEntry = suits[heroInstanceId];
            suitKey = heroInstanceId;
        } else {
            // Fallback: iterate keys (handle string/number mismatch)
            for (var k in suits) {
                if (!suits.hasOwnProperty(k)) continue;
                if (String(k) === String(heroInstanceId)) {
                    suitEntry = suits[k];
                    suitKey = k;
                    break;
                }
            }
        }

        if (!suitEntry || !suitEntry._suitItems || !Array.isArray(suitEntry._suitItems)) {
            log.info('REBORN', 'No suit items found for hero ' + heroInstanceId);
            return returned;
        }

        var suitItems = suitEntry._suitItems;
        for (var i = 0; i < suitItems.length; i++) {
            var item = suitItems[i];
            var equipId = Number(item._id);
            if (equipId <= 0) continue;

            // Return to backpack
            var newBalance = addItems(savedData, equipId, 1);
            var key = String(equipId);
            if (!returned[key]) returned[key] = 0;
            returned[key] += 1;

            log.info('REBORN', 'Returned suit item ' + equipId + ' to backpack → balance ' + newBalance);
        }

        // Delete the entire suit entry (orphaned data cleanup)
        if (suitKey !== null) {
            delete suits[suitKey];
            log.info('REBORN', 'Deleted equip._suits entry for hero ' + heroInstanceId + ' (key=' + suitKey + ')');
        }

        return returned;
    }

    /**
     * unequipAllFromHero — Unequip semua equipment dari hero tertentu
     *
     * NOTE: Suit items (armor) are NOT handled here because they are
     * consumable items that must be RETURNED to backpack, not just
     * unequipped. Call unequipSuitItems() separately.
     *
     * @param {Object} savedData
     * @param {string} heroInstanceId — hero _heroId value
     */
    function unequipAllFromHero(savedData, heroInstanceId) {
        log.info('REBORN', 'Unequipping all equipment from hero ' + heroInstanceId);
        unequipSigns(savedData, heroInstanceId);
        unequipWeapons(savedData, heroInstanceId);
        unequipGenki(savedData, heroInstanceId);
        unequipEquipGems(savedData, heroInstanceId);
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO QUALITY → DIAMOND COST
    // ═══════════════════════════════════════════════════════════

    /**
     * getHeroQualityColorNum — convert quality string to numeric color value
     *
     * Evidence: main.min.js L52046-52047: colorToHeroColor(quality)
     * "white"→1, "green"→2, "blue"→3, "purple"→4,
     * "orange"→5, "flickerOrange"→6, "superOrange"→7
     *
     * @param {string} qualityStr — from hero.json[displayId].quality
     * @returns {number|null} HERO_COLOR numeric value or null
     */
    function getHeroQualityColorNum(qualityStr) {
        return QUALITY_TO_COLOR[String(qualityStr)] || null;
    }

    /**
     * getRebirthDiamondCost — get diamond cost for a hero based on its quality
     *
     * Evidence: main.min.js L52098-52107
     * ToolCommon.getHeroRebirthPrice(heroQuality) → maps quality to constant reborn cost
     * constant.json: rebirthWhite=0, rebirthGreen=0, rebirthBlue=0,
     *                rebirthPurple=5, rebirthOrange=20,
     *                rebirthFlickerOrange=50, rebirthSuperOrange=100
     *
     * @param {number} colorNum — HERO_COLOR numeric value (1-7)
     * @returns {number} diamond cost
     */
    function getRebirthDiamondCost(colorNum) {
        if (colorNum >= 1 && colorNum <= 7) {
            return REBIRTH_COST[colorNum];
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO BASE ATTR COMPUTATION (for _addHeroes level 1)
    // ═══════════════════════════════════════════════════════════

    /**
     * makeHeroBasicAttr — create level 1 base attributes for reborn hero
     *
     * Reuses same logic as summonOne.js makeHeroBasicAttr.
     * Level=1, evolveLevel=0, starLevel=0 (or original if keepStar)
     *
     * @param {number} heroDisplayId — from hero.json
     * @param {number} level — hero level (1)
     * @param {number} starLevel — star level (0 or original)
     * @returns {Object|null} base attributes object
     */
    function makeHeroBasicAttr(heroDisplayId, level, starLevel) {
        level = level || 1;
        starLevel = starLevel || 0;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('REBORN', 'Hero config not found: ' + heroDisplayId);
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
            _evolveLevel: 0
        };

        // ── Evolve bonuses — none at evolveLevel=0 ──

        // ── WakeUp/Star bonuses ──
        if (starLevel > 0 && Array.isArray(wuEntries)) {
            for (var wi = 0; wi < wuEntries.length; wi++) {
                var wu = wuEntries[wi];
                if (starLevel >= (wu.star || 0)) {
                    talent += Number(wu.talent) || 0;
                    d._hp += Number(wu.hp) || 0;
                    d._attack += Number(wu.attack) || 0;
                    d._armor += Number(wu.armor) || 0;
                    d._speed += Number(wu.speed) || 0;
                }
            }
        }
        d._talent = talent;

        // ── Base stats: level × type × quality × balance ──
        var baseHp = (Number(la.hp) || 0) * (Number(tp.hpParam) || 0) + (Number(tp.hpBais) || 0);
        baseHp *= (Number(qp.hpParam) || 1) * (Number(hc.balanceHp) || 1);
        d._hp += baseHp;

        var baseAtk = (Number(la.attack) || 0) * (Number(tp.attackParam) || 0) + (Number(tp.attackBais) || 0);
        baseAtk *= (Number(qp.attackParam) || 1) * (Number(hc.balanceAttack) || 1);
        d._attack += baseAtk;

        var baseArm = (Number(la.armor) || 0) * (Number(tp.armorParam) || 0) + (Number(tp.armorBais) || 0);
        baseArm *= (Number(qp.armorParam) || 1) * (Number(hc.balanceArmor) || 1);
        d._armor += baseArm;

        // ── Flat stats dari hero config ──
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
    //  TOTAL COST PARSER
    // ═══════════════════════════════════════════════════════════

    /**
     * parseTotalCostItems — extract all item entries from a _totalCost section
     *
     * Format bisa OBJECT ({ "id": {_id, _num} }) atau ARRAY ([{_id, _num}]).
     *
     * @param {Object|Array} section — a _totalCost section (e.g., hero._totalCost._levelUp)
     * @returns {Array<{id: number, num: number}>}
     */
    function parseTotalCostItems(section) {
        var result = [];
        if (!section) return result;

        // Could have _items wrapper
        var items = section._items || section;

        if (Array.isArray(items)) {
            // Array format: [{ _id: 102, _num: 500 }, ...]
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item && item._id !== undefined) {
                    result.push({
                        id: Number(item._id),
                        num: Number(item._num) || 0
                    });
                }
            }
        } else if (typeof items === 'object') {
            // Object format: { "102": { _id: 102, _num: 500 }, ... }
            for (var key in items) {
                if (!items.hasOwnProperty(key)) continue;
                var item = items[key];
                if (item && item._id !== undefined) {
                    result.push({
                        id: Number(item._id),
                        num: Number(item._num) || 0
                    });
                }
            }
        }

        return result;
    }

    /**
     * sumRefundItems — collect all refund items from hero's _totalCost
     *
     * Evidence: gainItemList L106060-106075
     *
     * @param {Object} heroData — hero data from savedData
     * @param {boolean} keepStar — if true, skip wakeUp items
     * @returns {Object} { itemId: totalAmount, ... }
     */
    function sumRefundItems(heroData, keepStar) {
        var refund = {};
        var totalCost = heroData._totalCost;

        if (!totalCost) return refund;

        // Determine which sections to include — matches gainItemList (L106064-106073)
        var sectionsToProcess = [];

        // _wakeUp only if NOT keepStar (gainItemList L106064-106065)
        // If keepStar, wakeUp items are NOT refunded (star is preserved)
        if (!keepStar) {
            sectionsToProcess.push('_wakeUp');
        }

        // These sections are ALWAYS refunded (gainItemList L106069-106073)
        sectionsToProcess.push('_levelUp');
        sectionsToProcess.push('_evolve');
        sectionsToProcess.push('_qigong');
        sectionsToProcess.push('_heroBreak');
        // NOTE: _earring dan _skill tidak di-refund oleh gainItemList.
        // Ring refund dihitung via getRingExpend() dari config (ringLevelUp.json).
        // Skill upgrade mungkin tidak refundable.

        for (var si = 0; si < sectionsToProcess.length; si++) {
            var sectionName = sectionsToProcess[si];
            var section = totalCost[sectionName];
            var items = parseTotalCostItems(section);

            for (var ii = 0; ii < items.length; ii++) {
                var itemId = items[ii].id;
                var itemNum = items[ii].num;

                if (itemNum <= 0) continue;

                // EnergyStone (136) gets 80% refund (gainItemList L106070)
                if (itemId === ITEM_IDS.ENERGYSTONE && sectionName === '_qigong') {
                    itemNum = Math.floor(0.8 * itemNum);
                }

                if (itemNum > 0) {
                    if (!refund[itemId]) refund[itemId] = 0;
                    refund[itemId] += itemNum;
                }
            }
        }

        return refund;
    }

    // ═══════════════════════════════════════════════════════════
    //  FALLBACK CALCULATOR (ketika _totalCost kosong)
    // ═══════════════════════════════════════════════════════════
    //
    //  Handler autoLevelUp, evolve, wakeUp SEBELUMNYA tidak menyimpan
    //  _totalCost ke hero data. Untuk hero EXISTING, kita hitung refund
    //  dari current state (level, star, evolveLevel).
    //
    //  Formula mengikuti autoLevelUp.js getHeroLevelUpCost + multiplier.
    //

    /**
     * loadLevelUpCostTable — Load heroLevelUp{quality}.json
     */
    function loadLevelUpCostTable(qualityStr) {
        var name = 'heroLevelUp' + qualityStr.charAt(0).toUpperCase() + qualityStr.slice(1);
        return loadJsonSync(name);
    }

    /**
     * loadLevelUpMul — Load heroLevelUpMul.json
     */
    function loadLevelUpMul() {
        return loadJsonSync('heroLevelUpMul');
    }

    /**
     * calcLevelUpRefund — Hitung EXP + gold refund dari level
     *
     * @param {number} heroDisplayId
     * @param {number} currentLevel — current hero level
     * @param {number} evolveLevel — current evolve level
     * @returns {Object} { "131": totalExp, "102": totalGold }
     */
    function calcLevelUpRefund(heroDisplayId, currentLevel, evolveLevel) {
        var refund = {};
        if (currentLevel <= 1) return refund;

        var hc = getHeroConfig(heroDisplayId);
        if (!hc) return refund;

        var quality = hc.quality || 'purple';
        var qualityIndex = { white: 1, green: 2, blue: 3, purple: 4, orange: 5, flickerOrange: 6, superOrange: 7 };
        var qIndex = qualityIndex[quality] || 4;

        var costTable = loadLevelUpCostTable(quality);
        if (!costTable) return refund;

        var mulTable = loadLevelUpMul();

        var totalExp = 0;
        var totalGold = 0;

        for (var lvl = 1; lvl < currentLevel; lvl++) {
            var costEntry = costTable[String(lvl)];
            if (!costEntry) continue;

            var singleExp = Number(costEntry.num1) || 0;
            var singleGold = Number(costEntry.num2) || 0;

            // Apply multiplier
            if (mulTable) {
                var mulEntries = mulTable[String(qIndex)];
                if (Array.isArray(mulEntries)) {
                    for (var mi = 0; mi < mulEntries.length; mi++) {
                        var mul = mulEntries[mi];
                        if (Number(mul.evolveLevel) === evolveLevel) {
                            var mulVal = Number(mul.hpMul) || 1;
                            singleExp = Math.floor(singleExp * mulVal);
                            singleGold = Math.floor(singleGold * mulVal);
                            break;
                        }
                    }
                }
            }

            totalExp += singleExp;
            totalGold += singleGold;
        }

        if (totalExp > 0) {
            refund[String(ITEM_IDS.EXPERIENCECAPSULEID)] = totalExp;
        }
        if (totalGold > 0) {
            refund[String(ITEM_IDS.GOLDID)] = totalGold;
        }

        return refund;
    }

    /**
     * calcEvolveRefund — Hitung evolve material refund dari evolve level
     *
     * @param {number} heroDisplayId
     * @param {number} currentEvolveLevel
     * @returns {Object} { itemId: totalAmount, ... }
     */
    function calcEvolveRefund(heroDisplayId, currentEvolveLevel) {
        var refund = {};
        if (currentEvolveLevel <= 0) return refund;

        var evEntries = getHeroEvolve(heroDisplayId);
        if (!evEntries || !Array.isArray(evEntries)) return refund;

        for (var ei = 0; ei < evEntries.length; ei++) {
            var ev = evEntries[ei];
            var evLevel = Number(ev.level) || 0;
            if (evLevel > 0 && evLevel <= currentEvolveLevel) {
                var ids = [Number(ev.costID1) || 0, Number(ev.costID2) || 0, Number(ev.costID3) || 0];
                var nums = [Number(ev.num1) || 0, Number(ev.num2) || 0, Number(ev.num3) || 0];
                for (var i = 0; i < ids.length; i++) {
                    if (ids[i] > 0 && nums[i] > 0) {
                        var key = String(ids[i]);
                        if (!refund[key]) refund[key] = 0;
                        refund[key] += nums[i];
                    }
                }
                // Also check redEvolve (heroEvolveRed.json) if available
                var evRed = loadJsonSync('heroEvolveRed');
                if (evRed) {
                    var redEntry = evRed[String(heroDisplayId)];
                    if (redEntry) {
                        var redIds = [Number(redEntry.costID1) || 0, Number(redEntry.costID2) || 0, Number(redEntry.costID3) || 0];
                        var redNums = [Number(redEntry.num1) || 0, Number(redEntry.num2) || 0, Number(redEntry.num3) || 0];
                        for (var ri = 0; ri < redIds.length; ri++) {
                            if (redIds[ri] > 0 && redNums[ri] > 0) {
                                var rk = String(redIds[ri]);
                                if (!refund[rk]) refund[rk] = 0;
                                refund[rk] += redNums[ri];
                            }
                        }
                    }
                }
            }
        }

        return refund;
    }

    /**
     * calcWakeUpRefund — Hitung star-up material refund dari star level
     *
     * @param {number} heroDisplayId
     * @param {number} currentStar
     * @returns {Object} { itemId: totalAmount, ... }
     */
    function calcWakeUpRefund(heroDisplayId, currentStar) {
        var refund = {};
        if (currentStar <= 0) return refund;

        var wuEntries = getHeroWakeUp(heroDisplayId);
        if (!wuEntries || !Array.isArray(wuEntries)) return refund;

        for (var wi = 0; wi < wuEntries.length; wi++) {
            var wu = wuEntries[wi];
            var star = Number(wu.star) || 0;
            if (star > 0 && star <= currentStar) {
                // itemCost (dari itemID + num4/num5)
                var itemID = Number(wu.itemID) || 0;
                var itemNum = Number(wu.num4) || 0;
                if (itemID > 0 && itemNum > 0) {
                    var key = String(itemID);
                    if (!refund[key]) refund[key] = 0;
                    refund[key] += itemNum;
                }
                var redItemID = Number(wu.redItemID) || 0;
                var redItemNum = Number(wu.num5) || 0;
                if (redItemID > 0 && redItemNum > 0) {
                    var rk = String(redItemID);
                    if (!refund[rk]) refund[rk] = 0;
                    refund[rk] += redItemNum;
                }

                // material1,2,3 (piece costs)
                var materialIDs = [Number(wu.material1) || 0, Number(wu.material2) || 0, Number(wu.material3) || 0];
                var nums = [Number(wu.num1) || 0, Number(wu.num2) || 0, Number(wu.num3) || 0];
                var isPieces = [Number(wu.isPiece1) || 0, Number(wu.isPiece2) || 0, Number(wu.isPiece3) || 0];
                for (var i = 0; i < materialIDs.length; i++) {
                    if (materialIDs[i] > 0 && nums[i] > 0) {
                        var mk = String(materialIDs[i]);
                        if (!refund[mk]) refund[mk] = 0;
                        refund[mk] += nums[i];
                    }
                }
            }
        }

        return refund;
    }

    /**
     * calcHeroBreakRefund — Hitung refund dari break level
     *
     * @param {Object} breakInfo — hero._breakInfo
     * @returns {Object} { itemId: totalAmount, ... }
     */
    function calcHeroBreakRefund(breakInfo) {
        var refund = {};
        if (!breakInfo) return refund;
        var breakLevel = Number(breakInfo._breakLevel) || 1;
        var breakAttrLevel = Number(breakInfo._level) || 0;
        if (breakLevel <= 1 && breakAttrLevel <= 0) return refund;
        // Hero break costs vary — skip for now
        return refund;
    }

    /**
     * sumRefundItemsWithFallback — Collect refund, fallback ke state-based calc
     *
     * @param {Object} heroData — hero data from savedData
     * @param {boolean} keepStar — if true, skip wakeUp items
     * @returns {Object} { itemId: totalAmount, ... }
     */
    function sumRefundItemsWithFallback(heroData, keepStar) {
        // First try: read from _totalCost (accumulated by handlers)
        var refund = sumRefundItems(heroData, keepStar);

        var hasRefundItems = false;
        for (var rk in refund) {
            if (refund.hasOwnProperty(rk) && refund[rk] > 0) {
                hasRefundItems = true;
                break;
            }
        }

        if (hasRefundItems) {
            return refund;  // _totalCost has data, use it
        }

        // Fallback: _totalCost is empty, calculate from hero state
        log.info('REBORN', '_totalCost is empty — calculating refund from hero state');

        var heroDisplayId = Number(heroData._heroDisplayId);
        var currentLevel = Number(heroData._heroBaseAttr && heroData._heroBaseAttr._level) || 1;
        var currentEvolveLevel = Number(heroData._heroBaseAttr && heroData._heroBaseAttr._evolveLevel) || 0;
        var currentStar = Number(heroData._heroStar) || 0;
        var breakInfo = heroData._breakInfo;

        // Level-up refund (exp + gold)
        var levelUpRefund = calcLevelUpRefund(heroDisplayId, currentLevel, currentEvolveLevel);
        for (var lk in levelUpRefund) {
            if (!levelUpRefund.hasOwnProperty(lk)) continue;
            if (!refund[lk]) refund[lk] = 0;
            refund[lk] += levelUpRefund[lk];
        }

        // Evolve refund (materials)
        var evolveRefund = calcEvolveRefund(heroDisplayId, currentEvolveLevel);
        for (var ek in evolveRefund) {
            if (!evolveRefund.hasOwnProperty(ek)) continue;
            if (!refund[ek]) refund[ek] = 0;
            refund[ek] += evolveRefund[ek];
        }

        // Wake-up/star refund (only if !keepStar)
        if (!keepStar) {
            var wakeUpRefund = calcWakeUpRefund(heroDisplayId, currentStar);
            for (var wk in wakeUpRefund) {
                if (!wakeUpRefund.hasOwnProperty(wk)) continue;
                if (!refund[wk]) refund[wk] = 0;
                refund[wk] += wakeUpRefund[wk];
            }
        }

        // Hero break refund (if available)
        var breakRefund = calcHeroBreakRefund(breakInfo);
        for (var bk in breakRefund) {
            if (!breakRefund.hasOwnProperty(bk)) continue;
            if (!refund[bk]) refund[bk] = 0;
            refund[bk] += breakRefund[bk];
        }

        log.info('REBORN', 'Fallback refund calculated: ' + JSON.stringify(refund));
        return refund;
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD HERO DATA FOR _addHeroes
    // ═══════════════════════════════════════════════════════════

    /**
     * buildRebornHeroData — build hero data for _addHeroes response
     *
     * Hero baru dengan level=1, star=0 (atau original jika keepStar),
     * totalCost kosong (semua resource sudah direfund).
     *
     * Format mengikuti buildSummonHeroData dari summonOne.js L651-697
     * dan SetHeroDataToModel dari main.min.js L85391-85417.
     *
     * @param {number} heroDisplayId — dari hero.json
     * @param {string} newHeroId — unique hero instance ID
     * @param {number} starLevel — 0 or original star level if keepStar
     * @returns {Object|null} hero data object
     */
    function buildRebornHeroData(heroDisplayId, newHeroId, starLevel) {
        var hc = getHeroConfig(heroDisplayId);
        if (!hc) {
            log.error('REBORN', 'Cannot build reborn hero — config not found: ' + heroDisplayId);
            return null;
        }

        var heroTag = hc.tag ? hc.tag.split(',') : [];
        var baseAttr = makeHeroBasicAttr(heroDisplayId, 1, starLevel || 0);

        if (!baseAttr) {
            log.error('REBORN', 'Cannot build reborn hero — base attr failed: ' + heroDisplayId);
            return null;
        }

        var heroData = {
            _heroId: newHeroId,
            _heroDisplayId: heroDisplayId,
            _heroStar: starLevel || 0,
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

        return heroData;
    }

    // ═══════════════════════════════════════════════════════════
    //  HERO INSTANCE ID GENERATION
    // ═══════════════════════════════════════════════════════════

    /**
     * generateHeroInstanceId — find max _heroId + 1 for new hero
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
        return String(maxId + 1);
    }

    // ═══════════════════════════════════════════════════════════
    //  ADD HERO TO COLLECTION
    // ═══════════════════════════════════════════════════════════

    /**
     * addHeroToCollection — add hero data to savedData.heros._heros
     *
     * @param {Object} savedData
     * @param {Object} heroData — hero data object (with _heroId, _heroDisplayId, etc.)
     * @returns {string} the key used in _heros
     */
    function addHeroToCollection(savedData, heroData) {
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        var heros = savedData.heros._heros;
        // Find the next available sequential index as key
        var nextKey = 0;
        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;
            var k = parseInt(key, 10);
            if (!isNaN(k) && k >= nextKey) nextKey = k + 1;
        }

        heros[String(nextKey)] = heroData;
        log.info('REBORN', 'Added hero to collection: _heroId=' + heroData._heroId + ' displayId=' + heroData._heroDisplayId + ' key=' + nextKey);
        return String(nextKey);
    }


    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleReborn(data, callback) {
        var userId = data.userId;
        var heroIds = data.heros;       // array of hero instance IDs
        var keepStar = !!data.keepStar; // boolean

        log.info('HANDLER', 'hero/reborn called');
        log.details('request', [
            ['userId', userId],
            ['heros', JSON.stringify(heroIds)],
            ['keepStar', String(keepStar)]
        ]);

        // ── VALIDATION ──
        if (!userId || !heroIds || !Array.isArray(heroIds) || heroIds.length === 0) {
            log.error('HANDLER', 'hero/reborn — invalid request: missing userId or heros array');
            callback({}, 1);
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HANDLER', 'hero/reborn — user data not found: ' + userId);
            callback({}, 1);
            return;
        }

        // ── FIND ALL HEROES + CALCULATE HIGHEST QUALITY ──
        var foundHeroes = [];
        var highestColor = 0;  // HERO_COLOR numeric value

        for (var hi = 0; hi < heroIds.length; hi++) {
            var heroId = heroIds[hi];
            var found = findHeroInStorage(savedData, heroId);

            if (!found) {
                log.error('HANDLER', 'hero/reborn — hero not found: ' + heroId);
                callback({}, 1);
                return;
            }

            var heroData = found.hero;

            // Get hero displayId and config
            var heroDisplayId = Number(heroData._heroDisplayId);
            if (!heroDisplayId) {
                log.error('HANDLER', 'hero/reborn — invalid _heroDisplayId for hero ' + heroId + ': ' + heroData._heroDisplayId);
                callback({}, 1);
                return;
            }

            var heroEntry = getHeroConfig(String(heroDisplayId));
            if (!heroEntry) {
                log.error('HANDLER', 'hero/reborn — hero config not found for displayId: ' + heroDisplayId);
                callback({}, 1);
                return;
            }

            // Get quality and color
            var qualityStr = heroEntry.quality; // "white", "green", etc.
            var colorNum = getHeroQualityColorNum(qualityStr);
            if (!colorNum) {
                log.error('HANDLER', 'hero/reborn — unknown quality "' + qualityStr + '" for hero displayId ' + heroDisplayId);
                callback({}, 1);
                return;
            }

            // Track highest quality for diamond cost
            if (colorNum > highestColor) {
                highestColor = colorNum;
            }

            foundHeroes.push({
                heroId: heroId,
                heroData: heroData,
                heroDisplayId: heroDisplayId,
                colorNum: colorNum,
                heroInstanceId: String(heroData._heroId),  // the actual _heroId value
                heroKey: found.key  // key di _heros untuk update in-place
            });

            log.info('HANDLER', 'hero/reborn — found hero ' + heroId + ' (displayId=' + heroDisplayId + ', quality=' + qualityStr + '/' + colorNum + ')');
        }

        // ── CALCULATE DIAMOND COST (based on HIGHEST quality) ──
        var diamondCostPerHero = getRebirthDiamondCost(highestColor);
        var totalDiamondCost = diamondCostPerHero * foundHeroes.length;

        log.details('cost', [
            ['highestQualityColor', String(highestColor)],
            ['diamondCostPerHero', String(diamondCostPerHero)],
            ['heroCount', String(foundHeroes.length)],
            ['totalDiamondCost', String(totalDiamondCost)]
        ]);

        // ── CHECK DIAMOND BALANCE ──
        var currentDiamond = getItemBalance(savedData, ITEM_IDS.DIAMONDID);
        if (currentDiamond < totalDiamondCost) {
            log.error('HANDLER', 'hero/reborn — insufficient diamonds: need ' + totalDiamondCost + ' have ' + currentDiamond);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  STEP 1: UNEQUIP ALL EQUIPMENT FROM EACH HERO
        // ═══════════════════════════════════════════════════════
        //  Sign/Weapon/Genki/Gem: set _heroId="" → tetap ada di storage,
        //    hanya lepas dari hero. Client handle unequip lokal.
        //
        //  Suit Items (armor, ID 3001-3500): CONSUMABLE! Saat equip
        //    via wearAuto, item di-deduct dari backpack (_num-1).
        //    Saat reborn, item HARUS dikembalikan ke backpack (+1).
        //    Server kirim balance baru via _changeInfo._items.
        //    Client removeHero TIDAK handle suit items — server WAJIB.
        //
        var allSuitReturns = {};  // { itemId: totalAmount } from suit unequip

        for (var fi = 0; fi < foundHeroes.length; fi++) {
            var fh = foundHeroes[fi];
            log.info('REBORN', 'Unequipping hero ' + fh.heroInstanceId + ' (displayId=' + fh.heroDisplayId + ')');

            // 1a. Unequip sign/weapon/genki/gem (set _heroId="")
            unequipAllFromHero(savedData, fh.heroInstanceId);

            // 1b. Return suit items (armor) to backpack + delete orphaned entry
            var suitReturns = unequipSuitItems(savedData, fh.heroInstanceId);
            for (var srKey in suitReturns) {
                if (!suitReturns.hasOwnProperty(srKey)) continue;
                if (!allSuitReturns[srKey]) allSuitReturns[srKey] = 0;
                allSuitReturns[srKey] += suitReturns[srKey];
            }
        }

        // ═══════════════════════════════════════════════════════
        //  STEP 2: COLLECT REFUNDS + RESET HEROES IN-PLACE
        // ═══════════════════════════════════════════════════════
        var allRefundItems = {};  // { itemId: totalAmount }
        var addHeroes = [];       // _addHeroes array

        for (var fi = 0; fi < foundHeroes.length; fi++) {
            var fh = foundHeroes[fi];

            // 2a. Collect refund items from _totalCost
            var heroRefund = sumRefundItemsWithFallback(fh.heroData, keepStar);
            for (var itemId in heroRefund) {
                if (!heroRefund.hasOwnProperty(itemId)) continue;
                if (!allRefundItems[itemId]) allRefundItems[itemId] = 0;
                allRefundItems[itemId] += heroRefund[itemId];
            }

            // 2b. Build reset hero data — SAME _heroId as original
            //     Client akan removeHeroFromList(oldId) lalu addToHeros(sameId),
            //     jadi ID harus SAMA agar tidak konflik.
            var starLevel = keepStar ? Number(fh.heroData._heroStar) || 0 : 0;
            var originalHeroId = String(fh.heroData._heroId);
            var rebornHeroData = buildRebornHeroData(fh.heroDisplayId, originalHeroId, starLevel);

            if (rebornHeroData) {
                addHeroes.push(rebornHeroData);

                // 2c. Update hero data IN-PLACE in savedData (same key, same _heroId)
                if (fh.heroKey !== undefined && savedData.heros && savedData.heros._heros) {
                    savedData.heros._heros[fh.heroKey] = rebornHeroData;
                }

                log.info('HANDLER', 'hero/reborn — reset hero: displayId=' + fh.heroDisplayId + ' star=' + starLevel + ' heroId=' + originalHeroId);
            }

            log.info('HANDLER', 'hero/reborn — processed hero ' + fh.heroId + ' (displayId=' + fh.heroDisplayId + ')');
        }

        // STEP 3 dihapus — hero sudah di-update IN-PLACE di STEP 2c.

        // ═══════════════════════════════════════════════════════
        //  STEP 4: DEDUCT DIAMOND + ADD REFUND ITEMS
        // ═══════════════════════════════════════════════════════

        // 3a. Deduct diamond cost
        var diamondDeducted = deductItem(savedData, ITEM_IDS.DIAMONDID, totalDiamondCost);
        log.info('HANDLER', 'hero/reborn — diamond deducted: ' + totalDiamondCost + ' → balance ' + diamondDeducted);

        // 3b. Add refund items to inventory
        var changeItems = {};

        // Always include diamond balance
        changeItems[String(ITEM_IDS.DIAMONDID)] = {
            _id: ITEM_IDS.DIAMONDID,
            _num: diamondDeducted
        };

        var refundItemIds = Object.keys(allRefundItems);
        for (var ri = 0; ri < refundItemIds.length; ri++) {
            var rItemId = Number(refundItemIds[ri]);
            var rAmount = allRefundItems[refundItemIds[ri]];
            var newBalance = addItems(savedData, rItemId, rAmount);
            changeItems[String(rItemId)] = {
                _id: rItemId,
                _num: newBalance
            };
            log.info('HANDLER', 'hero/reborn — refund item ' + rItemId + ': +' + rAmount + ' → balance ' + newBalance);
        }

        // Include suit item balances (returned from equip._suits to backpack)
        var suitReturnIds = Object.keys(allSuitReturns);
        for (var si = 0; si < suitReturnIds.length; si++) {
            var sItemId = Number(suitReturnIds[si]);
            var sBalance = getItemBalance(savedData, sItemId);
            changeItems[String(sItemId)] = {
                _id: sItemId,
                _num: sBalance
            };
            log.info('HANDLER', 'hero/reborn — suit item ' + sItemId + ' returned → balance ' + sBalance);
        }

        // Also include gold (102) and EXP capsule (131) balances in _changeInfo
        // (they may have been modified by refund from _levelUp section)
        var goldBalance = getItemBalance(savedData, ITEM_IDS.GOLDID);
        var expBalance = getItemBalance(savedData, ITEM_IDS.EXPERIENCECAPSULEID);

        if (changeItems[String(ITEM_IDS.GOLDID)] === undefined) {
            changeItems[String(ITEM_IDS.GOLDID)] = {
                _id: ITEM_IDS.GOLDID,
                _num: goldBalance
            };
        }
        if (changeItems[String(ITEM_IDS.EXPERIENCECAPSULEID)] === undefined) {
            changeItems[String(ITEM_IDS.EXPERIENCECAPSULEID)] = {
                _id: ITEM_IDS.EXPERIENCECAPSULEID,
                _num: expBalance
            };
        }

        // ═══════════════════════════════════════════════════════
        //  STEP 5: SAVE USER DATA
        // ═══════════════════════════════════════════════════════
        db._set(key, savedData);
        log.info('HANDLER', 'hero/reborn — user data saved.');

        // ═══════════════════════════════════════════════════════
        //  STEP 6: BUILD RESPONSE
        // ═══════════════════════════════════════════════════════
        var response = {
            _changeInfo: {
                _items: changeItems
            }
        };

        // Only add _addHeroes if we have heroes to add
        if (addHeroes.length > 0) {
            response._addHeroes = addHeroes;
        }

        // _linkHeroes is intentionally omitted for mock server.
        // Client code checks: n._linkHeroes && ... → gracefully handles undefined

        log.details('response', [
            ['_changeInfo._items', JSON.stringify(changeItems)],
            ['_addHeroes', addHeroes.length > 0 ? String(addHeroes.length) + ' heroes' : 'none'],
            ['totalDiamondCost', String(totalDiamondCost)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'reborn', handleReborn);

    window.MainServer = MainServer;

})();
