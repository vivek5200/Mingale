// server/src/trpc/routers/auth.router.ts — Register + Login mutations

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, publicProcedure } from '../trpc.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
} from '../../services/auth.service.js';
import {
  findUserByEmail,
  findUserByUsername,
  createUser,
} from '../../models/user.model.js';

export const authRouter = t.router({
  register: publicProcedure
    .input(
      z.object({
        username: z.string().min(2).max(32).trim(),
        email: z.string().email().max(255).trim().toLowerCase(),
        password: z.string().min(6).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      const { username, email, password } = input;

      // Check for existing email
      const existingEmail = await findUserByEmail(email);
      if (existingEmail) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An account with this email already exists',
        });
      }

      // Check for existing username
      const existingUsername = await findUserByUsername(username);
      if (existingUsername) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This username is already taken',
        });
      }

      // Create user
      const passwordHash = await hashPassword(password);
      const user = await createUser(username, email, passwordHash);
      const token = signToken(user.id);

      return {
        user: {
          id: user.id,
          username: user.username,
          avatarUrl: user.avatar_url,
        },
        token,
      };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email().trim().toLowerCase(),
        password: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { email, password } = input;

      const user = await findUserByEmail(email);
      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        });
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        });
      }

      const token = signToken(user.id);

      return {
        user: {
          id: user.id,
          username: user.username,
          avatarUrl: user.avatar_url,
        },
        token,
      };
    }),
});
