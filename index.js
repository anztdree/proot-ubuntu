/**
 * index.js — MIGRATION FIX ONLY
 * ═══════════════════════════════════════════════════════════════════
 * CARA PAKAI:
 *   Cari blok migration di index.js kamu (di dalam _dbEngine.init(),
 *   di dalam loadAllFromIDB callback), lalu REPLACE blok lama dengan blok baru di bawah.
 *
 * BUG LAMA:
 *   mk = "ms_user_12345_1"
 *   parts = mk.split('_')  →  ['ms','user','12345','1']
 *   newKey = 'user:' + parts[parts.length - 1]  →  "user:1"  ← SALAH!
 *
 * FIX:
 *   mk = "ms_user_12345_1"
 *   remainder = "12345_1"
 *   uid = "12345"  (strip last _segment)
 *   newKey = "user:12345"  ← BENAR
 * ═══════════════════════════════════════════════════════════════════
 */

// ┌─────────────────────────────────────────────────────────┐
// │  REPLACE BLOK LAMA INI:                                │
// │                                                         │
// │  // ── migrate legacy ms_user_S_UID → user:UID ──      │
// │  var migratedKeys = [];                                │
// │  for (var mk in memory) {                              │
// │      if (mk.indexOf('ms_user_') === 0) {              │
// │          var parts = mk.split('_');                    │
// │          if (parts.length >= 4) {                       │
// │              var newKey = 'user:' + parts[parts.length - 1];
// │              if (!memory.hasOwnProperty(newKey)) {    │
// │                  memory[newKey] = memory[mk];          │
// │                  migratedKeys.push(newKey);            │
// │              }                                          │
// │          }                                              │
// │          delete memory[mk];                            │
// │          if (idb) deleteIDB(mk);                       │
// │      }                                                  │
// │  }                                                      │
// └─────────────────────────────────────────────────────────┘

// ┌─────────────────────────────────────────────────────────┐
// │  DENGAN BLOK BARU INI:                                 │
// └─────────────────────────────────────────────────────────┘

// ── migrate legacy ms_user_{UID}_* → user:{UID} ──
// Handler format: 'ms_user_' + userId + '_1'  →  'ms_user_12345_1'
var migratedKeys = [];
for (var mk in memory) {
    if (mk.indexOf('ms_user_') === 0) {
        var remainder = mk.substring(7); // strip "ms_user_"  →  "12345_1"
        var lastUs = remainder.lastIndexOf('_');
        if (lastUs > 0) {
            var uid = remainder.substring(0, lastUs); // "12345"
            var newKey = 'user:' + uid;                // "user:12345"
            if (!memory.hasOwnProperty(newKey)) {
                memory[newKey] = memory[mk];
                migratedKeys.push(newKey);
            }
        }
        delete memory[mk];
        if (idb) deleteIDB(mk);
    }
}
if (migratedKeys.length > 0) {
    log.info('DB', 'Migrated ' + migratedKeys.length + ' legacy key(s) ms_user_* → user:*');
    for (var mi = 0; mi < migratedKeys.length; mi++) {
        writeIDB(migratedKeys[mi], memory[migratedKeys[mi]]);
    }
}
