console.log("[login-server] loading handlers...");

var LoginHandlers = (function () {
    "use strict";

    var DB = "proot_login";
    var STORE = "loginInfo";
    var _db = null;

    function validateRequest(payload, required) {
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (payload[required[i]] === undefined || payload[required[i]] === null) {
                missing.push(required[i]);
            }
        }
        if (missing.length > 0) {
            console.log("⚠️ missing required fields: " + missing.join(", "));
        }
        return missing.length === 0;
    }

    function validateResponse(result, key, expected) {
        var missing = [];
        for (var i = 0; i < expected.length; i++) {
            if (result[expected[i]] === undefined || result[expected[i]] === null) {
                missing.push(expected[i]);
            }
        }
        if (missing.length > 0) {
            console.log("⚠️ response missing fields: " + missing.join(", "));
        }
        return missing.length === 0;
    }

    function openDB() {
        return new Promise(function (ok, fail) {
            if (_db) { ok(_db); return; }
            var r = indexedDB.open(DB, 1);
            r.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "userId" });
            };
            r.onsuccess = function (e) { _db = e.target.result; ok(_db); };
            r.onerror = function (e) { fail(e); };
        });
    }

    function get(key) {
        var t0 = Date.now();
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
                r.onsuccess = function () {
                    var elapsed = Date.now() - t0;
                    console.groupCollapsed("  ▼ 🗄️ loginInfo.get(\"" + key + "\") → " + (r.result ? "found" : "not found") + " " + elapsed + "ms");
                    if (r.result) {
                        console.log(r.result);
                    } else {
                        console.log("null");
                    }
                    console.groupEnd();
                    ok(r.result);
                };
                r.onerror = function () { fail(r.error); };
            });
        });
    }

    function put(data) {
        var t0 = Date.now();
        return openDB().then(function (db) {
            return new Promise(function (ok, fail) {
                var r = db.transaction(STORE, "readwrite").objectStore(STORE).put(data);
                r.onsuccess = function () {
                    var elapsed = Date.now() - t0;
                    console.groupCollapsed("  ▼ 🗄️ loginInfo.put(\"" + data.userId + "\") → ok " + elapsed + "ms");
                    console.log(data);
                    console.groupEnd();
                    ok(data);
                };
                r.onerror = function () { fail(r.error); };
            });
        });
    }

    function token() { return "tk_" + Date.now() + "_" + Math.random().toString(36).substr(2, 8); }
    function now() { return Math.floor(Date.now() / 1000); }

    function loginGame(payload, conn, done) {
        console.groupCollapsed("  ▼ 📋 request");
        console.log(payload);
        console.groupEnd();
        validateRequest(payload, ["type", "action", "userId", "password"]);

        if (payload.type !== "User" || payload.action !== "loginGame") {
            console.log("⚠️ unexpected type/action:", payload.type, payload.action);
        }

        var userId = payload.userId || "player";
        var password = payload.password || "";

        get(userId).then(function (acc) {
            if (!acc) {
                var securityCode = "sec_" + Math.random().toString(36).substr(2, 6);
                acc = {
                    userId: userId,
                    password: password,
                    channelCode: payload.fromChannel || "game_origin",
                    securityCode: securityCode,
                    loginToken: "",
                    createTime: now(),
                    lastLoginTime: now(),
                    todayLoginCount: 0
                };
                console.groupCollapsed("  ▼ 🆕 register");
                console.log(acc);
                console.groupEnd();

                put(acc).then(function () {
                    var result = {
                        userId: acc.userId,
                        channelCode: acc.channelCode,
                        securityCode: acc.securityCode,
                        nickName: acc.userId,
                        sdk: acc.channelCode,
                        sign: "",
                        createTime: acc.createTime
                    };
                    validateResponse(result, "User.loginGame", ["userId", "channelCode", "securityCode"]);
                    done(result);
                });
            } else {
                console.groupCollapsed("  ▼ 🔐 processHandlerWithLogin password check");
                console.log({
                    loginInfo_userId: acc.userId,
                    loginInfo_password: acc.password,
                    request_password: password,
                    todayLoginCount: acc.todayLoginCount
                });
                console.groupEnd();

                if (acc.password !== password) {
                    console.log("❌ password mismatch");
                    done({ ret: 1001 });
                    return;
                }
                console.log("✅ password match");

                acc.lastLoginTime = now();
                acc.todayLoginCount = (acc.todayLoginCount || 0) + 1;

                put(acc).then(function () {
                    var result = {
                        userId: acc.userId,
                        channelCode: acc.channelCode,
                        securityCode: acc.securityCode,
                        nickName: acc.userId,
                        sdk: acc.channelCode,
                        sign: "",
                        createTime: acc.createTime
                    };
                    validateResponse(result, "User.loginGame", ["userId", "channelCode", "securityCode"]);
                    done(result);
                });
            }
        }).catch(function (e) {
            console.log("❌ db error:", e.message, e.stack);
            done({ userId: userId, channelCode: "game_origin", securityCode: "sec_fb", nickName: userId, sdk: "game_origin", sign: "", createTime: now() });
        });
    }

    function getServerList(payload, conn, done) {
        console.groupCollapsed("  ▼ 📋 request");
        console.log(payload);
        console.groupEnd();
        validateRequest(payload, ["type", "action", "userId", "channel"]);

        var servers = [{
            serverId: "1",
            url: "http://127.0.0.1:6002",
            chaturl: "http://127.0.0.1:6003",
            dungeonurl: "http://127.0.0.1:6004",
            name: "Server 1",
            online: true,
            hot: true,
            "new": false,
            worldRoomId: "room_world_1",
            guildRoomId: "room_guild_1",
            teamChatRoomId: "room_team_1",
            teamDungeonChatRoom: "room_dungeon_1",
            offlineReason: ""
        }];

        console.groupCollapsed("  ▼ 📡 serverList (" + servers.length + " server)");
        for (var i = 0; i < servers.length; i++) {
            console.groupCollapsed("  ▼ [" + i + "]");
            console.log(servers[i]);
            console.groupEnd();
        }
        console.groupEnd();

        var result = { serverList: servers, history: ["1"] };
        validateResponse(result, "User.GetServerList", ["serverList", "history"]);

        if (!Array.isArray(result.serverList)) {
            console.log("⚠️ serverList is not array:", typeof result.serverList);
        }
        for (var j = 0; j < result.serverList.length; j++) {
            var s = result.serverList[j];
            if (s.serverId === undefined) console.log("⚠️ serverList[" + j + "].serverId undefined");
            if (s.url === undefined) console.log("⚠️ serverList[" + j + "].url undefined");
            if (s.name === undefined) console.log("⚠️ serverList[" + j + "].name undefined");
        }

        done(result);
    }

    function saveHistory(payload, conn, done) {
        console.groupCollapsed("  ▼ 📋 request");
        console.log(payload);
        console.groupEnd();
        validateRequest(payload, ["type", "action", "accountToken", "channelCode", "serverId", "securityCode"]);

        var userId = payload.accountToken || "";
        var serverId = payload.serverId || "";

        console.log("📋 startBtnTap → SaveHistory");

        get(userId).then(function (acc) {
            var tk = token();
            var count = acc ? (acc.todayLoginCount || 1) : 1;
            if (acc) {
                acc.loginToken = tk;
                put(acc);
            }
            console.log("📋 SaveHistory → clientStartGame");
            var result = { loginToken: tk, todayLoginCount: count };
            validateResponse(result, "User.SaveHistory", ["loginToken", "todayLoginCount"]);
            done(result);
        }).catch(function (e) {
            console.log("❌ db error:", e.message);
            var tk = token();
            done({ loginToken: tk, todayLoginCount: 1 });
        });
    }

    function saveUserEnterInfo(payload, conn, done) {
        console.groupCollapsed("  ▼ 📋 request");
        console.log(payload);
        console.groupEnd();
        validateRequest(payload, ["type", "action", "accountToken", "channelCode"]);

        console.log("📋 reportToLoginEnterInfo → SaveUserEnterInfo");
        done({});
    }

    function loginAnnounce(payload, conn, done) {
        console.groupCollapsed("  ▼ 📋 request");
        console.log(payload);
        console.groupEnd();

        console.log("📋 getNotice → LoginAnnounce");
        var result = { data: {} };
        validateResponse(result, "User.LoginAnnounce", ["data"]);
        done(result);
    }

    return {
        "User.loginGame": loginGame,
        "User.GetServerList": getServerList,
        "User.SaveHistory": saveHistory,
        "User.SaveUserEnterInfo": saveUserEnterInfo,
        "User.LoginAnnounce": loginAnnounce
    };
})();

console.log("[login-server] handlers loaded: " + Object.keys(LoginHandlers).length);
