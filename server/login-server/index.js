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
 *   6. io.connect() patch
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
        console.log('%c[LOGIN-SERVER] ' + msg, 'color:#00897B;font-weight:bold;');
    }

    function preError(msg) {
        console.log('%c[LOGIN-SERVER] ' + msg, 'color:#F44336;font-weight:bold;');
    }

    preLog('Login server loading...');

    // ═══════════════════════════════════════════════════════════════════
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

    preLog('basePath = ' + basePath);

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
            BOOT:      '🚀',
            SOCK:      '🔌',
            IO:        '🌐',
            ROUTE:     '🔀',
            EMIT:      '📨',
            REQ:       '📥',
            API:       '📡',
            RESP:      '📤',
            ENV:       '📦',
            FALLBACK:  '🛡️',
            TIMER:     '⏳',
            CONFIG:    '⚙️',
            DELAY:     '⏱️',
            TOKEN:     '🔑',
            STORAGE:   '💾',
            ACTION:    '🎯',
            SUCCESS:   '✅',
            FAIL:      '❌',
            WARN_EMOJI:'⚠️',
            HINT:      '💡',
            LINK:      '🔗',
            DATA:      '📊',
            ID:        '🆔',
            EVENT:     '📡',
            LOAD:      '📂',
            REGISTRY:  '📋',
            PATCH:     '🔧',
            POLL:      '⏳'
        };

        // ═══════════════════════════════════════════════════════════════
        // Emit functions
        // ═══════════════════════════════════════════════════════════════

        /**
         * @param {string} level   — INFO, WARN, ERROR, DEBUG
         * @param {string} context — BOOT, SOCK, ROUTE, API, ENV, FALLBACK, dll
         * @param {string} emoji   — emoji override (opsional, pakai CTX_EMOJI[context] jika kosong)
         * @param {string} message — pesan utama
         */
        function emit(level, context, emoji, message) {
            if (!shouldLog(level)) return;
            var em = emoji || CTX_EMOJI[context] || '⚪';
            var color = COLORS[level] || '#78909C';
            var pad = (context + '          ').slice(0, 10);
            console.log(
                '%c' + em + ' ' + ts() + ' %c' + SERVER_TAG + ' %c' + pad + '▸ ' + message,
                'color:#616161;',
                'color:#00897B;font-weight:bold;',
                'color:' + color + ';font-weight:bold;'
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

        /**
         * detail(key, value) — single line, pakai emoji dari key
         * Dipanggil: log.detail('userId', 'user_001')
         */
        function detail(key, value) {
            var em = CTX_EMOJI[key] || '📋';
            detailLine('└', em, key, value);
        }

        /**
         * openDetail() — buka block detail (connector = ├)
         * Return helper untuk chain detail()
         */
        function openDetail(key, value) {
            var em = CTX_EMOJI[key] || '📋';
            detailLine('├', em, key, value);
        }

        /**
         * details(pairs[]) — multi-line, otomatis ├ / └
         * Dipanggil: log.details([['userId', 'user_001'], ['channel', 'ppgame']])
         */
        function details(pairs) {
            if (!shouldLog('DEBUG')) return;
            for (var i = 0; i < pairs.length; i++) {
                var key = pairs[i][0];
                var val = pairs[i][1];
                var em = CTX_EMOJI[key] || CTX_EMOJI[val] || '📋';
                var conn = i < pairs.length - 1 ? '├' : '└';
                detailLine(conn, em, key, val);
            }
        }

        /**
         * table(title, data) — console.table native
         * Dipanggil: log.table('CONFIG', { loginUrl: '...' })
         * Atau: log.table('ACTIONS', [{name:'loginGame',status:'OK'},...])
         */
        function table(title, data) {
            if (!shouldLog('DEBUG')) return;
            console.log('%c  📋 ' + title, DETAIL_COLOR);
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
                var em = CTX_EMOJI[key] || CTX_EMOJI[val] || '📋';
                var conn = i < pairs.length - 1 ? '├' : '└';
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
                console.log('%c' + SERVER_TAG + ' Log level → ' + level, 'color:#00897B;font-weight:bold;');
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
    // Database: proot_login (versi 2 — upgrade dari versi 1 lama)
    // Store: loginInfo (keyPath: userId)
    //
    // Record types:
    //   User   — userId = "player1" (data login user)
    //   System — userId = "__config__" (servers, notices)

    var DB_NAME = 'last_game_server';
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
                log.info('STORAGE', 'IndexedDB opened: ' + DB_NAME + ' v' + DB_VERSION);
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
                    title: { en: 'Welcome', cn: '欢迎' },
                    text: { en: 'Welcome to Super Warrior Z!', cn: '欢迎来到超级战士Z！' },
                    version: '1.0',
                    orderNo: 1,
                    alwaysPopup: false
                }
            ]
        };

        return idbGet('__config__').then(function (existing) {
            if (existing) {
                log.info('STORAGE', '__config__ already exists, skip seed');
                return existing;
            }
            log.info('STORAGE', 'Seeding __config__ with defaults');
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
     *
     * ServerTime.updateServerTime(e.serverTime, e.server0Time) at L113853
     *   _offTime = 60 * timezoneOffset * 1000 - n  (n = server0Time)
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
            log.info('LOAD', 'All ' + actionFiles.length + ' actions loaded (' + totalLoadTime + 'ms)');
            log.table('LOAD RESULTS', loadResults);
            init();
            return;
        }

        var fileName = actionFiles[loadedCount];
        var filePath = basePath + fileName;
        var fileStart = Date.now();

        log.info('LOAD', 'Loading [' + (loadedCount + 1) + '/' + actionFiles.length + ']: ' + fileName);

        var script = document.createElement('script');
        script.src = filePath;
        script.async = false;

        script.onload = function () {
            var fileTime = Date.now() - fileStart;
            log.info('LOAD', '  ✅ ' + fileName + ' (' + fileTime + 'ms)');
            loadResults.push({ file: fileName, status: '✅ OK', loadTime: fileTime + 'ms' });
            script.parentNode.removeChild(script);
            loadedCount++;
            loadNextAction();
        };

        script.onerror = function () {
            _criticalError = true;
            log.error('LOAD', 'CRITICAL: Failed to load ' + fileName);
            log.alwaysDetails([
                ['url', filePath],
                ['basePath', basePath],
                ['loadedSoFar', '[' + actionFiles.slice(0, loadedCount).join(', ') + ']'],
                ['hint', 'Check file exists in ' + basePath]
            ]);
            loadResults.push({ file: fileName, status: '❌ FAILED', loadTime: 'N/A' });
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
     *
     * Login-server routing: 1-level (action only)
     *   Semua action punya type='User' dari client, tapi login-server ignore type.
     */
    function dispatch(request, callback) {
        var action = request.action || '';
        _routeStats.totalRouted++;
        _routeStats.lastAction = action;

        log.info('ROUTE', 'Incoming request #' + _routeStats.totalRouted);
        log.details([
            ['action', action || '(EMPTY)'],
            ['type', request.type || '(none)'],
            ['totalSoFar', String(_routeStats.totalRouted)]
        ]);

        if (!action) {
            _routeStats.totalNoAction++;
            log.error('ROUTE', 'No action field in request!');
            log.alwaysDetails([
                ['requestKeys', Object.keys(request || {}).join(', ')],
                ['requestDump', JSON.stringify(request || {}).substring(0, 300)],
                ['totalNoAction', String(_routeStats.totalNoAction)],
                ['retCode', '1 (no_action)']
            ]);
            callback(LoginServer.buildEnvelope({ error: 'no_action' }, 1));
            return;
        }

        var handler = LoginServer.handlers[action];

        if (typeof handler === 'function') {
            log.info('ROUTE', 'Dispatching → ' + action);
            log.details([
                ['handler', action],
                ['source', 'actions/' + action + '.js']
            ]);

            try {
                handler(request, callback);
            } catch (handlerErr) {
                _routeStats.totalErrors++;
                log.error('ROUTE', 'Handler "' + action + '" threw UNCAUGHT ERROR');
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
            log.error('ROUTE', 'Unknown action: "' + action + '"');
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

        log.info('SOCK', 'LoginSocket #' + this._counter + ' created');
        log.table('SOCK #' + this._counter, {
            socketId: this.id,
            target: LoginServer.config.loginServerUrl,
            verifyEnable: String(LoginServer.config.verifyEnable),
            status: 'connecting...',
            delay: 'pending...'
        });

        var self = this;
        var delay = LoginServer.randomDelay();

        log.debug('SOCK', 'Simulating connection delay');
        log.detail('DELAY', delay + 'ms (randomized ' + LoginServer.config.delayMin + '~' + LoginServer.config.delayMax + 'ms)');

        setTimeout(function () {
            if (self.disconnected) {
                log.warn('SOCK', 'LoginSocket #' + self._counter + ' disconnected BEFORE connect completed');
                return;
            }
            self.connected = true;
            self._fire('connect');
            log.info('SOCK', 'LoginSocket #' + self._counter + ' CONNECTED (' + delay + 'ms)');
            log.details([
                ['socketId', self.id],
                ['status', 'CONNECTED'],
                ['listeners', Object.keys(self._listeners).join(', ') || 'none yet'],
                ['emitCount', String(self._emitCount)]
            ]);
        }, delay);
    }

    LoginSocket.prototype.on = function (event, handler) {
        if (typeof handler !== 'function') {
            log.error('SOCK', 'on() called with non-function handler');
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
        log.debug('SOCK', 'Listener registered: "' + event + '" (' + this._listeners[event].length + ' total on socket #' + this._counter + ')');
    };

    LoginSocket.prototype.off = function (event, handler) {
        if (!this._listeners[event]) {
            log.debug('SOCK', 'off() — no listeners for "' + event + '" on socket #' + this._counter);
            return;
        }
        if (handler) {
            var list = this._listeners[event];
            var before = list.length;
            for (var i = list.length - 1; i >= 0; i--) {
                if (list[i] === handler) list.splice(i, 1);
            }
            log.debug('SOCK', 'off() — removed ' + (before - list.length) + ' listener(s) from "' + event + '" on socket #' + this._counter);
        } else {
            var count = this._listeners[event].length;
            delete this._listeners[event];
            log.debug('SOCK', 'off() — removed ALL ' + count + ' listener(s) from "' + event + '" on socket #' + this._counter);
        }
    };

    LoginSocket.prototype.emit = function (event, data, callback) {
        this._emitCount++;
        var emitNum = this._emitCount;
        var actionName = (data && data.action) ? data.action : (event || 'unknown');
        var typeName = (data && data.type) ? data.type : '-';
        var emitStartTime = Date.now();

        log.info('EMIT', 'emit #' + emitNum + ': "' + event + '"');
        log.details([
            ['action', actionName],
            ['type', typeName],
            ['userId', (data && (data.userId || data.accountToken)) ? (data.userId || data.accountToken) : '-'],
            ['hasCallback', String(typeof callback === 'function')],
            ['socketId', this.id],
            ['socket', '#' + this._counter],
            ['emitCount', String(emitNum)]
        ]);

        // ── handler.process — action routing ──
        if (event === 'handler.process') {
            var self = this;
            var delay = LoginServer.randomDelay();

            log.debug('EMIT', 'Scheduling handler.process dispatch');
            log.detail('DELAY', delay + 'ms');

            setTimeout(function () {
                if (!self.connected) {
                    log.error('EMIT', 'emit #' + emitNum + ' FAILED — socket disconnected');
                    log.alwaysDetails([
                        ['action', actionName],
                        ['socketId', self.id],
                        ['hint', 'Client may hang waiting for response']
                    ]);
                    return;
                }

                // ═══════════════════════════════════════════════════════════════
                // Socket.IO Serialization Simulation
                // ═══════════════════════════════════════════════════════════════
                // Evidence: main.min.js L138128-138130
                //   getNotice: ts.processHandlerWithLogin(t, true, ...)
                //   "t" di sini = Login constructor function (bukan request object!)
                //   L138073: var t = this  →  t = Login instance
                //   L138130: ts.processHandlerWithLogin(t, true, callback)
                //     → "t" masih merujuk ke Login constructor dari IIFE scope
                //
                // Real Socket.IO: socket.emit() serialize data → function stripped
                //   → server receives null / undefined / {}
                // Socket.IO simulation: receives RAW data (no network, no serialization)
                //   → must simulate Socket.IO behavior manually
                // ═══════════════════════════════════════════════════════════════
                if (data === null || data === undefined || typeof data === 'function') {
                    log.info('EMIT', 'Socket.IO serialization simulation: type=' + typeof data + ' → {}');
                    log.details([
                        ['evidence', 'L138128: getNotice sends Login constructor (function) as request'],
                        ['evidence2', 'Real Socket.IO strips functions → server receives empty'],
                        ['originalType', typeof data],
                        ['normalizedTo', '{} (empty object)']
                    ]);
                    data = {};
                }

                if (!data || typeof data !== 'object') {
                    log.error('EMIT', 'emit #' + emitNum + ' — invalid data');
                    log.alwaysDetails([
                        ['dataType', typeof data],
                        ['action', actionName],
                        ['socketId', self.id]
                    ]);
                    return;
                }

                // ═══════════════════════════════════════════════════════════════
                // Auto-route empty-action requests → LoginAnnounce
                // ═══════════════════════════════════════════════════════════════
                // Evidence: grep "LoginAnnounce" in main.min.js → 0 results
                // Client NEVER sets action:'LoginAnnounce' explicitly!
                // getNotice (L138128) sends request without action field.
                // All other 5 login actions have explicit action names:
                //   loginGame (L114373), GetServerList (L114405),
                //   SaveHistory (L137906), SaveUserEnterInfo (L114451),
                //   SaveLanguage (L114284)
                // Only getNotice sends empty request → must route to LoginAnnounce
                // ═══════════════════════════════════════════════════════════════
                if (!data.action) {
                    log.info('ROUTE', 'No action field → auto-routing to LoginAnnounce');
                    log.details([
                        ['evidence', 'grep "LoginAnnounce" → 0 results — client never sends this action name'],
                        ['evidence2', 'L138128-138130: getNotice sends Login constructor (no action field)'],
                        ['evidence3', 'Only 1 of 6 login actions lacks explicit action name → getNotice'],
                        ['autoRoute', 'LoginAnnounce (getNotice handler)']
                    ]);
                    data.action = 'LoginAnnounce';
                }

                // Log semua field dalam request
                log.info('EMIT', 'Request fields for ' + actionName);
                var reqKeys = Object.keys(data);
                for (var k = 0; k < reqKeys.length; k++) {
                    var rk = reqKeys[k];
                    var rv = String(data[rk]);
                    if (rv.length > 80) rv = rv.substring(0, 80) + '... (truncated, total ' + String(data[rk]).length + ' chars)';
                    log.detail(rk, rv);
                }

                log.info('ROUTE', 'emit #' + emitNum + ' → dispatching: ' + actionName);

                var routeStart = Date.now();

                LoginServer.router.dispatch(data, function (responseData, retCode) {
                    var routeDuration = Date.now() - routeStart;
                    var totalDuration = Date.now() - emitStartTime;

                    // Build envelope
                    var envelope = LoginServer.buildEnvelope(responseData, retCode);

                    log.info('ENV', 'emit #' + emitNum + ' → envelope ready');
                    log.details([
                        ['action', actionName],
                        ['ret', String(envelope.ret)],
                        ['dataSize', envelope.data.length + ' chars'],
                        ['dataPreview', envelope.data.substring(0, 120) + (envelope.data.length > 120 ? '...' : '')],
                        ['compress', String(envelope.compress)],
                        ['serverTime', String(envelope.serverTime)],
                        ['server0Time', String(envelope.server0Time)],
                        ['source', retCode ? 'ERROR PATH' : 'HANDLER OK']
                    ]);

                    log.details([
                        ['routeTime', routeDuration + 'ms'],
                        ['scheduleDelay', delay + 'ms'],
                        ['totalEmitTime', totalDuration + 'ms']
                    ]);

                    if (typeof callback === 'function') {
                        try {
                            callback(envelope);
                            log.debug('ENV', 'emit #' + emitNum + ' callback fired — OK');
                        } catch (cbErr) {
                            log.error('ENV', 'emit #' + emitNum + ' callback THREW ERROR');
                            log.alwaysDetails([
                                ['errorName', cbErr.name || '(unknown)'],
                                ['errorMessage', cbErr.message || String(cbErr)]
                            ]);
                        }
                    } else {
                        log.error('ENV', 'emit #' + emitNum + ' — NO CALLBACK PROVIDED');
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
        log.warn('EMIT', 'emit #' + emitNum + ' — unhandled event: "' + event + '"');
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
        log.info('SOCK', 'LoginSocket #' + this._counter + ' disconnected');
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
        log.info('SOCK', 'LoginSocket #' + this._counter + ' destroyed');
        log.details([
            ['socketId', this.id],
            ['totalEmits', String(this._emitCount)],
            ['clearedListeners', String(hadListeners)]
        ]);
    };

    LoginSocket.prototype._fire = function (event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var list = this._listeners[event];

        if (!list || list.length === 0) {
            log.debug('SOCK', '_fire: no listeners for "' + event + '" on socket #' + this._counter);
            return;
        }

        log.debug('SOCK', '_fire: "' + event + '" → ' + list.length + ' listener(s) on socket #' + this._counter);

        for (var i = 0; i < list.length; i++) {
            try {
                list[i].apply(null, args);
            } catch (e) {
                log.error('SOCK', '_fire: listener #' + (i + 1) + ' for "' + event + '" threw error');
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
    // 6. INIT — patch io.connect + override getLoginServer
    // ═══════════════════════════════════════════════════════════════════

    function init() {
        var loginServerUrl = LoginServer.config.loginServerUrl;
        var patched = false;

        // ── Seed default config to IndexedDB ──
        LoginServer.db.seedConfig().then(function () {
            log.info('BOOT', 'IndexedDB config ready');
        }).catch(function (e) {
            log.error('BOOT', 'IndexedDB seedConfig FAILED');
            log.alwaysDetails([
                ['errorName', e.name || '(unknown)'],
                ['errorMessage', e.message || String(e)]
            ]);
        });

        // ── Boot summary ──
        log.info('BOOT', '══════════════════ BOOT COMPLETE ════════════════');

        log.table('CONFIG', LoginServer.config);

        var handlerInfo = [];
        for (var i = 0; i < LoginServer._handlerNames.length; i++) {
            handlerInfo.push({ index: '[' + i + ']', action: LoginServer._handlerNames[i], status: '✅' });
        }
        if (handlerInfo.length > 0) {
            log.table('HANDLER REGISTRY (' + LoginServer._handlerNames.length + ')', handlerInfo);
        }

        // ── Override getLoginServer() ──
        // Evidence: main.min.js L81719-81724
        //   TSBrowser.executeFunction('getLoginServer') → window['getLoginServer']()
        // Evidence: main.min.js L114509-114512
        //   connectToLogin → TSBrowser.executeFunction('getLoginServer') → io.connect(n)
        window.getLoginServer = function () {
            log.info('IO', 'getLoginServer() called → ' + loginServerUrl);
            return loginServerUrl;
        };

        // ── Patch io.connect() ──
        function patchIoConnect() {
            if (patched) return;
            if (!window.io || typeof window.io.connect !== 'function') return false;

            var origConnect = window.io.connect;
            patched = true;

            window.io.connect = function (url, options) {
                log.info('IO', 'io.connect() called');
                log.details([
                    ['url', url || '(none)'],
                    ['hasOptions', String(!!options)]
                ]);

                if (url && url.indexOf(loginServerUrl) !== -1) {
                    log.info('IO', 'CONNECTED → LOGIN SERVER (LoginSocket)');
                    log.table('CONNECT', {
                        url: url,
                        verifyEnable: 'false',
                        routing: '1-level (action only)',
                        returnType: 'LoginSocket'
                    });
                    return new LoginServer.LoginSocket();
                }

                log.info('IO', 'PASS THROUGH → ' + url);
                return origConnect.call(window.io, url, options);
            };

            log.info('IO', 'io.connect() PATCHED — LOGIN SERVER READY');
            log.details([
                ['serverUrl', loginServerUrl],
                ['verifyEnable', 'false (no TEA handshake)'],
                ['routing', '1-level (action only)']
            ]);
            return true;
        }

        // ── Poll for window.io ──
        log.info('TIMER', 'Polling window.io...');
        var pollCount = 0;
        var pollTimer = setInterval(function () {
            if (patched) { clearInterval(pollTimer); return; }
            if (++pollCount > 300) {
                clearInterval(pollTimer);
                log.error('TIMER', 'window.io NOT found after 30s (300 polls)');
                log.alwaysDetails([
                    ['hint', 'main.min.js may not have loaded'],
                    ['hint2', 'io not exposed on window'],
                    ['pollAttempts', '300'],
                    ['pollInterval', '100ms']
                ]);
                return;
            }
            if (pollCount % 50 === 0) {
                log.debug('TIMER', 'Still waiting... (' + (pollCount * 100) + 'ms, ' + pollCount + ' polls)');
            }
            if (patchIoConnect()) clearInterval(pollTimer);
        }, 100);

        // ── MutationObserver fallback ──
        if (typeof MutationObserver !== 'undefined') {
            var observer = new MutationObserver(function () {
                if (!patched && window.io && typeof window.io.connect === 'function') {
                    log.info('TIMER', 'MutationObserver detected window.io');
                    patchIoConnect();
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(function () { observer.disconnect(); }, 60000);
        } else {
            log.warn('TIMER', 'MutationObserver not available — poll only');
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // START
    // ═══════════════════════════════════════════════════════════════════
    loadNextAction();
})();
