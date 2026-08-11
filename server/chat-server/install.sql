-- ================================================================
-- Super Warrior Z — Chat Server Database Schema
-- ================================================================
-- Import via phpMyAdmin (port 9999):
--   1. Buat database "chat"
--   2. Pilih database → tab SQL → paste ini → Go
-- ================================================================
--
-- CHANGELOG:
--   v1.1: Added nickName, headImage, headEffect, headBox to chat_users
--         (user profile needed for chat messages — client doesn't send
--          these in sendMsg payload, server must know from login)
--
-- Evidence:
--   L92098-92110: ChatDataBaseClass.getData(t) reads t._id (= userId),
--     t._name, t._content, t._image, t._headEffect, t._headBox,
--     t._oriServerId, t._serverId, t._showMain from raw msg object
--   L83836-83845: sendMsg payload: {userId, kind, content, msgType, param, roomId}
--     — does NOT include nickName/headImage/headEffect/headBox
--   L114551-114556: login payload: {userId, serverId, version}
--     — does NOT include nickName either
--   => Server must obtain user profile from its own DB or a sync mechanism.
--      Our mock: handlers.js reads from main-server localStorage and passes
--      to api.php during login and sendMsg.
-- ================================================================

CREATE DATABASE IF NOT EXISTS `chat`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE `chat`;

-- ── chat_users ──
-- User profile table. Stores online status + display info for chat.
-- Profile populated during chatLogin (handlers.js reads from main-server
-- localStorage and passes to api.php).
CREATE TABLE IF NOT EXISTS chat_users (
  userId       VARCHAR(128) NOT NULL,
  serverId     VARCHAR(16)  NOT NULL DEFAULT '1',
  nickName     VARCHAR(64)  NOT NULL DEFAULT '',
  headImage    VARCHAR(256) NOT NULL DEFAULT '',
  headEffect   VARCHAR(64)  NOT NULL DEFAULT '0',
  headBox      VARCHAR(64)  NOT NULL DEFAULT '0',
  online       TINYINT(1)   NOT NULL DEFAULT 0,
  lastActivity DATETIME     NOT NULL,
  createdAt    DATETIME     NOT NULL,
  PRIMARY KEY (userId),
  INDEX idx_online (online),
  INDEX idx_serverId (serverId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── chat_rooms ──
-- Room registry. Pre-populated with default rooms.
CREATE TABLE IF NOT EXISTS chat_rooms (
  roomId    VARCHAR(64)  NOT NULL,
  name      VARCHAR(128) NOT NULL DEFAULT '',
  kind      VARCHAR(32)  NOT NULL DEFAULT '',
  createdAt DATETIME     NOT NULL,
  PRIMARY KEY (roomId),
  INDEX idx_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── chat_members ──
-- Tracks which users are in which rooms (for query/display purposes).
-- Real-time socket membership is in-memory via ChatServer._rooms.
CREATE TABLE IF NOT EXISTS chat_members (
  memberId     INT           NOT NULL AUTO_INCREMENT,
  userId       VARCHAR(128)  NOT NULL,
  roomId       VARCHAR(64)   NOT NULL,
  joinedAt     DATETIME      NOT NULL,
  lastActivity DATETIME      NOT NULL,
  PRIMARY KEY (memberId),
  UNIQUE INDEX idx_user_room (userId, roomId),
  INDEX idx_roomId (roomId),
  INDEX idx_userId (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── chat_messages ──
-- Message persistence. Each row = one chat message.
-- _id in the API response = userId (NOT a unique msg ID).
-- Evidence L92100-92108: ChatDataBaseClass.getData uses t._id for blacklist check
--   → for (var i in o) if (o[i] == t._id) { r = true; break; }
--   → t._id IS the sender's userId
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INT           NOT NULL AUTO_INCREMENT,
  roomId      VARCHAR(64)   NOT NULL,
  userId      VARCHAR(128)  NOT NULL,
  nickName    VARCHAR(64)   NOT NULL DEFAULT '',
  content     TEXT          NOT NULL,
  kind        INT           NOT NULL DEFAULT 2,
  msgType     VARCHAR(64)   NOT NULL DEFAULT '',
  param       TEXT          NOT NULL,
  image       VARCHAR(256)  NOT NULL DEFAULT '',
  headEffect  VARCHAR(64)   NOT NULL DEFAULT '',
  headBox     VARCHAR(64)   NOT NULL DEFAULT '',
  oriServerId VARCHAR(16)   NOT NULL DEFAULT '',
  serverId    VARCHAR(16)   NOT NULL DEFAULT '1',
  showMain    TINYINT(1)   NOT NULL DEFAULT 0,
  createdAt   DATETIME      NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_roomId (roomId),
  INDEX idx_userId (userId),
  INDEX idx_kind (kind),
  INDEX idx_createdAt (createdAt),
  INDEX idx_room_time (roomId, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Default rooms ──
INSERT INTO chat_rooms (roomId, name, kind, createdAt) VALUES
('world_1', 'World', 'world', NOW()),
('guild_1', 'Guild', 'guild', NOW()),
('teamDungeon_1', 'Team Dungeon', 'teamDungeon', NOW()),
('team_1', 'Team', 'team', NOW());
