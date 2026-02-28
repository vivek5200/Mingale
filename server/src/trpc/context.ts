// server/src/trpc/context.ts — tRPC request context

import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface Context {
  userId: string | null;
}

/**
 * Creates the tRPC context for each request.
 * Extracts and verifies the JWT from the Authorization header.
 */
export function createContext({ req }: CreateExpressContextOptions): Context {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return { userId: null };
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    return { userId: decoded.userId };
  } catch {
    return { userId: null };
  }
}

export type CreateContext = typeof createContext;
