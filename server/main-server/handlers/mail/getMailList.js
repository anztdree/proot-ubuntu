/**
 * handlers/mail/getMailList.js — Get Mail List Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * TUGAS & TANGGUNG JAWAB FILE INI (1 file, 1 action):
 *   Handler untuk request: { type:"mail", action:"getMailList", userId, version:"1.0" }
 *   Response:              { _mails: [ { ...mailItem }, ... ] }
 *
 *   Server WAJIB:
 *     1. Validate request (userId)
 *     2. Load user data dari IndexedDB
 *     3. Load mail list dari IndexedDB (mail:{userId})
 *     4. Return { _mails: array of mail objects }
 *
 * ============================================================
 * MAIL_ITEM FIELDS (client setMailItem L79580):
 *   _id           — string, wajib, unique mail ID
 *   _title        — string, wajib, judul mail
 *   _date         — number, wajib, timestamp ms
 *   _read         — boolean, wajib, sudah dibaca?
 *   _getReward    — boolean, wajib, sudah claim reward?
 *   _haveReward   — boolean, optional, punya reward?
 *   _rewards      — object, optional, { _items: { "id": {_id, _num} } }
 *   _fromUserId   — string, optional, untuk friend mail
 *   _fromUserName — string, optional
 *   _detail       — string, optional, konten mail
 *   _type         — number, wajib, MAIL_TYPE enum (0-9)
 *   _brief        — string, optional
 *   _heroes       — array, optional, hero rewards
 *   _weapons      — array, optional, weapon rewards
 *
 * MAIL_TYPE enum (client L79580):
 *   0=DEFAULT, 1=ARENA_DAILY, 2=GUILD_BOSS, 3=GUILD_GRAB,
 *   4=POWERFUL_BOSS_ATTACK, 5=MAHA_ADVENTURE, 6=VIP_UPGRADE,
 *   7=MONTH_CARD_SHORT, 8=MONTH_CARD_LENGTH, 9=CARD_NO_LIMIT
 *
 * ============================================================
 * EVIDENCE DARI main.min(unminfy).js:
 *
 *   [PEMANGGILAN] L167810-167814 (Home.mailTap):
 *     ts.processHandler({
 *         type: "mail", action: "getMailList",
 *         userId, version: "1.0"
 *     }, function(t) {
 *         MailInfoManager.getInstance().setMailList(t._mails);
 *         ts.openWindow("MailPanel", { parent:"Mail", updataUIFunc:n })
 *     })
 *
 *   [setMailList] L79580:
 *     setMailList = function(e) {
 *         t.mailList = {};
 *         for (var n in e) {
 *             var o = e[n], a = t.setMailItem(o);
 *             t.mailList[a._id] = a;
 *         }
 *     }
 *     e = response._mails — iterate dengan for-in (bisa array atau object)
 *
 *   [setMailItem] L79580:
 *     n._id = e._id, n._title = e._title, n._date = e._date,
 *     n._read = e._read, n._getReward = e._getReward,
 *     e._haveReward && (n._haveReward = e._haveReward),
 *     e._rewards && (parse _rewards._items),
 *     e._fromUserId && (n._fromUserId = e._fromUserId),
 *     e._fromUserName && (n._fromUserName = e._fromUserName),
 *     e._detail && (n._detail = e._detail),
 *     n._type = e._type,
 *     e._brief && (n._brief = e._brief),
 *     e._heroes && (parse heroes),
 *     e._weapons && (parse weapons)
 *
 *   [STORAGE]
 *     Key IndexedDB: mail:{userId}
 *     Value: array of mail objects
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    if (!MainServer.handlers.mail) {
        MainServer.handlers.mail = {};
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var MAIL_STORAGE_PREFIX = 'mail:';

    function mailStorageKey(userId) {
        return MAIL_STORAGE_PREFIX + userId;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIL STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /**
     * Load mail list dari IndexedDB.
     * Jika belum ada, return empty array.
     *
     * @param {string} userId
     * @returns {Array} array of mail objects
     */
    function loadMailList(userId) {
        var key = mailStorageKey(userId);
        var mails = db._get(key);

        if (!mails || !Array.isArray(mails)) {
            return [];
        }

        return mails;
    }

    /**
     * Validate & normalize single mail object.
     * Ensure semua field wajib ada dengan tipe yang benar.
     *
     * @param {object} mail
     * @returns {object|null} normalized mail atau null jika invalid
     */
    function normalizeMail(mail) {
        if (!mail || typeof mail !== 'object') return null;

        // _id wajib (string)
        if (!mail._id || typeof mail._id !== 'string') return null;

        // _title wajib (string)
        if (typeof mail._title !== 'string') mail._title = '';

        // _date wajib (number, timestamp ms)
        if (typeof mail._date !== 'number') mail._date = Date.now();

        // _read wajib (boolean)
        if (typeof mail._read !== 'boolean') mail._read = false;

        // _getReward wajib (boolean)
        if (typeof mail._getReward !== 'boolean') mail._getReward = false;

        // _type wajib (number, MAIL_TYPE 0-9)
        if (typeof mail._type !== 'number') mail._type = 0;

        // Optional fields — ensure type correctness
        if (mail._haveReward !== undefined && typeof mail._haveReward !== 'boolean') {
            mail._haveReward = !!mail._haveReward;
        }

        if (mail._rewards !== undefined && mail._rewards !== null) {
            if (typeof mail._rewards !== 'object') mail._rewards = { _items: {} };
            if (!mail._rewards._items || typeof mail._rewards._items !== 'object') {
                mail._rewards._items = {};
            }
        }

        if (mail._fromUserId !== undefined && typeof mail._fromUserId !== 'string') {
            mail._fromUserId = String(mail._fromUserId);
        }

        if (mail._fromUserName !== undefined && typeof mail._fromUserName !== 'string') {
            mail._fromUserName = String(mail._fromUserName);
        }

        if (mail._detail !== undefined && typeof mail._detail !== 'string') {
            mail._detail = String(mail._detail);
        }

        if (mail._brief !== undefined && typeof mail._brief !== 'string') {
            mail._brief = String(mail._brief);
        }

        if (mail._heroes !== undefined && !Array.isArray(mail._heroes)) {
            mail._heroes = [];
        }

        if (mail._weapons !== undefined && !Array.isArray(mail._weapons)) {
            mail._weapons = [];
        }

        return mail;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER
    // ═══════════════════════════════════════════════════════════

    function handleGetMailList(request, callback) {
        var userId = request.userId;

        log.info('HANDLER', 'mail/getMailList — START');
        log.details('request', [
            ['userId', userId || '(null)'],
            ['version', request.version || '-']
        ]);

        // ── VALIDATION ──
        if (!userId) {
            log.error('HANDLER', 'mail/getMailList — missing userId');
            callback({ _error: 'missing_userId' }, 1);
            return;
        }

        try {
            // ── LOAD MAIL LIST ──
            var rawMails = loadMailList(userId);

            // ── NORMALIZE & FILTER ──
            var mails = [];
            var skipped = 0;

            for (var i = 0; i < rawMails.length; i++) {
                var normalized = normalizeMail(rawMails[i]);
                if (normalized) {
                    mails.push(normalized);
                } else {
                    skipped++;
                    log.warn('MAIL', 'Skipping invalid mail at index ' + i);
                }
            }

            // ── SORT BY DATE (newest first) ──
            mails.sort(function (a, b) {
                return b._date - a._date;
            });

            log.info('HANDLER', 'mail/getMailList — SUCCESS');
            log.details('response', [
                ['userId', userId],
                ['totalMails', String(mails.length)],
                ['skipped', String(skipped)],
                ['unread', String(mails.filter(function (m) { return !m._read; }).length)],
                ['unclaimed', String(mails.filter(function (m) { return m._haveReward && !m._getReward; }).length)]
            ]);

            callback({ _mails: mails });

        } catch (err) {
            log.error('HANDLER', 'mail/getMailList — UNCAUGHT ERROR: ' + err.message);
            callback({ _error: 'server_error', _message: err.message }, 99);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER + EXPORTS
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('mail', 'getMailList', handleGetMailList);

    // Expose untuk handler lain (readMail, getReward, delMail, dll)
    var handler = MainServer.handlers['mail/getMailList'];
    handler._mailStorageKey = mailStorageKey;
    handler._loadMailList = loadMailList;
    handler._normalizeMail = normalizeMail;

    window.MainServer = MainServer;
})();
