// server/src/trpc/index.ts — appRouter composition (no circular deps)
//
// Routers import from ./trpc.ts (t, publicProcedure, protectedProcedure).
// This file only composes them into the root appRouter.

import { t } from './trpc.js';

// Re-export for convenience
export { t, publicProcedure, protectedProcedure } from './trpc.js';

// Import routers
import { authRouter } from './routers/auth.router.js';
import { serverRouter } from './routers/server.router.js';
import { channelRouter } from './routers/channel.router.js';
import { messageRouter } from './routers/message.router.js';

export const appRouter = t.router({
  auth: authRouter,
  server: serverRouter,
  channel: channelRouter,
  message: messageRouter,
});

export type AppRouter = typeof appRouter;
