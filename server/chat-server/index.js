/**
 * index.js — Chat Server Entry Point
 * Super Warrior Z — CHAT SERVER
 *
 * Titik masuk tunggal. Berisi:
 *   1. Logger (inline, self-contained)
 *   2. Config + MESSAGE_KIND + Helpers
 *   3. IndexedDB (chatData: chatData)
 *      — nama dari ts.chatData di main.min.js
 *   4. Room & Notify management (in-memory)
 *   5. Action loader (actions/*.js)
 *   6. Router/Dispatcher (type='chat' validation)
 *   7. ChatSocket class (verifyEnable=TRUE, TEA handshake)
 *   8. io.connect() override (intercept port 8002)
 *
 * Actions di folder actions/. PHP/MySQL TIDAK digunakan — semua via IndexedDB.
 * User profile dibaca dari login-server IndexedDB (login-server/loginInfo).
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    // PRE-LOG (sebelum logger siap, pakai console.log biasa + CSS)
    // ═══════════════════════════════════════════════════════════════════
    function preLog(msg) {
        console.log('%c[CHAT-SERVER] ' + msg, 'color:#7B1FA2;font-weight:bold;');
    }

    function preError(msg) {
        console.log('%c[CHAT-SERVER] ' + msg, 'color:#F44336;font-weight:bold;');
    }

    // ═══════════════════════════════════════════════════════════════════
    // AUTO-DETECT BASE PATH
    // ═══════════════════════════════════════════════════════════════════
    var basePath = (function () {
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (src.indexOf('chat-server/index.js') !== -1) {
                return src.replace('index.js', '');
            }
        }
        return './server/chat-server/';
    })();



    // ═══════════════════════════════════════════════════════════════════
    // 1. LOGGER
    // ═══════════════════════════════════════════════════════════════════
    var ChatServerLogger = (function () {
        var SERVER_TAG = '[CHAT-SERVER]';
        var LEVEL_KEY = 'CHAT_SERVER_LOG_LEVEL';
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

        // Emoji per context
        var CTX_EMOJI = {
            BOOT:      '\uD83D\uDCC2',
            SOCK:      '\uD83D\uDD0C',
            IO:        '\uD83C\uDF10',
            ROUTE:     '\uD83D\uDD00',
            EMIT:      '\uD83D\uDCE8',
            REQ:       '\uD83D\uDCE5',
            RESP:      '\uD83D\uDCE4',
            ENV:       '\uD83D\uDCE6',
            FALLBACK:  '\uD83D\uDEE1\uFE0F',
            TIMER:     '\u23F3',
            CONFIG:    '\u2699\uFE0F',
            DELAY:     '\u23F1\uFE0F',
            TOKEN:     '\uD83D\uDD11',
            STORAGE:   '\uD83D\uDCBE',
            ACTION:    '\uD83C\uDFAF',
            SUCCESS:   '\u2705',
            FAIL:      '\u274C',
            WARN_EMOJI:'\u26A0\uFE0F',
            HINT:      '\uD83D\uDCA1',
            LINK:      '\uD83D\uDD17',
            DATA:      '\uD83D\uDCCA',
            ID:        '\uD83C\uDD94',
            EVENT:     '\uD83D\uDCE1',
            LOAD:      '\uD83D\uDCE6',
            REGISTRY:  '\uD83D\uDCCB',
            POLL:      '\u23F3',
            TEA:       '\uD83C\uDF75',
            NOTIFY:    '\uD83D\uDD14',
            MSG:       '\u2709\uFE0F',
            JOIN:      '\uD83C\uDFAA',
            LEAVE:     '\uD83D\uDCAA',
            CHAT:      '\uD83D\uDCAC',
            DB:        '\uD83D\uDDA3'
        };

        // ═══════════════════════════════════════════════════════════════
        // Emit functions
        // ═══════════════════════════════════════════════════════════════

        function emit(level, context, emoji, message) {
            if (!shouldLog(level)) return;
            var em = emoji || CTX_EMOJI[context] || '\u26AA';
            var color = COLORS[level] || '#78909C';
            var pad = (context + '          ').slice(0, 10);
            console.log(
                '%c' + em + ' ' + ts() + ' %c' + SERVER_TAG + ' %c' + pad + '\u25b8 ' + message,
                'color:#616161;',
                'color:#7B1FA2;font-weight:bold;',
                'color:' + color + ';font-weight:bold;'
            );
        }

        function info(context, message) { emit('INFO', context, null, message); }
        function warn(context, message) { emit('WARN', context, null, message); }
        function error(context, message) { emit('ERROR', context, null, message); }
        function debug(context, message) { emit('DEBUG', context, null, message); }

        // ═══════════════════════════════════════════════════════════════
        // Detail lines — pakai ├ └ box drawing
        // ═══════════════════════════════════════════════════════════════

        var DETAIL_COLOR = 'color:#4A148C;opacity:0.85;padding-left:8px;';

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
                console.log('%c' + SERVER_TAG + ' Log level \u2192 ' + level, 'color:#7B1FA2;font-weight:bold;');
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

    window.ChatServerLogger = ChatServerLogger;

    // ═══════════════════════════════════════════════════════════════════
    // 2. CONFIG + MESSAGE_KIND + HELPERS
    // ═══════════════════════════════════════════════════════════════════
    var log = ChatServerLogger;

    var ChatServer = {
        config: {
            chatServerUrl: 'http://127.0.0.1:8002',
            teaKey: 'verification',
            verifyEnable: true,
            delayMin: 30,
            delayMax: 120,
            maxRecordPerRoom: 50,
            maxMessagesPerRequest: 30,
            maxReconnectWaitTime: 600000,
            reconnectionAttempts: 10
        },
        handlers: {},
        _handlerNames: [],
        _handlerCount: 0,
        log: log,
        currentSocket: null
    };

    // MESSAGE_KIND constants (dari main.min.js)
    ChatServer.MESSAGE_KIND = {
        MK_NULL: 0,
        SYSTEM: 1,
        WORLD: 2,
        GUILD: 3,
        PRIVATE: 4,
        WORLD_TEAM: 5,
        TEAM: 6
    };

    // Pure helpers
    ChatServer.randomDelay = function () {
        return Math.floor(Math.random() * (ChatServer.config.delayMax - ChatServer.config.delayMin + 1)) + ChatServer.config.delayMin;
    };

    ChatServer.generateChallenge = function () {
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var result = '';
        for (var i = 0; i < 16; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };

    ChatServer.nowTimestamp = function () {
        return Math.floor(Date.now() / 1000);
    };

    // User profile — baca dari login-server IndexedDB (login-server / loginInfo)
    // Login-server simpan: userId, nickName, channelCode, securityCode, dll
    // Visual fields (headImage, headEffect, headBox) akan tersedia setelah
    // main-server di-update ke IndexedDB — sementara pakai default.
    //
    // Mengapa langsung open DB lain di sini?
    //   Chat-server harus SEMPURNA tanpa localStorage sama sekali.
    //   Login-server sudah bikin DB ini saat login → tinggal baca.

    var _loginDB = null;
    var LOGIN_DB_NAME = 'login-server';
    var LOGIN_STORE_NAME = 'loginInfo';

    function openLoginDB() {
        return new Promise(function (ok, fail) {
            if (_loginDB) { ok(_loginDB); return; }
            var r = indexedDB.open(LOGIN_DB_NAME);
            r.onsuccess = function (e) {
                _loginDB = e.target.result;
                ok(_loginDB);
            };
            r.onerror = function () { fail(new Error('Cannot open ' + LOGIN_DB_NAME)); };
        });
    }

    function readLoginInfo(userId) {
        return openLoginDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction(LOGIN_STORE_NAME, 'readonly');
                var req = tx.objectStore(LOGIN_STORE_NAME).get(userId);
                req.onsuccess = function () { ok(req.result || null); };
                req.onerror = function () { fail(req.error); };
            });
        });
    }

    ChatServer.getUserInfo = function (userId, serverId) {
        return readLoginInfo(userId).then(function (acc) {
            if (!acc) return null;
            // Map loginInfo fields ke format yang chat-server butuhkan
            return {
                nickName:   acc.nickName || '',
                headImage:  acc.headImage || '',
                headEffect: acc.headEffect || '0',
                headBox:    acc.headBox || '0',
                userId:     acc.userId,
                serverId:   acc.serverId || (serverId || '1')
            };
        }).catch(function (e) {
            log.error('DB', 'getUserInfo failed for userId: ' + userId, e);
            return null;
        });
    };

    ChatServer.extractUserProfile = function (profile) {
        // profile sudah di-format oleh getUserInfo, atau default jika null
        if (!profile) {
            return { nickName: '', headImage: '', headEffect: '0', headBox: '0' };
        }
        return {
            nickName:   profile.nickName || '',
            headImage:  profile.headImage || '',
            headEffect: String(profile.headEffect || 0),
            headBox:    String(profile.headBox || 0)
        };
    };
    window.ChatServer = ChatServer;

    // ═══════════════════════════════════════════════════════════════════
    // 3. INDEXEDDB
    // ═══════════════════════════════════════════════════════════════════
    // Database: chatData
    //   — dari ts.chatData di main.min.js (in-memory chat storage game)
    // Store: chatData
    //   — semua chat message, index by roomId dan _time
    //
    // Catatan: game asli TIDAK pakai IndexedDB untuk chat (murni in-memory
    // ts.chatData + server-side). Kita pakai IndexedDB untuk persistence
    // offline. User profile dari login-server IndexedDB (login-server/loginInfo).

    var DB_NAME = 'chatData';
    var DB_VERSION = 1;
    var _idb = null;

    function openDB() {
        return new Promise(function (ok, fail) {
            if (_idb) { ok(_idb); return; }
            var r = indexedDB.open(DB_NAME, DB_VERSION);
            r.onupgradeneeded = function (e) {
                var db = e.target.result;

                // chatData — semua chat message (satu-satunya store)
                if (!db.objectStoreNames.contains('chatData')) {
                    var store = db.createObjectStore('chatData', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('roomId', 'roomId', { unique: false });
                    store.createIndex('_time', '_time', { unique: false });
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

    // Generic IDB helpers
    function idbGet(storeName, key) {
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction(storeName, 'readonly');
                var req = tx.objectStore(storeName).get(key);
                req.onsuccess = function () { ok(req.result || null); };
                req.onerror = function () { fail(req.error); };
            });
        });
    }

    function idbPut(storeName, data) {
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                var req = store.put(data);
                req.onsuccess = function () { ok(data); };
                req.onerror = function () { fail(req.error); };
            });
        });
    }

    function idbDelete(storeName, key) {
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction(storeName, 'readwrite');
                var req = tx.objectStore(storeName).delete(key);
                req.onsuccess = function () { ok(); };
                req.onerror = function () { fail(req.error); };
            });
        });
    }

    function idbGetAllByIndex(storeName, indexName, value) {
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var index = store.index(indexName);
                var req = index.getAll(value);
                req.onsuccess = function () { ok(req.result || []); };
                req.onerror = function () { fail(req.error); };
            });
        });
    }

    ChatServer.db = {
        open: openDB,
        get: function (store, key) { return idbGet(store, key); },
        put: function (store, data) { return idbPut(store, data); },
        delete: function (store, key) { return idbDelete(store, key); },
        getAllByIndex: function (store, indexName, value) { return idbGetAllByIndex(store, indexName, value); }
    };

    // ═══════════════════════════════════════════════════════════════════
    // 4. ROOM & NOTIFY MANAGEMENT (in-memory)
    // ═══════════════════════════════════════════════════════════════════
    //
    // In-memory room registry. Socket references stored for Notify emission.
    // Message persistence uses IndexedDB.
    //
    // Evidence:
    //   L114240-114261: listenNotify → socket.on('Notify', fn)
    //     Notify envelope: {ret:'SUCCESS', data:JSON.stringify({_msg:...})}
    //
    // _rooms:       roomId → [socketRef, socketRef, ...]
    // _socketRooms: socketId → [roomId, roomId, ...]

    ChatServer._rooms = {};
    ChatServer._socketRooms = {};

    ChatServer.socketJoinRoom = function (socket, roomId) {
        if (!ChatServer._rooms[roomId]) {
            ChatServer._rooms[roomId] = [];
        }
        var room = ChatServer._rooms[roomId];
        for (var i = 0; i < room.length; i++) {
            if (room[i].id === socket.id) return;
        }
        room.push(socket);
        if (!ChatServer._socketRooms[socket.id]) {
            ChatServer._socketRooms[socket.id] = [];
        }
        var srooms = ChatServer._socketRooms[socket.id];
        if (srooms.indexOf(roomId) === -1) {
            srooms.push(roomId);
        }
    };

    ChatServer.socketLeaveRoom = function (socket, roomId) {
        var room = ChatServer._rooms[roomId];
        if (room) {
            for (var i = room.length - 1; i >= 0; i--) {
                if (room[i].id === socket.id) { room.splice(i, 1); break; }
            }
            if (room.length === 0) delete ChatServer._rooms[roomId];
        }
        var srooms = ChatServer._socketRooms[socket.id];
        if (srooms) {
            var idx = srooms.indexOf(roomId);
            if (idx !== -1) srooms.splice(idx, 1);
        }
    };

    ChatServer.socketLeaveAllRooms = function (socket) {
        var rooms = ChatServer._socketRooms[socket.id] || [];
        for (var i = 0; i < rooms.length; i++) {
            ChatServer.socketLeaveRoom(socket, rooms[i]);
        }
        delete ChatServer._socketRooms[socket.id];
    };

    ChatServer.getRoomSize = function (roomId) {
        return (ChatServer._rooms[roomId] || []).length;
    };

    ChatServer.emitNotifyToRoom = function (roomId, msg, excludeSocket) {
        var room = ChatServer._rooms[roomId] || [];

        if (room.length === 0) {
            log.debug('NOTIFY', 'No sockets in room: ' + roomId);
            return;
        }

        var notifyEnvelope = {
            ret: 'SUCCESS',
            data: JSON.stringify({ _msg: msg }),
            compress: false
        };

        var sentCount = 0;
        for (var i = 0; i < room.length; i++) {
            var targetSocket = room[i];
            if (excludeSocket && targetSocket.id === excludeSocket.id) continue;
            if (!targetSocket.connected) continue;
            try {
                targetSocket._fire('Notify', notifyEnvelope);
                sentCount++;
            } catch (fireErr) {
                log.error('NOTIFY', 'Failed to send Notify to ' + targetSocket.id, fireErr);
            }
        }

        log.debug('NOTIFY', 'Broadcast complete');
        log.details([
            ['roomId', roomId],
            ['roomSize', String(room.length)],
            ['sentTo', String(sentCount)],
            ['excluded', excludeSocket ? excludeSocket.id : '(none)']
        ]);
    };

    window.ChatServer = ChatServer;

    // ═══════════════════════════════════════════════════════════════════
    // 5. LOAD ACTIONS (actions/*.js)
    // ═══════════════════════════════════════════════════════════════════
    var actionFiles = [
        'actions/chatLogin.js',
        'actions/joinRoom.js',
        'actions/leaveRoom.js',
        'actions/sendMsg.js',
        'actions/getRecord.js'
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
                '\uD83D\uDCC2 %c' + hh + ':' + mm + ' %c[CHAT-SERVER] %cBOOT \u25b8 ' + mark + ' Ready',
                'color:#616161;',
                'color:#7B1FA2;font-weight:bold;',
                'color:#2196F3;font-weight:bold;'
            );
            var SC = 'color:#4A148C;opacity:0.85;';
            console.log('%c  \u00b7 \uD83D\uDCE6 ' + actionFiles.length + ' actions', SC);
            console.log('%c  \u00b7 \u23f1\uFE0F ' + totalLoadTime + 'ms', SC);
            console.log('%c  \u00b7 \uD83D\uDCBE ' + DB_NAME, SC);
            console.log('%c  \u00b7 \uD83D\uDCCB ' + ChatServer._handlerNames.length + ' handlers', SC);
            console.log('%c  \u00b7 \uD83D\uDD17 ' + ChatServer.config.chatServerUrl, SC);

            // ── Detail tabel (collapsed) ──
            console.groupCollapsed('%c  \u2022 Load Details', 'color:#4A148C;opacity:0.7;');
            console.table(loadResults);
            console.log('%c  \u254c\u2500\u2500\u2500 \u2699\uFE0F CONFIG \u2500\u2500\u2500', 'color:#4A148C;opacity:0.6;font-weight:bold;');
            var configRows = [];
            var cfg = ChatServer.config;
            configRows.push({ key: 'chatServerUrl', value: cfg.chatServerUrl });
            configRows.push({ key: 'teaKey', value: cfg.teaKey });
            configRows.push({ key: 'verifyEnable', value: String(cfg.verifyEnable) });
            configRows.push({ key: 'delayMin', value: String(cfg.delayMin) + 'ms' });
            configRows.push({ key: 'delayMax', value: String(cfg.delayMax) + 'ms' });
            configRows.push({ key: 'maxRecordPerRoom', value: String(cfg.maxRecordPerRoom) });
            configRows.push({ key: 'maxMessagesPerRequest', value: String(cfg.maxMessagesPerRequest) });
            configRows.push({ key: 'reconnectionAttempts', value: String(cfg.reconnectionAttempts) });
            console.table(configRows);
            console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCCB HANDLERS \u2500\u2500\u2500', 'color:#4A148C;opacity:0.6;font-weight:bold;');
            var handlerRows = [];
            for (var hi = 0; hi < ChatServer._handlerNames.length; hi++) {
                handlerRows.push({ index: '[' + hi + ']', action: ChatServer._handlerNames[hi], status: '\u2705' });
            }
            if (handlerRows.length > 0) {
                console.table(handlerRows);
            }
            console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCBE STORAGE \u2500\u2500\u2500', 'color:#4A148C;opacity:0.6;font-weight:bold;');
            console.log('%c  DB: ' + DB_NAME + ' | Store: chatData | basePath: ' + basePath, 'color:#4A148C;opacity:0.7;');
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
            log.error('LOAD', 'CRITICAL: Failed to load ' + fileName);
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
    // 6. ROUTER / DISPATCHER
    // ═══════════════════════════════════════════════════════════════════
    // Routes request.action → handler. Only accepts type='chat'.

    var _routeStats = {
        totalRouted: 0,
        totalUnknown: 0,
        totalNoAction: 0,
        totalWrongType: 0,
        totalErrors: 0,
        lastAction: null
    };

    function dispatch(request, callback) {
        var action = request.action || '';
        var type = request.type || '';
        _routeStats.totalRouted++;
        _routeStats.lastAction = action;

        if (!action) {
            _routeStats.totalNoAction++;
            log.error('ROUTE', 'No action field in request!');
            log.alwaysDetails([
                ['type', type || '(empty)'],
                ['requestKeys', Object.keys(request || {}).join(', ')],
                ['requestDump', JSON.stringify(request || {}).substring(0, 300)]
            ]);
            callback({});
            return;
        }

        if (type !== 'chat') {
            _routeStats.totalWrongType++;
            log.error('ROUTE', 'Wrong type — expected "chat"');
            log.alwaysDetails([
                ['receivedType', type || '(empty)'],
                ['expectedType', 'chat'],
                ['action', action],
                ['totalWrongType', String(_routeStats.totalWrongType)]
            ]);
            callback({});
            return;
        }

        var handler = ChatServer.handlers[action];

        if (typeof handler === 'function') {
            try {
                handler(request, callback);
            } catch (handlerErr) {
                _routeStats.totalErrors++;
                log.error('ROUTE', 'Handler "' + action + '" threw UNCAUGHT ERROR');
                log.alwaysDetails([
                    ['action', action],
                    ['errorName', handlerErr.name || '(unknown)'],
                    ['errorMessage', handlerErr.message || String(handlerErr)]
                ]);
                callback({});
            }
        } else {
            _routeStats.totalUnknown++;
            log.error('ROUTE', 'Unknown action: "' + action + '"');
            log.alwaysDetails([
                ['requested', action],
                ['totalUnknown', String(_routeStats.totalUnknown)],
                ['available', '[' + ChatServer._handlerNames.join(', ') + ']']
            ]);
            callback({});
        }
    }

    ChatServer.router = {
        dispatch: dispatch,
        getStats: function () { return _routeStats; }
    };

    // ═══════════════════════════════════════════════════════════════════
    // 7. CHATSOCKET CLASS
    // ═══════════════════════════════════════════════════════════════════
    //
    // Evidence:
    //   L82535: connectWithSocket(url, callback, errorCallback)
    //   L82539: verifyEnable ? socketOnVerify(callback) : callback()
    //   Chat-server: verifyEnable = TRUE → TEA handshake
    //
    // TEA verify flow:
    //   1. Client connects → ChatSocket fires 'connect'
    //   2. ChatSocket fires 'verify' event with challenge string
    //   3. Game client (TSSocketClient.socketOnVerify) encrypts with TEA,
    //      sends back via emit('verify', encrypted, callback)
    //   4. ChatSocket decrypts, compares with original challenge
    //   5. If match → callback({ret: 0}) → game continues to chatLoginRequest

    var _socketCounter = 0;

    function ChatSocket() {
        _socketCounter++;
        this.id = 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
        this._counter = _socketCounter;
        this.connected = false;
        this.disconnected = false;
        this._listeners = {};
        this._emitCount = 0;
        this._verifyChallenge = '';
        this._verified = false;

        var self = this;
        var delay = ChatServer.randomDelay();

        log.info('SOCK', 'ChatSocket #' + this._counter + ' connecting...');

        setTimeout(function () {
            if (self.disconnected) {
                log.warn('SOCK', 'ChatSocket #' + self._counter + ' disconnected BEFORE connect completed');
                return;
            }
            self.connected = true;
            self._fire('connect');

            // ── Socket: judul + summary selalu terlihat, detail tabel di collapsed group ──
            var listenerNames = Object.keys(self._listeners);
            var sockNow = new Date();
            var sockHH = String(sockNow.getHours()).padStart(2, '0');
            var sockMM = String(sockNow.getMinutes()).padStart(2, '0');
            console.log(
                '\uD83D\uDD0C %c' + sockHH + ':' + sockMM + ' %c[CHAT-SERVER] %cSOCK \u25b8 Socket #' + self._counter + ' \u2705 CONNECTED',
                'color:#616161;',
                'color:#7B1FA2;font-weight:bold;',
                'color:#4CAF50;font-weight:bold;'
            );
            var SC = 'color:#4A148C;opacity:0.85;';
            console.log('%c  \u00b7 \u23f1\uFE0F ' + delay + 'ms', SC);
            console.log('%c  \u00b7 \uD83C\uDD94 ' + self.id, SC);
            console.log('%c  \u00b7 \uD83C\uDF75 verify: on', SC);
            console.log('%c  \u00b7 \uD83D\uDD0A ' + listenerNames.length + ' listeners', SC);

            // ── Detail tabel (collapsed) ──
            console.groupCollapsed('%c  \u2022 Socket Details', 'color:#4A148C;opacity:0.7;');
            var socketRows = [
                { key: 'socketId', value: self.id },
                { key: 'target', value: ChatServer.config.chatServerUrl },
                { key: 'verifyEnable', value: 'true' },
                { key: 'teaKey', value: ChatServer.config.teaKey },
                { key: 'delay', value: delay + 'ms' },
                { key: 'emitCount', value: String(self._emitCount) }
            ];
            console.table(socketRows);
            if (listenerNames.length > 0) {
                console.log('%c  listeners: ' + listenerNames.join(', '), 'color:#4A148C;opacity:0.85;');
            }
            console.groupEnd();

            // Setelah connect, mulai TEA verify
            setTimeout(function () {
                if (self.disconnected || !self.connected) {
                    log.warn('TEA', 'Socket gone before verify started');
                    return;
                }
                self._startVerify();
            }, 50);
        }, delay);
    }

    // ── TEA Verify Handshake ──

    ChatSocket.prototype._startVerify = function () {
        var self = this;
        var challenge = ChatServer.generateChallenge();
        this._verifyChallenge = challenge;

        log.info('TEA', 'Starting TEA verify handshake');
        log.details([
            ['challenge', challenge],
            ['key', ChatServer.config.teaKey],
            ['expect', 'Client encrypts with TEA and sends back']
        ]);

        // Fire 'verify' event — game client akan menerima via socket.on('verify', handler)
        this._fire('verify', challenge);

        log.debug('TEA', 'Challenge sent, waiting for client response...');
    };

    ChatSocket.prototype._handleVerifyResponse = function (encrypted, callback) {
        var self = this;
        log.info('TEA', 'Received verify response from client');

        if (!this._verifyChallenge) {
            log.error('TEA', 'No challenge stored — cannot verify');
            if (typeof callback === 'function') callback({ ret: 1 });
            return;
        }

        try {
            var tea = new TEA();
            var decrypted = tea.decrypt(encrypted, ChatServer.config.teaKey);

            if (decrypted === this._verifyChallenge) {
                this._verified = true;
                log.info('TEA', 'TEA verify SUCCESS');
                log.alwaysDetails([
                    ['status', 'VERIFIED'],
                    ['socketId', this.id]
                ]);
                if (typeof callback === 'function') callback({ ret: 0 });
            } else {
                log.error('TEA', 'TEA verify FAILED — decrypted mismatch');
                log.alwaysDetails([
                    ['original', this._verifyChallenge],
                    ['decrypted', decrypted],
                    ['encrypted', encrypted.substring(0, 32) + '...']
                ]);
                if (typeof callback === 'function') callback({ ret: 1 });
            }
        } catch (err) {
            log.error('TEA', 'TEA decrypt threw ERROR', err);
            log.alwaysDetails([
                ['encrypted', encrypted.substring(0, 32) + '...'],
                ['hint', 'TEA class may not be loaded from main.min.js']
            ]);
            if (typeof callback === 'function') callback({ ret: 1 });
        }
    };

    // ── Event Handlers ──

    ChatSocket.prototype.on = function (event, handler) {
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
    };

    ChatSocket.prototype.off = function (event, handler) {
        if (!this._listeners[event]) {
            log.debug('SOCK', 'off() \u2014 no listeners for "' + event + '" on socket #' + this._counter);
            return;
        }
        if (handler) {
            var list = this._listeners[event];
            var before = list.length;
            for (var i = list.length - 1; i >= 0; i--) {
                if (list[i] === handler) list.splice(i, 1);
            }
            log.debug('SOCK', 'off() \u2014 removed ' + (before - list.length) + ' listener(s) from "' + event + '" on socket #' + this._counter);
        } else {
            var count = this._listeners[event].length;
            delete this._listeners[event];
            log.debug('SOCK', 'off() \u2014 removed ALL ' + count + ' listener(s) from "' + event + '" on socket #' + this._counter);
        }
    };

    ChatSocket.prototype.emit = function (event, data, callback) {
        this._emitCount++;
        var emitNum = this._emitCount;
        var actionName = (data && data.action) ? data.action : (event || 'unknown');
        var typeName = (data && data.type) ? data.type : '-';
        var emitStartTime = Date.now();

        // ── TEA Verify response ──
        if (event === 'verify' && !this._verified) {
            log.info('TEA', 'emit #' + emitNum + ' \u2192 TEA verify response');
            this._handleVerifyResponse(data, callback);
            return;
        }

        // ── handler.process ──
        if (event === 'handler.process') {
            if (!this._verified && ChatServer.config.verifyEnable) {
                log.error('EMIT', 'emit #' + emitNum + ' \u2014 handler.process before TEA verify');
                log.alwaysDetails([
                    ['action', actionName],
                    ['socketId', this.id],
                    ['hint', 'TEA handshake must complete first']
                ]);
                return;
            }

            var self = this;
            var delay = ChatServer.randomDelay();

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

                if (!data || typeof data !== 'object') {
                    log.error('EMIT', 'emit #' + emitNum + ' \u2014 invalid data');
                    log.alwaysDetails([
                        ['dataType', typeof data],
                        ['action', actionName],
                        ['socketId', self.id]
                    ]);
                    return;
                }

                // ── Action: judul + summary selalu terlihat, detail req/res di collapsed group ──
                var reqKeys = Object.keys(data);
                var fieldCount = reqKeys.length;
                var emitNow = new Date();
                var emitHH = String(emitNow.getHours()).padStart(2, '0');
                var emitMM = String(emitNow.getMinutes()).padStart(2, '0');
                console.log(
                    '\u2699\uFE0F %c' + emitHH + ':' + emitMM + ' %c[CHAT-SERVER] %cEMIT \u25b8 ' + actionName,
                    'color:#616161;',
                    'color:#7B1FA2;font-weight:bold;',
                    'color:#FF9800;font-weight:bold;'
                );
                var SC = 'color:#4A148C;opacity:0.85;';
                console.log('%c  \u00b7 \uD83D\uDCE4 emit #' + emitNum, SC);
                console.log('%c  \u00b7 \uD83C\uDFF7\uFE0F ' + typeName, SC);
                console.log('%c  \u00b7 \uD83D\uDCCA ' + fieldCount + ' fields', SC);

                // ── Detail req/res (collapsed) ──
                console.groupCollapsed('%c  \u2022 Request / Response', 'color:#4A148C;opacity:0.7;');

                var reqPairs = [];
                for (var k = 0; k < reqKeys.length; k++) {
                    var rk = reqKeys[k];
                    var rv = String(data[rk]);
                    if (rv.length > 120) rv = rv.substring(0, 120) + '... (' + String(data[rk]).length + ' chars)';
                    reqPairs.push([rk, rv]);
                }
                console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCE5 REQUEST \u2500\u2500\u2500', 'color:#4A148C;opacity:0.6;font-weight:bold;');
                log.details(reqPairs);

                var routeStart = Date.now();

                ChatServer.router.dispatch(data, function (responseData) {
                    var routeDuration = Date.now() - routeStart;
                    var totalDuration = Date.now() - emitStartTime;

                    var dataStr;
                    try {
                        dataStr = JSON.stringify(responseData !== undefined && responseData !== null ? responseData : {});
                    } catch (e) {
                        dataStr = '{}';
                    }

                    var envelope = {
                        ret: 0,
                        data: dataStr,
                        compress: false,
                        serverTime: ChatServer.nowTimestamp(),
                        server0Time: Math.abs(new Date().getTimezoneOffset()) * 60 * 1000
                    };

                    console.log('%c  \u254c\u2500\u2500\u2500 \uD83D\uDCE4 RESPONSE \u2500\u2500\u2500', 'color:#4A148C;opacity:0.6;font-weight:bold;');
                    log.details([
                        ['\uD83D\uDD00 dispatched', 'actions/' + actionName + '.js'],
                        ['\uD83D\uDCE4 ret', String(envelope.ret)],
                        ['\uD83D\uDCE4 data', envelope.data.substring(0, 300) + (envelope.data.length > 300 ? '... (' + envelope.data.length + ' chars)' : '')],
                        ['\uD83D\uDCE4 compress', String(envelope.compress)],
                        ['\uD83D\uDCCA serverTime', String(envelope.serverTime)],
                        ['\u23F1\uFE0F routeTime', routeDuration + 'ms'],
                        ['\u23F1\uFE0F scheduleDelay', delay + 'ms'],
                        ['\u23F1\uFE0F total', totalDuration + 'ms']
                    ]);

                    console.groupEnd(); // end req/res detail group

                    if (typeof callback === 'function') {
                        try {
                            callback(envelope);
                        } catch (cbErr) {
                            log.error('ENV', 'emit #' + emitNum + ' callback THREW ERROR');
                            log.alwaysDetails([
                                ['errorName', cbErr.name || '(unknown)'],
                                ['errorMessage', cbErr.message || String(cbErr)]
                            ]);
                        }
                    } else {
                        log.error('ENV', 'emit #' + emitNum + ' \u2014 NO CALLBACK PROVIDED');
                        log.alwaysDetails([
                            ['action', actionName],
                            ['hint', 'Game may hang waiting for response']
                        ]);
                    }

                    ChatServer.currentSocket = null;
                });
            }, delay);
            return;
        }

        // ── Unknown event ──
        log.warn('EMIT', 'emit #' + emitNum + ' \u2014 unhandled event: "' + event + '"');
        log.alwaysDetails([
            ['event', event],
            ['action', actionName],
            ['expected', 'verify, handler.process'],
            ['socketId', this.id]
        ]);
    };

    ChatSocket.prototype.disconnect = function () {
        var hadListeners = Object.keys(this._listeners).length;
        this.connected = false;
        this.disconnected = true;
        this._verified = false;
        ChatServer.socketLeaveAllRooms(this);
        this._fire('disconnect', 'client disconnect');
        log.info('SOCK', 'ChatSocket #' + this._counter + ' disconnected');
        log.details([
            ['socketId', this.id],
            ['totalEmits', String(this._emitCount)],
            ['remainingListeners', String(hadListeners)]
        ]);
    };

    ChatSocket.prototype.destroy = function () {
        var hadListeners = Object.keys(this._listeners).length;
        this.connected = false;
        this.disconnected = true;
        this._verified = false;
        ChatServer.socketLeaveAllRooms(this);
        this._listeners = {};
        log.info('SOCK', 'ChatSocket #' + this._counter + ' destroyed');
        log.details([
            ['socketId', this.id],
            ['totalEmits', String(this._emitCount)],
            ['clearedListeners', String(hadListeners)]
        ]);
    };

    ChatSocket.prototype._fire = function (event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var list = this._listeners[event];

        if (!list || list.length === 0) return;

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

    ChatServer.ChatSocket = ChatSocket;
    window.ChatServer = ChatServer;

    // ═══════════════════════════════════════════════════════════════════
    // 8. INIT — io.connect override
    // ═══════════════════════════════════════════════════════════════════
    // Patch io.connect() untuk intercept chat-server URL.
    // Chat URL bersifat DYNAMIC — datang dari main-server via registChat.
    // Intercept berdasarkan: port 8002 atau chatServerUrl dari config.

    function init() {
        var chatServerUrl = ChatServer.config.chatServerUrl;
        var patched = false;

        function isChatUrl(url) {
            if (!url) return false;
            if (url.indexOf(':8002') !== -1) return true;
            if (url.indexOf(chatServerUrl) !== -1) return true;
            return false;
        }

        function patchIoConnect() {
            if (patched) return;
            if (!window.io || typeof window.io.connect !== 'function') return false;

            // Simpan reference ke CURRENT io.connect (bisa sudah di-patch login-server)
            var currentConnect = window.io.connect;
            patched = true;

            window.io.connect = function (url, options) {
                if (isChatUrl(url)) {
                    var ts2 = new Date();
                    var hh2 = String(ts2.getHours()).padStart(2, '0');
                    var mm2 = String(ts2.getMinutes()).padStart(2, '0');

                    // ── IO: judul + summary selalu terlihat, detail tabel di collapsed group ──
                    console.log(
                        '\uD83C\uDF10 %c' + hh2 + ':' + mm2 + ' %c[CHAT-SERVER] %cIO \u25b8 \u2705 READY',
                        'color:#616161;',
                        'color:#7B1FA2;font-weight:bold;',
                        'color:#4CAF50;font-weight:bold;'
                    );
                    var SC = 'color:#4A148C;opacity:0.85;';
                    console.log('%c  \u00b7 \uD83D\uDD17 ' + url, SC);
                    console.log('%c  \u00b7 \uD83C\uDF75 verify: on', SC);
                    console.log('%c  \u00b7 \uD83D\uDD04 type=chat routing', SC);
                    console.log('%c  \u00b7 \uD83D\uDCE6 ChatSocket', SC);

                    // ── Detail tabel (collapsed) ──
                    console.groupCollapsed('%c  \u2022 IO Config', 'color:#4A148C;opacity:0.7;');
                    console.table([
                        { key: 'serverUrl', value: url },
                        { key: 'verifyEnable', value: 'true' },
                        { key: 'teaKey', value: ChatServer.config.teaKey },
                        { key: 'routing', value: 'type=chat → action dispatch' },
                        { key: 'returnType', value: 'ChatSocket' }
                    ]);
                    console.groupEnd();

                    return new ChatServer.ChatSocket();
                }

                return currentConnect.call(window.io, url, options);
            };

            log.info('TIMER', 'io.connect() patched — CHAT SERVER READY');
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
            log.warn('TIMER', 'MutationObserver not available \u2014 poll only');
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // START
    // ═══════════════════════════════════════════════════════════════════
    loadNextAction();
})();
