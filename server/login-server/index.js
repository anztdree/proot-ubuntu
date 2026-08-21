/**
 * index.js — Login Server Entry Point
 * Super Warrior Z — LOGIN SERVER
 *
 * Titik masuk tunggal. Berisi:
 *   1. Logger (inline, self-contained)
 *   2. Config
 *   3. Action loader (actions/*.js)
 *   4. Router/Dispatcher
 *   5. LoginSocket class (verifyEnable=false)
 *   6. io.connect() override
 *   7. getLoginServer() override
 *
 * Semua infrastructure di sini. Actions di folder actions/.
 * TIDAK menyentuh file main-server.
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    // PRE-LOG (sebelum logger siap, pakai console.log biasa + CSS)
    // ═══════════════════════════════════════════════════════════════════
    function preLog(msg) {
        console.log('%c[LOGIN-SERVER] ' + msg, 'color:#00897B;');
    }

    function preError(msg) {
        console.log('%c[LOGIN-SERVER] ' + msg, 'color:#F44336;');
    }

    // ═══════════════════════════════════════════════════════
    // AUTO-DETECT BASE PATH
    // ═══════════════════════════════════════════════════════════════════
    var basePath = (function () {
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (src.indexOf('login-server/index.js') !== -1) {
                return src.replace('index.js', '');
            }
        }
        return './server/login-server/';
    })();



    // ═══════════════════════════════════════════════════════════════════
    // 1. LOGGER
    // ═══════════════════════════════════════════════════════════════════
    var LoginServerLogger = (function () {
        var SERVER_TAG = '[LOGIN-SERVER]';
        var LEVEL_KEY = 'LOGIN_SERVER_LOG_LEVEL';
        var PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 99 };

        var currentLevel = (function () {
            try { return localStorage.getItem(LEVEL_KEY) || 'DEBUG'; }
            catch (e) { return 'DEBUG'; }
        })();
        var minPriority = PRIORITY[currentLevel] !== undefined ? PRIORITY[currentLevel] : 0;

        function shouldLog(level) {
            var p = PRIORITY[level];
            return p !== undefined && p >= minPriority;
        }

        function ts() {
            var d = new Date();
            var h = String(d.getHours()).padStart(2, '0');
            var m = String(d.getMinutes()).padStart(2, '0');
            var s = String(d.getSeconds()).padStart(2, '0');
            var ms = String(d.getMilliseconds()).padStart(3, '0');
            return h + ':' + m + ':' + s + '.' + ms;
        }

        // Level colors
        var COLORS = {
            INFO:  '#2196F3',
            WARN:  '#FF9800',
            ERROR: '#F44336',
            DEBUG: '#78909C'
        };

        // Emoji per context (bukan per level)
        var CTX_EMOJI = {
            startup:   '\uD83D\uDCC2',
            connection:'\uD83D\uDD0C',
            network:   '\uD83C\uDF10',
            handler:   '\uD83D\uDD00',
            emit:      '\uD83D\uDCE8',
            request:   '\uD83D\uDCE5',
            api:       '\uD83D\uDCE1',
            response:  '\uD83D\uDCE4',
            environment:'\uD83D\uDCE6',
            fallback:  '\uD83D\uDEE1\uFE0F',
            timer:     '\u23F3',
            config:    '\u2699\uFE0F',
            delay:     '\u23F1\uFE0F',
            token:     '\uD83D\uDD11',
            storage:   '\uD83D\uDCBE',
            action:    '\uD83C\uDFAF',
            success:   '\u2705',
            fail:      '\u274C',
            warning:   '\u26A0\uFE0F',
            hint:      '\uD83D\uDCA1',
            link:      '\uD83D\uDD17',
            data:      '\uD83D\uDCCA',
            id:        '\uD83C\uDD94',
            event:     '\uD83D\uDCE1',
            loader:    '\uD83D\uDCC2',
            registry:  '\uD83D\uDCCB',
            poll:      '\u23F3'
        };

        // ═══════════════════════════════════════════════════════════════
        // Emit functions
        // ═══════════════════════════════════════════════════════════════

        /**
         * @param {string} level   — INFO, WARN, ERROR, DEBUG
         * @param {string} context — BOOT, SOCK, ROUTE, API, ENV, dll
         * @param {string} emoji   — emoji override (opsional, pakai CTX_EMOJI[context] jika kosong)
         * @param {string} message — pesan utama
         */
        // Case-insensitive context lookup (supports both new camelCase and legacy UPPERCASE)
        function _ctxEmoji(ctx) {
            var c = ctx || '';
            if (CTX_EMOJI[c]) return CTX_EMOJI[c];
            return CTX_EMOJI[c.toUpperCase()] || '\u26AA';
        }

        // Display name mapping: transforms old UPPERCASE to natural camelCase for log output
        var DISPLAY_NAME = {
            'BOOT': 'startup', 'SOCK': 'connection', 'IO': 'network',
            'ROUTE': 'handler', 'LOAD': 'loader', 'REQ': 'request',
            'RESP': 'response', 'ENV': 'environment', 'API': 'api',
            'TEA': 'encryption', 'NTFY': 'notification', 'NOTIFY': 'notification',
            'CB': 'callback', 'DB': 'database', 'META': 'storage',
            'REG': 'register', 'MSG': 'message', 'WARN_EMOJI': 'warning'
        };

        function _displayName(ctx) {
            var upper = (ctx || '').toUpperCase();
            return DISPLAY_NAME[upper] || ctx;
        }

        function emit(level, context, emoji, message) {
            if (!shouldLog(level)) return;
            var em = emoji || _ctxEmoji(context);
            var display = _displayName(context);
            var color = COLORS[level] || '#78909C';
            var pad = (display + '          ').slice(0, 10);
            console.log(
                '%c' + em + ' ' + ts() + ' %c' + SERVER_TAG + ' %c' + pad + '\u25b8 ' + message,
                'color:#616161;',
                'color:#00897B;',
                'color:' + color + ';'
            );
        }

        // info(context, message) — default emoji dari CTX_EMOJI
        function info(context, message) {
            emit('INFO', context, null, message);
        }

        function warn(context, message) {
            emit('WARN', context, null, message);
        }

        function error(context, message) {
            emit('ERROR', context, null, message);
        }

        function debug(context, message) {
            emit('DEBUG', context, null, message);
        }

        // ═══════════════════════════════════════════════════════════════
        // Detail lines — pakai ├ └ box drawing
        // ═══════════════════════════════════════════════════════════════

        var DETAIL_COLOR = 'color:#004D40;opacity:0.85;padding-left:8px;';

        function detailLine(connector, emoji, key, value) {
            if (!shouldLog('DEBUG')) return;
            console.log(
                '%c  ' + connector + ' ' + emoji + ' ' + key + ' : ' + value,
                DETAIL_COLOR
            );
        }

        function detail(key, value) {
            var em = CTX_EMOJI[key] || CTX_EMOJI[value] || '\uD83D\uDCCB';
            detailLine('\u2514', em, key, value);
        }

        function openDetail(key, value) {
            var em = CTX_EMOJI[key] || CTX_EMOJI[value] || '\uD83D\uDCCB';
            detailLine('\u251C', em, key, value);
        }

        function details(pairs) {
            if (!shouldLog('DEBUG')) return;
            for (var i = 0; i < pairs.length; i++) {
                var key = pairs[i][0];
                var val = pairs[i][1];
                var em = CTX_EMOJI[key] || CTX_EMOJI[val] || '\uD83D\uDCCB';
                var conn = i < pairs.length - 1 ? '\u251C' : '\u2514';
                detailLine(conn, em, key, val);
            }
        }

        /**
         * table(title, data) — console.table native
         */
        function table(title, data) {
            if (!shouldLog('DEBUG')) return;
            console.log('%c  \uD83D\uDCCB ' + title, DETAIL_COLOR);
            console.table(data);
        }

        // ═══════════════════════════════════════════════════════════════
        // Always-visible (tidak terpengaruh logLevel)
        // ═══════════════════════════════════════════════════════════════

        var ALWAYS_COLOR = 'color:#616161;padding-left:8px;';

        function alwaysLine(connector, emoji, key, value) {
            console.log(
                '%c  ' + connector + ' ' + emoji + ' ' + key + ' : ' + value,
                ALWAYS_COLOR
            );
        }

        function alwaysDetails(pairs) {
            for (var i = 0; i < pairs.length; i++) {
                var key = pairs[i][0];
                var val = pairs[i][1];
                var em = CTX_EMOJI[key] || CTX_EMOJI[val] || '\uD83D\uDCCB';
                var conn = i < pairs.length - 1 ? '\u251C' : '\u2514';
                alwaysLine(conn, em, key, val);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // setLevel
        // ═══════════════════════════════════════════════════════════════

        function setLevel(level) {
            var p = PRIORITY[level];
            if (p !== undefined) {
                currentLevel = level;
                minPriority = p;
                try { localStorage.setItem(LEVEL_KEY, level); } catch (e) {}
                console.log('%c' + SERVER_TAG + ' Log level \u2192 ' + level, 'color:#00897B;');
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // Export
        // ═══════════════════════════════════════════════════════════════

        return {
            info: info,
            warn: warn,
            error: error,
            debug: debug,
            detail: detail,
            openDetail: openDetail,
            details: details,
            table: table,
            alwaysDetails: alwaysDetails,
            level: currentLevel,
            setLevel: setLevel
        };
    })();

    window.LoginServerLogger = LoginServerLogger;

    // ═══════════════════════════════════════════════════════════════════
    // 2. CONFIG
    // ═══════════════════════════════════════════════════════════════════
    var log = LoginServerLogger;

    var LoginServer = {
        config: {
            loginServerUrl: 'http://127.0.0.1:8000',
            mainServerUrl: 'http://127.0.0.1:8001',
            chatServerUrl: 'http://127.0.0.1:8002',
            dungeonServerUrl: 'http://127.0.0.1:8003',
            delayMin:      30,
            delayMax:      120,
            loginTokenLength: 64,
            verifyEnable:  false
        },
        handlers: {},
        _handlerNames: [],
        _handlerCount: 0,
        log: log
    };

    // ═══════════════════════════════════════════════════════════════════
    // INDEXEDDB HELPER
    // ═══════════════════════════════════════════════════════════════════
    // Database: login-server
    // Store: loginInfo (keyPath: userId)
    //
    // Record types:
    //   User   — userId = "player1" (data login user)
    //   System — userId = "__config__" (servers, notices)

    var DB_NAME = 'login-server';
    var DB_VERSION = 2;
    var STORE_NAME = 'loginInfo';
    var _idb = null;

    function openDB() {
        return new Promise(function (ok, fail) {
            if (_idb) { ok(_idb); return; }
            var r = indexedDB.open(DB_NAME, DB_VERSION);
            r.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
                }
            };
            r.onsuccess = function (e) {
                _idb = e.target.result;
                ok(_idb);
            };
            r.onerror = function (e) {
                log.error('STORAGE', 'IndexedDB open FAILED: ' + DB_NAME);
                fail(e);
            };
        });
    }

    function idbGet(key) {
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var req = tx.objectStore(STORE_NAME).get(key);
                req.onsuccess = function () { ok(req.result || null); };
                req.onerror = function () { fail(req.error); };
            });
        });
    }

    function idbPut(data) {
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var req = tx.objectStore(STORE_NAME).put(data);
                req.onsuccess = function () { ok(data); };
                req.onerror = function () { fail(req.error); };
            });
        });
    }

    function seedConfig() {
        var defaultConfig = {
            userId: '__config__',
            servers: [
                {
                    serverId: '1',
                    name: 'Local 1',
                    url: LoginServer.config.mainServerUrl,
                    chaturl: LoginServer.config.chatServerUrl,
                    dungeonurl: LoginServer.config.dungeonServerUrl,
                    online: true,
                    hot: false,
                    'new': true,
                    sortOrder: 1
                }
            ],
            notices: [
                {
                    title: { en: 'Welcome', cn: '\u6b22\u8fce' },
                    text: { en: 'Welcome to Super Warrior Z!', cn: '\u6b22\u8fce\u6765\u5230\u8d85\u7ea7\u6218\u58ebZ\uff01' },
                    version: '1.0',
                    orderNo: 1,
                    alwaysPopup: false
                }
            ]
        };

        return idbGet('__config__').then(function (existing) {
            if (existing) {
                return existing;
            }
            return idbPut(defaultConfig).then(function () { return defaultConfig; });
        });
    }

    LoginServer.db = {
        open: openDB,
        get: idbGet,
        put: idbPut,
        seedConfig: seedConfig
    };

    // ═══════════════════════════════════════════════════════════════════
    // HELPERS (pure infra)
    // ═══════════════════════════════════════════════════════════════════

    LoginServer.randomDelay = function () {
        return Math.floor(Math.random() * (LoginServer.config.delayMax - LoginServer.config.delayMin + 1)) + LoginServer.config.delayMin;
    };

    LoginServer.generateToken = function (length) {
        var chars = 'abcdef0123456789';
        var token = '';
        var len = length || LoginServer.config.loginTokenLength;
        for (var i = 0; i < len; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    };

    LoginServer.nowSeconds = function () {
        return Math.floor(Date.now() / 1000);
    };

    /**
     * buildEnvelope(responseData, retCode) — Build response envelope
     *
     * Evidence: main.min.js L113902-113905
     *   0 === e.ret  → sukses
     *   e.data        → JSON.stringify(responseData)
     *   e.compress    → false
     *   e.serverTime  → unix timestamp (seconds)
     *   e.server0Time → timezone offset (ms)
     */
    LoginServer.buildEnvelope = function (responseData, retCode) {
        var ret = (typeof retCode === 'number' && retCode !== 0) ? retCode : 0;
        var dataStr;
        try {
            dataStr = JSON.stringify(responseData !== undefined && responseData !== null ? responseData : {});
        } catch (e) {
            dataStr = '{}';
        }

        return {
            ret: ret,
            data: dataStr,
            compress: false,
            serverTime: LoginServer.nowSeconds(),
            server0Time: Math.abs(new Date().getTimezoneOffset()) * 60 * 1000
        };
    };

    window.LoginServer = LoginServer;

    // ═══════════════════════════════════════════════════════════════════
    // 3. LOAD ACTIONS (actions/*.js)
    // ═══════════════════════════════════════════════════════════════════
    var actionFiles = [
        'actions/loginGame.js',
        'actions/getServerList.js',
        'actions/saveHistory.js',
        'actions/loginAnnounce.js',
        'actions/saveUserEnterInfo.js',
        'actions/saveLanguage.js'
    ];
    var loadedCount = 0;
    var loadStart = Date.now();
    var _criticalError = false;
    var loadResults = [];

    function loadNextAction() {
        if (_criticalError) return;

        if (loadedCount >= actionFiles.length) {
            var totalLoadTime = Date.now() - loadStart;
            var bootOk = loadResults.every(function (r) { return r.status.indexOf('OK') !== -1; });
            var now = new Date();
            var hh = String(now.getHours()).padStart(2, '0');
            var mm = String(now.getMinutes()).padStart(2, '0');
            var mark = bootOk ? '\u2705' : '\u274c';
            // ── Boot: judul + summary selalu terlihat, detail tabel di collapsed group ──
            console.log(
                '\uD83D\uDCC2 %c' + hh + ':' + mm + ' %c[LOGIN-SERVER] %cBOOT \u25b8 ' + mark + ' Ready',
                'color:#616161;',
                'color:#00897B;',
                'color:#2196F3;'
            );
            var SC = 'color:#004D40;opacity:0.85;';
            console.log('%c  \u00b7 \uD83D\uDCE6 ' + actionFiles.length + ' actions', SC);
            console.log('%c  \u00b7 \u23f1\uFE0F ' + totalLoadTime + 'ms', SC);
            console.log('%c  \u00b7 \uD83D\uDCBE ' + DB_NAME, SC);
            console.log('%c  \u00b7 \uD83D\uDCCB ' + LoginServer._handlerNames.length + ' handlers', SC);
            console.log('%c  \u00b7 \uD83D\uDD17 ' + LoginServer.config.loginServerUrl, SC);

            // ── Detail tabel (collapsed) ──
            console.groupCollapsed('%c  \u2022 Load Details', 'color:#004D40;opacity:0.7;');
            console.table(loadResults);
            console.log('%c  \u254c\u2500\u2500\u2500 \u2699\uFE0F CONFIG \u2500\u2500\u2500', 'color:#004D40;opacity:0.6;');

            var configRows = [];
            var cfg = LoginServer.config;
            configRows.push({ key: 'loginServerUrl', value: cfg.loginServerUrl });
            configRows.push({ key: 'mainServerUrl', value: cfg.mainServerUrl });
            configRows.push({ key: 'chatServerUrl', value: cfg.chatServerUrl });
            configRows.push({ key: 'dungeonServerUrl', value: cfg.dungeonServerUrl });
            configRows.push({ key: 'delayMin', value: String(cfg.delayMin) + 'ms' });
            configRows.push({ key: 'delayMax', value: String(cfg.delayMax) + 'ms' });
            configRows.push({ key: 'loginTokenLength', value: String(cfg.loginTokenLength) });
            configRows.push({ key: 'verifyEnable', value: String(cfg.verifyEnable) });
            console.table(configRows);
            console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCCB HANDLERS \u2500\u2500\u2500', 'color:#004D40;opacity:0.6;');

            var handlerRows = [];
            for (var hi = 0; hi < LoginServer._handlerNames.length; hi++) {
                handlerRows.push({ index: '[' + hi + ']', action: LoginServer._handlerNames[hi], status: '\u2705' });
            }
            if (handlerRows.length > 0) {
                console.table(handlerRows);
            }
            console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCBE STORAGE \u2500\u2500\u2500', 'color:#004D40;opacity:0.6;');
            console.log('%c  DB: ' + DB_NAME + ' | Store: ' + STORE_NAME + ' | basePath: ' + basePath, 'color:#004D40;opacity:0.7;');
            console.groupEnd();

            init();
            return;
        }

        var fileName = actionFiles[loadedCount];
        var filePath = basePath + fileName;
        var fileStart = Date.now();

        var script = document.createElement('script');
        script.src = filePath;
        script.async = false;

        script.onload = function () {
            var fileTime = Date.now() - fileStart;
            loadResults.push({ file: fileName, status: '\u2705 OK', loadTime: fileTime + 'ms' });
            script.parentNode.removeChild(script);
            loadedCount++;
            loadNextAction();
        };

        script.onerror = function () {
            _criticalError = true;
            log.error('loader', 'CRITICAL: Failed to load ' + fileName);
            log.alwaysDetails([
                ['url', filePath],
                ['basePath', basePath],
                ['loadedSoFar', '[' + actionFiles.slice(0, loadedCount).join(', ') + ']'],
                ['hint', 'Check file exists in ' + basePath]
            ]);
            loadResults.push({ file: fileName, status: '\u274c FAILED', loadTime: 'N/A' });
        };

        (document.head || document.documentElement).appendChild(script);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4. ROUTER / DISPATCHER
    // ═══════════════════════════════════════════════════════════════════

    var _routeStats = {
        totalRouted: 0,
        totalUnknown: 0,
        totalNoAction: 0,
        totalErrors: 0,
        lastAction: null
    };

    /**
     * dispatch(request, callback) — Route ke handler berdasarkan request.action
     *
     * Evidence: main.min.js L113900-113917 processHandlerWithLogin
     *   callback signature: callback(envelope)
     *   envelope = { ret, data (JSON string), compress, serverTime, server0Time }
     *
     * Handler signature: handler(request, callback)
     *   callback(responseData, retCode) — retCode optional, default 0 (sukses)
     */
    function dispatch(request, callback) {
        var action = request.action || '';
        _routeStats.totalRouted++;
        _routeStats.lastAction = action;

        if (!action) {
            _routeStats.totalNoAction++;
            log.error('handler', 'No action field in request!');
            log.alwaysDetails([
                ['requestKeys', Object.keys(request || {}).join(', ')],
                ['requestDump', JSON.stringify(request || {}).substring(0, 300)],
                ['retCode', '1 (no_action)']
            ]);
            callback(LoginServer.buildEnvelope({ error: 'no_action' }, 1));
            return;
        }

        var handler = LoginServer.handlers[action];

        if (typeof handler === 'function') {
            try {
                handler(request, callback);
            } catch (handlerErr) {
                _routeStats.totalErrors++;
                log.error('handler', 'Handler "' + action + '" threw UNCAUGHT ERROR');
                log.alwaysDetails([
                    ['action', action],
                    ['errorName', handlerErr.name || '(unknown)'],
                    ['errorMessage', handlerErr.message || String(handlerErr)],
                    ['retCode', '1 (handler_exception)']
                ]);
                callback(LoginServer.buildEnvelope({ error: 'handler_exception', action: action }, 1));
            }
        } else {
            _routeStats.totalUnknown++;
            log.error('handler', 'Unknown action: "' + action + '"');
            log.alwaysDetails([
                ['requested', action],
                ['totalUnknown', String(_routeStats.totalUnknown)],
                ['retCode', '1 (unknown_action)']
            ]);
            log.details([
                ['availableHandlers', '[' + LoginServer._handlerNames.join(', ') + ']'],
                ['totalHandlers', String(LoginServer._handlerNames.length)]
            ]);
            callback(LoginServer.buildEnvelope({ error: 'unknown_action', action: action }, 1));
        }
    }

    LoginServer.router = {
        dispatch: dispatch,
        getStats: function () { return _routeStats; }
    };

    // ═══════════════════════════════════════════════════════════════════
    // 5. LOGINSOCKET CLASS
    // ═══════════════════════════════════════════════════════════════════
    //
    // Evidence:
    //   main.min.js L82535: connectWithSocket(url, callback, errorCallback)
    //   main.min.js L82537: io.connect(url, { reconnectionAttempts: 10 })
    //   main.min.js L82539: verifyEnable ? socketOnVerify(callback) : callback()
    //   Login-server: verifyEnable = FALSE → callback langsung setelah connect
    //
    //   main.min.js L82528: sendToServer(data, callback) → socket.emit('handler.process', data, callback)
    //   main.min.js L82522: socket.on('Notify', handler) — login-server TIDAK pakai Notify

    var _socketCounter = 0;

    function LoginSocket() {
        _socketCounter++;
        this.id = 'login-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
        this._counter = _socketCounter;
        this.connected = false;
        this.disconnected = false;
        this._listeners = {};
        this._emitCount = 0;

        var self = this;
        var delay = LoginServer.randomDelay();

        log.info('connection', 'LoginSocket #' + this._counter + ' connecting...');

        setTimeout(function () {
            if (self.disconnected) {
                log.warn('connection', 'LoginSocket #' + self._counter + ' disconnected BEFORE connect completed');
                return;
            }
            self.connected = true;
            self._fire('connect');

            // ── Socket: judul + summary selalu terlihat, detail tabel di collapsed group ──
            var listenerNames = Object.keys(self._listeners);
            var sockNow = new Date();
            var sockHH = String(sockNow.getHours()).padStart(2, '0');
            var sockMM = String(sockNow.getMinutes()).padStart(2, '0');
            var verifyLabel = LoginServer.config.verifyEnable ? 'on' : 'off';
            console.log(
                '\uD83D\uDD0C %c' + sockHH + ':' + sockMM + ' %c[LOGIN-SERVER] %cSOCK \u25b8 Socket #' + self._counter + ' \u2705 CONNECTED',
                'color:#616161;',
                'color:#00897B;',
                'color:#4CAF50;'
            );
            var SC = 'color:#004D40;opacity:0.85;';
            console.log('%c  \u00b7 \u23f1\uFE0F ' + delay + 'ms', SC);
            console.log('%c  \u00b7 \uD83C\uDD94 ' + self.id, SC);
            console.log('%c  \u00b7 \uD83D\uDD12 verify: ' + verifyLabel, SC);
            console.log('%c  \u00b7 \uD83D\uDD0A ' + listenerNames.length + ' listeners', SC);

            // ── Detail tabel (collapsed) ──
            console.groupCollapsed('%c  \u2022 Socket Details', 'color:#004D40;opacity:0.7;');
            var socketRows = [
                { key: 'socketId', value: self.id },
                { key: 'target', value: LoginServer.config.loginServerUrl },
                { key: 'verifyEnable', value: String(LoginServer.config.verifyEnable) },
                { key: 'delay', value: delay + 'ms' },
                { key: 'emitCount', value: String(self._emitCount) }
            ];
            console.table(socketRows);
            if (listenerNames.length > 0) {
                console.log('%c  listeners: ' + listenerNames.join(', '), 'color:#004D40;opacity:0.85;');
            }
            console.groupEnd();
        }, delay);
    }

    LoginSocket.prototype.on = function (event, handler) {
        if (typeof handler !== 'function') {
            log.error('connection', 'on() called with non-function handler');
            log.alwaysDetails([
                ['event', event],
                ['handlerType', typeof handler],
                ['socketId', this.id]
            ]);
            return;
        }
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(handler);
    };

    LoginSocket.prototype.off = function (event, handler) {
        if (!this._listeners[event]) {
            log.debug('connection', 'off() \u2014 no listeners for "' + event + '" on socket #' + this._counter);
            return;
        }
        if (handler) {
            var list = this._listeners[event];
            var before = list.length;
            for (var i = list.length - 1; i >= 0; i--) {
                if (list[i] === handler) list.splice(i, 1);
            }
            log.debug('connection', 'off() \u2014 removed ' + (before - list.length) + ' listener(s) from "' + event + '" on socket #' + this._counter);
        } else {
            var count = this._listeners[event].length;
            delete this._listeners[event];
            log.debug('connection', 'off() \u2014 removed ALL ' + count + ' listener(s) from "' + event + '" on socket #' + this._counter);
        }
    };

    LoginSocket.prototype.emit = function (event, data, callback) {
        this._emitCount++;
        var emitNum = this._emitCount;
        var actionName = (data && data.action) ? data.action : (event || 'unknown');
        var typeName = (data && data.type) ? data.type : '-';
        var emitStartTime = Date.now();

        // ── handler.process — action routing ──
        if (event === 'handler.process') {
            var self = this;
            var delay = LoginServer.randomDelay();

            setTimeout(function () {
                if (!self.connected) {
                    log.error('EMIT', 'emit #' + emitNum + ' FAILED \u2014 socket disconnected');
                    log.alwaysDetails([
                        ['action', actionName],
                        ['socketId', self.id],
                        ['hint', 'Client may hang waiting for response']
                    ]);
                    return;
                }

                // Socket.IO serialization simulation
                if (data === null || data === undefined || typeof data === 'function') {
                    data = {};
                }

                if (!data || typeof data !== 'object') {
                    log.error('EMIT', 'emit #' + emitNum + ' \u2014 invalid data');
                    log.alwaysDetails([
                        ['dataType', typeof data],
                        ['action', actionName],
                        ['socketId', self.id]
                    ]);
                    return;
                }

                // Auto-route empty-action → LoginAnnounce
                if (!data.action) {
                    data.action = 'LoginAnnounce';
                }

                var routeStart = Date.now();

                // ── Action: judul + summary selalu terlihat, detail req/res di collapsed group ──
                var reqKeys = Object.keys(data);
                var fieldCount = reqKeys.length;
                var emitNow = new Date();
                var emitHH = String(emitNow.getHours()).padStart(2, '0');
                var emitMM = String(emitNow.getMinutes()).padStart(2, '0');
                console.log(
                    '\u2699\uFE0F %c' + emitHH + ':' + emitMM + ' %c[LOGIN-SERVER] %cEMIT \u25b8 ' + actionName,
                    'color:#616161;',
                    'color:#00897B;',
                    'color:#FF9800;'
                );
                var SC = 'color:#004D40;opacity:0.85;';
                console.log('%c  \u00b7 \uD83D\uDCE4 emit #' + emitNum, SC);
                console.log('%c  \u00b7 \uD83C\uDFF7\uFE0F ' + typeName, SC);
                console.log('%c  \u00b7 \uD83D\uDCCA ' + fieldCount + ' fields', SC);

                // ── Detail req/res (collapsed) ──
                console.groupCollapsed('%c  \u2022 Request / Response', 'color:#004D40;opacity:0.7;');

                // Request fields
                var reqPairs = [];
                for (var k = 0; k < reqKeys.length; k++) {
                    var rk = reqKeys[k];
                    var rv = String(data[rk]);
                    if (rv.length > 120) rv = rv.substring(0, 120) + '... (' + String(data[rk]).length + ' chars)';
                    reqPairs.push([rk, rv]);
                }
                console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCE5 REQUEST \u2500\u2500\u2500', 'color:#004D40;opacity:0.6;');
                log.details(reqPairs);

                LoginServer.router.dispatch(data, function (responseData, retCode) {
                    var routeDuration = Date.now() - routeStart;
                    var totalDuration = Date.now() - emitStartTime;

                    var envelope = LoginServer.buildEnvelope(responseData, retCode);

                    // Response details
                    console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCE4 RESPONSE \u2500\u2500\u2500', 'color:#004D40;opacity:0.6;');
                    log.details([
                        ['\uD83D\uDD00 dispatched', 'actions/' + actionName + '.js'],
                        ['\uD83D\uDCE4 ret', String(envelope.ret)],
                        ['\uD83D\uDCE4 data', envelope.data.substring(0, 300) + (envelope.data.length > 300 ? '... (' + envelope.data.length + ' chars)' : '')],
                        ['\uD83D\uDCE4 compress', String(envelope.compress)],
                        ['\uD83D\UDCCA serverTime', String(envelope.serverTime)],
                        ['\u23F1\uFE0F routeTime', routeDuration + 'ms'],
                        ['\u23F1\uFE0F scheduleDelay', delay + 'ms'],
                        ['\u23F1\uFE0F total', totalDuration + 'ms']
                    ]);

                    console.groupEnd(); // end req/res detail group

                    if (typeof callback === 'function') {
                        try {
                            callback(envelope);
                        } catch (cbErr) {
                            log.error('environment', 'emit #' + emitNum + ' callback THREW ERROR');
                            log.alwaysDetails([
                                ['errorName', cbErr.name || '(unknown)'],
                                ['errorMessage', cbErr.message || String(cbErr)]
                            ]);
                        }
                    } else {
                        log.error('environment', 'emit #' + emitNum + ' \u2014 NO CALLBACK PROVIDED');
                        log.alwaysDetails([
                            ['action', actionName],
                            ['hint', 'Game may hang waiting for response']
                        ]);
                    }
                });
            }, delay);
            return;
        }

        // ── Unknown event ──
        log.warn('EMIT', 'emit #' + emitNum + ' \u2014 unhandled event: "' + event + '"');
        log.alwaysDetails([
            ['event', event],
            ['action', actionName],
            ['expected', 'handler.process'],
            ['socketId', this.id]
        ]);
    };

    LoginSocket.prototype.disconnect = function () {
        var hadListeners = Object.keys(this._listeners).length;
        this.connected = false;
        this.disconnected = true;
        this._fire('disconnect', 'client disconnect');
        log.info('connection', 'LoginSocket #' + this._counter + ' disconnected');
        log.details([
            ['socketId', this.id],
            ['totalEmits', String(this._emitCount)],
            ['remainingListeners', String(hadListeners)]
        ]);
    };

    LoginSocket.prototype.destroy = function () {
        var hadListeners = Object.keys(this._listeners).length;
        this.connected = false;
        this.disconnected = true;
        this._listeners = {};
        log.info('connection', 'LoginSocket #' + this._counter + ' destroyed');
        log.details([
            ['socketId', this.id],
            ['totalEmits', String(this._emitCount)],
            ['clearedListeners', String(hadListeners)]
        ]);
    };

    LoginSocket.prototype._fire = function (event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var list = this._listeners[event];

        if (!list || list.length === 0) return;

        for (var i = 0; i < list.length; i++) {
            try {
                list[i].apply(null, args);
            } catch (e) {
                log.error('connection', '_fire: listener #' + (i + 1) + ' for "' + event + '" threw error');
                log.alwaysDetails([
                    ['errorName', e.name || '(unknown)'],
                    ['errorMessage', e.message || String(e)],
                    ['event', event],
                    ['listenerIndex', String(i + 1)]
                ]);
            }
        }
    };

    LoginServer.LoginSocket = LoginSocket;
    window.LoginServer = LoginServer;

    // ═══════════════════════════════════════════════════════════════════
    // 6. INIT — io.connect override + getLoginServer
    // ═══════════════════════════════════════════════════════════════════

    function init() {
        var loginServerUrl = LoginServer.config.loginServerUrl;
        var patched = false;

        // ── Seed default config to IndexedDB ──
        LoginServer.db.seedConfig().catch(function (e) {
            log.error('startup', 'IndexedDB seedConfig FAILED');
            log.alwaysDetails([
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)]
            ]);
        });

        // ── Override getLoginServer() ──
        // Evidence: main.min.js L81719-81724
        //   TSBrowser.executeFunction('getLoginServer') \u2192 window['getLoginServer']()
        // Evidence: main.min.js L114509-114512
        //   connectToLogin \u2192 TSBrowser.executeFunction('getLoginServer') \u2192 io.connect(n)
        window.getLoginServer = function () {
            return loginServerUrl;
        };

        // ── Override io.connect() ──
        function overrideIoConnect() {
            if (patched) return;
            if (!window.io || typeof window.io.connect !== 'function') return false;

            var origConnect = window.io.connect;
            patched = true;

            window.io.connect = function (url, options) {
                if (url && url.indexOf(loginServerUrl) !== -1) {
                    var ts2 = new Date();
                    var hh2 = String(ts2.getHours()).padStart(2, '0');
                    var mm2 = String(ts2.getMinutes()).padStart(2, '0');
                    // ── IO: judul + summary selalu terlihat, detail tabel di collapsed group ──
                    console.log(
                        '\uD83C\uDF10 %c' + hh2 + ':' + mm2 + ' %c[LOGIN-SERVER] %cIO \u25b8 \u2705 READY',
                        'color:#616161;',
                        'color:#00897B;',
                        'color:#4CAF50;'
                    );
                    var SC = 'color:#004D40;opacity:0.85;';
                    console.log('%c  \u00b7 \uD83D\uDD17 ' + url, SC);
                    console.log('%c  \u00b7 \uD83D\uDD12 verify: off', SC);
                    console.log('%c  \u00b7 \uD83D\uDD04 1-level routing', SC);
                    console.log('%c  \u00b7 \uD83D\uDCE6 LoginSocket', SC);

                    // ── Detail tabel (collapsed) ──
                    console.groupCollapsed('%c  \u2022 IO Config', 'color:#004D40;opacity:0.7;');
                    console.table([
                        { key: 'serverUrl', value: url },
                        { key: 'verifyEnable', value: 'false' },
                        { key: 'routing', value: '1-level (action only)' },
                        { key: 'returnType', value: 'LoginSocket' }
                    ]);
                    console.groupEnd();

                    return new LoginServer.LoginSocket();
                }

                return origConnect.call(window.io, url, options);
            };

            return true;
        }

        // ── Poll for window.io ──
        log.info('TIMER', 'Waiting for window.io...');
        var pollCount = 0;
        var pollTimer = setInterval(function () {
            if (patched) { clearInterval(pollTimer); return; }
            if (++pollCount > 300) {
                clearInterval(pollTimer);
                log.error('TIMER', 'window.io NOT found after 30s (300 polls)');
                log.alwaysDetails([
                    ['hint', 'main.min.js may not have loaded'],
                    ['hint2', 'io not exposed on window']
                ]);
                return;
            }
            if (pollCount % 50 === 0) {
                log.debug('TIMER', 'Still waiting... (' + (pollCount * 100) + 'ms, ' + pollCount + ' polls)');
            }
            if (overrideIoConnect()) clearInterval(pollTimer);
        }, 100);

        // ── MutationObserver fallback ──
        if (typeof MutationObserver !== 'undefined') {
            var observer = new MutationObserver(function () {
                if (!patched && window.io && typeof window.io.connect === 'function') {
                    log.info('TIMER', 'MutationObserver detected window.io');
                    overrideIoConnect();
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(function () { observer.disconnect(); }, 60000);
        } else {
            log.warn('TIMER', 'MutationObserver not available \u2014 poll only');
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // START
    // ═══════════════════════════════════════════════════════════════════
    loadNextAction();
})();
