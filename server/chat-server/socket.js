/**
 * socket.js — ChatSocket Class
 * Super Warrior Z — CHAT SERVER
 *
 * Meniru Socket.IO socket object untuk chat-server.
 * Chat server: verifyEnable = TRUE, TEA handshake dengan key 'verification'.
 *
 * TEA verify flow:
 *   1. Client connects → ChatSocket fires 'connect'
 *   2. ChatSocket fires 'verify' event dengan challenge string
 *   3. Game client (TSSocketClient.socketOnVerify) menerima challenge,
 *      encrypt dengan TEA key 'verification', kirim balik via emit('verify', encrypted, callback)
 *   4. ChatSocket receive encrypted, decrypt, compare dengan original challenge
 *   5. Jika cocok → callback({ret: 0}) → game lanjut ke chatLoginRequest
 *
 * NO SILENT ERRORS — semua error path di-log.
 */

(function () {
    'use strict';

    var ChatServer = window.ChatServer;
    var log = ChatServer.log;

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

        log.info('SOCK', 'ChatSocket #' + this._counter + ' created');
        log.details('config', [
            ['socketId', this.id],
            ['server', 'CHAT SERVER (verifyEnable=true)'],
            ['teaKey', ChatServer.config.teaKey],
            ['target', ChatServer.config.chatServerUrl]
        ]);

        var self = this;
        var delay = ChatServer.randomDelay();

        log.debug('SOCK', 'Simulating connection delay');
        log.detail('duration', delay + 'ms');

        setTimeout(function () {
            if (self.disconnected) {
                log.warn('SOCK', 'ChatSocket #' + self._counter + ' disconnected before connect completed');
                return;
            }
            self.connected = true;
            self._fire('connect');
            log.info('SOCK', 'ChatSocket #' + self._counter + ' CONNECTED');
            log.details('config', [
                ['socketId', self.id],
                ['status', 'CONNECTED'],
                ['nextStep', 'TEA verify handshake']
            ]);

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

    // ═══════════════════════════════════════════════
    // TEA Verify Handshake
    // ═══════════════════════════════════════════════

    ChatSocket.prototype._startVerify = function () {
        var self = this;
        var challenge = ChatServer.generateChallenge();
        this._verifyChallenge = challenge;

        log.info('TEA', 'Starting TEA verify handshake');
        log.details('challenge', [
            ['challenge', challenge],
            ['key', ChatServer.config.teaKey],
            ['expect', 'Client encrypts with TEA and sends back']
        ]);

        // Fire 'verify' event — game client akan menerima via socket.on('verify', handler)
        // Di TSSocketClient.socketOnVerify:
        //   t.socket.on('verify', function(n) { var o = new TEA().encrypt(n, 'verification'); t.socket.emit('verify', o, callback); });
        this._fire('verify', challenge);

        log.debug('TEA', 'Challenge sent via verify event, waiting for client response...');
    };

    ChatSocket.prototype._handleVerifyResponse = function (encrypted, callback) {
        var self = this;
        log.info('TEA', 'Received verify response from client');

        if (!this._verifyChallenge) {
            log.error('TEA', 'No challenge stored — cannot verify');
            if (typeof callback === 'function') callback({ ret: 1 });
            return;
        }

        // Decrypt menggunakan TEA class dari main.min.js
        try {
            var tea = new TEA();
            var decrypted = tea.decrypt(encrypted, ChatServer.config.teaKey);

            log.debug('TEA', 'Decryption completed');
            log.details('challenge', [
                ['original', this._verifyChallenge],
                ['decrypted', decrypted],
                ['match', String(decrypted === this._verifyChallenge)]
            ]);

            if (decrypted === this._verifyChallenge) {
                this._verified = true;
                log.info('TEA', 'TEA verify SUCCESS');
                log.importantDetails('response', [
                    ['status', 'VERIFIED'],
                    ['socketId', this.id]
                ]);
                if (typeof callback === 'function') callback({ ret: 0 });
            } else {
                log.error('TEA', 'TEA verify FAILED — decrypted mismatch');
                log.importantDetails('error', [
                    ['original', this._verifyChallenge],
                    ['decrypted', decrypted],
                    ['encrypted', encrypted.substring(0, 32) + '...']
                ]);
                if (typeof callback === 'function') callback({ ret: 1 });
            }
        } catch (err) {
            log.error('TEA', 'TEA decrypt threw ERROR', err);
            log.importantDetails('error', [
                ['encrypted', encrypted.substring(0, 32) + '...'],
                ['hint', 'TEA class may not be loaded from main.min.js']
            ]);
            if (typeof callback === 'function') callback({ ret: 1 });
        }
    };

    // ═══════════════════════════════════════════════
    // Event Handlers
    // ═══════════════════════════════════════════════

    ChatSocket.prototype.on = function (event, handler) {
        if (typeof handler !== 'function') {
            log.error('SOCK', 'on() called with non-function handler for: "' + event + '"');
            log.importantDetails('error', [
                ['event', event],
                ['handlerType', typeof handler]
            ]);
            return;
        }
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(handler);
        log.debug('SOCK', 'Listener registered: "' + event + '" (' + this._listeners[event].length + ' total)');
    };

    ChatSocket.prototype.off = function (event, handler) {
        if (!this._listeners[event]) {
            log.debug('SOCK', 'off() — no listeners for "' + event + '"');
            return;
        }
        if (handler) {
            var list = this._listeners[event];
            var before = list.length;
            for (var i = list.length - 1; i >= 0; i--) {
                if (list[i] === handler) list.splice(i, 1);
            }
            log.debug('SOCK', 'off() — removed ' + (before - list.length) + ' listener(s) from "' + event + '"');
        } else {
            var count = this._listeners[event].length;
            delete this._listeners[event];
            log.debug('SOCK', 'off() — removed ALL ' + count + ' listener(s) from "' + event + '"');
        }
    };

    ChatSocket.prototype.emit = function (event, data, callback) {
        this._emitCount++;
        var emitNum = this._emitCount;
        var actionName = (data && data.action) ? data.action : (event || 'unknown');
        var emitStartTime = Date.now();

        log.info('SOCK', 'emit #' + emitNum + ': "' + event + '"');
        log.details('data', [
            ['action', data && data.action ? data.action : '(none)'],
            ['userId', (data && data.userId) ? data.userId : '-'],
            ['hasCallback', String(typeof callback === 'function')]
        ]);

        // ── TEA Verify response ──
        if (event === 'verify' && !this._verified) {
            log.info('TEA', 'emit #' + emitNum + ' → TEA verify response');
            this._handleVerifyResponse(data, callback);
            return;
        }

        // ── handler.process ──
        if (event === 'handler.process') {
            if (!this._verified && ChatServer.config.verifyEnable) {
                log.error('SOCK', 'emit #' + emitNum + ' — handler.process before TEA verify');
                log.importantDetails('error', [
                    ['action', actionName],
                    ['socketId', this.id],
                    ['hint', 'TEA handshake must complete first']
                ]);
                return;
            }

            var self = this;
            var delay = ChatServer.randomDelay();

            log.debug('SOCK', 'Scheduling handler.process');
            log.detail('duration', delay + 'ms');

            setTimeout(function () {
                if (!self.connected) {
                    log.error('SOCK', 'emit #' + emitNum + ' FAILED — socket disconnected');
                    log.importantDetails('error', [
                        ['action', actionName],
                        ['socketId', self.id]
                    ]);
                    return;
                }

                if (!data || typeof data !== 'object') {
                    log.error('SOCK', 'emit #' + emitNum + ' — invalid data');
                    log.importantDetails('error', [
                        ['dataType', typeof data],
                        ['action', actionName]
                    ]);
                    return;
                }

                log.info('ROUTE', 'emit #' + emitNum + ' → routing: ' + actionName);

                // Store current socket untuk handlers yang butuh akses socket
                ChatServer.currentSocket = self;

                var routeStart = Date.now();

                ChatServer.router.handle(data, function (response) {
                    var routeDuration = Date.now() - routeStart;
                    var totalDuration = Date.now() - emitStartTime;

                    var envelope = {
                        ret: 0,
                        data: JSON.stringify(response),
                        compress: false,
                        serverTime: Math.floor(Date.now() / 1000),
                        server0Time: Math.abs(new Date().getTimezoneOffset()) * 60 * 1000
                    };

                    log.info('SOCK', 'emit #' + emitNum + ' → response ready');
                    log.importantDetails('response', [
                        ['action', actionName],
                        ['ret', String(envelope.ret)],
                        ['dataSize', envelope.data.length + ' chars'],
                        ['serverTime', String(envelope.serverTime)]
                    ]);
                    log.importantDetails('duration', [
                        ['routeTime', routeDuration + 'ms'],
                        ['totalEmitTime', totalDuration + 'ms']
                    ]);

                    if (typeof callback === 'function') {
                        try {
                            callback(envelope);
                            log.debug('SOCK', 'emit #' + emitNum + ' callback OK');
                        } catch (cbErr) {
                            log.error('SOCK', 'emit #' + emitNum + ' callback THREW ERROR', cbErr);
                        }
                    } else {
                        log.error('SOCK', 'emit #' + emitNum + ' — NO CALLBACK!');
                        log.importantDetails('error', [
                            ['action', actionName],
                            ['hint', 'Game may hang waiting for response']
                        ]);
                    }

                    // Clear socket reference
                    ChatServer.currentSocket = null;
                });
            }, delay);
            return;
        }

        // ── Unknown event ──
        log.warn('SOCK', 'emit #' + emitNum + ' — unhandled event: "' + event + '"');
        log.importantDetails('important', [
            ['event', event],
            ['expected', 'verify, handler.process']
        ]);
    };

    ChatSocket.prototype.disconnect = function () {
        var hadListeners = Object.keys(this._listeners).length;
        this.connected = false;
        this.disconnected = true;
        this._verified = false;
        // Remove from all rooms so Notify stops firing to this socket
        ChatServer.socketLeaveAllRooms(this);
        this._fire('disconnect', 'client disconnect');
        log.info('SOCK', 'ChatSocket #' + this._counter + ' disconnected');
        log.details('data', [
            ['totalEmits', String(this._emitCount)],
            ['remainingListeners', String(hadListeners)]
        ]);
    };

    ChatSocket.prototype.destroy = function () {
        var hadListeners = Object.keys(this._listeners).length;
        this.connected = false;
        this.disconnected = true;
        this._verified = false;
        // Remove from all rooms
        ChatServer.socketLeaveAllRooms(this);
        this._listeners = {};
        log.info('SOCK', 'ChatSocket #' + this._counter + ' destroyed');
        log.details('data', [
            ['totalEmits', String(this._emitCount)],
            ['clearedListeners', String(hadListeners)]
        ]);
    };

    ChatSocket.prototype._fire = function (event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var list = this._listeners[event];

        if (!list || list.length === 0) {
            log.debug('SOCK', '_fire: no listeners for "' + event + '"');
            return;
        }

        log.debug('SOCK', '_fire: "' + event + '" → ' + list.length + ' listener(s)');

        for (var i = 0; i < list.length; i++) {
            try {
                list[i].apply(null, args);
            } catch (e) {
                log.error('SOCK', '_fire: listener #' + (i + 1) + ' for "' + event + '" threw error', e);
            }
        }
    };

    ChatServer.ChatSocket = ChatSocket;
    window.ChatServer = ChatServer;
})();
