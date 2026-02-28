// server/src/utils/helpers.ts — Shared utility functions

import { customAlphabet } from 'nanoid';

// 8-character invite codes using alphanumeric chars (no ambiguous chars)
const generateInviteCode = customAlphabet(
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789',
  8,
);

export function createInviteCode(): string {
  return generateInviteCode();
}

/** Convert snake_case DB rows to camelCase for the API response */
export function snakeToCamel<T extends Record<string, unknown>>(
  row: T,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    result[camelKey] = value;
  }
  return result;
}
