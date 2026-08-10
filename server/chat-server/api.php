<?php
/**
 * api.php — Chat Server PHP Backend (MySQL)
 * Super Warrior Z — CHAT SERVER
 *
 * POST server/chat-server/api.php?action=xxx
 * Body: JSON { action, ...fields }
 *
 * All endpoints accept POST (JSON body) + GET (query params + form POST).
 * Response always JSON.
 *
 * Architecture:
 *   Browser (handlers.js) → HTTP POST → api.php → MySQL (database: chat)
 *
 * Evidence:
 *   L114551-114556: login payload {userId, serverId, version}
 *   L114613-114618: joinRoom payload {userId, roomId, version}
 *   L114623-114628: leaveRoom payload {userId, roomId, version}
 *   L83836-83845:  sendMsg payload {userId, kind, content, msgType, param, roomId, version}
 *   L92098-92110:  ChatDataBaseClass.getData: _id = userId, _headBox → _headBoxId
 */

require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? '';
if ($action === '') {
    jsonResponse(['error' => 'Missing action parameter'], 400);
}

switch ($action) {
    case 'chatLogin':
        handleChatLogin();
        break;
    case 'chatJoinRoom':
        handleChatJoinRoom();
        break;
    case 'chatLeaveRoom':
        handleChatLeaveRoom();
        break;
    case 'chatSendMsg':
        handleChatSendMsg();
        break;
    case 'chatGetRecord':
        handleChatGetRecord();
        break;
    default:
        jsonResponse(['error' => 'Unknown action: ' . $action], 404);
}

/**
 * chatLogin — User login ke chat-server
 *
 * Evidence: L114551-114556
 *   Client sends: {userId, serverId, version}
 *   Response: {} — client only checks ret:0 from envelope
 *
 * Our mock: handlers.js enriches request with user profile info
 *   (nickName, headImage, headEffect, headBox) read from main-server
 *   localStorage, since the client does NOT send these fields.
 *   See handlers.js → handleLogin for the enrichment logic.
 */
function handleChatLogin() {
    $input = getInput();
    $userId     = trim($input['userId'] ?? '');
    $serverId   = trim($input['serverId'] ?? '1');
    $version    = trim($input['version'] ?? '1.0');
    $nickName   = trim($input['nickName'] ?? '');
    $headImage  = trim($input['headImage'] ?? '');
    $headEffect = trim($input['headEffect'] ?? '0');
    $headBox    = trim($input['headBox'] ?? '0');

    if (empty($userId)) {
        jsonResponse(['error' => 'Missing userId'], 400);
    }

    $db = getDb();

    // Upsert user — set online + store profile info
    $stmt = $db->prepare(
        "INSERT INTO chat_users (userId, serverId, nickName, headImage, headEffect, headBox,
                                 online, lastActivity, createdAt)
         VALUES (:userId, :serverId, :nickName, :headImage, :headEffect, :headBox,
                 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
            serverId   = VALUES(serverId),
            nickName   = VALUES(nickName),
            headImage  = VALUES(headImage),
            headEffect = VALUES(headEffect),
            headBox    = VALUES(headBox),
            online     = 1,
            lastActivity = NOW()"
    );
    $stmt->execute([
        ':userId'     => $userId,
        ':serverId'   => $serverId,
        ':nickName'   => $nickName,
        ':headImage'  => $headImage,
        ':headEffect' => $headEffect,
        ':headBox'    => $headBox
    ]);

    jsonResponse(['success' => true]);
}

/**
 * chatJoinRoom — Join room, return recent messages
 *
 * Evidence: L114612-114621
 *   Client sends: {userId, roomId, version}
 *   Response: {_record: [...]} — array of message objects
 *
 * L114632-114640: chatJoinRecord iterates _record with for-in:
 *   for (var o in t) {
 *       var a = t[o];
 *       ts.chatData[a._kind] || (ts.chatData[a._kind] = []);
 *       var r = ChatDataBaseClass.getData(a);
 *   }
 *
 * L92098-92110: ChatDataBaseClass.getData(t):
 *   t._id = sender userId (for blacklist check)
 *   t._name = sender nickname
 *   t._content = message text
 *   t._image = sender avatar
 *   t._headBox → output _headBoxId
 *   t._type required (void 0 check)
 */
function handleChatJoinRoom() {
    $input = getInput();
    $userId = trim($input['userId'] ?? '');
    $roomId = trim($input['roomId'] ?? '');

    if (empty($userId) || empty($roomId)) {
        jsonResponse(['error' => 'Missing userId or roomId'], 400);
    }

    $db = getDb();

    // Register as room member (upsert)
    $stmt = $db->prepare(
        "INSERT INTO chat_members (userId, roomId, joinedAt, lastActivity)
         VALUES (:userId, :roomId, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
            lastActivity = NOW()"
    );
    $stmt->execute([
        ':userId' => $userId,
        ':roomId' => $roomId
    ]);

    // Get recent messages for this room (max 50, newest first, then reverse)
    $stmt = $db->prepare(
        "SELECT id, roomId, userId, nickName, content, kind, msgType, param,
                image, headEffect, headBox, oriServerId, serverId, showMain,
                UNIX_TIMESTAMP(createdAt) as msgTime
         FROM chat_messages
         WHERE roomId = :roomId
         ORDER BY createdAt DESC
         LIMIT 50"
    );
    $stmt->execute([':roomId' => $roomId]);
    $rows = $stmt->fetchAll();

    // Reverse to chronological order (oldest first)
    $rows = array_reverse($rows);

    $record = [];
    foreach ($rows as $row) {
        $record[] = buildMessageObject($row);
    }

    jsonResponse(['_record' => $record]);
}

/**
 * chatLeaveRoom — Leave room
 *
 * Evidence: L114622-114631
 *   Client sends: {userId, roomId, version}
 *   Response: {} — client only checks ret:0
 */
function handleChatLeaveRoom() {
    $input = getInput();
    $userId = trim($input['userId'] ?? '');
    $roomId = trim($input['roomId'] ?? '');

    if (empty($userId) || empty($roomId)) {
        jsonResponse(['error' => 'Missing userId or roomId'], 400);
    }

    $db = getDb();

    // Remove membership
    $stmt = $db->prepare(
        "DELETE FROM chat_members WHERE userId = :userId AND roomId = :roomId"
    );
    $stmt->execute([
        ':userId' => $userId,
        ':roomId' => $roomId
    ]);

    jsonResponse(['success' => true]);
}

/**
 * chatSendMsg — Send message to room
 *
 * Evidence: L83836-83845
 *   Client sends: {userId, kind, content, msgType, param, roomId, version}
 *   NOTE: Client does NOT send nickName, headImage, headEffect, headBox!
 *         handlers.js enriches the request with these from main-server localStorage.
 *
 * L83847: Response → ts.createLocalData(t, n, e._time, a, r)
 *   Response must include _time (Unix timestamp in seconds).
 *
 * L114241-114261: After sendMsg, server broadcasts Notify to other room members.
 *   Notify envelope: {ret:'SUCCESS', data: JSON.stringify({_msg: msgObj})}
 *   The _msg object is the same message object (built by handlers.js from
 *   the request + stored DB data).
 *
 * Our mock: handlers.js calls api.php to persist the message, then builds
 *   the Notify message object itself and broadcasts via emitNotifyToRoom.
 */
function handleChatSendMsg() {
    $input = getInput();
    $userId     = trim($input['userId'] ?? '');
    $roomId     = trim($input['roomId'] ?? '');
    $kind       = (int)($input['kind'] ?? 2);
    $content    = trim($input['content'] ?? '');
    $msgType    = trim($input['msgType'] ?? '');
    $param      = trim($input['param'] ?? '');
    $serverId   = trim($input['serverId'] ?? '1');
    $nickName   = trim($input['nickName'] ?? '');
    $headImage  = trim($input['headImage'] ?? '');
    $headEffect = trim($input['headEffect'] ?? '0');
    $headBox    = trim($input['headBox'] ?? '0');

    if (empty($userId) || empty($roomId)) {
        jsonResponse(['error' => 'Missing userId or roomId'], 400);
    }

    if ($content === '') {
        jsonResponse(['error' => 'Empty content'], 400);
    }

    $db = getDb();

    // If no profile info in request, try to get from chat_users table
    if (empty($nickName)) {
        $stmt = $db->prepare(
            "SELECT nickName, headImage, headEffect, headBox, serverId
             FROM chat_users WHERE userId = :userId LIMIT 1"
        );
        $stmt->execute([':userId' => $userId]);
        $user = $stmt->fetch();
        if ($user) {
            $nickName   = $user['nickName'];
            $headImage  = $user['headImage'];
            $headEffect = $user['headEffect'];
            $headBox    = $user['headBox'];
            $serverId   = $user['serverId'];
        }
    }

    // Save message to database
    $stmt = $db->prepare(
        "INSERT INTO chat_messages
            (roomId, userId, nickName, content, kind, msgType, param,
             image, headEffect, headBox, oriServerId, serverId, createdAt)
         VALUES
            (:roomId, :userId, :nickName, :content, :kind, :msgType, :param,
             :image, :headEffect, :headBox, :oriServerId, :serverId, NOW())"
    );
    $stmt->execute([
        ':roomId'     => $roomId,
        ':userId'     => $userId,
        ':nickName'   => $nickName,
        ':content'    => $content,
        ':kind'       => $kind,
        ':msgType'    => $msgType,
        ':param'      => $param,
        ':image'      => $headImage,
        ':headEffect' => $headEffect,
        ':headBox'    => $headBox,
        ':oriServerId'=> $serverId,
        ':serverId'   => $serverId
    ]);

    $timestamp = time();

    // Return _time for client's createLocalData (L83847)
    jsonResponse([
        '_time'     => $timestamp,
        '_id'       => $userId,
        '_name'     => $nickName,
        '_image'    => $headImage,
        '_headEffect'=> $headEffect,
        '_headBox'  => $headBox,
        '_serverId' => $serverId
    ]);
}

/**
 * chatGetRecord — Get message history since startTime
 *
 * Evidence: L114612-114621 pattern
 *   Client sends: {userId, roomId, startTime, version}
 *   Response: {_record: [...]} — array of message objects
 */
function handleChatGetRecord() {
    $input    = getInput();
    $userId   = trim($input['userId'] ?? '');
    $roomId   = trim($input['roomId'] ?? '');
    $startTime = (int)($input['startTime'] ?? 0);

    if (empty($roomId)) {
        jsonResponse(['error' => 'Missing roomId'], 400);
    }

    $db = getDb();

    // startTime = 0 → get all recent; startTime > 0 → filter since that timestamp
    if ($startTime > 0) {
        $stmt = $db->prepare(
            "SELECT id, roomId, userId, nickName, content, kind, msgType, param,
                    image, headEffect, headBox, oriServerId, serverId, showMain,
                    UNIX_TIMESTAMP(createdAt) as msgTime
             FROM chat_messages
             WHERE roomId = :roomId AND UNIX_TIMESTAMP(createdAt) >= :startTime
             ORDER BY createdAt ASC
             LIMIT 100"
        );
        $stmt->execute([
            ':roomId'    => $roomId,
            ':startTime' => $startTime
        ]);
    } else {
        $stmt = $db->prepare(
            "SELECT id, roomId, userId, nickName, content, kind, msgType, param,
                    image, headEffect, headBox, oriServerId, serverId, showMain,
                    UNIX_TIMESTAMP(createdAt) as msgTime
             FROM chat_messages
             WHERE roomId = :roomId
             ORDER BY createdAt ASC
             LIMIT 100"
        );
        $stmt->execute([':roomId' => $roomId]);
    }

    $rows = $stmt->fetchAll();

    $record = [];
    foreach ($rows as $row) {
        $record[] = buildMessageObject($row);
    }

    jsonResponse(['_record' => $record]);
}

/**
 * buildMessageObject(row) — Convert DB row to client message object
 *
 * Evidence: L92098-92110 — ChatDataBaseClass.getData(t) expects:
 *   t._id = sender userId (NOT unique msg ID — used for blacklist check!)
 *   t._type = msgType (required — void 0 check filters out messages without type)
 *   t._time = Unix timestamp
 *   t._kind = MESSAGE_KIND (WORLD=2, GUILD=3, WORLD_TEAM=5, TEAM=6)
 *   t._name = sender nickname
 *   t._content = message text
 *   t._image = sender avatar
 *   t._param = additional params
 *   t._headEffect = head effect ID
 *   t._headBox = head box ID (mapped to _headBoxId by ChatDataBaseClass)
 *   t._oriServerId = original server
 *   t._serverId = current server
 *   t._showMain = boolean
 */
function buildMessageObject($row) {
    return [
        '_id'          => $row['userId'],       // userId — used for blacklist check (L92100-92108)
        '_time'        => (int)$row['msgTime'],  // Unix timestamp in seconds
        '_kind'        => (int)$row['kind'],     // MESSAGE_KIND
        '_name'        => $row['nickName'],      // Sender display name
        '_content'     => $row['content'],       // Message text
        '_image'       => $row['image'],         // Sender avatar URL
        '_param'       => $row['param'],         // Additional params
        '_type'        => $row['msgType'],        // Message type (required — void 0 check)
        '_headEffect'  => $row['headEffect'],    // Head effect ID
        '_headBox'     => $row['headBox'],       // Head box ID → ChatDataBaseClass maps to _headBoxId
        '_oriServerId' => $row['oriServerId'],   // Original server
        '_serverId'    => $row['serverId'],      // Current server
        '_showMain'    => (bool)$row['showMain'] // Show main flag
    ];
}
