/**
 * Centralised Zod request schemas. Every route validates its input through these
 * so a malformed body returns a 400 with a useful message rather than a runtime
 * crash deeper in the stack.
 */

import { z } from 'zod';

/** Strict 20-byte address. The frontend uses the same regex. */
export const hexAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed 20-byte hex address')
  .transform((s) => s.toLowerCase() as `0x${string}`);

/** Optional body for endpoints that accept nothing or just metadata. */
export const emptyBody = z
  .object({})
  .strict()
  .or(z.undefined())
  .or(z.null());

/**
 * POST /api/watch
 * Register an address with the keeper so a transfer gets credited.
 * The frontend posts `{ address }` and may include `chainId`.
 */
export const watchSchema = z
  .object({
    address: hexAddress,
    chainId: z.number().int().positive().optional(),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
    message: z.string().min(1).max(2048).optional()
  })
  .strict();

/**
 * POST /api/check
 * The /check form on the landing page submits an address and the server
 * returns a sanitised read-only view of that account's position.
 */
export const checkSchema = z
  .object({
    address: hexAddress
  })
  .strict();

/**
 * GET /api/positions/:address — address comes from the URL, no body.
 * Optional query params for paging the protect tab.
 */
export const positionsQuery = z.object({
  legacy: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true')
});

/**
 * GET /api/series — list of all defined outcome series
 * Accepts an optional `account` for per-account stake/claim figures.
 */
export const seriesQuery = z.object({
  account: hexAddress.optional()
});

/**
 * POST /api/deleverage/preview — server-side dry run of the auto-deleverage plan.
 * The frontend mirrors the same call before broadcasting a transaction.
 */
export const deleveragePreviewSchema = z
  .object({
    address: hexAddress,
    leadSeconds: z.number().int().min(0).max(86_400),
    targetBps: z.number().int().min(0).max(10_000)
  })
  .strict();

/**
 * POST /api/analytics/track
 * Optional lightweight analytics hook. Disabled unless a real producer is wired in.
 */
export const trackSchema = z
  .object({
    event: z.string().min(1).max(64),
    properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    address: hexAddress.optional()
  })
  .strict();

export type WatchPayload = z.infer<typeof watchSchema>;
export type CheckPayload = z.infer<typeof checkSchema>;
export type DeleveragePreviewPayload = z.infer<typeof deleveragePreviewSchema>;
export type TrackPayload = z.infer<typeof trackSchema>;
