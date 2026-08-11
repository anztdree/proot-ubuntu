/**
 * handlers/guild/upgradeTech.js — Upgrade Guild Tech Handler (DRAFT)
 * Super Warrior Z — MAIN SERVER
 *
 * ════════════════════════════════════════════════════════════════
 * VERIFIKASI SUMBER UTAMA: main.min(unminfy).js
 * ════════════════════════════════════════════════════════════════
 *
 * 1. REQUEST (L141322):
 *    ts.processHandler({
 *        type: "guild",
 *        action: "upgradeTech",
 *        userId: n,
 *        techType: r,        // TechGroupType: strength=2, body=1, skill=3
 *        techId: a.id,       // tech point ID (from guildTech JSON)
 *        times: e,           // 1 = single, 10 = auto-up
 *        version: "1.0"
 *    }, callback)
 *
 * 2. CALLBACK (L141332):
 *    a) TeamTechnologyManager.saveGuildTechLevel(e)    — L86831
 *       reads: e.techType, e.techId, e._level, e._attrs, e._totalCost, e._totalLevel
 *       - e._attrs._items: {"0":{"_id":0,"_num":2780}, "37":{"_id":37,"_num":0.03}}
 *         → each item is AttrItem {id, num} (strip _)
 *       - e._totalCost._items: {"114":{"_id":114,"_num":29800}}
 *         → each item is AttrItem {id, num} (strip _) — cumulative total cost for this techType
 *       - e._level: number — tech item NEW level after upgrade
 *       - e._totalLevel: number — total levels for entire techType
 *
 *    b) HerosManager.setTotalAttrsByHeroIdNotChange(e._updateAttrs[heroId], heroId)
 *       — L141334
 *       e._updateAttrs = {heroId: {"_items": {"0":{"_id":0,"_num":532064}, ...}}}
 *       Dict keyed by heroId, each value is _items with full attr set (42 attrs: id 0-41)
 *       Updates totalAttr per hero — FULL set, not delta
 *
 *    c) ItemsCommonSingleton.resetTtemsCallBack(e)    — L141335
 *       reads e._changeInfo._items: {"114":{"_id":114,"_num":266}}
 *       _num = remaining item count AFTER spending (not delta/negative)
 *
 * 3. GuildTech.deserialize (L87040):
 *    - _totalCost._items → AttrItem[] (special, kept as _items)
 *    - _techItems → GuildTechItem dict (special, kept as techItems)
 *    - _totalLevel (common → strip _ → totalLevel)
 *    - _firstRest (common → strip _ → firstRest)
 *
 * 4. GuildTechItem.deserialize (L87063):
 *    - _attrs._items → AttrItem[] (special, kept as _items)
 *    - level, parent (common)
 *
 * 5. AttrItem.deserialize (L87081):
 *    - _id, _num (common → strip _ → id, num)
 *
 * 6. TechGroupType enum (L87102):
 *    body=1, strength=2, skill=3
 *
 * 7. HAR pattern confirms:
 *    - Echo: type, action, userId, techType, techId, times, version
 *    - Data: _changeInfo, _level, _attrs, _totalCost, _totalLevel, _updateAttrs
 *    - _changeInfo._items: SISA item setelah beli (bukan delta negatif)
 *    - _totalCost._items: cumulative total cost for entire techType
 *    - _updateAttrs: dict {heroId: {"_items": {"0":{"_id":0,"_num":...}, ...}}}
 *      → 42 attr slots (0-41), full replacement
 * ════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ════════════════════════════════════════════════════════════════
    // DUMMY HERO ATTRS — 42 slots (id 0–41) representing full
    // totalAttr set for a hero. Real server recalculates per hero
    // after tech level changes. We return zeroed set as stub.
    // ════════════════════════════════════════════════════════════════

    function buildDummyHeroAttrs() {
        var items = {};
        for (var i = 0; i <= 41; i++) {
            items[String(i)] = { _id: i, _num: 0 };
        }
        return items;
    }

    // ════════════════════════════════════════════════════════════════
    // MAIN HANDLER: guild/upgradeTech
    // ════════════════════════════════════════════════════════════════

    function handleUpgradeTech(request, callback) {
        var userId = request.userId;
        var techType = request.techType;   // TechGroupType: body=1, strength=2, skill=3
        var techId = request.techId;       // tech point ID from guildTech JSON
        var times = request.times || 1;    // 1=single, 10=auto-up

        log.info('HANDLER', 'guild/upgradeTech');
        log.details('request', [
            ['userId', userId || '-'],
            ['techType', String(techType)],
            ['techId', String(techId)],
            ['times', String(times)]
        ]);

        // ═══════════════════════════════════════════════════════════
        // _level: tech item new level after upgrade
        // _attrs: new cumulative attributes for this tech item
        //   Format: {"_items": {"0":{"_id":0,"_num":2780}, "37":{"_id":37,"_num":0.03}}}
        //   Each _items entry = AttrItem (deserialize: strip _ → {id, num})
        // ═══════════════════════════════════════════════════════════
        var attrs = {
            _items: {
                "0": { _id: 0, _num: 100 }    // HP attr (dummy)
            }
        };

        // ═══════════════════════════════════════════════════════════
        // _totalCost: cumulative total cost for this techType
        //   Format: {"_items": {"114":{"_id":114,"_num":29800}}}
        //   GuildTech.deserialize reads this into totalCost[]
        // ═══════════════════════════════════════════════════════════
        var totalCost = {
            _items: {
                "114": { _id: 114, _num: 1000 }   // guild coin (item 114)
            }
        };

        // ═══════════════════════════════════════════════════════════
        // _changeInfo: item inventory update (remaining count, NOT delta)
        //   Format: {"_items": {"114":{"_id":114,"_num":266}}}
        //   Client reads via resetTtemsCallBack → updates item counts
        // ═══════════════════════════════════════════════════════════
        var changeInfo = {
            _items: {
                "114": { _id: 114, _num: 9999 }   // remaining guild coins
            }
        };

        // ═══════════════════════════════════════════════════════════
        // _updateAttrs: dict {heroId: {"_items": {"0":{"_id":0,"_num":...}, ...}}}
        //   Full 42-attr set per hero (0-41). Client replaces hero totalAttr.
        //   Used by HerosManager.setTotalAttrsByHeroIdNotChange
        //   Stub: return dummy attrs for requesting user only.
        // ═══════════════════════════════════════════════════════════
        var updateAttrs = {};
        updateAttrs[userId] = {
            _items: buildDummyHeroAttrs()
        };

        // ═══════════════════════════════════════════════════════════
        // RESPONSE
        // ═══════════════════════════════════════════════════════════
        var response = {
            // Echo request fields
            type: 'guild',
            action: 'upgradeTech',
            userId: userId,
            techType: techType,
            techId: techId,
            times: times,
            version: request.version || '1.0',

            // Response data
            _changeInfo: changeInfo,
            _level: 1,
            _attrs: attrs,
            _totalCost: totalCost,
            _totalLevel: 1,
            _updateAttrs: updateAttrs
        };

        log.info('HANDLER', 'upgradeTech -> level=' + response._level + ' totalLevel=' + response._totalLevel);

        callback(response);
    }

    // ════════════════════════════════════════════════════════════════
    // REGISTER
    // ════════════════════════════════════════════════════════════════

    MainServer.registerHandler('guild', 'upgradeTech', handleUpgradeTech);

    window.MainServer = MainServer;
})();
