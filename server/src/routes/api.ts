/**
 * All REST endpoints exposed by the backend.
 *
 * Endpoints are intentionally read-only here. Wallet-signed actions (supply,
 * borrow, withdraw, repay, etc.) are sent directly to the chain by the user's
 * wallet via the frontend; the backend exposes the read-side helpers and the
 * supplementary services such as `watch` and `deleverage preview` that the
 * frontend cannot compute on its own.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { acreService } from '../services/acreService';
import { PROTOCOL_CONFIG } from '../config/protocol';
import { asyncHandler } from '../middleware/asyncHandler';
import { badRequest, notFound } from '../middleware/errorHandler';
import {
  checkSchema,
  deleveragePreviewSchema,
  hexAddress,
  positionsQuery,
  seriesQuery,
  trackSchema,
  watchSchema
} from '../schemas/validation';
import { normalizeAddress } from '../utils/eth';

const router = Router();

// --------------------------------------------------------------------
// Health
// --------------------------------------------------------------------

/** GET /api/health — simple liveness probe. */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'usepond-backend',
    network: PROTOCOL_CONFIG.chainName,
    chainId: PROTOCOL_CONFIG.chainId,
    timestamp: new Date().toISOString()
  });
});

/** GET /api/network — static protocol / chain metadata used by the landing page. */
router.get('/network', (_req: Request, res: Response) => {
  res.json({
    chainName: PROTOCOL_CONFIG.chainName,
    chainId: PROTOCOL_CONFIG.chainId,
    chainIdHex: PROTOCOL_CONFIG.chainIdHex,
    rpcUrl: PROTOCOL_CONFIG.rpcUrl,
    explorerUrl: PROTOCOL_CONFIG.explorerUrl,
    nativeCurrency: PROTOCOL_CONFIG.nativeCurrency,
    noticeBanner: PROTOCOL_CONFIG.noticeBanner
  });
});

/** GET /api/config — full configuration used by the frontend. */
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    chainName: PROTOCOL_CONFIG.chainName,
    chainId: PROTOCOL_CONFIG.chainId,
    chainIdHex: PROTOCOL_CONFIG.chainIdHex,
    rpcUrl: PROTOCOL_CONFIG.rpcUrl,
    explorerUrl: PROTOCOL_CONFIG.explorerUrl,
    nativeCurrency: PROTOCOL_CONFIG.nativeCurrency,
    contracts: PROTOCOL_CONFIG.contracts,
    legacyDeployments: PROTOCOL_CONFIG.legacyDeployments,
    acreToken: PROTOCOL_CONFIG.acreToken,
    pondToken: PROTOCOL_CONFIG.acreToken,
    loanToken: PROTOCOL_CONFIG.loanToken,
    collateral: PROTOCOL_CONFIG.collateral,
    rebateTiers: PROTOCOL_CONFIG.rebateTiers,
    shareSymbol: PROTOCOL_CONFIG.shareSymbol,
    keeperWatchUrl: PROTOCOL_CONFIG.keeperWatchUrl
  });
});

// --------------------------------------------------------------------
// Watch / keeper
// --------------------------------------------------------------------

/** POST /api/watch — register an address with the keeper. */
router.post(
  '/watch',
  asyncHandler(async (req, res) => {
    const body = watchSchema.parse(req.body);
    const entry = await acreService.registerWatch(body.address, 'user-ui');
    res.json({
      ok: true,
      registration: entry,
      keeperWatchUrl: PROTOCOL_CONFIG.keeperWatchUrl
    });
  })
);

/** GET /api/watch — list current watch registrations (admin / debug). */
router.get(
  '/watch',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      count: acreService.listWatchRegistrations().length,
      registrations: acreService.listWatchRegistrations()
    });
  })
);

// --------------------------------------------------------------------
// Check (used by /check.html)
// --------------------------------------------------------------------

/** GET /api/check/:address — borrow capacity + collateral lookup. */
router.get(
  '/check/:address',
  asyncHandler(async (req, res) => {
    const address = hexAddress.parse(req.params.address);
    const result = await acreService.getAddressCheck(address);
    res.json({ ok: true, ...result });
  })
);

/** POST /api/check — accepts a JSON body with `{ address }`. */
router.post(
  '/check',
  asyncHandler(async (req, res) => {
    const body = checkSchema.parse(req.body);
    const result = await acreService.getAddressCheck(body.address);
    res.json({ ok: true, ...result });
  })
);

// --------------------------------------------------------------------
// Rebate  (static routes declared before the /:address param route)
// --------------------------------------------------------------------

/** GET /api/rebate/solvency — protocol-level rebate solvency. */
router.get(
  '/rebate/solvency',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await acreService.getRebateSolvency()) });
  })
);

/** GET /api/rebate/:address — tier, supplied, pending, banked. */
router.get(
  '/rebate/:address',
  asyncHandler(async (req, res) => {
    const address = hexAddress.parse(req.params.address);
    res.json({ ok: true, ...(await acreService.getRebate(address)) });
  })
);

// --------------------------------------------------------------------
// Pool / market
// --------------------------------------------------------------------

/** GET /api/pool/stats — global pool statistics. */
router.get(
  '/pool/stats',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await acreService.getPoolOverview()) });
  })
);

/** GET /api/market/calendar — current market session + seconds until open. */
router.get(
  '/market/calendar',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await acreService.getCalendar()) });
  })
);

/** GET /api/market/prices — oracle prices for the configured collateral set. */
router.get(
  '/market/prices',
  asyncHandler(async (_req, res) => {
    const overview = await acreService.getPoolOverview();
    res.json({ ok: true, prices: overview.collateral, fetchedAt: overview.fetchedAt });
  })
);

// --------------------------------------------------------------------
// Positions  (static sub-route declared before /:address)
// --------------------------------------------------------------------

/** GET /api/positions/:address/legacy — list legacy-deployment positions. */
router.get(
  '/positions/:address/legacy',
  asyncHandler(async (req, res) => {
    const address = hexAddress.parse(req.params.address);
    const entries = await acreService.getLegacyPositions(address);
    res.json({ ok: true, address, count: entries.length, entries });
  })
);

/** GET /api/positions/:address — full per-account view. */
router.get(
  '/positions/:address',
  asyncHandler(async (req, res) => {
    const address = hexAddress.parse(req.params.address);
    const query = positionsQuery.parse(req.query);
    const [position, legacy] = await Promise.all([
      acreService.getUserPosition(address),
      query.legacy ? acreService.getLegacyPositions(address) : Promise.resolve([])
    ]);
    res.json({ ok: true, position, legacy });
  })
);

// --------------------------------------------------------------------
// Deposits / transfers  (static routes declared before /:address)
// --------------------------------------------------------------------

/** GET /api/deposits/addresses — the three transfer addresses. */
router.get(
  '/deposits/addresses',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...acreService.getTransferAddresses() });
  })
);

/** GET /api/deposits/:address — pending transfers for an account. */
router.get(
  '/deposits/:address',
  asyncHandler(async (req, res) => {
    const address = hexAddress.parse(req.params.address);
    res.json({ ok: true, ...(await acreService.getTransferHoldings(address)) });
  })
);

// --------------------------------------------------------------------
// Outcome series
// --------------------------------------------------------------------

/** GET /api/outcome/series — list of all defined outcome series. */
router.get(
  '/outcome/series',
  asyncHandler(async (req, res) => {
    const query = seriesQuery.parse(req.query);
    const series = await acreService.listSeries();
    res.json({ ok: true, count: series.length, account: query.account ?? null, series });
  })
);

/** GET /api/outcome/series/:id — single series by numeric id. */
router.get(
  '/outcome/series/:id',
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) throw badRequest('Series id must be a positive integer');
    const series = await acreService.getSeriesById(id.data);
    if (!series) throw notFound('Series');
    res.json({ ok: true, series });
  })
);

// --------------------------------------------------------------------
// Deleverage
// --------------------------------------------------------------------

/** POST /api/deleverage/preview — dry run of a plan. */
router.post(
  '/deleverage/preview',
  asyncHandler(async (req, res) => {
    const body = deleveragePreviewSchema.parse(req.body);
    const result = await acreService.previewDeleverage(body.address, body.leadSeconds, body.targetBps);
    res.json({ ok: true, ...result });
  })
);

// --------------------------------------------------------------------
// Analytics hook
// --------------------------------------------------------------------

/** POST /api/analytics/track — best-effort, no-op unless a sink is wired in. */
router.post(
  '/analytics/track',
  asyncHandler(async (req, res) => {
    const body = trackSchema.parse(req.body);
    // eslint-disable-next-line no-console
    console.log('[analytics]', body.event, JSON.stringify(body.properties ?? {}), body.address ?? '');
    res.json({ ok: true });
  })
);

// --------------------------------------------------------------------
// Debug / utilities
// --------------------------------------------------------------------

/** POST /api/utils/validate-address — used by the form for instant feedback. */
router.post(
  '/utils/validate-address',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ address: z.string() }).safeParse(req.body);
    if (!parsed.success) throw badRequest('address is required');
    const trimmed = parsed.data.address.trim();
    const valid = /^0x[0-9a-fA-F]{40}$/.test(trimmed);
    const result = valid ? { valid: true, address: normalizeAddress(trimmed) } : { valid: false };
    res.json({ ok: true, ...result });
  })
);

export default router;
