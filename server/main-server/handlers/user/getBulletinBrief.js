/**
 * handlers/user/getBulletinBrief.js — GetBulletinBrief + ReadBulletin Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DRAFT — Ajukan ke user untuk diskusi sebelum upload            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ============================================================
 * HANDLER 1: getBulletinBrief
 * ============================================================
 *
 * Client call: processHandler({type:'user',action:'getBulletinBrief',userId,version:'1.0'}, cb)
 *   main.min.js L121084-121102 (MailInfoManager.getBulletinBrief)
 *
 * Dipanggil saat:
 *   1. Setelah enterGame sukses (L114795) — otomatis
 *   2. Saat user buka tab "Notice Board" di mail panel (L186610)
 *      Hanya jika checkAskNoticeTime() return true (cooldown 5 menit / 300000ms, L121151-121153)
 *
 * Response wajib:
 *   { _brief: { [bulletinId]: { title, version, order } } }
 *
 * Client mapping (L121092-121100):
 *   for (var o in n._brief)
 *     bulletinList[o] = {
 *       bulletin: '',                              <- selalu kosong di brief
 *       bulletinTitle: n._brief[o].title,           <- judul bulletin
 *       bulletinVersion: n._brief[o].version,      <- versi bulletin
 *       order: n._brief[o].order                   <- urutan tampil
 *     };
 *
 * Red dot logic (L121154-121162):
 *   getBulletinRed() — cek apakah ada bulletin baru:
 *     for each bulletinList[n]:
 *       if !bulletinVersions[n] || bulletinVersions[n] != bulletinVersion → RED
 *   bulletinVersions = user._bulletinVersions (diset di enterGame, L700)
 *   Saat readBulletin: bulletinVersions[id] = t._bulletinVersion (L121105)
 *
 * ============================================================
 * HANDLER 2: readBulletin (type:'user')
 * ============================================================
 *
 * readBulletin dipanggil saat user klik detail bulletin (L187184-187202):
 *   ts.processHandler({
 *     type: 'user',
 *     action: 'readBulletin',
 *     userId: i,
 *     id: noticeId,              <- ID bulletin yang diklik
 *     version: '1.0'
 *   }, function(t) {
 *     noticeInfo = MailInfoManager.saveBulletin(a, t);
 *   });
 *
 * Response readBulletin wajib:
 *   { _bulletin, _bulletinTitle, _bulletinVersion }
 *
 * saveBulletin (L121103-121105):
 *   bulletinVersions[id] = t._bulletinVersion
 *   bulletinList[id].bulletin = t._bulletin          <- konten penuh
 *   bulletinList[id].bulletinTitle = t._bulletinTitle
 *   bulletinList[id].bulletinVersion = t._bulletinVersion
 *
 * ============================================================
 * DATA SOURCE
 * ============================================================
 *
 * Server metadata (serverItem) -> _bulletins: []
 * Setiap bulletin: { id, title, content, version, order, active }
 *
 * Auto-init: Jika belum ada bulletin, 3 sample bulletin akan dibuat otomatis
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.user) {
        MainServer.handlers.user = {};
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPER: Ambil & simpan bulletins di server metadata
    // ═══════════════════════════════════════════════════════════════

    /**
     * Ambil bulletins dari server metadata.
     * Initialize _bulletins array jika belum ada.
     *
     * @returns {Array} Array of bulletin objects
     */
    function getBulletins() {
        var meta = db._get('serverItem');
        if (!meta) {
            meta = {
                _serverOpenDate: Date.now(),
                _serverVersion: '1.0.0',
                _currency: 'USD',
                _maintenance: false,
                _bannedUsers: {},
                _broadcastQueue: [],
                _onlineBulletins: [],
                _bulletins: []
            };
            db._set('serverItem', meta);
            return meta._bulletins;
        }

        if (!meta._bulletins) {
            meta._bulletins = [];
            db._set('serverItem', meta);
        }

        return meta._bulletins;
    }

    /**
     * Simpan bulletins ke server metadata.
     *
     * @param {Array} bulletins
     */
    function saveBulletins(bulletins) {
        var meta = db._get('serverItem');
        if (meta) {
            meta._bulletins = bulletins;
            db._set('serverItem', meta);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // HANDLER 1: getBulletinBrief
    // ═══════════════════════════════════════════════════════════════

    /**
     * handleGetBulletinBrief(request, callback)
     *
     * Mengembalikan daftar bulletin brief (judul, versi, urutan).
     * Konten penuh baru di-fetch saat user klik (readBulletin).
     *
     * @param {object} request  — { type:'user', action:'getBulletinBrief', userId, version:'1.0' }
     * @param {function} callback — callback(responseData)
     *
     * Response:
     *   { _brief: { [id]: { title, version, order } } }
     */
    function handleGetBulletinBrief(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'getBulletinBrief processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['version', request.version || '-']
        ]);

        try {
            if (!userId) {
                log.error('HANDLER', 'Missing userId in getBulletinBrief request');
                callback({ _brief: {} });
                return;
            }

            // Ambil bulletins dari server metadata
            var bulletins = getBulletins();
            var brief = {};

            // Build response — hanya bulletin yang active
            for (var i = 0; i < bulletins.length; i++) {
                var b = bulletins[i];
                if (b.active !== false) {
                    brief[b.id] = {
                        title: b.title,
                        version: b.version,
                        order: b.order
                    };
                }
            }

            var briefCount = Object.keys(brief).length;

            log.info('HANDLER', 'getBulletinBrief success');
            log.details('response', [
                ['bulletinCount', String(briefCount)],
                ['totalStored', String(bulletins.length)]
            ]);

            // Log DETAIL setiap bulletin
            if (briefCount > 0) {
                log.info('RESP', 'Bulletin brief detail');
                var keys = Object.keys(brief);
                for (var k = 0; k < keys.length; k++) {
                    var id = keys[k];
                    log.details([
                        ['brief[' + id + '].title', brief[id].title],
                        ['brief[' + id + '].version', String(brief[id].version)],
                        ['brief[' + id + '].order', String(brief[id].order)]
                    ]);
                }
            } else {
                log.debug('RESP', 'No active bulletins');
            }

            callback({ _brief: brief });

        } catch (err) {
            log.error('HANDLER', 'getBulletinBrief UNCAUGHT ERROR', err);
            callback({ _brief: {} });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // HANDLER 2: readBulletin
    // ═══════════════════════════════════════════════════════════════

    /**
     * handleReadBulletin(request, callback)
     *
     * Dipanggil saat user klik detail bulletin di Notice Board.
     * Client: NoticeBoradListItem.noticeItem_showDetalBtnTap (L187184-187202)
     *
     * @param {object} request  — { type:'user', action:'readBulletin', userId, id, version:'1.0' }
     * @param {function} callback — callback(responseData)
     *
     * Response:
     *   { _bulletin, _bulletinTitle, _bulletinVersion }
     */
    function handleReadBulletin(request, callback) {
        var userId = request.userId;
        var bulletinId = request.id;

        log.info('HANDLER', 'readBulletin processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['bulletinId', bulletinId || '-']
        ]);

        try {
            if (!userId || !bulletinId) {
                log.error('HANDLER', 'Missing userId or bulletinId in readBulletin request');
                callback({ _bulletin: '', _bulletinTitle: '', _bulletinVersion: '' });
                return;
            }

            // Cari bulletin berdasarkan ID
            var bulletins = getBulletins();
            var found = null;

            for (var i = 0; i < bulletins.length; i++) {
                if (bulletins[i].id === bulletinId) {
                    found = bulletins[i];
                    break;
                }
            }

            if (!found) {
                log.warn('HANDLER', 'readBulletin — bulletin NOT FOUND: ' + bulletinId);
                callback({ _bulletin: '', _bulletinTitle: '', _bulletinVersion: '' });
                return;
            }

            var responseData = {
                _bulletin: found.content,
                _bulletinTitle: found.title,
                _bulletinVersion: found.version
            };

            log.info('HANDLER', 'readBulletin success');
            log.details('response', [
                ['bulletinId', bulletinId],
                ['_bulletinTitle', found.title],
                ['_bulletinVersion', String(found.version)],
                ['contentLength', String(found.content.length)]
            ]);

            callback(responseData);

        } catch (err) {
            log.error('HANDLER', 'readBulletin UNCAUGHT ERROR', err);
            callback({ _bulletin: '', _bulletinTitle: '', _bulletinVersion: '' });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS: Manajemen Bulletin (via console)
    // ═══════════════════════════════════════════════════════════════

    /**
     * MainServer.admin.addNoticeBulletin(bulletin)
     *
     * Tambah/update bulletin di server metadata.
     * Jika ID sudah ada → update, jika belum → tambah baru.
     *
     * @param {object} bulletin — { id, title, content, version, order, active }
     *
     * Contoh penggunaan di console:
     *   MainServer.admin.addNoticeBulletin({
     *       id: 'event_1',
     *       title: 'Event Spesial Weekend!',
     *       content: 'Dapatkan reward 2x lipat...',
     *       version: '1.1',
     *       order: 1,
     *       active: true
     *   });
     */
    MainServer.admin.addNoticeBulletin = function (bulletin) {
        var bulletins = getBulletins();

        var existing = false;
        for (var i = 0; i < bulletins.length; i++) {
            if (bulletins[i].id === bulletin.id) {
                bulletins[i] = bulletin;
                existing = true;
                log.info('ADMIN', 'Bulletin UPDATED: ' + bulletin.id);
                break;
            }
        }

        if (!existing) {
            bulletins.push(bulletin);
            log.info('ADMIN', 'Bulletin ADDED: ' + bulletin.id);
        }

        saveBulletins(bulletins);

        log.details('Bulletin detail', [
            ['id', bulletin.id],
            ['title', bulletin.title],
            ['version', String(bulletin.version)],
            ['order', String(bulletin.order)],
            ['active', String(bulletin.active)]
        ]);

        return bulletin;
    };

    /**
     * MainServer.admin.removeNoticeBulletin(id)
     *
     * Hapus bulletin berdasarkan ID.
     *
     * @param {string} id — bulletin ID
     *
     * Contoh: MainServer.admin.removeNoticeBulletin('event_1')
     */
    MainServer.admin.removeNoticeBulletin = function (id) {
        var bulletins = getBulletins();
        var newBulletins = [];

        for (var i = 0; i < bulletins.length; i++) {
            if (bulletins[i].id !== id) {
                newBulletins.push(bulletins[i]);
            }
        }

        saveBulletins(newBulletins);
        log.info('ADMIN', 'Bulletin REMOVED: ' + id);
        log.details('remainingCount', String(newBulletins.length));

        return newBulletins;
    };

    /**
     * MainServer.admin.listNoticeBulletins()
     *
     * List semua bulletin + log detail setiap item.
     *
     * Contoh: MainServer.admin.listNoticeBulletins()
     */
    MainServer.admin.listNoticeBulletins = function () {
        var bulletins = getBulletins();
        log.info('ADMIN', 'Bulletin list (' + bulletins.length + ' total)');

        for (var i = 0; i < bulletins.length; i++) {
            var b = bulletins[i];
            log.details('bulletin[' + i + ']', [
                ['id', b.id],
                ['title', b.title],
                ['version', String(b.version)],
                ['order', String(b.order)],
                ['active', String(b.active)],
                ['contentLength', String((b.content || '').length)]
            ]);
        }

        return bulletins;
    };

    // ═══════════════════════════════════════════════════════════════
    // AUTO-INIT: Sample bulletins saat pertama kali load
    // ═══════════════════════════════════════════════════════════════

    (function autoInit() {
        var meta = db._get('serverItem');
        if (!meta || !meta._bulletins || meta._bulletins.length === 0) {
            log.info('INIT', 'No bulletins found, initializing samples...');

            MainServer.admin.addNoticeBulletin({
                id: 'welcome',
                title: 'Selamat Datang di Super Warrior Z!',
                content: 'Selamat datang di Super Warrior Z!\n\n'
                    + 'Game ini masih dalam tahap pengembangan. '
                    + 'Silakan nikmati fitur-fitur yang sudah tersedia '
                    + 'dan laporkan bug yang kamu temukan.\n\n'
                    + 'Terima kasih atas dukungannya!',
                version: '1.0',
                order: 1,
                active: true
            });

            MainServer.admin.addNoticeBulletin({
                id: 'update_1',
                title: 'Update v1.0 — Fitur Baru',
                content: 'Update v1.0 telah tersedia!\n\n'
                    + 'Fitur baru:\n'
                    + '- Sistem guild telah diperbarui\n'
                    + '- Hero baru telah ditambahkan\n'
                    + '- Bug fix untuk battle system\n\n'
                    + 'Selamat bermain!',
                version: '1.0',
                order: 2,
                active: true
            });

            MainServer.admin.addNoticeBulletin({
                id: 'maintenance',
                title: 'Jadwal Maintenance',
                content: 'Maintenance terjadwal:\n\n'
                    + 'Tanggal: Setiap hari Selasa\n'
                    + 'Waktu: 02:00 - 04:00 (WIB)\n\n'
                    + 'Selama maintenance, server tidak dapat diakses. '
                    + 'Mohon untuk tidak melakukan login selama periode maintenance.\n\n'
                    + 'Terima kasih atas pengertiannya.',
                version: '1.0',
                order: 3,
                active: true
            });

            log.info('INIT', 'Sample bulletins initialized (3 items)');
        }
    })();

    // ═══════════════════════════════════════════════════════════════
    // REGISTER HANDLERS
    // ═══════════════════════════════════════════════════════════════

    MainServer.registerHandler('user', 'getBulletinBrief', handleGetBulletinBrief);
    MainServer.registerHandler('user', 'readBulletin', handleReadBulletin);

    window.MainServer = MainServer;
})();
