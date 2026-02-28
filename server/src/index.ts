// server/src/index.ts — Entry point: Express + tRPC + Socket.io bootstrap

import express from 'express';
import cors from 'cors';
import http from 'http';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { Server as SocketServer } from 'socket.io';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { logger } from './utils/logger.js';
import { appRouter } from './trpc/index.js';
import { createContext } from './trpc/context.js';
import { registerSocketHandlers } from './socket/index.js';
import { openApiSpec } from './docs/openapi.js';

async function main() {
  // 1. Verify database connection
  await connectDatabase();

  // 2. Express app
  const app = express();
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(express.json());

  // 3. Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 3b. Swagger API docs
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Discord Clone API Docs',
  }));

  // 3c. Raw OpenAPI JSON spec
  app.get('/api-docs.json', (_req, res) => {
    res.json(openApiSpec);
  });

  // 4. tRPC middleware — handles all /trpc/* routes
  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        logger.error(`tRPC error on ${path}: ${error.message}`);
      },
    }),
  );

  // 5. HTTP server (shared between Express and Socket.io)
  const httpServer = http.createServer(app);

  // 6. Socket.io server
  const io = new SocketServer(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
    },
    // Phase 3+: attach Redis adapter here (Section 7.4)
  });

  // 7. Register Socket.io event handlers
  registerSocketHandlers(io);

  // 8. Start server
  httpServer.listen(env.PORT, () => {
    logger.info(`🚀 Server running on http://localhost:${env.PORT}`);
    logger.info(`   tRPC:      http://localhost:${env.PORT}/trpc`);
    logger.info(`   API Docs:  http://localhost:${env.PORT}/api-docs`);
    logger.info(`   Socket.io: ws://localhost:${env.PORT}`);
    logger.info(`   Health:    http://localhost:${env.PORT}/health`);
    logger.info(`   Env:       ${env.NODE_ENV}`);
  });
}

main().catch((err) => {
  logger.fatal('Failed to start server:', err);
  process.exit(1);
});
