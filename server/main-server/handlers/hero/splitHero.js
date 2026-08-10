/**
 * handlers/hero/splitHero.js
 *
 * ============================================================
 * HANDLER: hero/splitHero
 * TYPE: hero  |  ACTION: splitHero
 *
 * Split/decompose hero → return hero-specific pieces (heroPiece).
 * Beda dengan hero/resolve yang kasih soul stone (item 111).
 *
 * ============================================================
 * MECHANICS
 * ============================================================
 *   Buka 1 hero → dapat heroPiece sesuai hero tersebut:
 *     - Cari heroDisplayId dari hero data
 *     - Cari di heroPiece.json: belongTo === heroDisplayId
 *     - Dapat pieceId (entry.id) + mergeNum (jumlah piece)
 *     - mergeNum = jumlah piece yang dibutuhkan untuk summon hero tsb
 *
 *   Contoh: Split hero 1001 (displayId=1001, quality=white)
 *     heroPiece.json: belongTo=1001 → pieceId=2001, mergeNum=10
 *     → Player dapat +10 piece 2001
 *
 * ============================================================
 * CLIENT CALL SITES (main.min(unminfy).js)
 * ============================================================
 *
 * [CALL SITE 1 — Hero Info Resolve Button] L123170-123192:
 *   resolveBtnTap():
 *     var i = [];
 *     i.push(e.choseHeroId);  // SINGLE hero UUID
 *     ts.processHandler({
 *       type: "hero", action: "splitHero",
 *       userId, heros: i, version: "1.0"
 *     }, function(t) {
 *       t._linkHeroes && HerosManager.setDecomposeHeroLink(t._linkHeroes)
 *       HeroCommon.removeHeroBackWithServerData(e.choseHeroId, t, callback)
 *     })
 *
 * [CALL SITE 2 — WakeUp Chose Resolve] L124690-124709:
 *   a.push(e);  // SINGLE hero UUID
 *   ts.processHandler({
 *     type: "hero", action: "splitHero",
 *     userId, heros: a, version: "1.0"
 *   }, function(o) {
 *     HerosManager.removeHeroFromList(e);
 *     o._linkHeroes && HerosManager.setDecomposeHeroLink(o._linkHeroes)
 *     HeroCommon.removeHeroBackWithServerData(e, o, callback)
 *   })
 *
 * ============================================================
 * REQUEST FORMAT
 * ============================================================
 * {
 *   type: "hero",
 *   action: "splitHero",
 *   userId: "...",
 *   heros: ["heroUuid1"],  // array, typically 1 hero
 *   version: "1.0"
 * }
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 * {
 *   _changeInfo: {
 *     _items: {
 *       "<pieceId>": { _id: <pieceId>, _num: <ABSOLUTE_BALANCE> }
 *     }
 *   }
 *   // _linkHeroes: omitted (client checks && before using)
 * }
 *
 * Client flow (removeHeroBackWithServerData L53569-53625):
 *   1. Collect equipment from hero CLIENT-SIDE (weapon, signs, genki, gems)
 *   2. HerosManager.removeHeroFromList(heroId) — remove from local list
 *   3. If t._addHeroes → add new heroes (NOT used for splitHero)
 *   4. ItemsCommonSingleton.openCommonItemGetTips(t._changeInfo._items, equipArray, cb)
 *      → shows reward popup with hero pieces
 *
 * _linkHeroes format: [{ hero, basicAttr, totalAttr }, ...]
 *   → Used when decomposed hero was in a resonance link
 *   → Omitted for mock server (client handles gracefully with && check)
 *
 * ============================================================
 * CONFIG FILES
 * ============================================================
 *   heroPiece.json — { pieceId: { id, belongTo, mergeNum, quality, ... } }
 *     belongTo = heroDisplayId yang piece ini miliki
 *     mergeNum = jumlah piece untuk summon hero tsb
 *   hero.json — hero definitions (quality field)
 *
 * ============================================================
 * HERO → PIECE MAPPING (client L52368-52371):
 *   getPieceIdWithHeroId(displayId):
 *     for(n in heroPiece) if(heroPiece[n].belongTo == displayId) return heroPiece[n].id
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
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
            log.error('HERO_SPLIT', 'failed to load ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('HERO_SPLIT', 'failed to load ' + name + '.json — ' + e.message);
        }
        return null;
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

    /**
     * Iterate ALL keys in _heros to find hero by _heroId or _heroDisplayId.
     * Keys in _heros are arbitrary (NOT _heroId).
     * Pattern: autoLevelUp.js findHeroInStorage (L596-605)
     */
    function findHeroInStorage(savedData, heroId) {
        if (!savedData || !savedData.heros || !savedData.heros._heros) return null;
        var heroes = savedData.heros._heros;
        for (var k in heroes) {
            if (!heroes.hasOwnProperty(k)) continue;
            var hero = heroes[k];
            if (hero._heroId === heroId || hero._heroId === Number(heroId) ||
                hero._heroDisplayId === Number(heroId) || String(hero._heroDisplayId) === String(heroId)) {
                return { hero: hero, key: k };
            }
        }
        return null;
    }

    function removeHeroFromUserData(savedData, heroId) {
        var found = findHeroInStorage(savedData, heroId);
        if (found) {
            delete savedData.heros._heros[found.key];
            return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  PIECE LOOKUP — heroDisplayId → { pieceId, mergeNum }
    // ═══════════════════════════════════════════════════════════

    /**
     * Cari pieceId dan mergeNum untuk hero berdasarkan displayId.
     * Client equivalent: getPieceIdWithHeroId (L52368-52371)
     *   for(n in heroPiece) if(heroPiece[n].belongTo == displayId) return heroPiece[n].id
     *
     * @param {Object} heroPieceConfig — parsed heroPiece.json
     * @param {number} heroDisplayId — hero._heroDisplayId
     * @returns {{ pieceId: number, mergeNum: number } | null}
     */
    function findHeroPiece(heroPieceConfig, heroDisplayId) {
        if (!heroPieceConfig || !heroDisplayId) return null;
        for (var k in heroPieceConfig) {
            if (!heroPieceConfig.hasOwnProperty(k)) continue;
            var entry = heroPieceConfig[k];
            if (Number(entry.belongTo) === Number(heroDisplayId)) {
                return {
                    pieceId: Number(entry.id),
                    mergeNum: Number(entry.mergeNum) || 0
                };
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleSplitHero(request, callback) {
        var userId = request.userId;
        var heros = request.heros;

        log.info('HANDLER', 'hero/splitHero — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['heros', JSON.stringify(heros || [])],
            ['version', request.version || '-']
        ]);

        // ── VALIDATE ──
        if (!userId) {
            log.error('HERO_SPLIT', 'missing userId');
            callback({}, 1);
            return;
        }
        if (!heros || !Array.isArray(heros) || heros.length === 0) {
            log.error('HERO_SPLIT', 'heros is empty or not an array');
            callback({}, 1);
            return;
        }

        // ── LOAD CONFIG ──
        var heroPieceConfig = loadJson('heroPiece');
        if (!heroPieceConfig) {
            log.error('HERO_SPLIT', 'failed to load heroPiece.json');
            callback({}, 1);
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HERO_SPLIT', 'user data not found: ' + key);
            callback({}, 1);
            return;
        }
        if (!savedData.heros) savedData.heros = { _heros: {} };
        if (!savedData.heros._heros) savedData.heros._heros = {};

        // ── PROCESS EACH HERO ──
        var pieceRewards = {};  // { pieceId: totalAmount }
        var splitCount = 0;
        var errors = [];

        for (var i = 0; i < heros.length; i++) {
            var heroId = heros[i];

            // 1. Find hero in user data
            var found = findHeroInStorage(savedData, heroId);
            if (!found) {
                log.error('HERO_SPLIT', 'hero not found: ' + heroId);
                errors.push('hero_not_found:' + heroId);
                continue;
            }
            var heroData = found.hero;

            // 2. Get heroDisplayId
            var heroDisplayId = Number(heroData._heroDisplayId);
            if (!heroDisplayId) {
                log.error('HERO_SPLIT', 'invalid _heroDisplayId for ' + heroId);
                errors.push('invalid_displayId:' + heroId);
                continue;
            }

            // 3. Find piece via heroPiece.json (belongTo === heroDisplayId)
            var piece = findHeroPiece(heroPieceConfig, heroDisplayId);
            if (!piece) {
                log.error('HERO_SPLIT', 'no piece found for hero displayId: ' + heroDisplayId);
                errors.push('no_piece:' + heroDisplayId);
                continue;
            }

            // 4. Accumulate piece reward
            if (!pieceRewards[piece.pieceId]) {
                pieceRewards[piece.pieceId] = 0;
            }
            pieceRewards[piece.pieceId] += piece.mergeNum;

            // 5. Remove hero from user data
            var removed = removeHeroFromUserData(savedData, heroId);
            if (removed) {
                splitCount++;
                log.details('split', [
                    ['heroId', String(heroId)],
                    ['displayId', String(heroDisplayId)],
                    ['pieceId', String(piece.pieceId)],
                    ['mergeNum', String(piece.mergeNum)]
                ]);
            } else {
                log.error('HERO_SPLIT', 'failed to remove hero ' + heroId);
                errors.push('remove_failed:' + heroId);
            }
        }

        // ── CHECK RESULTS ──
        if (splitCount === 0) {
            log.error('HERO_SPLIT', 'no heroes split. Errors: ' + JSON.stringify(errors));
            callback({}, 1);
            return;
        }

        // ── UPDATE ITEM BALANCES ──
        var changeItems = {};
        var rewardIds = Object.keys(pieceRewards);
        for (var j = 0; j < rewardIds.length; j++) {
            var itemId = rewardIds[j];
            var amount = pieceRewards[itemId];
            var newBalance = addItems(savedData, Number(itemId), amount);
            changeItems[itemId] = {
                _id: Number(itemId),
                _num: newBalance
            };
            log.info('HERO_SPLIT', 'piece ' + itemId + ': +' + amount + ' → balance ' + newBalance);
        }

        // ── SAVE USER DATA ──
        db._set(key, savedData);
        log.info('HANDLER', 'hero/splitHero SUCCESS — split ' + splitCount + ' hero(es)');

        // ── BUILD RESPONSE ──
        // _linkHeroes intentionally omitted (same as resolve.js).
        // Client checks: t._linkHeroes && HerosManager.setDecomposeHeroLink(t._linkHeroes)
        var response = {
            _changeInfo: {
                _items: changeItems
            }
        };

        log.details('response', [
            ['_changeInfo._items', JSON.stringify(changeItems)],
            ['splitCount', String(splitCount)],
            ['errors', JSON.stringify(errors)]
        ]);

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'splitHero', handleSplitHero);

})();