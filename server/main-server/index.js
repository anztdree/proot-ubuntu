/**
 * index.js — Main Server Foundation (v7)
 * Super Warrior Z — MAIN SERVER (Port 8001)
 *
 * Pondasi utama main-server mock. File ini adalah SATU-SATUNYA file foundation
 * yang dibutuhkan. Semua handler logic ada di handlers/{type}/{action}.js.
 *
 * STRUKTUR:
 *   index.js                    — File ini: socket, router, db, config, TEA verify, IO patch
 *   logger.js                   — Logger + Notify system (load optional, fallback ke inline)
 *   handlers/{type}/{action}.js — Handler files (lazy loaded on-demand)
 *
 * v5 CHANGES:
 *   - SERVER0_TIME = -25200000 (PERSIS formula getTimezoneOffset untuk UTC+7)
 *     Evidence: client L79554: _offTime = 60*clientTZ*1000 - server0Time
 *     Untuk mock=perangkat: server0Time harus = 60*(-420)*1000 = -25200000
 *     Sehingga _offTime=0 dan getServerLocalDate() = waktu perangkat
 *   - serverOpenDate: ditambahkan ke MainServer.config, dikirim via login response
 *     Evidence: client L77661: e.serverOpenDate → UserInfoSingleton._serverOpenDate
 *     Format: unix timestamp ms. Digunakan untuk: VIP gating, temple trial gating,
 *     arena first-day check. Formula: Math.floor((serverTime - openDate) / 86400000) + 1
 *   - RESET_HOUR = 6: daily reset jam 6 pagi waktu server lokal
 *     Evidence: client L52767: if(6 > t) → hari sebelumnya (reset di 6:00 AM)
 *     Evidence: client L135332-135341: SnakeFastBattle cek n >= 6 untuk refresh
 *   - serverTime = Date.now() (UTC ms perangkat — sama dengan server karena mock=perangkat)
 *   - notify() sekarang pakai MainServer.log (bukan langsung log closure)
 *   - (v4 fixes preserved: Base64 padding, DummySocket verify, IDB race, etc.)
 */

(function () {
    'use strict';
    console.error('[INDEX-JS] v7 LOADED — if you see this, index.js v7 is active');

    // ═══════════════════════════════════════════════════════
    //  1. PRE-LOG (sebelum Logger siap)
    // ═══════════════════════════════════════════════════════

    console.log('%c⚡ MAIN-SERVER Loading...', 'color:#FF6F00;font-weight:bold;font-size:14px;');

    // ═══════════════════════════════════════════════════════
    //  2. AUTO-DETECT BASE PATH
    // ═══════════════════════════════════════════════════════

    var basePath = (function () {
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (src.indexOf('main-server/index.js') !== -1) {
                return src.replace('index.js', '');
            }
        }
        return './server/main-server/';
    })();

    // ═══════════════════════════════════════════════════════
    //  3. TEA — SELF-CONTAINED (dari main.min.js L79568-79610)
    // ═══════════════════════════════════════════════════════
    //
    //  Implikasi TEA/XXTEA yang PERSIS SAMA dengan client.
    //  Tidak bergantung pada TEA global dari main.min.js.
    //
    //  Evidence:
    //    main.min.js L79576-79610: TEA class, delta=2654435769, XXTEA variant
    //    main.min.js L79568-79576: Base64 class, alphabet ABCDEFGHIJKLMNOPQRSTUVWXYZ...
    //    main.min.js L52009: new TEA().encrypt(challenge, "verification")
    //    main.min.js L1173 (mock): new TEA().decrypt(encrypted, teaKey)
    //

    var _TEA_Utf8 = (function () {
        function e() {}
        e.encode = function (e) {
            var t = e.replace(/[\u0080-\u07ff]/g, function (e) {
                var t = e.charCodeAt(0);
                return String.fromCharCode(192 | t >> 6, 128 | 63 & t);
            });
            return t = t.replace(/[\u0800-\uffff]/g, function (e) {
                var t = e.charCodeAt(0);
                return String.fromCharCode(224 | t >> 12, 128 | t >> 6 & 63, 128 & 63 & t);
            });
        };
        e.decode = function (e) {
            var t = e.replace(/[\u00e0-\u00ef][\u0080-\u00bf][\u0080-\u00bf]/g, function (e) {
                var t = (15 & e.charCodeAt(0)) << 12 | (63 & e.charCodeAt(1)) << 6 | 63 & e.charCodeAt(2);
                return String.fromCharCode(t);
            });
            return t = t.replace(/[\u00c0-\u00df][\u0080-\u00bf]/g, function (e) {
                var t = (31 & e.charCodeAt(0)) << 6 | 63 & e.charCodeAt(1);
                return String.fromCharCode(t);
            });
        };
        return e;
    })();

    var _TEA_Base64 = (function () {
        function e() {}
        e.code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        // encode — PERSIS sama dengan main.min.js L79570-79576
        // Key logic: `for(; c++<3;) m+="=", p+="\x00";`
        // Ini lockstep: setiap iterasi tambah 1 "=" DAN 1 "\x00" bersamaan.
        // c dimulai dari remainder (1 atau 2), lalu c++ terjadi SEBELUM comparison <3.
        //   Jika c=1: c++→2 <3? ya → "="+"\x00"; c++→3 <3? tidak → stop. Hasil: 2 "=" dan 2 "\x00"
        //   Jika c=2: c++→3 <3? tidak → stop. Hasil: 1 "=" dan 1 "\x00"
        e.encode = function (t) {
            var n, o, a, r, i, s, l, u, c, p, d, g = [], m = "", h = e.code;
            // Main.min.js L79575: p = t (karena parameter utf8=false, tidak ada Utf8.encode wrapper)
            // Dalam konteks TEA, Base64.encode dipanggil tanpa parameter utf8 (default false)
            p = t;
            c = p.length % 3;
            if (c > 0) {
                // L79576: for(; c++<3;) m+="=", p+="\x00";
                // Reimplementasi identik — c++ (post-increment) terjadi SEBELUM <3 comparison
                while (c++ < 3) { m += "="; p += "\x00"; }
            }
            for (c = 0; c < p.length; c += 3) {
                n = p.charCodeAt(c); o = p.charCodeAt(c + 1); a = p.charCodeAt(c + 2);
                r = n << 16 | o << 8 | a;
                i = r >> 18 & 63; s = r >> 12 & 63; l = r >> 6 & 63; u = 63 & r;
                g[c / 3] = h.charAt(i) + h.charAt(s) + h.charAt(l) + h.charAt(u);
            }
            d = g.join("");
            d = d.slice(0, d.length - m.length) + m;
            return d;
        };
        // decode — di-replace oleh fix di bawah
        e.decode = function () { /* placeholder — replaced below */ };
        return e;
    })();

    // decode — PERSIS sama dengan main.min.js L79576 (bagian decode)
    // Real code: `64==l` dan `64==s` karena `=` ada di index 64 alphabet.
    // Alphabet kita juga 65 chars dengan `=` di posisi 64, jadi logikanya IDENTIK.
    _TEA_Base64.decode = function (input) {
        var n, o, a, r, i, s, l, u, c, d = [], g = _TEA_Base64.code;
        for (var m = 0; m < input.length; m += 4) {
            r = g.indexOf(input.charAt(m));
            i = g.indexOf(input.charAt(m + 1));
            s = g.indexOf(input.charAt(m + 2));
            l = g.indexOf(input.charAt(m + 3));
            u = r << 18 | i << 12 | s << 6 | l;
            n = u >>> 16 & 255; o = u >>> 8 & 255; a = 255 & u;
            d[m / 4] = String.fromCharCode(n, o, a);
            if (64 == l) { d[m / 4] = String.fromCharCode(n, o); }
            if (64 == s) { d[m / 4] = String.fromCharCode(n); }
        }
        return d.join("");
    };

    var _TEA = (function () {
        function e() {}
        e.prototype.strToLongs = function (e) {
            var t = new Array(Math.ceil(e.length / 4));
            for (var n = 0; n < t.length; n++) {
                t[n] = e.charCodeAt(4 * n) + (e.charCodeAt(4 * n + 1) << 8) + (e.charCodeAt(4 * n + 2) << 16) + (e.charCodeAt(4 * n + 3) << 24);
            }
            return t;
        };
        e.prototype.longsToStr = function (e) {
            var t = new Array(e.length);
            for (var n = 0; n < e.length; n++) {
                t[n] = String.fromCharCode(255 & e[n], e[n] >>> 8 & 255, e[n] >>> 16 & 255, e[n] >>> 24 & 255);
            }
            return t.join("");
        };
        e.prototype.encrypt = function (plaintext, key) {
            if (0 === plaintext.length) return "";
            var n = this.strToLongs(_TEA_Utf8.encode(plaintext));
            n.length <= 1 && (n[1] = 0);
            for (var o, a, r = this.strToLongs(_TEA_Utf8.encode(key).slice(0, 16)),
                     i = n.length, s = n[i - 1], l = n[0],
                     u = 2654435769, c = Math.floor(6 + 52 / i), p = 0; c-- > 0;) {
                p += u; a = p >>> 2 & 3;
                for (var d = 0; i > d; d++) {
                    l = n[(d + 1) % i];
                    o = (s >>> 5 ^ l << 2) + (l >>> 3 ^ s << 4) ^ (p ^ l) + (r[3 & d ^ a] ^ s);
                    s = n[d] += o;
                }
            }
            return _TEA_Base64.encode(this.longsToStr(n));
        };
        e.prototype.decrypt = function (ciphertext, key) {
            if (0 === ciphertext.length) return "";
            for (var n, o, a = this.strToLongs(_TEA_Base64.decode(ciphertext)),
                     r = this.strToLongs(_TEA_Utf8.encode(key).slice(0, 16)),
                     i = a.length, s = a[i - 1], l = a[0],
                     u = 2654435769, c = Math.floor(6 + 52 / i), p = c * u; 0 !== p;) {
                o = p >>> 2 & 3;
                for (var d = i - 1; d >= 0; d--) {
                    s = a[d > 0 ? d - 1 : i - 1];
                    n = (s >>> 5 ^ l << 2) + (l >>> 3 ^ s << 4) ^ (p ^ l) + (r[3 & d ^ o] ^ s);
                    l = a[d] -= n;
                }
                p -= u;
            }
            var g = this.longsToStr(a);
            g = g.replace(/\0+$/, "");
            return _TEA_Utf8.decode(g);
        };
        return e;
    })();

    // ═══════════════════════════════════════════════════════
    //  4. LOGGER — DITANAM LANGSUNG (100% pasti jalan)
    // ═══════════════════════════════════════════════════════

    var Logger = (function () {

        var PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 99 };
        var STORE_KEY = 'MS_LOG_LEVEL';
        var currentLevel = 'INFO';
        try { currentLevel = localStorage.getItem(STORE_KEY) || 'INFO'; } catch (e) {}
        var minPrio = PRIORITY[currentLevel] !== undefined ? PRIORITY[currentLevel] : 1;

        function shouldLog(level) {
            var p = PRIORITY[level];
            return p !== undefined && p >= minPrio;
        }

        var counts = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, NOTIFY: 0, BOX: 0 };

        function timestamp() {
            var d = new Date();
            var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds();
            return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (ms < 100 ? '0' : '') + (ms < 10 ? '0' : '') + ms;
        }

        function safe(v) {
            if (v === null) return 'null';
            if (v === undefined) return 'undefined';
            if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return '[Object]'; } }
            return String(v);
        }

        function _genId() { return Math.random().toString(36).substr(2, 6); }

        function _safeValue(v, maxLen) {
            if (v === null) return 'null';
            if (v === undefined) return 'undefined';
            if (typeof v === 'function') return '[Function]';
            if (typeof v === 'object') {
                if (Array.isArray(v)) return '[Array(' + v.length + ')]';
                try { var s = JSON.stringify(v); if (s && maxLen && s.length > maxLen) return s.substring(0, maxLen) + '...'; return s || '{}'; } catch (e) { return '[Object]'; }
            }
            if (typeof v === 'string' && maxLen && v.length > maxLen) return v.substring(0, maxLen) + '...';
            return String(v);
        }

        var MODULE_EMOJI = { BOOT: '🚀', META: '🗄️', ROUTE: '🔀', DB: '💾', HANDLER: '🎮', SOCK: '🔌', TEA: '🍵', IO: '🌐', REG: '📝', LOAD: '📦', CB: '⚡', NTFY: '🔔', RESOURCE: '📁', HERO_ATTR: '⚔️', TASK: '📋', USER: '👤', CHAT: '💬', FRIEND: '🤝', HERO_IMG: '🖼️', DUNGEON: '🏰', HERO: '🦸', ITEM: '💎', GUILD: '🏯', SUMMON: '🎰', ARENA: '🏟️', NOTIFY: '🔔', INSPECT: '🔍' };
        function _modEmoji(mod) { return MODULE_EMOJI[mod] || '⚪'; }

        var CLR = { timestamp: 'color:#9E9E9E;', tag: 'color:#FF6F00;font-weight:bold;', info: 'color:#66BB6A;', warn: 'color:#FFA726;', error: 'color:#EF5350;', debug: 'color:#90A4AE;', module: 'color:#26A69A;', box_border: 'color:#546E7A;', box_title: 'color:#FF8F00;font-weight:bold;', box_neutral: 'color:#B0BEC5;', box_ok: 'color:#66BB6A;font-weight:bold;', box_fail: 'color:#EF5350;font-weight:bold;', box_warn: 'color:#FFA726;font-weight:bold;', box_detail: 'color:#78909C;', arrow: 'color:#4DB6AC;', sep: 'color:#37474F;', ok: 'color:#66BB6A;font-weight:bold;', fail: 'color:#EF5350;font-weight:bold;', notify: 'color:#26A69A;font-weight:bold;' };

        var levelEmoji = { INFO: '🟢', WARN: '🟡', ERROR: '🔴', DEBUG: '🔵' };
        var levelTag = { INFO: 'INFO ', WARN: 'WARN ', ERROR: 'ERROR', DEBUG: 'DEBUG' };

        function emitMain(level, ctx, msg) {
            if (!shouldLog(level)) return;
            counts[level]++;
            var mod = (ctx || '???').toUpperCase();
            var modPad = (mod + '      ').slice(0, 6);
            console.log('%c' + levelEmoji[level] + ' ' + timestamp() + ' %c[MS] %c' + levelTag[level] + ' %c' + _modEmoji(mod) + ' ' + modPad + ' ▸ ' + msg, CLR[level], CLR.tag, CLR[level], CLR.module);
        }

        // ═══════════════════════════════════════════════════
        //  Notify system — v3: tidak mutasi objek caller
        // ═══════════════════════════════════════════════════

        function buildNotifyEnvelope(payload) {
            var dataStr;
            try { dataStr = JSON.stringify(payload !== undefined && payload !== null ? payload : {}); } catch (e) { dataStr = '{}'; }
            return { ret: 'SUCCESS', data: dataStr, compress: false };
        }

        function pushNotify(action, payload) {
            var socket = window.MainServer && window.MainServer.currentSocket;
            if (!socket || !socket.connected) return false;
            // v3: clone payload agar tidak mutasi objek caller
            var data = payload ? JSON.parse(JSON.stringify(payload)) : {};
            if (!data.action) data.action = action;
            var envelope = buildNotifyEnvelope(data);
            socket._fire('Notify', envelope);
            return true;
        }

        // ═══════════════════════════════════════════════════
        //  Auto-inspect
        // ═══════════════════════════════════════════════════

        function scanStateZero(data, path) {
            var results = [];
            if (!data || typeof data !== 'object' || Array.isArray(data)) return results;
            for (var k in data) {
                if (!data.hasOwnProperty(k)) continue;
                var v = data[k];
                var p = path ? path + '.' + k : k;
                if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                    if ('_state' in v && v._state === 0) results.push(p);
                    var sub = scanStateZero(v, p);
                    for (var i = 0; i < sub.length; i++) results.push(sub[i]);
                }
            }
            return results;
        }

        function autoInspect(route, envelope, parsedData) {
            var issues = [];
            if (envelope.ret === 0) {
                if (!envelope.data || envelope.data === 'null' || envelope.data === 'undefined' || envelope.data === '{}') {
                    issues.push({ type: 'WARN', msg: 'ret=0 but response data is empty (' + (envelope.data || '(empty)') + ')' });
                }
            }
            if (envelope.ret === 0 && parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
                var undefFields = [];
                for (var k in parsedData) { if (parsedData.hasOwnProperty(k) && parsedData[k] === undefined) undefFields.push(k); }
                if (undefFields.length > 0) issues.push({ type: 'WARN', msg: undefFields.length + ' undefined field(s): ' + undefFields.join(', ') });
            }
            if (parsedData && typeof parsedData === 'object') {
                var stateZero = scanStateZero(parsedData, '');
                for (var i = 0; i < stateZero.length; i++) issues.push({ type: 'WARN', msg: stateZero[i] + '._state = 0 (potentially incomplete)' });
            }
            return issues;
        }

        // ═══════════════════════════════════════════════════
        //  handlerResult — v2 main dispatch output
        // ═══════════════════════════════════════════════════

        function handlerResult(opts) {
            var route = opts.route || '???';
            var request = opts.request || {};
            var envelope = opts.envelope || {};
            var ms = opts.ms || 0;
            var issues = opts.inspect || [];
            var isSuccess = (envelope.ret === 0);

            var parsedData = null;
            var parseError = false;
            try {
                if (typeof envelope.data === 'string' && envelope.data.length > 0) parsedData = JSON.parse(envelope.data);
                else if (envelope.data && typeof envelope.data === 'object') parsedData = envelope.data;
            } catch (e) { parseError = true; }

            var fieldCount = 0;
            var undefinedFields = [];
            if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
                for (var k in parsedData) { if (parsedData.hasOwnProperty(k)) { fieldCount++; if (parsedData[k] === undefined) undefinedFields.push(k); } }
            }

            var emoji = isSuccess ? '🎮' : '🚨';
            var status = isSuccess ? '✅ SUCCESS' : '❌ ERROR';
            var tColor = isSuccess ? '#66BB6A' : '#EF5350';
            console.log('%c' + emoji + ' HANDLER ' + status + ' — ' + route + '  %c(' + ms + 'ms)', 'color:' + tColor + ';font-weight:bold;font-size:13px;padding:3px 0;', 'color:#78909C;font-size:11px;');

            var speedIcon = ms < 100 ? ' ⚡' : ms < 500 ? ' 🟡' : ' 🔴';
            var summaryRows = [
                { 'Field': 'Request ID', 'Value': 'req-' + _genId() },
                { 'Field': 'Route', 'Value': route },
                { 'Field': 'Result', 'Value': 'ret=' + envelope.ret + (isSuccess ? ' ✅' : ' ❌') },
                { 'Field': 'Speed', 'Value': ms + 'ms' + speedIcon },
                { 'Field': 'Fields', 'Value': String(fieldCount) }
            ];
            if (typeof console.table === 'function') { console.table(summaryRows); } else { for (var i = 0; i < summaryRows.length; i++) console.log('  ' + summaryRows[i].Field + ' : ' + summaryRows[i].Value); }

            if (typeof console.groupCollapsed === 'function') { console.groupCollapsed('%c▼ 📥 Request Payload', 'color:#42A5F5;font-weight:bold;'); } else { console.log('%c▼ 📥 Request Payload', 'color:#42A5F5;font-weight:bold;'); }
            if (request && typeof request === 'object') {
                var reqRows = [];
                for (var k in request) { if (request.hasOwnProperty(k)) reqRows.push({ 'Field': k, 'Value': _safeValue(request[k], 80), 'Type': typeof request[k] }); }
                if (typeof console.table === 'function') { console.table(reqRows); } else { for (var i = 0; i < reqRows.length; i++) console.log('  ' + reqRows[i].Field + ' : ' + reqRows[i].Value); }
            } else { console.log('%c  (no request data)', 'color:#90A4AE;'); }
            if (typeof console.groupEnd === 'function') console.groupEnd();

            if (typeof console.groupCollapsed === 'function') { console.groupCollapsed('%c▼ 📤 Response Data', 'color:#66BB6A;font-weight:bold;'); } else { console.log('%c▼ 📤 Response Data', 'color:#66BB6A;font-weight:bold;'); }
            if (parseError) { console.log('%c  ⚠️ Failed to parse response data', 'color:#FFA726;font-weight:bold;'); }
            else if (!parsedData) { console.log('%c  ⚠️ Response data is null/empty', 'color:#FFA726;font-weight:bold;'); }
            else {
                if (typeof console.table === 'function') {
                    console.log('%c  📋 Envelope:', 'color:#78909C;font-weight:bold;');
                    console.table([{ 'Field': 'ret', 'Value': envelope.ret }, { 'Field': 'compress', 'Value': String(envelope.compress) }, { 'Field': 'serverTime', 'Value': envelope.serverTime ? new Date(envelope.serverTime).toISOString() : 'N/A' }, { 'Field': 'server0Time', 'Value': envelope.server0Time ? String(envelope.server0Time) : 'N/A' }]);
                }
                var respRows = [];
                for (var k in parsedData) { if (parsedData.hasOwnProperty(k)) respRows.push({ 'Field': k, 'Value': _safeValue(parsedData[k], 80), 'Type': typeof parsedData[k] }); }
                if (typeof console.table === 'function') { console.log('%c  📋 Data (' + fieldCount + ' fields):', 'color:#78909C;font-weight:bold;'); console.table(respRows); } else { console.log('  Data (' + fieldCount + ' fields):'); for (var i = 0; i < respRows.length; i++) console.log('  ' + respRows[i].Field + ' : ' + respRows[i].Value); }
            }
            if (typeof console.groupEnd === 'function') console.groupEnd();

            if (typeof console.groupCollapsed === 'function') { console.groupCollapsed('%c▼ 🔍 Analysis', 'color:#FFA726;font-weight:bold;'); } else { console.log('%c▼ 🔍 Analysis', 'color:#FFA726;font-weight:bold;'); }
            var hasIssues = false;
            for (var i = 0; i < issues.length; i++) { hasIssues = true; var iss = issues[i]; var iClr = iss.type === 'ERROR' ? '#EF5350' : '#FFA726'; console.log('%c  ' + (iss.type === 'ERROR' ? '❌' : '🚫') + ' ' + iss.msg, 'color:' + iClr + ';font-weight:bold;'); }
            if (undefinedFields.length > 0 && !issues.some(function (x) { return x.msg.indexOf('undefined field') !== -1; })) { hasIssues = true; console.log('%c  ⚠️ ' + undefinedFields.length + ' undefined field(s):', 'color:#FFA726;font-weight:bold;'); }
            if (parseError) { hasIssues = true; console.log('%c  ⚠️ Response data parse failed', 'color:#FFA726;font-weight:bold;'); }
            if (!hasIssues) { console.log('%c  ✅ No issues detected', 'color:#66BB6A;font-weight:bold;'); }
            if (typeof console.groupEnd === 'function') console.groupEnd();

            console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#37474F;');
            counts.BOX++;
        }

        // ═══════════════════════════════════════════════════
        //  Return Logger object
        // ═══════════════════════════════════════════════════

        return {
            info: function (ctx, msg) { emitMain('INFO', ctx, msg); },
            warn: function (ctx, msg) { emitMain('WARN', ctx, msg); },
            error: function (ctx, msg) { emitMain('ERROR', ctx, msg); },
            debug: function (ctx, msg) { emitMain('DEBUG', ctx, msg); },
            detail: function (key, value) { if (!shouldLog('DEBUG')) return; console.log('%c  `-- ' + safe(key) + ' : ' + safe(value), CLR.box_detail); },
            details: function (context, pairs) {
                if (Array.isArray(context) && !pairs) pairs = context;
                if (!shouldLog('DEBUG') || !Array.isArray(pairs)) return;
                for (var i = 0; i < pairs.length; i++) { var conn = (i < pairs.length - 1) ? '+-- ' : '`-- '; console.log('%c  ' + conn + safe(pairs[i][0]) + ' : ' + safe(pairs[i][1]), CLR.box_detail); }
            },
            alwaysDetails: function (pairs) { if (!shouldLog('INFO') || !Array.isArray(pairs)) return; for (var i = 0; i < pairs.length; i++) { var conn = (i < pairs.length - 1) ? '+-- ' : '`-- '; console.log('%c  ' + conn + safe(pairs[i][0]) + ' : ' + safe(pairs[i][1]), 'color:#757575;'); } },
            importantDetails: function (ctx, pairs) {
                if (!shouldLog('INFO') || !Array.isArray(pairs)) return;
                emitMain('INFO', ctx, '');  // v3: pakai INFO bukan ERROR
                for (var i = 0; i < pairs.length; i++) { var conn = (i < pairs.length - 1) ? '+-- ' : '`-- '; console.log('%c  ' + conn + safe(pairs[i][0]) + ' : ' + safe(pairs[i][1]), 'color:#757575;'); }
            },
            openBox: function (title) { if (!shouldLog('INFO')) return; counts.BOX++; console.log('%c  ┌── %c' + title, CLR.box_border, CLR.box_title); },
            boxLine: function (text) { if (!shouldLog('INFO')) return; console.log('%c  │  %c' + text, CLR.box_border, CLR.box_neutral); },
            boxLineOk: function (text) { if (!shouldLog('INFO')) return; console.log('%c  │  %c✓ %c' + text, CLR.box_border, CLR.box_ok, CLR.box_ok); },
            boxLineFail: function (text) { if (!shouldLog('INFO')) return; console.log('%c  │  %c✗ %c' + text, CLR.box_border, CLR.box_fail, CLR.box_fail); },
            boxLineWarn: function (text) { if (!shouldLog('INFO')) return; console.log('%c  │  %c⚠ %c' + text, CLR.box_border, CLR.box_warn, CLR.box_warn); },
            boxDetail: function (key, value) { if (!shouldLog('INFO')) return; console.log('%c  │    %c+-- %c' + safe(key) + ' : ' + safe(value), CLR.box_border, CLR.box_detail, CLR.box_detail); },
            boxDetails: function (pairs) { if (!shouldLog('INFO') || !Array.isArray(pairs)) return; for (var i = 0; i < pairs.length; i++) { var conn = (i < pairs.length - 1) ? '+-- ' : '`-- '; console.log('%c  │    %c' + conn + '%c' + safe(pairs[i][0]) + ' : ' + safe(pairs[i][1]), CLR.box_border, CLR.box_detail, CLR.box_detail); } },
            closeBox: function (suffix) { if (!shouldLog('INFO')) return; if (suffix) { console.log('%c  └── %c' + suffix, CLR.box_border, 'color:#78909C;'); } else { console.log('%c  └' + '─'.repeat(44), CLR.box_border); } },
            arrow: function (text) { if (!shouldLog('INFO')) return; console.log('%c  ▸ %c' + text, CLR.arrow, CLR.box_neutral); },
            sep: function (text) { if (!shouldLog('INFO')) return; if (text) { console.log('%c  ─── %c' + text + ' %c' + '─'.repeat(30), CLR.sep, CLR.box_title, CLR.sep); } else { console.log('%c  ' + '─'.repeat(48), CLR.sep); } },
            ok: function (text) { if (!shouldLog('INFO')) return; console.log('%c  ✓ %c' + text, CLR.ok, CLR.ok); },
            fail: function (text) { if (!shouldLog('INFO')) return; console.log('%c  ✗ %c' + text, CLR.fail, CLR.fail); },
            notify: function (action, payload) {
                var pushed = pushNotify(action, payload);
                if (pushed) { counts.NOTIFY++; console.log('%c🔔 ' + timestamp() + ' %c[MAIN-SERVER] %cNTFY %c' + _modEmoji(action.toUpperCase()) + ' ' + action, CLR.timestamp, CLR.tag, CLR.notify, CLR.module); }
                else { emitMain('WARN', 'NTFY', 'Cannot push "' + action + '" — no socket'); }
            },
            buildNotifyEnvelope: function (payload) { return buildNotifyEnvelope(payload); },
            autoInspect: autoInspect,
            scanStateZero: scanStateZero,
            handlerResult: handlerResult,
            setLevel: function (level) { if (PRIORITY[level] !== undefined) { currentLevel = level; minPrio = PRIORITY[level]; try { localStorage.setItem(STORE_KEY, level); } catch (e) {} console.log('%c[MAIN-SERVER] Log level → ' + level, 'color:#FF6F00;font-weight:bold;'); } },
            getLevel: function () { return currentLevel; },
            getCounts: function () { return { DEBUG: counts.DEBUG, INFO: counts.INFO, WARN: counts.WARN, ERROR: counts.ERROR, NOTIFY: counts.NOTIFY, BOX: counts.BOX }; },
            resetCounts: function () { counts.DEBUG = 0; counts.INFO = 0; counts.WARN = 0; counts.ERROR = 0; counts.NOTIFY = 0; counts.BOX = 0; }
        };
    })();

    // ═══════════════════════════════════════════════════════
    //  5. EXPOSE LOGGER + MUTE CLIENT LOGGER
    // ═══════════════════════════════════════════════════════

    window.MainServerLogger = Logger;
    var log = Logger;
    window.Log_Clean = true;

    // ═══════════════════════════════════════════════════════
    //  6. LOAD logger.js (OPTIONAL)
    // ═══════════════════════════════════════════════════════

    (function () {
        var s = document.createElement('script');
        s.src = basePath + 'logger.js';
        s.async = false;
        (document.head || document.documentElement).appendChild(s);
        // v5: Re-point 'log' ke v5 Logger (window.MainServerLogger)
        // Inline Logger di-override oleh logger.js, tapi 'log' masih ngerujuk ke inline.
        // Tanpa ini, callbackError(), trackEnvelope(), dll tidak tersedia di 'log'.
        if (window.MainServerLogger) {
            log = window.MainServerLogger;
        }
    })();

    // ═══════════════════════════════════════════════════════
    //  7. MAINSERVER OBJECT + CONFIG
    // ═══════════════════════════════════════════════════════

    var MainServer = {
        config: {
            mainServerUrl: 'http://127.0.0.1:8001',
            chatServerUrl: 'http://127.0.0.1:8002',
            dungeonServerUrl: 'http://127.0.0.1:8004',
            teaKey: 'verification',
            verifyEnable: true,
            delayMin: 30,
            delayMax: 120,
            // Server time config (v5)
            serverTzHours: SERVER_TZ_HOURS,
            server0Time: SERVER0_TIME,
            serverOpenDate: SERVER_OPEN_DATE,
            resetHour: RESET_HOUR
        },
        handlers: {},
        _handlerNames: [],
        _loadedHandlers: {},
        currentSocket: null,
        log: log
    };

    // ═══════════════════════════════════════════════════════
    //  7b. SERVER TIME HELPERS (exposed for handlers)
    // ═══════════════════════════════════════════════════════
    //
    //  Helper functions agar handler bisa mengakses waktu server
    //  tanpa perlu memahami formula _offTime.
    //

    MainServer.getServerTime = function () {
        return Date.now();
    };

    MainServer.getServerLocalDate = function () {
        return new Date(Date.now());
    };

    MainServer.getServerOpenDate = function () {
        return MainServer.config.serverOpenDate;
    };

    MainServer.setServerOpenDate = function (ts) {
        if (typeof ts === 'number' && ts > 0) {
            MainServer.config.serverOpenDate = ts;
            log.info('META', 'serverOpenDate updated → ' + new Date(ts).toISOString());
        }
    };

    MainServer.getDaysSinceOpen = function () {
        return Math.floor((Date.now() - MainServer.config.serverOpenDate) / 86400000) + 1;
    };

    // generateRetrieveDay — PERSIS client L52766-52768
    // Jika jam < RESET_HOUR (6), masih dianggap hari sebelumnya.
    MainServer.generateRetrieveDay = function (dateObj) {
        var d = dateObj || MainServer.getServerLocalDate();
        var h = d.getHours();
        if (RESET_HOUR > h) {
            d = new Date(d.valueOf() - 86400000);
        }
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    };

    // getServerLocalZeroClockTime — PERSIS client L52769-52774
    // Timestamp of midnight (00:00:00) today in server local time.
    MainServer.getServerLocalZeroClockTime = function () {
        var d = MainServer.getServerLocalDate();
        var y = d.getFullYear();
        var m = d.getMonth() + 1;
        var day = d.getDate();
        return new Date(y + '/' + m + '/' + day).getTime();
    };

    // isAfterReset — cek apakah sudah lewat jam reset hari ini
    MainServer.isAfterReset = function (dateObj) {
        var d = dateObj || MainServer.getServerLocalDate();
        return d.getHours() >= RESET_HOUR;
    };

    // getNextResetTime — timestamp ms dari reset berikutnya (server local)
    MainServer.getNextResetTime = function () {
        var d = MainServer.getServerLocalDate();
        if (d.getHours() >= RESET_HOUR) {
            // Sudah lewat reset hari ini → reset berikutnya = besok RESET_HOUR:00:00
            d.setDate(d.getDate() + 1);
        }
        d.setHours(RESET_HOUR, 0, 0, 0);
        return d.getTime();
    };

    // getResetCountdown — sisa detik sampai reset berikutnya
    MainServer.getResetCountdown = function () {
        var next = MainServer.getNextResetTime();
        var now = MainServer.getServerLocalDate().getTime();
        return Math.max(0, Math.floor((next - now) / 1000));
    };

    MainServer.randomDelay = function () {
        return Math.floor(Math.random() * (MainServer.config.delayMax - MainServer.config.delayMin + 1)) + MainServer.config.delayMin;
    };

    MainServer.generateChallenge = function () {
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var result = '';
        for (var i = 0; i < 16; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
        return result;
    };

    // ═══════════════════════════════════════════════════════
    //  8. SERVER TIME SYSTEM
    // ═══════════════════════════════════════════════════════
    //
    //  Evidence: main.min.js L79546-79566 (ServerTime singleton)
    //
    //  Client formula (L79554):
    //    _offTime = 60 * (new Date).getTimezoneOffset() * 1000 - server0Time
    //    getServerLocalTime() = _ts + _offTime
    //    getServerLocalDate() = new Date(_ts + _offTime)
    //
    //  KONTRAK MOCK SERVER:
    //    serverTime  = Date.now() (UTC ms perangkat = UTC ms server, karena mock=perangkat)
    //    server0Time = 60 * serverTZ.getTimezoneOffset() * 1000
    //                = 60 * (-420) * 1000 = -25200000  (untuk server UTC+7)
    //
    //  HASIL DI CLIENT:
    //    Untuk perangkat UTC+7:
    //      _offTime = 60*(-420)*1000 - (-25200000) = -25200000 + 25200000 = 0
    //      getServerLocalDate() = new Date(Date.now() + 0) = waktu perangkat ✓
    //    Untuk perangkat UTC+0:
    //      _offTime = 60*0*1000 - (-25200000) = 0 + 25200000 = +25200000
    //      getServerLocalDate() = new Date(Date.now() + 25200000) = UTC+7 ✓
    //
    //  Catatan: server0Time HARUS negatif untuk timezone positif (UTC+X).
    //  Nilai HAR (+25200000) kemungkinan besar format berbeda di server asli
    //  atau server asli mengirim serverTime dalam format lain.
    //  Yang penting: hasil akhir getServerLocalDate() harus = waktu server lokal.
    //

    var SERVER_TZ_HOURS = 7;  // Server timezone: UTC+7
    var SERVER0_TIME = 60 * (-SERVER_TZ_HOURS * 60) * 1000;  // -25200000

    // ═══════════════════════════════════════════════════════
    //  9. SERVER OPEN DATE
    // ═══════════════════════════════════════════════════════
    //
    //  Evidence: main.min.js L77661:
    //    e.serverOpenDate && UserInfoSingleton.getInstance().setServerOpenDate(e.serverOpenDate)
    //
    //  Format: unix timestamp MILLISECONDS (bukan seconds!)
    //  Bukti: L59493: Math.floor((serverTime - openDate) / 864e5) + 1
    //    864e5 = 86400000 = ms per hari → openDate harus dalam ms
    //
    //  Digunakan untuk:
    //    1. VIP privilege gating (L59489): days < stageVIPShowTime → VIP tersembunyi
    //    2. Temple trial privilege gating: days < templeTestVIPShowTime
    //    3. Arena first-day check (L84283): judgeSameDay(serverNow, openDate) && hour < 22
    //
    //  Nilai default: 30 hari sebelum sekarang (cukup lama agar VIP visible).
    //  Handler bisa override lewat MainServer.config.serverOpenDate.
    //

    var SERVER_OPEN_DATE = new Date(2026, 5, 15, 0, 0, 0, 0).getTime();  // 15 Juni 2026 00:00:00 WIB (UTC+7)

    // ═══════════════════════════════════════════════════════
    //  10. DAILY RESET SYSTEM
    // ═══════════════════════════════════════════════════════
    //
    //  Evidence: main.min.js L52766-52768:
    //    e.generateRetrieveDay = function(e) {
    //        var t = e.getHours();
    //        return 6 > t && (e = new Date(e.valueOf() - 864e5)),
    //        e.getFullYear() + "-" + (e.getMonth() + 1) + "-" + e.getDate()
    //    }
    //
    //  Evidence: main.min.js L135332-135341 (SnakeFastBattle.checkRefreshTime):
    //    var n = t.getHours();
    //    if(6 > n && !e.isTodayRefresh && (e.isTodayRefresh = !0),
    //       e.isTodayRefresh && n >= 6) { ... force close + refresh notification }
    //
    //  Arti: jam 00:00-05:59 masih dianggap "hari sebelumnya".
    //  Reset terjadi jam 06:00 server local time.
    //  Monthly card exception: reset di 00:00 (L156726-156733).
    //
    //  Server push: L77041 — "scheduleModelRefresh" notification
    //  Client tidak compute sendiri — server kirim semua counter baru.
    //

    var RESET_HOUR = 6;

    // ═══════════════════════════════════════════════════════
    //  11. BUILD ENVELOPE
    // ═══════════════════════════════════════════════════════

    MainServer.buildEnvelope = function (responseData, retCode) {
        var ret = (typeof retCode === 'number' && retCode !== 0) ? retCode : 0;
        var dataStr;
        try { dataStr = JSON.stringify(responseData !== undefined && responseData !== null ? responseData : {}); } catch (e) { dataStr = '{}'; }
        return {
            ret: ret,
            data: dataStr,
            compress: false,
            serverTime: Date.now(),
            server0Time: SERVER0_TIME
        };
    };

    // ═══════════════════════════════════════════════════════
    //  12. NOTIFY — via MainServer.log (bukan langsung log closure)
    // ═══════════════════════════════════════════════════════
    //
    //  Menggunakan MainServer.log agar handler yang di-load nanti
    //  mendapat Logger yang sama (termasuk override dari logger.js).
    //

    MainServer.notify = function (data) {
        MainServer.log.notify(data && data.action, data);
    };

    window.MainServer = MainServer;

    // ═══════════════════════════════════════════════════════
    //  9. DATABASE — In-Memory Cache + IndexedDB Persistence
    // ═══════════════════════════════════════════════════════
    //
    //  v4 FIX: loadAllFromIDB JANGAN overwrite memory write yang terjadi
    //  selama ENTIR loading window (dari init sampai cursor selesai).
    //  v3 hanya track writes sebelum IDB open — v4 track SEMUA writes
    //  sampai `ready = true`.
    //

    var _dbEngine = (function () {
        var memory = {};
        var idb = null;
        var ready = false;
        var useIDB = false;
        var pendingWrites = [];
        var writesDuringLoad = {};  // v4: track ALL writes until ready=true (key→true)
        var DB_NAME = 'SuperWarriorZ_DB';
        var DB_VERSION = 1;
        var STORE = 'keyvalue';

        function get(key) {
            if (memory.hasOwnProperty(key)) return memory[key];
            return undefined;
        }

        function set(key, data) {
            memory[key] = data;
            // v4: track semua write yang terjadi sebelum DB ready
            // Ini termasuk write saat IDB sudah open tapi cursor masih iterasi
            if (!ready) {
                writesDuringLoad[key] = true;
            }
            if (idb) {
                writeIDB(key, data);
            } else if (!ready) {
                pendingWrites.push({ key: key, data: data });
            }
        }

        function remove(key) {
            delete memory[key];
            if (idb) deleteIDB(key);
        }

        function keys() { return Object.keys(memory); }

        function init(prefix) {
            loadFromLocalStorage(prefix);

            if (window.indexedDB) {
                try {
                    var request = indexedDB.open(DB_NAME, DB_VERSION);
                    request.onupgradeneeded = function (e) {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
                    };

                    request.onsuccess = function (e) {
                        idb = e.target.result;
                        useIDB = true;
                        log.info('DB', 'IndexedDB opened');

                        loadAllFromIDB(function (idbKeys) {
                            if (idbKeys.length > 0) {
                                log.info('DB', 'Loaded ' + idbKeys.length + ' keys from IndexedDB');
                            } else {
                                var memKeys = Object.keys(memory);
                                if (memKeys.length > 0) {
                                    migrateAllToIDB();
                                    log.info('DB', 'Migrated ' + memKeys.length + ' keys from localStorage to IndexedDB');
                                }
                            }

                            // flush pending writes
                            for (var i = 0; i < pendingWrites.length; i++) {
                                writeIDB(pendingWrites[i].key, pendingWrites[i].data);
                            }
                            pendingWrites = [];

                            // v4: clear tracking SETELAH cursor selesai
                            writesDuringLoad = {};
                            ready = true;
                            log.info('DB', 'Database ready — engine=' + (useIDB ? 'IndexedDB' : 'memory') + ', keys=' + Object.keys(memory).length);
                        });
                    };

                    request.onerror = function (e) {
                        ready = true;
                        log.warn('DB', 'IndexedDB open failed — using memory only');
                    };

                    request.onblocked = function () {
                        log.warn('DB', 'IndexedDB open blocked — retrying...');
                    };

                } catch (err) {
                    ready = true;
                    log.warn('DB', 'IndexedDB not usable — using memory only');
                }
            } else {
                ready = true;
                log.warn('DB', 'IndexedDB not supported — using memory only');
            }
        }

        function loadFromLocalStorage(prefix) {
            var count = 0;
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(prefix) === 0) {
                        try { memory[k] = JSON.parse(localStorage.getItem(k)); count++; } catch (ex) {}
                    }
                }
            } catch (ex) {}
            if (count > 0) log.info('DB', 'Loaded ' + count + ' keys from localStorage (bootstrap)');
        }

        // v4 FIX: Jangan overwrite memory write yang terjadi kapanpun
        // selama loading window. writesDuringLoad di-populate oleh set()
        // dan di-clear setelah callback ini selesai (di caller).
        function loadAllFromIDB(callback) {
            if (!idb) { callback([]); return; }
            try {
                var tx = idb.transaction(STORE, 'readonly');
                var store = tx.objectStore(STORE);
                var request = store.openCursor();
                var loaded = [];

                request.onsuccess = function (e) {
                    var cursor = e.target.result;
                    if (cursor) {
                        // v4: Hanya overwrite dari IDB jika key TIDAK pernah
                        // ditulis oleh siapapun selama loading window.
                        // Ini menangkap baik write sebelum IDB open MAUPUN
                        // write selama cursor iteration.
                        if (!writesDuringLoad[cursor.key]) {
                            memory[cursor.key] = cursor.value;
                        }
                        loaded.push(cursor.key);
                        cursor.continue();
                    } else {
                        callback(loaded);
                    }
                };
                request.onerror = function () {
                    log.error('DB', 'Failed to load from IndexedDB');
                    callback([]);
                };
            } catch (ex) {
                log.error('DB', 'loadAllFromIDB error: ' + ex.message);
                callback([]);
            }
        }

        function migrateAllToIDB() {
            if (!idb) return;
            try {
                var tx = idb.transaction(STORE, 'readwrite');
                var store = tx.objectStore(STORE);
                var k = Object.keys(memory);
                for (var i = 0; i < k.length; i++) {
                    try { store.put(memory[k[i]], k[i]); } catch (ex) { log.error('DB', 'Migration failed for key: ' + k[i]); }
                }
            } catch (ex) { log.error('DB', 'Migration transaction error: ' + ex.message); }
        }

        function writeIDB(key, data) {
            if (!idb) return;
            try {
                var tx = idb.transaction(STORE, 'readwrite');
                var store = tx.objectStore(STORE);
                store.put(data, key);
            } catch (ex) { log.error('DB', 'writeIDB error: ' + ex.message); }
        }

        function deleteIDB(key) {
            if (!idb) return;
            try {
                var tx = idb.transaction(STORE, 'readwrite');
                var store = tx.objectStore(STORE);
                store.delete(key);
            } catch (ex) { log.error('DB', 'deleteIDB error: ' + ex.message); }
        }

        return {
            init: init, get: get, set: set, remove: remove, keys: keys,
            isReady: function () { return ready; },
            isUsingIDB: function () { return useIDB; },
            getMemorySize: function () { return Object.keys(memory).length; }
        };
    })();

    _dbEngine.init('ms_');

    MainServer.db = {
        _prefix: 'ms_',
        save: function (key, data) { try { _dbEngine.set(this._prefix + key, data); return true; } catch (e) { log.error('DB', 'Save failed: ' + key + ' — ' + e.message); return false; } },
        get: function (key, defaultVal) { try { var val = _dbEngine.get(this._prefix + key); return val !== undefined ? val : (defaultVal !== undefined ? defaultVal : null); } catch (e) { log.error('DB', 'Get failed: ' + key + ' — ' + e.message); return defaultVal !== undefined ? defaultVal : null; } },
        remove: function (key) { try { _dbEngine.remove(this._prefix + key); } catch (e) {} },
        keys: function () { var prefix = this._prefix; var allKeys = _dbEngine.keys(); var result = []; for (var i = 0; i < allKeys.length; i++) { if (allKeys[i].indexOf(prefix) === 0) result.push(allKeys[i].substring(prefix.length)); } return result; }
    };

    // ═══════════════════════════════════════════════════════
    //  10. MainServerDB
    // ═══════════════════════════════════════════════════════

    window.MainServerDB = {
        _get: function (key) { return MainServer.db.get(key); },
        _set: function (key, data) { return MainServer.db.save(key, data); },
        nowSeconds: function () { return Math.floor(Date.now() / 1000); },
        startSession: function (userId, data) {
            var sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            var sessions = this._get('user_sessions_' + userId) || [];
            sessions.push(sid);
            this._set('user_sessions_' + userId, sessions);
            this._set(sid, { userId: userId, startTime: this.nowSeconds(), data: data || {} });
            return sid;
        },
        trackAction: function (sessionId, action, detail) {
            var session = this._get(sessionId);
            if (!session) return;
            if (!session.actions) session.actions = [];
            session.actions.push({ action: action, detail: detail, time: this.nowSeconds() });
            this._set(sessionId, session);
        },
        validateLoginToken: function (userId) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', './server/login-server/api.php?action=getToken', false);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({ userId: userId }));
                if (xhr.status >= 200 && xhr.status < 300) {
                    var resp = JSON.parse(xhr.responseText);
                    if (resp.error) return { valid: false, reason: 'api_error: ' + resp.error };
                    if (resp.found && resp.loginToken) return { valid: true, token: { loginToken: resp.loginToken, userId: resp.userId } };
                    return { valid: false, reason: 'token_not_found' };
                }
                return { valid: false, reason: 'http_' + xhr.status };
            } catch (e) { return { valid: false, reason: e.message }; }
        }
    };

    // ═══════════════════════════════════════════════════════
    //  11. HANDLER REGISTRY + LAZY LOADER
    // ═══════════════════════════════════════════════════════
    //
    //  v3 FIX: deduplication — tidak load handler 2x
    //  saat 2 request datang bersamaan sebelum script selesai.
    //  Queue callback untuk request yang sudah in-flight.
    //

    MainServer.registerHandler = function (type, action, handlerFn) {
        var key = type + '/' + action;
        MainServer.handlers[key] = handlerFn;
        if (MainServer._handlerNames.indexOf(key) === -1) MainServer._handlerNames.push(key);
        // v3: resolve semua pending callback yang menunggu handler ini
        if (MainServer._pendingCallbacks && MainServer._pendingCallbacks[key]) {
            var cbs = MainServer._pendingCallbacks[key];
            delete MainServer._pendingCallbacks[key];
            for (var i = 0; i < cbs.length; i++) cbs[i]();
        }
        log.debug('REG', key);
    };

    // v3: init pending callback queue
    MainServer._pendingCallbacks = {};

    MainServer.loadHandlerScript = function (type, action, onReady) {
        var key = type + '/' + action;

        // Sudah teregistrasi — langsung jalankan
        if (MainServer._loadedHandlers[key] === 'registered') { onReady(); return; }

        // v3: sedang loading — queue callback, JANGAN load 2x
        if (MainServer._loadedHandlers[key] === 'loading') {
            if (!MainServer._pendingCallbacks[key]) MainServer._pendingCallbacks[key] = [];
            MainServer._pendingCallbacks[key].push(onReady);
            return;
        }

        MainServer._loadedHandlers[key] = 'loading';
        log.debug('LOAD', key);

        var bustV = Date.now();
        var script = document.createElement('script');
        script.src = basePath + 'handlers/' + type + '/' + action + '.js' + '?t=' + bustV;
        script.async = false;
        script.onload = function () {
            if (typeof MainServer.handlers[key] === 'function') {
                MainServer._loadedHandlers[key] = 'registered';
            } else {
                delete MainServer._loadedHandlers[key];
                log.warn('LOAD', 'file loaded but NOT registered: ' + key + ' — will retry');
            }
            onReady();
            script.parentNode && script.parentNode.removeChild(script);
        };
        script.onerror = function () {
            delete MainServer._loadedHandlers[key];
            log.warn('LOAD', 'file not found: ' + key + ' — will retry');
            onReady();
        };
        (document.head || document.documentElement).appendChild(script);
    };

    // ═══════════════════════════════════════════════════════
    //  12. ROUTER — 2-LEVEL DISPATCH
    // ═══════════════════════════════════════════════════════

    var _stats = { total: 0, unknown: 0, lazy: 0, errors: 0 };

    function dispatch(request, originalCallback) {
        var type = request.type || '';
        var action = request.action || '';
        var key = type + '/' + action;
        _stats.total++;

        if (!type || !action) {
            _stats.unknown++;
            log.handlerResult({
                route: (type || action) ? (type + '/' + action) : '(empty)',
                request: request,
                envelope: { ret: 1, data: '{}', compress: false, serverTime: Date.now(), server0Time: SERVER0_TIME },
                ms: 0,
                inspect: [{ type: 'ERROR', msg: 'Missing type or action — type="' + type + '" action="' + action + '"' }]
            });
            originalCallback(MainServer.buildEnvelope({ error: 'missing_type_or_action' }, 1));
            return;
        }

        var handler = MainServer.handlers[key];
        if (typeof handler === 'function') {
            executeHandler(key, handler, request, originalCallback);
        } else {
            _stats.lazy++;
            log.arrow('loading ' + type + '/' + action + '.js');
            MainServer.loadHandlerScript(type, action, function () {
                var h = MainServer.handlers[key];
                if (typeof h === 'function') {
                    executeHandler(key, h, request, originalCallback);
                } else {
                    _stats.unknown++;
                    log.handlerResult({
                        route: key,
                        request: request,
                        envelope: { ret: 1, data: '{}', compress: false, serverTime: Date.now(), server0Time: SERVER0_TIME },
                        ms: 0,
                        inspect: [{ type: 'ERROR', msg: 'Handler NOT FOUND: ' + key }]
                    });
                    originalCallback(MainServer.buildEnvelope({ error: 'handler_not_found', type: type, action: action }, 1));
                }
            });
        }
    }

    function executeHandler(key, handler, request, originalCallback) {
        var t0 = Date.now();
        try {
            handler(request, function (responseData, retCode) {
                var ms = Date.now() - t0;
                var envelope = MainServer.buildEnvelope(responseData, retCode);
                var parsedData = null;
                try {
                    if (typeof envelope.data === 'string' && envelope.data.length > 0) parsedData = JSON.parse(envelope.data);
                    else if (envelope.data && typeof envelope.data === 'object') parsedData = envelope.data;
                } catch (e) {}
                var issues = log.autoInspect(key, envelope, parsedData);
                log.handlerResult({ route: key, request: request, envelope: envelope, ms: ms, inspect: issues });
                // v5: Track envelope ke ring buffer sebelum callback
                if (typeof log.trackEnvelope === 'function') log.trackEnvelope(key, envelope);
                if (typeof originalCallback === 'function') {
                    try { originalCallback(envelope); }
                    catch (cbErr) {
                        console.error('');
                        console.error('╔══════════════════════════════════════════════════════════════╗');
                        console.error('║ [V7-CB-ERROR] Route: ' + key);
                        console.error('║ ' + (cbErr.name || 'Error') + ': ' + cbErr.message);
                        console.error('╚══════════════════════════════════════════════════════════════╝');
                        console.error('');
                        console.error('--- FULL STACK TRACE ---');
                        if (cbErr.stack) {
                            console.error(cbErr.stack);
                        } else {
                            console.error('(no stack trace)');
                        }
                        console.error('--- END STACK TRACE ---');
                        console.error('');
                        try {
                            console.error('[ENVELOPE] keys: ' + (envelope ? Object.keys(envelope).join(', ') : '(null)'));
                            if (envelope && envelope.data) {
                                var _d = typeof envelope.data === 'string' ? envelope.data.substring(0, 800) : JSON.stringify(envelope.data).substring(0, 800);
                                console.error('[ENVELOPE] data (first 800): ' + _d);
                            }
                        } catch(_ex) {}
                        try { window.__CB_ERR = cbErr; window.__CB_ROUTE = key; window.__CB_ENVELOPE = envelope; } catch(_e){}
                        log.boxLineFail('callback error: ' + cbErr.message);
                        log.closeBox('');
                    }
                }
            });
        } catch (err) {
            _stats.errors++;
            var ms = Date.now() - t0;
            log.handlerResult({
                route: key, request: request,
                envelope: { ret: 1, data: '{}', compress: false, serverTime: Date.now(), server0Time: SERVER0_TIME },
                ms: ms,
                inspect: [{ type: 'ERROR', msg: 'EXCEPTION: ' + err.name + ' — ' + err.message }]
            });
            originalCallback(MainServer.buildEnvelope({ error: 'handler_exception', action: key, errorName: err.name, errorMessage: err.message }, 1));
        }
    }

    MainServer.router = {
        dispatch: dispatch,
        getStats: function () { return { total: _stats.total, unknown: _stats.unknown, lazy: _stats.lazy, errors: _stats.errors }; }
    };

    // ═══════════════════════════════════════════════════════
    //  13. MAINSOCKET CLASS (Mock Socket.IO + TEA Verify)
    // ═══════════════════════════════════════════════════════
    //
    //  v3 FIXES:
    //    - _fire() pakai this context (= socket), bukan null
    //    - TEA decrypt pakai _TEA (self-contained), bukan global TEA
    //    - Socket ID: 20-char hex (match real Socket.IO format)
    //

    var _sockCounter = 0;

    function _generateSocketId() {
        var chars = '0123456789abcdef';
        var id = '';
        for (var i = 0; i < 20; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
        return id;
    }

    function MainSocket() {
        _sockCounter++;
        this.id = _generateSocketId();
        this.connected = false;
        this.disconnected = false;
        this._listeners = {};
        this._emitCount = 0;
        this._challenge = '';
        this._verified = false;

        var self = this;
        var delay = MainServer.randomDelay();

        log.openBox('SOCKET #' + _sockCounter);
        log.boxLine('connecting...');

        setTimeout(function () {
            if (self.disconnected) { log.boxLineWarn('disconnected before connect'); log.closeBox(''); return; }
            self.connected = true;
            self._fire('connect');
            log.boxLineOk('connected  (' + delay + 'ms)');

            if (MainServer.config.verifyEnable) {
                log.boxLine('TEA verify...');
                setTimeout(function () {
                    if (self.disconnected || !self.connected) { log.boxLineWarn('socket gone before verify'); log.closeBox(''); return; }
                    self._startVerify();
                }, 50);
            } else { log.closeBox(''); }
        }, delay);
    }

    MainSocket.prototype._startVerify = function () {
        var challenge = MainServer.generateChallenge();
        this._challenge = challenge;
        log.boxDetail('challenge', challenge);
        this._fire('verify', challenge);
    };

    MainSocket.prototype._verifyResponse = function (encrypted, callback) {
        if (!this._challenge) {
            log.boxLineFail('no challenge stored');
            log.closeBox('');
            if (typeof callback === 'function') callback({ ret: 1 });
            return;
        }
        try {
            // v3: pakai _TEA (self-contained), BUKAN global TEA
            var tea = new _TEA();
            var decrypted = tea.decrypt(encrypted, MainServer.config.teaKey);
            log.boxDetail('match', String(decrypted === this._challenge));
            if (decrypted === this._challenge) {
                this._verified = true;
                log.boxLineOk('verified');
                log.closeBox('');
                if (typeof callback === 'function') callback({ ret: 0 });
            } else {
                log.boxLineFail('mismatch');
                log.closeBox('');
                if (typeof callback === 'function') callback({ ret: 1 });
            }
        } catch (err) {
            log.boxLineFail('decrypt error: ' + err.message);
            log.closeBox('');
            if (typeof callback === 'function') callback({ ret: 1 });
        }
    };

    MainSocket.prototype.on = function (event, handler) {
        if (typeof handler !== 'function') return;
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
    };

    MainSocket.prototype.off = function (event, handler) {
        if (!this._listeners[event]) return;
        if (handler) {
            var list = this._listeners[event];
            for (var i = list.length - 1; i >= 0; i--) { if (list[i] === handler) list.splice(i, 1); }
        } else { delete this._listeners[event]; }
    };

    MainSocket.prototype.emit = function (event, data, callback) {
        this._emitCount++;
        if (event === 'verify' && !this._verified) { this._verifyResponse(data, callback); return; }
        if (event === 'handler.process') {
            if (!this._verified && MainServer.config.verifyEnable) {
                log.boxLineFail('handler.process BEFORE verify — rejected');
                log.closeBox('');
                return;
            }
            var self = this;
            var delay = MainServer.randomDelay();
            setTimeout(function () {
                if (!self.connected) { log.boxLineFail('socket disconnected'); log.closeBox(''); return; }
                if (!data || typeof data !== 'object') { log.boxLineFail('invalid data'); log.closeBox(''); return; }
                MainServer.currentSocket = self;
                dispatch(data, function (envelope) {
                    // v5: Track envelope ke ring buffer
                    var route = data.type + '/' + data.action;
                    if (typeof log.trackEnvelope === 'function') log.trackEnvelope(route, envelope);
                    if (typeof callback === 'function') {
                        try { callback(envelope); }
                        catch (cbErr) {
                            console.error('');
                            console.error('╔══════════════════════════════════════════════════════════════╗');
                            console.error('║ [V7-EMIT-ERROR] Route: ' + route);
                            console.error('║ ' + (cbErr.name || 'Error') + ': ' + cbErr.message);
                            console.error('╚══════════════════════════════════════════════════════════════╝');
                            console.error('');
                            console.error('--- FULL STACK TRACE ---');
                            if (cbErr.stack) {
                                console.error(cbErr.stack);
                            } else {
                                console.error('(no stack trace)');
                            }
                            console.error('--- END STACK TRACE ---');
                            console.error('');
                            try {
                                console.error('[ENVELOPE] keys: ' + (envelope ? Object.keys(envelope).join(', ') : '(null)'));
                                if (envelope && envelope.data) {
                                    var _d2 = typeof envelope.data === 'string' ? envelope.data.substring(0, 800) : JSON.stringify(envelope.data).substring(0, 800);
                                    console.error('[ENVELOPE] data (first 800): ' + _d2);
                                }
                            } catch(_ex2) {}
                            try { window.__CB_ERR = cbErr; window.__CB_ROUTE = route; window.__CB_ENVELOPE = envelope; } catch(_e2){}
                            log.boxLineFail('callback error: ' + cbErr.message);
                            log.closeBox('');
                        }
                    }
                });
            }, delay);
            return;
        }
        log.debug('EMIT', 'Unhandled: ' + event);
    };

    MainSocket.prototype.disconnect = function () {
        this.connected = false;
        this.disconnected = true;
        this._verified = false;
        this._fire('disconnect', 'client');
    };

    MainSocket.prototype.destroy = function () {
        this.connected = false;
        this.disconnected = true;
        this._verified = false;
        this._listeners = {};
    };

    // v3 FIX: _fire passes `this` (= socket) sebagai context ke listener
    // Evidence: real Socket.IO Emitter.emit uses n[r].apply(this, e) — this = emitter
    // Catatan: client TSSocketClient sebenarnya pakai closure (a=this), bukan `this`.
    // Tapi apply(this) tetap benar karena itulah yang real Socket.IO lakukan.
    MainSocket.prototype._fire = function (event) {
        var list = this._listeners[event];
        if (!list || list.length === 0) return;
        var args = Array.prototype.slice.call(arguments, 1);
        for (var i = 0; i < list.length; i++) {
            try { list[i].apply(this, args); }
            catch (e) { log.error('SOCK', 'Listener error "' + event + '": ' + e.message); }
        }
    };

    // ═══════════════════════════════════════════════════════
    //  14. IO.CONNECT PATCH
    // ═══════════════════════════════════════════════════════
    //
    //  v3: Patch untuk SEMUA server (8001, 8002, 8004)
    //  Chat dan Dungeon server TIDAK di-mock — kembalikan socket
    //  dummy yang langsung "connected" tanpa verify, supaya
    //  client tidak coba koneksi REAL yang akan hang/fail.
    //
    //  Evidence:
    //    Client L76751: 4 TSSocketClient instances
    //    Client L77400: clientStartChat → chatClient.connectToServer(chaturl)
    //    Client L77409: clientStartDungeon → dungeonClient.connectToServer(dungeonurl)
    //    Client L52001: connectWithSocket → io.connect(url, {reconnectionAttempts:10})
    //

    var _patched = false;

    function isMockedServerUrl(url) {
        if (!url) return false;
        // Main server — full mock dengan TEA verify + handlers
        if (url.indexOf(':8001') !== -1) return 'main';
        // Chat & Dungeon — mock socket dummy (connected, no verify)
        if (url.indexOf(':8002') !== -1) return 'chat';
        if (url.indexOf(':8004') !== -1) return 'dungeon';
        return false;
    }

    // v4: DummySocket untuk chat/dungeon — MUST complete verify handshake
    // Evidence: main.min.js L76751 — chatClient & dungeonClient punya verifyEnable=true
    // L51982: on 'connect' → socketOnVerify() → daftar listener 'verify'
    // L52008: listener 'verify' nunggu server kirim challenge → encrypt → emit balik
    // Jika server TIDAK kirim challenge → handler verify TIDAK PERNAH dipanggil
    // → callback success TIDAK PERNAH dijalankan → chat/dungeon HANG selamanya
    function DummySocket() {
        this.id = _generateSocketId();
        this.connected = true;
        this.disconnected = false;
        this._listeners = {};
        this._challenge = '';
        var self = this;
        // Fire 'connect' pada next tick (async, seperti real Socket.IO)
        setTimeout(function () {
            self._fire('connect');
            // v4: Fire 'verify' challenge SETELAH connect — wajib agar
            // client (verifyEnable=true) bisa menyelesaikan handshake
            setTimeout(function () {
                if (self.disconnected) return;
                var challenge = MainServer.generateChallenge();
                self._challenge = challenge;
                self._fire('verify', challenge);
            }, 50);
        }, MainServer.randomDelay());
    }
    DummySocket.prototype.on = function (event, handler) {
        if (typeof handler !== 'function') return;
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
    };
    DummySocket.prototype.off = function (event, handler) {
        if (!this._listeners[event]) return;
        if (handler) { var list = this._listeners[event]; for (var i = list.length - 1; i >= 0; i--) { if (list[i] === handler) list.splice(i, 1); } }
        else { delete this._listeners[event]; }
    };
    DummySocket.prototype.emit = function (event, data, callback) {
        // Chat/Dungeon handler.process — return empty success
        if (event === 'handler.process') {
            var self = this;
            setTimeout(function () {
                if (typeof callback === 'function') {
                    callback({ ret: 0, data: '{}', compress: false, serverTime: Date.now(), server0Time: SERVER0_TIME });
                }
            }, MainServer.randomDelay());
            return;
        }
        // v4: Verify pada chat/dungeon — DECRYPT challenge dan cek, sama seperti MainSocket
        // Client L52009: (new TEA).encrypt(n, "verification") → n = challenge dari server
        if (event === 'verify') {
            var self = this;
            setTimeout(function () {
                if (!self._challenge || typeof callback !== 'function') return;
                try {
                    var tea = new _TEA();
                    var decrypted = tea.decrypt(data, MainServer.config.teaKey);
                    callback(decrypted === self._challenge ? { ret: 0 } : { ret: 1 });
                } catch (err) {
                    callback({ ret: 1 });
                }
            }, 10);
            return;
        }
    };
    DummySocket.prototype.disconnect = function () {
        this.connected = false;
        this.disconnected = true;
        this._fire('disconnect', 'io server disconnect');
    };
    DummySocket.prototype.destroy = function () {
        this.connected = false;
        this.disconnected = true;
        this._listeners = {};
    };
    DummySocket.prototype._fire = function (event) {
        var list = this._listeners[event];
        if (!list || list.length === 0) return;
        var args = Array.prototype.slice.call(arguments, 1);
        for (var i = 0; i < list.length; i++) {
            try { list[i].apply(this, args); }
            catch (e) {}
        }
    };

    function patchIoConnect() {
        if (_patched) return false;
        if (!window.io || typeof window.io.connect !== 'function') return false;
        var currentConnect = window.io.connect;
        _patched = true;
        window.io.connect = function (url, options) {
            var serverType = isMockedServerUrl(url);
            if (serverType === 'main') {
                log.arrow('intercept -> MAIN SERVER');
                log.boxDetail('url', url);
                return new MainSocket();
            }
            if (serverType === 'chat' || serverType === 'dungeon') {
                log.arrow('intercept -> ' + serverType.toUpperCase() + ' SERVER (dummy socket)');
                log.boxDetail('url', url);
                return new DummySocket();
            }
            return currentConnect.call(window.io, url, options);
        };
        log.ok('io.connect patched — ALL SERVERS INTERCEPTED (main+chat+dungeon)');
        return true;
    }

    // ═══════════════════════════════════════════════════════
    //  15. INIT
    // ═══════════════════════════════════════════════════════
    //
    //  v3 FIX: MutationObserver disconnect saat poll menang
    //  (sebelumnya observer tidak pernah disconnect → memory leak)
    //

    function init() {
        MainServer.MainSocket = MainSocket;
        MainServer.DummySocket = DummySocket;  // v3: expose for testing
        MainServer._TEA = _TEA;                // v3: expose self-contained TEA
        window.MainServer = MainServer;

        var _observer = null;

        var pollCount = 0;
        var pollTimer = setInterval(function () {
            if (_patched) {
                clearInterval(pollTimer);
                // v3: disconnect observer jika poll menang
                if (_observer) { _observer.disconnect(); _observer = null; }
                return;
            }
            if (++pollCount > 300) {
                clearInterval(pollTimer);
                if (_observer) { _observer.disconnect(); _observer = null; }
                log.fail('window.io NOT found after 30s');
                return;
            }
            if (pollCount % 50 === 0) log.boxLine('waiting for io... (' + (pollCount * 100) + 'ms)');
            if (patchIoConnect()) {
                clearInterval(pollTimer);
                if (_observer) { _observer.disconnect(); _observer = null; }
            }
        }, 100);

        if (typeof MutationObserver !== 'undefined') {
            _observer = new MutationObserver(function () {
                if (!_patched && window.io && typeof window.io.connect === 'function') {
                    patchIoConnect();
                    clearInterval(pollTimer);
                    _observer.disconnect();
                    _observer = null;
                }
            });
            _observer.observe(document.documentElement, { childList: true, subtree: true });
            // v3: auto-cleanup observer setelah 60 detik
            setTimeout(function () {
                if (_observer) { _observer.disconnect(); _observer = null; }
            }, 60000);
        }

        log.sep('READY');
        log.boxDetail('port', MainServer.config.mainServerUrl);
        log.boxDetail('chat', MainServer.config.chatServerUrl + ' (dummy socket)');
        log.boxDetail('dungeon', MainServer.config.dungeonServerUrl + ' (dummy socket)');
        log.boxDetail('tea', MainServer.config.verifyEnable ? 'ON (key: ' + MainServer.config.teaKey + ', self-contained)' : 'OFF');
        log.boxDetail('serverTime', 'Date.now() (UTC ms perangkat = server UTC ms)');
        log.boxDetail('server0Time', SERVER0_TIME + ' (formula: 60*(-420)*1000 → UTC+7 getTimezoneOffset format)');
        log.boxDetail('serverTZ', 'UTC+' + SERVER_TZ_HOURS + ' (mock = perangkat)');
        log.boxDetail('openDate', new Date(SERVER_OPEN_DATE).toISOString() + ' (days: ' + MainServer.getDaysSinceOpen() + ')');
        log.boxDetail('resetHour', RESET_HOUR + ':00 (server local time)');
        log.boxDetail('nextReset', new Date(MainServer.getNextResetTime()).toLocaleTimeString());
        log.boxDetail('routing', '2-level (type/action)');
        log.boxDetail('handlers', '0 registered (lazy load)');
        log.boxDetail('notify', 'via MainServer.log.notify()');
        log.boxDetail('logLevel', log.getLevel());
    }

    init();

})();