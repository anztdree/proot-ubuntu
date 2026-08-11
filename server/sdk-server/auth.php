<?php
/**
 * auth.php — SDK Authentication Handler
 * Super Warrior Z — PPGAME SDK
 *
 * POST server/sdk-server/auth.php?action=guest    → Guest login
 * POST server/sdk-server/auth.php?action=login    → Login by userId
 * POST server/sdk-server/auth.php?action=validate → Validate session
 *
 * Database = source of truth. localStorage di sdk.js cuma client-side cache.
 */

require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? '';
if ($action === '') {
    jsonResponse(['error' => 'Missing action parameter. Use ?action=guest|login|validate'], 400);
}
if (getMethod() !== 'POST') {
    jsonResponse(['error' => 'Method not allowed. Use POST.'], 405);
}

switch ($action) {
    case 'guest':
        handleGuestLogin();
        break;
    case 'login':
        handleLogin();
        break;
    case 'validate':
        handleValidateSession();
        break;
    default:
        jsonResponse(['error' => 'Unknown action: ' . $action], 404);
}

function handleGuestLogin() {
    $db = getDb();

    $userId = 'guest_' . time() . '_' . bin2hex(random_bytes(4));
    $loginToken = generateToken();
    $nickName = 'Player_' . bin2hex(random_bytes(2));
    $sign = generateSign($userId);
    $security = generateSecurity($userId, $loginToken);

    $stmt = $db->prepare(
        "INSERT INTO sdk_users (userId, loginToken, nickName, sign, security, channel, createdAt, lastLoginAt)
         VALUES (:userId, :loginToken, :nickName, :sign, :security, :channel, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
            loginToken = VALUES(loginToken), nickName = VALUES(nickName),
            sign = VALUES(sign), security = VALUES(security), lastLoginAt = NOW()"
    );
    $stmt->execute([
        ':userId' => $userId, ':loginToken' => $loginToken,
        ':nickName' => $nickName, ':sign' => $sign,
        ':security' => $security, ':channel' => SDK_CHANNEL
    ]);

    jsonResponse([
        'userId' => $userId,
        'loginToken' => $loginToken,
        'nickName' => $nickName,
        'sign' => $sign,
        'security' => $security
    ]);
}

function handleLogin() {
    $input = getJsonInput();
    $userId = trim($input['userId'] ?? '');

    if (empty($userId)) {
        jsonResponse(['error' => 'userId is required'], 400);
    }

    $db = getDb();
    $loginToken = generateToken();
    $sign = generateSign($userId);
    $security = generateSecurity($userId, $loginToken);

    $stmt = $db->prepare("SELECT nickName FROM sdk_users WHERE userId = :userId");
    $stmt->execute([':userId' => $userId]);
    $existing = $stmt->fetch();
    $nickName = $existing ? $existing['nickName'] : $userId;

    $stmt = $db->prepare(
        "INSERT INTO sdk_users (userId, loginToken, nickName, sign, security, channel, createdAt, lastLoginAt)
         VALUES (:userId, :loginToken, :nickName, :sign, :security, :channel, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
            loginToken = VALUES(loginToken), sign = VALUES(sign),
            security = VALUES(security), lastLoginAt = NOW()"
    );
    $stmt->execute([
        ':userId' => $userId, ':loginToken' => $loginToken,
        ':nickName' => $nickName, ':sign' => $sign,
        ':security' => $security, ':channel' => SDK_CHANNEL
    ]);

    jsonResponse([
        'userId' => $userId,
        'loginToken' => $loginToken,
        'nickName' => $nickName,
        'sign' => $sign,
        'security' => $security
    ]);
}

function handleValidateSession() {
    $input = getJsonInput();
    $loginToken = trim($input['loginToken'] ?? '');
    $userId = trim($input['userId'] ?? '');

    if (empty($loginToken) || empty($userId)) {
        jsonResponse(['valid' => false, 'error' => 'Missing loginToken or userId'], 400);
    }

    $db = getDb();
    $stmt = $db->prepare("SELECT loginToken, sign, security, lastLoginAt FROM sdk_users WHERE userId = :userId");
    $stmt->execute([':userId' => $userId]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonResponse(['valid' => false, 'error' => 'User not found']);
    }
    if ($user['loginToken'] !== $loginToken) {
        jsonResponse(['valid' => false, 'error' => 'Invalid token']);
    }
    if (TOKEN_EXPIRY > 0 && time() - strtotime($user['lastLoginAt']) > TOKEN_EXPIRY) {
        jsonResponse(['valid' => false, 'error' => 'Token expired']);
    }

    $newSign = generateSign($userId);
    $newSecurity = generateSecurity($userId, $loginToken);

    $stmt = $db->prepare("UPDATE sdk_users SET sign = :sign, security = :security WHERE userId = :userId");
    $stmt->execute([':sign' => $newSign, ':security' => $newSecurity, ':userId' => $userId]);

    jsonResponse([
        'valid' => true,
        'sign' => $newSign,
        'securityCode' => $newSecurity
    ]);
}
