-- ============================================================================
-- Discord Clone — PostgreSQL Schema (Full DDL)
-- ============================================================================
-- Version: 1.0.0
-- Database: discord_clone
-- PostgreSQL: 16+
--
-- Key Design Decisions:
--   1. UUID primary keys (gen_random_uuid()) — no sequential ID guessing
--   2. ENUM types for categorical columns — 4 bytes vs variable VARCHAR
--   3. ON DELETE CASCADE everywhere — single DELETE propagates cleanly
--   4. UNIQUE constraints for business rules at the DB level
--   5. Indexes tuned for the READY gateway query (Section 5.3)
--   6. Cursor-based pagination indexes (NOT OFFSET)
--   7. users.status REMOVED — presence lives in Redis/in-memory (Section 7.3)
--
-- Run: psql -d discord_clone -f schema.sql
-- ============================================================================

-- Clean slate (development only — remove in production migrations)
DROP TABLE IF EXISTS voice_states CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS server_members CASCADE;
DROP TABLE IF EXISTS servers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS member_role CASCADE;
DROP TYPE IF EXISTS channel_type CASCADE;
DROP TYPE IF EXISTS message_type CASCADE;

-- ============================================================================
-- ENUM TYPES (Optimization #4)
-- ============================================================================
-- Using ENUMs instead of VARCHAR for categorical columns:
--   - 4 bytes storage vs variable-length string
--   - Schema-level validation (can't INSERT invalid values)
--   - Faster WHERE comparisons (integer vs string compare)
--
-- NOTE: users.status ENUM was REMOVED. Presence is volatile state
-- tracked in Redis/in-memory, NOT persisted in PostgreSQL.
-- See ARCHITECTURE.md Section 7.3 "The Redis vs. SQL Presence Paradox".
-- ============================================================================

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE channel_type AS ENUM ('text', 'voice');
CREATE TYPE message_type AS ENUM ('text', 'image', 'system');

-- ============================================================================
-- USERS TABLE
-- ============================================================================
-- No 'status' column — presence lives in Redis/in-memory (Section 7.3).
-- If you add users.status back, the READY query will return stale presence
-- data once you migrate to Redis. This is the "Presence Paradox" from
-- ARCHITECTURE.md Section 7.3.
-- ============================================================================

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(32) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_username_unique UNIQUE (username),
    CONSTRAINT users_username_length CHECK (char_length(username) >= 2),
    CONSTRAINT users_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- ============================================================================
-- SERVERS TABLE
-- ============================================================================

CREATE TABLE servers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    icon_url    TEXT,
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_code VARCHAR(8) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT servers_invite_code_unique UNIQUE (invite_code),
    CONSTRAINT servers_name_length CHECK (char_length(name) >= 1)
);

-- ============================================================================
-- SERVER_MEMBERS TABLE (Many-to-Many: users <-> servers)
-- ============================================================================

CREATE TABLE server_members (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    role      member_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent double-join: a user can only be a member of a server once
    CONSTRAINT server_members_unique UNIQUE (user_id, server_id)
);

-- ============================================================================
-- CHANNELS TABLE
-- ============================================================================

CREATE TABLE channels (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name      VARCHAR(100) NOT NULL,
    topic     TEXT,
    type      channel_type NOT NULL DEFAULT 'text',
    position  INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT channels_name_length CHECK (char_length(name) >= 1)
);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================

CREATE TABLE messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    type       message_type NOT NULL DEFAULT 'text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT messages_content_not_empty CHECK (char_length(content) >= 1)
);

-- ============================================================================
-- VOICE_STATES TABLE
-- ============================================================================
-- UNIQUE(user_id): A user can only be in ONE voice channel at a time.
-- This is Optimization #3 — prevents "ghost clone" bugs when a user
-- disconnects from one channel and reconnects to another, with the
-- old disconnect webhook arriving late.
--
-- The ON CONFLICT DO UPDATE pattern (see ARCHITECTURE.md Section 4.4,
-- Optimization #3) atomically moves the user to the new channel.
-- ============================================================================

CREATE TABLE voice_states (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    self_mute  BOOLEAN NOT NULL DEFAULT FALSE,
    self_deaf  BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ⚠️ CRITICAL: Ghost clone prevention (Optimization #3)
    CONSTRAINT voice_states_user_unique UNIQUE (user_id)
);

-- ============================================================================
-- INDEXES (Optimization #1: READY Gateway Query + #2: Cursor Pagination)
-- ============================================================================

-- Optimization #1: READY gateway query performance
-- These three indexes make the gateway SQL query (Section 5.3) fast:

-- Find ALL servers a user belongs to (starting point of READY query)
CREATE INDEX idx_server_members_user_id ON server_members(user_id);

-- Aggregate members per server (member count in READY)
CREATE INDEX idx_server_members_server_id ON server_members(server_id);

-- Fetch + sort channels per server in one index scan
CREATE INDEX idx_channels_server_position ON channels(server_id, position);

-- Optimization #2: Cursor-based pagination for message history
-- The DESC direction in the index matches ORDER BY created_at DESC
-- so Postgres does a forward index scan (no reverse-scan or filesort)
CREATE INDEX idx_messages_channel_cursor ON messages(channel_id, created_at DESC);

-- Voice state lookups
CREATE INDEX idx_voice_states_channel_id ON voice_states(channel_id);
-- user_id is already UNIQUE-indexed by the constraint above

-- Server invite code lookups (already UNIQUE-indexed by constraint)
-- CREATE INDEX idx_servers_invite_code ON servers(invite_code); -- redundant

-- ============================================================================
-- HELPER FUNCTION: auto-update updated_at on row modification
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_servers_updated_at
    BEFORE UPDATE ON servers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_channels_updated_at
    BEFORE UPDATE ON channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- DONE
-- ============================================================================
-- Schema ready. Run seed.sql next for test data.
-- ============================================================================
