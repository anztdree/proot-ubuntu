/**
 * handlers/superSkill/activeSuperSkill.js
 *
 * Request:  { type:"superSkill", action:"activeSuperSkill", userId, skillId:"1120561", version:"1.0" }
 * Response: {}  (client IGNORES the response — creates local SuperSkillData(skillId, 1, false) itself)
 *
 * ============================================================
 * ANALYSIS EVIDENCE:
 * ============================================================
 *
 * [CALL SITE] activateBtnTap:
 *   ts.processHandler({type:"superSkill",action:"activeSuperSkill",userId:n,skillId:t.superSkillID,version:"1.0"},
 *     function(n){
 *       var o = SuperSkillSingleton.getInstance().activateSuperSkill(t.superSkillID);
 *       e.myData.changeSuperSkillData(o);
 *       e.loadSuperSkillMainUI();
 *       e.showUpEffectStart()
 *     })
 *   → The callback parameter `n` (server response) is NOT USED AT ALL.
 *   → Client creates SuperSkillData locally via activateSuperSkill(skillId).
 *
 * [activateSuperSkill] SuperSkillSingleton:
 *   e.prototype.activateSuperSkill = function(e){
 *     var n = ReadJsonSingleton.getInstance().skill[e];  // looks up skill.json by id
 *     var o = new SuperSkillData(e, 1, false);
 *     t.superSkill[e] = o;
 *     return o;
 *   }
 *   → On activation: level=1, needEvolve=false, no totalCost.
 *
 * [checkSuperSkillActivity] — client-side pre-check before button is enabled:
 *   e.prototype.checkSuperSkillActivity = function(e){
 *     var n = HerosManager.getInstance().getAlreadyGainHeroID();
 *     if(e.isFuture) return false;
 *     var o = t.superSkill[e.id];
 *     if(!o){
 *       for(var a=1; a<=3; a++){
 *         var r = e["heroNeeded"+a];
 *         if(r){ if(!n[r]) return false; }
 *       }
 *       return true;
 *     }
 *     return false;
 *   }
 *   → Checks: not already activated, not isFuture, owns all heroNeeded1/2/3.
 *   → This is CLIENT-SIDE only. Server still validates existence and duplicate.
 *
 * [initSuperSkill] — how client loads super skills from server user data:
 *   SuperSkillSingleton.getInstance().initSuperSkill(e.superSkill)
 *   → e._skills = { <key>: { _skillId, _level, _needEvolve, _totalCost }, ... }
 *   → For each entry with _level != 0, creates SuperSkillData(_skillId, _level, _needEvolve, _totalCost)
 *
 * [UserDataParser.saveUserData]:
 *   SuperSkillSingleton.getInstance().initSuperSkill(e.superSkill)
 *   → savedData.superSkill is the top-level key
 *
 * [superSkill.json] format:
 *   {
 *     "1120561": { "id":"1120561", "quality":"green", "heroNeeded1":1205, ... },
 *     "1140361": { "id":"1140361", "quality":"blue", "heroNeeded1":1403, "heroNeeded2":1405, ... },
 *     ...
 *   }
 *   → id field is a STRING. skillId in request = this id.
 *   → quality: "green"/"blue"/"purple"/"orange"
 *   → heroNeeded1/2/3: hero displayId numbers (1-3 heroes required to unlock)
 *
 * [Server data structure]:
 *   savedData.superSkill = {
 *     _skills: {
 *       <arbitraryKey>: {
 *         _skillId: 1120561,      // Number — the superSkill.json id
 *         _level: 1,              // starts at 1 on activation
 *         _needEvolve: false      // starts as false
 *       }
 *     }
 *   }
 *
 * [IMPORTANT — NO COST]:
 *   Unlike resetSuperSkill (which refunds totalCost items) or evolveSuperSkill/levelUpSuperSkill
 *   (which deduct costID items), activation itself is FREE — it only requires owning the heroes.
 *   The confirmation dialog mentioning "rebirth" belongs to resetBtnTap, NOT activateBtnTap.
 *
 * [Error pattern]: callback({}, 1) — same as other handlers (hero/resolve, etc.)
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.superSkill) {
        MainServer.handlers.superSkill = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    function userStorageKey(userId) {
        return 'ms_user_' + userId + '_1';
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIG LOADER (sync, cached — same pattern as resolve.js)
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
            log.error('RESOURCE', 'superSkill/activeSuperSkill failed to load: ' + name + '.json — HTTP ' + xhr.status);
        } catch (e) {
            log.error('RESOURCE', 'superSkill/activeSuperSkill failed to load: ' + name + '.json — ' + e.message);
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleActiveSuperSkill(request, callback) {
        var userId = request.userId;
        var skillId = request.skillId;

        log.info('HANDLER', 'superSkill/activeSuperSkill — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['skillId', skillId || '(null)'],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'superSkill/activeSuperSkill — missing userId');
            callback({}, 1);
            return;
        }

        if (!skillId) {
            log.error('HANDLER', 'superSkill/activeSuperSkill — missing skillId');
            callback({}, 1);
            return;
        }

        // ── LOAD CONFIG ──
        var superSkillConfig = loadJson('superSkill');
        if (!superSkillConfig) {
            log.error('HANDLER', 'superSkill/activeSuperSkill — failed to load superSkill.json');
            callback({}, 1);
            return;
        }

        // skillId from client is a string (e.g. "1120561"), config keys are also strings
        var skillEntry = superSkillConfig[String(skillId)];
        if (!skillEntry) {
            log.error('HANDLER', 'superSkill/activeSuperSkill — skillId not found in superSkill.json: ' + skillId);
            callback({}, 1);
            return;
        }

        // Check isFuture — future skills cannot be activated
        if (skillEntry.isFuture) {
            log.error('HANDLER', 'superSkill/activeSuperSkill — skill isFuture, cannot activate: ' + skillId);
            callback({}, 1);
            return;
        }

        // ── LOAD USER DATA ──
        var key = userStorageKey(userId);
        var savedData = db._get(key);
        if (!savedData) {
            log.error('HANDLER', 'superSkill/activeSuperSkill — user data not found: ' + key);
            callback({}, 1);
            return;
        }

        // Ensure superSkill structure exists
        if (!savedData.superSkill) {
            savedData.superSkill = { _skills: {} };
        }
        if (!savedData.superSkill._skills) {
            savedData.superSkill._skills = {};
        }

        // ── CHECK IF ALREADY ACTIVATED ──
        // Iterate _skills entries (keys are arbitrary, NOT skillId)
        var skills = savedData.superSkill._skills;
        for (var k in skills) {
            if (!skills.hasOwnProperty(k)) continue;
            var existing = skills[k];
            if (existing._skillId === Number(skillId) || existing._skillId === skillId) {
                log.error('HANDLER', 'superSkill/activeSuperSkill — skill already activated: ' + skillId + ' (found at key "' + k + '", level=' + existing._level + ')');
                callback({}, 1);
                return;
            }
        }

        // ── ACTIVATE: add new entry to _skills ──
        // Find next available key (max numeric key + 1, same pattern as hero addition)
        var maxKey = 0;
        for (var mk in skills) {
            if (!skills.hasOwnProperty(mk)) continue;
            var mkNum = Number(mk);
            if (!isNaN(mkNum) && mkNum > maxKey) {
                maxKey = mkNum;
            }
        }
        var newKey = String(maxKey + 1);

        skills[newKey] = {
            _skillId: Number(skillId),
            _level: 1,
            _needEvolve: false
        };

        log.info('HANDLER', 'superSkill/activeSuperSkill — activated skill ' + skillId + ' (quality=' + (skillEntry.quality || '?') + ') at key "' + newKey + '"');

        // ── SAVE USER DATA ──
        db._set(key, savedData);
        log.info('HANDLER', 'superSkill/activeSuperSkill — user data saved.');

        // ── BUILD RESPONSE ──
        // Client IGNORES the response — creates SuperSkillData locally.
        // Return empty object (success).
        var response = {};

        callback(response);
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('superSkill', 'activeSuperSkill', handleActiveSuperSkill);

})();