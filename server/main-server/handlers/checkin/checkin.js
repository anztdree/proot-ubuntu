/**
 * handlers/checkin/checkin.js — Checkin Claim Handler (DRAFT v1)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  TUGAS & TANGGUNG JAWAB FILE INI:
 * ============================================================
 *
 *  Handler ini menangani KLAIM reward sign-in harian.
 *  User menekan tombol "claim" di tab Sign-In → client kirim request →
 *  server validasi → kasih reward → response.
 *
 *  TUGAS UTAMA:
 *    1. VALIDASI request (userId, day)
 *    2. VALIDASI bisakah user klaim hari ini?
 *       - day harus <= _maxActiveDay (hari sudah di-unlock oleh enterGame)
 *       - day harus ada di _activeItem[] (belum pernah di-klaim)
 *    3. CARI reward dari register.json config (baca server-side)
 *    4. TAMBAH item ke inventory user (totalProps._items)
 *    5. HAPUS day dari _activeItem[] (tandai sudah di-klaim)
 *    6. CEK apakah cycle selesai → advanced ke cycle berikutnya?
 *    7. SIMPAN data user ke localStorage
 *    8. RESPONSE: { _changeInfo: { _items: [...] } }
 *       NOTE: serverTime & server0Time di-inject oleh framework buildEnvelope(),
 *       bukan oleh handler. Client baca dari envelope level.
 *
 *  TUGAS YANG BUKAN MILIK FILE INI:
 *    ❌ Unlock hari baru (itu tugas enterGame.js checkinUpdate)
 *    ❌ Daily reset / cek beda hari (itu tugas enterGame.js checkDailyReset)
 *    ❌ Timer countdown tampil di UI (100% client-side, pakai _lastActiveDate)
 *    ❌ Load checkin data saat login (itu bagian dari enterGame response)
 *    ❌ Red dot indicator (client-side, cek _activeItem.length)
 *
 * ============================================================
 *  FLOW LENGKAP (dari client perspective):
 * ============================================================
 *
 *  LOGIN (enterGame.js):
 *    1. Server kirim checkin: { _id, _activeItem[], _curCycle, _maxActiveDay, _lastActiveDate }
 *    2. Client simpan ke WelfareInfoManager.signInInfo (CheckinModel)
 *    3. Client render 30 slot (dari register.json[_curCycle])
 *    4. Slot yang day <= _maxActiveDay = unlocked (bisa diklik)
 *    5. Slot yang day di _activeItem[] = claimable (ada efek "claim")
 *
 *  USER KLIK SLOT (client L156273-156294):
 *    1. CHECK: day <= _maxActiveDay? → NO → show tooltip, ABORT
 *    2. CHECK: existActiveItem(day)? → NO → show tooltip, ABORT
 *    3. SEND: processHandler({ type:"checkin", action:"checkin", userId, day, version:"1.0" })
 *    4. SUCCESS → openCommonItemGetTips(response._changeInfo._items)
 *    5. SUCCESS → deleteActiveItemDay(day) — hapus dari _activeItem[]
 *    6. SUCCESS → updateUI() — refresh list
 *
 * ============================================================
 *  REQUEST FORMAT (dari client):
 * ============================================================
 *    {
 *      type: "checkin",
 *      action: "checkin",
 *      userId: string,
 *      day: number,       // day number (1-30) yang ingin di-klaim
 *      version: "1.0"
 *    }
 *
 * ============================================================
 *  RESPONSE FORMAT (yang client harapkan):
 * ============================================================
 *    {
 *      _changeInfo: {
 *        _items: {
 *          "101": { _id: 101, _num: 1500 }    // key = String(itemID), value = ABSOLUTE total
 *        }
 *      }
 *    }
 *
 *  KEY MUST be String(itemID) — NOT "0" or any other arbitrary index!
 *  Client openCommonItemGetTips: setItem(Number(v), items[v]._num) where v = key.
 *  setItem stores this.items[e] = t — so key IS the item lookup ID.
 *
 *  CATATAN: serverTime & server0Time TIDAK perlu di-response handler.
 *  Framework (buildEnvelope) otomatis inject field tersebut ke envelope.
 *  Client L76927 baca e.serverTime dari envelope, BUKAN dari data.
 *
 *  CATATAN KRITIS tentang _changeInfo._items:
 *    - _num adalah TOTAL ABSOLUT item user SETELAH ditambah, bukan delta
 *    - Client hitung sendiri: delta = response._num - currentCount
 *    - openCommonItemGetTips() tampilkan popup delta saja
 *    - setItem() simpan _num sebagai total baru
 *
 * ============================================================
 *  CONFIG: register.json
 * ============================================================
 *    {
 *      "1": [                          // cycle 1
 *        { "id":1, "day":1, "rewardID":101, "num":100 },
 *        { "id":1, "day":2, "rewardID":101, "num":100 },
 *        ...
 *        { "id":1, "day":30, "rewardID":158, "num":1 }
 *      ],
 *      "2": [...], "3": [...], ..., "6": [...]
 *    }
 *
 *  Setiap cycle punya 30 hari. rewardID = item ID, num = jumlah reward.
 *  isDouble di config hanya untuk UI display (ikon month card).
 *  Server TIDAK perlu implementasi double logic — itu 100% client-side.
 *
 * ============================================================
 *  CHECKIN MODEL (CheckinModel):
 * ============================================================
 *    {
 *      _id: string,           // unused oleh handler ini
 *      _activeItem: number[], // hari yang BISA di-klaim (belum di-claim)
 *      _curCycle: number,     // cycle saat ini (1-6)
 *      _maxActiveDay: number, // hari tertinggi yang sudah di-unlock
 *      _lastActiveDate: number // ms timestamp — untuk timer UI
 *    }
 *
 * ============================================================
 *  CYCLE ADVANCEMENT:
 * ============================================================
 *  Ketika user klaim hari ke-30 (hari terakhir cycle):
 *    - _maxActiveDay sudah = 30 (di-set oleh enterGame checkinUpdate)
 *    - Setelah klaim, _activeItem jadi kosong
 *    - Cycle SELESAI → _curCycle++ untuk cycle berikutnya
 *    - Reset: _maxActiveDay = 0, _activeItem = []
 *    - Hari berikutnya (enterGame), user mulai cycle baru dari day 1
 *
 *  Kenapa di sini TIDAK langsung advance?
 *    Karena client TIDAK update model dari response ini.
 *    Client hanya deleteActiveItemDay() dan updateUI().
 *    _curCycle baru akan terbaca saat NEXT LOGIN (enterGame).
 *    Jadi di handler ini, kita TIDAK ubah _curCycle.
 *    Kita cuma hapus day dari _activeItem[].
 *
 *  ⚠️ PERHATIAN: _activeItem[] bisa punya MULTIPLE days sekaligus!
 *    Misal user offline 3 hari → enterGame unlock day 1,2,3
 *    → _activeItem = [1, 2, 3]
 *    → User klaim satu-satu dari client
 *    → Setiap klaim, server hapus 1 day dari array
 *
 * ============================================================
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════

    var RET_CODES = {
        OK: 0,
        MISSING_USERID: 10001,
        MISSING_DAY: 10002,
        USER_NOT_FOUND: 10003,
        DAY_NOT_UNLOCKED: 10004,
        DAY_NOT_CLAIMABLE: 10005,
        REWARD_CONFIG_NOT_FOUND: 10006,
        SERVER_ERROR: 99999
    };

    // 3 handler variables (standard pattern)
    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Load register.json config (sync XHR + cache)
    // ═══════════════════════════════════════════════════════════
    //
    //  Client loads: ReadJsonSingleton.getInstance().register
    //  → ts.readJsonFile("register_json")
    //  Server loads via sync XHR dari ./resource/json/register_json.json
    //  Pattern sama dengan enterGame.js loadJsonSync() — cached.

    var _registerCache = null;

    function getRegisterConfig() {
        if (_registerCache) return _registerCache;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/register.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _registerCache = JSON.parse(xhr.responseText);
                return _registerCache;
            }
        } catch (e) {
            log.warn('checkin', 'Failed to load register.json — ' + e.message);
        }
        return {};
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Build error response
    // ═══════════════════════════════════════════════════════════

    function buildError(code, msg) {
        return {
            ret: code,
            msg: msg || 'Error'
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Get item from totalProps._items by ID
    // ═══════════════════════════════════════════════════════════
    //
    //  totalProps._items = [ { _id: 101, _num: 500 }, ... ]
    //  Client uses ItemsCommonSingleton.setItem(id, num) — absolute values.

    function getItemNum(totalProps, itemId) {
        if (!totalProps || !totalProps._items) return 0;
        for (var i = 0; i < totalProps._items.length; i++) {
            if (Number(totalProps._items[i]._id) === Number(itemId)) {
                return Number(totalProps._items[i]._num) || 0;
            }
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Set item in totalProps._items to new absolute value
    // ═══════════════════════════════════════════════════════════
    //
    //  _num = ABSOLUTE total (bukan delta). Client menghitung delta sendiri.

    function setItemNum(totalProps, itemId, newTotal) {
        if (!totalProps || !totalProps._items) return;
        for (var i = 0; i < totalProps._items.length; i++) {
            if (Number(totalProps._items[i]._id) === Number(itemId)) {
                totalProps._items[i]._num = newTotal;
                return;
            }
        }
        // Item belum ada di inventory → tambahkan
        totalProps._items.push({ _id: itemId, _num: newTotal });
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPER: Check if cycle is complete — MOVED to enterGame.js
    // ═══════════════════════════════════════════════════════════
    //
    //  Cycle advance TIDAK boleh terjadi di handler checkin.
    //  Client tidak re-read checkin dari response checkin — hanya splice _activeItem.
    //  Cycle advance harus terjadi di enterGame checkinUpdate, saat user login
    //  hari berikutnya setelah claim day 30.
    //  Lihat enterGame.js checkinUpdate() untuk implementasi cycle advance.

    // ═══════════════════════════════════════════════════════════
    //  MAIN HANDLER — handleCheckin
    // ═══════════════════════════════════════════════════════════

    function handleCheckin(request, callback) {
        var userId = request.userId;
        var day = request.day;     // 1-30
        var serverId = request.serverId || 1;

        log.info('HANDLER', 'checkin/checkin processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['day', String(day || 0)],
            ['version', request.version || '-']
        ]);

        try {

            // ═══ VALIDASI 1: userId wajib ═══
            if (!userId) {
                log.error('HANDLER', 'Missing userId');
                callback(buildError(RET_CODES.MISSING_USERID, 'userId tidak boleh kosong'), RET_CODES.MISSING_USERID);
                return;
            }

            // ═══ VALIDASI 2: day wajib ═══
            if (!day || isNaN(day)) {
                log.error('HANDLER', 'Missing or invalid day');
                callback(buildError(RET_CODES.MISSING_DAY, 'day tidak boleh kosong'), RET_CODES.MISSING_DAY);
                return;
            }
            day = Number(day);

            // ═══ LOAD USER DATA ═══
            var storageKey = 'user:' + userId;
            var savedData = db._get(storageKey);

            if (!savedData) {
                log.error('HANDLER', 'User data not found for userId: ' + userId);
                callback(buildError(RET_CODES.USER_NOT_FOUND, 'User tidak ditemukan'), RET_CODES.USER_NOT_FOUND);
                return;
            }

            var checkin = savedData.checkin;
            if (!checkin) {
                log.error('HANDLER', 'checkin data not found for userId: ' + userId);
                callback(buildError(RET_CODES.SERVER_ERROR, 'Data checkin tidak ditemukan'), RET_CODES.SERVER_ERROR);
                return;
            }

            // ═══ VALIDASI 3: day harus sudah di-unlock ═══
            // Client L156276: day <= _maxActiveDay → r = true → bisa diklik
            // Jika day > _maxActiveDay → client TIDAK akan kirim request ini
            // Tapi server harus tetap validasi (anti-cheat)
            if (day > (checkin._maxActiveDay || 0)) {
                log.warn('HANDLER', 'Day ' + day + ' not unlocked (maxActiveDay=' + (checkin._maxActiveDay || 0) + ')');
                callback(buildError(RET_CODES.DAY_NOT_UNLOCKED, 'Hari ' + day + ' belum di-unlock'), RET_CODES.DAY_NOT_UNLOCKED);
                return;
            }

            // ═══ VALIDASI 4: day harus ada di _activeItem[] (belum di-klaim) ═══
            // Client L156281: existActiveItem(day) → cek indexOf(day) > -1
            // Jika sudah di-klaim → client TIDAK akan kirim request ini
            // Tapi server harus tetap validasi
            var activeItem = checkin._activeItem || [];
            var activeIdx = activeItem.indexOf(day);
            if (activeIdx === -1) {
                log.warn('HANDLER', 'Day ' + day + ' not in _activeItem (already claimed or never unlocked)');
                callback(buildError(RET_CODES.DAY_NOT_CLAIMABLE, 'Hari ' + day + ' tidak bisa di-klaim'), RET_CODES.DAY_NOT_CLAIMABLE);
                return;
            }

            // ═══ CARI REWARD dari register.json ═══
            var curCycle = String(checkin._curCycle || 1);
            var registerConfig = getRegisterConfig();
            var cycleRewards = registerConfig[curCycle];

            if (!cycleRewards) {
                log.error('HANDLER', 'No register config for cycle ' + curCycle);
                callback(buildError(RET_CODES.REWARD_CONFIG_NOT_FOUND, 'Config cycle ' + curCycle + ' tidak ditemukan'), RET_CODES.REWARD_CONFIG_NOT_FOUND);
                return;
            }

            // Cari entry yang cocok dengan day
            var rewardEntry = null;
            for (var i = 0; i < cycleRewards.length; i++) {
                if (Number(cycleRewards[i].day) === day) {
                    rewardEntry = cycleRewards[i];
                    break;
                }
            }

            if (!rewardEntry) {
                log.error('HANDLER', 'No reward config for day ' + day + ' in cycle ' + curCycle);
                callback(buildError(RET_CODES.REWARD_CONFIG_NOT_FOUND, 'Config hari ' + day + ' tidak ditemukan'), RET_CODES.REWARD_CONFIG_NOT_FOUND);
                return;
            }

            var rewardItemId = Number(rewardEntry.rewardID);
            var rewardNum = Number(rewardEntry.num) || 0;

            log.info('HANDLER', 'Reward found — day:' + day + ' cycle:' + curCycle +
                ' itemID:' + rewardItemId + ' num:' + rewardNum);

            // ═══ TAMBAH ITEM KE INVENTORY ═══
            var totalProps = savedData.totalProps;
            if (!totalProps || !totalProps._items) {
                log.error('HANDLER', 'totalProps not found in user data');
                callback(buildError(RET_CODES.SERVER_ERROR, 'Data inventory tidak ditemukan'), RET_CODES.SERVER_ERROR);
                return;
            }

            var currentNum = getItemNum(totalProps, rewardItemId);
            var newTotal = currentNum + rewardNum;
            setItemNum(totalProps, rewardItemId, newTotal);

            log.info('HANDLER', 'Item updated — ID:' + rewardItemId +
                ' ' + currentNum + ' → ' + newTotal + ' (+' + rewardNum + ')');

            // ═══ HAPUS DAY DARI _activeItem[] ═══
            // Client L156291: deleteActiveItemDay(day) → splice from array
            // Server juga harus hapus agar tidak bisa di-klaim lagi
            checkin._activeItem.splice(activeIdx, 1);

            log.info('HANDLER', 'Day ' + day + ' removed from _activeItem (remaining: [' +
                checkin._activeItem.join(',') + '])');

            // ═══ CEK CYCLE ADVANCE — DIPINDAHKAN KE enterGame.js ═══
            // Cycle advance TIDAK boleh di sini karena client tidak re-read
            // checkin dari response. Cycle advance terjadi di enterGame
            // checkinUpdate() saat user login hari berikutnya.

            // ═══ SIMPAN DATA ═══
            db._set(storageKey, savedData);

            // ═══ SESSION TRACKING ═══
            db.trackAction(null, 'checkin', 'day:' + day + ' cycle:' + curCycle + ' item:' + rewardItemId + ' x' + rewardNum);

            // ═══ BUILD RESPONSE ═══
            // serverTime & server0Time di-set oleh framework buildEnvelope(),
            // bukan oleh handler. Client baca dari envelope, bukan dari data.
            //
            // CRITICAL: _changeInfo._items key MUST be String(itemID), NOT "0".
            // Client openCommonItemGetTips does: setItem(Number(v), items[v]._num)
            // where v = the key. setItem(e, t) stores items[e] = t.
            // If key="0" → items[0] = newTotal → getItemNum(101) returns 0 → reward LOST!
            // If key="101" → items[101] = newTotal → getItemNum(101) returns newTotal ✅
            //
            // Evidence: getLevelReward.js L271: changeItems[String(itemId)] = { _id, _num }
            var response = {
                _changeInfo: {
                    _items: {}
                }
            };
            response._changeInfo._items[String(rewardItemId)] = {
                _id: rewardItemId,
                _num: newTotal
            };

            log.info('HANDLER', 'checkin response ready — day:' + day +
                ' reward:' + rewardItemId + 'x' + rewardNum +
                ' newTotal:' + newTotal);

            callback(response);

        } catch (err) {
            log.error('HANDLER', 'checkin UNCAUGHT ERROR', err);
            callback(buildError(RET_CODES.SERVER_ERROR, err.message || 'Unknown error'), RET_CODES.SERVER_ERROR);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('checkin', 'checkin', handleCheckin);

    window.MainServer = MainServer;
})();