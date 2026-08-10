/**
 * index.js — Chat Server Entry Point
 * Super Warrior Z — CHAT SERVER
 *
 * Titik masuk tunggal. Load: logger.js → config.js → socket.js → handlers.js → router.js
 * Semua file di folder chat-server sendiri.
 *
 * Patch io.connect() untuk intercept chat-server URL.
 * Chat URL bersifat DYNAMIC — datang dari main-server via registChat.
 * Intercept berdasarkan: port 8002 atau chatServerUrl dari config.
 */

(function () {
    'use strict';

    function preLog(msg) {
        console.log('%c[CHAT] ' + msg, 'color:#7B1FA2;font-weight:bold;');
    }

    function preError(msg) {
        console.log('%c[CHAT] ' + msg, 'color:#F44336;font-weight:bold;');
    }

    preLog('Chat server loading...');

    // ── Auto-detect base path ──
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

    // ── logger.js MUST load first ──
    var deps = ['logger.js', 'config.js', 'socket.js', 'handlers.js', 'router.js'];
    var loaded = 0;
    var loadStartTime = Date.now();
    var _criticalError = false;

    function loadNext() {
        if (_criticalError) return;

        if (loaded >= deps.length) {
            preLog('All ' + deps.length + ' deps loaded (' + (Date.now() - loadStartTime) + 'ms)');
            init();
            return;
        }

        var depName = deps[loaded];
        var depPath = basePath + depName;
        var depStart = Date.now();

        preLog('Loading [' + (loaded + 1) + '/' + deps.length + ']: ' + depName);

        var script = document.createElement('script');
        script.src = depPath;
        script.async = false;

        script.onload = function () {
            preLog('  OK: ' + depName + ' (' + (Date.now() - depStart) + 'ms)');
            script.parentNode.removeChild(script);
            loaded++;
            loadNext();
        };

        script.onerror = function () {
            _criticalError = true;
            preError('CRITICAL: Failed to load: ' + depName);
            preError('  URL: ' + depPath);
            preError('  Loaded so far: [' + deps.slice(0, loaded).join(', ') + ']');
            preError('  CHAT SERVER CANNOT START');
            preError('  Fix: check file exists in ' + basePath);
        };

        (document.head || document.documentElement).appendChild(script);
    }

    // ── Init ──
    function init() {
        var ChatServer = window.ChatServer;
        var log = ChatServer.log;
        var chatServerUrl = ChatServer.config.chatServerUrl;
        var patched = false;

        log.info('INIT', 'Chat server v1.0 starting...');
        log.details('config', [
            ['chatServerUrl', chatServerUrl],
            ['apiBase', ChatServer.config.apiBase],
            ['teaKey', ChatServer.config.teaKey],
            ['verifyEnable', String(ChatServer.config.verifyEnable)],
            ['delayRange', ChatServer.config.delayMin + '-' + ChatServer.config.delayMax + 'ms'],
            ['maxRecordPerRoom', String(ChatServer.config.maxRecordPerRoom)]
        ]);

        var handlerNames = ChatServer._handlerNames || [];
        log.info('INIT', 'Handler registry: ' + handlerNames.length + ' action(s)');
        if (handlerNames.length > 0) {
            var pairs = [];
            for (var i = 0; i < handlerNames.length; i++) {
                pairs.push(['handler[' + i + ']', handlerNames[i]]);
            }
            log.details('config', pairs);
        }

        log.info('LOAD', 'All deps loaded (' + (Date.now() - loadStartTime) + 'ms)');
        log.detail('data', 'logLevel: ' + log.level);

        // ═══════════════════════════════════════════════
        // Patch io.connect() — intercept chat-server URL
        // ═══════════════════════════════════════════════
        function isChatUrl(url) {
            if (!url) return false;
            // Cek port 8002
            if (url.indexOf(':8002') !== -1) return true;
            // Cek exact match dengan config
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
                log.info('IO', 'io.connect() → ' + (url || '(none)'));

                if (isChatUrl(url)) {
                    log.info('IO', 'INTERCEPTED → CHAT SERVER (ChatSocket)');
                    log.details('config', [
                        ['url', url],
                        ['verifyEnable', 'true'],
                        ['teaKey', ChatServer.config.teaKey]
                    ]);
                    return new ChatServer.ChatSocket();
                }

                log.debug('IO', 'PASS THROUGH → ' + url);
                return currentConnect.call(window.io, url, options);
            };

            log.info('IO', 'io.connect() patched — CHAT SERVER READY');
            log.details('config', [
                ['interceptCondition', 'port 8002 or chatServerUrl match'],
                ['verifyEnable', 'true'],
                ['teaKey', ChatServer.config.teaKey]
            ]);
            return true;
        }

        // ── Poll for window.io ──
        log.info('TIMER', 'Waiting for main.min.js to expose window.io...');

        var pollCount = 0;
        var pollTimer = setInterval(function () {
            if (patched) { clearInterval(pollTimer); return; }
            if (++pollCount > 300) {
                clearInterval(pollTimer);
                log.error('INIT', 'window.io NOT found after 30s');
                log.importantDetails('error', [
                    ['hint', 'main.min.js may not have loaded or io not on window']
                ]);
                return;
            }
            if (pollCount % 50 === 0) {
                log.debug('TIMER', 'Still waiting... (' + (pollCount * 100) + 'ms)');
            }
            if (patchIoConnect()) clearInterval(pollTimer);
        }, 100);

        // ── MutationObserver fallback ──
        if (typeof MutationObserver !== 'undefined') {
            var observer = new MutationObserver(function () {
                if (!patched && window.io && typeof window.io.connect === 'function') {
                    log.info('IO', 'MutationObserver detected window.io');
                    patchIoConnect();
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(function () { observer.disconnect(); }, 60000);
        } else {
            log.warn('INIT', 'MutationObserver not available');
        }
    }

    loadNext();
})();
