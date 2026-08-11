<?php
/**
 * event.php — SDK Event Report Handler
 * Super Warrior Z — PPGAME SDK
 *
 * POST server/sdk-server/event.php?action=report → Log event
 */

require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? '';
if ($action === '') {
    jsonResponse(['error' => 'Missing action parameter'], 400);
}
if (getMethod() !== 'POST') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

switch ($action) {
    case 'report':
        handleEventReport();
        break;
    default:
        jsonResponse(['error' => 'Unknown action: ' . $action], 404);
}

function handleEventReport() {
    $input = getJsonInput();
    $eventType = trim($input['eventType'] ?? 'unknown');
    $userId = trim($input['userId'] ?? '');
    $eventData = $input['data'] ?? [];

    $db = getDb();
    $stmt = $db->prepare(
        "INSERT INTO sdk_events (userId, eventType, eventData, createdAt)
         VALUES (:userId, :eventType, :eventData, NOW())"
    );
    $stmt->execute([
        ':userId' => $userId,
        ':eventType' => $eventType,
        ':eventData' => is_array($eventData) ? json_encode($eventData, JSON_UNESCAPED_UNICODE) : $eventData
    ]);

    jsonResponse(['success' => true]);
}
