/**
 * logger.js — CHAT SERVER Logger
 * Super Warrior Z — CHAT SERVER
 *
 * Self-contained logger. Tidak bergantung file lain.
 * Setiap server punya logger.js sendiri di folder masing-masing.
 */

var ChatServerLog = (function () {
    'use strict';

    // ═══════════════════════════════════════════
    // Ganti ini untuk setiap server
    // ═══════════════════════════════════════════
    var SERVER = 'CHAT';
    var TAG_COLOR = '#7B1FA2';
    var ACCENT_COLOR = '#4A148C';
    // ═══════════════════════════════════════════

    var TAG = '[' + SERVER + ']';

    // Per-server log level dari localStorage
    var LEVEL_KEY = SERVER + '_LOG_LEVEL';
    var PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 99 };
    var currentLevel = (function () {
        try { return localStorage.getItem(LEVEL_KEY) || 'DEBUG'; }
        catch (e) { return 'DEBUG'; }
    })();
    var minPriority = PRIORITY[currentLevel] !== undefined ? PRIORITY[currentLevel] : 0;

    var LEVEL_EMOJI = { INFO: '🟢', WARN: '🟡', ERROR: '🔴', DEBUG: '🔵' };
    var MODULE_EMOJI = {
        INIT: '🚀', SOCK: '🔌', IO: '🌐', ROUTE: '🔀',
        API: '📡', DB: '🗄️', AUTH: '🔐', CHAT: '💬',
        ROOM: '🏠', MSG: '✉️', NOTIFY: '🔔', RECORD: '📂',
        LOAD: '📦', TIMER: '⏱️', PATCH: '🔧', SYNC: '🔄',
        NET: '🔗', CFG: '⚙️', EVT: '⚡', TEA: '🍵',
        JOIN: '🚪', LEAVE: '🚪'
    };
    var DETAIL_EMOJI = {
        data: '📋', important: '📌', duration: '⏱️',
        location: '📍', config: '⚙️', token: '🔑', count: '🔢',
        response: '📤', request: '📥', error: '💥', fallback: '🛡️',
        room: '🏠', user: '👤', message: '💬', challenge: '🔐'
    };

    function shouldLog(level) {
        var p = PRIORITY[level];
        return p !== undefined && p >= minPriority;
    }

    function ts() {
        var d = new Date();
        return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function levelColor(level) {
        var c = { INFO: '#2196F3', WARN: '#FF9800', ERROR: '#F44336', DEBUG: '#78909C' };
        return c[level] || '#78909C';
    }

    // ═══════════════════════════════════════════════
    // info(module, message)
    // ═══════════════════════════════════════════════
    function info(module, message) {
        if (!shouldLog('INFO')) return;
        var mdE = MODULE_EMOJI[module] || '⚪';
        var modPad = (module + '      ').slice(0, 6);
        console.log(
            '%c🟢 ' + ts() + ' %c' + TAG + ' %cINFO  %c' + mdE + ' ' + modPad + ' ▸ ' + message,
            'color:#757575;',
            'color:' + TAG_COLOR + ';font-weight:bold;',
            'color:' + levelColor('INFO') + ';font-weight:bold;',
            'color:' + ACCENT_COLOR + ';'
        );
    }

    // ═══════════════════════════════════════════════
    // warn(module, message)
    // ═══════════════════════════════════════════════
    function warn(module, message) {
        if (!shouldLog('WARN')) return;
        var mdE = MODULE_EMOJI[module] || '⚪';
        var modPad = (module + '      ').slice(0, 6);
        console.log(
            '%c🟡 ' + ts() + ' %c' + TAG + ' %cWARN  %c' + mdE + ' ' + modPad + ' ▸ ' + message,
            'color:#757575;',
            'color:' + TAG_COLOR + ';font-weight:bold;',
            'color:#FF9800;font-weight:bold;',
            'color:' + ACCENT_COLOR + ';'
        );
    }

    // ═══════════════════════════════════════════════
    // debug(module, message)
    // ═══════════════════════════════════════════════
    function debug(module, message) {
        if (!shouldLog('DEBUG')) return;
        var mdE = MODULE_EMOJI[module] || '⚪';
        var modPad = (module + '      ').slice(0, 6);
        console.log(
            '%c🔵 ' + ts() + ' %c' + TAG + ' %cDEBUG %c' + mdE + ' ' + modPad + ' ▸ ' + message,
            'color:#757575;',
            'color:' + TAG_COLOR + ';font-weight:bold;',
            'color:#78909C;',
            'color:' + ACCENT_COLOR + ';'
        );
    }

    // ═══════════════════════════════════════════════
    // detail(type, text) — single line (DEBUG)
    // ═══════════════════════════════════════════════
    function detail(type, text) {
        if (!shouldLog('DEBUG')) return;
        var emoji = DETAIL_EMOJI[type] || '📋';
        console.log('%c  └ ' + emoji + ' ' + text, 'color:' + ACCENT_COLOR + ';opacity:0.7;padding-left:8px;');
    }

    // ═══════════════════════════════════════════════
    // details(type, pairs) — multi-line tree (DEBUG)
    // ═══════════════════════════════════════════════
    function details(type, pairs) {
        if (!shouldLog('DEBUG')) return;
        var emoji = DETAIL_EMOJI[type] || '📋';
        for (var i = 0; i < pairs.length; i++) {
            var connector = i < pairs.length - 1 ? '├' : '└';
            console.log(
                '%c  ' + connector + ' ' + emoji + ' ' + pairs[i][0] + ': ' + pairs[i][1],
                'color:' + ACCENT_COLOR + ';opacity:0.7;padding-left:8px;'
            );
        }
    }

    // ═══════════════════════════════════════════════
    // important(type, text) — ALWAYS visible
    // ═══════════════════════════════════════════════
    function important(type, text) {
        var emoji = DETAIL_EMOJI[type] || '📋';
        console.log('%c  └ ' + emoji + ' ' + text, 'color:#616161;padding-left:8px;');
    }

    function importantDetails(type, pairs) {
        var emoji = DETAIL_EMOJI[type] || '📋';
        for (var i = 0; i < pairs.length; i++) {
            var connector = i < pairs.length - 1 ? '├' : '└';
            console.log(
                '%c  ' + connector + ' ' + emoji + ' ' + pairs[i][0] + ': ' + pairs[i][1],
                'color:#616161;padding-left:8px;'
            );
        }
    }

    // ═══════════════════════════════════════════════
    // error(module, message, errorObj) — ALWAYS + stack
    // NEVER silent.
    // ═══════════════════════════════════════════════
    function error(module, message, errorObj) {
        var mdE = MODULE_EMOJI[module] || '⚪';
        var modPad = (module + '      ').slice(0, 6);
        console.log(
            '%c🔴 ' + ts() + ' %c' + TAG + ' %cERROR %c' + mdE + ' ' + modPad + ' ▸ ' + message,
            'color:#757575;',
            'color:' + TAG_COLOR + ';font-weight:bold;',
            'color:#F44336;font-weight:bold;',
            'color:#B71C1C;font-weight:bold;'
        );
        if (errorObj) {
            var stack = errorObj.stack || errorObj.message || String(errorObj);
            console.log('%c  └ 💥 ' + stack, 'color:#F44336;padding-left:8px;font-size:11px;white-space:pre-wrap;');
        }
    }

    // ═══════════════════════════════════════════════
    // setLevel(level) — runtime
    // ═══════════════════════════════════════════════
    function setLevel(level) {
        var p = PRIORITY[level];
        if (p !== undefined) {
            currentLevel = level;
            minPriority = p;
            try { localStorage.setItem(LEVEL_KEY, level); } catch (e) {}
            console.log('%c' + TAG + ' Log level → ' + level, 'color:' + TAG_COLOR + ';font-weight:bold;');
        }
    }

    // ═══════════════════════════════════════════════
    // Export
    // ═══════════════════════════════════════════════
    return {
        info: info,
        warn: warn,
        debug: debug,
        error: error,
        detail: detail,
        details: details,
        important: important,
        importantDetails: importantDetails,
        level: currentLevel,
        setLevel: setLevel
    };
})();

window.ChatServerLog = ChatServerLog;
