<?php
/**
 * payment.php — SDK Payment Handler
 * Super Warrior Z — PPGAME SDK
 *
 * POST server/sdk-server/payment.php?action=create  → Buat order
 * POST server/sdk-server/payment.php?action=confirm → Konfirmasi bayar
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
    case 'create':
        handleCreateOrder();
        break;
    case 'confirm':
        handleConfirmPayment();
        break;
    default:
        jsonResponse(['error' => 'Unknown action: ' . $action], 404);
}

function handleCreateOrder() {
    $input = getJsonInput();

    $paymentId = 'pay_' . time() . '_' . bin2hex(random_bytes(4));
    $userId = trim($input['userId'] ?? '');

    $db = getDb();
    $stmt = $db->prepare(
        "INSERT INTO sdk_payments (paymentId, userId, orderId, productName, productId, price, currency, status, createdAt)
         VALUES (:paymentId, :userId, :orderId, :productName, :productId, :price, :currency, 'pending', NOW())"
    );
    $stmt->execute([
        ':paymentId' => $paymentId,
        ':userId' => $userId,
        ':orderId' => trim($input['orderId'] ?? ''),
        ':productName' => trim($input['productName'] ?? ''),
        ':productId' => trim($input['productId'] ?? ''),
        ':price' => floatval($input['price'] ?? 0),
        ':currency' => trim($input['currency'] ?? 'USD')
    ]);

    jsonResponse(['paymentId' => $paymentId, 'status' => 'pending']);
}

function handleConfirmPayment() {
    $input = getJsonInput();
    $paymentId = trim($input['paymentId'] ?? '');

    if (empty($paymentId)) {
        jsonResponse(['error' => 'paymentId is required'], 400);
    }

    $db = getDb();
    $stmt = $db->prepare("UPDATE sdk_payments SET status = 'confirmed', confirmedAt = NOW() WHERE paymentId = :paymentId");
    $stmt->execute([':paymentId' => $paymentId]);

    if ($stmt->rowCount() === 0) {
        jsonResponse(['success' => false, 'error' => 'Payment not found'], 404);
    }

    jsonResponse(['success' => true]);
}
