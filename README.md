# Discord Clone — Full Architecture Document

> **Solo Engineer Execution Plan**
> Target: 50-person voice/video rooms, real-time text chat, server/channel management
> Date: February 28, 2026

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [System Architecture](#2-system-architecture)
3. [Data Flow Diagrams](#3-data-flow-diagrams)
4. [PostgreSQL Schema Design](#4-postgresql-schema-design)
5. [Node.js API Design](#5-nodejs-api-design)
6. [React Frontend Design](#6-react-frontend-design)
7. [WebSocket Signaling Design](#7-websocket-signaling-design)
8. [Go SFU (Pion) Design](#8-go-sfu-pion-design)
9. [Bridge & Deployment](#9-bridge--deployment)
10. [Phase-by-Phase Execution Roadmap](#10-phase-by-phase-execution-roadmap)
11. [Technical Warnings & Gotchas](#11-technical-warnings--gotchas)

---

## 1. High-Level Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
│                                                                      │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │  React UI   │   │  Socket.io   │   │  WebRTC PeerConnection   │  │
│  │  (Next.js)  │   │  Client      │   │  (getUserMedia + SDP)    │  │
│  └──────┬──────┘   └──────┬───────┘   └───────────┬──────────────┘  │
│         │                 │                        │                  │
└─────────┼─────────────────┼────────────────────────┼─────────────────┘
          │ REST/HTTP       │ WebSocket (wss://)     │ HTTP POST (SDP)
          │ :3001           │ :3001                  │ :8080
          ▼                 ▼                        ▼
┌──────────────────────────────┐          ┌────────────────────────────┐
│     NODE.JS API SERVER       │          │      GO SFU SERVER         │
│     (Express + Socket.io)    │◄────────►│      (Pion WebRTC)        │
│                              │ Webhook  │                            │
│  • Auth (JWT)                │ Bridge   │  • SDP Offer/Answer        │
│  • REST CRUD                 │ (HTTP)   │  • Track Multiplexing      │
│  • Text Chat Routing         │          │  • Room State Management   │
│  • Presence Tracking         │          │  • 50-peer fanout          │
│  • Message Persistence       │          │                            │
└──────────────┬───────────────┘          └────────────────────────────┘
               │
               │ SQL (pg driver)
               ▼
┌──────────────────────────────┐
│        POSTGRESQL            │
│                              │
│  • users                     │
│  • servers                   │
│  • server_members            │
│  • channels                  │
│  • messages                  │
│  • voice_states              │
└──────────────────────────────┘
```

### Why This Architecture?

| Decision | Reasoning |
|---|---|
| **Node.js for API** | Fast iteration, huge ecosystem, native JSON handling, Socket.io maturity |
| **Go for SFU** | CPU-bound media forwarding needs Go's goroutine concurrency model; Pion is production-grade |
| **PostgreSQL** | ACID transactions, JSONB for flexible metadata, battle-tested at scale |
| **Separate Go + Node** | Decouples media plane from signaling plane — media crashes don't kill chat |
| **Socket.io** | Handles reconnection, rooms, namespaces, fallback to long-polling out of the box |
| **Redis (Phase 3+)** | Presence tracking, pub/sub for horizontal scaling later |

---

## 2. System Architecture

### 2.1 Three-Process Model

```
Process 1: Node.js API Server (port 3001)
  ├── Express HTTP routes (REST API)
  ├── Socket.io WebSocket server (attached to same HTTP server)
  ├── JWT middleware
  └── PostgreSQL connection pool

Process 2: Go SFU Server (port 8080)
  ├── HTTP endpoint: POST /offer (SDP exchange)
  ├── HTTP endpoint: POST /leave (cleanup)
  ├── RoomState map (sync.RWMutex)
  └── Pion WebRTC PeerConnection management

Process 3: PostgreSQL (port 5432)
  └── All persistent data
```

### 2.2 Network Boundaries

```
Internet ──► Nginx (port 443)
              ├── /trpc/*         ──► Node.js :3001 (tRPC HTTP handler)
              ├── /socket.io/*    ──► Node.js :3001 (WebSocket upgrade)
              ├── /rtc/*          ──► Go :8080
              └── /*              ──► Next.js static / SSR
```

---

## 3. Data Flow Diagrams

### 3.1 User Registration & Login → READY Event

```
Client                    Node API (tRPC)             PostgreSQL
  │                          │                          │
  │  tRPC auth.register      │                          │
  │  {email, username, pass} │                          │
  │─────────────────────────►│                          │
  │                          │  INSERT INTO users       │
  │                          │─────────────────────────►│
  │                          │  Return user row         │
  │                          │◄─────────────────────────│
  │  { token: JWT }          │                          │
  │◄─────────────────────────│                          │
  │                          │                          │
  │  Socket.io connect       │                          │
  │  auth: { token }         │                          │
  │─────────────────────────►│                          │
  │                          │  Verify JWT              │
  │                          │  Run gateway query       │
  │                          │─────────────────────────►│
  │                          │  Full aggregated payload │
  │                          │◄─────────────────────────│
  │                          │                          │
  │  emit('ready', {         │                          │
  │    user, servers,        │                          │
  │    channels, members,    │                          │
  │    voiceStates,          │                          │
  │    presenceMap           │                          │
  │  })                      │                          │
  │◄─────────────────────────│                          │
  │                          │                          │
  │  ✅ Entire UI renders   │                          │
  │  from single payload     │                          │
```

### 3.2 Real-Time Text Message

```
Client A                  Node API (Socket.io)       PostgreSQL      Client B
  │                          │                          │                │
  │  emit('message:send',   │                          │                │
  │   {channelId, content}) │                          │                │
  │─────────────────────────►│                          │                │
  │                          │  INSERT INTO messages    │                │
  │                          │─────────────────────────►│                │
  │                          │  Saved                   │                │
  │                          │◄─────────────────────────│                │
  │                          │                          │                │
  │                          │  emit('message:new')     │                │
  │                          │──────────────────────────────────────────►│
  │  emit('message:new')    │                          │                │
  │◄─────────────────────────│                          │                │
```

### 3.3 Voice Channel Join (WebRTC via Go SFU — Voice Ticket Auth)

> **⚠️ The Go SFU MUST NOT trust client-provided IDs.**
> The SFU is exposed to the internet via Nginx `/rtc/*`. Without auth,
> anyone can `cURL` a fake SDP offer with a forged userId and join any
> private voice room. See Section 11.5 for the full threat model.

```
Client                    Node API              Go SFU               Other Peers
  │                          │                    │                      │
  │  Click "Join Voice"      │                    │                      │
  │                          │                    │                      │
  │  ┌─────────────────────────────────────────┐  │                      │
  │  │ STEP 1: Get a Voice Ticket from Node.js │  │                      │
  │  │ (proves user is authenticated + allowed) │  │                      │
  │  └─────────────────────────────────────────┘  │                      │
  │                          │                    │                      │
  │  GET /trpc/voice.getTicket                    │                      │
  │  { roomId: channel-uuid }│                    │                      │
  │─────────────────────────►│                    │                      │
  │                          │  Verify JWT        │                      │
  │                          │  Check membership  │                      │
  │                          │  Check channel type│                      │
  │                          │  Generate ticket:  │                      │
  │                          │    HMAC-SHA256(    │                      │
  │                          │      secret,       │                      │
  │                          │      userId+roomId │                      │
  │                          │      +expiry       │                      │
  │                          │    )               │                      │
  │  { ticket, expiresAt }   │                    │                      │
  │◄─────────────────────────│                    │                      │
  │                          │                    │                      │
  │  ┌─────────────────────────────────────────┐  │                      │
  │  │ STEP 2: Send ticket + SDP to Go SFU     │  │                      │
  │  └─────────────────────────────────────────┘  │                      │
  │                          │                    │                      │
  │  getUserMedia() ─► local │                    │                      │
  │  video/audio stream      │                    │                      │
  │  createOffer() ─► SDP    │                    │                      │
  │                          │                    │                      │
  │  POST /rtc/offer         │                    │                      │
  │  {sdp, ticket}           │                    │                      │
  │──────────────────────────────────────────────►│                      │
  │                          │                    │  Verify ticket HMAC  │
  │                          │                    │  Check expiry < 30s  │
  │                          │                    │  Extract userId,     │
  │                          │                    │    roomId from ticket│
  │                          │                    │  Create PeerConn     │
  │                          │                    │  SetRemoteDesc(offer)│
  │                          │                    │  CreateAnswer()      │
  │                          │                    │  Add to RoomState    │
  │                          │                    │                      │
  │  { sdp: answer }         │                    │                      │
  │◄──────────────────────────────────────────────│                      │
  │                          │                    │                      │
  │  setRemoteDescription()  │                    │  OnTrack() fires     │
  │  ICE completes           │                    │  Forward track to    │
  │  Media flows ◄──────────────────────────────► │  all other peers     │
  │                          │                    │──────────────────────►│
```

**Voice Ticket Format:**

```
Ticket = base64(JSON) + "." + HMAC-SHA256(secret, base64(JSON))

JSON payload:
{
  "userId": "uuid",
  "roomId": "channel-uuid",
  "exp": 1709136000     // Unix timestamp, 30 seconds from now
}
```

**Node.js — Generate ticket (tRPC procedure):**

```typescript
// server/src/trpc/routers/voice.ts
getTicket: protectedProcedure
  .input(z.object({ roomId: z.string().uuid() }))
  .query(async ({ input, ctx }) => {
    const { roomId } = input;
    const userId = ctx.userId;

    // 1. Verify the channel exists and is a voice channel
    const channel = await pool.query(
      `SELECT c.id, c.server_id, c.type FROM channels c
       WHERE c.id = $1 AND c.type = 'voice'`,
      [roomId]
    );
    if (channel.rowCount === 0) throw new TRPCError({ code: 'NOT_FOUND' });

    // 2. Verify the user is a member of this server
    const member = await pool.query(
      'SELECT 1 FROM server_members WHERE user_id = $1 AND server_id = $2',
      [userId, channel.rows[0].server_id]
    );
    if (member.rowCount === 0) throw new TRPCError({ code: 'FORBIDDEN' });

    // 3. ⚠️ PRE-EMPTIVE KICK — Prevent "Phantom Listener" exploit
    //    If the user is already in a DIFFERENT voice channel, we MUST
    //    forcefully terminate their old Go SFU PeerConnection BEFORE
    //    issuing the new ticket. Otherwise the DB atomically moves them
    //    to the new room, but the old PeerConnection stays alive in Go,
    //    letting them secretly eavesdrop on the old room's audio/video.
    const existing = await pool.query(
      'SELECT channel_id FROM voice_states WHERE user_id = $1',
      [userId]
    );
    if (existing.rowCount > 0 && existing.rows[0].channel_id !== roomId) {
      // Kick from old room in Go SFU (HMAC-signed webhook)
      await sendInternalWebhook('http://localhost:8080/rtc/kick', {
        userId,
        roomId: existing.rows[0].channel_id,
      });
      // Delete old voice state (Go webhook might also do this, but
      // we do it here to guarantee atomicity)
      await pool.query(
        'DELETE FROM voice_states WHERE user_id = $1',
        [userId]
      );
      // Notify UI that user left the old channel
      io.to(existing.rows[0].channel_id).emit('voice:user-left', {
        channelId: existing.rows[0].channel_id,
        userId,
      });
      logger.info(
        `Pre-emptive kick: ${userId} removed from ${existing.rows[0].channel_id} before joining ${roomId}`
      );
    }

    // 4. Generate HMAC-signed ticket (30-second TTL)
    const exp = Math.floor(Date.now() / 1000) + 30;
    const payload = JSON.stringify({ userId, roomId, exp });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const signature = crypto
      .createHmac('sha256', process.env.INTERNAL_SECRET!)
      .update(payloadB64)
      .digest('base64url');

    return {
      ticket: `${payloadB64}.${signature}`,
      expiresAt: exp,
    };
  }),
```

**Go — Verify ticket before allocating WebRTC resources:**

```go
// sfu/internal/signal/handler.go
type OfferRequest struct {
    SDP    string `json:"sdp"`
    Ticket string `json:"ticket"` // replaces raw userId + roomId
}

type TicketPayload struct {
    UserID string `json:"userId"`
    RoomID string `json:"roomId"`
    Exp    int64  `json:"exp"`
}

func (h *Handler) verifyTicket(ticket string) (*TicketPayload, error) {
    parts := strings.SplitN(ticket, ".", 2)
    if len(parts) != 2 {
        return nil, fmt.Errorf("malformed ticket")
    }
    payloadB64, sig := parts[0], parts[1]

    // 1. Verify HMAC signature
    mac := hmac.New(sha256.New, []byte(h.config.InternalSecret))
    mac.Write([]byte(payloadB64))
    expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
    if !hmac.Equal([]byte(expectedSig), []byte(sig)) {
        return nil, fmt.Errorf("invalid signature")
    }

    // 2. Decode payload
    payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadB64)
    if err != nil {
        return nil, fmt.Errorf("decode error: %w", err)
    }
    var payload TicketPayload
    if err := json.Unmarshal(payloadBytes, &payload); err != nil {
        return nil, fmt.Errorf("unmarshal error: %w", err)
    }

    // 3. Check expiry
    if time.Now().Unix() > payload.Exp {
        return nil, fmt.Errorf("ticket expired")
    }

    return &payload, nil
}

func (h *Handler) HandleOffer(w http.ResponseWriter, r *http.Request) {
    var req OfferRequest
    json.NewDecoder(r.Body).Decode(&req)

    // ✅ Verify ticket BEFORE allocating ANY WebRTC resources
    ticket, err := h.verifyTicket(req.Ticket)
    if err != nil {
        http.Error(w, "unauthorized: "+err.Error(), http.StatusUnauthorized)
        return
    }

    // Now we trust ticket.UserID and ticket.RoomID
    // ... create PeerConnection, set remote description, etc.
}
```

### 3.4 Disconnect & Webhook Bridge

```
Go SFU                     Node API                    All Clients
  │                          │                            │
  │  PeerConn.OnClose()     │                            │
  │  detected disconnect     │                            │
  │                          │                            │
  │  POST /api/internal/     │                            │
  │  voice-disconnect        │                            │
  │  {userId, roomId}       │                            │
  │─────────────────────────►│                            │
  │                          │  UPDATE voice_states       │
  │                          │  Remove user from room     │
  │                          │                            │
  │                          │  emit('voice:user-left')   │
  │                          │───────────────────────────►│
```

---

## 4. PostgreSQL Schema Design

### 4.1 Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│    users     │       │  server_members   │       │   servers    │
├──────────────┤       ├──────────────────┤       ├──────────────┤
│ id (PK)      │◄──┐   │ id (PK)          │   ┌──►│ id (PK)      │
│ username     │   └───│ user_id (FK)     │   │   │ name         │
│ email        │       │ server_id (FK)   │───┘   │ owner_id(FK) │
│ password_hash│       │ role             │       │ icon_url     │
│ avatar_url   │       │ joined_at        │       │ invite_code  │
│ status       │       └──────────────────┘       │ created_at   │
│ created_at   │                                   └──────┬───────┘
└──────┬───────┘                                          │
       │                                                   │
       │       ┌──────────────────┐       ┌───────────────┘
       │       │    channels      │       │
       │       ├──────────────────┤       │
       │       │ id (PK)          │◄──────┘
       │       │ server_id (FK)   │
       │       │ name             │
       │       │ type (text/voice)│
       │       │ position         │
       │       │ created_at       │
       │       └────────┬─────────┘
       │                │
       │    ┌───────────┴──────────┐
       │    │                      │
       │    ▼                      ▼
┌──────┴──────────┐    ┌──────────────────┐
│   messages      │    │  voice_states    │
├─────────────────┤    ├──────────────────┤
│ id (PK)         │    │ id (PK)          │
│ channel_id (FK) │    │ channel_id (FK)  │
│ user_id (FK)    │    │ user_id (FK)     │
│ content         │    │ session_id       │
│ type            │    │ self_mute        │
│ created_at      │    │ self_deaf        │
│ updated_at      │    │ joined_at        │
└─────────────────┘    └──────────────────┘
```

### 4.2 Detailed Table Definitions

See `/server/src/database/schema.sql` for the full DDL.

**Key Design Decisions:**

| Table | Decision | Why |
|---|---|---|
| `users.password_hash` | bcrypt, not plaintext | Security 101 |
| ~~`users.status`~~ | **REMOVED — presence lives in Redis/in-memory** | Prevents stale-status paradox when migrating to Redis. See Section 7.3. |
| `server_members.role` | ENUM('owner','admin','member') | Simple RBAC without a full roles table (V1) |
| `channels.type` | ENUM('text','voice') | Determines routing — text goes to Socket.io, voice goes to Go SFU |
| `channels.position` | INTEGER | Allows drag-to-reorder in UI |
| `messages.type` | ENUM('text','image','system') | System messages for "X joined the server" |
| `voice_states` | Separate table, not a column | Multiple users in same channel; tracks mute/deaf state per user |

### 4.3 Indexes Strategy

```
users(email)              — UNIQUE, login lookups
users(username)           — UNIQUE, display/search
servers(invite_code)      — UNIQUE, join-by-invite
server_members(user_id, server_id) — UNIQUE composite, prevent double-join
server_members(user_id)   — READY query: find all servers for a user (Optimization #1)
server_members(server_id) — READY query: aggregate members per server (Optimization #1)
channels(server_id, position)      — READY query: ordered channel list per server (Optimization #1)
messages(channel_id, created_at DESC) — Cursor pagination, NOT OFFSET (Optimization #2)
voice_states(channel_id)           — Who's in this voice channel right now?
voice_states(user_id)              — UNIQUE, ghost clone prevention (Optimization #3)
```

### 4.4 Five Critical Database Optimizations

> **These 5 optimizations are non-negotiable. Each one prevents a specific
> production failure that will surface at scale. Read the schema.sql file
> header for the full commentary alongside the DDL.**

#### Optimization 1: Indexes Tuned for the READY Gateway Query

The READY event (Section 5.3) fires a single SQL query that JOINs `server_members`
→ `servers` → `channels` → `voice_states` and aggregates everything into JSON
via `json_agg()`. Three indexes make this fast:

| Index | Purpose in READY Query |
|---|---|
| `server_members(user_id)` | Find ALL servers a user belongs to — starting point of the entire query |
| `server_members(server_id)` | Aggregate members per server for the member list |
| `channels(server_id, position)` | Fetch + sort channels per server in one index scan |

Without these indexes, the READY query degrades from ~50ms → 800ms+ as the
database falls back to sequential scans across the growing `server_members` and
`channels` tables.

#### Optimization 2: Cursor Pagination (NOT OFFSET)

Message history uses **cursor-based** pagination, not OFFSET:

```sql
-- ✅ CURSOR — O(log n), consistently fast regardless of depth
SELECT * FROM messages
WHERE channel_id = $1 AND created_at < $cursor
ORDER BY created_at DESC
LIMIT 50;

-- ❌ OFFSET — O(n), Postgres scans and DISCARDS rows, slower every page
SELECT * FROM messages
WHERE channel_id = $1
ORDER BY created_at DESC
LIMIT 50 OFFSET 5000;  -- scans 5050 rows, discards 5000
```

The composite index `messages(channel_id, created_at DESC)` serves both the
`WHERE` filter and the `ORDER BY` in a single B-tree walk. The `DESC` direction
in the index definition matters — it matches the query's `ORDER BY ... DESC` so
Postgres avoids a reverse index scan or sort step.

**Rule: OFFSET pagination is banned in this codebase. All paginated queries use
cursor-based `WHERE ... < $cursor` patterns.**

#### Optimization 3: UNIQUE(user_id) on voice_states — Ghost Prevention + Pre-Emptive Kick

A user can physically only be in ONE voice channel at a time. The `UNIQUE(user_id)`
constraint on `voice_states` enforces this at the database level:

```sql
-- Atomic "move user to voice channel" — handles reconnects + race conditions
INSERT INTO voice_states (channel_id, user_id, session_id)
VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO UPDATE
SET channel_id = EXCLUDED.channel_id,
    session_id = EXCLUDED.session_id,
    self_mute  = FALSE,
    self_deaf  = FALSE,
    joined_at  = NOW();
```

**Why this is a load-bearing constraint:**
- Browser crashes → Go SFU detects disconnect (5-10s timeout) → user reconnects
  and joins a new channel → late disconnect webhook fires and the old cleanup
  races with the new join.
- Without `UNIQUE(user_id)`: both INSERT succeed → user appears in two channels
  simultaneously → **ghost clone bug**.
- With `UNIQUE(user_id)`: the `ON CONFLICT DO UPDATE` atomically moves the user,
  no application-level locking needed.

> **⚠️ CRITICAL: The "Phantom Listener" Exploit**
>
> `ON CONFLICT DO UPDATE` fixes the **database**, but it does NOT fix the
> **Go SFU**. If a user connects to Room A, then gets a ticket for Room B
> and connects a second PeerConnection, the database atomically moves
> them to Room B — but the Go SFU still has an active PeerConnection in
> Room A. The user is now **secretly receiving audio/video from Room A**
> while the UI shows them in Room B.
>
> **The fix: Pre-Emptive Kick.** Before inserting the new voice state,
> Node.js must check if the user already has an active voice state. If
> so, it sends `POST /rtc/kick` to the Go SFU to forcefully terminate
> the old PeerConnection before the database move happens.
> See the `voice.getTicket` tRPC procedure in Section 3.3 for the
> full implementation.

#### Optimization 4: ENUM Types for Memory Efficiency

All categorical columns use PostgreSQL `ENUM` types instead of `VARCHAR`:

| Column | ENUM Definition | Storage |
|---|---|---|
| `server_members.role` | `('owner','admin','member')` | 4 bytes |
| `channels.type` | `('text','voice')` | 4 bytes |
| `messages.type` | `('text','image','system')` | 4 bytes |

> **Note:** `users.status` was removed from PostgreSQL. Presence is volatile
> state tracked in Redis/in-memory (Section 7.3), not persisted in SQL.

Over millions of message rows, ENUM saves significant storage and makes
`WHERE type = 'text'` comparisons faster (integer compare vs string compare).
ENUMs also act as schema-level validation — you can't `INSERT status = 'banana'`
without an `ALTER TYPE` migration.

**Trade-off:** Adding a new enum value requires `ALTER TYPE ... ADD VALUE`, which
is a schema migration. This is acceptable for V1 where the categories are stable.

#### Optimization 5: ON DELETE CASCADE Everywhere

Every foreign key in the schema uses `ON DELETE CASCADE`:

```
DELETE FROM servers WHERE id = $1;
  → Automatically deletes: channels, server_members, messages, voice_states
  → Single statement, single transaction, atomically consistent
```

| Parent Deleted | Cascading Cleanup |
|---|---|
| `users` row | All their `server_members`, `messages`, `voice_states`, and owned `servers` |
| `servers` row | All its `channels`, `server_members`, and transitively all `messages` + `voice_states` |
| `channels` row | All its `messages` and `voice_states` |

Without CASCADE, deleting a server would require manually running 4+ DELETE
statements in the correct order (voice_states → messages → channels →
server_members) wrapped in a transaction — error-prone and slow.

---

## 5. Node.js API Design

### ⚠️ 5.0 Why NOT Plain REST

```
THE "REST WATERFALL" TRAP — THE N+1 PROBLEM

If you build classic REST endpoints (GET /servers, GET /servers/:id/channels,
GET /servers/:id/members), here's what happens when a user opens the app:

  Request 1:  GET /api/users/me                        → 120ms
  Request 2:  GET /api/servers                          → 80ms
  Request 3:  GET /api/servers/aaa/channels              → 60ms  ┐
  Request 4:  GET /api/servers/bbb/channels              → 60ms  │ parallelized,
  Request 5:  GET /api/servers/ccc/channels              → 60ms  │ but still 3-5
  Request 6:  GET /api/servers/aaa/members               → 70ms  │ round-trips
  Request 7:  GET /api/servers/bbb/members               → 70ms  ┘
  ──────────────────────────────────────────────────────
  TOTAL: 7 HTTP requests, ~400-600ms best case, 2-3s on slow connections
  The user stares at loading spinners the entire time.

THE FIX: GATEWAY PATTERN ("READY" EVENT)

Discord does NOT use REST to load the app. Instead:
  1. Client authenticates via REST (POST /auth/login → JWT)
  2. Client opens Socket.io connection with JWT
  3. Server fires ONE event: 'ready' containing ALL bootstrap data
  4. App renders instantly from that single payload

  Total: 1 REST call + 1 WebSocket message = ~200ms to fully loaded UI
```

**Decision: We use a hybrid approach:**
- **REST (tRPC):** Auth (register/login) + write mutations (create/update/delete)
- **WebSocket READY event:** ALL initial read data bundled in one shot
- **WebSocket events:** All real-time updates after initial load

### 5.1 Type Safety with tRPC

```
THE TYPE SAFETY PROBLEM

With raw Express + manual JSON shapes:
  - You change a DB column → manually update the Express controller
  - Manually update the Axios response type on the frontend
  - Manually update the Zustand store interface
  - Miss one? Silent runtime bug. No compiler warning.

With tRPC:
  - You define the shape ONCE in a shared router
  - Frontend imports the type directly — zero code generation
  - Change the backend shape → frontend shows red underlines instantly
  - Full autocomplete for every API call in VS Code
```

### 5.2 Folder Structure (tRPC + Socket.io Hybrid)

```
server/
├── src/
│   ├── index.ts                  # Entry point: Express + tRPC + Socket.io bootstrap
│   ├── config/
│   │   ├── database.ts           # PostgreSQL pool configuration
│   │   ├── env.ts                # Environment variable loader (zod validated)
│   │   └── socket.ts             # Socket.io server config
│   ├── trpc/
│   │   ├── index.ts              # tRPC router root (appRouter)
│   │   ├── context.ts            # Request context (user, db pool)
│   │   ├── middleware.ts         # Auth middleware (isAuthed procedure)
│   │   └── routers/
│   │       ├── auth.router.ts    # register, login mutations
│   │       ├── user.router.ts    # updateProfile mutation
│   │       ├── server.router.ts  # create, update, delete, join mutations
│   │       ├── channel.router.ts # create, update, delete mutations
│   │       ├── message.router.ts # getMessages query (cursor pagination)
│   │       └── internal.router.ts # voice-disconnect + reconcile (Go bridge)
│   ├── services/
│   │   ├── auth.service.ts       # Hash passwords, sign/verify JWT
│   │   ├── user.service.ts
│   │   ├── server.service.ts     # Business logic for server CRUD
│   │   ├── channel.service.ts
│   │   ├── message.service.ts
│   │   ├── presence.service.ts   # Online/offline tracking
│   │   └── gateway.service.ts    # ⭐ Assembles the READY payload
│   ├── models/
│   │   ├── user.model.ts         # SQL queries for users table
│   │   ├── server.model.ts
│   │   ├── channel.model.ts
│   │   ├── message.model.ts
│   │   └── voiceState.model.ts
│   ├── socket/
│   │   ├── index.ts              # Socket.io initialization & namespace setup
│   │   ├── handlers/
│   │   │   ├── connection.handler.ts    # Auth → fire READY event
│   │   │   ├── message.handler.ts       # Real-time text chat
│   │   │   ├── presence.handler.ts      # Online/offline/typing events
│   │   │   └── voice.handler.ts         # Voice state change events
│   │   └── middleware/
│   │       └── socketAuth.ts     # JWT auth for WebSocket connections
│   ├── database/
│   │   ├── schema.sql            # Full DDL
│   │   ├── seed.sql              # Test data
│   │   └── migrations/           # Versioned migrations (future)
│   └── utils/
│       ├── logger.ts             # Pino logger
│       ├── errors.ts             # Custom error classes
│       └── helpers.ts            # Shared utilities
├── .env.example
├── package.json
├── tsconfig.json
└── nodemon.json

shared/                           # ⭐ SHARED TYPES PACKAGE (used by both server/ and client/)
├── src/
│   ├── types/
│   │   ├── user.ts               # User, UserProfile
│   │   ├── server.ts             # Server, ServerWithChannels
│   │   ├── channel.ts            # Channel, ChannelType
│   │   ├── message.ts            # Message, MessageType
│   │   ├── voice.ts              # VoiceState
│   │   └── gateway.ts            # ⭐ ReadyPayload type definition
│   └── index.ts                  # Re-exports everything
├── package.json
└── tsconfig.json
```

**Key change:** The `routes/` + `controllers/` layers are GONE. tRPC replaces
both — a router IS the controller, and type-safety IS the validation.

### 5.3 The READY Event (Gateway Pattern)

```
⭐ THIS IS THE SINGLE MOST IMPORTANT OPTIMIZATION IN THE ENTIRE APP.

When the Socket.io connection authenticates, the server assembles and
pushes the READY payload — one event that bootstraps the entire UI.
```

#### ⚠️ 5.3.1 The "JSON Bomb" Problem — Why Members Are NOT in READY

```
THE PROBLEM WITH SENDING ALL MEMBERS IN READY:

If a user joins 5 servers, each with 10,000 members, the READY query
aggregates 50,000 user rows into a multi-megabyte JSON string.

  PostgreSQL:  CPU spike aggregating 50k rows via json_agg()
  Node.js:     OOM crash parsing and holding the blob in memory
  WebSocket:   Multi-MB frame chokes the connection
  Browser:     Tab freezes rendering 50,000 member DOM nodes

This WILL happen. Discord ran into this exact problem and solved it
with "Guild Member Chunking" — members are NEVER sent in the initial
READY event. They are fetched lazily per-server when the user clicks
on a specific server.

OUR APPROACH (matching Discord's solution):

  READY event includes:
    ✅ User profile
    ✅ Server metadata (id, name, icon, ownerId)
    ✅ Channels per server
    ✅ Voice states (these are always small — max 50 per room)
    ✅ Online member COUNT per server (a single integer, not the list)
    ❌ NO member arrays — too dangerous at scale

  Members are fetched separately:
    → User clicks on a server in the sidebar
    → React calls tRPC: server.getMembers({ serverId, cursor, limit: 100 })
    → First 100 members load instantly
    → Scrolling the member sidebar triggers cursor pagination for more
```

**READY Payload Shape (members excluded):**

```typescript
// shared/src/types/gateway.ts
interface ReadyPayload {
  user: {
    id: string;
    username: string;
    email: string;
    avatarUrl: string | null;
    status: 'online' | 'idle' | 'dnd' | 'offline';
  };
  servers: Array<{
    id: string;
    name: string;
    iconUrl: string | null;
    ownerId: string;
    inviteCode: string;
    channels: Array<{
      id: string;
      name: string;
      type: 'text' | 'voice';
      topic: string | null;
      position: number;
    }>;
    // ❌ NO members array — fetched lazily via tRPC
    // ✅ Only a lightweight count for the sidebar badge
    memberCount: number;           // from SQL: COUNT(*) on server_members
    onlineMemberCount: number;     // from Redis/in-memory, NOT SQL (Section 7.3)
    voiceStates: Array<{
      channelId: string;
      userId: string;
      selfMute: boolean;
      selfDeaf: boolean;
    }>;
  }>;
  // Assembled from Redis/in-memory Map, NOT from SQL (Section 7.3)
  presenceMap: Record<string, 'online' | 'idle' | 'dnd' | 'offline'>;
}
```

**Server-side assembly (gateway.service.ts):**

```sql
-- ONE optimized SQL query — NO member arrays, NO presence (lives in Redis/memory).
-- Members fetched lazily via tRPC server.getMembers.
-- Presence stitched from Redis/in-memory Map in Node.js (see Section 7.3).

SELECT
  s.id, s.name, s.icon_url, s.owner_id, s.invite_code,
  (
    SELECT json_agg(json_build_object(
      'id', c.id, 'name', c.name, 'type', c.type,
      'topic', c.topic, 'position', c.position
    ) ORDER BY c.position)
    FROM channels c WHERE c.server_id = s.id
  ) AS channels,
  -- ✅ Total member count (SQL is source of truth for membership)
  (
    SELECT COUNT(*)
    FROM server_members sm2
    WHERE sm2.server_id = s.id
  ) AS member_count,
  -- ⚠️ onlineMemberCount is NOT calculated here.
  -- It is computed from Redis/in-memory presence in Node.js.
  -- See Section 7.3 "Hybrid Assembly" for why.
  (
    SELECT json_agg(json_build_object(
      'channelId', vs.channel_id, 'userId', vs.user_id,
      'selfMute', vs.self_mute, 'selfDeaf', vs.self_deaf
    ))
    FROM voice_states vs
    JOIN channels vc ON vc.id = vs.channel_id
    WHERE vc.server_id = s.id
  ) AS voice_states
FROM server_members sm
JOIN servers s ON s.id = sm.server_id
WHERE sm.user_id = $1;
```

#### 5.3.2 Lazy Member Loading (Guild Member Chunking)

Members are fetched **on demand** when the user navigates to a server.
The tRPC query uses cursor-based pagination identical to message history.

**tRPC procedure (`server.getMembers`):**

```typescript
// server/src/trpc/routers/server.ts
getMembers: protectedProcedure
  .input(z.object({
    serverId: z.string().uuid(),
    cursor: z.string().optional(),   // joined_at cursor for pagination
    limit: z.number().min(1).max(200).default(100),
  }))
  .query(async ({ input, ctx }) => {
    const { serverId, cursor, limit } = input;

    // Verify the requesting user is a member of this server
    const isMember = await pool.query(
      'SELECT 1 FROM server_members WHERE user_id = $1 AND server_id = $2',
      [ctx.userId, serverId]
    );
    if (isMember.rowCount === 0) throw new TRPCError({ code: 'FORBIDDEN' });

    // Cursor-based pagination (same pattern as message history)
    const result = await pool.query(
      `SELECT u.id AS "userId", u.username, u.avatar_url AS "avatarUrl",
              sm.role, u.status, sm.joined_at
       FROM server_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.server_id = $1
         ${cursor ? 'AND sm.joined_at < $3' : ''}
       ORDER BY
         CASE u.status WHEN 'online' THEN 0 WHEN 'idle' THEN 1
                       WHEN 'dnd' THEN 2 ELSE 3 END,
         sm.joined_at DESC
       LIMIT $2`,
      cursor ? [serverId, limit + 1, cursor] : [serverId, limit + 1]
    );

    const hasMore = result.rows.length > limit;
    const members = result.rows.slice(0, limit);
    const nextCursor = hasMore ? members[members.length - 1].joined_at : null;

    return { members, nextCursor };
  }),
```

**React — Load members when server is selected:**

```typescript
// client/src/hooks/useServerMembers.ts
import { trpc } from '@/lib/trpc';

export function useServerMembers(serverId: string | null) {
  return trpc.server.getMembers.useInfiniteQuery(
    { serverId: serverId!, limit: 100 },
    {
      enabled: !!serverId,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 30_000,  // Cache for 30s — don't refetch on every click
    }
  );
}

// In the sidebar member list component:
// const { data, fetchNextPage, hasNextPage } = useServerMembers(activeServerId);
// → Render first 100 members instantly
// → IntersectionObserver triggers fetchNextPage() as user scrolls
```

**Payload size comparison:**

| Scenario | Old (members in READY) | New (lazy loading) |
|---|---|---|
| 5 servers × 50 members | ~25 KB ✅ | ~5 KB + 100 on click ✅ |
| 5 servers × 1,000 members | ~500 KB ⚠️ | ~5 KB + 100 on click ✅ |
| 5 servers × 10,000 members | ~5 MB 💀 OOM risk | ~5 KB + 100 on click ✅ |
| 5 servers × 50,000 members | ~25 MB 💀💀 guaranteed crash | ~5 KB + 100 on click ✅ |

**Data flow:**

```
Client                         Node.js Server                    PostgreSQL
  │                                │                                │
  │  POST /trpc/auth.login         │                                │
  │  {email, password}             │                                │
  │───────────────────────────────►│                                │
  │  { token: JWT }                │                                │
  │◄───────────────────────────────│                                │
  │                                │                                │
  │  Socket.io connect             │                                │
  │  auth: { token: JWT }          │                                │
  │───────────────────────────────►│                                │
  │                                │  Verify JWT                    │
  │                                │  Run gateway query (1 SQL)     │
  │                                │  (no member arrays — fast!)    │
  │                                │───────────────────────────────►│
  │                                │  Lightweight payload returned  │
  │                                │◄───────────────────────────────│
  │                                │                                │
  │  emit('ready', ReadyPayload)   │                                │
  │◄───────────────────────────────│                                │
  │                                │                                │
  │  ✅ Server list + channels     │                                │
  │     rendered instantly         │                                │
  │  (1 REST + 1 WS = ~150ms)     │                                │
  │                                │                                │
  │  User clicks on Server A       │                                │
  │                                │                                │
  │  GET /trpc/server.getMembers   │                                │
  │  {serverId, limit: 100}        │                                │
  │───────────────────────────────►│                                │
  │                                │  Fetch first 100 members       │
  │                                │───────────────────────────────►│
  │                                │◄───────────────────────────────│
  │  { members[], nextCursor }     │                                │
  │◄───────────────────────────────│                                │
  │                                │                                │
  │  ✅ Member sidebar populated   │                                │
  │  (scroll → fetch next 100)     │                                │
```

### 5.4 tRPC Endpoints (Write Mutations Only)

REST/HTTP is now used **only for auth and write operations**. All initial reads
come from the READY event. Subsequent reads (like message pagination) use tRPC queries.

| Router | Procedure | Type | Auth | Description |
|---|---|---|---|---|
| `auth` | `register` | mutation | No | Create account, return JWT |
| `auth` | `login` | mutation | No | Verify credentials, return JWT |
| `user` | `updateProfile` | mutation | Yes | Update username/avatar/status |
| `server` | `create` | mutation | Yes | Create a new server |
| `server` | `update` | mutation | Yes | Update server (owner/admin) |
| `server` | `delete` | mutation | Yes | Delete server (owner only) |
| `server` | `join` | mutation | Yes | Join server via invite code |
| `channel` | `create` | mutation | Yes | Create channel (admin+) |
| `channel` | `update` | mutation | Yes | Update channel |
| `channel` | `delete` | mutation | Yes | Delete channel |
| `server` | `getMembers` | query | Yes | Lazy-loaded member list (cursor-paginated, 100/page) |
| `voice` | `getTicket` | query | Yes | HMAC-signed voice ticket (30s TTL) for Go SFU auth |
| `message` | `getHistory` | query | Yes | Cursor-paginated message history |
| `internal` | `voiceDisconnect` | mutation | Internal | Go SFU webhook |
| `internal` | `voiceReconcile` | mutation | Internal | Go SFU state sync |

**Endpoints REMOVED vs. old design:**

```
❌ GET /api/users/me            → Replaced by READY event
❌ GET /api/servers              → Replaced by READY event
❌ GET /api/servers/:id          → Replaced by READY event
❌ GET /api/servers/:id/channels → Replaced by READY event
❌ GET /api/servers/:id/members  → ⚠️ NOT in READY — lazy loaded via
                                   tRPC server.getMembers (see 5.3.2)

✅ User/server/channel reads: ZERO requests after READY.
✅ Member list: ONE tRPC query per server, on click, cursor-paginated.
   This prevents the "JSON bomb" OOM from aggregating 50k members.
```

### 5.5 Socket.io Events (Real-Time Updates)

After the READY event loads the app, all subsequent changes arrive as
incremental WebSocket events that **patch** the Zustand store:

| Direction | Event | Payload | Description |
|---|---|---|---|
| Server → Client | `ready` | `ReadyPayload` | **⭐ Full app bootstrap (one shot)** |
| Client → Server | `message:send` | `{channelId, content, type}` | Send text message |
| Server → Client | `message:new` | `{message}` | New message broadcast |
| Server → Client | `message:updated` | `{message}` | Message edited |
| Server → Client | `message:deleted` | `{messageId, channelId}` | Message removed |
| Client → Server | `typing:start` | `{channelId}` | User started typing |
| Server → Client | `typing:update` | `{channelId, userId, username}` | Broadcast typing indicator |
| Client → Server | `presence:update` | `{status}` | Change online status |
| Server → Client | `presence:changed` | `{userId, status}` | User status changed |
| Server → Client | `voice:user-joined` | `{channelId, userId}` | Someone joined voice |
| Server → Client | `voice:user-left` | `{channelId, userId}` | Someone left voice |
| Client → Server | `voice:mute-toggle` | `{selfMute, selfDeaf}` | Toggle mute/deaf |
| Server → Client | `server:member-joined` | `{serverId, member}` | New member joined |
| Server → Client | `server:member-left` | `{serverId, userId}` | Member left server |
| Server → Client | `channel:created` | `{serverId, channel}` | New channel created |
| Server → Client | `channel:deleted` | `{serverId, channelId}` | Channel removed |
| Server → Client | `voice:reconciled` | `{channelId, userIds[]}` | Ghost users purged |

---

## 6. React Frontend Design

### ⚠️ 6.0 Safari / iOS WebRTC Warnings

```
Apple's WebRTC implementation is the most restrictive of all browsers.
These issues WILL bite you in Phase 2 and Phase 5. Plan for them now.

1. AUTOPLAY POLICY (iOS Safari)
   ─────────────────────────────
   iOS Safari blocks ALL audio and video playback unless it is triggered
   by a direct user gesture (click/tap). This means:

   ✗ BROKEN:  Automatically playing incoming video when a peer joins
   ✗ BROKEN:  Auto-playing audio tracks on page load
   ✓ WORKS:   Playing media inside a click handler

   Solution: When the user clicks "Join Voice Channel", use THAT click
   event to call .play() on all <video>/<audio> elements. Store a
   flag `userHasInteracted = true` and use it to gate all future
   .play() calls. For new peers that join later, attach their stream
   to a <video> element and call .play() — it will work because the
   user already interacted with the voice UI.

   Code pattern:
     const videoEl = document.createElement('video');
     videoEl.srcObject = remoteStream;
     videoEl.setAttribute('playsinline', '');  // ← REQUIRED on iOS
     videoEl.setAttribute('autoplay', '');      // hint, not guaranteed
     videoEl.play().catch(() => {
       // Queue for play on next user interaction
       pendingPlayElements.push(videoEl);
     });

2. MULTIPLE getUserMedia() CALLS
   ─────────────────────────────
   If you call getUserMedia() more than once on iOS (e.g., to switch
   cameras or re-request permissions), Safari will silently MUTE the
   tracks from the previous call without firing any error.

   Solution: Call getUserMedia() ONCE on voice join. Store the stream.
   To switch cameras, use MediaStreamTrack.applyConstraints() or
   replaceTrack() on the RTCRtpSender — do NOT request a new stream.

3. REQUIRED ATTRIBUTES
   ─────────────────────────────
   Every <video> element that displays a remote stream MUST have:
     - `playsinline` attribute (prevents iOS from hijacking to fullscreen)
     - `autoplay` attribute
     - `muted` attribute for local preview (prevents echo)

4. H.264 CODEC REQUIREMENT
   ─────────────────────────────
   Safari only supports H.264 for video WebRTC (no VP8/VP9).
   Ensure your SDP negotiation prefers H.264 or includes it as a
   fallback. Pion supports H.264 out of the box — just make sure
   you don't filter it out during SDP munging.
```

### 6.1 Folder Structure

```
client/
├── public/
│   └── favicon.ico
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── layout.tsx            # Root layout with providers
│   │   ├── page.tsx              # Landing / redirect
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   └── (main)/
│   │       └── servers/
│   │           └── [serverId]/
│   │               └── channels/
│   │                   └── [channelId]/
│   │                       └── page.tsx    # Main chat/voice view
│   ├── components/
│   │   ├── layout/
│   │   │   ├── ServerSidebar.tsx          # Left icon strip (server list)
│   │   │   ├── ChannelSidebar.tsx         # Channel list + server name
│   │   │   ├── MemberSidebar.tsx          # Right panel: online members
│   │   │   └── MainContent.tsx            # Center: messages or voice
│   │   ├── chat/
│   │   │   ├── MessageList.tsx            # Virtualized message scroll
│   │   │   ├── MessageItem.tsx            # Single message bubble
│   │   │   ├── MessageInput.tsx           # Text input + attachments
│   │   │   └── TypingIndicator.tsx
│   │   ├── voice/
│   │   │   ├── VoiceChannel.tsx           # Voice channel view
│   │   │   ├── VoiceControls.tsx          # Mute/Deaf/Disconnect buttons
│   │   │   ├── VideoGrid.tsx             # Grid of video feeds
│   │   │   └── VideoTile.tsx             # Single participant video
│   │   ├── server/
│   │   │   ├── CreateServerModal.tsx
│   │   │   ├── JoinServerModal.tsx
│   │   │   └── ServerSettings.tsx
│   │   ├── user/
│   │   │   ├── UserPanel.tsx              # Bottom-left user info
│   │   │   └── UserSettings.tsx
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       ├── Avatar.tsx
│   │       ├── Tooltip.tsx
│   │       └── LoadingSpinner.tsx
│   ├── hooks/
│   │   ├── useAuth.ts                    # Login/register/token management
│   │   ├── useSocket.ts                  # Socket.io connection hook
│   │   ├── useMessages.ts               # Fetch + real-time messages
│   │   ├── useMediaDevices.ts            # getUserMedia wrapper
│   │   ├── useWebRTC.ts                  # PeerConnection to Go SFU
│   │   └── usePresence.ts               # Online status tracking
│   ├── store/
│   │   ├── index.ts                      # Zustand store root
│   │   ├── authSlice.ts                  # User + token state
│   │   ├── serverSlice.ts               # Servers + channels state
│   │   ├── messageSlice.ts              # Messages per channel
│   │   ├── voiceSlice.ts                # Voice connection state
│   │   └── presenceSlice.ts             # Online users map
│   ├── lib/
│   │   ├── trpc.ts                       # tRPC client + React Query hooks
│   │   ├── socket.ts                     # Socket.io client singleton
│   │   └── webrtc.ts                     # WebRTC helper functions
│   ├── types/                            # ⚠️ IMPORTS FROM shared/ package
│   │   └── index.ts                      # Re-exports from @discord/shared
│   └── styles/
│       └── globals.css                   # Tailwind + Discord-like theme
├── tailwind.config.ts
├── next.config.js
├── tsconfig.json
└── package.json
```

### 6.2 State Architecture (Zustand)

```
Store Shape:
{
  // ⭐ HYDRATION GAP PROTECTION (see Section 7.1)
  _hydration: {
    isBuffering: boolean,              // true while READY is being hydrated
    earlyEventQueue: QueuedEvent[],    // events that arrive during hydration
    setBuffering(enabled) → void,
    pushEvent(event: QueuedEvent) → void,
    drainEarlyEventQueue() → void,     // replays all queued events into stores
  },

  auth: {
    user: User | null,
    token: string | null,
    isAuthenticated: boolean,
    login(email, password) → void,
    register(email, username, password) → void,
    logout() → void,
  },
  servers: {
    servers: ServerWithChannels[],    // ⭐ Hydrated from READY event, not REST
    activeServerId: string | null,
    activeChannelId: string | null,
    hydrateFromReady(payload) → void, // ⭐ Called once on 'ready' event
    addServer(server) → void,         // From 'server:member-joined' event
    removeServer(serverId) → void,    // From 'server:member-left' event
    updateChannel(channel) → void,    // From 'channel:updated' event
  },
  members: {
    // ⭐ NOT in READY — lazy-loaded per server via tRPC server.getMembers
    membersByServer: Map<serverId, Member[]>,
    hasMore: Map<serverId, boolean>,
    fetchMembers(serverId, cursor?) → void,  // Called when user clicks a server
    addMember(serverId, member) → void,      // From 'server:member-joined' WS event
    removeMember(serverId, userId) → void,   // From 'server:member-left' WS event
  },
  messages: {
    messages: Map<channelId, Message[]>,
    hasMore: Map<channelId, boolean>,
    fetchMessages(channelId, cursor?) → void,
    addMessage(channelId, message) → void,
  },
  voice: {
    isConnected: boolean,
    activeVoiceChannelId: string | null,
    localStream: MediaStream | null,
    remoteStreams: Map<userId, MediaStream>,
    isMuted: boolean,
    isDeafened: boolean,
    joinVoice(channelId) → void,
    leaveVoice() → void,
    toggleMute() → void,
    toggleDeaf() → void,
  },
  presence: {
    onlineUsers: Map<userId, 'online' | 'idle' | 'dnd'>,
    typingUsers: Map<channelId, Set<userId>>,
  }
}

QueuedEvent type:
  { type: 'message:created', payload: { channelId, message } }
  | { type: 'presence:update', payload: { userId, status } }
  | { type: 'typing:started', payload: { channelId, userId } }
  | { type: 'server:member-joined', payload: { serverId, member } }
  | ... any server→client Socket.io event

earlyEventQueue flow:
  1. Socket.io event handler checks `_hydration.isBuffering`
  2. If true → pushEvent({ type, payload }) into queue (events are NOT applied)
  3. If false → apply event directly to the appropriate store slice
  4. drainEarlyEventQueue() loops through the queue and applies each event
     in order, then clears the array
```

> **Why this exists:** See the "Hydration Gap" warning in Section 7.1.
> Without this queue, any message/presence/typing event that arrives in
> the ~20-80ms between Socket.io room join and Zustand hydration completion
> is silently dropped. The user misses that message forever.

### 6.3 Discord CSS Layout Blueprint

```
┌────────────────────────────────────────────────────────────────────┐
│ Full Viewport (100vw × 100vh)                                      │
│                                                                      │
│ ┌──────┬─────────────┬──────────────────────────────┬────────────┐  │
│ │ 72px │   240px      │         flex: 1              │   240px    │  │
│ │      │              │                              │            │  │
│ │Server│  Channel     │     Main Content Area        │  Member    │  │
│ │Side  │  Sidebar     │                              │  List      │  │
│ │bar   │              │  ┌────────────────────────┐  │            │  │
│ │      │  #server-name│  │                        │  │  Online(3) │  │
│ │ [S1] │              │  │   Message List          │  │  ─────── │  │
│ │ [S2] │  TEXT        │  │   (virtualized scroll)  │  │  @user1   │  │
│ │ [S3] │  # general   │  │                        │  │  @user2   │  │
│ │      │  # random    │  │                        │  │  @user3   │  │
│ │ [+]  │              │  │                        │  │            │  │
│ │      │  VOICE       │  │                        │  │  Offline   │  │
│ │      │  🔊 Lounge   │  │                        │  │  ─────── │  │
│ │      │    @user1    │  └────────────────────────┘  │  @user4   │  │
│ │      │    @user2    │  ┌────────────────────────┐  │            │  │
│ │      │              │  │  Message Input          │  │            │  │
│ │      │              │  │  [Type a message...]    │  │            │  │
│ │      ├──────────────│  └────────────────────────┘  │            │  │
│ │      │ User Panel   │                              │            │  │
│ │      │ @vivek 🔊    │                              │            │  │
│ └──────┴─────────────┴──────────────────────────────┴────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 7. WebSocket Signaling Design

### 7.1 Connection Lifecycle (READY Event Flow)

> **⚠️ THE "HYDRATION GAP" PROBLEM**
>
> Between the moment the server adds the socket to Socket.io rooms
> (step 4d) and the moment the React client finishes hydrating the
> READY payload into Zustand (step 5b), there is a window of ~20-80ms
> where real-time events (messages, presence, typing) can arrive via
> Socket.io but the UI has no stores to put them in. Those events are
> silently dropped — users see missing messages and stale presence.
>
> **The fix:** A server-side gate + a client-side `earlyEventQueue`.
>
> 1. The server emits READY **before** joining any rooms.
> 2. The client queues ALL events until READY hydration finishes.
> 3. After hydration, the queue is drained into the now-initialized stores.
> 4. The client emits `ready:ack` to tell the server it's safe to join rooms.

```
1. User logs in via tRPC mutation → receives JWT
2. React app opens Socket.io connection with JWT in auth handshake
3. Server validates JWT in socket middleware
4. On successful auth (server-side — ORDER MATTERS):
   a. Server runs the gateway SQL query (1 query, full payload)
   b. Server adds socket to user's personal room: `user:{userId}`
      ── This is safe: only direct messages come here, and the user
         needs to receive them even before READY finishes.
   c. Server emits 'ready' event with ReadyPayload to this socket
      ── ⚠️ DO NOT join server/channel rooms yet!
      ── The client needs time to hydrate Zustand first.
   d. Server updates presence in Map/Redis (but does NOT broadcast yet)

5. Client receives 'ready':
   a. Enable earlyEventQueue (all incoming events buffered, not applied)
   b. Zustand store hydrates ALL slices from the single payload
   c. Drain earlyEventQueue → apply buffered events to now-initialized stores
   d. Clear earlyEventQueue, disable buffering (events now applied directly)
   e. Client emits 'ready:ack' to server
   f. UI renders — no loading spinners, no waterfall, no dropped messages

6. Server receives 'ready:ack' from client:
   a. Server adds socket to all server rooms: `server:{serverId}`
   b. Server adds socket to all channel rooms: `channel:{channelId}`
   c. Server broadcasts presence update ('online') to all relevant servers
      ── NOW it's safe: the client's stores are fully hydrated,
         and any events that arrived during hydration were queued.

7. On message send:
   a. Client emits to server
   b. Server persists to PostgreSQL
   c. Server broadcasts to `channel:{channelId}` room

8. On disconnect:
   a. Server updates presence to 'offline'
   b. Server broadcasts presence change

9. On reconnect:
   a. Server fires steps 4-6 again with fresh data
   b. Client reconciles (merges new data, discards stale state)
```

**Server-side implementation (socket.service.ts):**

```typescript
io.on('connection', async (socket) => {
  const userId = socket.data.userId; // set by auth middleware

  // Step 4a: Build READY payload
  const readyPayload = await assembleReadyPayload(userId);

  // Step 4b: Personal room only (safe — no broadcast events)
  socket.join(`user:${userId}`);

  // Step 4c: Send READY (client is NOT in server/channel rooms yet)
  socket.emit('ready', readyPayload);

  // Step 4d: Update presence (but don't broadcast — rooms not joined)
  presenceStore.set(userId, { socketId: socket.id, status: 'online', lastSeen: Date.now() });

  // Step 6: Wait for client to finish hydration
  socket.once('ready:ack', () => {
    // Step 6a-b: NOW join all rooms
    for (const server of readyPayload.servers) {
      socket.join(`server:${server.id}`);
      for (const channel of server.channels) {
        socket.join(`channel:${channel.id}`);
      }
    }
    // Step 6c: NOW broadcast presence (rooms are joined, stores hydrated)
    for (const server of readyPayload.servers) {
      io.to(`server:${server.id}`).emit('presence:update', {
        userId,
        status: 'online',
      });
    }
  });
});
```

**Client-side implementation (see earlyEventQueue in Section 6.2):**

```typescript
// hooks/useSocketConnection.ts
socket.on('ready', (payload: ReadyPayload) => {
  // Step 5a: Enable buffering
  useAppStore.getState().setBuffering(true);

  // Step 5b: Hydrate all stores
  useAppStore.getState().hydrateFromReady(payload);

  // Step 5c-d: Drain queue and disable buffering
  useAppStore.getState().drainEarlyEventQueue();
  useAppStore.getState().setBuffering(false);

  // Step 5e: Tell server we're ready for real-time events
  socket.emit('ready:ack');
});
```

**Why this matters:**

```
OLD (REST Waterfall):             NEW (Gateway Pattern):
  Login        ──► 120ms           Login        ──► 120ms
  GET /me      ──► 80ms            WS connect   ──► 50ms
  GET /servers ──► 80ms            'ready' event ──► 150ms (all data)
  GET channels ──► 60ms × N        ────────────────────────
  GET members  ──► 70ms × N        TOTAL: ~320ms (constant)
  ──────────────────────
  TOTAL: 400-3000ms (grows with server count)
```

### 7.2 Room Hierarchy (Socket.io Rooms)

```
user:{userId}              ← Direct messages to specific user
server:{serverId}          ← Server-wide announcements (member join/leave)
channel:{channelId}        ← Messages in specific text channel
voice:{channelId}          ← Voice state changes
typing:{channelId}         ← Typing indicator broadcasts
```

### 7.3 Presence Strategy

> **⚠️ THE REDIS vs. SQL PRESENCE PARADOX**
>
> The READY query (Section 5.3) calculates `online_member_count` using
> `users.status != 'offline'` in PostgreSQL. The moment you move presence
> to Redis, you stop writing `UPDATE users SET status = 'online'` to
> PostgreSQL. The `users.status` column becomes permanently stale and
> every server shows **0 online members**.
>
> **The fix: Presence is NEVER stored in PostgreSQL.**
> Even in Phase 3 (in-memory), presence lives in a Node.js `Map`.
> When Redis is added, it replaces the in-memory `Map`, not PostgreSQL.
> The `users.status` column has been removed from the schema.
> The READY payload's `presenceMap` and `onlineMemberCount` are
> assembled from Redis/in-memory, never from SQL.

```
Phase 3 (In-Memory — single Node.js process):
  Map<userId, { socketId, status, lastSeen }>

  ✅ assembleReadyPayload() reads this Map to build presenceMap
  ✅ onlineMemberCount = count users in Map with status != 'offline'
  ❌ NEVER writes status to PostgreSQL

Phase 3+ (Redis — horizontal scaling):
  HSET presence:{userId} socketId <id> status <status> lastSeen <timestamp>
  SET socket:{socketId} userId <userId>   (reverse lookup for disconnect)

  ✅ assembleReadyPayload() reads Redis MGET to build presenceMap
  ✅ onlineMemberCount = SCARD of an online-members set per server
  ❌ NEVER writes status to PostgreSQL

Heartbeat:
  - Client sends ping every 30s
  - Server marks 'idle' after 5 min no activity
  - Server marks 'offline' on disconnect

Hybrid Assembly in gateway.service.ts:
  1. Run PostgreSQL query → servers, channels, counts, voice_states
  2. Read presence from Map/Redis → presenceMap + onlineMemberCount
  3. Stitch together in Node.js → send as READY payload
```

**Hybrid READY Assembly (gateway.service.ts):**

```typescript
async function assembleReadyPayload(userId: string): ReadyPayload {
  // 1. SQL: servers, channels, member counts, voice states
  const sqlResult = await pool.query(READY_SQL, [userId]);

  // 2. Presence: read from in-memory Map (Phase 3) or Redis (Phase 3+)
  const serverIds = sqlResult.rows.map((r) => r.id);
  const allMemberIds = await getAllMemberIdsForServers(serverIds);

  // In-memory version (Phase 3):
  const presenceMap: Record<string, string> = {};
  const onlineCountByServer = new Map<string, number>();

  for (const { serverId, userId: memberId } of allMemberIds) {
    const presence = presenceStore.get(memberId); // Map lookup
    if (presence && presence.status !== 'offline') {
      presenceMap[memberId] = presence.status;
      onlineCountByServer.set(
        serverId,
        (onlineCountByServer.get(serverId) ?? 0) + 1
      );
    }
  }

  // Redis version (Phase 3+):
  // const statuses = await redis.mget(
  //   allMemberIds.map(m => `presence:${m.userId}`)
  // );
  // ... same stitching logic

  // 3. Stitch SQL + Presence
  return {
    user: sqlResult.rows[0].user,
    servers: sqlResult.rows.map((row) => ({
      ...row,
      onlineMemberCount: onlineCountByServer.get(row.id) ?? 0,
    })),
    presenceMap,
  };
}
```

### 7.4 Socket.io Redis Adapter (Multi-Instance Scaling)

> **⚠️ THE MISSING CROSS-INSTANCE PROBLEM**
>
> Socket.io rooms are **local** to the Node.js process that created them.
> If you run `pm2 start -i 4` (4 instances), User A connected to Instance 1
> emits a message to `channel:{id}`. Instance 1 broadcasts to its local
> `channel:{id}` room — but User B is connected to Instance 3. User B
> **never receives the message**.
>
> The same applies to presence broadcasts, typing indicators, voice state
> updates, and the READY `ready:ack` room join flow from Section 7.1.
>
> **The fix: `@socket.io/redis-adapter`** — a drop-in adapter that uses
> Redis Pub/Sub to relay `io.to(room).emit(...)` calls across all Node.js
> processes. No application code changes required beyond the setup below.

```
Architecture with Redis Adapter:

  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
  │  Instance 1  │    │  Instance 2  │    │  Instance 3  │
  │  (Node.js)   │    │  (Node.js)   │    │  (Node.js)   │
  │              │    │              │    │              │
  │  Socket.io   │    │  Socket.io   │    │  Socket.io   │
  │  + Adapter   │    │  + Adapter   │    │  + Adapter   │
  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
         │                   │                   │
         └───────────┬───────┴───────────────────┘
                     │
              ┌──────┴──────┐
              │    Redis     │
              │   Pub/Sub    │
              │  (7.x)       │
              └─────────────┘

  io.to('channel:abc').emit('message:created', msg)
    → Instance 1 publishes to Redis channel
    → Redis fans out to Instance 2 + 3
    → All instances emit to their local sockets in room 'channel:abc'
    → User B on Instance 3 receives the message
```

**Setup (server/src/socket/adapter.ts):**

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server } from 'socket.io';

export async function attachRedisAdapter(io: Server) {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);

  io.adapter(createAdapter(pubClient, subClient));

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await pubClient.quit();
    await subClient.quit();
  });
}
```

```typescript
// server/src/index.ts
import { attachRedisAdapter } from './socket/adapter';

const io = new Server(httpServer, { /* ... */ });

// Phase 3: single instance — adapter is optional (in-memory works)
// Phase 3+: multiple instances — adapter is MANDATORY
if (process.env.NODE_ENV === 'production') {
  await attachRedisAdapter(io);
}
```

**What the adapter handles automatically:**
- `io.to(room).emit(event, data)` — broadcast to all instances
- `io.to(socketId).emit(event, data)` — targeted emit across instances
- `socket.join(room)` / `socket.leave(room)` — room membership synced
- `io.in(room).fetchSockets()` — lists sockets across all instances

**What the adapter does NOT handle (you must use Redis directly):**
- Presence store (`Map<userId, status>`) — use Redis HSET (Section 7.3)
- Rate limiting — use Redis INCR with TTL
- Session storage — use Redis or PostgreSQL

**Nginx sticky sessions are NOT required.** The Redis adapter handles
cross-instance broadcasting. Socket.io's built-in reconnection will
re-establish the connection to whichever instance Nginx routes to,
and the `ready` lifecycle (Section 7.1) will re-hydrate the client.

---

## 8. Go SFU (Pion) Design

### 8.1 Project Structure

```
sfu/
├── cmd/
│   └── sfu/
│       └── main.go               # Entry point
├── internal/
│   ├── server/
│   │   └── server.go             # HTTP server setup, CORS, routes
│   ├── room/
│   │   ├── room.go               # RoomState struct, track management
│   │   └── manager.go            # Global room registry (sync.RWMutex map)
│   ├── peer/
│   │   └── peer.go               # Single PeerConnection wrapper
│   ├── signal/
│   │   ├── handler.go            # HTTP handlers: /offer, /leave
│   │   ├── ticket.go             # Voice Ticket HMAC verification
│   │   └── types.go              # SDP request/response structs
│   └── bridge/
│       └── webhook.go            # HTTP client to notify Node.js
├── pkg/
│   └── config/
│       └── config.go             # Environment config loader
├── go.mod
├── go.sum
└── Makefile
```

### 8.2 Core Data Structures

```go
// room/room.go
type Room struct {
    mu    sync.RWMutex
    ID    string
    Peers map[string]*Peer    // key: peerId (= peerId)
}

// peer/peer.go
type Peer struct {
    ID             string
    UserID         string
    PeerConnection *webrtc.PeerConnection
    LocalTracks    []*webrtc.TrackLocalStaticRTP   // tracks we send TO this peer
}
```

### 8.3 Track Forwarding Algorithm

```
When Peer A joins Room with existing Peers [B, C]:

1. Create PeerConnection for A
2. For each existing peer in room:
   a. Create a new local track on A's PeerConnection (to receive B's media)
   b. Create a new local track on B's PeerConnection (to receive A's media)
   c. Same for C
3. A.OnTrack(callback):
   When A sends a video/audio track →
     For each OTHER peer in room:
       Write RTP packets to their corresponding local track
       (This is the fan-out: 1 incoming track → N-1 outgoing tracks)
4. On A disconnect:
   Remove A from room
   Remove all local tracks that were forwarding A's media
   Renegotiate with remaining peers
```

### 8.4 Scaling to 50 Peers

```
50 users in a room means:
  - 50 incoming audio tracks
  - 50 incoming video tracks (optional, can be toggled)
  - Each peer receives 49 audio + 49 video tracks
  - Total tracks forwarded: 50 × 49 × 2 = 4,900 track forwards

CPU Consideration:
  - Pion forwards RAW RTP packets (no transcoding) → mostly I/O bound
  - Go's goroutine scheduler handles thousands of concurrent I/O operations
  - Expected: manageable on a 4-core server for 50 peers
```

**⚠️ CRITICAL: The raw math above is THEORETICAL MAXIMUM. In practice, 50 people
at 720p will crush both server bandwidth and client CPUs. The following are NOT
optimizations — they are MANDATORY for a working 50-person room:**

#### 8.4.1 Simulcast (MANDATORY) + Layer Switching Protocol

```
Simulcast means the client encodes and uploads THREE quality layers simultaneously:

  Layer      Resolution   Bitrate (approx)   Use Case
  ──────     ──────────   ────────────────    ─────────────────────────
  HIGH       1080p/720p   ~2.5 Mbps          Active speaker (large tile)
  MEDIUM     480p/360p    ~500 Kbps           Visible in grid view
  LOW        180p/144p    ~100 Kbps           Thumbnail / minimized

The Go SFU dynamically selects which layer to forward to each receiver based on:
  1. Receiver's available bandwidth (estimated via REMB/TWCC feedback)
  2. Receiver's viewport size for that participant's tile
  3. Whether the sender is the active speaker

Client-side Configuration:
  - Use RTCRtpSender.setParameters() with encodings array:
      encodings: [
        { rid: 'low',  maxBitrate: 100000, scaleResolutionDownBy: 4.0 },
        { rid: 'med',  maxBitrate: 500000, scaleResolutionDownBy: 2.0 },
        { rid: 'high', maxBitrate: 2500000 }
      ]
  - SFU side: Pion receives 3 RTP streams per video track. Use
    TrackRemote.RID() to identify which layer.
```

> **⚠️ CRITICAL: The Simulcast "Decoder Crash" Trap**
>
> You CANNOT just naively swap which RID stream you pipe to a subscriber.
> Each simulcast layer has its own independent RTP sequence numbers and
> timestamps. If the SFU is forwarding HIGH (packets 101, 102, 103...) and
> suddenly switches to LOW (packets 5001, 5002...), the receiver's video
> decoder sees a massive sequence jump, has no keyframe for the new
> resolution, and the `<video>` element **permanently freezes**.
>
> This will happen every time a user's bandwidth fluctuates.

**Two mandatory steps when switching simulcast layers:**

```
┌───────────────────────────────────────────────────────────────┐
│  STEP 1: RTP Header Rewriting                                 │
│                                                               │
│  When switching from HIGH → LOW, the SFU must intercept each  │
│  outgoing RTP packet and rewrite the headers so the receiver  │
│  sees a continuous, monotonically increasing sequence:         │
│                                                               │
│  Before switch:                                               │
│    HIGH packets: seq=101, 102, 103  → forwarded as 101,102,103│
│                                                               │
│  After switch (WRONG — no rewriting):                        │
│    LOW packets:  seq=5001, 5002     → forwarded as 5001, 5002 │
│    💥 Receiver: "seq jumped from 103 to 5001?!" → VIDEO FREEZE  │
│                                                               │
│  After switch (CORRECT — with rewriting):                    │
│    LOW packets:  seq=5001, 5002     → forwarded as 104, 105   │
│    ✅ Receiver sees continuous sequence, decodes normally       │
│                                                               │
│  The rewriter tracks:                                         │
│    seqOffset   = lastForwardedSeq - newSourceSeq + 1          │
│    tsOffset    = lastForwardedTS  - newSourceTS  (proportional)│
│  And applies the offset to every packet from the new source.  │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  STEP 2: PLI (Picture Loss Indicator) Request                  │
│                                                               │
│  Even with perfect sequence rewriting, the receiver's H.264   │
│  decoder can't render LOW-resolution frames using HIGH's      │
│  reference frames. It needs a fresh I-Frame (keyframe) for    │
│  the new layer.                                               │
│                                                               │
│  The moment the SFU switches layers, it MUST send a PLI       │
│  (RTCP Picture Loss Indication) packet back to the SENDER,    │
│  forcing their encoder to immediately generate a keyframe     │
│  for the target layer.                                        │
│                                                               │
│  Timeline:                                                    │
│    t+0ms   SFU decides to switch Subscriber B: HIGH → LOW    │
│    t+1ms   SFU sends PLI to Sender A for the LOW layer       │
│    t+2ms   SFU starts rewriting LOW packets → Subscriber B   │
│    t+50ms  Sender A produces a keyframe on LOW               │
│    t+51ms  Subscriber B decodes the keyframe, video resumes  │
│                                                               │
│  Without PLI: video stays frozen until the encoder happens    │
│  to produce a periodic keyframe (could be 2-10 seconds).     │
└───────────────────────────────────────────────────────────────┘
```

**Go implementation — SimulcastRouter per subscriber:**

```go
import "github.com/pion/interceptor"

// SimulcastRouter manages layer switching for a single subscriber.
// It wraps the three incoming TrackRemote streams (high/med/low)
// and outputs a single rewritten stream to the subscriber's TrackLocal.
type SimulcastRouter struct {
    mu             sync.Mutex
    currentLayer   string // "high", "med", "low"
    seqOffset      uint16
    tsOffset       uint32
    lastSeq        uint16 // last sequence number sent to subscriber
    lastTS         uint32 // last timestamp sent to subscriber
    target         *webrtc.TrackLocalStaticRTP
    senderPC       *webrtc.PeerConnection // to send PLI back to sender
    senderTrack    *webrtc.TrackRemote    // current source track
}

// SwitchLayer changes the simulcast layer being forwarded.
// It recalculates sequence/timestamp offsets and fires a PLI.
func (sr *SimulcastRouter) SwitchLayer(
    newLayer string,
    newTrack *webrtc.TrackRemote,
) {
    sr.mu.Lock()
    defer sr.mu.Unlock()

    if sr.currentLayer == newLayer {
        return
    }

    // 1. RTP Header Rewriting: calculate offsets
    //    so the receiver sees continuous sequence numbers
    sr.senderTrack = newTrack
    sr.currentLayer = newLayer
    // Offsets will be applied to the first packet from the new source
    // seqOffset = lastSeq - nextPacket.SequenceNumber + 1
    // (calculated on first packet arrival after switch)
    sr.seqOffset = 0 // reset; computed on next packet
    sr.tsOffset = 0

    // 2. PLI: Force sender to generate a keyframe for the new layer
    sr.senderPC.WriteRTCP([]rtcp.Packet{
        &rtcp.PictureLossIndication{
            MediaSSRC: uint32(newTrack.SSRC()),
        },
    })
}

// ForwardPacket rewrites an RTP packet's headers and sends it.
func (sr *SimulcastRouter) ForwardPacket(pkt *rtp.Packet) error {
    sr.mu.Lock()
    // Apply sequence offset
    pkt.Header.SequenceNumber += sr.seqOffset
    pkt.Header.Timestamp += sr.tsOffset
    sr.lastSeq = pkt.Header.SequenceNumber
    sr.lastTS = pkt.Header.Timestamp
    sr.mu.Unlock()

    return sr.target.WriteRTP(pkt)
}
```

> **Implementation note:** Writing a bullet-proof RTP sequence rewriter
> from scratch is complex and error-prone (you must handle sequence
> number wraparound at 65535, timestamp wraparound at 2^32, padding
> packets, RTX retransmission, etc.).
>
> **Strongly recommended:** Use Pion's official
> [`interceptor`](https://github.com/pion/interceptor) package or the
> community `pion/simulcast` extension, which handles all of this math
> correctly. The code above illustrates the *concept*; the production
> implementation should delegate to Pion's tested interceptor pipeline.

#### 8.4.2 Active Speaker / Last-N Video (MANDATORY)

```
In a 50-person room, you CANNOT forward 49 video streams to every client.
Browsers will choke at ~6-8 simultaneous video decoders.

Strategy: "Last-N Video"
  - Only forward video tracks for the N most recent speakers (N = 4 or 5)
  - Everyone else is audio-only (their video tile shows avatar + name)
  - When a new person starts talking, they replace the least-recent speaker

Active Speaker Detection (server-side):
  1. Monitor audio levels on incoming RTP packets (RFC 6464 audio level header)
  2. Maintain a sorted list of speakers by recency + volume
  3. When the top-N list changes, trigger renegotiation:
     - AddTrack() for newly visible speakers
     - RemoveTrack() for speakers bumped out of top-N
     - Send renegotiation offer to affected peers

Bandwidth savings:
  Without Last-N:  49 video streams × 500 Kbps = 24.5 Mbps download per client
  With Last-N (5): 5 video streams  × 2.5 Mbps =  12.5 Mbps download per client
                   + 44 audio streams × 50 Kbps  =  2.2 Mbps
                   Total: ~14.7 Mbps (40% reduction, and decodable by browser)
```

#### 8.4.3 Goroutine Leak Prevention (CRITICAL)

```
⚠️ THE #1 SILENT KILLER IN GO SFU SERVERS

Problem:
  When User A disconnects, every goroutine that was forwarding A's tracks
  to the other 49 peers will attempt to write RTP packets to a dead
  PeerConnection. These goroutines block forever (or spin on errors) and
  are never garbage collected. Over time, leaked goroutines accumulate
  and consume all available memory/CPU, crashing the server.

Required Teardown Pattern:

  func (r *Room) RemovePeer(peerID string) {
      r.mu.Lock()
      defer r.mu.Unlock()

      peer, exists := r.Peers[peerID]
      if !exists {
          return
      }

      // 1. Signal ALL forwarding goroutines to stop via context cancellation
      peer.Cancel()  // cancels the peer's context.Context

      // 2. Close the PeerConnection (stops ICE, DTLS, SRTP)
      peer.PeerConnection.Close()

      // 3. Remove all local tracks this peer was sending TO other peers
      for _, otherPeer := range r.Peers {
          if otherPeer.ID == peerID {
              continue
          }
          otherPeer.RemoveTracksFrom(peerID)  // removes + triggers renegotiation
      }

      // 4. Delete from map
      delete(r.Peers, peerID)

      // 5. Fire webhook to Node.js
      go r.bridge.NotifyDisconnect(peer.UserID, r.ID)
  }

Every track-forwarding goroutine MUST select on the peer's context:

  // Video forwarding now goes through SimulcastRouter (Section 8.4.1)
  // which handles RTP header rewriting + PLI on layer switches.
  // Audio tracks use direct forwarding (no simulcast):

  func forwardAudioTrack(ctx context.Context, src *webrtc.TrackRemote, dst *webrtc.TrackLocalStaticRTP) {
      buf := make([]byte, 1500)
      for {
          select {
          case <-ctx.Done():
              return  // Clean exit — no leak
          default:
              n, _, err := src.Read(buf)
              if err != nil {
                  return  // Track closed
              }
              if _, err = dst.Write(buf[:n]); err != nil {
                  return  // Destination closed
              }
          }
      }
  }

Monitoring:
  - Expose runtime.NumGoroutine() on a /debug/stats endpoint
  - Alert if goroutine count grows unboundedly
  - Log every peer add/remove with goroutine count
```

#### 8.4.4 Revised Peer Data Structure

```go
// Updated to include context for goroutine lifecycle management
// and SimulcastRouter for per-subscriber layer switching
type Peer struct {
    ID               string
    UserID           string
    PeerConnection   *webrtc.PeerConnection
    LocalTracks      []*webrtc.TrackLocalStaticRTP
    SimulcastRouters map[string]*SimulcastRouter // keyed by sender peerID
    Ctx              context.Context      // cancelled on disconnect
    Cancel           context.CancelFunc   // call this to kill all forwarding goroutines
    CreatedAt        time.Time
}
```

---

## 9. Bridge & Deployment

### 9.1 Webhook Bridge Protocol + State Reconciliation

#### 9.1.1 Real-Time Webhook (Fire on disconnect) — HMAC-Signed

> **⚠️ A static `X-Internal-Secret` header is NOT enough.**
> If the secret leaks (compromised network, ex-employee), an attacker can
> replay `voice-disconnect` requests forever, permanently kicking users
> out of voice channels. There is no timestamp or nonce to prevent replays.
>
> **The fix: HMAC-SHA256 signing with a timestamp window.**

```
Go → Node.js:

POST http://localhost:3001/api/internal/voice-disconnect
Headers:
  X-Signature: <hmac_sha256_hex>
  X-Timestamp: <unix_epoch_seconds>
Body:
  {
    "userId": "uuid",
    "roomId": "channel-uuid",
    "reason": "ice_disconnected" | "peer_closed" | "timeout"
  }
```

**Signing Protocol:**

```
┌─────────────────────────────────────────────────────────────┐
│  Go (sender)                                                │
│                                                             │
│  1. Serialize JSON body to bytes                            │
│  2. timestamp = current Unix epoch (seconds)                │
│  3. message   = timestamp + "." + body_bytes                │
│  4. signature = HMAC-SHA256(shared_secret, message)         │
│  5. Send POST with headers:                                 │
│       X-Signature: hex(signature)                           │
│       X-Timestamp: timestamp                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Node.js (receiver)                                         │
│                                                             │
│  1. Read X-Timestamp header                                 │
│  2. REJECT if |now() - timestamp| > 300 seconds (5 min)     │
│     → Prevents replay attacks with intercepted requests     │
│  3. message = timestamp + "." + raw_body_bytes              │
│  4. expected = HMAC-SHA256(shared_secret, message)           │
│  5. REJECT if !timingSafeEqual(expected, X-Signature)       │
│     → Prevents timing-based signature guessing              │
│  6. Process the webhook payload                              │
└─────────────────────────────────────────────────────────────┘
```

**Go implementation (sender):**

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "net/http"
    "strconv"
    "time"
)

func (s *Server) sendWebhook(url string, body []byte) error {
    timestamp := strconv.FormatInt(time.Now().Unix(), 10)
    message := timestamp + "." + string(body)

    mac := hmac.New(sha256.New, []byte(s.config.InternalSecret))
    mac.Write([]byte(message))
    signature := hex.EncodeToString(mac.Sum(nil))

    req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-Signature", signature)
    req.Header.Set("X-Timestamp", timestamp)

    resp, err := s.httpClient.Do(req)
    if err != nil {
        return fmt.Errorf("webhook failed: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("webhook returned %d", resp.StatusCode)
    }
    return nil
}
```

**Node.js implementation (receiver middleware):**

```typescript
import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.INTERNAL_SECRET!;
const MAX_TIMESTAMP_DRIFT_SECONDS = 300; // 5 minutes

export function verifyWebhookSignature(
  req: Request, res: Response, next: NextFunction
) {
  const signature = req.headers['x-signature'] as string;
  const timestamp = req.headers['x-timestamp'] as string;

  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'Missing signature headers' });
  }

  // 1. Reject stale requests (replay prevention)
  const drift = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (drift > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return res.status(401).json({ error: 'Timestamp too old — possible replay' });
  }

  // 2. Recompute HMAC from raw body
  const message = timestamp + '.' + JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(message)
    .digest('hex');

  // 3. Constant-time comparison (prevents timing attacks)
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}
```

**Why this works:**
- The **timestamp** binds the signature to a specific moment in time.
  Even if an attacker intercepts the full request, they can only replay it
  within the 5-minute window — not indefinitely.
- **HMAC-SHA256** ensures the body hasn't been tampered with. Changing a
  single byte in the payload invalidates the signature.
- **`timingSafeEqual`** prevents attackers from inferring the correct
  signature byte-by-byte via response timing differences.

#### 9.1.2 ⚠️ Why the Webhook Alone Is Not Enough

```
THE GHOST USER PROBLEM

Scenario:
  1. User is in voice channel
  2. Node.js server restarts (deploy, crash, OOM)
  3. Go SFU detects disconnect, fires webhook
  4. Node.js is DOWN — webhook is lost (HTTP 503 or timeout)
  5. Node.js comes back up
  6. PostgreSQL still has a voice_states row for the user
  7. UI shows user as "in voice channel" forever = GHOST USER

This WILL happen in production. Servers restart. Networks blip.
A fire-and-forget webhook is a single point of failure.
```

#### 9.1.3 The Fix: State Reconciliation Loop (Diff-Based + Grace Period)

> **⚠️ TWO critical issues with naive reconciliation:**
>
> **1. Database CPU hog:** If you loop per-room with SELECT + DELETE,
> 1,000 voice channels = thousands of queries per minute even when nothing
> is wrong. **Fix:** Diff in memory, write only on mismatch.
>
> **2. "Flickering Ghost" race condition:** If the reconciliation loop fires
> at the exact moment a user is mid-WebRTC-handshake, their `voice_states`
> row exists in PostgreSQL but they haven't connected to Go yet. The loop
> incorrectly identifies them as a ghost and deletes them — they connect
> to Go a moment later but are now invisible in the DB and UI.
> **Fix:** Never delete a ghost whose `joined_at` is less than 15 seconds old.

```
THE "FLICKERING GHOST" RACE CONDITION — WHY INSTANT DELETE IS DANGEROUS

Timeline (milliseconds):
  t+0ms     User clicks "Join Voice"
  t+50ms    Node.js INSERTs voice_state row (joined_at = NOW())
  t+51ms    ← Reconciliation loop fires (every 60s, bad luck)
  t+52ms    Loop queries PostgreSQL → sees User A in voice_states
  t+53ms    Loop queries Go SFU → User A NOT in Go (still handshaking)
  t+54ms    Loop classifies User A as a GHOST
  t+55ms    ❌ Loop DELETEs User A from voice_states
  t+300ms   User A completes WebRTC handshake, connects to Go SFU
  t+301ms   User A is in the voice call but INVISIBLE in DB and UI

THE FIX: GRACE PERIOD
  t+54ms    Loop sees User A in DB but not Go
  t+55ms    Loop checks: joined_at was 4ms ago (< 15 seconds)
  t+56ms    ✅ Loop SKIPS User A — assumed to be mid-handshake
  t+300ms   User A connects to Go SFU normally
  next tick Loop sees User A in both DB and Go — no discrepancy
```

```
─── Diff-Based Reconciliation Flow (with Grace Period) ───

Node.js                                     Go SFU
  │                                           │
  │  (every 60s, setInterval)                 │
  │                                           │
  │  ┌──────────────────────────────────────┐ │
  │  │ STEP 1: Fetch both states in parallel│ │
  │  └──────────────────────────────────────┘ │
  │                                           │
  │  GET /rtc/rooms/state (HMAC-signed)       │
  │──────────────────────────────────────────►│
  │                                           │
  │  goState = {                              │
  │    "channel-uuid-1": ["user-aaa", ...],   │
  │    "channel-uuid-2": ["user-ccc"]         │
  │  }                                        │
  │◄──────────────────────────────────────────│
  │                                           │
  │  SELECT channel_id,                       │
  │         json_agg(json_build_object(       │
  │           'userId', user_id,              │
  │           'joinedAt', joined_at           │
  │         )) AS users                       │
  │  FROM voice_states                        │
  │  GROUP BY channel_id;                     │
  │                                           │
  │  dbState = {                              │
  │    "ch-1": [{userId:"aaa", joinedAt:...}],│
  │    "ch-2": [{userId:"ccc", joinedAt:...}, │
  │             {userId:"ddd", joinedAt:...}] │
  │  }                                        │
  │                                           │
  │  ┌──────────────────────────────────────┐ │
  │  │ STEP 2: Diff with grace period      │ │
  │  └──────────────────────────────────────┘ │
  │                                           │
  │  For each channel in union(goState, dbState):
  │    goUsers = Set(goState[channelId])
  │    dbUsers = Map(userId → joinedAt)
  │                                           │
  │    For each dbUser NOT in goUsers:        │
  │      IF (now - joinedAt) < 15 seconds:    │
  │        SKIP ← mid-handshake grace period  │
  │      ELSE:                                │
  │        → confirmed ghost, mark for delete │
  │                                           │
  │    For each goUser NOT in dbUsers:        │
  │        → phantom, mark for upsert         │
  │                                           │
  │  ┌──────────────────────────────────────┐ │
  │  │ STEP 3: Write ONLY if diff non-empty│ │
  │  └──────────────────────────────────────┘ │
  │                                           │
  │  IF confirmedGhosts.length > 0:           │
  │    DELETE FROM voice_states               │
  │    WHERE user_id = ANY($1::uuid[]);       │
  │    ← ONE query deletes all stale ghosts   │
  │                                           │
  │  IF phantoms.length > 0:                  │
  │    INSERT ... ON CONFLICT DO UPDATE;      │
  │    ← ONE query upserts all phantoms       │
  │                                           │
  │  IF skippedCount > 0:                     │
  │    Log: "Skipped N users in grace period" │
  │                                           │
  │  IF no writes needed:                     │
  │    Log: "Reconciliation: states match ✓"  │
  │                                           │
  │  For each confirmed ghost:                │
  │    emit('voice:user-left', {...})  ← fix UI
```

**Why this is dramatically better:**

| Approach | Queries per 60s Tick (1,000 rooms) | When States Match | Race-Safe? |
|---|---|---|---|
| ❌ Naive per-room loop | ~2,001 queries | Still 1,001 queries | ❌ Kills mid-handshake users |
| ❌ Diff-based (no grace) | 2-4 queries | 2 queries, 0 writes | ❌ Kills mid-handshake users |
| ✅ Diff + grace period | 2-4 queries | 2 queries, 0 writes | ✅ Skips users joined < 15s ago |

**Node.js implementation:**

```typescript
const GRACE_PERIOD_MS = 15_000; // 15 seconds — enough for SDP + ICE

async function reconcileVoiceStates() {
  const now = Date.now();

  // Step 1: Fetch both states in parallel
  const [goResponse, dbRows] = await Promise.all([
    fetchGoRoomsState(),  // GET /rtc/rooms/state (HMAC-signed)
    pool.query(`
      SELECT channel_id,
             json_agg(json_build_object(
               'userId', user_id,
               'joinedAt', joined_at
             )) AS users
      FROM voice_states
      GROUP BY channel_id
    `),
  ]);

  // Build lookup maps
  const goState = new Map<string, Set<string>>();
  for (const [channelId, peers] of Object.entries(goResponse.rooms)) {
    goState.set(channelId, new Set((peers as any[]).map((p) => p.userId)));
  }

  interface DbVoiceEntry { userId: string; joinedAt: string }
  const dbState = new Map<string, DbVoiceEntry[]>();
  for (const row of dbRows.rows) {
    dbState.set(row.channel_id, row.users);
  }

  // Step 2: Diff in memory WITH grace period
  const allChannelIds = new Set([...goState.keys(), ...dbState.keys()]);
  const confirmedGhosts: { channelId: string; userId: string }[] = [];
  const phantoms: { channelId: string; userId: string }[] = [];
  let skippedGracePeriod = 0;

  for (const channelId of allChannelIds) {
    const goUsers = goState.get(channelId) ?? new Set<string>();
    const dbEntries = dbState.get(channelId) ?? [];
    const dbUserIds = new Set(dbEntries.map((e) => e.userId));

    // Check for ghosts (in DB but not in Go)
    for (const entry of dbEntries) {
      if (!goUsers.has(entry.userId)) {
        const joinedAge = now - new Date(entry.joinedAt).getTime();

        if (joinedAge < GRACE_PERIOD_MS) {
          // ✅ GRACE PERIOD — user probably mid-handshake, skip this tick
          skippedGracePeriod++;
          logger.debug(
            `Grace period: skipping ${entry.userId} in ${channelId} ` +
            `(joined ${Math.round(joinedAge / 1000)}s ago)`
          );
        } else {
          // ❌ Confirmed ghost — joined > 15s ago but not in Go
          confirmedGhosts.push({ channelId, userId: entry.userId });
        }
      }
    }

    // Check for phantoms (in Go but not in DB)
    for (const userId of goUsers) {
      if (!dbUserIds.has(userId)) {
        phantoms.push({ channelId, userId });
      }
    }
  }

  // Step 3: Write ONLY if confirmed discrepancies found
  if (confirmedGhosts.length === 0 && phantoms.length === 0) {
    if (skippedGracePeriod > 0) {
      logger.debug(
        `Reconciliation: ${skippedGracePeriod} users in grace period, no action`
      );
    } else {
      logger.debug('Reconciliation: voice states match ✓');
    }
    return;
  }

  if (confirmedGhosts.length > 0) {
    const ghostUserIds = confirmedGhosts.map((g) => g.userId);
    await pool.query(
      'DELETE FROM voice_states WHERE user_id = ANY($1::uuid[])',
      [ghostUserIds]
    );
    // Fix UI for each confirmed ghost
    for (const ghost of confirmedGhosts) {
      io.to(ghost.channelId).emit('voice:user-left', {
        channelId: ghost.channelId,
        userId: ghost.userId,
      });
    }
  }

  if (phantoms.length > 0) {
    // Batch upsert phantoms (ON CONFLICT handles races)
    for (const phantom of phantoms) {
      await pool.query(
        `INSERT INTO voice_states (channel_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET channel_id = EXCLUDED.channel_id, joined_at = NOW()`,
        [phantom.channelId, phantom.userId]
      );
    }
  }

  logger.warn(
    `Reconciliation: removed ${confirmedGhosts.length} ghosts, ` +
    `added ${phantoms.length} phantoms, ` +
    `skipped ${skippedGracePeriod} in grace period`
  );
}

// Run every 60 seconds
setInterval(reconcileVoiceStates, 60_000);
```

**Go SFU endpoint (HMAC-verified):**

```go
// GET /rtc/rooms/state — returns all active rooms and their peers
// Used by Node.js reconciliation loop (every 60s)
func (s *Server) HandleRoomsState(w http.ResponseWriter, r *http.Request) {
    // Verify HMAC signature (same protocol as webhooks)
    if !s.verifyHMACSignature(r) {
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }

    state := s.roomManager.GetAllState() // returns map[roomId][]PeerInfo
    json.NewEncoder(w).Encode(map[string]any{"rooms": state})
}
```

**Defense in depth — three layers of protection:**

```
Layer 1: Real-time webhook       (Go fires on disconnect, ~0s latency)
Layer 2: Reconciliation loop     (every 60s, catches missed webhooks)
Layer 3: Client heartbeat        (if client detects stale voice_state,
                                  it emits 'voice:force-leave' to Node.js)
```

#### 9.1.4 Node.js → Go (Server-Initiated Actions)

All inter-service requests use the same HMAC signing protocol (Section 9.1.1).

```
Node.js → Go:

POST http://localhost:8080/rtc/kick
Headers:
  X-Signature: <hmac_sha256_hex>
  X-Timestamp: <unix_epoch_seconds>
Body:
  {
    "userId": "uuid",
    "roomId": "channel-uuid"
  }

GET http://localhost:8080/rtc/rooms/state
Headers:
  X-Signature: <hmac_sha256_hex>
  X-Timestamp: <unix_epoch_seconds>
Response:
  {
    "rooms": {
      "channel-uuid": [
        { "userId": "uuid", "peerId": "peer-id" }
      ]
    }
  }
```

### 9.2 Deployment Architecture (Nginx + Coturn STUN/TURN)

> **⚠️ Nginx cannot proxy WebRTC media (UDP) traffic.**
> Nginx is an HTTP/WebSocket reverse proxy (TCP). WebRTC media uses UDP.
> Users behind strict corporate firewalls or symmetric NATs will be
> completely unable to connect video to the Go SFU unless you deploy a
> TURN relay server.

#### 9.2.1 Traffic Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  INTERNET                                                           │
│                                                                     │
│  Browser ──────────────────────────────────────────────┐            │
│    │                                                    │            │
│    │  HTTPS / WSS (TCP)                     UDP media   │            │
│    │  (HTML, tRPC, Socket.io, SDP handshake)│           │            │
│    ▼                                        │           ▼            │
│  ┌───────────────┐                          │  ┌──────────────────┐ │
│  │   Nginx:443   │                          │  │  Coturn:3478     │ │
│  │  (TCP only)   │                          │  │  (STUN + TURN)   │ │
│  └───────┬───────┘                          │  │  UDP:49152-65535 │ │
│          │                                  │  └────────┬─────────┘ │
│          ├─ /               → Next.js:3000  │           │            │
│          ├─ /trpc/*         → Node.js:3001  │           │            │
│          ├─ /socket.io/*    → Node.js:3001  │           │  UDP relay │
│          └─ /rtc/*          → Go SFU:8080   │           │  fallback  │
│                              (SDP only!)    │           │            │
│                                             │           │            │
│                                             ▼           ▼            │
│                                        ┌──────────────────┐         │
│                                        │   Go SFU:8080    │         │
│                                        │   (Pion WebRTC)  │         │
│                                        │                  │         │
│                                        │  UDP media flows │         │
│                                        │  directly to SFU │         │
│                                        │  OR via Coturn   │         │
│                                        └──────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘

Connection Priority (ICE):
  1. Direct UDP  → Browser ↔ Go SFU  (fastest, ~80% of users)
  2. STUN        → Browser discovers public IP via Coturn:3478
  3. TURN/UDP    → Browser ↔ Coturn ↔ Go SFU  (relay, adds ~20ms)
  4. TURN/TCP    → Last resort for strict firewalls blocking all UDP
```

**Key insight:** Nginx handles ALL TCP traffic (HTTP, WebSocket, SDP signaling).
Coturn handles ALL UDP traffic (media relay for users who can't connect directly).
They serve completely different roles — never try to route media through Nginx.

#### 9.2.2 Coturn Configuration

```bash
# /etc/turnserver.conf

# Network
listening-port=3478
listening-ip=0.0.0.0
external-ip=YOUR_PUBLIC_IP
min-port=49152
max-port=65535
realm=discord.yourdomain.com

# Authentication (short-term credentials, rotated by Node.js)
use-auth-secret
static-auth-secret=YOUR_TURN_SECRET   # Same secret in Node.js env

# Security
no-multicast-peers
stale-nonce=600

# TLS (for TURN over TCP/TLS fallback)
cert=/etc/letsencrypt/live/.../fullchain.pem
pkey=/etc/letsencrypt/live/.../privkey.pem

# Logging
log-file=/var/log/turnserver.log
```

**Cost:** Coturn can run on the same Linux box as everything else for small
deployments. For 50-user scale, a dedicated $20/mo VPS is recommended if
TURN relay traffic is heavy.

#### 9.2.3 ICE Server Configuration in Frontend

The React client must be configured with both STUN and TURN servers.
Node.js generates **short-lived TURN credentials** using the shared secret
(never expose the static secret to clients).

**Node.js — Generate temporary TURN credentials (tRPC procedure):**

```typescript
import crypto from 'crypto';

// Temporary credentials expire after 24 hours
function generateTurnCredentials(userId: string): {
  username: string;
  credential: string;
  ttl: number;
} {
  const ttl = 86400; // 24 hours
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:${userId}`;
  const credential = crypto
    .createHmac('sha1', process.env.TURN_SECRET!)
    .update(username)
    .digest('base64');

  return { username, credential, ttl };
}
```

**React — Use TURN credentials in WebRTC peer connection:**

```typescript
async function createPeerConnection(turnCreds: TurnCredentials) {
  const pc = new RTCPeerConnection({
    iceServers: [
      // Free public STUN (Google) — discovers public IP
      { urls: 'stun:stun.l.google.com:19302' },

      // Your Coturn STUN
      { urls: 'stun:discord.yourdomain.com:3478' },

      // Your Coturn TURN (UDP relay — most common fallback)
      {
        urls: 'turn:discord.yourdomain.com:3478?transport=udp',
        username: turnCreds.username,
        credential: turnCreds.credential,
      },

      // Your Coturn TURN (TCP relay — last resort for strict firewalls)
      {
        urls: 'turn:discord.yourdomain.com:3478?transport=tcp',
        username: turnCreds.username,
        credential: turnCreds.credential,
      },
    ],
    iceTransportPolicy: 'all', // Try direct first, fall back to relay
  });

  return pc;
}
```

#### 9.2.4 Nginx Configuration

```nginx
upstream node_api {
    server 127.0.0.1:3001;
}

upstream go_sfu {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl;
    server_name discord.yourdomain.com;

    # SSL certs (Let's Encrypt)
    ssl_certificate     /etc/letsencrypt/live/.../fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

    # React/Next.js static + SSR
    location / {
        proxy_pass http://node_api;
    }

    # tRPC API (auth mutations, CRUD operations)
    location /trpc/ {
        proxy_pass http://node_api;
    }

    # WebSocket upgrade for Socket.io
    location /socket.io/ {
        proxy_pass http://node_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # WebRTC SDP signaling ONLY (HTTP POST for offer/answer)
    # Media (UDP) does NOT go through Nginx — it goes directly
    # to the Go SFU or through Coturn TURN relay.
    location /rtc/ {
        proxy_pass http://go_sfu;
    }
}
```

#### 9.2.5 Firewall Rules (UFW / iptables)

```bash
# TCP — Nginx handles these
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 80/tcp     # HTTP (Let's Encrypt renewal)

# UDP — Coturn TURN relay
sudo ufw allow 3478/tcp   # STUN/TURN signaling
sudo ufw allow 3478/udp   # STUN/TURN signaling
sudo ufw allow 49152:65535/udp  # TURN media relay port range

# Internal only — never expose these
# 3001 (Node.js), 8080 (Go SFU) — only via Nginx
```

### 9.3 PM2 Deployment

```bash
# Node.js API
# Phase 3 (single instance — in-memory presence, no Redis adapter):
pm2 start server/src/index.js --name "discord-api" -i 1

# Phase 3+ (horizontal scaling — Redis adapter REQUIRED, see Section 7.4):
# pm2 start server/src/index.js --name "discord-api" -i 4
# ⚠️ MUST have @socket.io/redis-adapter configured before scaling past -i 1
#    Otherwise Socket.io rooms are local to each process and cross-instance
#    messages/presence/typing will silently fail.

# Go SFU (compiled binary)
pm2 start ./sfu/bin/sfu --name "discord-sfu" --interpreter none

# Coturn (managed by systemd, not pm2)
sudo systemctl enable coturn
sudo systemctl start coturn

# Monitor
pm2 monit
```

---

## 10. Phase-by-Phase Execution Roadmap

### Phase 1: API & Database Foundation
| Task | Description | Est. Time |
|------|-------------|-----------|
| 1.1 | Design & create PostgreSQL schema | 2-3 hours |
| 1.2 | Initialize monorepo: `server/`, `client/`, `shared/` with TypeScript | 2-3 hours |
| 1.3 | Set up tRPC router, context, and auth middleware | 2-3 hours |
| 1.4 | Implement auth procedures (register/login) with JWT + bcrypt | 3-4 hours |
| 1.5 | Server CRUD mutations + join-by-invite | 3-4 hours |
| 1.6 | Channel CRUD mutations | 2-3 hours |
| 1.7 | Message query (cursor pagination) | 2-3 hours |
| 1.8 | Write the gateway SQL query + `gateway.service.ts` (READY payload) | 2-3 hours |
| 1.9 | Define all shared types in `@discord/shared` | 1-2 hours |
| **Milestone** | **tRPC mutations testable + READY payload returns full data** | **~20 hours** |

### Phase 2: UI & Device Senses
| Task | Description | Est. Time |
|------|-------------|-----------|
| 2.1 | Next.js project setup + Tailwind + Discord theme | 2-3 hours |
| 2.2 | Build static layout (3-column Discord UI) | 4-6 hours |
| 2.3 | Set up tRPC client + React Query provider | 1-2 hours |
| 2.4 | Auth pages (login/register) using tRPC mutations | 2-3 hours |
| 2.5 | Socket.io connect → hydrate Zustand from READY event + **earlyEventQueue** + `ready:ack` handshake (Section 7.1) | 3-4 hours |
| 2.6 | Wire all UI components to Zustand (server list, channels, members) | 3-4 hours |
| 2.7 | getUserMedia + local video preview (Safari-safe) | 2-3 hours |
| **Milestone** | **UI renders full data from READY event in ~200ms, camera works** | **~19 hours** |

### Phase 3: Real-Time Signaling
| Task | Description | Est. Time |
|------|-------------|-----------|
| 3.1 | Socket.io server setup + auth middleware + **Redis adapter** (Section 7.4) | 2-3 hours |
| 3.2 | Presence tracking (in-memory Map — NOT in PostgreSQL) | 2-3 hours |
| 3.3 | Real-time text chat (send/receive) | 3-4 hours |
| 3.4 | Typing indicators | 1-2 hours |
| 3.5 | Online member list updates | 1-2 hours |
| **Milestone** | **Multi-tab text chat works in real-time** | **~12 hours** |

### Phase 4: Go SFU
| Task | Description | Est. Time |
|------|-------------|-----------|
| 4.1 | Go project init + Pion import | 1-2 hours |
| 4.2 | SDP Offer/Answer HTTP endpoint + **Voice Ticket verification** | 3-4 hours |
| 4.3 | RoomState + thread-safe peer map | 2-3 hours |
| 4.4 | Track forwarding (fan-out loop) + **SimulcastRouter with RTP rewriting** | 4-6 hours |
| 4.5 | ICE candidate handling + TURN config | 2-3 hours |
| **Milestone** | **2+ browsers can video call via SFU** | **~16 hours** |

### Phase 5: Bridge & Deployment
| Task | Description | Est. Time |
|------|-------------|-----------|
| 5.1 | React Voice Ticket flow → tRPC voice.getTicket → Go SFU | 3-4 hours |
| 5.2 | HMAC-SHA256 webhook signing (Go sender + Node.js verifier middleware) | 2-3 hours |
| 5.3 | Go real-time webhook → Node.js voice state sync | 2-3 hours |
| 5.4 | Go `/rtc/rooms/state` endpoint + diff-based reconciliation loop | 2-3 hours |
| 5.5 | Client-side heartbeat (detect stale voice state, force-leave) | 1-2 hours |
| 5.6 | Deploy Coturn (STUN/TURN) + generate short-lived TURN credentials in Node.js | 2-3 hours |
| 5.7 | ICE server config in React (STUN + TURN/UDP + TURN/TCP fallback) | 1-2 hours |
| 5.8 | Nginx config + SSL + pm2 + firewall rules (TCP + UDP ports) | 3-4 hours |
| 5.9 | End-to-end testing (50 peer stress test) + ghost user verification | 3-4 hours |
| **Milestone** | **Production-ready deployment with zero ghost users** | **~20 hours** |

### **Total Estimated Timeline: ~87 hours of focused work**

---

## Tech Stack Summary

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Database | PostgreSQL | 16+ | JSON aggregation for READY payload |
| Backend API | Node.js + Express + **tRPC** | 20 LTS + 4.x + 11.x | End-to-end type safety |
| Real-time | Socket.io + **@socket.io/redis-adapter** | 4.x | READY event gateway pattern; Redis adapter for multi-instance broadcasting (Section 7.4) |
| Auth | JWT (jsonwebtoken) + bcrypt | — | |
| ORM/Query | Raw SQL (pg driver) + **Zod** | 8.x | Zod validates + infers types |
| Frontend | Next.js (App Router) | 14+ | |
| Styling | Tailwind CSS | 3.x | |
| State | Zustand | 4.x | Hydrated from READY, patched by WS events |
| Type Sharing | **@discord/shared** (monorepo) | — | Single source of truth for all types |
| API Client | **@trpc/react-query** | 11.x | Replaces Axios; auto-typed from server |
| SFU | Go + Pion/WebRTC | 1.22+ / v4 | +reconciliation endpoint, HMAC-signed bridge |
| STUN/TURN | Coturn | 4.6+ | UDP relay for firewalled clients; short-lived HMAC-SHA1 credentials |
| Deployment | Nginx + pm2 + systemd | — | Nginx = TCP (HTTP/WS), Coturn = UDP (media relay) |
| Future | Redis (presence/pub-sub + Socket.io adapter) | 7.x | Presence source of truth + `@socket.io/redis-adapter` Pub/Sub for cross-instance broadcasting (Section 7.4); replaces in-memory Map |

---

*This document is the single source of architectural truth for the project.
Update it as decisions change.*

---

## 11. Technical Warnings & Gotchas

> **These are not theoretical concerns. They are production-breaking issues
> that WILL surface during development. Each one has crashed real SFU deployments.**

### 11.1 The 50-Peer Video Bandwidth Wall

| Scenario | Per-Client Download | Feasible? |
|---|---|---|
| 50 users, all 720p video, no simulcast | 49 × 1.5 Mbps = **73.5 Mbps** | ❌ Impossible |
| 50 users, simulcast LOW layer only | 49 × 100 Kbps = **4.9 Mbps** | ✅ But ugly |
| 50 users, Last-5 video (HIGH) + 44 audio | 5 × 2.5 + 44 × 0.05 = **14.7 Mbps** | ✅ Recommended |
| 10 users, all 720p, simulcast MED | 9 × 500 Kbps = **4.5 Mbps** | ✅ Great |

**Rule: Simulcast + Last-N video are not optional. They are load-bearing walls.**

See [Section 8.4.1](#841-simulcast-mandatory) and [Section 8.4.2](#842-active-speaker--last-n-video-mandatory).

### 11.2 Safari / iOS — The Platform Trap

| Issue | Impact | Mitigation |
|---|---|---|
| Autoplay blocked | Incoming audio/video won't play | Gate `.play()` behind user gesture; use `playsinline` |
| Multiple `getUserMedia()` calls | Previous tracks silently muted | Call once, use `replaceTrack()` to switch devices |
| VP8/VP9 unsupported | Video fails entirely | Ensure H.264 is in SDP offer/answer |
| No `playsinline` attribute | Video hijacks to native fullscreen | Always add `playsinline` to `<video>` elements |

See [Section 6.0](#-60-safari--ios-webrtc-warnings) for full details and code patterns.

### 11.3 Goroutine Leaks — The Silent Server Killer

```
Symptom:  Server works fine for hours, then OOMs or stops responding.
Cause:    Disconnected peers leave orphaned goroutines that spin forever.
Fix:      Every forwarding goroutine MUST be tied to a context.Context
          that is cancelled on peer disconnect.

Monitoring checklist:
  □ Expose /debug/stats with runtime.NumGoroutine()
  □ Log goroutine count on every peer join/leave
  □ Set up alerting if goroutine count exceeds (active_peers × 5)
  □ Write integration tests that join + disconnect 50 peers in a loop
    and assert goroutine count returns to baseline
```

See [Section 8.4.3](#843-goroutine-leak-prevention-critical) for the full teardown pattern.

### 11.4 Database-Level Landmines

| # | Issue | When It Hits | Prevention |
|---|---|---|---|
| 1 | **OFFSET pagination on messages** | User scrolls deep into chat history (page 100+) | BANNED. Use cursor-based `WHERE created_at < $cursor` only. See [Section 4.4, Optimization #2](#optimization-2-cursor-pagination-not-offset). |
| 2 | **Missing UNIQUE(user_id) on voice_states** | Browser crash + reconnect + late webhook = ghost clone | The UNIQUE constraint is load-bearing. Use `INSERT ... ON CONFLICT DO UPDATE`. See [Section 4.4, Optimization #3](#optimization-3-uniqueuser_id-on-voice_states--ghost-prevention). |
| 3 | **Missing indexes on server_members/channels** | READY query goes from 50ms → 800ms+ as tables grow | Three indexes support the READY json_agg query. See [Section 4.4, Optimization #1](#optimization-1-indexes-tuned-for-the-ready-gateway-query). |
| 4 | **VARCHAR instead of ENUM for categories** | Millions of message rows waste storage, slower WHERE clauses | All categorical columns (`status`, `role`, `type`) use ENUM (4 bytes vs 6-10 bytes). |
| 5 | **Missing ON DELETE CASCADE** | Orphaned rows accumulate; manual multi-table DELETE is error-prone | Every FK uses CASCADE. Deleting a server atomically cleans channels, members, messages, voice_states. |
| 6 | **N+1 queries in the READY handler** | Querying channels per server in a loop instead of json_agg | The READY query MUST be a single SQL statement using json_agg subqueries, not a loop. Members are NOT in READY — see [Section 5.3.1](#-531-the-json-bomb-problem--why-members-are-not-in-ready). |
| 7 | **Forgetting created_at DESC in index** | Postgres does a reverse-scan or filesort on every message fetch | The index is `messages(channel_id, created_at DESC)` — the DESC matches the ORDER BY direction. |

### 11.5 Payload & Distributed System Landmines

| # | Issue | When It Hits | Prevention |
|---|---|---|---|
| 1 | **Member arrays in READY payload ("JSON Bomb")** | User joins server with 10k+ members → PostgreSQL CPU spike, Node.js OOM, browser tab freeze | Members are NEVER in READY. Lazy-load via `server.getMembers` tRPC query on click. See [Section 5.3.1](#-531-the-json-bomb-problem--why-members-are-not-in-ready). |
| 2 | **Reconciliation deletes mid-handshake users ("Flickering Ghost")** | Loop fires during WebRTC SDP negotiation → user connected to Go but invisible in DB/UI | 15-second grace period: only delete ghosts whose `joined_at` is older than 15s. See [Section 9.1.3](#913-the-fix-state-reconciliation-loop-diff-based--grace-period). |
| 3 | **Unauthenticated Go SFU ("Naked SFU")** | Anyone can cURL a fake SDP offer → join private rooms, eavesdrop, or DDoS with fake PeerConnections | Voice Ticket pattern: Node.js issues HMAC-signed 30s ticket, Go verifies before allocating resources. See [Section 3.3](#33-voice-channel-join-webrtc-via-go-sfu--voice-ticket-auth). |
| 4 | **Redis/SQL Presence Paradox** | Move presence to Redis → stop updating `users.status` in SQL → READY query returns 0 online members forever | `users.status` removed from PostgreSQL. Presence lives in Redis/in-memory only. READY payload assembled via hybrid stitch. See [Section 7.3](#73-presence-strategy). |
| 5 | **Static webhook secret with no timestamp** | Secret leaked → attacker replays disconnect requests forever | HMAC-SHA256 signing with 5-minute timestamp window. See [Section 9.1.1](#911-real-time-webhook-fire-on-disconnect--hmac-signed). |
| 6 | **Per-room reconciliation queries** | 1,000 voice channels → 2,001 queries/minute to PostgreSQL | Diff-based approach: 1 grouped SELECT + in-memory diff + batch write. See [Section 9.1.3](#913-the-fix-state-reconciliation-loop-diff-based--grace-period). |
| 7 | **No TURN server in deployment** | Users behind corporate firewalls/symmetric NATs can't connect video | Deploy Coturn with STUN + TURN. See [Section 9.2](#92-deployment-architecture-nginx--coturn-stunturn). |
| 8 | **TURN static credentials exposed to client** | Attacker uses your TURN server as a free relay forever | Generate short-lived credentials via HMAC-SHA1 (24h TTL). See [Section 9.2.3](#923-ice-server-configuration-in-frontend). |
| 9 | **Nginx routing UDP media** | WebRTC video/audio fails — Nginx is TCP-only | Nginx handles HTTP/WS only. UDP media goes directly to Go SFU or through Coturn. |

| 10 | **"Phantom Listener" eavesdropping exploit** | User connects to Room A, then gets ticket for Room B → DB moves them but Go SFU still streams Room A audio/video | Pre-emptive kick: `voice.getTicket` checks for existing voice state and sends `POST /rtc/kick` to Go SFU before issuing new ticket. See [Section 4.4, Optimization #3](#optimization-3-uniqueuser_id-on-voice_states--ghost-prevention--pre-emptive-kick) and [Section 3.3](#33-voice-channel-join-webrtc-via-go-sfu--voice-ticket-auth). |
| 11 | **Simulcast layer switch freezes video ("Decoder Crash")** | User's bandwidth fluctuates → SFU swaps HIGH→LOW → RTP sequence jump + missing keyframe → permanent `<video>` freeze | RTP header rewriting (continuous sequence numbers) + PLI request (force keyframe). Use Pion interceptor package. See [Section 8.4.1](#841-simulcast-mandatory--layer-switching-protocol). |
| 12 | **"Hydration Gap" — dropped messages during READY** | Message arrives at ms 25 while Zustand is still hydrating the READY payload → event handler tries to write to uninitialized store → silently dropped | Server emits READY **before** joining rooms; client buffers all events in `earlyEventQueue` until hydration completes; client emits `ready:ack` to trigger room joins. See [Section 7.1](#71-connection-lifecycle-ready-event-flow) and `_hydration` slice in [Section 6.2](#62-state-architecture-zustand). |
| 13 | **Cross-instance Socket.io broadcasts silently fail** | `pm2 -i 4` runs 4 Node.js processes → User A on Instance 1 sends message → `io.to(room).emit()` only reaches Instance 1's local sockets → User B on Instance 3 never gets it | `@socket.io/redis-adapter` relays all room broadcasts via Redis Pub/Sub. Setup in [Section 7.4](#74-socketio-redis-adapter-multi-instance-scaling). |

### 11.6 Additional Landmines to Watch For

| # | Issue | When It Hits | Prevention |
|---|---|---|---|
| 1 | **ICE restart failures** | Network switches (WiFi → 4G) | Implement `iceRestart: true` in createOffer options |
| 2 | **Renegotiation storms** | 50-peer room with frequent joins/leaves | Batch renegotiations with a 500ms debounce timer |
| 3 | **Clock skew in JWT** | Deployed across timezones | Use `iat` claim with 30s leeway in verification |
| 4 | **WebSocket reconnect floods** | Server restart with 50 connected clients | Implement exponential backoff with jitter in Socket.io client config |
| 5 | **PostgreSQL connection exhaustion** | Under load, pool runs dry | Set pool max to 20, use connection timeout of 5s, monitor with `pg_stat_activity` |
| 6 | **SDP answer too large** | 50 tracks = massive SDP blob | Use SDP munging to strip unnecessary codecs; consider Trickle ICE |
| 7 | **REST waterfall on app load** | If you add REST GET endpoints "for convenience" | NEVER fetch initial data via REST. The READY event is the only source of bootstrap data. REST GETs create N+1 waterfalls. |
