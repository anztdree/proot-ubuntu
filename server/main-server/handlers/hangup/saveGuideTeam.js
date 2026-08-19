/**
 * handlers/hangup/saveGuideTeam.js — Guide Battle Team Save Handler
 * Super Warrior Z — MAIN SERVER
 *
 * ============================================================
 * HANDLER: hangup/saveGuideTeam
 * ============================================================
 *
 * TUJUAN UTAMA: Menyimpan team & super skill yang dipilih player
 * selama tutorial battle ke persistent storage, sehingga:
 *   1. enterGame.js bisa mengembalikannya via lastTeam._lastTeamInfo
 *      pada login berikutnya
 *   2. checkBattleResult bisa menggunakannya untuk menentukan
 *      hasil pertempuran
 *
 * ============================================================
 * CLIENT EVIDENCE (2 call sites):
 * ============================================================
 *
 * ── CALL SITE 1: Guide Step 2107 (L104860-104916) ──
 *
 *   Context: TSGUIDECONFIG[2107].tapAction
 *   Trigger: Player menekan "Battle Start" di tutorial battle #1
 *   Scene: BattleStart → chaterID: 1, lessonID: 10101
 *
 *   var t = e.data,                                   // BattleStartData
 *       n = t.getBattleHero(),                        // [{heroId:1205}, {heroId:1206}, null, ...]
 *       o = ReadJsonSingleton.getInstance().constant[1],
 *       a = [o.tutorialSuperSkill];                    // → ["1120561"] (string!)
 *
 *   UserInfoSingleton.getInstance()
 *       .setMyTeamByType(LAST_TEAM_TYPE.HANGUP, n, a); // CLIENT-SIDE save (L96204)
 *
 *   ts.processHandler({
 *       type: 'hangup',
 *       action: 'saveGuideTeam',
 *       userId: r,
 *       team: n,               // [{heroId:...}, null, ...]
 *       supers: a,              // ["1120561"]
 *       version: '1.0'
 *   }, function (e) {          // saveGuideTeam callback
 *       // e = saveGuideTeam response (TIDAK DIBACA — di-shadow)
 *       // Chain → checkBattleResult
 *       ts.processHandler({
 *           type: 'hangup',
 *           action: 'checkBattleResult',
 *           userId: ...,
 *           version: '1.0',
 *           isGuide: true
 *       }, function (e) {      // e = checkBattleResult response (SHADOWS outer e)
 *           // BACA: e._battleResult, e._changeInfo._items, e._curLess, e._maxPassLesson
 *       });
 *   }, function (e) {          // ERROR callback
 *       Logger.serverDebugLog('失败!!!');
 *   });
 *
 * ── CALL SITE 2: Guide Step 2508 (L105799-105856) ──
 *
 *   Context: TSGUIDECONFIG[2508].tapAction
 *   Trigger: Player menekan "Battle Start" di tutorial battle #2
 *   Scene: BattleStart → chaterID: 2, lessonID: 10102
 *
 *   var t = e.data,
 *       n = t.getBattleHero(),       // [{heroId:...}, null, ...]
 *       o = e.superSkillArray();     // player-chosen skills from UI
 *
 *   ts.processHandler({
 *       type: 'hangup',
 *       action: 'saveGuideTeam',
 *       userId: a,
 *       team: n,
 *       supers: o,              // player-chosen skill IDs
 *       version: '1.0'
 *   }, function (e) { // same chain pattern });
 *
 * ============================================================
 * PERBEDAAN 2107 vs 2508:
 * ============================================================
 *
 * | Aspect      | 2107                          | 2508                          |
 * |-------------|-------------------------------|-------------------------------|
 * | supers      | ["1120561"] hardcoded string   | player-chosen (number/string)|
 * | chaterID    | 1                             | 2                             |
 * | lessonID    | tutorialLesson.split(',')[0]   | tutorialLesson.split(',')[1]  |
 *
 * ============================================================
 * DATA FLOW ANALYSIS (WHY handler MUST persist data):
 * ============================================================
 *
 *   ┌─────────────────┐     saveGuideTeam      ┌──────────────┐
 *   │ CLIENT MEMORY   │ ──── team, supers ────→ │ SERVER DB    │
 *   │                │                          │              │
 *   │ _lastTeamInfo  │ ← firstLoginSetMyTeam   │ lastTeam.    │
 *   │   [9] = {      │     dari enterGame resp  │  _lastTeam   │
 *   │     _team,     │                          │   Info["9"]  │
 *   │     _super     │                          │              │
 *   │   }            │                          └──────────────┘
 *   └─────────────────┘                                │
 *           │                                         │
 *           │ setMyTeamByType (runtime)              │ db._get/set
 *           │                                         │
 *   ┌───────┴──────────┐                     ┌────────┴─────┐
 *   │ RUNTIME SESSION  │                     │ PERSISTENT   │
 *   │ (volatile)       │                     │ (survives    │
 *   │                  │                     │  logout)     │
 *   └──────────────────┘                     └──────────────┘
 *
 *   CLIENT-side:
 *     1. Guide step → setMyTeamByType(HANGUP, team, supers)
 *        → Menyimpan ke _lastTeamInfo[9] di MEMORY saja (volatile)
 *     2. Guide step → processHandler('saveGuideTeam')
 *        → Kirim ke SERVER untuk persist
 *     3. On login → enterGame response → firstLoginSetMyTeam(lastTeam._lastTeamInfo)
 *        → Restore dari SERVER ke _lastTeamInfo di memory
 *
 *   SERVER-side (handler):
 *     1. Receive team & supers dari client
 *     2. Convert format client → format server storage
 *     3. Save ke savedData.lastTeam._lastTeamInfo["9"]
 *     4. db._set(storageKey, savedData)
 *
 * ============================================================
 * FORMAT CONVERSION (CRITICAL):
 * ============================================================
 *
 *   CLIENT SENDS (request payload):
 *     team: [{heroId:1205}, {heroId:1206}, null, null, null, null]
 *     supers: ["1120561"] atau [1120561]
 *
 *   SERVER MUST STORE (firstLoginSetMyTeam format):
 *     savedData.lastTeam._lastTeamInfo = {
 *       "9": {
 *         _team: [{_heroId: 1205, _position: 0}, {_heroId: 1206, _position: 1}],
 *         _superSkill: [{_id: "1120561"}]
 *       }
 *     }
 *
 *   EVIDENCE: firstLoginSetMyTeam (L96167-96184):
 *     for (var n in e) {           // e = _lastTeamInfo object, n = "9"
 *       var r = e[n],              // r = { _team: [...], _superSkill: [...] }
 *         i = r._team,             // i = array of {_heroId, _position}
 *         s = r._superSkill;       // s = array of {_id: skillId}
 *       for (var l in i) {
 *         u._heroId = i[l]._heroId;   // reads _heroId
 *         u._position = i[l]._position; // reads _position
 *       }
 *       for (var l in s)
 *         o._super.push(s[l]._id);    // reads _id from each superskill
 *       t._lastTeamInfo[parseInt(n)] = o; // key = integer (9)
 *     }
 *
 *   CATATAN: Client setMyTeamByType (L96204-96217) menyimpan
 *   _super (raw IDs), tapi firstLoginSetMyTeam membaca _superSkill
 *   (objects with _id). Field name BEDA!
 *
 *   LAST_TEAM_TYPE.HANGUP = 9 (L96503 dari enum definition)
 *
 * ============================================================
 * DEEP MERGE SURVIVAL (enterGame returning user):
 * ============================================================
 *
 *   enterGame.js L1727: savedData = deepMerge(savedData, freshDefaults)
 *   deepMerge rule (L1555-1600):
 *     - Field di saved → saved WINS
 *     - Field HANYA di defaults → ambil dari defaults
 *     - null di saved → L1566: return defaults (!)
 *     - Nested object → recurse
 *     - Array → saved WINS, no merge
 *
 *   ScENARIO: saveGuideTeam sudah simpan lastTeam._lastTeamInfo["9"]
 *   Lalu player login lagi:
 *     saved  = { lastTeam: { _lastTeamInfo: { "9": {...} } } }
 *     deflt  = { lastTeam: { _lastTeamInfo: null } }
 *
 *     deepMerge(lastTeam):
 *       key "_lastTeamInfo": saved = {"9":{...}}, defaults = null
 *       L1569: typeof defaults !== 'object' || defaults === null → TRUE
 *       → return saved = {"9":{...}}  ← DATA PRESERVED!
 *
 *   CONCLUSION: Jika saveGuideTeam simpan ke _lastTeamInfo["9"]
 *   dengan benar, data AKAN survive melalui deepMerge di enterGame.
 *
 * ============================================================
 * RESPONSE FORMAT (from HAR evidence pattern):
 * ============================================================
 *
 *   ALL real server handlers follow this pattern:
 *     1. Echo ALL request fields (type, action, userId, version, ...)
 *     2. Add response-specific fields
 *
 *   saveGuideTeam callback TIDAK MEMBACA response body (di-shadow
 *   oleh inner checkBattleResult callback), TAPI:
 *     - ret=0 WAJIB agar client lanjut ke checkBattleResult
 *     - Echo fields membantu debugging (console log L113849)
 *     - Consistency dengan pattern real server
 *
 *   Response yang benar:
 *     {
 *       type: 'hangup',
 *       action: 'saveGuideTeam',
 *       userId: '...',
 *       team: [...],        ← echo request
 *       supers: [...],      ← echo request
 *       version: '1.0'       ← echo request
 *     }
 *
 *   NOTE: TIDAK perlu _addHeroes, _changeInfo, dll.
 *   Field tersebut ada di checkBattleResult response (bukan saveGuideTeam).
 *   saveGuideTeam = SAVE operation saja, bukan battle result.
 *
 * ============================================================
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════
    //
    //  LAST_TEAM_TYPE.HANGUP = 9 (L96503)
    //  Digunakan sebagai key di _lastTeamInfo.
    //  Evidence: enum definition (L96493-96520)

    var LAST_TEAM_TYPE_HANGUP = 9;

    // ═══════════════════════════════════════════════════════════
    //  HANDLER: hangup/saveGuideTeam
    // ═══════════════════════════════════════════════════════════

    /**
     * handleSaveGuideTeam(request, callback)
     *
     * Menyimpan team & super skill untuk guide battle ke persistent storage.
     *
     * EXECUTION FLOW:
     *   1. Player tap "Battle Start" di guide step (2107 or 2508)
     *   2. Client: setMyTeamByType(HANGUP, team, supers) — CLIENT MEMORY (volatile)
     *   3. Client: processHandler('hangup/saveGuideTeam') — SERVER (persistent)
     *   4. Server: validate → convert format → save to lastTeam._lastTeamInfo["9"]
     *   5. Server: callback(response) → ret=0 → client proceeds
     *   6. Client: chain → processHandler('hangup/checkBattleResult', {isGuide:true})
     *
     * CRITICAL: Data disimpan di lastTeam._lastTeamInfo["9"] (BUKAN di
     * hangup._lastTeam!) karena:
     *   - enterGame.js mengirim lastTeam._lastTeamInfo ke client pada login
     *   - Client firstLoginSetMyTeam (L96167) membaca format ini
     *   - deepMerge di enterGame L1727 akan preserve data ini
     *
     * @param {object} request — { type, action, userId, team, supers, version }
     * @param {function} callback(responseData, retCode) — retCode: 0=success
     */
    function handleSaveGuideTeam(request, callback) {
        var userId = request.userId;
        var team = request.team;
        var supers = request.supers;

        log.info('HANDLER', 'hangup/saveGuideTeam processing');
        log.details('request', [
            ['userId', userId || '-'],
            ['team', JSON.stringify(team) || '-'],
            ['supers', JSON.stringify(supers) || '-'],
            ['version', request.version || '-']
        ]);

        // ── STEP 1: Validate userId ──
        if (!userId) {
            log.warn('HANDLER', 'hangup/saveGuideTeam — missing userId, returning success anyway');
            log.details('note', ['reason', 'Guide must not be blocked even if userId is missing']);
            callback(buildResponse(request));
            return;
        }

        // ── STEP 2: Validate team format ──
        // Client mengirim: [{heroId:1205}, {heroId:1206}, null, null, null, null]
        // null = slot kosong → NORMAL untuk team dengan < 6 hero
        if (!team || !Array.isArray(team)) {
            log.warn('HANDLER', 'hangup/saveGuideTeam — team is not array, cannot save');
            log.details('fallback', ['action', 'Returning success — guide must proceed']);
            callback(buildResponse(request));
            return;
        }

        // ── STEP 3: Validate supers format ──
        // 2107: ["1120561"] (hardcoded string dari constant.json tutorialSuperSkill)
        // 2508: [id1, id2, ...] (player-chosen, bisa string atau number)
        if (!supers || !Array.isArray(supers)) {
            log.warn('HANDLER', 'hangup/saveGuideTeam — supers invalid');
            // Jangan block — supers empty masih acceptable
            supers = [];
        }

        // ── STEP 4: Read user data from persistent storage ──
        var storageKey = 'user:' + userId;
        var savedData = db._get(storageKey);

        if (!savedData) {
            // User data belum ada — bisa terjadi jika enterGame belum selesai
            // Jangan block guide! Return success agar client lanjut ke checkBattleResult
            log.warn('HANDLER', 'hangup/saveGuideTeam — user data not found in DB');
            log.details('note', [
                ['reason', 'enterGame may not have completed yet'],
                ['action', 'Returning success — guide progression must not be blocked']
            ]);
            callback(buildResponse(request));
            return;
        }

        // ── STEP 5: Convert team format: CLIENT → SERVER STORAGE ──
        //
        // CLIENT format (request payload):
        //   [{heroId:1205}, {heroId:1206}, null, null, null, null]
        //   - Index = position (0-5)
        //   - null = empty slot
        //   - heroId bisa string ATAU number
        //
        // SERVER STORAGE format (firstLoginSetMyTeam expects):
        //   [{_heroId: 1205, _position: 0}, {_heroId: 1206, _position: 1}]
        //   - _heroId: hero display ID
        //   - _position: slot index
        //   - null entries are REMOVED (only active heroes)
        //
        // Evidence:
        //   setMyTeamByType (L96204-96217) — builds BattleTeamItem with _heroId, _position
        //   firstLoginSetMyTeam (L96167-96184) — reads _heroId and _position from each entry
        //
        var serverTeam = [];
        for (var i = 0; i < team.length; i++) {
            if (team[i] != null && team[i].heroId != null) {
                serverTeam.push({
                    _heroId: Number(team[i].heroId) || team[i].heroId,
                    _position: i
                });
            }
        }

        // ── STEP 6: Convert supers format: CLIENT → SERVER STORAGE ──
        //
        // CLIENT format (request payload):
        //   ["1120561"] atau [1120561]
        //   - Array of skill IDs (string atau number)
        //
        // SERVER STORAGE format (firstLoginSetMyTeam expects):
        //   [{_id: "1120561"}, {_id: 1120561}]
        //   - Array of objects with _id field
        //
        // Evidence:
        //   setMyTeamByType (L96216) — s._super = n (raw IDs array)
        //   firstLoginSetMyTeam (L96182-96183) — o._super.push(s[l]._id)
        //     Catatan: setMyTeamByType stores _super (raw IDs),
        //     tapi firstLoginSetMyTeam reads _superSkill (objects with _id)!
        //     Field name BERBEDA antara client memory dan server storage format!
        //
        var serverSupers = [];
        for (var i = 0; i < supers.length; i++) {
            if (supers[i] != null && supers[i] !== '') {
                serverSupers.push({ _id: supers[i] });
            }
        }

        // ── STEP 7: Save to CORRECT persistent location ──
        //
        // TARGET: savedData.lastTeam._lastTeamInfo["9"]
        //
        // WHY this location (NOT hangup._lastTeam!):
        //   1. enterGame.js L960: r.lastTeam = { _lastTeamInfo: null }
        //      — Schema defines lastTeam as top-level field
        //   2. enterGame.js L1727: deepMerge(savedData, freshDefaults)
        //      — lastTeam._lastTeamInfo will be preserved if not null
        //   3. Client L114823: e.lastTeam && firstLoginSetMyTeam(e.lastTeam._lastTeamInfo)
        //      — Client reads from this exact path on every login
        //   4. firstLoginSetMyTeam (L96167-96184) expects:
        //      { "9": { _team: [{_heroId, _position}], _superSkill: [{_id}] } }
        //
        // WHY NOT hangup._lastTeam:
        //   - enterGame.js TIDAK pernah mengirim hangup._lastTeam ke client
        //   - Client TIDAK pernah membaca hangup._lastTeam
        //   - Data di hangup._lastTeam akan hilang/terisolasi
        //
        // Initialize structure if needed
        if (!savedData.lastTeam) {
            savedData.lastTeam = {};
            log.details('init', ['lastTeam', 'Initialized lastTeam object']);
        }

        if (savedData.lastTeam._lastTeamInfo === null ||
            savedData.lastTeam._lastTeamInfo === undefined) {
            savedData.lastTeam._lastTeamInfo = {};
            log.details('init', ['_lastTeamInfo', 'Initialized _lastTeamInfo from null/undefined']);
        }

        // Save team data under LAST_TEAM_TYPE.HANGUP (= 9) key
        savedData.lastTeam._lastTeamInfo[String(LAST_TEAM_TYPE_HANGUP)] = {
            _team: serverTeam,
            _superSkill: serverSupers
        };

        log.details('saved', [
            ['location', 'lastTeam._lastTeamInfo["' + LAST_TEAM_TYPE_HANGUP + '"]'],
            ['teamHeroes', String(serverTeam.length)],
            ['superSkills', String(serverSupers.length)],
            ['teamDetail', JSON.stringify(serverTeam)],
            ['supersDetail', JSON.stringify(serverSupers)]
        ]);

        // ── STEP 8: Also save raw data to hangup for checkBattleResult ──
        //
        // checkBattleResult (yang belum ada handler-nya) mungkin perlu
        // mengakses team data. Menyimpan di hangup sebagai backup reference.
        // Format: raw client format ( [{heroId:...}, null, ...] )
        //
        if (!savedData.hangup) {
            savedData.hangup = {
                _curLess: 10101,
                _maxPassLesson: 0,
                _haveGotChapterReward: {},
                _maxPassChapter: 801,
                _clickGlobalWarBuffTag: '',
                _buyFund: false,
                _haveGotFundReward: {}
            };
            log.details('init', ['hangup', 'Initialized hangup data structure']);
        }

        savedData.hangup._lastTeam = team || [];
        savedData.hangup._lastSupers = supers || [];

        // ── STEP 9: Persist to database ──
        db._set(storageKey, savedData);

        log.info('HANDLER', 'hangup/saveGuideTeam SUCCESS — team data persisted');
        log.details('result', [
            ['userId', userId],
            ['storageKey', storageKey],
            ['lastTeamType', 'HANGUP (' + LAST_TEAM_TYPE_HANGUP + ')'],
            ['teamHeroes', String(serverTeam.length)],
            ['superSkills', String(serverSupers.length)],
            ['nextAction', 'client will call checkBattleResult(isGuide:true)']
        ]);

        // ── STEP 10: Return response following real server pattern ──
        callback(buildResponse(request));
    }

    // ═══════════════════════════════════════════════════════════
    //  RESPONSE BUILDER
    // ═══════════════════════════════════════════════════════════
    //
    //  Pattern dari real server (HAR evidence):
    //    1. Echo ALL request fields
    //    2. Add response-specific fields (jika ada)
    //
    //  Untuk saveGuideTeam:
    //    - Callback TIDAK membaca response body (shadowed oleh inner
    //      checkBattleResult callback)
    //    - TAPI echo penting untuk debugging (console log L113849)
    //    - DAN consistency dengan real server pattern
    //
    //  TIDAK PERLU: _addHeroes, _changeInfo, dll.
    //  Field tersebut ada di checkBattleResult response, bukan saveGuideTeam.
    //  saveGuideTeam = SAVE operation saja.

    /**
     * buildResponse(request) — Build response following real server pattern.
     *
     * @param {object} request — original request
     * @returns {object} response data
     */
    function buildResponse(request) {
        return {
            type: request.type || 'hangup',
            action: request.action || 'saveGuideTeam',
            userId: request.userId,
            team: request.team,
            supers: request.supers,
            version: request.version || '1.0'
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTER HANDLER
    // ═══════════════════════════════════════════════════════════

    MainServer.registerHandler('hangup', 'saveGuideTeam', handleSaveGuideTeam);

    window.MainServer = MainServer;
})();
