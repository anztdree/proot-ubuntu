<?php
/**
 * config.php — SDK-Server Database Configuration
 * Super Warrior Z — PPGAME SDK
 *
 * Sesuaikan dengan KSWEB phpMyAdmin Anda.
 * nginx port 8080 (web) | phpMyAdmin port 9999 | MySQL port 3306
 */

define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_USER', 'root');
define('DB_PASS', 'root');
define('DB_NAME', 'sdk');
define('DB_CHARSET', 'utf8mb4');

define('SDK_CHANNEL', 'ppgame');
define('TEA_KEY', 'verification');
define('TOKEN_LENGTH', 64);
define('TOKEN_EXPIRY', 0);  // 0 = never expire

function getDb() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            ]);
        } catch (PDOException $e) {
            jsonResponse(['error' => 'Database connection failed: ' . $e->getMessage()], 500);
            exit;
        }
    }
    return $pdo;
}

function generateToken($length = TOKEN_LENGTH) {
    return bin2hex(random_bytes($length / 2));
}

function generateSign($userId) {
    $timestamp = time();
    return hash('sha256', $userId . '|' . $timestamp . '|' . SDK_CHANNEL);
}

function generateSecurity($userId, $loginToken) {
    return hash('sha256', $userId . '|' . $loginToken);
}

function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function getJsonInput() {
    $raw = file_get_contents('php://input');
    if (empty($raw)) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function getMethod() {
    return $_SERVER['REQUEST_METHOD'] ?? 'GET';
}
