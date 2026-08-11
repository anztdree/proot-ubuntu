/**
 * index.js — Login Server Entry Point
 * Super Warrior Z — LOGIN SERVER (100% IndexedDB, NO PHP/MySQL)
 *
 * Titik masuk tunggal. Berisi:
 *   1. Logger (inline, self-contained)
 *   2. IndexedDB Layer (openDB, get, put, getAll, delete, getByIndex)
 *   3. Schema + Default Data (auto-seed on first run)
 *   4. SDK Bridge (checkSDK, getSdkLoginInfo, PPGAME stubs, auto-login)
 *   5. Config
 *   6. Action loader (actions/*.js)
 *   7. Router/Dispatcher
 *   8. LoginSocket class (mock socket, verifyEnable=false)
 *   9. io.connect() patch
 *  10. getLoginServer() override
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

        var COLORS = {
            INFO:  '#2196F3',
            WARN:  '#FF9800',
            ERROR: '#F44336',
            DEBUG: '#78909C'
        };

        var CTX_EMOJI = {
            BOOT:      '🚀', SOCK:      '🔌', IO:        '🌐', ROUTE:     '🔀',
            EMIT:      '📨', REQ:       '📥', API:       '📡', RESP:      '📤',
            ENV:       '📦', FALLBACK:  '🛡️', TIMER:     '⏳', CONFIG:    '⚙️',
            DELAY:     '⏱️', TOKEN:     '🔑', STORAGE:   '💾', ACTION:    '🎯',
            SUCCESS:   '✅', FAIL:      '❌', WARN_EMOJI:'⚠️', HINT:      '💡',
            LINK:      '🔗', DATA:      '📊', ID:        '🆔', EVENT:     '📡',
            LOAD:      '📂', REGISTRY:  '📋', PATCH:     '🔧', POLL:      '⏳',
            DB:        '🗄️', SDK:       '⚡', SEED:      '🌱', USER:      '👤'
        };

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

        function info(context, message) { emit('INFO', context, null, message); }
        function warn(context, message) { emit('WARN', context, null, message); }
        function error(context, message) { emit('ERROR', context, null, message); }
        function debug(context, message) { emit('DEBUG', context, null, message); }

        var DETAIL_COLOR = 'color:#004D40;opacity:0.85;padding-left:8px;';

        function detailLine(connector, emoji, key, value) {
            if (!shouldLog('DEBUG')) return;
            console.log(
                '%c  ' + connector + ' ' + emoji + ' ' + key + ' : ' + value,
                DETAIL_COLOR
            );
        }

        function detail(key, value) {
            var em = CTX_EMOJI[key] || '📋';
            detailLine('└', em, key, value);
        }

        function openDetail(key, value) {
            var em = CTX_EMOJI[key] || '📋';
            detailLine('├', em, key, value);
        }

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

        function table(title, data) {
            if (!shouldLog('DEBUG')) return;
            console.log('%c  📋 ' + title, DETAIL_COLOR);
            console.table(data);
        }

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

        function setLevel(level) {
            var p = PRIORITY[level];
            if (p !== undefined) {
                currentLevel = level;
                minPriority = p;
                try { localStorage.setItem(LEVEL_KEY, level); } catch (e) {}
                console.log('%c' + SERVER_TAG + ' Log level → ' + level, 'color:#00897B;font-weight:bold;');
            }
        }

        return {
            info: info, warn: warn, error: error, debug: debug,
            detail: detail, openDetail: openDetail, details: details,
            table: table, alwaysDetails: alwaysDetails,
            level: currentLevel, setLevel: setLevel
        };
    })();

    window.LoginServerLogger = LoginServerLogger;

    // ═══════════════════════════════════════════════════════════════════
    // 2. IndexedDB LAYER
    // ═══════════════════════════════════════════════════════════════════
    var log = LoginServerLogger;

    var DB_NAME = 'ksweb_login';
    var DB_VERSION = 1;
    var _db = null;
    var _dbReady = false;

    var STORES = {
        users:     { keyPath: 'userId' },
        servers:   { keyPath: 'serverId' },
        history:   { keyPath: 'id', autoIncrement: true, indexes: [
            { name: 'idx_userId',       keyPath: 'userId',            options: {} },
            { name: 'idx_user_date',   keyPath: ['userId','serverId','loginDate'], options: { unique: true } }
        ]},
        notices:   { keyPath: 'noticeId', autoIncrement: true },
        languages: { keyPath: 'userId' },
        analytics: { keyPath: 'id', autoIncrement: true, indexes: [
            { name: 'idx_analytics_userId', keyPath: 'userId', options: {} }
        ]}
    };

    /**
     * openDB() — Buka/upgrade IndexedDB. Returns Promise<db>.
     * Dipanggil sekali saat init, lalu _db di-reuse.
     */
    function openDB() {
        return new Promise(function (resolve, reject) {
            if (_db) { resolve(_db); return; }

            log.info('DB', 'Opening IndexedDB: ' + DB_NAME + ' v' + DB_VERSION);

            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                var db = e.target.result;
                var storeNames = Object.keys(STORES);
                log.info('DB', 'onupgradeneeded — creating/upgrading ' + storeNames.length + ' stores');

                for (var i = 0; i < storeNames.length; i++) {
                    var storeName = storeNames[i];
                    var cfg = STORES[storeName];

                    if (!db.objectStoreNames.contains(storeName)) {
                        var store;
                        if (cfg.autoIncrement) {
                            store = db.createObjectStore(storeName, { keyPath: cfg.keyPath, autoIncrement: true });
                        } else {
                            store = db.createObjectStore(storeName, { keyPath: cfg.keyPath });
                        }

                        if (cfg.indexes) {
                            for (var j = 0; j < cfg.indexes.length; j++) {
                                var idx = cfg.indexes[j];
                                store.createIndex(idx.name, idx.keyPath, idx.options || {});
                            }
                        }

                        log.debug('DB', 'Created store: ' + storeName + (cfg.indexes ? ' (' + cfg.indexes.length + ' indexes)' : ''));
                    }
                }
            };

            request.onsuccess = function (e) {
                _db = e.target.result;
                _dbReady = true;
                log.info('DB', 'IndexedDB READY');
                log.details([
                    ['name', _db.name],
                    ['version', String(_db.version)],
                    ['stores', Object.keys(STORES).join(', ')]
                ]);
                resolve(_db);
            };

            request.onerror = function (e) {
                log.error('DB', 'IndexedDB OPEN FAILED');
                log.alwaysDetails([
                    ['error', e.target.error ? e.target.error.message : 'unknown']
                ]);
                reject(e.target.error);
            };
        });
    }

    /** get(storeName, key) → Promise<data|null> */
    function dbGet(storeName, key) {
        var t0 = Date.now();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var req = store.get(key);
                req.onsuccess = function () {
                    var elapsed = Date.now() - t0;
                    log.debug('DB', 'get(' + storeName + ', ' + key + ') → ' + (req.result ? 'found' : 'not found') + ' ' + elapsed + 'ms');
                    resolve(req.result);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /** put(storeName, data) → Promise<data> */
    function dbPut(storeName, data) {
        var t0 = Date.now();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                var req = store.put(data);
                req.onsuccess = function () {
                    var elapsed = Date.now() - t0;
                    log.debug('DB', 'put(' + storeName + ', ' + (data[STORES[storeName].keyPath] || 'auto') + ') → ok ' + elapsed + 'ms');
                    resolve(data);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /** getAll(storeName) → Promise<Array> */
    function dbGetAll(storeName) {
        var t0 = Date.now();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var req = store.getAll();
                req.onsuccess = function () {
                    var elapsed = Date.now() - t0;
                    log.debug('DB', 'getAll(' + storeName + ') → ' + req.result.length + ' rows ' + elapsed + 'ms');
                    resolve(req.result);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /** getByIndex(storeName, indexName, value) → Promise<Array> */
    function dbGetByIndex(storeName, indexName, value) {
        var t0 = Date.now();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var idx = store.index(indexName);
                var req = idx.getAll(value);
                req.onsuccess = function () {
                    var elapsed = Date.now() - t0;
                    log.debug('DB', 'getByIndex(' + storeName + '.' + indexName + ', ' + JSON.stringify(value) + ') → ' + req.result.length + ' rows ' + elapsed + 'ms');
                    resolve(req.result);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /** count(storeName) → Promise<number> */
    function dbCount(storeName) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var req = store.count();
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. SCHEMA — Default Data (seeded on first run)
    // ═══════════════════════════════════════════════════════════════════

    var DEFAULT_SERVERS = [
        {
            serverId: '1',
            name: 'Local 1',
            url: 'http://127.0.0.1:8001',
            chaturl: 'http://127.0.0.1:8002',
            dungeonurl: 'http://127.0.0.1:8004',
            online: true,
            hot: false,
            "new": true,
            sortOrder: 1
        }
    ];

    var DEFAULT_NOTICES = [
        {
            title: { en: 'Welcome', cn: '欢迎' },
            content: { en: 'Welcome to Super Warrior Z!', cn: '欢迎来到超级战士Z！' },
            orderNo: 1,
            alwaysPopup: false,
            active: true
        }
    ];

    var _seeded = false;

    /**
     * seedDatabase() — Insert default servers + notices if stores are empty.
     * Returns Promise<void>.
     */
    function seedDatabase() {
        if (_seeded) return Promise.resolve();
        return openDB().then(function (db) {
            return dbCount('servers').then(function (serverCount) {
                if (serverCount > 0) {
                    log.debug('SEED', 'Servers already exist (' + serverCount + ') — skip seed');
                    _seeded = true;
                    return;
                }

                log.info('SEED', 'First run — seeding default data...');

                var promises = [];

                // Seed servers
                for (var i = 0; i < DEFAULT_SERVERS.length; i++) {
                    promises.push(dbPut('servers', DEFAULT_SERVERS[i]));
                }

                // Seed notices
                for (var j = 0; j < DEFAULT_NOTICES.length; j++) {
                    promises.push(dbPut('notices', DEFAULT_NOTICES[j]));
                }

                return Promise.all(promises).then(function () {
                    _seeded = true;
                    log.info('SEED', 'Default data seeded OK');
                    log.details([
                        ['servers', String(DEFAULT_SERVERS.length)],
                        ['notices', String(DEFAULT_NOTICES.length)]
                    ]);
                });
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4. SDK BRIDGE — checkSDK, getSdkLoginInfo, PPGAME stubs
    // ═══════════════════════════════════════════════════════════════════
    //
    // Kontrak yang main.min.js butuhkan:
    //   window.checkSDK()         → true (setelah IndexedDB siap + user aktif)
    //   window.getSdkLoginInfo()  → {sdk, loginToken, nickName, userId, sign, security}
    //   window.PPGAME            → {createPaymentOrder, playerEnterServer, submitEvent, ...}
    //   window.paySdk()           → no-op
    //   window.gameReady()        → no-op
    //   window.report2Sdk()       → no-op
    //   dll (semua window.* functions dari sdk.js)
    //
    // Alur: game init → polling checkSDK() → true → getSdkLoginInfo() → sdkLoginSuccess()

    var _sdkReady = false;
    var _loginInfo = null;
    var STORAGE_KEY = 'active_user_id';

    /**
     * autoLogin() — Cek localStorage, load user dari IndexedDB, atau auto-create guest.
     * Dipanggil saat DB siap. Sets _loginInfo + _sdkReady = true.
     */
    function autoLogin() {
        log.info('SDK', 'Auto-login starting...');

        var activeUserId = '';
        try { activeUserId = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) {}

        if (activeUserId) {
            log.debug('SDK', 'Found active_user_id in localStorage');
            log.detail('USER', activeUserId);

            dbGet('users', activeUserId).then(function (user) {
                if (user) {
                    setLoginInfo(user);
                } else {
                    log.warn('SDK', 'active_user_id not found in DB — creating new guest');
                    createGuestUser();
                }
            }).catch(function (err) {
                log.error('SDK', 'DB error reading user — creating new guest');
                log.alwaysDetails([['error', err.message || String(err)]]);
                createGuestUser();
            });
        } else {
            log.debug('SDK', 'No active_user_id — creating new guest');
            createGuestUser();
        }
    }

    /**
     * createGuestUser() — Generate new guest user, save to IndexedDB, set login.
     */
    function createGuestUser() {
        var userId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        var loginToken = generateToken(64);
        var securityCode = generateToken(32);
        var sign = generateToken(32);
        var security = generateToken(32);
        var now = Math.floor(Date.now() / 1000);

        var user = {
            userId: userId,
            nickName: userId,
            channelCode: 'ppgame',
            loginToken: loginToken,
            securityCode: securityCode,
            sign: sign,
            security: security,
            createdAt: now,
            lastLoginAt: now
        };

        dbPut('users', user).then(function () {
            log.info('SDK', 'Guest user created');
            log.details([
                ['userId', userId],
                ['loginToken', loginToken.substring(0, 16) + '...'],
                ['securityCode', securityCode.substring(0, 16) + '...']
            ]);

            // Simpan ke localStorage agar next reload bisa auto-login
            try { localStorage.setItem(STORAGE_KEY, userId); } catch (e) {}

            setLoginInfo(user);
        }).catch(function (err) {
            log.error('SDK', 'Failed to create guest user');
            log.alwaysDetails([['error', err.message || String(err)]]);
        });
    }

    /**
     * setLoginInfo(user) — Set _loginInfo dari DB user object + unblock game.
     *
     * Evidence: main.min.js sdkLoginSuccess(e)
     *   ts.loginInfo.userInfo = {
     *     loginToken: e.loginToken,
     *     userId: e.userId,
     *     nickName: e.nickName,
     *     channelCode: e.sdk,   ← dari getSdkLoginInfo().sdk
     *     securityCode: e.security ← dari getSdkLoginInfo().security
    *   }
     *
     * Jadi getSdkLoginInfo() harus return:
     *   { sdk: channelCode, loginToken, nickName, userId, sign, security: securityCode }
     */
    function setLoginInfo(user) {
        _loginInfo = {
            sdk: user.channelCode || 'ppgame',
            loginToken: user.loginToken || '',
            nickName: user.nickName || user.userId,
            userId: user.userId,
            sign: user.sign || '',
            security: user.securityCode || ''
        };

        _sdkReady = true;

        log.info('SDK', 'SDK Ready — game init unblocked');
        log.details([
            ['userId', _loginInfo.userId],
            ['nickName', _loginInfo.nickName],
            ['sdk', _loginInfo.sdk],
            ['loginToken', _loginInfo.loginToken.substring(0, 16) + '...'],
            ['securityCode', _loginInfo.security.substring(0, 16) + '...'],
            ['checkSDK', 'true']
        ]);
    }

    // ─── Window contract functions (dibutuhkan main.min.js) ───

    window.checkSDK = function () {
        return _sdkReady;
    };

    window.getSdkLoginInfo = function () {
        if (!_loginInfo) return null;
        return {
            sdk: _loginInfo.sdk,
            loginToken: _loginInfo.loginToken,
            nickName: _loginInfo.nickName,
            userId: _loginInfo.userId,
            sign: _loginInfo.sign,
            security: _loginInfo.security
        };
    };

    window.getAppId = function () { return ''; };
    window.getLoginServer = function () { return ''; };
    window.checkFromNative = function () { return false; };
    window.contactSdk = function () {};
    window.userCenterSdk = function () {};
    window.switchUser = function () {};
    window.openURL = function (url) { window.open(url, '_blank'); };
    window.changeLanguage = function (lang) {
        log.debug('SDK', 'changeLanguage(' + lang + ')');
    };
    window.switchAccount = function () {
        log.debug('SDK', 'switchAccount() — reload');
        window.location.reload();
    };
    window.accountLoginCallback = function (fn) {};
    window.reload = function () { window.location.reload(); };
    window.report2Sdk350CreateRole = function () {};
    window.report2Sdk350LoginUser = function () {};
    window.fbq = function () {};
    window.gtag = function () {};
    window.reportLogToPP = function () {};
    window.reportToCpapiCreaterole = function () {};
    window.sendCustomEvent = function () {};

    window.PPGAME = {
        createPaymentOrder: function () { log.debug('SDK', 'PPGAME.createPaymentOrder — no-op'); },
        playerEnterServer: function () { log.debug('SDK', 'PPGAME.playerEnterServer — no-op'); },
        submitEvent: function () { log.debug('SDK', 'PPGAME.submitEvent — no-op'); },
        gameReady: function () { log.debug('SDK', 'PPGAME.gameReady — no-op'); },
        gameChapterFinish: function () {},
        openShopPage: function () {},
        gameLevelUp: function () {}
    };

    window.paySdk = function () { log.debug('SDK', 'paySdk — no-op'); };
    window.gameReady = function () { log.debug('SDK', 'gameReady — no-op'); };
    window.report2Sdk = function () {};
    window.gameChapterFinish = function () {};
    window.openShopPage = function () {};
    window.gameLevelUp = function () {};
    window.tutorialFinish = function () {};

    // ═══════════════════════════════════════════════════════════════════
    // 5. CONFIG
    // ═══════════════════════════════════════════════════════════════════
    var LoginServer = {
        config: {
            loginServerUrl: 'http://127.0.0.1:8000',
            mainServerUrl: 'http://127.0.0.1:8001',
            chatServerUrl: 'http://127.0.0.1:8002',
            dungeonServerUrl: 'http://127.0.0.1:8004',
            delayMin:      30,
            delayMax:      120,
            loginTokenLength: 64,
            verifyEnable:  false
        },
        handlers: {},
        _handlerNames: [],
        _handlerCount: 0,
        log: log,

        // Expose IndexedDB functions for actions
        db: {
            open: openDB,
            get: dbGet,
            put: dbPut,
            getAll: dbGetAll,
            getByIndex: dbGetByIndex,
            count: dbCount
        }
    };

    // ═══════════════════════════════════════════════════════════════════
    // 6. HELPERS (pure infra)
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

    /** generateToken standalone (used before LoginServer exists) */
    function generateToken(length) {
        var chars = 'abcdef0123456789';
        var token = '';
        for (var i = 0; i < (length || 64); i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    LoginServer.nowSeconds = function () {
        return Math.floor(Date.now() / 1000);
    };

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
    // 7. LOAD ACTIONS (actions/*.js)
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
    // 8. ROUTER / DISPATCHER
    // ═══════════════════════════════════════════════════════════════════

    var _routeStats = {
        totalRouted: 0,
        totalUnknown: 0,
        totalNoAction: 0,
        totalErrors: 0,
        lastAction: null
    };

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
    // 9. LOGINSOCKET CLASS (mock socket)
    // ═══════════════════════════════════════════════════════════════════

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

                // Socket.IO serialization simulation
                if (data === null || data === undefined || typeof data === 'function') {
                    log.info('EMIT', 'Socket.IO serialization simulation: type=' + typeof data + ' → {}');
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

                // Auto-route empty-action → LoginAnnounce
                if (!data.action) {
                    log.info('ROUTE', 'No action field → auto-routing to LoginAnnounce');
                    data.action = 'LoginAnnounce';
                }

                // Log semua field
                log.info('EMIT', 'Request fields for ' + actionName);
                var reqKeys = Object.keys(data);
                for (var k = 0; k < reqKeys.length; k++) {
                    var rk = reqKeys[k];
                    var rv = String(data[rk]);
                    if (rv.length > 80) rv = rv.substring(0, 80) + '... (truncated)';
                    log.detail(rk, rv);
                }

                log.info('ROUTE', 'emit #' + emitNum + ' → dispatching: ' + actionName);

                var routeStart = Date.now();

                LoginServer.router.dispatch(data, function (responseData, retCode) {
                    var routeDuration = Date.now() - routeStart;
                    var totalDuration = Date.now() - emitStartTime;

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
    // 10. INIT — IndexedDB seed → auto-login → patch io.connect
    // ═══════════════════════════════════════════════════════════════════

    function init() {
        var loginServerUrl = LoginServer.config.loginServerUrl;
        var patched = false;

        // ── Boot summary ──
        log.info('BOOT', '═════════════════ BOOT COMPLETE ════════════════');
        log.table('CONFIG', LoginServer.config);

        var handlerInfo = [];
        for (var i = 0; i < LoginServer._handlerNames.length; i++) {
            handlerInfo.push({ index: '[' + i + ']', action: LoginServer._handlerNames[i], status: '✅' });
        }
        if (handlerInfo.length > 0) {
            log.table('HANDLER REGISTRY (' + LoginServer._handlerNames.length + ')', handlerInfo);
        }

        // ── Step 1: Seed DB + Auto-login (before io.connect patch) ──
        log.info('BOOT', 'Initializing IndexedDB + auto-login...');

        seedDatabase().then(function () {
            autoLogin();
        }).catch(function (err) {
            log.error('BOOT', 'Seed failed — attempting auto-login anyway');
            log.alwaysDetails([['error', err.message || String(err)]]);
            autoLogin();
        });

        // ── Step 2: Override getLoginServer() ──
        window.getLoginServer = function () {
            log.info('IO', 'getLoginServer() called → ' + loginServerUrl);
            return loginServerUrl;
        };

        // ── Step 3: Patch io.connect() ──
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
                    log.info('IO', 'INTERCEPTED → LOGIN SERVER (LoginSocket)');
                    log.table('INTERCEPT', {
                        url: url,
                        verifyEnable: 'false',
                        routing: '1-level (action only)',
                        returnType: 'LoginSocket (mock)'
                    });
                    return new LoginServer.LoginSocket();
                }

                log.info('IO', 'PASS THROUGH → ' + url);
                return origConnect.call(window.io, url, options);
            };

            log.info('IO', 'io.connect() PATCHED — LOGIN SERVER READY');
            log.details([
                ['interceptUrl', loginServerUrl],
                ['verifyEnable', 'false (no TEA handshake)'],
                ['routing', '1-level (action only)'],
                ['storage', '100% IndexedDB (no PHP/MySQL)']
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
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // START
    // ═══════════════════════════════════════════════════════════════════
    loadNextAction();
})();
