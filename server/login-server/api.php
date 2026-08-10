<?php
/**
 * api.php — Login Server PHP Backend
 * Super Warrior Z
 *
 * POST server/login-server/api.php?action=xxx
 *
 * Semua endpoint menerima POST (body JSON) + GET (query param)
 * Response selalu JSON.
 *
 * TOKEN PERMANEN:
 *   Setiap user mendapat 1 token permanen di login_users.loginToken
 *   Di-generate sekali saat pertama kali, di-reuse seterusnya.
 *   handleSaveUser  → generate/save token jika belum ada
 *   handleSaveHistory → retrieve existing token (atau generate jika belum ada)
 *   handleGetToken  → query token untuk validasi (main-server, dll)
 */

require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? '';
if ($action === '') {
    jsonResponse(['error' => 'Missing action parameter'], 400);
}

switch ($action) {
    case 'getServerList':
        handleGetServerList();
        break;
    case 'saveHistory':
        handleSaveHistory();
        break;
    case 'getNotice':
        handleGetNotice();
        break;
    case 'saveUserEnterInfo':
        handleSaveUserEnterInfo();
        break;
    case 'saveLanguage':
        handleSaveLanguage();
        break;
    case 'saveUser':
        handleSaveUser();
        break;
    case 'getToken':
        handleGetToken();
        break;
    default:
        jsonResponse(['error' => 'Unknown action: ' . $action], 404);
}

/**
 * getServerList — Ambil daftar server + history user
 * Request: { userId }
 * Response: { serverList: [...], history: [...] }
 */
function handleGetServerList() {
    $input = getInput();
    $userId = trim($input['userId'] ?? '');

    $db = getDb();

    // 1. Ambil semua server dari DB
    $stmt = $db->query("SELECT serverId, name, url, online, hot, new FROM login_servers ORDER BY sortOrder ASC, serverId ASC");
    $serverRows = $stmt->fetchAll();

    $serverList = [];
    foreach ($serverRows as $row) {
        $serverList[] = [
            'serverId' => $row['serverId'],
            'name'     => $row['name'],
            'url'      => $row['url'],
            'online'   => (bool)$row['online'],
            'hot'      => (bool)$row['hot'],
            'new'      => (bool)$row['new']
        ];
    }

    // 2. Ambil history user — server terakhir yang dimainkan (distinct)
    //    Evidence: L138094: t.history[0] → serverId string (bukan object!)
    //    Fix: GROUP BY + MAX(lastLoginAt) untuk deterministic ordering
    $history = [];
    if (!empty($userId)) {
        $stmt = $db->prepare(
            "SELECT serverId, MAX(lastLoginAt) as lastLogin
             FROM login_history
             WHERE userId = :userId
             GROUP BY serverId
             ORDER BY lastLogin DESC
             LIMIT 10"
        );
        $stmt->execute([':userId' => $userId]);
        $histRows = $stmt->fetchAll();
        foreach ($histRows as $row) {
            $history[] = $row['serverId'];
        }
    }

    jsonResponse([
        'serverList' => $serverList,
        'history'    => $history,
        'offlineReason' => ''
    ]);
}

/**
 * saveHistory — Simpan riwayat login, retrieve PERMANENT token, hitung login hari ini
 * Request: { accountToken, channelCode, serverId, securityCode, subChannel, version }
 * Response: { loginToken, todayLoginCount }
 *
 * TOKEN LOGIC:
 *   1. Cek login_users.loginToken untuk userId ini
 *   2. Kalau sudah ada → REUSE (token permanen)
 *   3. Kalau belum ada → GENERATE baru, simpan ke login_users.loginToken
 *   4. Upsert login_history dengan token permanen tsb
 */
function handleSaveHistory() {
    $input = getInput();
    $userId       = trim($input['accountToken'] ?? '');
    $channelCode  = trim($input['channelCode'] ?? 'ppgame');
    $serverId     = trim($input['serverId'] ?? '');
    $securityCode = trim($input['securityCode'] ?? '');
    $subChannel   = trim($input['subChannel'] ?? '');
    $version      = trim($input['version'] ?? '1.0');

    if (empty($userId) || empty($serverId)) {
        jsonResponse(['error' => 'Missing userId or serverId'], 400);
    }

    $db = getDb();

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Get or create PERMANENT token (1 per user, di login_users)
    // ═══════════════════════════════════════════════════════════════════

    $stmt = $db->prepare("SELECT loginToken FROM login_users WHERE userId = :userId");
    $stmt->execute([':userId' => $userId]);
    $userRow = $stmt->fetch();

    if ($userRow && !empty($userRow['loginToken'])) {
        // User sudah punya permanent token — REUSE
        $loginToken = $userRow['loginToken'];
    } else {
        // Pertama kali — generate permanent token
        $loginToken = bin2hex(random_bytes(32));

        // Simpan ke login_users (INSERT jika belum ada, UPDATE token jika kosong)
        $stmt = $db->prepare(
            "INSERT INTO login_users (userId, channelCode, nickName, loginToken, createdAt, lastLoginAt)
             VALUES (:userId, :channelCode, '', :loginToken, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                loginToken = IF(loginToken = '', VALUES(loginToken), loginToken),
                channelCode = VALUES(channelCode),
                lastLoginAt = NOW()"
        );
        $stmt->execute([
            ':userId'      => $userId,
            ':channelCode' => $channelCode,
            ':loginToken'  => $loginToken
        ]);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Upsert login_history (dengan token permanen)
    // ═══════════════════════════════════════════════════════════════════

    $today = date('Y-m-d');

    $stmt = $db->prepare(
        "INSERT INTO login_history (userId, channelCode, serverId, loginToken, loginDate, loginCount, lastLoginAt)
         VALUES (:userId, :channelCode, :serverId, :loginToken, :loginDate, 1, NOW())
         ON DUPLICATE KEY UPDATE
            loginToken = VALUES(loginToken),
            loginCount = loginCount + 1,
            lastLoginAt = NOW()"
    );
    $stmt->execute([
        ':userId'      => $userId,
        ':channelCode' => $channelCode,
        ':serverId'    => $serverId,
        ':loginToken'  => $loginToken,
        ':loginDate'   => $today
    ]);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Ambil todayLoginCount
    // ═══════════════════════════════════════════════════════════════════

    $stmt = $db->prepare(
        "SELECT loginCount FROM login_history
         WHERE userId = :userId AND serverId = :serverId AND loginDate = :loginDate"
    );
    $stmt->execute([
        ':userId'    => $userId,
        ':serverId'  => $serverId,
        ':loginDate' => $today
    ]);
    $row = $stmt->fetch();
    $todayLoginCount = $row ? (int)$row['loginCount'] : 1;

    // ═══════════════════════════════════════════════════════════════════
    // RETURN: permanent token + todayLoginCount
    // ═══════════════════════════════════════════════════════════════════

    jsonResponse([
        'loginToken'       => $loginToken,
        'todayLoginCount'  => $todayLoginCount
    ]);
}

/**
 * getNotice — Ambil daftar notice/pengumuman aktif
 * Response: { data: [...] }
 */
function handleGetNotice() {
    $db = getDb();

    $stmt = $db->query(
        "SELECT title, content, orderNo, alwaysPopup
         FROM login_notices
         WHERE active = 1
         ORDER BY orderNo ASC"
    );
    $rows = $stmt->fetchAll();

    $data = [];
    foreach ($rows as $row) {
        $data[] = [
            'text'        => json_decode($row['content'], true) ?: $row['content'],
            'title'       => json_decode($row['title'], true) ?: $row['title'],
            'version'     => '1.0',
            'orderNo'     => (int)$row['orderNo'],
            'alwaysPopup' => (bool)$row['alwaysPopup']
        ];
    }

    jsonResponse([
        'data' => $data
    ]);
}

/**
 * saveUserEnterInfo — Simpan analytics saat user masuk game
 * Request: { accountToken, channelCode, subChannel, createTime, userLevel, version }
 */
function handleSaveUserEnterInfo() {
    $input = getInput();
    $userId      = trim($input['accountToken'] ?? '');
    $channelCode = trim($input['channelCode'] ?? 'ppgame');
    $subChannel  = trim($input['subChannel'] ?? '');
    $userLevel   = (int)($input['userLevel'] ?? 1);

    $db = getDb();

    $stmt = $db->prepare(
        "INSERT INTO login_user_enter (userId, channelCode, subChannel, userLevel, createdAt)
         VALUES (:userId, :channelCode, :subChannel, :userLevel, NOW())"
    );
    $stmt->execute([
        ':userId'      => $userId,
        ':channelCode' => $channelCode,
        ':subChannel'  => $subChannel,
        ':userLevel'   => $userLevel
    ]);

    jsonResponse(['errorCode' => 0]);
}

/**
 * saveLanguage — Simpan preferensi bahasa user
 * Request: { userid, sdk, appid, language }
 */
function handleSaveLanguage() {
    $input = getInput();
    $userId   = trim($input['userid'] ?? '');
    $language = trim($input['language'] ?? 'en');

    $db = getDb();

    $stmt = $db->prepare(
        "INSERT INTO login_languages (userId, language, updatedAt)
         VALUES (:userId, :language, NOW())
         ON DUPLICATE KEY UPDATE language = VALUES(language), updatedAt = NOW()"
    );
    $stmt->execute([
        ':userId'   => $userId,
        ':language' => $language
    ]);

    jsonResponse(['errorCode' => 0]);
}

/**
 * saveUser — Simpan/update data user (dipanggil saat pertama kali via loginGame)
 * Request: { userId, channelCode, nickName }
 * Response: { success, loginToken, securityCode }
 *
 * Generate PERMANEN token + securityCode jika user belum punya.
 * Token disimpan di login_users.loginToken.
 * SecurityCode disimpan di login_users.securityCode.
 *
 * Evidence: L138076-138082 (sdkLoginSuccess pattern):
 *   ts.loginInfo.userInfo.securityCode = e.security
 *   → Real server generates securityCode during login
 *
 * Evidence: L137907-137910 (SaveHistory):
 *   securityCode: ts.loginInfo.userInfo.securityCode
 *   → securityCode MUST be set before SaveHistory is called
 */
function handleSaveUser() {
    $input = getInput();
    $userId      = trim($input['userId'] ?? '');
    $channelCode = trim($input['channelCode'] ?? 'ppgame');
    $nickName    = trim($input['nickName'] ?? '');

    if (empty($userId)) {
        jsonResponse(['error' => 'Missing userId'], 400);
    }

    $db = getDb();

    // Cek apakah user sudah punya permanent token & securityCode
    $loginToken = '';
    $securityCode = '';
    $stmt = $db->prepare("SELECT loginToken, securityCode FROM login_users WHERE userId = :userId");
    $stmt->execute([':userId' => $userId]);
    $existing = $stmt->fetch();

    if ($existing) {
        // User sudah ada — reuse token & securityCode
        $loginToken = $existing['loginToken'] ?: '';
        $securityCode = $existing['securityCode'] ?: '';
    }

    // Generate jika belum ada
    if (empty($loginToken)) {
        $loginToken = bin2hex(random_bytes(32)); // 64 hex chars
    }
    if (empty($securityCode)) {
        $securityCode = bin2hex(random_bytes(16)); // 32 hex chars
    }

    // Upsert user (token & securityCode hanya di-set jika masih kosong)
    $stmt = $db->prepare(
        "INSERT INTO login_users (userId, channelCode, nickName, loginToken, securityCode, createdAt, lastLoginAt)
         VALUES (:userId, :channelCode, :nickName, :loginToken, :securityCode, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
            channelCode = VALUES(channelCode),
            nickName = IF(VALUES(nickName) = '', nickName, VALUES(nickName)),
            loginToken = IF(loginToken = '', VALUES(loginToken), loginToken),
            securityCode = IF(securityCode = '', VALUES(securityCode), securityCode),
            lastLoginAt = NOW()"
    );
    $stmt->execute([
        ':userId'      => $userId,
        ':channelCode' => $channelCode,
        ':nickName'    => $nickName,
        ':loginToken'  => $loginToken,
        ':securityCode' => $securityCode
    ]);

    jsonResponse([
        'success'      => true,
        'loginToken'   => $loginToken,
        'securityCode' => $securityCode
    ]);
}

/**
 * getToken — Ambil permanent token user dari database
 * Request: { userId }
 * Response: { userId, loginToken, found: bool }
 *
 * Digunakan untuk validasi token.
 * Misalnya: main-server bisa call ini untuk validasi loginToken user.
 */
function handleGetToken() {
    $input = getInput();
    $userId = trim($input['userId'] ?? '');

    if (empty($userId)) {
        jsonResponse(['error' => 'Missing userId'], 400);
    }

    $db = getDb();

    $stmt = $db->prepare("SELECT loginToken FROM login_users WHERE userId = :userId");
    $stmt->execute([':userId' => $userId]);
    $row = $stmt->fetch();

    if ($row && !empty($row['loginToken'])) {
        jsonResponse([
            'userId'     => $userId,
            'loginToken' => $row['loginToken'],
            'found'      => true
        ]);
    } else {
        jsonResponse([
            'userId'     => $userId,
            'loginToken' => '',
            'found'      => false
        ]);
    }
}
