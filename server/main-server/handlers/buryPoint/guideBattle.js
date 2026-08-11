/**
 * handlers/buryPoint/guideBattle.js — Guide Battle Tracking Beacon Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: buryPoint/guideBattle
 * ============================================================
 *
 * Client call (main.min.js L120836-120849):
 *   GuideInfoManager.getInstance().guideBuriedPoint(point, passLesson)
 *     → ts.processHandler({
 *         type: 'buryPoint',
 *         action: 'guideBattle',
 *         userId: UserInfoSingleton.getInstance().userId,
 *         point: point,           // 'load' | 'battle' | 'home'
 *         passLesson: lessonId,  // e.g. 10101, 10102
 *         version: '1.0'
 *       }, function (e) {
 *           Logger.serverDebugLog('新手引导埋点！！！');
 *       }, function (e) {
 *           Logger.serverDebugLog('新手引导埋点失败！！！');
 *       });
 *
 * Dipanggil dari 4 lokasi:
 *   - L104894 — Guide 2107 handler (setelah guide battle #1 reward, kembali home)
 *     guideBuriedPoint(GuideHome_Point='home', lessonID)
 *
 *   - L105834 — Guide 2508 handler (setelah guide battle #2 reward, kembali home)
 *     guideBuriedPoint(GuideHome_Point='home', lessonID)
 *
 *   - L230925 — Battle scene init (saat scene battle dimuat)
 *     guideBuriedPoint(GuideLoad_Point='load', lessonID)
 *
 *   - L231034 — Guide battle end (saat guide battle selesai)
 *     guideBuriedPoint(GuideBattle_Point='battle', lessonID)
 *
 * Point constants (main.min.js L120990):
 *   var GuideLoad_Point = 'load';
 *   var GuideBattle_Point = 'battle';
 *   var GuideHome_Point = 'home';
 *
 * ============================================================
 * PURPOSE
 * ============================================================
 *
 * "埋点" = analytics tracking beacon.
 * Di production server, handler ini mengirim data progress tutorial
 * ke analytics server untuk tracking player journey.
 *
 * Di private server, client TIDAK MEMBACA response data sama sekali.
 * - Success callback: hanya log '新手引导埋点！！！'
 * - Error callback:  hanya log '新手引导埋点失败！！！'
 *
 * Jadi handler ini adalah no-op: terima request, log, respon success.
 * Tidak ada data yang disimpan, tidak ada state yang berubah.
 *
 * ============================================================
 * RESPONSE FORMAT
 * ============================================================
 *
 * Success (ret=0):
 *   {} — kosong, client tidak membaca response
 *
 * Error (ret!=0):
 *   { _error: 'missing_userId' } — client log error saja
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;

    if (!MainServer.handlers.buryPoint) {
        MainServer.handlers.buryPoint = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  VALIDATION CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var VALID_POINTS = ['load', 'battle', 'home'];

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: buryPoint/guideBattle
    // ═══════════════════════════════════════════════════════════

    /**
     * handleGuideBattle(request, callback)
     *
     * Tracking beacon — menerima data progress tutorial dari client,
     * log untuk debugging, respon success. Tidak ada state change.
     *
     * Request:
     *   { type:'buryPoint', action:'guideBattle', userId, point, passLesson, version:'1.0' }
     *
     * @param {object} request
     * @param {function} callback(responseData, retCode)
     */
    function handleGuideBattle(request, callback) {
        var userId = request.userId;
        var point = request.point;
        var passLesson = request.passLesson;

        log.info('HANDLER', 'buryPoint/guideBattle processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['point', point || '-'],
            ['passLesson', passLesson != null ? String(passLesson) : '-'],
            ['version', request.version || '-']
        ]);

        // ── Validate userId ──
        if (!userId) {
            log.warn('HANDLER', 'buryPoint/guideBattle — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        // ── Validate point ──
        if (!point || VALID_POINTS.indexOf(point) === -1) {
            log.warn('HANDLER', 'buryPoint/guideBattle — invalid point: ' + point);
            callback({ _error: 'invalid_point', _point: point }, 1);
            return;
        }

        // ── Tracking beacon — no data save, no state change ──
        log.info('HANDLER', 'buryPoint/guideBattle success');
        log.details('tracking', [
            ['userId', userId],
            ['point', point],
            ['passLesson', passLesson != null ? String(passLesson) : '(none)']
        ]);

        // ── Response: kosong, client tidak membaca data apapun ──
        callback({});
    }

    // ═══════════════════════════════════════════════════════════
    // REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('buryPoint', 'guideBattle', handleGuideBattle);

    window.MainServer = MainServer;
})();
