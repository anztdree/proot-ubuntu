/**
 * readNew.js — Shop ReadNew Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS & TANGGUNG JAWAB:
 *   Handler untuk request: { type:"shop", action:"readNew", userId, marketType, version:"1.0" }
 *   Response:              { _newHeroes: { "heroDisplayId": true, ... } }
 *
 *   READ-ONLY — tidak ada perubahan data.
 *   Fungsi: kirim daftar hero yang dimiliki player (quality > Purple)
 *          untuk red dot indicator di shop UI.
 *
 *   Client (L133689-133703):
 *     - readShopNewHeroRed() kirim request dengan marketType
 *     - Response: ShopInfoManager.shopNewHero = e._newHeroes
 *     - isShopNewHeroRed(shopConfig) cek apakah goodsID di shop ada di newHeroes
 *     - Kalau ada → tampilkan red dot di tab shop
 *
 *   addShopNewHero (L3263824):
 *     Dipanggil saat player dapat hero baru (summon/buy)
 *     Hanya tambah kalau quality > Purple (S, SS, SSS)
 *     Key = heroDisplayId, value = true
 *
 *   Quality mapping:
 *     purple = A (skip)
 *     orange = S (include)
 *     flickerOrange = SS (include)
 *     superOrange = SSS (include)
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
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

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
            log.error('RESOURCE', 'readNew failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'readNew failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    function getHeroConfig(heroDisplayId) {
        var h = loadJsonSync('hero');
        return h ? h[String(heroDisplayId)] : null;
    }

    // Quality yang di-include: orange (S), flickerOrange (SS), superOrange (SSS)
    // purple (A) di-skip
    var INCLUDE_QUALITIES = {
        'orange': true,
        'flickerOrange': true,
        'superOrange': true
    };

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    /**
     * handleReadNew(request, callback)
     *
     * Request:
     *   { type:'shop', action:'readNew', userId, marketType, version:'1.0' }
     *
     * Response:
     *   { _newHeroes: { "heroDisplayId": true, ... } }
     *
     * @param {object} request
     * @param {function} callback(responseData)
     */
    function handleReadNew(request, callback) {
        var userId = request.userId;
        var marketType = request.marketType;

        log.info('HANDLER', 'shop/readNew — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['marketType', String(marketType || '(null)')]
        ]);

        // ── Validate userId ──
        if (!userId) {
            log.error('HANDLER', 'shop/readNew — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        // ── Load user data ──
        var storageKey = userStorageKey(userId);
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.error('HANDLER', 'shop/readNew — user data not found: ' + storageKey);
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        // ── Build _newHeroes ──
        var newHeroes = {};
        var heros = (savedData.heros && savedData.heros._heros) || {};

        for (var key in heros) {
            if (!heros.hasOwnProperty(key)) continue;

            var hero = heros[key];
            var heroDisplayId = Number(hero._heroDisplayId);
            if (!heroDisplayId) continue;

            // Cek apakah hero ini sudah pernah di-scan (avoid dup config lookup)
            if (newHeroes[String(heroDisplayId)]) continue;

            var hc = getHeroConfig(heroDisplayId);
            if (!hc) continue;

            var quality = hc.quality;
            if (INCLUDE_QUALITIES[quality]) {
                newHeroes[String(heroDisplayId)] = true;
            }
        }

        var heroCount = Object.keys(newHeroes).length;

        log.info('HANDLER', 'shop/readNew — SUCCESS');
        log.details('response', [
            ['totalHeroes', String(Object.keys(heros).length)],
            ['newHeroes', String(heroCount)]
        ]);

        callback({ _newHeroes: newHeroes });
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('shop', 'readNew', handleReadNew);

    window.MainServer = MainServer;
})();