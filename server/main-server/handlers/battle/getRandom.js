/**
 * handlers/battle/getRandom.js
 * Super Warrior Z — Private Server
 *
 * Fungsi: Generate array of random numbers untuk battle engine.
 *
 * CLIENT EVIDENCE (main.min.js):
 *   BattleStatic.createBatchRandom (L67308-67318):
 *     ts.processHandler({
 *         type: "battle",
 *         action: "getRandom",
 *         userId, battleId, count, version: "1.0"
 *     }, function(e) {
 *         t(e._rand)   // callback receives e._rand
 *     })
 *
 *   RandomManager.addRandomList (L45156-45158):
 *     randomNumCache = [];
 *     for (b = 0; b < a.length; b++) randomNumCache.push(a[b])
 *
 *   RandomManager.getOneRandom (L45160-45166):
 *     a = randomNumCache[currentIndex];
 *     return Math.round(1E5 * a) / 1E5   // 5 decimal precision
 *
 *   RandomManager.getRandomIndex (L45168-45171):
 *     b = getOneRandom();
 *     b = Math.floor(a * b);   // a = array length
 *
 * USAGE:
 *   - battleWithPVEAndTeamAndBattle (skip battle): createBatchRandom(100, ...)
 *   - bossBattleWithPVEAndTeam (skip battle): createBatchRandom(100, ...)
 *   - shalu battle: createBatchRandom(100, ...)
 *
 * REQUEST:
 *   { type:"battle", action:"getRandom", userId, battleId, count:100, version:"1.0" }
 *
 * RESPONSE:
 *   { ret:0, _rand: [0.123, 0.456, ..., 0.789] }
 *   _rand = array of `count` random floats between 0 and 1
 */

(function () {
    'use strict';

    var MainServer = window.MainServer;
    var log = MainServer.log;

    function handleGetRandom(request, callback) {
        var userId = request.userId;
        var count = Number(request.count) || 100;

        log.info('HANDLER', 'battle/getRandom processing');
        log.details('request', [
            ['userId', String(userId)],
            ['battleId', String(request.battleId || '')],
            ['count', String(count)]
        ]);

        // Generate random floats 0..1
        var rand = [];
        for (var i = 0; i < count; i++) {
            rand.push(Math.random());
        }

        var response = {
            ret: 0,
            type: 'battle',
            action: 'getRandom',
            userId: userId,
            _rand: rand
        };

        log.info('HANDLER', 'battle/getRandom SUCCESS');
        log.details('result', [
            ['count', String(rand.length)],
            ['first3', rand.slice(0, 3).map(function(v) { return v.toFixed(5); }).join(', ')],
            ['last3', rand.slice(-3).map(function(v) { return v.toFixed(5); }).join(', ')]
        ]);

        callback(response);
    }

    MainServer.registerHandler('battle', 'getRandom', handleGetRandom);
    window.MainServer = MainServer;
})();
