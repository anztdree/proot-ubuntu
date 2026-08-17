/**
 * handlers/guide/saveGuide.js — Guide Checkpoint Save
 * Super Warrior Z — MAIN SERVER
 *
 * Client (main.min.js L120624):
 *   GuideInfoManager.sendGuideSted(stepId)
 *   → setGuideStep(tutorialLine, stepId)     // save LOCAL first
 *   → if (config.isSave)
 *       ts.processHandler({
 *         type:'guide', action:'saveGuide',
 *         userId, guideType:tutorialLine, step:stepId, version:'1.0'
 *       }, function(e) { Logger.serverDebugLog('成功！！！') });
 *
 *   Client: TIDAK punya error callback.
 *   processHandler ret!=0 → ErrorHandler.ShowErrorTips(ret)
 *     → errorDefine[ret] tidak ada → MODAL POPUP → BLOCKS guide flow → crash
 *     Jadi handler ini MUST return ret=0 untuk semua kondisi normal.
 *
 * Response: client TIDAK baca data. Yang penting ret=0.
 * Real server echo back: type, action, userId, guideType, step, version.
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.guide) {
        MainServer.handlers.guide = {};
    }

    // guideType values dari tutorial.json (tutorialLine)
    var VALID_GUIDE_TYPES = [
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
        31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
        44, 45, 46, 47, 48, 49, 50, 51
    ];

    function isValidGuideType(v) {
        return VALID_GUIDE_TYPES.indexOf(Number(v)) !== -1;
    }

    // ═══════════════════════════════════════════════════════
    //  HANDLER
    // ═══════════════════════════════════════════════════════

    function handleSaveGuide(request, callback) {
        var userId = request.userId;
        var guideType = request.guideType;
        var step = request.step;

        log.info('HANDLER', 'guide/saveGuide');
        log.details('req', [
            ['userId', userId || '-'],
            ['guideType', String(guideType != null ? guideType : '-')],
            ['step', String(step != null ? step : '-')]
        ]);

        // ── Validate ──
        if (!userId) {
            log.warn('HANDLER', 'saveGuide — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        if (guideType == null || !isValidGuideType(guideType)) {
            log.warn('HANDLER', 'saveGuide — invalid guideType: ' + guideType);
            callback({ _error: 'invalid_guideType' }, 1);
            return;
        }

        if (step == null || step === 0) {
            log.warn('HANDLER', 'saveGuide — invalid step: ' + step);
            callback({ _error: 'invalid_step' }, 1);
            return;
        }

        // ── Read user data ──
        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);

        if (!savedData) {
            // User data MUST exist (enterGame runs first).
            // ret!=0 → ErrorHandler.ShowErrorTips → modal popup → blocks guide flow.
            log.error('HANDLER', 'saveGuide — user data not found: ' + storageKey + ' (enterGame should have created it)');
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        // ── Update guide checkpoint ──
        if (!savedData.guide) {
            savedData.guide = { _id: String(userId), _steps: {} };
        } else {
            if (!savedData.guide._id) savedData.guide._id = String(userId);
            if (!savedData.guide._steps) savedData.guide._steps = {};
        }

        var guideTypeKey = String(guideType);
        var oldStep = savedData.guide._steps[guideTypeKey];
        savedData.guide._steps[guideTypeKey] = Number(step);

        // ── Persist ──
        db._set(storageKey, savedData);

        // ── Response: echo all request fields (sesuai real server) ──
        callback({
            type: request.type,
            action: request.action,
            userId: userId,
            guideType: Number(guideType),
            step: Number(step),
            version: request.version || '1.0'
        });
    }

    MainServer.registerHandler('guide', 'saveGuide', handleSaveGuide);
    window.MainServer = MainServer;
})();
