-- ═══════════════════════════════════════════════════════════════
-- Super Warrior Z — SDK Server Database Schema
-- ═══════════════════════════════════════════════════════════════
-- Import via phpMyAdmin (port 9999):
--   1. Buat database "sdk"
--   2. Pilih database → tab SQL → paste ini → Go

CREATE DATABASE IF NOT EXISTS `sdk`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE `sdk`;

CREATE TABLE IF NOT EXISTS `sdk_users` (
  `userId`      VARCHAR(128) NOT NULL,
  `loginToken`  VARCHAR(128) NOT NULL,
  `nickName`    VARCHAR(64)  NOT NULL DEFAULT '',
  `sign`        VARCHAR(128) NOT NULL DEFAULT '',
  `security`    VARCHAR(128) NOT NULL DEFAULT '',
  `channel`     VARCHAR(32)  NOT NULL DEFAULT 'ppgame',
  `createdAt`   DATETIME     NOT NULL,
  `lastLoginAt` DATETIME     NOT NULL,
  PRIMARY KEY (`userId`),
  INDEX `idx_loginToken` (`loginToken`(64))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `sdk_payments` (
  `paymentId`   VARCHAR(128)  NOT NULL,
  `userId`      VARCHAR(128)  NOT NULL DEFAULT '',
  `orderId`     VARCHAR(128)  NOT NULL DEFAULT '',
  `productName` VARCHAR(128)  NOT NULL DEFAULT '',
  `productId`   VARCHAR(64)   NOT NULL DEFAULT '',
  `price`       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `currency`    VARCHAR(8)    NOT NULL DEFAULT 'USD',
  `status`      VARCHAR(16)   NOT NULL DEFAULT 'pending',
  `createdAt`   DATETIME      NOT NULL,
  `confirmedAt` DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (`paymentId`),
  INDEX `idx_userId` (`userId`(64)),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `sdk_events` (
  `eventId`   INT          NOT NULL AUTO_INCREMENT,
  `userId`    VARCHAR(128) NOT NULL DEFAULT '',
  `eventType` VARCHAR(64)  NOT NULL DEFAULT '',
  `eventData` TEXT         NULL DEFAULT NULL,
  `createdAt` DATETIME     NOT NULL,
  PRIMARY KEY (`eventId`),
  INDEX `idx_userId` (`userId`(64)),
  INDEX `idx_eventType` (`eventType`),
  INDEX `idx_createdAt` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
