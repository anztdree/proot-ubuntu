/**
 * ═══════════════════════════════════════════════════════════════════════
 *  HANDLER: arena/setTeam
 *  Super Warrior Z — Private Server (MAIN SERVER port 8001)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Menyimpan defense team yang dipilih pemain untuk Arena.
 *
 *  Client mengirim:
 *    team: [{heroId: "1003"}, null, {heroId: "1205"}, null, {heroId: "1501"}]
 *    super: [Number(skillId1), Number(skillId2)]
 *
 *  Handler ini:
 *    1. Simpan raw heroIds ke arenaState (in-memory) + savedData (persist)
 *    2. Hero lookup & build full entry hanya untuk _defenseTeamFull (optimasi join)
 *    3. Jika lookup gagal, fallback: simpan heroId saja, join akan lookup ulang
 *
 *  HERO DATA PATH:
 *    savedData.heros._heros  ←  PATH YANG BENAR (enterGame menyimpan di sini)
 *    savedData._heros        ←  fallback (untuk backward compatibility)
 *
 *  RESPONSE: {} (empty, client hanya cek error)
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;
    var db = window.MainServerDB;

    var ATTR_COUNT = 22;
    var _heroCfg = null;

    function loadHeroCfg() {
        if (_heroCfg) return _heroCfg;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', './resource/json/hero.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _heroCfg = JSON.parse(xhr.responseText);
            }
        } catch (e) {}
        return _heroCfg;
    }

    /**
     * Ambil hero collection dari savedData.
     * Hero disimpan di savedData.heros._heros oleh enterGame.
     * Fallback ke savedData._heros untuk backward compatibility.
     */
    function getHeroCollection(savedData) {
        if (savedData.heros && savedData.heros._heros) {
            return savedData.heros._heros;
        }
        if (savedData._heros) {
            return savedData._heros;
        }
        return null;
    }

    /**
     * Lookup hero dari savedData berdasarkan heroId.
     * Hero collection ada di savedData.heros._heros (bukan savedData._heros).
     *
     * @param {string|number} heroId - ID hero dari client
     * @param {object} savedData - data pemain dari db._get()
     * @returns {object|null} hero object, atau null
     */
    function findHero(heroId, savedData) {
        var heros = getHeroCollection(savedData);
        if (!heros) return null;

        var normalizedId = String(heroId);

        // Legacy fix: strip 'h_' prefix dari bug lama
        var cleanId = normalizedId;
        if (cleanId.indexOf('h_') === 0 && cleanId.length > 2) {
            cleanId = cleanId.substring(2);
        }

        for (var key in heros) {
            var hero = heros[key];
            if (!hero) continue;

            var heroDefId = String(hero._heroId);
            var heroInstId = (hero._id != null) ? String(hero._id) : '';

            if (heroDefId === normalizedId || heroInstId === normalizedId ||
                heroDefId === cleanId || heroInstId === cleanId) {
                return hero;
            }
        }
        return null;
    }

    /**
     * Build FULL hero entry — format IDENTIK dengan _lastDenfenceTeam[pos].
     * Client membaca: _id, _heroDisplayId, _heroStar, _heroLevel,
     *   _attrs._items[21]._num (Power), _skinId, _weaponHaloId, _weaponHaloLevel
     */
    function buildFullHeroEntry(hero) {
        if (!hero) return null;

        var displayId = Number(hero._heroDisplayId) || Number(hero._heroId) || 0;

        // VALIDASI: displayId HARUS ada di hero.json.
        // Client getLocalHeroInfo()[displayId] akan return null kalau tidak ada → crash/NaN.
        if (displayId > 0) {
            var hc = loadHeroCfg();
            if (!hc || !hc[String(displayId)]) {
                log.warn('ARENA_SETTEAM', 'Hero displayId=' + displayId +
                    ' not in hero.json — skipping (heroId=' + hero._heroId + ')');
                return null;
            }
        } else {
            return null;
        }
        var heroDefId = hero._heroId || String(hero._heroDisplayId) || String(displayId);
        var star = hero._heroStar || 0;
        var level = hero._heroLevel || 1;

        var attrItems = [];
        var existingAttrs = (hero._attrs && hero._attrs._items) ? hero._attrs._items : null;

        for (var i = 0; i < ATTR_COUNT; i++) {
            var num = 0;
            if (existingAttrs) {
                for (var j = 0; j < existingAttrs.length; j++) {
                    if (existingAttrs[j]._id === i) {
                        num = existingAttrs[j]._num || 0;
                        break;
                    }
                }
            }
            // Power fallback
            if (i === 21 && num === 0) {
                var hpVal = 0, atkVal = 0, armorVal = 0;
                if (existingAttrs) {
                    for (var k = 0; k < existingAttrs.length; k++) {
                        if (existingAttrs[k]._id === 0) hpVal = existingAttrs[k]._num || 0;
                        if (existingAttrs[k]._id === 1) atkVal = existingAttrs[k]._num || 0;
                        if (existingAttrs[k]._id === 2) armorVal = existingAttrs[k]._num || 0;
                    }
                }
                num = Math.floor(hpVal * 0.5 + atkVal * 3 + armorVal * 2);
                if (num === 0) num = 1000;
            }
            attrItems.push({ _id: i, _num: num });
        }

        return {
            _id: heroDefId,
            _heroId: heroDefId,
            _heroDisplayId: displayId,
            _heroStar: star,
            _heroLevel: level,
            _skinId: hero._skinId || 0,
            _weaponHaloId: hero._weaponHaloId || 0,
            _weaponHaloLevel: hero._weaponHaloLevel || 0,
            _attrs: { _items: attrItems }
        };
    }

    // ═══════════════════════════════════════════════════
    //  HANDLER: arena/setTeam
    // ═══════════════════════════════════════════════════

    MainServer.registerHandler('arena', 'setTeam', function (requestData, callback) {
        var userId = requestData.userId;
        var team = requestData.team;
        var superSkills = requestData['super'];

        // ── VALIDASI ──
        if (!userId) {
            log.warn('ARENA_SETTEAM', 'no userId');
            callback({}, 1);
            return;
        }
        if (!team || !Array.isArray(team)) {
            log.warn('ARENA_SETTEAM', 'no valid team array userId=' + userId);
            callback({}, 1);
            return;
        }

        // ── LOAD SAVEDATA ──
        var savedData = db._get('ms_user_' + userId + '_1');
        if (!savedData) {
            log.warn('ARENA_SETTEAM', 'No savedData for userId=' + userId);
            callback({}, 1);
            return;
        }

        // ── ENSURE ARENA STATE ──
        if (!MainServer._arenaStates) {
            MainServer._arenaStates = {};
        }
        if (!MainServer._arenaStates[userId]) {
            MainServer._arenaStates[userId] = {
                _rank: 99999,
                _topRank: 99999,
                _dailyRank: 99999,
                _dailyRewardTag: '',
                _rewardTags: [],
                _attackTimes: 5,
                _buyTimesCount: 0,
                _lastDailyReset: Date.now(),
                _defenseTeam: null,
                _defenseSuper: null,
                _defenseTeamFull: null,
                _defenseSuperFull: null
            };
        }

        var arenaState = MainServer._arenaStates[userId];

        // ══════════════════════════════════════════════
        //  STEP 1: Build simpleTeam dari client data
        //  SIMPAN heroId LANGSUNG dari client, TANPA lookup.
        //  Hero lookup dilakukan oleh join saat dibutuhkan.
        // ══════════════════════════════════════════════

        var simpleTeam = [];
        var fullTeam = {};
        var heroCount = 0;
        var missingHeroes = [];

        for (var i = 0; i < Math.min(5, team.length); i++) {
            var slot = team[i];

            if (slot && slot.heroId) {
                var clientHeroId = String(slot.heroId);

                // SIMPAN heroId langsung — TIDAK bergantung pada findHero
                simpleTeam.push({ heroId: clientHeroId });

                // Coba build full entry (optimasi untuk join)
                var hero = findHero(clientHeroId, savedData);
                if (hero) {
                    var entry = buildFullHeroEntry(hero);
                    if (entry) {
                        fullTeam[String(i)] = entry;
                        heroCount++;
                        continue;
                    }
                    // buildFullHeroEntry return null = displayId tidak valid di hero.json
                    missingHeroes.push(clientHeroId + '(invalid displayId)');
                } else {
                    missingHeroes.push(clientHeroId + '(not found)');
                }
            } else {
                simpleTeam.push(null);
            }
        }

        // ══════════════════════════════════════════════
        //  STEP 2: Build super skills
        // ══════════════════════════════════════════════

        var fullSuper = {};
        var simpleSuper = [];

        if (superSkills && Array.isArray(superSkills)) {
            for (var j = 0; j < Math.min(2, superSkills.length); j++) {
                if (superSkills[j] != null && superSkills[j] !== '') {
                    var skillId = String(superSkills[j]);
                    fullSuper[String(j)] = { _id: skillId, _level: 1 };
                    simpleSuper.push(skillId);
                }
            }
        }

        // ══════════════════════════════════════════════
        //  STEP 3: Simpan ke arena state (in-memory)
        // ══════════════════════════════════════════════

        arenaState._defenseTeamFull = fullTeam;
        arenaState._defenseSuperFull = fullSuper;
        arenaState._defenseTeam = simpleTeam;
        arenaState._defenseSuper = simpleSuper;

        // ══════════════════════════════════════════════
        //  STEP 4: Persist ke savedData (survives refresh)
        // ══════════════════════════════════════════════

        savedData._arenaTeam = simpleTeam.map(function (slot) {
            return slot ? { _id: slot.heroId } : null;
        });
        savedData._arenaSuper = simpleSuper.map(function (skillId) {
            return { _id: skillId };
        });
        db._set('ms_user_' + userId + '_1', savedData);

        // ══════════════════════════════════════════════
        //  STEP 5: Log & Response
        // ══════════════════════════════════════════════

        log.info('ARENA_SETTEAM', 'OK userId=' + userId +
            ' heroes=' + heroCount + '/5' +
            ' simpleTeam=' + JSON.stringify(simpleTeam) +
            ' supers=' + simpleSuper.length +
            (missingHeroes.length > 0 ? ' LOOKUP_FAILED=[' + missingHeroes.join(',') + ']' : ''));

        callback({});
    });

    window.MainServer = MainServer;
})();