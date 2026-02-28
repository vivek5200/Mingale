// server/src/trpc/trpc.ts — tRPC initialization (no circular deps)
//
// This file ONLY exports t, publicProcedure, protectedProcedure.
// Routers import from HERE, not from index.ts.

import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

/** Initialize tRPC with our context type */
export const t = initTRPC.context<Context>().create();

/** Public procedure — no auth required */
export const publicProcedure = t.procedure;

/** Auth middleware */
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});

/** Protected procedure — requires valid JWT */
export const protectedProcedure = t.procedure.use(isAuthed);
