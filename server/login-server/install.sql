-- ================================================================
-- Super Warrior Z — Login Server Database Schema
-- ================================================================
-- Import via phpMyAdmin (port 9999):
--   1. Buat database "login"
--   2. Pilih database → tab SQL → paste ini → Go
-- ================================================================

CREATE DATABASE IF NOT EXISTS `login`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE `login`;

-- ----------------------------------------------------------------
-- login_users — Data user + PERMANENT TOKEN + SECURITY CODE
-- loginToken di-generate sekali saat pertama kali, di-reuse seterusnya
-- securityCode di-generate sekali saat pertama kali, di-reuse seterusnya
-- Evidence: L138081 securityCode: e.security (from SDK login)
-- Evidence: L137910 securityCode: ts.loginInfo.userInfo.securityCode (used in SaveHistory)
-- Source of truth: DATABASE (bukan localStorage)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_users` (
  `userId`       VARCHAR(128) NOT NULL,
  `channelCode`  VARCHAR(32)  NOT NULL DEFAULT 'ppgame',
  `nickName`     VARCHAR(64)  NOT NULL DEFAULT '',
  `loginToken`   VARCHAR(128) NOT NULL DEFAULT '',
  `securityCode` VARCHAR(64)  NOT NULL DEFAULT '',
  `createdAt`    DATETIME     NOT NULL,
  `lastLoginAt`  DATETIME     NOT NULL,
  PRIMARY KEY (`userId`),
  INDEX `idx_channelCode` (`channelCode`),
  INDEX `idx_loginToken` (`loginToken`(32)),
  INDEX `idx_securityCode` (`securityCode`(16))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
-- login_servers — Daftar game server (main/chat/dungeon)
-- Bisa ditambah manual via phpMyAdmin
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_servers` (
  `serverId`  VARCHAR(16)  NOT NULL,
  `name`      VARCHAR(128) NOT NULL DEFAULT '',
  `url`       VARCHAR(256) NOT NULL DEFAULT '',
  `online`    TINYINT(1)   NOT NULL DEFAULT 1,
  `hot`       TINYINT(1)   NOT NULL DEFAULT 0,
  `new`       TINYINT(1)   NOT NULL DEFAULT 1,
  `sortOrder` INT          NOT NULL DEFAULT 0,
  `createdAt` DATETIME     NOT NULL,
  PRIMARY KEY (`serverId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
-- login_history — Riwayat login per user per server per hari
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_history` (
  `historyId`    INT           NOT NULL AUTO_INCREMENT,
  `userId`       VARCHAR(128)  NOT NULL,
  `channelCode`  VARCHAR(32)   NOT NULL DEFAULT 'ppgame',
  `serverId`     VARCHAR(16)   NOT NULL,
  `loginToken`   VARCHAR(128)  NOT NULL DEFAULT '',
  `loginDate`    DATE          NOT NULL,
  `loginCount`   INT           NOT NULL DEFAULT 1,
  `lastLoginAt`  DATETIME      NOT NULL,
  PRIMARY KEY (`historyId`),
  UNIQUE INDEX `idx_user_server_date` (`userId`(64), `serverId`, `loginDate`),
  INDEX `idx_userId` (`userId`(64)),
  INDEX `idx_loginDate` (`loginDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
-- login_notices — Pengumuman / bulletin board
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_notices` (
  `noticeId`    INT           NOT NULL AUTO_INCREMENT,
  `title`       TEXT          NOT NULL,
  `content`     TEXT          NOT NULL,
  `orderNo`     INT           NOT NULL DEFAULT 0,
  `alwaysPopup` TINYINT(1)   NOT NULL DEFAULT 0,
  `active`      TINYINT(1)   NOT NULL DEFAULT 1,
  `createdAt`   DATETIME      NOT NULL,
  `updatedAt`   DATETIME      NOT NULL,
  PRIMARY KEY (`noticeId`),
  INDEX `idx_active` (`active`),
  INDEX `idx_orderNo` (`orderNo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
-- login_languages — Preferensi bahasa user
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_languages` (
  `userId`    VARCHAR(128) NOT NULL,
  `language`  VARCHAR(16)  NOT NULL DEFAULT 'en',
  `updatedAt` DATETIME     NOT NULL,
  PRIMARY KEY (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
-- login_user_enter — Analytics: info saat user masuk game
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_user_enter` (
  `enterId`      INT           NOT NULL AUTO_INCREMENT,
  `userId`       VARCHAR(128)  NOT NULL,
  `channelCode`  VARCHAR(32)   NOT NULL DEFAULT 'ppgame',
  `subChannel`   VARCHAR(32)   NOT NULL DEFAULT '',
  `userLevel`    INT           NOT NULL DEFAULT 1,
  `createdAt`    DATETIME      NOT NULL,
  PRIMARY KEY (`enterId`),
  INDEX `idx_userId` (`userId`(64)),
  INDEX `idx_createdAt` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
-- Default data: 1 server
-- ----------------------------------------------------------------
INSERT INTO `login_servers` (`serverId`, `name`, `url`, `online`, `hot`, `new`, `sortOrder`, `createdAt`) VALUES
('1', 'Local 1', 'http://127.0.0.1:8001', 1, 0, 1, 1, NOW());

-- ----------------------------------------------------------------
-- Default data: 1 sample notice
-- ----------------------------------------------------------------
INSERT INTO `login_notices` (`title`, `content`, `orderNo`, `alwaysPopup`, `active`, `createdAt`, `updatedAt`) VALUES
('{"en":"Welcome","cn":"欢迎"}', '{"en":"Welcome to Super Warrior Z!","cn":"欢迎来到超级战士Z！"}', 1, 0, 1, NOW(), NOW());
