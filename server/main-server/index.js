/**
 * index.js — Main Server Foundation
 * Super Warrior Z — MAIN SERVER (Port 8001)
 *
 * File utama main-server. Semua handler logic ada di handlers/{type}/{action}.js.
 *
 * STRUKTUR:
 *   index.js                    — File ini: socket, router, db, config, TEA verify, io.connect
 *   logger.js                   — Logger extensions (reserved)
 *   handlers/{type}/{action}.js — Handler files (lazy loaded on-demand)
 *
 * SERVER TIME:
 *   - serverTime  = Date.now() (UTC ms perangkat = UTC ms server)
 *   - server0Time = -25200000 (60 * (-420) * 1000, UTC+7 timezone offset)
 *   - Hasil: getServerLocalDate() = waktu perangkat untuk UTC+7
 *
 * SERVER OPEN DATE:
 *   - Format: unix timestamp ms
 *   - Digunakan: VIP gating, temple trial, arena first-day check
 *
 * DAILY RESET:
 *   - RESET_HOUR = 6 (jam 06:00 server local time)
 *   - Jam 00:00-05:59 masih dianggap hari sebelumnya
 */

(function () {
    'use strict';
    console.log('[MAIN-SERVER] Initializing main-server (port 8001)...');

    // ═══════════════════════════════════════════════════════
    //  BASE PATH
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
    //  TEA (self-contained, key="verification")
    // ═══════════════════════════════════════════════════════

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
        e.encode = function (t) {
            var n, o, a, r, i, s, l, u, c, p, d, g = [], m = "", h = e.code;
            p = t;
            c = p.length % 3;
            if (c > 0) {
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
        e.decode = function () {};
        return e;
    })();

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
    //  LOGGER
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

        var counts = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, NOTIFY: 0 };

        var SERVER_TAG = '[MAIN-SERVER]';

        var COLORS = {
            INFO:  '#2196F3',
            WARN:  '#FFA726',
            ERROR: '#EF5350',
            DEBUG: '#90A4AE'
        };

        var TAG_COLOR = 'color:#00897B;';
        var TS_COLOR  = 'color:#616161;';
        var DETAIL_CLR = 'color:#004D40;opacity:0.85;padding-left:8px;';

        function ts() {
            var d = new Date();
            var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds();
            return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (ms < 100 ? '0' : '') + (ms < 10 ? '0' : '') + ms;
        }

        var CTX_EMOJI = {
            startup:   '🚀', storage:  '🗄', handler:  '🔀', database: '💾', HANDLER: '🎮',
            connection:'🔌', encryption:'🍵', network: '🌐', register:'📝', loader:  '📦',
            callback:  '⚡', notification:'🔔', resource:'📁', heroStats:'⚔',
            TASK: '📋', USER: '👤', CHAT: '💬', FRIEND: '🤝',
            HERO_IMG: '🖼', DUNGEON: '🏰', HERO: '🦸', ITEM: '💎',
            GUILD: '🏯', SUMMON: '🎰', ARENA: '🏟', NOTIFY: '🔔',
            INSPECT: '🔍', EMIT: '📤',
            enterGame: '🎮', checkin: '📅', hangUp: '⏳',
            BROADCAST: '📢', BULLETIN: '📢',
            ADMIN: '🛡'
        };
        function _ctxEmoji(ctx) {
            var c = ctx || '';
            // Exact match first (for new camelCase keys)
            if (CTX_EMOJI[c]) return CTX_EMOJI[c];
            // Fallback to uppercase (for legacy keys not yet migrated)
            return CTX_EMOJI[c.toUpperCase()] || '⚪';
        }

        // Display name mapping: transforms old UPPERCASE to natural camelCase for log output
        var DISPLAY_NAME = {
            'BOOT': 'startup', 'META': 'storage', 'ROUTE': 'handler', 'DB': 'database',
            'SOCK': 'connection', 'TEA': 'encryption', 'IO': 'network', 'REG': 'register',
            'LOAD': 'loader', 'CB': 'callback', 'NTFY': 'notification',
            'RESOURCE': 'resource', 'HERO_ATTR': 'heroStats'
        };

        function _displayName(ctx) {
            var upper = (ctx || '').toUpperCase();
            return DISPLAY_NAME[upper] || ctx;
        }

        // ═══════════════════════════════════════════════════
        //  emit — flat, consistent with login-server
        // ═══════════════════════════════════════════════════

        function emit(level, context, message) {
            if (!shouldLog(level)) return;
            counts[level]++;
            var em = _ctxEmoji(context);
            var color = COLORS[level] || '#78909C';
            var display = _displayName(context);
            var pad = ((display || '???') + '                ').slice(0, 16);
            console.log(
                '%c' + em + ' ' + ts() + ' %c' + SERVER_TAG + ' %c' + pad + '▸ ' + message,
                TS_COLOR,
                TAG_COLOR,
                'color:' + color + ';'
            );
        }

        // ═══════════════════════════════════════════════════
        //  Detail lines
        // ═══════════════════════════════════════════════════

        function safe(v) {
            if (v === null) return 'null';
            if (v === undefined) return 'undefined';
            if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return '[Object]'; } }
            return String(v);
        }

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

        function detailLine(connector, emoji, key, value) {
            if (!shouldLog('INFO')) return;
            console.log('%c  ' + connector + ' ' + emoji + ' ' + key + ' : ' + value, DETAIL_CLR);
        }

        // ═══════════════════════════════════════════════════
        //  Notify system
        // ═══════════════════════════════════════════════════

        function buildNotifyEnvelope(payload) {
            var dataStr;
            try { dataStr = JSON.stringify(payload !== undefined && payload !== null ? payload : {}); } catch (e) { dataStr = '{}'; }
            var compress = false;
            if (typeof LZString !== 'undefined' && typeof LZString.compressToUTF16 === 'function') {
                try { dataStr = LZString.compressToUTF16(dataStr); compress = true; } catch (e) {}
            }
            return { ret: 'SUCCESS', data: dataStr, compress: compress };
        }

        function pushNotify(action, payload) {
            var socket = window.MainServer && window.MainServer.currentSocket;
            if (!socket || !socket.connected) return false;
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
        //  handlerResult — 1 line success, 2+ lines failure
        // ═══════════════════════════════════════════════════

        function handlerResult(opts) {
            var route = opts.route || '???';
            var envelope = opts.envelope || {};
            var ms = opts.ms || 0;
            var issues = opts.inspect || [];
            var isSuccess = (envelope.ret === 0);

            var fieldCount = 0;
            try {
                var rawData = envelope.data;
                if (envelope.compress && typeof LZString !== 'undefined' && typeof LZString.decompressFromUTF16 === 'function') {
                    rawData = LZString.decompressFromUTF16(rawData);
                }
                var parsed = null;
                if (typeof rawData === 'string' && rawData.length > 0) parsed = JSON.parse(rawData);
                else if (rawData && typeof rawData === 'object') parsed = rawData;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    for (var k in parsed) { if (parsed.hasOwnProperty(k)) fieldCount++; }
                }
            } catch (e) {}

            if (isSuccess && issues.length === 0) {
                emit('INFO', route, '✅ ' + ms + 'ms  ' + fieldCount + ' fields');
            } else {
                emit(isSuccess ? 'WARN' : 'ERROR', route, '❌ ' + ms + 'ms  ret=' + envelope.ret + (fieldCount > 0 ? '  ' + fieldCount + ' fields' : ''));
                for (var i = 0; i < issues.length; i++) {
                    var iss = issues[i];
                    emit(iss.type === 'ERROR' ? 'ERROR' : 'WARN', route, (iss.type === 'ERROR' ? '❌' : '⚠') + ' ' + iss.msg);
                }
            }
        }

        // ═══════════════════════════════════════════════════
        //  Return Logger object
        // ═══════════════════════════════════════════════════

        return {
            info: function (ctx, msg) { emit('INFO', ctx, msg); },
            warn: function (ctx, msg) { emit('WARN', ctx, msg); },
            error: function (ctx, msg) { emit('ERROR', ctx, msg); },
            debug: function (ctx, msg) { emit('DEBUG', ctx, msg); },
            detail: function (key, value) { detailLine('└', '📋', key, safe(value)); },
            details: function (context, pairs) {
                if (Array.isArray(context) && !pairs) pairs = context;
                if (!shouldLog('INFO') || !Array.isArray(pairs)) return;
                for (var i = 0; i < pairs.length; i++) {
                    var conn = (i < pairs.length - 1) ? '├' : '└';
                    detailLine(conn, '📋', pairs[i][0], safe(pairs[i][1]));
                }
            },
            alwaysDetails: function (pairs) {
                if (!shouldLog('INFO') || !Array.isArray(pairs)) return;
                for (var i = 0; i < pairs.length; i++) {
                    var conn = (i < pairs.length - 1) ? '├' : '└';
                    console.log('%c  ' + conn + ' ' + pairs[i][0] + ' : ' + safe(pairs[i][1]), DETAIL_CLR);
                }
            },
            importantDetails: function (ctx, pairs) {
                if (!shouldLog('INFO') || !Array.isArray(pairs)) return;
                emit('INFO', ctx, '');
                for (var i = 0; i < pairs.length; i++) {
                    var conn = (i < pairs.length - 1) ? '├' : '└';
                    console.log('%c  ' + conn + ' ' + pairs[i][0] + ' : ' + safe(pairs[i][1]), DETAIL_CLR);
                }
            },
            arrow: function (text) { if (!shouldLog('INFO')) return; console.log('%c  ▸ %c' + text, 'color:#4DB6AC;', 'color:#B0BEC5;'); },
            notify: function (action, payload) {
                var pushed = pushNotify(action, payload);
                if (pushed) { counts.NOTIFY++; emit('INFO', 'NTFY', action); }
                else { emit('WARN', 'NTFY', 'Cannot push "' + action + '" — no socket'); }
            },
            buildNotifyEnvelope: function (payload) { return buildNotifyEnvelope(payload); },
            autoInspect: autoInspect,
            scanStateZero: scanStateZero,
            handlerResult: handlerResult,
            setLevel: function (level) {
                if (PRIORITY[level] !== undefined) {
                    currentLevel = level; minPrio = PRIORITY[level];
                    try { localStorage.setItem(STORE_KEY, level); } catch (e) {}
                    console.log('%c' + SERVER_TAG + ' Log level → ' + level, TAG_COLOR);
                }
            },
            getLevel: function () { return currentLevel; },
            getCounts: function () { return { DEBUG: counts.DEBUG, INFO: counts.INFO, WARN: counts.WARN, ERROR: counts.ERROR, NOTIFY: counts.NOTIFY }; },
            resetCounts: function () { counts.DEBUG = 0; counts.INFO = 0; counts.WARN = 0; counts.ERROR = 0; counts.NOTIFY = 0; }
        };
    })();


    // ═══════════════════════════════════════════════════════
    //  EXPOSE LOGGER
    // ═══════════════════════════════════════════════════════

    window.MainServerLogger = Logger;
    var log = Logger;
    window.Log_Clean = true;

    // ═══════════════════════════════════════════════════════
    //  LOAD logger.js (optional)
    // ═══════════════════════════════════════════════════════

    (function () {
        var s = document.createElement('script');
        s.src = basePath + 'logger.js';
        s.async = false;
        (document.head || document.documentElement).appendChild(s);
        if (window.MainServerLogger) {
            log = window.MainServerLogger;
        }
    })();

    // ═══════════════════════════════════════════════════════
    //  CONFIG + MAINSERVER OBJECT
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
    //  SERVER TIME HELPERS
    // ═══════════════════════════════════════════════════════

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
            log.info('storage', 'serverOpenDate updated → ' + new Date(ts).toISOString());
        }
    };

    MainServer.getDaysSinceOpen = function () {
        return Math.floor((Date.now() - MainServer.config.serverOpenDate) / 86400000) + 1;
    };

    MainServer.generateRetrieveDay = function (dateObj) {
        var d = dateObj || MainServer.getServerLocalDate();
        var h = d.getHours();
        if (RESET_HOUR > h) {
            d = new Date(d.valueOf() - 86400000);
        }
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    };

    MainServer.getServerLocalZeroClockTime = function () {
        var d = MainServer.getServerLocalDate();
        var y = d.getFullYear();
        var m = d.getMonth() + 1;
        var day = d.getDate();
        return new Date(y + '/' + m + '/' + day).getTime();
    };

    MainServer.isAfterReset = function (dateObj) {
        var d = dateObj || MainServer.getServerLocalDate();
        return d.getHours() >= RESET_HOUR;
    };

    MainServer.getNextResetTime = function () {
        var d = MainServer.getServerLocalDate();
        if (d.getHours() >= RESET_HOUR) {
            // Sudah lewat reset hari ini → reset berikutnya = besok RESET_HOUR:00:00
            d.setDate(d.getDate() + 1);
        }
        d.setHours(RESET_HOUR, 0, 0, 0);
        return d.getTime();
    };

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
    //  SERVER TIME CONSTANTS
    // ═══════════════════════════════════════════════════════
    //  serverTime  = Date.now() (UTC ms)
    //  server0Time = 60 * (-420) * 1000 = -25200000 (UTC+7)
    //  RESET_HOUR  = 6 (jam 00:00-05:59 masih dianggap hari sebelumnya)

    var SERVER_TZ_HOURS = 7;
    var SERVER0_TIME = 60 * (-SERVER_TZ_HOURS * 60) * 1000;
    var SERVER_OPEN_DATE = new Date(2026, 5, 15, 0, 0, 0, 0).getTime();
    var RESET_HOUR = 6;

    // ═══════════════════════════════════════════════════════
    //  BUILD ENVELOPE
    // ═══════════════════════════════════════════════════════

    MainServer.buildEnvelope = function (responseData, retCode) {
        var ret = (typeof retCode === 'number' && retCode !== 0) ? retCode : 0;
        var dataStr;
        try { dataStr = JSON.stringify(responseData !== undefined && responseData !== null ? responseData : {}); } catch (e) { dataStr = '{}'; }
        var compress = false;
        if (ret === 0 && typeof LZString !== 'undefined' && typeof LZString.compressToUTF16 === 'function') {
            try { dataStr = LZString.compressToUTF16(dataStr); compress = true; } catch (e) {}
        }
        return {
            ret: ret,
            data: dataStr,
            compress: compress,
            serverTime: Date.now(),
            server0Time: SERVER0_TIME
        };
    };

    // ═══════════════════════════════════════════════════════
    //  NOTIFY
    // ═══════════════════════════════════════════════════════

    MainServer.notify = function (data) {
        MainServer.log.notify(data && data.action, data);
    };

    window.MainServer = MainServer;

    // ═══════════════════════════════════════════════════════
    //  DATABASE — In-Memory Cache + IndexedDB Persistence
    // ═══════════════════════════════════════════════════════

    var _dbEngine = (function () {
        var memory = {};
        var idb = null;
        var ready = false;
        var useIDB = false;
        var pendingWrites = [];
        var writesDuringLoad = {};
        var DB_NAME = 'main-server';
        var DB_VERSION = 1;
        var STORE = 'userData';

        function get(key) {
            if (memory.hasOwnProperty(key)) return memory[key];
            return undefined;
        }

        function set(key, data) {
            memory[key] = data;
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

        function init() {
            log.info('database', 'Opening database — db="' + DB_NAME + '" store="' + STORE + '" version=' + DB_VERSION);
            if (window.indexedDB) {
                try {
                    var request = indexedDB.open(DB_NAME, DB_VERSION);
                    request.onupgradeneeded = function (e) {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
                        log.info('database', 'Object store created — "' + STORE + '"');
                    };

                    request.onsuccess = function (e) {
                        idb = e.target.result;
                        useIDB = true;
                        log.info('database', 'IndexedDB connection established — db="' + DB_NAME + '"');

                        loadAllFromIDB(function (idbKeys) {
                            if (idbKeys.length > 0) {
                                log.info('database', 'Persisted data loaded — ' + idbKeys.length + ' key(s) from "' + STORE + '"');
                            } else {
                                log.info('database', 'No persisted data found — starting fresh');
                            }

                            // flush pending writes
                            if (pendingWrites.length > 0) {
                                log.info('database', 'Flushing ' + pendingWrites.length + ' pending write(s) queued before DB was ready');
                                for (var i = 0; i < pendingWrites.length; i++) {
                                    writeIDB(pendingWrites[i].key, pendingWrites[i].data);
                                }
                                pendingWrites = [];
                            }

                            if (Object.keys(writesDuringLoad).length > 0) {
                                log.info('database', 'Skipped ' + Object.keys(writesDuringLoad).length + ' key(s) overwritten during load (writesDuringLoad)');
                            }
                            writesDuringLoad = {};
                            ready = true;
                            log.info('database', 'Database ready — engine=IndexedDB, keys=' + Object.keys(memory).length);
                        });
                    };

                    request.onerror = function (e) {
                        ready = true;
                        log.warn('database', 'IndexedDB open failed (db="' + DB_NAME + '") — falling back to memory-only mode');
                    };

                    request.onblocked = function () {
                        log.warn('database', 'IndexedDB open blocked (db="' + DB_NAME + '") — another tab may be using it, retrying...');
                    };

                } catch (err) {
                    ready = true;
                    log.warn('database', 'IndexedDB not usable — ' + (err.message || err.name || 'unknown error') + ' — falling back to memory-only mode');
                }
            } else {
                ready = true;
                log.warn('database', 'IndexedDB not supported by this browser — falling back to memory-only mode');
            }
        }

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
                    log.error('database', 'Failed to load from IndexedDB');
                    callback([]);
                };
            } catch (ex) {
                log.error('database', 'loadAllFromIDB error: ' + ex.message);
                callback([]);
            }
        }

        function writeIDB(key, data) {
            if (!idb) return;
            try {
                var tx = idb.transaction(STORE, 'readwrite');
                var store = tx.objectStore(STORE);
                store.put(data, key);
            } catch (ex) { log.error('database', 'writeIDB error: ' + ex.message); }
        }

        function deleteIDB(key) {
            if (!idb) return;
            try {
                var tx = idb.transaction(STORE, 'readwrite');
                var store = tx.objectStore(STORE);
                store.delete(key);
            } catch (ex) { log.error('database', 'deleteIDB error: ' + ex.message); }
        }

        return {
            init: init, get: get, set: set, remove: remove, keys: keys,
            isReady: function () { return ready; },
            isUsingIDB: function () { return useIDB; },
            getMemorySize: function () { return Object.keys(memory).length; }
        };
    })();

    _dbEngine.init();
    log.info('database', 'Init complete — engine=' + (_dbEngine.isUsingIDB() ? 'IndexedDB' : 'memory') + ', keys=' + _dbEngine.getMemorySize());

    MainServer.db = {
        _prefix: '',
        save: function (key, data) { try { _dbEngine.set(this._prefix + key, data); return true; } catch (e) { log.error('database', 'Save failed: ' + key + ' — ' + e.message); return false; } },
        get: function (key, defaultVal) { try { var val = _dbEngine.get(this._prefix + key); return val !== undefined ? val : (defaultVal !== undefined ? defaultVal : null); } catch (e) { log.error('database', 'Get failed: ' + key + ' — ' + e.message); return defaultVal !== undefined ? defaultVal : null; } },
        remove: function (key) { try { _dbEngine.remove(this._prefix + key); } catch (e) {} },
        keys: function () { var prefix = this._prefix; var allKeys = _dbEngine.keys(); var result = []; for (var i = 0; i < allKeys.length; i++) { if (allKeys[i].indexOf(prefix) === 0) result.push(allKeys[i].substring(prefix.length)); } return result; }
    };

    // ═══════════════════════════════════════════════════════
    //  MainServerDB
    // ═══════════════════════════════════════════════════════

    var _loginTokens = {};

    // _loginTokens: in-memory cache, populated on successful IDB reads
    // (no preload — token is written by login-server AFTER this script loads)

    window.MainServerDB = {
        _get: function (key) { return MainServer.db.get(key); },
        _set: function (key, data) { return MainServer.db.save(key, data); },
        nowSeconds: function () { return Math.floor(Date.now() / 1000); },
        /**
         * validateLoginToken(userId, callback) — ASYNC
         * Reads directly from IndexedDB at call time (not startup cache).
         * Login-server writes token to login-server/loginInfo AFTER user logs in,
         * so a startup preload would always miss it on fresh browsers.
         */
        validateLoginToken: function (userId, callback) {
            // Cache hit → instant
            if (_loginTokens[userId]) {
                callback({ valid: true, token: { loginToken: _loginTokens[userId], userId: userId } });
                return;
            }
            // Read from IndexedDB (where login-server SaveHistory writes)
            try {
                var req = indexedDB.open('login-server');
                req.onupgradeneeded = function () {};
                req.onsuccess = function (e) {
                    var idb = e.target.result;
                    try {
                        var tx = idb.transaction('loginInfo', 'readonly');
                        var store = tx.objectStore('loginInfo');
                        var cursor = store.openCursor();
                        cursor.onsuccess = function (ev) {
                            var c = ev.target.result;
                            if (c) {
                                if (c.value && c.value.userId === userId && c.value.loginToken) {
                                    _loginTokens[userId] = c.value.loginToken;
                                    idb.close();
                                    callback({ valid: true, token: { loginToken: c.value.loginToken, userId: userId } });
                                    return;
                                }
                                c.continue();
                            } else {
                                idb.close();
                                callback({ valid: false, reason: 'token_not_found' });
                            }
                        };
                        cursor.onerror = function () { idb.close(); callback({ valid: false, reason: 'db_read_error' }); };
                    } catch (ex) { idb.close(); callback({ valid: false, reason: 'db_exception' }); }
                };
                req.onerror = function () { callback({ valid: false, reason: 'db_open_error' }); };
            } catch (ex) { callback({ valid: false, reason: 'exception' }); }
        }
    };

    // ═══════════════════════════════════════════════════════
    //  HANDLER REGISTRY + LAZY LOADER
    // ═══════════════════════════════════════════════════════

    MainServer._pendingCallbacks = {};

    MainServer.registerHandler = function (type, action, handlerFn) {
        var key = type + '/' + action;
        MainServer.handlers[key] = handlerFn;
        if (MainServer._handlerNames.indexOf(key) === -1) MainServer._handlerNames.push(key);
        if (MainServer._pendingCallbacks && MainServer._pendingCallbacks[key]) {
            var cbs = MainServer._pendingCallbacks[key];
            delete MainServer._pendingCallbacks[key];
            for (var i = 0; i < cbs.length; i++) cbs[i]();
        }
        log.debug('register', key + ' — handler function registered');
    };

    MainServer.loadHandlerScript = function (type, action, onReady) {
        var key = type + '/' + action;

        if (MainServer._loadedHandlers[key] === 'registered') {
            log.debug('loader', key + ' — already cached');
            onReady(); return;
        }

        if (MainServer._loadedHandlers[key] === 'loading') {
            log.debug('loader', key + ' — already loading, queuing callback');
            if (!MainServer._pendingCallbacks[key]) MainServer._pendingCallbacks[key] = [];
            MainServer._pendingCallbacks[key].push(onReady);
            return;
        }

        MainServer._loadedHandlers[key] = 'loading';
        log.debug('loader', key + ' — loading script: handlers/' + type + '/' + action + '.js');

        var bustV = Date.now();
        var script = document.createElement('script');
        script.src = basePath + 'handlers/' + type + '/' + action + '.js' + '?t=' + bustV;
        script.async = false;
        script.onload = function () {
            if (typeof MainServer.handlers[key] === 'function') {
                MainServer._loadedHandlers[key] = 'registered';
            } else {
                delete MainServer._loadedHandlers[key];
                log.warn('loader', key + ' — script loaded but handler did NOT call registerHandler — will retry on next request');
            }
            onReady();
            script.parentNode && script.parentNode.removeChild(script);
        };
        script.onerror = function () {
            delete MainServer._loadedHandlers[key];
            log.warn('loader', key + ' — script file not found (404) — will retry on next request');
            onReady();
        };
        (document.head || document.documentElement).appendChild(script);
    };

    // ═══════════════════════════════════════════════════════
    //  ROUTER
    // ═══════════════════════════════════════════════════════

    var _stats = { total: 0, unknown: 0, lazy: 0, errors: 0 };

    function dispatch(request, originalCallback) {
        var type = request.type || '';
        var action = request.action || '';
        var key = type + '/' + action;
        _stats.total++;

        log.debug('handler', 'incoming → ' + (key || '(empty)'));

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
            log.debug('handler', key + ' → handler cached, executing');
            executeHandler(key, handler, request, originalCallback);
        } else {
            _stats.lazy++;
            log.info('loader', key + ' — handler not cached, lazy-loading script...');
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
                    var rawData = envelope.data;
                    if (envelope.compress && typeof LZString !== 'undefined' && typeof LZString.decompressFromUTF16 === 'function') {
                        rawData = LZString.decompressFromUTF16(rawData);
                    }
                    if (typeof rawData === 'string' && rawData.length > 0) parsedData = JSON.parse(rawData);
                    else if (rawData && typeof rawData === 'object') parsedData = rawData;
                } catch (e) {}
                var issues = log.autoInspect(key, envelope, parsedData);
                log.handlerResult({ route: key, request: request, envelope: envelope, ms: ms, inspect: issues });
                if (typeof log.trackEnvelope === 'function') log.trackEnvelope(key, envelope);
                if (typeof originalCallback === 'function') {
                    try { originalCallback(envelope); }
                    catch (cbErr) {
                        log.error('callback', 'Route: ' + key + ' — ' + (cbErr.name || 'Error') + ': ' + cbErr.message);
                        if (cbErr.stack) console.error(cbErr.stack);
                        
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
    //  MAINSOCKET
    // ═══════════════════════════════════════════════════════

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
        var sockId = this.id;

        log.info('connection', '#' + _sockCounter + ' (' + sockId + ') connecting... (delay ~' + delay + 'ms)');

        setTimeout(function () {
            if (self.disconnected) { log.warn('connection', '#' + _sockCounter + ' (' + sockId + ') disconnected before connect completed'); return; }
            self.connected = true;
            self._fire('connect');
            log.info('connection', '#' + _sockCounter + ' (' + sockId + ') connected — ' + delay + 'ms latency');

            if (MainServer.config.verifyEnable) {
                log.info('encryption', '#' + _sockCounter + ' (' + sockId + ') starting TEA challenge...');
                setTimeout(function () {
                    if (self.disconnected || !self.connected) { log.warn('connection', '#' + _sockCounter + ' (' + sockId + ') disconnected before verify could start'); return; }
                    self._startVerify();
                }, 50);
            } else {
                self._verified = true;
                log.info('encryption', '#' + _sockCounter + ' (' + sockId + ') verify disabled — marking as verified');
            }
        }, delay);
    }

    MainSocket.prototype._startVerify = function () {
        var challenge = MainServer.generateChallenge();
        this._challenge = challenge;
        log.info('encryption', '#' + _sockCounter + ' (' + this.id + ') challenge sent → client must encrypt with key="' + MainServer.config.teaKey + '"');
        log.details('TEA', [
            ['socketId', this.id],
            ['challenge', challenge]
        ]);
        this._fire('verify', challenge);
    };

    MainSocket.prototype._verifyResponse = function (encrypted, callback) {
        var sockId = this.id;
        if (!this._challenge) {
            log.warn('encryption', '#' + _sockCounter + ' (' + sockId + ') verify response received but no challenge was stored — rejecting');
            if (typeof callback === 'function') callback({ ret: 1 });
            return;
        }
        try {
            var tea = new _TEA();
            var decrypted = tea.decrypt(encrypted, MainServer.config.teaKey);
            if (decrypted === this._challenge) {
                this._verified = true;
                log.info('encryption', '#' + _sockCounter + ' (' + sockId + ') verify SUCCESS — decryption matched challenge');
                if (typeof callback === 'function') callback({ ret: 0 });
            } else {
                log.warn('encryption', '#' + _sockCounter + ' (' + sockId + ') verify FAILED — decrypted value does not match challenge');
                if (typeof callback === 'function') callback({ ret: 1 });
            }
        } catch (err) {
            log.error('encryption', '#' + _sockCounter + ' (' + sockId + ') decrypt error — ' + (err.name || 'Error') + ': ' + err.message);
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
            var routeName = (data && data.type && data.action) ? (data.type + '/' + data.action) : '(unknown)';
            if (!this._verified && MainServer.config.verifyEnable) {
                log.warn('connection', '(' + this.id + ') handler.process received before TEA verify — rejected (route: ' + routeName + ')');
                return;
            }
            var self = this;
            var delay = MainServer.randomDelay();
            log.debug('handler', '(' + this.id + ') handler.process → ' + routeName + ' (delay ~' + delay + 'ms)');
            setTimeout(function () {
                if (!self.connected) { log.warn('connection', '(' + self.id + ') socket disconnected before handler could execute (route: ' + routeName + ')'); return; }
                if (!data || typeof data !== 'object') { log.warn('connection', '(' + self.id + ') handler.process received invalid payload — expected object, got ' + typeof data + ' (event=handler.process)'); return; }
                MainServer.currentSocket = self;
                dispatch(data, function (envelope) {
                    var route = data.type + '/' + data.action;
                    if (typeof log.trackEnvelope === 'function') log.trackEnvelope(route, envelope);
                    if (typeof callback === 'function') {
                        try { callback(envelope); }
                        catch (cbErr) {
                            log.error('callback', 'Emit route: ' + route + ' — ' + (cbErr.name || 'Error') + ': ' + cbErr.message);
                            if (cbErr.stack) console.error(cbErr.stack);
                            
                        }
                    }
                });
            }, delay);
            return;
        }
        log.debug('EMIT', 'Unhandled: ' + event);
    };

    MainSocket.prototype.disconnect = function () {
        log.info('connection', '(' + this.id + ') disconnecting (source: client)');
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

    MainSocket.prototype._fire = function (event) {
        var list = this._listeners[event];
        if (!list || list.length === 0) return;
        var args = Array.prototype.slice.call(arguments, 1);
        for (var i = 0; i < list.length; i++) {
            try { list[i].apply(this, args); }
            catch (e) { log.error('connection', 'Listener error "' + event + '": ' + e.message); }
        }
    };

    // ═══════════════════════════════════════════════════════
    //  IO.CONNECT ROUTER
    // ═══════════════════════════════════════════════════════
    //  :8001 → MainSocket  |  :8002 → ServerSocket (chat)
    //  :8004 → ServerSocket (dungeon)  |  lainnya → passthrough

    var _installed = false;

    function getServerType(url) {
        if (!url) return false;
        if (url.indexOf(':8001') !== -1) return 'main';
        if (url.indexOf(':8002') !== -1) return 'chat';
        if (url.indexOf(':8004') !== -1) return 'dungeon';
        return false;
    }

    function ServerSocket() {
        this.id = _generateSocketId();
        this.connected = true;
        this.disconnected = false;
        this._listeners = {};
        this._challenge = '';
        var self = this;
        setTimeout(function () {
            self._fire('connect');
            setTimeout(function () {
                if (self.disconnected) return;
                var challenge = MainServer.generateChallenge();
                self._challenge = challenge;
                self._fire('verify', challenge);
            }, 50);
        }, MainServer.randomDelay());
    }
    ServerSocket.prototype.on = function (event, handler) {
        if (typeof handler !== 'function') return;
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
    };
    ServerSocket.prototype.off = function (event, handler) {
        if (!this._listeners[event]) return;
        if (handler) { var list = this._listeners[event]; for (var i = list.length - 1; i >= 0; i--) { if (list[i] === handler) list.splice(i, 1); } }
        else { delete this._listeners[event]; }
    };
    ServerSocket.prototype.emit = function (event, data, callback) {
        if (event === 'handler.process') {
            var self = this;
            setTimeout(function () {
                if (typeof callback === 'function') {
                    callback({ ret: 0, data: '{}', compress: false, serverTime: Date.now(), server0Time: SERVER0_TIME });
                }
            }, MainServer.randomDelay());
            return;
        }
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
    ServerSocket.prototype.disconnect = function () {
        log.info('connection', '(' + this.id + ') disconnecting (source: io server disconnect)');
        this.connected = false;
        this.disconnected = true;
        this._fire('disconnect', 'io server disconnect');
    };
    ServerSocket.prototype.destroy = function () {
        this.connected = false;
        this.disconnected = true;
        this._listeners = {};
    };
    ServerSocket.prototype._fire = function (event) {
        var list = this._listeners[event];
        if (!list || list.length === 0) return;
        var args = Array.prototype.slice.call(arguments, 1);
        for (var i = 0; i < list.length; i++) {
            try { list[i].apply(this, args); }
            catch (e) {}
        }
    };

    function installSocketRouter() {
        if (_installed) return false;
        if (!window.io || typeof window.io.connect !== 'function') return false;
        var originalConnect = window.io.connect;
        _installed = true;
        window.io.connect = function (url, options) {
            var serverType = getServerType(url);
            if (serverType === 'main') {
                log.info('network', 'io.connect("' + url + '") → routed to MainSocket (port 8001)');
                return new MainSocket();
            }
            if (serverType === 'chat' || serverType === 'dungeon') {
                log.info('network', 'io.connect("' + url + '") → routed to ServerSocket (' + serverType + ', port ' + (serverType === 'chat' ? '8002' : '8004') + ')');
                return new ServerSocket();
            }
            log.debug('network', 'io.connect("' + url + '") → passthrough to original io.connect (unrecognized port)');
            return originalConnect.call(window.io, url, options);
        };
        log.info('network', 'Socket router installed — routing ports: 8001 (main), 8002 (chat), 8004 (dungeon)');
        return true;
    }

    // ═══════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════

    function init() {
        MainServer.MainSocket = MainSocket;
        MainServer.ServerSocket = ServerSocket;
        MainServer._TEA = _TEA;
        window.MainServer = MainServer;

        // ── Load heroStats.js (shared compute engine) BEFORE any handler ──
        // Handlers are lazy-loaded but heroStats must be available globally
        (function loadHeroStats() {
            var s = document.createElement('script');
            s.src = basePath + 'heroStats.js';
            s.async = false;
            document.head.appendChild(s);
        })();

        var _observer = null;

        var pollCount = 0;
        var pollTimer = setInterval(function () {
            if (_installed) {
                clearInterval(pollTimer);
                if (_observer) { _observer.disconnect(); _observer = null; }
                return;
            }
            if (++pollCount > 300) {
                clearInterval(pollTimer);
                if (_observer) { _observer.disconnect(); _observer = null; }
                log.error('network', 'window.io NOT found after 30s — socket routing cannot be installed, io.connect calls will use original behavior');
                return;
            }
            if (pollCount % 50 === 0) log.debug('network', 'waiting for io... (' + (pollCount * 100) + 'ms)');
            if (installSocketRouter()) {
                clearInterval(pollTimer);
                if (_observer) { _observer.disconnect(); _observer = null; }
            }
        }, 100);

        if (typeof MutationObserver !== 'undefined') {
            _observer = new MutationObserver(function () {
                if (!_installed && window.io && typeof window.io.connect === 'function') {
                    installSocketRouter();
                    clearInterval(pollTimer);
                    _observer.disconnect();
                    _observer = null;
                }
            });
            _observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(function () {
                if (_observer) { _observer.disconnect(); _observer = null; }
            }, 60000);
        }

        log.info('startup', 'Main-server initialization complete');
        log.importantDetails('BOOT', [
            ['port', MainServer.config.mainServerUrl],
            ['chat', MainServer.config.chatServerUrl],
            ['dungeon', MainServer.config.dungeonServerUrl],
            ['tea', MainServer.config.verifyEnable ? 'ON (key="' + MainServer.config.teaKey + '")' : 'OFF'],
            ['openDate', new Date(SERVER_OPEN_DATE).toISOString().slice(0, 10) + ' (day ' + MainServer.getDaysSinceOpen() + ')'],
            ['resetHour', RESET_HOUR + ':00 (server local time)'],
            ['db', _dbEngine.isUsingIDB() ? 'IndexedDB ("main-server"/"userData")' : 'memory-only'],
            ['handlers', '0 registered (lazy-loaded on first request)'],
            ['logLevel', log.getLevel()],
            ['router', _installed ? 'installed' : 'waiting for window.io']
        ]);
    }

    init();

})();