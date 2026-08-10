/**
 * handlers/heroImage/readHeroVersion.js — Mark Hero Book Version as Read
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: heroImage/readHeroVersion
 * ============================================================
 *
 * Client call (main.min.js L121860-121867):
 *   if (UserInfoSingleton.heroImageVersion < myData.heroBookVersion)
 *     ts.processHandler({
 *       type: "heroImage",
 *       action: "readHeroVersion",
 *       userId: n,
 *       version: "1.0"
 *     }, function(t) {
 *       UserInfoSingleton.heroImageVersion = myData.heroBookVersion;
 *       e.judgeRed()  // update red dot
 *     })
 *
 * Dipanggil saat:
 *   Player buka tab Hero Handbook, dan heroImageVersion < heroBookVersion.
 *   Artinya ada hero baru di buku yang belum dilihat → dismiss red dot.
 *   Callback TIDAK baca response — hanya butuh ret:0 supaya callback jalan.
 *
 * Response: callback({}) — cukup kosong, client ignore response data.
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;

    if (!MainServer.handlers.heroImage) {
        MainServer.handlers.heroImage = {};
    }

    function handleReadHeroVersion(request, callback) {
        log.info('HANDLER', 'heroImage/readHeroVersion processing');
        callback({});
    }

    MainServer.registerHandler('heroImage', 'readHeroVersion', handleReadHeroVersion);

    window.MainServer = MainServer;
})();