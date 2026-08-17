/**
 * handlers/hero/getAttrs.js — Hero FULL Attribute Computation Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * MIGRATED to use MainServer.heroStats (heroStats.js)
 * ============================================================
 * All stat computation logic moved to heroStats.js.
 * This file now only handles: request parsing, multi-hero loop, response formatting.
 *
 * Client call (main.min.js L84786-84795):
 *   ts.processHandler({
 *     type: 'hero', action: 'getAttrs', userId, heros: [heroId1, ...], version: '1.0'
 *   }, callback(response))
 *
 * Response format (VERIFIED from HAR):
 *   {
 *     type: 'hero', action: 'getAttrs', userId, heros, version: '1.0',
 *     _attrs:      [ { _items: { "0":{_id:0,_num:val}, ... } } ],  ← ARRAY
 *     _baseAttrs:  [ { _items: { "0":{_id:0,_num:val}, ... } } ]   ← ARRAY
 *   }
 *
 * _baseAttr: 35 items — IDs 0-15, 23-41 (NO 16-22)
 *   Raw base stats WITHOUT talent multiplication.
 *   Client applies talent on hp/attack in setBaseAttr.
 *
 * _totalAttr: 42 items — IDs 0-41 (complete)
 *   Display stats WITH talent + percent + power.
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
    //  HANDLER: hero/getAttrs
    // ═══════════════════════════════════════════════════════════

    function handleGetAttrs(request, callback) {
        var userId = request.userId;
        var heroIds = request.heros;

        log.info('HANDLER', 'hero/getAttrs processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['heroCount', String(heroIds ? heroIds.length : 0)],
            ['version', request.version || '-']
        ]);

        try {
            if (!userId || !heroIds || !Array.isArray(heroIds) || heroIds.length === 0) {
                log.warn('HANDLER', 'hero/getAttrs — missing userId or heros array');
                callback({
                    type: 'hero', action: 'getAttrs', userId: userId, heros: heroIds, version: '1.0',
                    _attrs: [], _baseAttrs: []
                });
                return;
            }

            var savedData = db._get('user:' + userId);
            if (!savedData) {
                log.warn('HANDLER', 'hero/getAttrs — user data not found');
                callback({
                    type: 'hero', action: 'getAttrs', userId: userId, heros: heroIds, version: '1.0',
                    _attrs: [], _baseAttrs: []
                });
                return;
            }

            // ── Use shared heroStats engine ──
            var heroStats = MainServer.heroStats;
            if (!heroStats) {
                log.error('HANDLER', 'hero/getAttrs — heroStats module not loaded!');
                callback({
                    type: 'hero', action: 'getAttrs', userId: userId, heros: heroIds, version: '1.0',
                    _attrs: [], _baseAttrs: []
                });
                return;
            }

            var result = heroStats.computeMultiHeroStats(heroIds, savedData);

            // Log per-hero stats for debugging
            for (var i = 0; i < heroIds.length; i++) {
                var singleResult = heroStats.computeHeroStats(heroIds[i], savedData);
                if (singleResult) {
                    log.details('hero[' + i + ']', [
                        ['heroId', String(heroIds[i])],
                        ['talent', String(singleResult.talent)],
                        ['power', String(singleResult.totalItems['21'] ? singleResult.totalItems['21']._num : '?')]
                    ]);
                }
            }

            log.info('HANDLER', 'hero/getAttrs success — processed ' + heroIds.length + ' heroes');

            callback({
                type: 'hero',
                action: 'getAttrs',
                userId: userId,
                heros: heroIds,
                version: '1.0',
                _attrs: result.attrs,
                _baseAttrs: result.baseAttrs
            });

        } catch (err) {
            log.error('HANDLER', 'hero/getAttrs UNCAUGHT ERROR', err);
            callback({
                type: 'hero', action: 'getAttrs', userId: userId, heros: heroIds, version: '1.0',
                _attrs: [], _baseAttrs: []
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hero', 'getAttrs', handleGetAttrs);

    window.MainServer = MainServer;
})();
