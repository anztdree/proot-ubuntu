/**
 * handlers/heroImage/getAll.js — Hero Image / Illustrated Handbook Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: heroImage/getAll
 * ============================================================
 *
 * Client call (main.min.js L236709-236714):
 *   ts.processHandler({
 *     type: 'heroImage',
 *     action: 'getAll',
 *     userId: a,
 *     version: '1.0'
 *   }, callback)
 *
 * Dipanggil saat: "firstEnter" resource group selesai loading
 *   (setelah enterGame sukses, sebelum hero/getAttrs)
 *
 * Response di-consume oleh (main.min.js L134360-134377):
 *   HerosManager.getInstance().setAlreadyGainHeroID(e)
 *
 *   for (var n in e._heros) {
 *       var o = e._heros[n]._id;           // hero display ID
 *       a.id = o;
 *       a.maxLevel = e._heros[n]._maxLevel; // max level dari config
 *       a.selfComments = [];                 // komentar player untuk hero
 *       var r = e._heros[n]._selfComments;
 *       if (r) {
 *           for (var i = 0; i < r.length; i++) {
 *               a.selfComments.push(r[i]);
 *           }
 *       }
 *       t.alreadyGainHeroIDList[o] = a;
 *   }
 *   t.setSuperSkillBook(); // kosong, tidak melakukan apa-apa
 *
 * ============================================================
 * DATA SOURCE
 * ============================================================
 *
 * 1. IndexedDB: user:{userId}
 *    → heros._heros → daftar hero yang dimiliki player
 *    → setiap hero punya: _heroDisplayId, _heroBaseAttr._level
 *
 * 2. heroBook.json (via ReadJsonSingleton.getInstance().heroBook)
 *    → Config kamus hero: max level per hero berdasarkan quality
 *    → White/Green: level 100
 *    → Blue: level 100-120
 *    → Purple: level 120-160
 *    → Orange: level 160-200
 *
 * 3. heroBookRed.json (via ReadJsonSingleton.getInstance().heroBookRed)
 *    → Config kamus hero tier Red: max level 320
 *    → Priority lebih tinggi dari heroBook.json
 *
 * ============================================================
 * LOGIC
 * ============================================================
 *
 * 1. Baca hero yang dimiliki dari IndexedDB
 * 2. Untuk setiap hero:
 *    a. Skip jika tidak punya _heroDisplayId
 *    b. Skip jika TIDAK ada di heroBook.json maupun heroBookRed.json
 *       (hero musuh/enemy-only tidak dimasukkan)
 *    c. _maxLevel:
 *       - Cek heroBookRed.json dulu (Red tier → 320)
 *       - Kalau tidak ada, cek heroBook.json (normal → 100-200)
 *    d. _selfComments: selalu [] (sistem komentar belum ada)
 * 3. Kirim response
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.heroImage) {
        MainServer.handlers.heroImage = {};
    }

    // ================================================================
    // HELPER: Cek apakah hero ada di heroBook atau heroBookRed
    // ================================================================

    /**
     * isHeroInBook(heroDisplayId)
     *
     * Cek apakah hero ID tersebut terdaftar di kamus hero.
     * Hero yang tidak ada di kedua book = hero musuh/enemy-only,
     * TIDAK perlu dimasukkan ke response.
     *
     * @param {number} heroDisplayId — hero display ID (contoh: 1205)
     * @returns {boolean}
     */
    function isHeroInBook(heroDisplayId) {
        var id = String(heroDisplayId);
        var heroBook = ReadJsonSingleton.getInstance().heroBook;
        var heroBookRed = ReadJsonSingleton.getInstance().heroBookRed;

        if (heroBookRed && heroBookRed[id]) {
            return true;
        }
        if (heroBook && heroBook[id]) {
            return true;
        }
        return false;
    }

    // ================================================================
    // HELPER: Ambil max level dari heroBook/heroBookRed config
    // ================================================================

    /**
     * getHeroMaxLevel(heroDisplayId)
     *
     * Priority:
     *   1. heroBookRed.json → level 320 (Red tier)
     *   2. heroBook.json    → level 100-200 (normal tier)
     *   3. Tidak ada di keduanya → 0
     *
     * Catatan: heroBookRed.json menyimpan level sebagai STRING ("320"),
     *          heroBook.json menyimpan level sebagai NUMBER.
     *          Kedua kasus di-parse ke number via parseInt.
     *
     * @param {number} heroDisplayId
     * @returns {number} max level
     */
    function getHeroMaxLevel(heroDisplayId) {
        var id = String(heroDisplayId);

        // Priority 1: heroBookRed (Red tier heroes)
        var heroBookRed = ReadJsonSingleton.getInstance().heroBookRed;
        if (heroBookRed && heroBookRed[id]) {
            var level = heroBookRed[id].level;
            return parseInt(level, 10) || 0;
        }

        // Priority 2: heroBook (normal heroes)
        var heroBook = ReadJsonSingleton.getInstance().heroBook;
        if (heroBook && heroBook[id]) {
            var level = heroBook[id].level;
            return parseInt(level, 10) || 0;
        }

        return 0;
    }

    // ================================================================
    // HANDLER: heroImage/getAll
    // ================================================================

    /**
     * handleGetAll(request, callback)
     *
     * Mengirim daftar hero yang sudah pernah dimiliki player,
     * beserta level max-nya sesuai config kamus hero.
     *
     * @param {object} request
     *   { type:'heroImage', action:'getAll', userId, version:'1.0' }
     *
     * @param {function} callback
     *   callback(responseData)
     *
     * Response:
     *   {
     *     _heros: {
     *       "0": { _id: 1205, _maxLevel: 160, _selfComments: [] },
     *       "1": { _id: 1401, _maxLevel: 320, _selfComments: [] }
     *     }
     *   }
     */
    function handleGetAll(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'heroImage/getAll processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            // ── Validasi userId ──
            if (!userId) {
                log.error('HANDLER', 'Missing userId in heroImage/getAll');
                callback({ _heros: {} });
                return;
            }

            // ── Step 1: Baca data user dari DB ──
            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);

            if (!savedData || !savedData.heros || !savedData.heros._heros) {
                log.warn('HANDLER', 'No hero data found in DB');
                log.details('detail', [
                    ['storageKey', storageKey],
                    ['savedData exists', savedData ? 'yes' : 'no'],
                    ['heros exists', (savedData && savedData.heros) ? 'yes' : 'no'],
                    ['_heros exists', (savedData && savedData.heros && savedData.heros._heros) ? 'yes' : 'no']
                ]);
                callback({ _heros: {} });
                return;
            }

            // ── Step 2: Iterasi setiap hero yang dimiliki ──
            var heroesStorage = savedData.heros._heros;
            var response = { _heros: {} };
            var index = 0;
            var skippedNoDisplayId = 0;
            var skippedNotInBook = 0;

            for (var key in heroesStorage) {
                var hero = heroesStorage[key];
                var heroDisplayId = hero._heroDisplayId;

                // ── Skip: hero tanpa displayId ──
                if (!heroDisplayId) {
                    skippedNoDisplayId++;
                    log.debug('HANDLER', 'Skip hero without _heroDisplayId (index: ' + key + ')');
                    continue;
                }

                // ── Skip: hero tidak ada di kamus (hero musuh/enemy-only) ──
                if (!isHeroInBook(heroDisplayId)) {
                    skippedNotInBook++;
                    log.debug('HANDLER', 'Skip hero not in book: ' + heroDisplayId);
                    continue;
                }

                // ── Step 3: Ambil max level dari config ──
                var maxLevel = getHeroMaxLevel(heroDisplayId);

                // ── Step 4: Masukkan ke response ──
                // v3 FIX: Key = hero display ID (String), BUKAN sequential index
                // Evidence HAR: keys = '1003','1105','1205','1206','1309','1320'
                // Client L134360: for (var n in e._heros) { var o = e._heros[n]._id; ... }
                response._heros[String(heroDisplayId)] = {
                    _id: heroDisplayId,
                    _maxLevel: maxLevel,
                    _selfComments: []
                };

                index++;
            }

            // ── Log hasil ──
            log.info('HANDLER', 'heroImage/getAll success');
            log.details('response', [
                ['heroCount', String(index)],
                ['skippedNoDisplayId', String(skippedNoDisplayId)],
                ['skippedNotInBook', String(skippedNotInBook)]
            ]);

            // Log detail setiap hero
            var heroKeys = Object.keys(response._heros);
            for (var h = 0; h < heroKeys.length; h++) {
                var hKey = heroKeys[h];
                var heroData = response._heros[hKey];
                log.details('hero[' + hKey + ']', [
                    ['_id', String(heroData._id)],
                    ['_maxLevel', String(heroData._maxLevel)],
                    ['_selfComments', '[] (' + heroData._selfComments.length + ')']
                ]);
            }

            // ── Step 5: Kirim response ──
            callback(response);

        } catch (err) {
            log.error('HANDLER', 'heroImage/getAll UNCAUGHT ERROR', err);
            callback({ _heros: {} });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════════

    MainServer.registerHandler('heroImage', 'getAll', handleGetAll);

    window.MainServer = MainServer;
})();
