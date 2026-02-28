// server/src/docs/openapi.ts — OpenAPI 3.0 spec for Phase 1 tRPC endpoints

import type { OpenAPIV3 } from '../types/openapi.js';

/* ──────────────────── Reusable Schema Components ──────────────────── */

const UserProfile: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    id:        { type: 'string', format: 'uuid', example: '58bdba72-ae82-4a22-9ba0-d902e3c1c7d5' },
    username:  { type: 'string', example: 'testuser' },
    avatarUrl: { type: 'string', nullable: true, example: null },
  },
  required: ['id', 'username', 'avatarUrl'],
};

const AuthResponse: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    user:  { $ref: '#/components/schemas/UserProfile' },
    token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...' },
  },
  required: ['user', 'token'],
};

const ServerObject: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    id:         { type: 'string', format: 'uuid' },
    name:       { type: 'string', example: 'My Test Server' },
    iconUrl:    { type: 'string', nullable: true },
    ownerId:    { type: 'string', format: 'uuid' },
    inviteCode: { type: 'string', example: 'VM6XeMkr' },
  },
  required: ['id', 'name', 'iconUrl', 'ownerId', 'inviteCode'],
};

const ChannelObject: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    id:       { type: 'string', format: 'uuid' },
    serverId: { type: 'string', format: 'uuid' },
    name:     { type: 'string', example: 'general' },
    topic:    { type: 'string', nullable: true },
    type:     { type: 'string', enum: ['text', 'voice'] },
    position: { type: 'integer', example: 0 },
  },
  required: ['id', 'serverId', 'name', 'topic', 'type', 'position'],
};

const MessageObject: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    id:        { type: 'string', format: 'uuid' },
    channelId: { type: 'string', format: 'uuid' },
    userId:    { type: 'string', format: 'uuid' },
    content:   { type: 'string', example: 'Hello world' },
    type:      { type: 'string', enum: ['text', 'image', 'system'], default: 'text' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    author:    { $ref: '#/components/schemas/UserProfile' },
  },
  required: ['id', 'channelId', 'userId', 'content', 'type', 'createdAt', 'updatedAt', 'author'],
};

const MemberObject: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    userId:    { type: 'string', format: 'uuid' },
    username:  { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    role:      { type: 'string', enum: ['owner', 'admin', 'member'] },
    joinedAt:  { type: 'string', format: 'date-time' },
  },
  required: ['userId', 'username', 'avatarUrl', 'role', 'joinedAt'],
};

const TRPCError: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        code:    { type: 'integer' },
        data: {
          type: 'object',
          properties: {
            code:       { type: 'string', example: 'UNAUTHORIZED' },
            httpStatus: { type: 'integer', example: 401 },
          },
        },
      },
    },
  },
};

/* ──────────────── Helpers ──────────────── */

/** Wraps data in tRPC response envelope: `{ result: { data: ... } }` */
function tRPCResult(dataSchema: OpenAPIV3.SchemaObject | { $ref: string }): OpenAPIV3.SchemaObject {
  return {
    type: 'object',
    properties: {
      result: {
        type: 'object',
        properties: {
          data: dataSchema as OpenAPIV3.SchemaObject,
        },
      },
    },
  };
}

function jsonBody(schema: OpenAPIV3.SchemaObject): OpenAPIV3.RequestBodyObject {
  return {
    required: true,
    content: { 'application/json': { schema } },
  };
}

function jsonResponse(description: string, schema: OpenAPIV3.SchemaObject): OpenAPIV3.ResponseObject {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

const bearerAuth: OpenAPIV3.SecurityRequirementObject[] = [{ BearerAuth: [] }];

/* ──────────────── OpenAPI Document ──────────────── */

export const openApiSpec: Record<string, unknown> = {
  openapi: '3.0.3',
  info: {
    title: 'Discord Clone — Phase 1 API',
    version: '1.0.0',
    description: `## Overview
This is the Phase 1 (API & Database Foundation) of the Discord Clone project.

All endpoints use **tRPC v11 over HTTP**:
- **Mutations** → \`POST /trpc/<procedure>\` with a flat JSON body
- **Queries** → \`GET /trpc/<procedure>?input=<url-encoded-json>\`

## Authentication
Protected endpoints require a JWT in the \`Authorization\` header:
\`\`\`
Authorization: Bearer <token>
\`\`\`
Obtain a token via \`auth.register\` or \`auth.login\`.

## Real-time
Messages are created via **Socket.io** (not tRPC). Message history is read via tRPC query.

## Cursor Pagination
All paginated endpoints use cursor-based pagination (never OFFSET).
Pass the \`nextCursor\` value from the response as the \`cursor\` parameter in the next request.`,
    contact: { name: 'Discord Clone Team' },
  },

  servers: [
    { url: 'http://localhost:3001', description: 'Local development' },
  ],

  tags: [
    { name: 'Health',   description: 'Server health check' },
    { name: 'Auth',     description: 'Register / Login (public)' },
    { name: 'Server',   description: 'Server CRUD, join/leave, member list (protected)' },
    { name: 'Channel',  description: 'Channel CRUD (admin+ required)' },
    { name: 'Messages', description: 'Message history (protected)' },
  ],

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT obtained from auth.register or auth.login',
      },
    },
    schemas: {
      UserProfile:    UserProfile,
      AuthResponse:   AuthResponse,
      Server:         ServerObject,
      Channel:        ChannelObject,
      Message:        MessageObject,
      Member:         MemberObject,
      TRPCError:      TRPCError,
      SuccessResult:  tRPCResult({ type: 'object', properties: { success: { type: 'boolean', example: true } } }),
    },
  },

  paths: {
    /* ─────────────── Health ─────────────── */
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        operationId: 'healthCheck',
        responses: {
          '200': jsonResponse('Server is healthy', {
            type: 'object',
            properties: {
              status:    { type: 'string', example: 'ok' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          }),
        },
      },
    },

    /* ─────────────── Auth ─────────────── */
    '/trpc/auth.register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new account',
        operationId: 'authRegister',
        description: 'Creates a new user with bcrypt-hashed password (12 rounds). Returns the user profile and a JWT valid for 7 days.',
        requestBody: jsonBody({
          type: 'object',
          required: ['username', 'email', 'password'],
          properties: {
            username: { type: 'string', minLength: 2, maxLength: 32, example: 'testuser' },
            email:    { type: 'string', format: 'email', maxLength: 255, example: 'test@example.com' },
            password: { type: 'string', minLength: 6, maxLength: 128, example: 'password123' },
          },
        }),
        responses: {
          '200': jsonResponse('Registration successful', tRPCResult({ $ref: '#/components/schemas/AuthResponse' })),
          '409': jsonResponse('Email or username already taken', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/auth.login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with email and password',
        operationId: 'authLogin',
        description: 'Validates credentials and returns a JWT. Password is verified against bcrypt hash.',
        requestBody: jsonBody({
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email:    { type: 'string', format: 'email', example: 'test@example.com' },
            password: { type: 'string', minLength: 1, example: 'password123' },
          },
        }),
        responses: {
          '200': jsonResponse('Login successful', tRPCResult({ $ref: '#/components/schemas/AuthResponse' })),
          '401': jsonResponse('Invalid email or password', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    /* ─────────────── Server ─────────────── */
    '/trpc/server.create': {
      post: {
        tags: ['Server'],
        summary: 'Create a new server',
        operationId: 'serverCreate',
        security: bearerAuth,
        description: 'Creates a server in a single transaction: inserts the server row, adds the caller as **owner**, and creates a `#general` text channel at position 0.',
        requestBody: jsonBody({
          type: 'object',
          required: ['name'],
          properties: {
            name:    { type: 'string', minLength: 1, maxLength: 100, example: 'My Test Server' },
            iconUrl: { type: 'string', format: 'uri', nullable: true, example: null },
          },
        }),
        responses: {
          '200': jsonResponse('Server created', tRPCResult({ $ref: '#/components/schemas/Server' })),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/server.update': {
      post: {
        tags: ['Server'],
        summary: 'Update server metadata',
        operationId: 'serverUpdate',
        security: bearerAuth,
        description: 'Updates server name and/or icon. Requires **owner** or **admin** role.',
        requestBody: jsonBody({
          type: 'object',
          required: ['serverId'],
          properties: {
            serverId: { type: 'string', format: 'uuid' },
            name:     { type: 'string', minLength: 1, maxLength: 100, example: 'Renamed Server' },
            iconUrl:  { type: 'string', format: 'uri', nullable: true },
          },
        }),
        responses: {
          '200': jsonResponse('Server updated', tRPCResult({ $ref: '#/components/schemas/Server' })),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '403': jsonResponse('Insufficient permissions', { $ref: '#/components/schemas/TRPCError' }),
          '404': jsonResponse('Server not found', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/server.delete': {
      post: {
        tags: ['Server'],
        summary: 'Delete a server',
        operationId: 'serverDelete',
        security: bearerAuth,
        description: 'Permanently deletes a server and all associated data (channels, members, messages, voice states) via CASCADE. **Owner only.**',
        requestBody: jsonBody({
          type: 'object',
          required: ['serverId'],
          properties: {
            serverId: { type: 'string', format: 'uuid' },
          },
        }),
        responses: {
          '200': jsonResponse('Server deleted', { $ref: '#/components/schemas/SuccessResult' }),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '403': jsonResponse('Only the owner can delete', { $ref: '#/components/schemas/TRPCError' }),
          '404': jsonResponse('Server not found', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/server.join': {
      post: {
        tags: ['Server'],
        summary: 'Join a server via invite code',
        operationId: 'serverJoin',
        security: bearerAuth,
        description: 'Joins the authenticated user to a server using its 8-character invite code. Returns the server object.',
        requestBody: jsonBody({
          type: 'object',
          required: ['inviteCode'],
          properties: {
            inviteCode: { type: 'string', minLength: 1, maxLength: 20, example: 'VM6XeMkr' },
          },
        }),
        responses: {
          '200': jsonResponse('Joined server', tRPCResult({ $ref: '#/components/schemas/Server' })),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '404': jsonResponse('Invalid invite code', { $ref: '#/components/schemas/TRPCError' }),
          '409': jsonResponse('Already a member', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/server.leave': {
      post: {
        tags: ['Server'],
        summary: 'Leave a server',
        operationId: 'serverLeave',
        security: bearerAuth,
        description: 'Removes the authenticated user from the server. **The owner cannot leave** — they must transfer ownership or delete the server.',
        requestBody: jsonBody({
          type: 'object',
          required: ['serverId'],
          properties: {
            serverId: { type: 'string', format: 'uuid' },
          },
        }),
        responses: {
          '200': jsonResponse('Left server', { $ref: '#/components/schemas/SuccessResult' }),
          '400': jsonResponse('Owner cannot leave', { $ref: '#/components/schemas/TRPCError' }),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '404': jsonResponse('Server not found or not a member', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/server.getMembers': {
      get: {
        tags: ['Server'],
        summary: 'Get server members (paginated)',
        operationId: 'serverGetMembers',
        security: bearerAuth,
        description: 'Lazy-loaded, cursor-paginated member list. Called when the user opens a server sidebar. **NOT** included in the READY payload to avoid a "JSON Bomb" on connect.',
        parameters: [
          {
            name: 'input',
            in: 'query',
            required: true,
            description: 'URL-encoded JSON: `{"serverId":"<uuid>","limit":100,"cursor":"<iso-date>"}`',
            schema: { type: 'string', example: '{"serverId":"04aa0d6e-d15f-4898-8e6b-e4ab72340c9a"}' },
          },
        ],
        responses: {
          '200': jsonResponse('Members list', tRPCResult({
            type: 'object',
            properties: {
              members:    { type: 'array', items: { $ref: '#/components/schemas/Member' } },
              nextCursor: { type: 'string', nullable: true, format: 'date-time', description: 'Pass as `cursor` for next page. null = no more pages.' },
            },
          })),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '403': jsonResponse('Not a member of this server', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    /* ─────────────── Channel ─────────────── */
    '/trpc/channel.create': {
      post: {
        tags: ['Channel'],
        summary: 'Create a channel',
        operationId: 'channelCreate',
        security: bearerAuth,
        description: 'Creates a text or voice channel in a server. Position is auto-calculated as `MAX(position) + 1`. Requires **owner** or **admin** role.',
        requestBody: jsonBody({
          type: 'object',
          required: ['serverId', 'name'],
          properties: {
            serverId: { type: 'string', format: 'uuid' },
            name:     { type: 'string', minLength: 1, maxLength: 100, example: 'announcements' },
            type:     { type: 'string', enum: ['text', 'voice'], default: 'text' },
            topic:    { type: 'string', maxLength: 1024, nullable: true, example: 'Important server updates' },
          },
        }),
        responses: {
          '200': jsonResponse('Channel created', tRPCResult({ $ref: '#/components/schemas/Channel' })),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '403': jsonResponse('Insufficient permissions (need admin+)', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/channel.update': {
      post: {
        tags: ['Channel'],
        summary: 'Update a channel',
        operationId: 'channelUpdate',
        security: bearerAuth,
        description: 'Updates channel name, topic, and/or position. Requires **owner** or **admin** role.',
        requestBody: jsonBody({
          type: 'object',
          required: ['channelId'],
          properties: {
            channelId: { type: 'string', format: 'uuid' },
            name:      { type: 'string', minLength: 1, maxLength: 100 },
            topic:     { type: 'string', maxLength: 1024, nullable: true },
            position:  { type: 'integer', minimum: 0 },
          },
        }),
        responses: {
          '200': jsonResponse('Channel updated', tRPCResult({ $ref: '#/components/schemas/Channel' })),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '403': jsonResponse('Insufficient permissions', { $ref: '#/components/schemas/TRPCError' }),
          '404': jsonResponse('Channel not found', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    '/trpc/channel.delete': {
      post: {
        tags: ['Channel'],
        summary: 'Delete a channel',
        operationId: 'channelDelete',
        security: bearerAuth,
        description: 'Permanently deletes a channel and all its messages and voice states (CASCADE). Requires **owner** or **admin** role.',
        requestBody: jsonBody({
          type: 'object',
          required: ['channelId'],
          properties: {
            channelId: { type: 'string', format: 'uuid' },
          },
        }),
        responses: {
          '200': jsonResponse('Channel deleted', { $ref: '#/components/schemas/SuccessResult' }),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '403': jsonResponse('Insufficient permissions', { $ref: '#/components/schemas/TRPCError' }),
          '404': jsonResponse('Channel not found', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    /* ─────────────── Messages ─────────────── */
    '/trpc/message.getHistory': {
      get: {
        tags: ['Messages'],
        summary: 'Get message history (paginated)',
        operationId: 'messageGetHistory',
        security: bearerAuth,
        description: `Cursor-based message history sorted by \`created_at DESC\`. Uses a keyset cursor — **never OFFSET**.

Each message includes the author's profile (JOIN on users table).

**Pagination:** Pass the \`nextCursor\` value from the response as the \`cursor\` field in the next request.`,
        parameters: [
          {
            name: 'input',
            in: 'query',
            required: true,
            description: 'URL-encoded JSON: `{"channelId":"<uuid>","limit":50,"cursor":"<iso-date>"}`',
            schema: { type: 'string', example: '{"channelId":"f0826376-1f2a-4c36-a96a-87086cfa38b0"}' },
          },
        ],
        responses: {
          '200': jsonResponse('Message history', tRPCResult({
            type: 'object',
            properties: {
              messages:   { type: 'array', items: { $ref: '#/components/schemas/Message' } },
              nextCursor: { type: 'string', nullable: true, format: 'date-time', description: 'null when no more pages' },
            },
          })),
          '401': jsonResponse('Not authenticated', { $ref: '#/components/schemas/TRPCError' }),
          '403': jsonResponse('Not a member of this server', { $ref: '#/components/schemas/TRPCError' }),
          '404': jsonResponse('Channel not found', { $ref: '#/components/schemas/TRPCError' }),
        },
      },
    },

    /* ─────────────── Socket.io (documentation only) ─────────────── */
    '/socket.io': {
      get: {
        tags: ['Messages'],
        summary: '[Socket.io] Real-time WebSocket (not a REST endpoint)',
        operationId: 'socketIoInfo',
        description: `This is **not a REST endpoint**. It documents the Socket.io events used for real-time messaging.

### Client → Server Events
| Event | Payload | Description |
|-------|---------|-------------|
| \`ready:ack\` | — | Client acknowledges READY, server joins rooms |
| \`message:send\` | \`{channelId, content}\` | Send a message (server broadcasts to room) |
| \`typing:start\` | \`{channelId}\` | Broadcast typing indicator to channel |
| \`presence:update\` | \`{status}\` | Update online/idle/dnd status |

### Server → Client Events
| Event | Payload | Description |
|-------|---------|-------------|
| \`ready\` | \`ReadyPayload\` | Initial hydration data (servers, channels, voice states, presence) |
| \`message:new\` | \`Message\` | New message broadcast to all channel members |
| \`typing:start\` | \`{userId, channelId}\` | Someone is typing |
| \`presence:update\` | \`{userId, status}\` | User changed presence |

### Connection
\`\`\`js
const socket = io('ws://localhost:3001', {
  auth: { token: '<JWT>' }
});
\`\`\``,
        responses: {
          '101': { description: 'WebSocket upgrade (handled by Socket.io, not REST)' },
        },
      },
    },
  },
};
