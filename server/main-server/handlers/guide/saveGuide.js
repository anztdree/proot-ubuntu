/**
 * handlers/guide/saveGuide.js — Guide Checkpoint Save Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: guide/saveGuide
 * ============================================================
 *
 * Client call (main.min.js L120624-120635):
 *   ts.processHandler({
 *     type: 'guide',
 *     action: 'saveGuide',
 *     userId: UserInfoSingleton.getInstance().userId,
 *     guideType: tutorialLine,   // e.g. 2=MAIN, 3=TASK, 4=ARENA ...
 *     step: stepId,              // tutorial step ID yang baru selesai
 *     version: '1.0'
 *   }, function (e) {
 *       Logger.serverDebugLog('成功!!!');   // success callback
 *   }, function (e) {
 *       Logger.serverDebugLog('失败!!!');   // error callback
 *   });
 *
 * Dipanggil saat:
 *   - Player menyelesaikan tutorial step yang punya isSave=1
 *   - GuideInfoManager.sendGuideSted(stepId)
 *   - Hanya step dengan flag isSave di tutorial.json yang trigger save
 *
 * ============================================================
 * DATA MODEL
 * ============================================================
 *
 * GuildeModel (L120908-120916):
 *   { _id: userId, _steps: { [tutorialLine]: lastCompletedStepId } }
 *
 * Contoh:
 *   guide = {
 *     _id: "abc123",
 *     _steps: {
 *       "2": 2717,    // MAIN guide selesai di step 2717
 *       "3": 3102,    // TASK guide selesai di step 3102
 *       "4": 4301     // ARENA guide selesai di step 4301
 *     }
 *   }
 *
 * GUIDE_TYPE (tutorialLine values):
 *   2=MAIN, 3=TASK, 4=ARENA, 5=SOURCE_DUNGEON, 6=TEMPLE_TEST,
 *   7=EQUIP_DUNGEON, 8=GUILD, 9=SNAKE, 10=STRONG_ENEMY,
 *   11=KARIN, 12=DRAGON, 13=ENTRUST, 14=MAHA, 15=SIGN,
 *   16=CELL_GAME, 18=QIGONG, 19=WEAPON, 20=EARRING,
 *   21=HEROWAKEUP, 22=HERODEBRISCOMPOUND, 23=SMITHY,
 *   24=TheWildAdventure, 25=TimeTravel, 26=SnakeBeanResurgence,
 *   27=AltarDecompose, 28=Training, 29=BossFight, 30=Psych,
 *   31=Expedition, 32=ExpeditionEvent, 33=Inherit,
 *   34=TeamTraining, 35=Appraise, 36=SoulShop, 37=weaponCircle,
 *   38=TeamDungeon, 39=SignAdd, 40=EquipGem, 41=HeroLink,
 *   42=TopBattle, 43=LimitEvolve, 44=SpaceTrial, 45=GravityTrial,
 *   46=RedEquipUpgrade, 47=SummonList, 48=GuildSign,
 *   49=GuildTech, 50=GuildHeroLinkUpper, 51=SmallGameBack
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 *
 * Handler callback(responseData, retCode):
 *   Server wraps: { ret: retCode||0, data: JSON.stringify(responseData) }
 *   Client parses: e = JSON.parse(envelope.data) → passed to callback
 *
 * Success response (ret=0):
 *   { _guideType: 2, _step: 2102 }
 *   Echo back guideType + step yang tersimpan sebagai konfirmasi.
 *   Client callback hanya log "成功!!!", tapi data harus bermakna
 *   untuk debugging dan konsistensi.
 *
 * Error response (ret!=0):
 *   { _error: "missing_userId" }
 *   Client memanggil error callback → log "失败!!!"
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.guide) {
        MainServer.handlers.guide = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  VALIDATION HELPERS
    // ═══════════════════════════════════════════════════════════

    var VALID_GUIDE_TYPES = [
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
        31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
        44, 45, 46, 47, 48, 49, 50, 51
    ];

    /**
     * isValidGuideType(guideType) — Check if guideType is a known GUIDE_TYPE.
     */
    function isValidGuideType(guideType) {
        return VALID_GUIDE_TYPES.indexOf(Number(guideType)) !== -1;
    }

    /**
     * isValidStep(stepId) — Check if step ID exists in tutorial.json.
     */
    function isValidStep(stepId) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/tutorial.json', false);
            xhr.send();
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                return !!data[String(stepId)];
            }
        } catch (e) {
            // If tutorial.json can't be loaded, don't block the save
            return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: guide/saveGuide
    // ═══════════════════════════════════════════════════════════

    /**
     * handleSaveGuide(request, callback)
     *
     * Menyimpan checkpoint tutorial ke user data.
     *
     * Request:
     *   { type:'guide', action:'saveGuide', userId, guideType, step, version:'1.0' }
     *
     * Logic:
     *   1. Validate userId, guideType, step
     *   2. Read user data from localStorage
     *   3. Update guide._steps[guideType] = step
     *   4. Save back to localStorage
     *   5. Return { _guideType, _step } sebagai konfirmasi
     *
     * @param {object} request
     * @param {function} callback(responseData, retCode)
     *   - responseData: { _guideType, _step } on success
     *   - retCode: 0 = success, non-0 = error
     */
    function handleSaveGuide(request, callback) {
        var userId = request.userId;
        var guideType = request.guideType;
        var step = request.step;

        log.info('HANDLER', 'guide/saveGuide processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['guideType', String(guideType != null ? guideType : '-')],
            ['step', String(step != null ? step : '-')],
            ['version', request.version || '-']
        ]);

        // ── Validate userId ──
        if (!userId) {
            log.warn('HANDLER', 'guide/saveGuide — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        // ── Validate guideType ──
        if (guideType == null || !isValidGuideType(guideType)) {
            log.warn('HANDLER', 'guide/saveGuide — invalid guideType: ' + guideType);
            callback({ _error: 'invalid_guideType', _guideType: guideType }, 1);
            return;
        }

        // ── Validate step ──
        if (step == null || step === 0) {
            log.warn('HANDLER', 'guide/saveGuide — invalid step: ' + step);
            callback({ _error: 'invalid_step', _step: step }, 1);
            return;
        }

        // ── Read user data ──
        var storageKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(storageKey);

        if (!savedData) {
            log.warn('HANDLER', 'guide/saveGuide — user data not found: ' + storageKey);
            callback({ _error: 'user_not_found' }, 1);
            return;
        }

        // ── Ensure guide object exists ──
        if (!savedData.guide) {
            savedData.guide = { _id: String(userId), _steps: {} };
            log.details('init', ['guide', 'initialized new guide object']);
        }
        if (!savedData.guide._id) {
            savedData.guide._id = String(userId);
        }
        if (!savedData.guide._steps) {
            savedData.guide._steps = {};
        }

        // ── Save checkpoint ──
        var guideTypeKey = String(guideType);
        var oldStep = savedData.guide._steps[guideTypeKey];
        savedData.guide._steps[guideTypeKey] = Number(step);

        // ── Persist to localStorage ──
        db._set(storageKey, savedData);

        log.info('HANDLER', 'guide/saveGuide success');
        log.details('result', [
            ['userId', userId],
            ['guideType', guideTypeKey],
            ['step', String(step)],
            ['oldStep', oldStep != null ? String(oldStep) : '(none)'],
            ['totalSteps', String(Object.keys(savedData.guide._steps).length)]
        ]);

        // ── Response: echo back semua field request + saved values ──
        // v3 FIX: sesuai HAR — server asli echo back type, action, userId, version
        // DAN field-nya TANPA underscore prefix: guideType (bukan _guideType)
        callback({
            type: request.type,
            action: request.action,
            userId: userId,
            guideType: Number(guideType),
            step: Number(step),
            version: request.version || '1.0'
        });
    }

    // ═══════════════════════════════════════════════════════════
    // REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('guide', 'saveGuide', handleSaveGuide);

    window.MainServer = MainServer;
})();
