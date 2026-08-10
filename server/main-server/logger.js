/**
 * logger.js — BUG HUNTER PATCH (v6)
 * Super Warrior Z — MAIN SERVER (Port 8001)
 *
 * FILE INI BUKAN DEAD CODE.
 * File ini LOADED oleh index.js setelah inline Logger dibuat.
 *
 * v6 FIX:
 *   - FIXED: crossReferenceError typo (v5 bug — function name was wrong,
 *     causing formatBugReport to crash silently every time)
 *   - FIXED: All escalation code wrapped in try-catch
 *   - FIXED: boxLineFail override falls back to original on escalation failure
 *   - ADDED: Load-time verification (logs which patches applied)
 *   - ADDED: window.__BUG_HUNTER_READY flag for external checks
 *
 * ARSITEKTUR:
 *   index.js membuat inline Logger → set window.MainServerLogger = Logger
 *   → lalu load file ini (async=false) → file ini PATCH object yang SUDAH ADA
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    //  0. GRAB LOG OBJECT + EARLY GUARD
    // ═══════════════════════════════════════════════════════════════

    var LOG = window.MainServerLogger;
    if (!LOG || typeof LOG !== 'object') {
        console.error('[BUG-HUNTER] FATAL: window.MainServerLogger not found at load time');
        console.error('[BUG-HUNTER] logger.js loaded but cannot find Logger to patch');
        return;
    }

    var _patchReport = {
        callbackError: false,
        trackEnvelope: false,
        handlerResultOverride: false,
        boxLineFailOverride: false,
        errorOverride: false,
        globalOnerror: false,
        globalRejection: false
    };

    // ═══════════════════════════════════════════════════════════════
    //  1. ENVELOPE RING BUFFER
    // ═══════════════════════════════════════════════════════════════

    var RING_SIZE = 10;
    var _ring = [];

    function trackEnvelope(route, envelope) {
        var parsed = null;
        try {
            if (typeof envelope.data === 'string' && envelope.data.length > 0)
                parsed = JSON.parse(envelope.data);
            else if (envelope.data && typeof envelope.data === 'object')
                parsed = envelope.data;
        } catch (e) { parsed = null; }
        _ring.push({ route: route, ts: Date.now(), envelope: envelope, parsed: parsed });
        while (_ring.length > RING_SIZE) _ring.shift();
    }

    function getLastEnvelope() {
        return _ring.length > 0 ? _ring[_ring.length - 1] : null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  2. DEEP RECURSIVE NULL SCANNER (tanpa asumsi / tanpa hardcoded list)
    // ═══════════════════════════════════════════════════════════════

    function deepScanNulls(data, maxDepth) {
        var results = [];
        var LIMIT = maxDepth || 6;

        function scan(obj, path, depth) {
            if (depth > LIMIT || obj === null || obj === undefined || typeof obj !== 'object') return;
            var isArr = Array.isArray(obj);
            var keys = isArr ? null : Object.keys(obj);
            var len = isArr ? obj.length : keys.length;
            for (var i = 0; i < len; i++) {
                var val = isArr ? obj[i] : obj[keys[i]];
                var childPath = isArr ? path + '[' + i + ']' : (path ? path + '.' + keys[i] : keys[i]);
                if (val === null) {
                    results.push({ path: childPath, value: 'null', parentPath: path || '(root)', parentType: isArr ? 'array' : 'object', siblings: len });
                } else if (val === undefined) {
                    results.push({ path: childPath, value: 'undefined', parentPath: path || '(root)', parentType: isArr ? 'array' : 'object', siblings: len });
                } else if (typeof val === 'object') {
                    scan(val, childPath, depth + 1);
                }
            }
        }

        scan(data, '', 0);
        return results;
    }

    // ═══════════════════════════════════════════════════════════════
    //  3. ERROR PATTERN MATCHER
    // ═══════════════════════════════════════════════════════════════

    function parseErrorPattern(msg) {
        if (!msg || typeof msg !== 'string') return null;
        var m = msg.match(/Cannot read properties of (null|undefined) \(reading '([^']+)'\)/);
        if (m) return { property: m[2], targetType: m[1], originalMessage: msg };
        m = msg.match(/Cannot read property '([^']+)' of (null|undefined)/);
        if (m) return { property: m[1], targetType: m[2], originalMessage: msg };
        return { property: null, targetType: 'unknown', originalMessage: msg };
    }

    // ═══════════════════════════════════════════════════════════════
    //  4. CROSS-REFERENCE: error property vs null fields
    // ═══════════════════════════════════════════════════════════════

    function crossReference(parsed, nulls, errInfo) {
        if (!nulls || nulls.length === 0 || !errInfo || !errInfo.property) {
            return { matchType: 'none', reason: 'No error property or no nulls' };
        }
        var prop = errInfo.property;
        var target = errInfo.targetType;
        var results = [];

        for (var i = 0; i < nulls.length; i++) {
            var n = nulls[i];
            if (n.value !== target) continue;
            var depth = (n.path.match(/\./g) || []).length + (n.path.match(/\[/g) || []).length;
            var score = 0;
            var reasons = [];
            if (depth <= 1) { score += 3; reasons.push('shallow depth(' + depth + ')'); }
            else if (depth <= 2) { score += 2; reasons.push('medium depth'); }
            else { score += 1; reasons.push('deep depth'); }
            if (n.parentType === 'object') { score += 2; reasons.push('null object'); }
            else if (n.parentType === 'array') { score += 1; reasons.push('null array element'); }

            if (parsed && n.parentPath && n.parentPath !== '(root)') {
                try {
                    var parts = n.parentPath.replace(/\[(\d+)\]/g, '.$1').split('.');
                    var parentObj = parsed;
                    for (var p = 0; p < parts.length; p++) {
                        if (parentObj === null || parentObj === undefined) break;
                        parentObj = parentObj[parts[p]];
                    }
                    if (parentObj && typeof parentObj === 'object') {
                        var siblings = Array.isArray(parentObj) ? parentObj : Object.values(parentObj);
                        for (var s = 0; s < Math.min(siblings.length, 5); s++) {
                            if (siblings[s] && typeof siblings[s] === 'object' && prop in siblings[s]) {
                                score += 3;
                                reasons.push('sibling has .' + prop);
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }
            results.push({ path: n.path, score: score, reasons: reasons });
        }

        results.sort(function (a, b) { return b.score - a.score; });
        if (results.length === 0) {
            return { matchType: 'none', reason: 'No ' + target + ' fields found' };
        }
        if (results[0].score >= 5) {
            return { matchType: 'HIGH', topMatch: results[0], allMatches: results, reason: results[0].path + ' is ' + target + ' -> client accesses .' + prop };
        }
        if (results[0].score >= 3) {
            return { matchType: 'MEDIUM', topMatch: results[0], allMatches: results, reason: 'Possible: ' + results[0].path };
        }
        return { matchType: 'LOW', topMatch: results[0], allMatches: results, reason: 'Weak match' };
    }

    // ═══════════════════════════════════════════════════════════════
    //  5. STACK TRACE ANALYZER
    // ═══════════════════════════════════════════════════════════════

    var KNOWN_FNS = {
        'saveUserData': 'Saves 100+ fields from enterGame response',
        'setUserInfo': 'Sets user._id, userName, level, etc.',
        'setBackpack': 'Iterates totalProps._items, accesses each item._id',
        'setSummon': 'Sets summon energy, wishList',
        'setOnHook': 'Sets hangup data',
        'setSign': 'Iterates imprint._items',
        'setEquip': 'Reads equip._suits, calls addToEquips',
        'setCounterpart': 'Sets dungeon._dungeons',
        'setMainTask': 'Calls setMianTask(e.curMainTask)',
        'setMianTask': 'Iterates e[n]._id, e[n]._state',
        'setSignInInfo': 'Accesses e._id',
        'loginSuccessCallBack': 'Entry point after login - calls saveUserData'
    };

    function analyzeStack(stack) {
        if (!stack || typeof stack !== 'string') return null;
        var lines = stack.split('\n');
        var result = { knownFn: null, mainMinLine: null, rawLines: lines };
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var mm = line.match(/main\.min.*?:(\d+):(\d+)/);
            if (mm && !result.mainMinLine) {
                result.mainMinLine = { line: parseInt(mm[1]), col: parseInt(mm[2]), text: line };
            }
            for (var fn in KNOWN_FNS) {
                if (KNOWN_FNS.hasOwnProperty(fn) && line.indexOf(fn) !== -1 && !result.knownFn) {
                    result.knownFn = { name: fn, desc: KNOWN_FNS[fn], text: line };
                }
            }
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    //  6. FORMATTER — output bug report ke console
    // ═══════════════════════════════════════════════════════════════

    function formatBugReport(opts) {
        var route = opts.route || '???';
        var err = opts.error;
        var envelope = opts.envelope;
        var parsedData = opts.parsedData;
        var source = opts.source || 'unknown';
        var errorTs = opts.timestamp || Date.now();
        var R = 'color:#EF5350;font-weight:bold;';
        var Y = 'color:#FFEB3B;font-weight:bold;';
        var D = 'color:#FFCDD2;font-size:11px;';
        var M = 'color:#90A4AE;font-size:11px;';
        var G = 'color:#66BB6A;font-weight:bold;';

        var errInfo = parseErrorPattern(
            (err && (err.message || err.reason)) ? (err.message || err.reason) : '(no info)'
        );
        var nulls = [];
        try {
            if (parsedData && typeof parsedData === 'object') {
                nulls = deepScanNulls(parsedData);
            }
        } catch (e) {
            nulls = [];
        }

        // v6 FIX: crossReference (NOT crossReferenceError!)
        var xref = null;
        try {
            if (parsedData && errInfo && errInfo.property) {
                xref = crossReference(parsedData, nulls, errInfo);
            }
        } catch (e) {
            xref = { matchType: 'error', reason: 'crossReference failed: ' + e.message };
        }

        var stackAnalysis = null;
        try {
            if (err && err.stack) {
                stackAnalysis = analyzeStack(err.stack);
            }
        } catch (e) {
            stackAnalysis = null;
        }

        // ═══ OUTPUT ═══
        console.log('');
        console.log('%c+======================================================+', R);
        console.log('%c|  BUG HUNTER v6  %c' + source.toUpperCase() + '%c  Route: %c' + route, R, Y, R, Y);
        console.log('%c+------------------------------------------------------+', R);

        // Error info
        console.log('%c|  Error:      %c' + ((err && err.name) || 'Error'), R, D);
        console.log('%c|  Message:    %c' + ((err && err.message) || String(err || '(no message)')), R, D);

        // Parsed pattern
        if (errInfo && errInfo.property) {
            console.log('%c|  Accessing:  %c.' + errInfo.property + '%c on %c' + errInfo.targetType, R, Y, R, D);
        }

        // Stack trace — THIS IS THE MOST IMPORTANT PART
        console.log('%c+------------------------------------------------------+', R);
        console.log('%c|  STACK TRACE:', R);
        if (stackAnalysis && stackAnalysis.knownFn) {
            console.log('%c|  >> %c' + stackAnalysis.knownFn.name + '%c - ' + stackAnalysis.knownFn.desc, R, Y, D);
            console.log('%c|     %c' + stackAnalysis.knownFn.text, R, D);
        }
        if (stackAnalysis && stackAnalysis.mainMinLine) {
            console.log('%c|  >> main.min.js: %cLine ' + stackAnalysis.mainMinLine.line + ':' + stackAnalysis.mainMinLine.col, R, Y);
        }
        if (err && err.stack) {
            var sLines = err.stack.split('\n');
            var shown = 0;
            for (var i = 0; i < sLines.length && shown < 10; i++) {
                var sl = sLines[i].trim();
                if (!sl) continue;
                shown++;
                var isMain = sl.indexOf('main.min') !== -1;
                console.log('%c|    ' + sl, R, isMain ? Y : M);
            }
        }
        if (!stackAnalysis && (!err || !err.stack)) {
            console.log('%c|  (no stack available - error was created via new Error(msg))', R, M);
        }

        // Envelope
        console.log('%c+------------------------------------------------------+', R);
        if (envelope) {
            console.log('%c|  Envelope:   ret=%c' + envelope.ret + '%c  data=%c' +
                (envelope.data ? (typeof envelope.data === 'string' ? envelope.data.length + ' chars' : typeof envelope.data) : '(empty)'),
                R, D, R, D);
        } else {
            console.log('%c|  Envelope:   %c(none - no recent dispatch)', R, M);
        }

        // NULL SCAN
        console.log('%c+------------------------------------------------------+', R);
        console.log('%c|  DEEP NULL SCAN (6 levels, no assumptions):', R);

        if (nulls.length === 0) {
            console.log('%c|  No null/undefined found in response', R);
        } else {
            var shallow = 0, deep = 0;
            for (var i = 0; i < nulls.length; i++) {
                var d = (nulls[i].path.match(/\./g) || []).length + (nulls[i].path.match(/\[/g) || []).length;
                if (d <= 2) shallow++; else deep++;
            }
            console.log('%c|  Total: %c' + nulls.length + '%c null/undefined (shallow: ' + shallow + ', deep: ' + deep + ')', R, Y, D);

            var showMax = Math.min(nulls.length, 30);
            for (var i = 0; i < showMax; i++) {
                var n = nulls[i];
                var indent = '';
                var d = (n.path.match(/\./g) || []).length + (n.path.match(/\[/g) || []).length;
                for (var j = 0; j < d; j++) indent += '  ';
                var clr = n.value === 'null' ? Y : 'color:#FFA726;';
                console.log('%c|  ' + indent + '%s %s %c= %s  [%s, %d siblings]',
                    R, clr, n.path, D, n.value.toUpperCase(), n.parentType, n.siblings);
            }
            if (nulls.length > 30) {
                console.log('%c|  ... + ' + (nulls.length - 30) + ' more', M);
            }
        }

        // CROSS-REFERENCE
        if (xref) {
            console.log('%c+------------------------------------------------------+', R);
            console.log('%c|  CROSS-REFERENCE (error property vs null fields):', R);
            if (xref.matchType === 'HIGH') {
                console.log('%c|  HIGH CONFIDENCE:', R);
                console.log('%c|    %c' + xref.topMatch.path + '%c - ' + xref.reason, R, Y, D);
                if (xref.topMatch.reasons) {
                    for (var r = 0; r < xref.topMatch.reasons.length; r++) {
                        console.log('%c|      reason: ' + xref.topMatch.reasons[r], D);
                    }
                }
            } else if (xref.matchType === 'MEDIUM') {
                console.log('%c|  MEDIUM CONFIDENCE:', R);
                console.log('%c|    %c' + xref.topMatch.path + '%c - ' + xref.reason, R, 'color:#FFA726;', D);
            } else {
                console.log('%c|  ' + (xref.matchType === 'error' ? 'CROSS-REF ERROR: ' : 'NO MATCH: ') + xref.reason, M);
            }
        }

        // Console access
        console.log('%c+------------------------------------------------------+', R);
        try {
            window.__BUG_DATA = parsedData;
            window.__BUG_NULLS = nulls;
            window.__BUG_XREF = xref;
            window.__BUG_STACK = stackAnalysis;
            window.__BUG_ERR = err;
            window.__BUG_ENVELOPE = envelope;
            window.__BUG_ROUTE = route;
            window.__BUG_TS = errorTs;
        } catch (e) {}
        console.log('%c|  Console access:', R);
        console.log('%c|    window.__BUG_DATA    - full response data', M);
        console.log('%c|    window.__BUG_NULLS   - null paths array', M);
        console.log('%c|    window.__BUG_STACK   - stack analysis', M);
        console.log('%c|    window.__BUG_ERR     - raw error object', M);

        // Top-level field summary
        if (parsedData) {
            try {
                var keys = Object.keys(parsedData);
                var line = '';
                for (var k = 0; k < keys.length; k++) {
                    var v = parsedData[keys[k]];
                    var t = v === null ? 'NULL' : v === undefined ? 'UNDEF' : Array.isArray(v) ? 'arr[' + v.length + ']' : typeof v;
                    var entry = keys[k] + ':' + t + '  ';
                    if (line.length + entry.length > 70) {
                        console.log('%c|  ' + line, M);
                        line = entry;
                    } else {
                        line += entry;
                    }
                }
                if (line) console.log('%c|  ' + line, M);
                console.log('%c|  (' + keys.length + ' top-level fields)', M);
            } catch (e) {}
        }

        // Ring buffer
        try {
            if (_ring.length > 1) {
                console.log('%c+------------------------------------------------------+', R);
                console.log('%c|  RECENT ENVELOPES:', R);
                for (var r = Math.max(0, _ring.length - 5); r < _ring.length; r++) {
                    var e = _ring[r];
                    var age = errorTs - e.ts;
                    var isLast = r === _ring.length - 1;
                    console.log('%c|  %c' + (isLast ? '>' : ' ') + ' ' + e.route + '  ret=' + e.envelope.ret + '  ' + age + 'ms ago' + (isLast ? '  << LAST' : ''),
                        R, isLast ? Y : M);
                }
            }
        } catch (e) {}

        console.log('%c+======================================================+', R);
        console.log('');
    }

    // ═══════════════════════════════════════════════════════════════
    //  7. CALLBACK ERROR HANDLER
    // ═══════════════════════════════════════════════════════════════

    function callbackError(route, err, envelope) {
        try {
            var parsedData = null;
            if (envelope && envelope.data) {
                try {
                    if (typeof envelope.data === 'string') parsedData = JSON.parse(envelope.data);
                    else if (envelope.data && typeof envelope.data === 'object') parsedData = envelope.data;
                } catch (e) { parsedData = null; }
            }
            formatBugReport({
                route: route, error: err, envelope: envelope, parsedData: parsedData,
                source: 'callback', timestamp: Date.now()
            });
        } catch (fatalErr) {
            // v6: If formatBugReport itself crashes, at least show SOMETHING
            console.error('[BUG-HUNTER] formatBugReport crashed: ' + fatalErr.message);
            console.error('[BUG-HUNTER] Original error was: ' + (err ? err.message || err : 'unknown'));
            console.error('[BUG-HUNTER] Route: ' + route);
            console.error('[BUG-HUNTER] Stack of formatBugReport crash:', fatalErr);
            // Still store data for manual inspection
            try {
                window.__BUG_CRASH = { originalErr: err, formatCrash: fatalErr, route: route, envelope: envelope };
            } catch (e) {}
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  8. GLOBAL ERROR HUNTER
    // ═══════════════════════════════════════════════════════════════

    var _lastErrorTs = 0;
    var DEDUP_MS = 3000;

    function installGlobalHunter() {
        // window.onerror — catches uncaught errors
        try {
            var orig = window.onerror;
            window.onerror = function (message, source, lineno, colno, error) {
                var now = Date.now();
                if (now - _lastErrorTs < DEDUP_MS) { if (orig) return orig.apply(this, arguments); return false; }
                _lastErrorTs = now;

                var lastEnv = getLastEnvelope();
                var envelope = lastEnv ? lastEnv.envelope : null;
                var parsedData = lastEnv ? lastEnv.parsedData : null;
                var route = lastEnv ? lastEnv.route : (source || 'global');

                if (lastEnv) {
                    var age = now - lastEnv.ts;
                    if (age > 5000) {
                        envelope = null; parsedData = null;
                        route = (source || 'global') + ' (stale, ' + age + 'ms after dispatch)';
                    } else {
                        route = lastEnv.route + ' (uncaught ' + age + 'ms after dispatch)';
                    }
                }

                var errObj = error || new Error(message || 'Unknown');
                errObj._isGlobal = true;
                formatBugReport({ route: route, error: errObj, envelope: envelope, parsedData: parsedData, source: 'window.onerror', timestamp: now });

                if (orig) return orig.apply(this, arguments);
                return false;
            };
            _patchReport.globalOnerror = true;
        } catch (e) {
            console.warn('[BUG-HUNTER] Failed to install window.onerror: ' + e.message);
        }

        // unhandledrejection — catches uncaught promise rejections
        try {
            if (typeof window.addEventListener === 'function') {
                window.addEventListener('unhandledrejection', function (event) {
                    var now = Date.now();
                    if (now - _lastErrorTs < DEDUP_MS) return;
                    _lastErrorTs = now;

                    var reason = event && event.reason;
                    var errObj = (reason instanceof Error) ? reason : new Error(String(reason));
                    if (!(reason instanceof Error)) errObj.name = 'UnhandledRejection';

                    var lastEnv = getLastEnvelope();
                    var envelope = lastEnv ? lastEnv.envelope : null;
                    var parsedData = lastEnv ? lastEnv.parsedData : null;
                    var route = lastEnv ? lastEnv.route : 'unknown';

                    if (lastEnv) {
                        var age = now - lastEnv.ts;
                        if (age > 5000) { envelope = null; parsedData = null; route = 'rejection (stale)'; }
                        else { route = lastEnv.route + ' (rejection ' + age + 'ms after)'; }
                    }

                    formatBugReport({ route: route, error: errObj, envelope: envelope, parsedData: parsedData, source: 'unhandledrejection', timestamp: now });
                });
                _patchReport.globalRejection = true;
            }
        } catch (e) {
            console.warn('[BUG-HUNTER] Failed to install unhandledrejection: ' + e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  9. APPLY PATCHES TO LOG OBJECT
    // ═══════════════════════════════════════════════════════════════
    //
    //  Strategy: MUTATE the existing Logger object (don't replace it).
    //  index.js does: var log = Logger; window.MainServerLogger = Logger;
    //  Since LOG === Logger === log, adding methods to LOG makes them
    //  available on log too.
    //

    // 9a. Add new methods
    try {
        LOG.callbackError = callbackError;
        _patchReport.callbackError = (typeof LOG.callbackError === 'function');

        LOG.trackEnvelope = trackEnvelope;
        _patchReport.trackEnvelope = (typeof LOG.trackEnvelope === 'function');

        LOG.getLastEnvelope = getLastEnvelope;
        LOG.deepScanNulls = deepScanNulls;
        LOG.parseErrorPattern = parseErrorPattern;
        LOG.analyzeStack = analyzeStack;
        LOG.formatBugReport = formatBugReport;
    } catch (e) {
        console.error('[BUG-HUNTER] Failed to add new methods: ' + e.message);
    }

    // 9b. Override handlerResult to auto-track envelope
    try {
        var _origHandlerResult = LOG.handlerResult;
        if (typeof _origHandlerResult === 'function') {
            LOG.handlerResult = function (opts) {
                if (opts && opts.envelope) {
                    trackEnvelope(opts.route || 'unknown', opts.envelope);
                }
                _origHandlerResult(opts);
            };
            _patchReport.handlerResultOverride = true;
        }
    } catch (e) {
        console.warn('[BUG-HUNTER] handlerResult override failed: ' + e.message);
    }

    // 9c. Override boxLineFail — intercept "callback error" -> full bug report
    //     CRITICAL: wrap in try-catch, fall back to original on failure
    try {
        var _origBoxLineFail = LOG.boxLineFail;
        if (typeof _origBoxLineFail === 'function') {
            LOG.boxLineFail = function (msg) {
                if (msg && typeof msg === 'string' && msg.indexOf('callback error') !== -1) {
                    try {
                        var errMsg = msg.replace(/^callback error:\s*/, '');
                        var fakeErr = new Error(errMsg);
                        fakeErr.name = 'CallbackError';
                        var lastEnv = getLastEnvelope();
                        callbackError(lastEnv ? lastEnv.route : 'unknown', fakeErr, lastEnv ? lastEnv.envelope : null);
                        return; // escalation success — don't call original
                    } catch (escalationErr) {
                        // v6: If escalation crashes, fall back to original
                        console.error('[BUG-HUNTER] boxLineFail escalation crashed: ' + escalationErr.message);
                        // DON'T return — fall through to original
                    }
                }
                _origBoxLineFail(msg);
            };
            _patchReport.boxLineFailOverride = true;
        } else {
            console.warn('[BUG-HUNTER] LOG.boxLineFail is not a function — cannot override');
        }
    } catch (e) {
        console.error('[BUG-HUNTER] boxLineFail override setup failed: ' + e.message);
    }

    // 9d. Override error — intercept "Callback error for" -> full bug report
    try {
        var _origError = LOG.error;
        if (typeof _origError === 'function') {
            LOG.error = function (ctx, msg) {
                if (msg && typeof msg === 'string' && msg.indexOf('Callback error for') !== -1) {
                    try {
                        var match = msg.match(/Callback error for (\S+): (.+)/);
                        if (match) {
                            var fakeErr = new Error(match[2]);
                            fakeErr.name = 'CallbackError';
                            var lastEnv = getLastEnvelope();
                            callbackError(match[1], fakeErr, lastEnv ? lastEnv.envelope : null);
                            return;
                        }
                    } catch (escalationErr) {
                        console.error('[BUG-HUNTER] error override escalation crashed: ' + escalationErr.message);
                    }
                }
                _origError(ctx, msg);
            };
            _patchReport.errorOverride = true;
        }
    } catch (e) {
        console.error('[BUG-HUNTER] error override setup failed: ' + e.message);
    }

    // 9e. Install global hunter
    installGlobalHunter();

    // ═══════════════════════════════════════════════════════════════
    //  10. LOAD-TIME VERIFICATION
    // ═══════════════════════════════════════════════════════════════

    var allOk = _patchReport.callbackError && _patchReport.trackEnvelope &&
                _patchReport.boxLineFailOverride && _patchReport.handlerResultOverride;

    if (allOk) {
        console.log('%c[BUG-HUNTER] v6 READY - all patches applied', 'color:#66BB6A;font-weight:bold;font-size:14px;');
    } else {
        console.warn('[BUG-HUNTER] v6 PARTIAL - some patches failed:');
        for (var k in _patchReport) {
            if (_patchReport.hasOwnProperty(k) && !_patchReport[k]) {
                console.warn('  MISSING: ' + k);
            }
        }
    }

    // Verify that log variable (used by index.js) can access our patches
    try {
        if (window.MainServerLogger && typeof window.MainServerLogger.callbackError === 'function') {
            window.__BUG_HUNTER_READY = true;
            window.__BUG_HUNTER_PATCHES = _patchReport;
        } else {
            window.__BUG_HUNTER_READY = false;
            console.error('[BUG-HUNTER] VERIFICATION FAILED: window.MainServerLogger.callbackError is not a function!');
            console.error('[BUG-HUNTER] This means the patch was added but may have been overwritten,');
            console.error('[BUG-HUNTER] or LOG is a different object than expected.');
        }
    } catch (e) {
        console.error('[BUG-HUNTER] Verification threw: ' + e.message);
    }

})();