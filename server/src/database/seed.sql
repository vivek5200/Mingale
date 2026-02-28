-- ============================================================================
-- Discord Clone — Seed Data (for development/testing)
-- ============================================================================
-- Run AFTER schema.sql: psql -d discord_clone -f seed.sql
--
-- Creates:
--   2 users (alice, bob) — password: "password123" (bcrypt hashed)
--   1 server ("Test Server") owned by alice, with bob as member
--   3 channels (#general, #random, Voice Lounge)
--   A few sample messages
-- ============================================================================

-- Bcrypt hash for "password123" (12 rounds)
-- Generated with: bcrypt.hashSync('password123', 12)
\set alice_hash '$2a$12$LJ3d2.yrW2p0YER3D3d3AO8NkiHnR3dlvHhGY9bQBQ7PRHzHNh8Cm'
\set bob_hash '$2a$12$LJ3d2.yrW2p0YER3D3d3AO8NkiHnR3dlvHhGY9bQBQ7PRHzHNh8Cm'

-- Users
INSERT INTO users (id, username, email, password_hash) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'alice', 'alice@test.com', :'alice_hash'),
  ('a0000000-0000-0000-0000-000000000002', 'bob',   'bob@test.com',   :'bob_hash')
ON CONFLICT (email) DO NOTHING;

-- Server
INSERT INTO servers (id, name, owner_id, invite_code) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Test Server', 'a0000000-0000-0000-0000-000000000001', 'TESTCODE')
ON CONFLICT DO NOTHING;

-- Members
INSERT INTO server_members (user_id, server_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'owner'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'member')
ON CONFLICT (user_id, server_id) DO NOTHING;

-- Channels
INSERT INTO channels (id, server_id, name, type, position) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'general',       'text',  0),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'random',        'text',  1),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Voice Lounge',  'voice', 2)
ON CONFLICT DO NOTHING;

-- Sample messages
INSERT INTO messages (channel_id, user_id, content, type) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Welcome to the Test Server! 🎉', 'system'),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Hey everyone!', 'text'),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Hi Alice! Great to be here.', 'text'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Anyone want to voice chat?', 'text');

SELECT 'Seed data inserted successfully!' AS status;
