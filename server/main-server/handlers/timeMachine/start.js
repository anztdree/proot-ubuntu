/**
 * handlers/timeMachine/start.js — Time Machine Start Handler (DRAFT v2)
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 *  TUGAS & TANGGUNG JAWAB FILE INI:
 * ============================================================
 *
 *  Handler ini menangani START time travel di salah satu dari 3 slot.
 *  User memilih hero + lesson + duration → server simpan state →
 *  client mulai countdown. Setelah selesai, user kalah/kalahin boss.
 *
 *  TUGAS UTAMA:
 *    1. VALIDASI request (machineId, level, heroId, timeType)
 *    2. CEK slot kosong — reject jika slot sudah dipakai (Ing / belum Complete)
 *    3. RESOLVE heroDisplayId dari heroId (instance ID → display ID)
 *    4. HITUNG finishTime = now + duration (6h/12h/24h)
 *    5. AMBIL bossId dari timeTravel[level].bossID
 *    6. SAVE ke DB — SHARD update _items[machineId] saja, TIDAK overwrite seluruh savedData
 *    7. RESPONSE: { _item: { _level, _heroId, _heroDisplayId, _timeType, _finishTime, _bossId } }
 *
 *  TUGAS YANG BUKAN MILIK FILE INI:
 *    - Init data di enterGame (itu tugas enterGame.js)
 *    - Boss battle (itu tugas timeMachine/startBoss)
 *    - Check battle result (itu tugas timeMachine/checkBattleResult)
 *    - Get reward (itu tugas timeMachine/getReward)
 *    - Set machine empty (itu tugas timeMachine/getReward → setMachineEmpty)
 *
 * ============================================================
 *  TRACE EVIDENCE (main.min.js):
 * ============================================================
 *
 *  CLIENT REQUEST — L149873-149880:
 *    ts.processHandler({
 *      type: "timeMachine",
 *      action: "start",
 *      userId: ...,
 *      machineId: t.params.machineId,    // 1|2|3
 *      level: t.params.lessonId,          // 1-10
 *      heroId: t.params.heroId,           // instance ID (number or string)
 *      timeType: t.getCurrentType()       // 1=6h, 2=12h, 3=24h
 *    }, callback)
 *
 *  CLIENT CALLBACK — L149881-149882:
 *    function(n) {
 *      TimeLeapSingleton.getInstance().addTimeMachine(t.params.machineId, n._item),
 *      0 == n._item._bossId
 *        ? UIWindowManager.runSceneWithTimeLeap()
 *        : e.showBossEffect(n._item._bossId)
 *    }
 *
 *  TimeMachineItem CONSTRUCTOR — L62147-62154:
 *    function e(e) {
 *      this.level = 0, this.heroId = "", this.heroDisplayId = 0,
 *      this.timeType = TIME_MACHINE_TIME_TYPE.UNKNOWN, this.finishTime = 0;
 *      var t = this;
 *      t.level = e._level;
 *      t.heroId = e._heroId;
 *      t.heroDisplayId = e._heroDisplayId;
 *      t.timeType = e._timeType;
 *      t.finishTime = e._finishTime
 *    }
 *
 *  TimeLeapSingleton.addTimeMachine — L62137-62140:
 *    e.prototype.addTimeMachine = function(e, t) {
 *      var n = this, o = new TimeMachineItem(t);
 *      n._currentState[e] = o
 *    }
 *    → Key = machineId (string "1"/"2"/"3")
 *    → Value = TimeMachineItem
 *
 *  TimeLeapSingleton.initData — L62117-62123:
 *    e.prototype.initData = function(e) {
 *      var t = this;
 *      t._currentState = {};
 *      for (var n in e._items) {
 *        var o = new TimeMachineItem(e._items[n]);
 *        t._currentState[n] = o
 *      }
 *    }
 *    → enterGame kirim: { _items: { "1": {...}, "2": {...}, "3": {...} } }
 *    → Key di _items = string machineId
 *
 *  TimeLeapSingleton.setMachineEmpty — L62134-62136:
 *    e.prototype.setMachineEmpty = function(e) {
 *      var t = this; t.currentState[e] = null
 *    }
 *    → Dipanggil saat getReward → slot di-set null
 *
 *  TIME_MACHINE_TIME_TYPE — L62156-62159:
 *    0=UNKNOWN, 1=HOUR_6, 2=HOUR_12, 3=HOUR_24
 *
 *  timeMachine.json — 3 slot:
 *    "1": { id:1, levelNeeded:30, vipNeeded:0 }
 *    "2": { id:2, levelNeeded:60, vipNeeded:2 }
 *    "3": { id:3, levelNeeded:120, vipNeeded:6 }
 *
 *  timeTravel.json — 10 lessons:
 *    Setiap entry punya: id, levelNeeded, bossID (101-110),
 *    heroSelf6h, heroSelf12h, heroSelf24h, award1-4, lesson
 *
 *  enterGame init — L77661 (client):
 *    e.timeMachine && TimeLeapSingleton.getInstance().initData(e.timeMachine)
 *    → Format: { _items: { [machineId]: { _level, _heroId, _heroDisplayId, _timeType, _finishTime } } }
 *
 *  enterGame draft — L1441:
 *    r.timeMachine = { _items: {} }
 *
 *  DB STORAGE FORMAT:
 *    savedData.timeMachine = {
 *      _items: {
 *        "1": { _level, _heroId, _heroDisplayId, _timeType, _finishTime },
 *        "2": null,
 *        "3": null
 *      }
 *    }
 *    → Slot aktif punya data, slot kosong = null / undefined
 *
 * ============================================================
 *  SLOT VALIDATION:
 * ============================================================
 *
 *  Slot yang sudah dipakai (state = Ing / belum Complete) TIDAK BOLEH di-overwrite.
 *  Cek: savedData.timeMachine._items[machineId] != null && finishTime > now
 *  → REJECT dengan ret=1
 *
 *  Slot yang sudah Complete (finishTime <= now) → sudah di-set null oleh getReward
 *  → Boleh dipakai lagi
 *
 * ============================================================
 *  SHARD / AKUMULASI:
 * ============================================================
 *
 *  Saat save, HANYA update _items[machineId] untuk slot yang dipakai.
 *  JANGAN overwrite seluruh savedData.timeMachine._items.
 *  Pattern:
 *    1. savedData = db._get(key)         ← load FULL savedData
 *    2. savedData.timeMachine._items[machineId] = newItem  ← shard update
 *    3. db._set(key, savedData)           ← save FULL savedData
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ── Config ──

    var TIME_MACHINE_TIME_TYPE = {
        UNKNOWN: 0,
        HOUR_6: 1,
        HOUR_12: 2,
        HOUR_24: 3
    };

    var DURATION_MS = {};
    DURATION_MS[TIME_MACHINE_TIME_TYPE.HOUR_6]  = 6  * 3600 * 1000;  // 21,600,000
    DURATION_MS[TIME_MACHINE_TIME_TYPE.HOUR_12] = 12 * 3600 * 1000;  // 43,200,000
    DURATION_MS[TIME_MACHINE_TIME_TYPE.HOUR_24] = 24 * 3600 * 1000;  // 86,400,000

    var VALID_MACHINE_IDS = [1, 2, 3];
    var MIN_LESSON = 1;
    var MAX_LESSON = 10;

    // ── Resource Loader (cached sync XHR — sama dengan dungeon/startBattle.js) ──

    var _resCache = {};

    function loadJson(name) {
        if (_resCache[name]) return _resCache[name];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/' + name + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                var data = JSON.parse(xhr.responseText);
                _resCache[name] = data;
                return data;
            }
            log.warn('TM_START', 'loadJson ' + name + ' HTTP ' + xhr.status);
        } catch (e) {
            log.error('TM_START', 'loadJson ' + name + ' error: ' + e.message);
        }
        return null;
    }

    // ── Main Handler ──

    MainServer.registerHandler('timeMachine', 'start', function (request, callback) {

        var userId    = request.userId    || '';
        var machineId = Number(request.machineId);  // 1|2|3
        var level     = Number(request.level);       // 1-10
        var heroId    = request.heroId;              // instance ID (number or string)
        var timeType  = Number(request.timeType);    // 1=6h, 2=12h, 3=24h

        // ═══════════════════════════════════════════════════════
        //  1. VALIDASI REQUEST
        // ═══════════════════════════════════════════════════════

        if (!userId) {
            log.warn('TM_START', 'missing userId');
            callback({}, 1);
            return;
        }

        if (VALID_MACHINE_IDS.indexOf(machineId) === -1) {
            log.warn('TM_START', 'invalid machineId: ' + machineId);
            callback({}, 1);
            return;
        }

        if (typeof level !== 'number' || level < MIN_LESSON || level > MAX_LESSON) {
            log.warn('TM_START', 'invalid level: ' + level);
            callback({}, 1);
            return;
        }

        // heroId = instance ID — bisa number atau string dari client
        if (heroId === undefined || heroId === null || heroId === '') {
            log.warn('TM_START', 'invalid heroId: ' + heroId);
            callback({}, 1);
            return;
        }
        heroId = String(heroId);

        if (typeof timeType !== 'number' ||
            timeType !== TIME_MACHINE_TIME_TYPE.HOUR_6 &&
            timeType !== TIME_MACHINE_TIME_TYPE.HOUR_12 &&
            timeType !== TIME_MACHINE_TIME_TYPE.HOUR_24) {
            log.warn('TM_START', 'invalid timeType: ' + timeType);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  2. LOAD USER DATA
        // ═══════════════════════════════════════════════════════

        var storageKey = 'ms_user_' + userId + '_1';
        var savedData = db._get(storageKey);
        if (!savedData) {
            log.warn('TM_START', 'user data not found: ' + storageKey);
            callback({}, 1);
            return;
        }

        // ═══════════════════════════════════════════════════════
        //  3. ENSURE timeMachine STATE (SHARD-SAFE)
        // ═══════════════════════════════════════════════════════

        if (!savedData.timeMachine || typeof savedData.timeMachine !== 'object') {
            savedData.timeMachine = { _items: {} };
        }
        if (!savedData.timeMachine._items || typeof savedData.timeMachine._items !== 'object') {
            savedData.timeMachine._items = {};
        }

        var items = savedData.timeMachine._items;
        var slotKey = String(machineId);

        // ═══════════════════════════════════════════════════════
        //  4. SLOT VALIDATION — reject jika sudah dipakai
        // ═══════════════════════════════════════════════════════

        var existingSlot = items[slotKey];
        if (existingSlot !== null && existingSlot !== undefined) {
            var existingFinishTime = Number(existingSlot._finishTime) || 0;
            var now = Date.now();

            if (existingFinishTime > now) {
                log.warn('TM_START', 'slot ' + machineId + ' already in use, finishTime=' + existingFinishTime + ' > now=' + now);
                callback({}, 1);
                return;
            }

            // finishTime <= now → slot expired tapi belum di-claim
            // Izinkan overwrite (safety fallback)
            log.warn('TM_START', 'slot ' + machineId + ' expired but not claimed, allowing overwrite');
        }

        // ═══════════════════════════════════════════════════════
        //  5. RESOLVE heroDisplayId dari heroId (instance ID)
        // ═══════════════════════════════════════════════════════

        var heroDisplayId = 0;

        var herosCollection = null;
        if (savedData.heros && savedData.heros._heros) {
            herosCollection = savedData.heros._heros;
        } else if (savedData._heros) {
            herosCollection = savedData._heros;
        }

        if (herosCollection) {
            var heroEntry = herosCollection[heroId];
            if (heroEntry && heroEntry._heroDisplayId !== undefined) {
                heroDisplayId = Number(heroEntry._heroDisplayId) || 0;
            }
        }

        if (heroDisplayId === 0) {
            log.warn('TM_START', 'cannot resolve heroDisplayId for heroId=' + heroId + ', fallback 0');
        }

        // ═══════════════════════════════════════════════════════
        //  6. HITUNG finishTime
        // ═══════════════════════════════════════════════════════

        var durationMs = DURATION_MS[timeType] || DURATION_MS[TIME_MACHINE_TIME_TYPE.HOUR_6];
        var finishTime = Date.now() + durationMs;

        // ═══════════════════════════════════════════════════════
        //  7. AMBIL bossId dari timeTravel[level].bossID
        // ═══════════════════════════════════════════════════════

        var bossId = 0;
        var levelKey = String(level);
        var timeTravelConfig = loadJson('timeTravel');
        if (timeTravelConfig && timeTravelConfig[levelKey]) {
            bossId = Number(timeTravelConfig[levelKey].bossID) || 0;
        }

        // ═══════════════════════════════════════════════════════
        //  8. BUILD ITEM
        // ═══════════════════════════════════════════════════════

        var newItem = {
            _level: level,
            _heroId: heroId,
            _heroDisplayId: heroDisplayId,
            _timeType: timeType,
            _finishTime: finishTime,
            _bossId: bossId
        };

        // ═══════════════════════════════════════════════════════
        //  9. SHARD SAVE — update HANYA slot ini
        // ═══════════════════════════════════════════════════════

        items[slotKey] = newItem;
        db._set(storageKey, savedData);

        // ═══════════════════════════════════════════════════════
        //  10. RESPONSE
        // ═══════════════════════════════════════════════════════

        var response = {
            _item: {
                _level: newItem._level,
                _heroId: newItem._heroId,
                _heroDisplayId: newItem._heroDisplayId,
                _timeType: newItem._timeType,
                _finishTime: newItem._finishTime,
                _bossId: newItem._bossId
            }
        };

        log.details('TM_START', [
            ['userId', userId],
            ['machineId', String(machineId)],
            ['level', String(level)],
            ['heroId', heroId],
            ['heroDisplayId', String(heroDisplayId)],
            ['timeType', String(timeType)],
            ['finishTime', String(finishTime)],
            ['bossId', String(bossId)],
            ['duration_min', String(durationMs / 60000)]
        ]);

        callback(response);
    });

})();