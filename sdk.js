/**
 * sdk.js — Super Warrior Z SDK Client (PPGAME)
 * Referensi: sdk.md — Full Specification (v6.0)
 *
 * Ini ADALAH PPGAME — SDK Client yang bekerja sama dengan SDK-Server.
 * Game engine (main.min.js) berkomunikasi melalui window.* functions.
 *
 * Loading Order: sdk.js dimuat SEBELUM game code (main.min.js)
 * Blocking: window.checkSDK() return false sampai login selesai
 *
 * Kontrak utama:
 *   window.checkSDK()         → true (setelah login)
 *   window.getSdkLoginInfo()  → {sdk, loginToken, nickName, userId, sign, security}
 *   window.PPGAME            → {createPaymentOrder, playerEnterServer, submitEvent, ...}
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONFIG
    // ═══════════════════════════════════════════════════════════════
    var SDK_SERVER = './server/sdk-server';
    var CHANNEL = 'ppgame';
    var STORAGE_KEY = 'ppgame_login';

    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════
    var _loginInfo = null;      // Cached login data {sdk, loginToken, nickName, userId, sign, security}
    var _sdkReady = false;      // false = blocking, true = game can init
    var _exitCallback = null;   // Registered via window.accountLoginCallback
    var _loginUI = null;        // Reference to login overlay DOM element
    var _paymentUI = null;      // Reference to payment modal DOM element

    // ═══════════════════════════════════════════════════════════════
    // LOG SYSTEM — Eruda Console (Browser)
    // Referensi: sdk.md Section 21.4
    // ═══════════════════════════════════════════════════════════════
    var _logLevel = (function () {
        try { return localStorage.getItem('SDK_LOG_LEVEL') || 'INFO'; }
        catch (e) { return 'INFO'; }
    })();

    var _LOG_PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 99 };
    var _minPriority = _LOG_PRIORITY[_logLevel] !== undefined ? _LOG_PRIORITY[_logLevel] : 1;

    var _LEVEL_EMOJI = { INFO: '🟢', WARN: '🟡', ERROR: '🔴', DEBUG: '🔵' };
    var _MODULE_EMOJI = {
        AUTH: '🛡️', PAY: '💳', SIGN: '🔑', NOTIFY: '📨',
        SDK: '⚡', NET: '🌐', GAME: '🎮', REPORT: '📊',
        SESSION: '🔐', UI: '🖥️'
    };
    var _DETAIL_EMOJI = {
        data: '📋', important: '📌', duration: '⏱️',
        location: '📍', config: '⚙️'
    };

    function _levelColor(level) {
        var c = { INFO: '#4CAF50', WARN: '#FF9800', ERROR: '#F44336', DEBUG: '#2196F3' };
        return c[level] || '#9E9E9E';
    }

    function _ts() {
        var d = new Date();
        return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function _shouldLog(level) {
        var p = _LOG_PRIORITY[level];
        return p !== undefined && p >= _minPriority;
    }

    // Header line — level + module + message
    function _logHeader(level, module, message) {
        if (!_shouldLog(level)) return;
        var lvE = _LEVEL_EMOJI[level] || '⚪';
        var mdE = _MODULE_EMOJI[module] || '⚪';
        var modPad = (module + '   ').slice(0, 6);
        var prefix = '%c' + lvE + ' ' + _ts() + ' %c' + level.padEnd(5) + ' %c' + mdE + ' ' + modPad + ' ▸ ' + message;
        console.log(
            prefix,
            'color:#757575;',
            'color:' + _levelColor(level) + ';font-weight:bold;',
            'color:#9C27B0;font-weight:bold;'
        );
    }

    // Detail line — single
    function _logDetail(type, text) {
        var emoji = _DETAIL_EMOJI[type] || '📋';
        console.log('%c  └ ' + emoji + ' ' + text, 'color:#616161;padding-left:8px;');
    }

    // Multi-detail — tree connector
    function _logDetails(type, pairs) {
        var emoji = _DETAIL_EMOJI[type] || '📋';
        for (var i = 0; i < pairs.length; i++) {
            var connector = i < pairs.length - 1 ? '├' : '└';
            var line = pairs[i][0] + ': ' + pairs[i][1];
            console.log('%c  ' + connector + ' ' + emoji + ' ' + line, 'color:#616161;padding-left:8px;');
        }
    }

    // Boundary — startup/shutdown
    function _logBoundary(emoji, message) {
        console.log('%c' + emoji + ' ' + '═'.repeat(50), 'color:#E91E63;font-weight:bold;font-size:13px;');
        console.log('%c   ' + message, 'color:white;font-weight:bold;font-size:13px;');
    }

    function _logBoundaryEnd(emoji) {
        console.log('%c' + emoji + ' ' + '═'.repeat(50), 'color:#E91E63;font-weight:bold;font-size:13px;');
    }

    // ═══════════════════════════════════════════════════════════════
    // HTTP HELPER
    // ═══════════════════════════════════════════════════════════════
    function _post(path, data) {
        return new Promise(function (resolve, reject) {
            var startTime = Date.now();
            var url = SDK_SERVER + path;
            var payload = JSON.stringify(data || {});

            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 10000;

            xhr.onload = function () {
                var duration = Date.now() - startTime;
                _logHeader('DEBUG', 'NET', 'POST ' + url);
                _logDetail('duration', duration + 'ms');

                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        resolve(xhr.responseText);
                    }
                } else {
                    reject({ status: xhr.status, message: xhr.statusText });
                }
            };

            xhr.onerror = function () {
                var duration = Date.now() - startTime;
                _logHeader('ERROR', 'NET', 'Network error');
                _logDetails('important', [
                    ['url', 'POST ' + url],
                    ['error', 'Connection refused — SDK-Server not reachable'],
                    ['duration', duration + 'ms']
                ]);
                reject({ status: 0, message: 'Network error — SDK-Server not reachable' });
            };

            xhr.ontimeout = function () {
                _logHeader('ERROR', 'NET', 'Request timeout');
                _logDetail('location', 'POST ' + url);
                reject({ status: 0, message: 'Request timeout' });
            };

            xhr.send(payload);
        });
    }

    function _get(path) {
        return new Promise(function (resolve, reject) {
            var startTime = Date.now();
            var url = SDK_SERVER + path;

            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = 10000;

            xhr.onload = function () {
                var duration = Date.now() - startTime;
                _logHeader('DEBUG', 'NET', 'GET ' + url);
                _logDetail('duration', duration + 'ms');

                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        resolve(xhr.responseText);
                    }
                } else {
                    reject({ status: xhr.status, message: xhr.statusText });
                }
            };

            xhr.onerror = function () {
                reject({ status: 0, message: 'Network error' });
            };

            xhr.ontimeout = function () {
                reject({ status: 0, message: 'Request timeout' });
            };

            xhr.send();
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 1. BLOCK GAME INIT
    // Referensi: sdk.md Section 4.2, 16.2
    // ═══════════════════════════════════════════════════════════════
    window.checkSDK = function () {
        return _sdkReady;
    };

    // ═══════════════════════════════════════════════════════════════
    // 2. LOGIN INFO GETTER
    // Referensi: sdk.md Section 3.1, 6.1
    // ═══════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════════
    // 3. PPGAME OBJECT
    // Referensi: sdk.md Section 5, 15.5
    // ═══════════════════════════════════════════════════════════════
    window.PPGAME = {

        // ─── Payment ───
        // Referensi: sdk.md Section 8
        createPaymentOrder: function (orderData) {
            _logHeader('INFO', 'PAY', 'window.paySdk() called');
            _logDetail('data', '→ PPGAME.createPaymentOrder(orderData)');

            if (!orderData) {
                _logHeader('WARN', 'PAY', 'No orderData provided');
                return;
            }

            _logHeader('INFO', 'PAY', 'Creating payment order');
            _logDetails('data', [
                ['orderId', orderData.orderId || ''],
                ['product', orderData.productName || orderData.productId || ''],
                ['price', (orderData.price || 0) + ' ' + (orderData.currency || 'USD')]
            ]);

            _post('/payment.php?action=create', orderData)
                .then(function (resp) {
                    if (resp && resp.paymentId) {
                        _logHeader('INFO', 'PAY', 'Payment order created');
                        _logDetails('data', [
                            ['paymentId', resp.paymentId],
                            ['status', resp.status]
                        ]);
                        // Tampilkan Payment Confirmation UI
                        _createPaymentUI(orderData, resp.paymentId);
                    } else {
                        _logHeader('ERROR', 'PAY', 'Payment creation failed — invalid response');
                        _logDetail('important', 'response: ' + JSON.stringify(resp));
                    }
                })
                .catch(function (err) {
                    _logHeader('ERROR', 'PAY', 'Payment creation failed');
                    _logDetails('important', [
                        ['status', err.status],
                        ['error', err.message]
                    ]);
                });
        },

        // ─── Reporting ───
        // Referensi: sdk.md Section 9, 15.5
        playerEnterServer: function (data) {
            _logHeader('INFO', 'REPORT', 'PPGAME.playerEnterServer()');
            _logDetail('data', 'serverId: ' + (data.serverId || '') + ' · character: ' + (data.characterName || ''));
            _post('/event.php?action=report', {
                eventType: 'enterServer',
                userId: _loginInfo ? _loginInfo.userId : '',
                data: data
            }).catch(function () {});
        },

        submitEvent: function (eventName, data) {
            _logHeader('INFO', 'REPORT', 'PPGAME.submitEvent("' + eventName + '")');
            _post('/event.php?action=report', {
                eventType: eventName,
                userId: _loginInfo ? _loginInfo.userId : '',
                data: data || {}
            }).catch(function () {});
        },

        // ─── Game Lifecycle ───
        gameReady: function () {
            _logHeader('INFO', 'GAME', 'window.gameReady() called');
            _logDetail('data', '→ PPGAME.gameReady()');
            _post('/event.php?action=report', {
                eventType: 'gameReady',
                userId: _loginInfo ? _loginInfo.userId : '',
                data: {}
            }).catch(function () {});
        },

        gameChapterFinish: function (chapterId) {
            _logHeader('INFO', 'REPORT', 'PPGAME.gameChapterFinish(' + chapterId + ')');
            _post('/event.php?action=report', {
                eventType: 'chapterFinish',
                userId: _loginInfo ? _loginInfo.userId : '',
                data: { chapterId: chapterId }
            }).catch(function () {});
        },

        openShopPage: function () {
            _logHeader('INFO', 'GAME', 'PPGAME.openShopPage()');
            // No-op for PPGAME — tidak ada external shop page
        },

        gameLevelUp: function (level) {
            _logHeader('INFO', 'REPORT', 'PPGAME.gameLevelUp(' + level + ')');
            _post('/event.php?action=report', {
                eventType: 'levelUp',
                userId: _loginInfo ? _loginInfo.userId : '',
                data: { level: level }
            }).catch(function () {});
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // 4. WINDOW WRAPPER FUNCTIONS
    // Referensi: sdk.md Section 3, 5.4, 5.5
    // ═══════════════════════════════════════════════════════════════

    // paySdk — Bridge ke PPGAME.createPaymentOrder
    window.paySdk = function (a) {
        window.PPGAME.createPaymentOrder(a);
    };

    // gameReady — Bridge ke PPGAME.gameReady
    window.gameReady = function () {
        window.PPGAME.gameReady();
    };

    // report2Sdk — Routing logic
    // Referensi: sdk.md Section 5.4
    window.report2Sdk = function (a) {
        if (!a) return;

        if (a.dataType == 3) {
            // dataType 3 = EnterGame → playerEnterServer
            window.PPGAME.playerEnterServer({
                characterName: a.roleName,
                characterId: a.roleID,
                serverId: a.serverID,
                serverName: a.serverName
            });
        } else if (a.dataType == 2) {
            // dataType 2 = CreateRole → submitEvent
            window.PPGAME.submitEvent('game_create_role', {
                characterName: a.roleName,
                characterId: a.roleID,
                serverId: a.serverID,
                serverName: a.serverName
            });
        }
        // dataType lain: SILENT — PPGAME bridge tidak handle
    };

    // gameChapterFinish
    window.gameChapterFinish = function (a) {
        window.PPGAME.gameChapterFinish(a);
    };

    // openShopPage
    window.openShopPage = function () {
        window.PPGAME.openShopPage();
    };

    // gameLevelUp
    window.gameLevelUp = function (a) {
        window.PPGAME.gameLevelUp(a);
    };

    // tutorialFinish
    window.tutorialFinish = function () {
        window.PPGAME.submitEvent('game_tutorial_finish');
    };

    // getAppId — Sub-channel ID. PPGAME: ''
    window.getAppId = function () {
        return '';
    };

    // getLoginServer — Return '' → fallback ke serversetting.json
    window.getLoginServer = function () {
        return '';
    };

    // checkFromNative — PPGAME: false
    window.checkFromNative = function () {
        return false;
    };

    // accountLoginCallback — Register exit callback
    window.accountLoginCallback = function (fn) {
        _exitCallback = fn;
    };

    // switchAccount — Reload login UI
    window.switchAccount = function () {
        _sdkReady = false;
        _loginInfo = null;
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        _createLoginUI();
    };

    // openURL — Buka URL di browser
    window.openURL = function (url) {
        window.open(url, '_blank');
    };

    // changeLanguage — Ubah bahasa SDK
    window.changeLanguage = function (lang) {
        _logHeader('DEBUG', 'SDK', 'changeLanguage(' + lang + ')');
        // No-op untuk PPGAME — bahasa diatur oleh game engine
    };

    // sendCustomEvent — Kirim custom event
    window.sendCustomEvent = function (name, data) {
        _logHeader('DEBUG', 'REPORT', 'sendCustomEvent(' + name + ')');
        _post('/event.php?action=report', {
            eventType: name,
            userId: _loginInfo ? _loginInfo.userId : '',
            data: data || {}
        }).catch(function () {});
    };

    // reload — Reload halaman
    window.reload = function () {
        window.location.reload();
    };

    // getQueryStringByName — Baca URL query parameter
    // Referensi: index.html Line 42, sdk.md Section 3.2 #13
    // Sudah didefinisikan di index.html, tapi sdk.js provide fallback
    if (!window.getQueryStringByName) {
        window.getQueryStringByName = function (name) {
            var match = location.search.match(new RegExp('[?&]' + name + '=([^&]+)', 'i'));
            if (match == null || match.length < 1) return '';
            return match[1];
        };
    }

    // ─── Optional Functions (Platform-specific — PPGAME: no-op / minimal) ───
    // Referensi: sdk.md Section 3.3, 13.2

    // contactSdk — Buka customer service (hidden untuk PPGAME)
    window.contactSdk = function () {
        _logHeader('DEBUG', 'SDK', 'contactSdk() — no-op for PPGAME');
    };

    // userCenterSdk — Buka user center (hidden untuk PPGAME)
    window.userCenterSdk = function () {
        _logHeader('DEBUG', 'SDK', 'userCenterSdk() — no-op for PPGAME');
    };

    // switchUser — Ganti user (hidden untuk PPGAME)
    window.switchUser = function () {
        _logHeader('DEBUG', 'SDK', 'switchUser() — no-op for PPGAME');
    };

    // reportToCpapiCreaterole — CP API role creation (gameId: 261)
    // Referensi: sdk.md Section 14.8 — opsional, bisa capture data
    window.reportToCpapiCreaterole = function (data) {
        _logHeader('DEBUG', 'REPORT', 'reportToCpapiCreaterole()');
        if (data) {
            _logDetail('data', 'gameId: ' + data.gameId + ' · userId: ' + data.userId + ' · sign: ' + data.sign);
        }
        // Capture data via event report
        _post('/event.php?action=report', {
            eventType: 'cpapi_create_role',
            userId: data ? data.userId : '',
            data: data || {}
        }).catch(function () {});
    };

    // report2Sdk350CreateRole — 350 platform (inactive untuk PPGAME)
    window.report2Sdk350CreateRole = function (data) {
        _logHeader('DEBUG', 'REPORT', 'report2Sdk350CreateRole() — no-op for PPGAME');
    };

    // report2Sdk350LoginUser — 350 platform (inactive untuk PPGAME)
    window.report2Sdk350LoginUser = function (data) {
        _logHeader('DEBUG', 'REPORT', 'report2Sdk350LoginUser() — no-op for PPGAME');
    };

    // fbq — Facebook pixel tracking (inactive untuk PPGAME)
    window.fbq = function (action, event) {
        _logHeader('DEBUG', 'REPORT', 'fbq() — no-op for PPGAME');
    };

    // gtag — Google Analytics (inactive untuk PPGAME)
    window.gtag = function (event, type, opts) {
        _logHeader('DEBUG', 'REPORT', 'gtag() — no-op for PPGAME');
    };

    // reportLogToPP — Analytics event logging
    window.reportLogToPP = function (event, data) {
        _logHeader('DEBUG', 'REPORT', 'reportLogToPP(' + event + ')');
        _post('/event.php?action=report', {
            eventType: 'logPP_' + event,
            userId: _loginInfo ? _loginInfo.userId : '',
            data: data || {}
        }).catch(function () {});
    };

    // ═══════════════════════════════════════════════════════════════
    // 5. LOGIN UI
    // Referensi: sdk.md Section 18
    // ═══════════════════════════════════════════════════════════════
    function _createLoginUI() {
        // Remove existing if any
        _removeLoginUI();

        // Guard: document.body might not exist yet (sdk.js loaded in <head>)
        if (!document.body) {
            _logHeader('WARN', 'UI', 'document.body not ready — deferring Login UI to DOMContentLoaded');
            document.addEventListener('DOMContentLoaded', function () {
                _createLoginUI();
            });
            return;
        }

        _logHeader('INFO', 'UI', 'Login UI overlay rendered');

        var overlay = document.createElement('div');
        overlay.id = 'sdk-login-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;font-family:"Helvetica Neue",Arial,sans-serif;';

        var card = document.createElement('div');
        card.style.cssText = 'background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:40px 32px;width:340px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);';

        // Title
        var title = document.createElement('div');
        title.style.cssText = 'text-align:center;margin-bottom:32px;';
        title.innerHTML = '<div style="font-size:20px;font-weight:700;color:#e94560;letter-spacing:2px;margin-bottom:4px;">SUPER WARRIOR Z</div><div style="font-size:12px;color:#888;letter-spacing:3px;">SDK LOGIN</div>';
        card.appendChild(title);

        // Guest Login Button
        var guestBtn = document.createElement('button');
        guestBtn.id = 'sdk-guest-btn';
        guestBtn.textContent = 'Login as Guest';
        guestBtn.style.cssText = 'width:100%;padding:14px;border:none;border-radius:10px;background:linear-gradient(135deg,#e94560,#c23152);color:#fff;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:0.5px;transition:all 0.2s;box-shadow:0 4px 15px rgba(233,69,96,0.3);';
        guestBtn.onmouseover = function () { this.style.transform = 'translateY(-1px)'; this.style.boxShadow = '0 6px 20px rgba(233,69,96,0.4)'; };
        guestBtn.onmouseout = function () { this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 4px 15px rgba(233,69,96,0.3)'; };
        guestBtn.onclick = function () { _guestLogin(); };
        card.appendChild(guestBtn);

        // Divider
        var divider = document.createElement('div');
        divider.style.cssText = 'text-align:center;margin:20px 0;color:#555;font-size:12px;letter-spacing:2px;';
        divider.textContent = '─── atau ───';
        card.appendChild(divider);

        // UserID Input
        var input = document.createElement('input');
        input.id = 'sdk-userid-input';
        input.type = 'text';
        input.placeholder = 'Masukkan UserID';
        input.style.cssText = 'width:100%;padding:12px 14px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(255,255,255,0.05);color:#fff;font-size:14px;outline:none;box-sizing:border-box;transition:border-color 0.2s;';
        input.onfocus = function () { this.style.borderColor = '#e94560'; };
        input.onblur = function () { this.style.borderColor = 'rgba(255,255,255,0.1)'; };
        input.onkeydown = function (e) { if (e.key === 'Enter') _userIdLogin(input.value); };
        card.appendChild(input);

        // UserID Login Button
        var userBtn = document.createElement('button');
        userBtn.id = 'sdk-userid-btn';
        userBtn.textContent = 'Login by UserID';
        userBtn.style.cssText = 'width:100%;padding:14px;border:1px solid rgba(233,69,96,0.5);border-radius:10px;background:transparent;color:#e94560;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:0.5px;transition:all 0.2s;margin-top:12px;';
        userBtn.onmouseover = function () { this.style.background = 'rgba(233,69,96,0.1)'; };
        userBtn.onmouseout = function () { this.style.background = 'transparent'; };
        userBtn.onclick = function () { _userIdLogin(input.value); };
        card.appendChild(userBtn);

        // Error Area
        var errorArea = document.createElement('div');
        errorArea.id = 'sdk-login-error';
        errorArea.style.cssText = 'text-align:center;margin-top:16px;color:#ff6b6b;font-size:12px;min-height:18px;transition:opacity 0.3s;';
        card.appendChild(errorArea);

        overlay.appendChild(card);
        document.body.appendChild(overlay);
        _loginUI = overlay;

        // Focus input
        setTimeout(function () { input.focus(); }, 100);
    }

    function _removeLoginUI() {
        if (_loginUI && _loginUI.parentNode) {
            _loginUI.parentNode.removeChild(_loginUI);
            _loginUI = null;
            _logHeader('INFO', 'UI', 'Login UI overlay closed');
        }
    }

    function _showLoginError(message) {
        var el = document.getElementById('sdk-login-error');
        if (el) {
            el.textContent = message;
            el.style.opacity = '1';
            setTimeout(function () { el.style.opacity = '0'; }, 4000);
        }
    }

    function _setLoginLoading(loading) {
        var guestBtn = document.getElementById('sdk-guest-btn');
        var userBtn = document.getElementById('sdk-userid-btn');
        var input = document.getElementById('sdk-userid-input');

        if (guestBtn) {
            guestBtn.disabled = loading;
            guestBtn.textContent = loading ? 'Loading...' : 'Login as Guest';
            guestBtn.style.opacity = loading ? '0.6' : '1';
            guestBtn.style.cursor = loading ? 'not-allowed' : 'pointer';
        }
        if (userBtn) {
            userBtn.disabled = loading;
            userBtn.textContent = loading ? 'Loading...' : 'Login by UserID';
            userBtn.style.opacity = loading ? '0.6' : '1';
            userBtn.style.cursor = loading ? 'not-allowed' : 'pointer';
        }
        if (input) {
            input.disabled = loading;
            input.style.opacity = loading ? '0.6' : '1';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 6. PAYMENT UI
    // Referensi: sdk.md Section 8.5 (step 7)
    // ═══════════════════════════════════════════════════════════════
    function _createPaymentUI(orderData, paymentId) {
        _removePaymentUI();

        // Guard: document.body might not exist yet
        if (!document.body) {
            _logHeader('WARN', 'PAY', 'document.body not ready — cannot show Payment UI');
            return;
        }

        _logHeader('INFO', 'PAY', 'Payment Confirmation UI shown');
        _logDetails('data', [
            ['paymentId', paymentId],
            ['status', 'pending']
        ]);
        _logDetail('location', 'waiting user action');

        var overlay = document.createElement('div');
        overlay.id = 'sdk-payment-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:"Helvetica Neue",Arial,sans-serif;';

        var card = document.createElement('div');
        card.style.cssText = 'background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;padding:32px;width:300px;max-width:85vw;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);';

        // Title
        var title = document.createElement('div');
        title.style.cssText = 'text-align:center;margin-bottom:24px;font-size:17px;font-weight:700;color:#fff;letter-spacing:0.5px;';
        title.textContent = 'Payment Confirmation';
        card.appendChild(title);

        // Product Info
        var info = document.createElement('div');
        info.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:10px;padding:16px;margin-bottom:24px;';
        var productName = orderData.productName || orderData.productId || 'Item';
        var price = (orderData.price || 0) + ' ' + (orderData.currency || 'USD');
        info.innerHTML = '<div style="color:#bbb;font-size:12px;margin-bottom:4px;">Product</div><div style="color:#fff;font-size:16px;font-weight:600;margin-bottom:12px;">' + productName + '</div><div style="color:#bbb;font-size:12px;margin-bottom:4px;">Price</div><div style="color:#e94560;font-size:20px;font-weight:700;">' + price + '</div>';
        card.appendChild(info);

        // Buttons
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:12px;';

        // Cancel Button
        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'flex:1;padding:12px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:transparent;color:#888;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.2s;';
        cancelBtn.onmouseover = function () { this.style.borderColor = '#ff6b6b'; this.style.color = '#ff6b6b'; };
        cancelBtn.onmouseout = function () { this.style.borderColor = 'rgba(255,255,255,0.15)'; this.style.color = '#888'; };
        cancelBtn.onclick = function () {
            _logHeader('WARN', 'PAY', 'User cancelled payment');
            _logDetail('data', 'paymentId: ' + paymentId);
            _removePaymentUI();
            _logHeader('INFO', 'UI', 'Payment Confirmation UI closed');
            _logHeader('WARN', 'PAY', 'Payment cancelled');
        };
        btnRow.appendChild(cancelBtn);

        // Confirm Button
        var confirmBtn = document.createElement('button');
        confirmBtn.id = 'sdk-payment-confirm-btn';
        confirmBtn.textContent = 'Confirm';
        confirmBtn.style.cssText = 'flex:1;padding:12px;border:none;border-radius:8px;background:linear-gradient(135deg,#e94560,#c23152);color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 4px 12px rgba(233,69,96,0.3);';
        confirmBtn.onmouseover = function () { this.style.transform = 'translateY(-1px)'; };
        confirmBtn.onmouseout = function () { this.style.transform = 'translateY(0)'; };
        confirmBtn.onclick = function () {
            _logHeader('INFO', 'PAY', 'User confirmed payment');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Processing...';
            confirmBtn.style.opacity = '0.6';
            cancelBtn.disabled = true;
            cancelBtn.style.opacity = '0.6';

            _post('/payment.php?action=confirm', {
                paymentId: paymentId,
                orderId: orderData.orderId
            })
                .then(function (resp) {
                    if (resp && resp.success) {
                        _logHeader('INFO', 'PAY', 'Payment complete');
                        _logDetails('data', [
                            ['paymentId', paymentId],
                            ['orderId', orderData.orderId || '']
                        ]);
                        _logDetail('data', 'SDK-Server will notify Main-Server server-to-server');
                        _removePaymentUI();
                        _logHeader('INFO', 'UI', 'Payment Confirmation UI closed');
                        _logHeader('INFO', 'PAY', 'Waiting for Main-Server payFinish Notify...');
                    } else {
                        _logHeader('ERROR', 'PAY', 'Payment confirm failed');
                        _logDetail('important', 'response: ' + JSON.stringify(resp));
                        _removePaymentUI();
                    }
                })
                .catch(function (err) {
                    _logHeader('ERROR', 'PAY', 'Payment confirm error');
                    _logDetails('important', [
                        ['status', err.status],
                        ['error', err.message]
                    ]);
                    _removePaymentUI();
                });
        };
        btnRow.appendChild(confirmBtn);

        card.appendChild(btnRow);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        _paymentUI = overlay;
    }

    function _removePaymentUI() {
        if (_paymentUI && _paymentUI.parentNode) {
            _paymentUI.parentNode.removeChild(_paymentUI);
            _paymentUI = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. AUTH FUNCTIONS
    // Referensi: sdk.md Section 4, 18
    // ═══════════════════════════════════════════════════════════════
    function _guestLogin() {
        _setLoginLoading(true);
        _showLoginError('');
        _logHeader('INFO', 'AUTH', 'Guest Login Request');

        _post('/auth.php?action=guest', {})
            .then(function (resp) {
                _setLoginLoading(false);
                if (resp && resp.userId) {
                    _onLoginSuccess(resp);
                } else {
                    _showLoginError('Login gagal — respons tidak valid');
                }
            })
            .catch(function (err) {
                _setLoginLoading(false);
                _logHeader('ERROR', 'AUTH', 'Guest login failed');
                _logDetail('important', 'error: ' + err.message);
                _showLoginError('Server tidak bisa dijangkau. Coba lagi.');
            });
    }

    function _userIdLogin(userId) {
        if (!userId || !userId.trim()) {
            _showLoginError('UserID tidak boleh kosong');
            return;
        }
        userId = userId.trim();

        _setLoginLoading(true);
        _showLoginError('');
        _logHeader('INFO', 'AUTH', 'UserID Login Request');
        _logDetail('data', 'userId: ' + userId);

        _post('/auth.php?action=login', { userId: userId })
            .then(function (resp) {
                _setLoginLoading(false);
                if (resp && resp.userId) {
                    _onLoginSuccess(resp);
                } else {
                    _showLoginError('Login gagal — respons tidak valid');
                }
            })
            .catch(function (err) {
                _setLoginLoading(false);
                _logHeader('ERROR', 'AUTH', 'UserID login failed');
                _logDetail('important', 'error: ' + err.message);
                _showLoginError('Server tidak bisa dijangkau. Coba lagi.');
            });
    }

    function _onLoginSuccess(data) {
        // Cache login info — 6 field sesuai sdk.md Section 6.1
        _loginInfo = {
            sdk: CHANNEL,
            loginToken: data.loginToken,
            nickName: data.nickName,
            userId: data.userId,
            sign: data.sign,
            security: data.security
        };

        _logHeader('INFO', 'AUTH', 'Login success');
        _logDetails('data', [
            ['userId', data.userId],
            ['nickName', data.nickName],
            ['loginToken', data.loginToken.substring(0, 12) + '...'],
            ['sign', data.sign.substring(0, 12) + '...'],
            ['security', data.security.substring(0, 12) + '...']
        ]);

        // Save session to localStorage
        _saveSession(data);

        // Unblock game init
        _sdkReady = true;

        _logHeader('INFO', 'AUTH', 'Unblocking game init');
        _logDetail('data', 'window.checkSDK → return true');

        // Close Login UI
        _removeLoginUI();

        _logHeader('INFO', 'SDK', 'SDK Ready — game init unblocked');
    }

    // ═══════════════════════════════════════════════════════════════
    // 8. SESSION MANAGEMENT
    // Referensi: sdk.md Section 18.2
    // ═══════════════════════════════════════════════════════════════
    function _saveSession(data) {
        try {
            var sessionData = {
                userId: data.userId,
                loginToken: data.loginToken,
                nickName: data.nickName
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));

            _logHeader('INFO', 'SESSION', 'Session saved to localStorage');
            _logDetail('data', 'userId: ' + data.userId);
        } catch (e) {
            _logHeader('WARN', 'SESSION', 'Failed to save session');
            _logDetail('important', 'error: ' + e.message);
        }
    }

    function _loadSession() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var data = JSON.parse(raw);
                if (data && data.userId && data.loginToken) {
                    return data;
                }
            }
        } catch (e) {
            // Corrupted data — clear it
            try { localStorage.removeItem(STORAGE_KEY); } catch (ex) {}
        }
        return null;
    }

    function _clearSession() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            _logHeader('DEBUG', 'SESSION', 'Session cleared from localStorage');
        } catch (e) {}
    }

    function _restoreSession(session) {
        _logHeader('INFO', 'AUTH', 'Restoring session');

        // Step 1: Validate loginToken dengan SDK-Server
        _post('/auth.php?action=validate', {
            loginToken: session.loginToken,
            userId: session.userId
        })
            .then(function (resp) {
                if (resp && resp.valid) {
                    // Step 2: Re-populate _loginInfo dari validate response + localStorage
                    _loginInfo = {
                        sdk: CHANNEL,
                        loginToken: session.loginToken,
                        nickName: session.nickName || session.userId,
                        userId: session.userId,
                        sign: resp.sign,
                        security: resp.securityCode
                    };

                    _logHeader('INFO', 'AUTH', 'Session restored');
                    _logDetail('data', 'userId: ' + session.userId + ' · valid: true');

                    _logHeader('INFO', 'AUTH', 'Skipping Login UI — session active');

                    // Unblock game init
                    _sdkReady = true;

                    _logHeader('INFO', 'AUTH', 'Unblocking game init');
                    _logDetail('data', 'window.checkSDK → return true');

                    _logHeader('INFO', 'SDK', 'SDK Ready — game init unblocked');
                } else {
                    // Session invalid — clear and show Login UI
                    _logHeader('WARN', 'AUTH', 'Session restore failed — invalid token');
                    _logDetail('data', 'userId: ' + session.userId + ' · valid: false');
                    _clearSession();
                    _createLoginUI();
                }
            })
            .catch(function (err) {
                // SDK-Server unreachable — still try to proceed with cached data
                _logHeader('WARN', 'AUTH', 'Session validate failed — server unreachable');
                _logDetail('important', 'error: ' + err.message);

                // Attempt to use cached data anyway (offline tolerance)
                if (session.userId && session.loginToken) {
                    _loginInfo = {
                        sdk: CHANNEL,
                        loginToken: session.loginToken,
                        nickName: session.nickName || session.userId,
                        userId: session.userId,
                        sign: '',
                        security: ''
                    };
                    _sdkReady = true;
                    _logHeader('INFO', 'SDK', 'SDK Ready (offline mode) — game init unblocked');
                } else {
                    _clearSession();
                    _createLoginUI();
                }
            });
    }

    // ═══════════════════════════════════════════════════════════════
    // 9. AUTO-INIT
    // Referensi: sdk.md Section 16.2, 18.2
    // ═══════════════════════════════════════════════════════════════
    (function _init() {
        _logBoundary('🚀', 'SDK.js — Super Warrior Z SDK Client v1.0.0');
        _logBoundaryEnd('🚀');

        _logHeader('INFO', 'SDK', 'SDK.js loaded');
        _logDetails('data', [
            ['version', '1.0.0'],
            ['env', 'localhost'],
            ['readyState', document.readyState]
        ]);

        _logHeader('INFO', 'AUTH', 'Initializing SDK Bridge');
        _logDetails('data', [
            ['checkSDK', typeof window.checkSDK],
            ['getSdkLoginInfo', typeof window.getSdkLoginInfo],
            ['PPGAME', typeof window.PPGAME],
            ['paySdk', typeof window.paySdk],
            ['report2Sdk', typeof window.report2Sdk],
            ['gameReady', typeof window.gameReady]
        ]);

        // Check localStorage for existing session
        var session = _loadSession();
        if (session) {
            _logHeader('INFO', 'SESSION', 'Checking localStorage');
            _logDetail('data', 'session: found · userId: ' + session.userId);
            // Validate and restore session
            _restoreSession(session);
        } else {
            _logHeader('INFO', 'SESSION', 'Checking localStorage');
            _logDetail('data', 'session: none found');
            // Show Login UI (deferred if DOM not ready)
            _createLoginUI();
        }
    })();

})();
