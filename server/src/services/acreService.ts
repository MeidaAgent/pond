/**
 * Application service layer.
 *
 * Each function here corresponds to one of the UI panels in the Pond frontend
 * and one or more REST endpoints in `routes/api.ts`. The implementation
 * prefers the live RPC client when configured and reachable, and falls back
 * to the deterministic mock engine otherwise. This lets the server run in
 * dev mode without an internet connection.
 */

import { RpcClient, mockEngine } from './rpc';
import { PROTOCOL_CONFIG } from '../config/protocol';
import {
  CalendarStatus,
  LegacyEntry,
  PoolOverview,
  RebateStatus,
  Series,
  TransferAddressSet,
  TransferHoldings,
  TransferRow,
  UnlockableRow,
  UserPosition
} from '../types/domain';
import { annualisedPercent, mockPriceUsd, normalizeAddress } from '../utils/eth';

const WAD = 10n ** 18n;

/** Parse a base-unit string from the mock/RPC into a bigint for arithmetic. */
function bn(value: string | bigint | number): bigint {
  return BigInt(value);
}

/** Compute APR/APR rates and attach human-friendly percent fields. */
function computeRates(totals: ReturnType<typeof mockEngine.poolTotals>) {
  const borrowRatePerSecond = bn(totals.borrowRatePerSecond);
  const utilization = bn(totals.utilization);
  const borrowApr = annualisedPercent(borrowRatePerSecond);
  const supplyApr = (borrowApr * Number(utilization)) / 1e18;
  return { borrowApr, supplyApr };
}

export class AcreService {
  public readonly rpc: RpcClient;

  constructor(rpc?: RpcClient) {
    this.rpc = rpc ?? new RpcClient();
  }

  // -------------------------------------------------------------------
  // Protocol overview
  // -------------------------------------------------------------------

  public async getPoolOverview(): Promise<PoolOverview> {
    const totals = mockEngine.poolTotals();
    const caps = mockEngine.poolCaps();
    const paused = mockEngine.poolPaused();
    const collateral = mockEngine.oraclePrices();
    const { borrowApr, supplyApr } = computeRates(totals);

    return {
      totals: {
        supplied: totals.supplied,
        borrowed: totals.borrowed,
        utilization: totals.utilization,
        borrowRatePerSecond: totals.borrowRatePerSecond,
        cash: totals.cash,
        supplyAprPercent: Number.isFinite(supplyApr) ? +supplyApr.toFixed(2) : 0,
        borrowAprPercent: Number.isFinite(borrowApr) ? +borrowApr.toFixed(2) : 0
      },
      caps: {
        supplyCap: caps.supplyCap,
        borrowCap: caps.borrowCap,
        supplyHeadroom: caps.supplyHeadroom,
        borrowHeadroom: caps.borrowHeadroom
      },
      paused,
      loanToken: {
        address: PROTOCOL_CONFIG.loanToken.address,
        symbol: PROTOCOL_CONFIG.loanToken.symbol,
        decimals: PROTOCOL_CONFIG.loanToken.decimals
      },
      collateral: collateral.map((c) => ({
        address: c.address,
        symbol: c.symbol,
        name: c.name,
        decimals: c.decimals,
        correlationGroup: c.correlationGroup,
        price: c.price
      })),
      fetchedAt: Math.floor(Date.now() / 1000)
    };
  }

  // -------------------------------------------------------------------
  // Per-user lookup (powers /check.html)
  // -------------------------------------------------------------------

  public async getAddressCheck(address: string): Promise<{
    address: string;
    summary: {
      valueUsd: string;
      borrowLimitNow: string;
      borrowLimitWeekend: string;
      unlockableNow: string;
      unlockableWeekend: string;
      liquidatable: boolean;
    };
    rows: UnlockableRow[];
  }> {
    const normalized = normalizeAddress(address);
    const position = mockEngine.positionFor(normalized);
    const prices = mockEngine.oraclePrices();
    const priceMap = new Map(prices.map((p) => [p.address.toLowerCase(), p.price]));
    const positionDebt = bn(position.debt);

    const rows: UnlockableRow[] = [];
    let totalValue = 0n;
    let totalUnlockNow = 0n;
    let totalUnlockWeekend = 0n;

    for (const asset of prices) {
      const collateralEntry = position.collateral.find((c) => c.address === asset.address);
      const balance = bn(collateralEntry ? collateralEntry.walletBalance : '0');
      const price = bn(priceMap.get(asset.address.toLowerCase()) ?? '0');
      const value = (balance * price) / WAD;
      totalValue += value;

      const ltvNow = (value * 65n) / 100n;          // 65% LTV when market is open
      const ltvWeekend = (value * 45n) / 100n;      // 45% LTV over the weekend
      totalUnlockNow += ltvNow;
      totalUnlockWeekend += ltvWeekend;

      rows.push({
        address: asset.address,
        symbol: asset.symbol,
        name: asset.name,
        decimals: asset.decimals,
        balance: balance.toString(),
        price: price.toString(),
        value: value.toString(),
        ltvNow: ltvNow.toString(),
        ltvWeekend: ltvWeekend.toString(),
        unlockNow: ltvNow.toString(),
        unlockWeekend: ltvWeekend.toString()
      });
    }

    return {
      address: normalized,
      summary: {
        valueUsd: totalValue.toString(),
        borrowLimitNow: totalUnlockNow.toString(),
        borrowLimitWeekend: totalUnlockWeekend.toString(),
        unlockableNow: (totalUnlockNow > positionDebt ? (totalUnlockNow - positionDebt).toString() : '0'),
        unlockableWeekend: (totalUnlockWeekend > positionDebt ? (totalUnlockWeekend - positionDebt).toString() : '0'),
        liquidatable: position.liquidatable
      },
      rows
    };
  }

  // -------------------------------------------------------------------
  // Position view (account tab)
  // -------------------------------------------------------------------

  public async getUserPosition(address: string): Promise<UserPosition> {
    const normalized = normalizeAddress(address);
    const position = mockEngine.positionFor(normalized);
    const buffer = bn(position.buffer);
    const debt = bn(position.debt);
    const repayable = debt > 0n ? debt : 0n;

    return {
      address: normalized,
      supplyShares: position.supplyShares,
      supplyAssets: position.supplyAssets,
      debt: position.debt,
      borrowLimit: position.borrowLimit,
      liquidationLimit: position.liquidationLimit,
      collateralValue: position.collateralValue,
      liquidatable: position.liquidatable,
      buffer: position.buffer,
      plan: { leadSeconds: 3600, targetBps: 4000, enabled: true },
      deleverage: {
        repayable: repayable.toString(),
        due: repayable > 0n && buffer < repayable
      },
      collateral: position.collateral.map((c) => ({
        address: c.address,
        symbol: c.symbol,
        name: c.name,
        decimals: c.decimals,
        posted: c.posted,
        value: c.value,
        walletBalance: c.walletBalance,
        allowance: c.allowance
      })),
      walletLoanBalance: position.walletLoanBalance,
      loanAllowance: position.loanAllowance,
      fetchedAt: Math.floor(Date.now() / 1000)
    };
  }

  public async getLegacyPositions(_address: string): Promise<LegacyEntry[]> {
    return PROTOCOL_CONFIG.legacyDeployments.map((d) => ({
      label: d.label,
      pool: d.pool,
      oracle: d.oracle,
      note: d.note,
      shares: '0',
      supplyAssets: '0',
      debt: '0',
      collateralValue: '0',
      buffer: '0'
    }));
  }

  // -------------------------------------------------------------------
  // Calendar / market session
  // -------------------------------------------------------------------

  public async getCalendar(): Promise<CalendarStatus> {
    const now = Math.floor(Date.now() / 1000);
    const session = this.computeCurrentSession(now);
    const sessionName = ['Closed', 'Pre-market', 'Regular', 'Post-market'][session] ?? 'Closed';
    const secondsUntilOpen = session === 0 ? this.secondsUntilNextOpen(now) : 0n;

    return {
      currentSession: session,
      currentSessionName: sessionName,
      secondsUntilOpen: secondsUntilOpen.toString(),
      resolvedOpen: session === 2,
      now,
      weekendTimestamp: this.nextWeekendBoundary(now)
    };
  }

  private computeCurrentSession(nowSec: number): number {
    const d = new Date(nowSec * 1000);
    const day = d.getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return 0;
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    const preStart = 8 * 60;            // 08:00 UTC
    const regularStart = 13 * 60 + 30;  // 13:30 UTC
    const regularEnd = 20 * 60;         // 20:00 UTC
    const postEnd = 24 * 60;            // 24:00 UTC
    if (minutes >= preStart && minutes < regularStart) return 1;
    if (minutes >= regularStart && minutes < regularEnd) return 2;
    if (minutes >= regularEnd && minutes < postEnd) return 3;
    return 0;
  }

  private secondsUntilNextOpen(nowSec: number): bigint {
    const d = new Date(nowSec * 1000);
    const target = new Date(d);
    target.setUTCHours(13, 30, 0, 0);
    if (target.getTime() <= d.getTime()) target.setUTCDate(target.getUTCDate() + 1);
    return BigInt(Math.floor((target.getTime() - d.getTime()) / 1000));
  }

  private nextWeekendBoundary(nowSec: number): number {
    const d = new Date(nowSec * 1000);
    const day = d.getUTCDay();
    const daysToFriday = (5 - day + 7) % 7;
    const target = new Date(d);
    target.setUTCDate(d.getUTCDate() + daysToFriday);
    target.setUTCHours(20, 0, 0, 0);
    return Math.floor(target.getTime() / 1000);
  }

  // -------------------------------------------------------------------
  // Rebate
  // -------------------------------------------------------------------

  public async getRebate(address: string): Promise<RebateStatus> {
    const normalized = normalizeAddress(address);
    const r = mockEngine.rebateFor(normalized);
    const solvency = mockEngine.rebateSolvency();
    return {
      account: normalized,
      configured: true,
      supplied: r.supplied,
      acreBalance: r.acreBalance,
      pondBalance: r.acreBalance,
      tierIndex: r.tierIndex,
      rebateBps: r.rebateBps,
      pending: r.pending,
      banked: r.banked,
      solvency: { owed: solvency.owed, held: solvency.held, covered: solvency.covered },
      tiers: PROTOCOL_CONFIG.rebateTiers.map((t) => ({ name: t.name, minimum: t.minimum, bps: t.bps }))
    };
  }

  public async getRebateSolvency() {
    const s = mockEngine.rebateSolvency();
    return { owed: s.owed, held: s.held, covered: s.covered };
  }

  // -------------------------------------------------------------------
  // Outcome series
  // -------------------------------------------------------------------

  public async listSeries(): Promise<Series[]> {
    return mockEngine.series();
  }

  public async getSeriesById(id: number): Promise<Series | null> {
    return mockEngine.series().find((s) => s.id === id) ?? null;
  }

  // -------------------------------------------------------------------
  // Deposits / transfers
  // -------------------------------------------------------------------

  public getTransferAddresses(): TransferAddressSet {
    // Deterministic derived addresses. Mirrors the CREATE2-style
    // `depositAddressOf` / `withdrawAddressOf` / `repayAddressOf` selectors
    // without needing the chain: the deterministic seed is the router address.
    const router = PROTOCOL_CONFIG.contracts.depositRouter.slice(2);
    return {
      deposit: ('0x' + router.replace(/^.{4}/, 'd000')) as `0x${string}`,
      withdraw: ('0x' + router.replace(/^.{4}/, 'd001')) as `0x${string}`,
      repay: ('0x' + router.replace(/^.{4}/, 'd002')) as `0x${string}`,
      pendingWithdrawal: '0',
      pendingRepayment: '0'
    };
  }

  public async getTransferHoldings(address: string): Promise<TransferHoldings> {
    const normalized = normalizeAddress(address);
    const addresses = this.getTransferAddresses();
    const position = mockEngine.positionFor(normalized);

    const rowFor = (addr: string, expected: boolean): TransferRow => ({
      address: addr as `0x${string}`,
      symbol: PROTOCOL_CONFIG.loanToken.symbol,
      name: 'USDG',
      decimals: 6,
      kind: 'loan',
      amount: position.walletLoanBalance,
      expected
    });

    return {
      account: normalized,
      addresses,
      waiting: {
        deposit: [rowFor(addresses.deposit, true)],
        withdraw: [rowFor(addresses.withdraw, true)],
        repay: [rowFor(addresses.repay, true)]
      },
      totals: { waitingCount: 3, misplacedCount: 0 },
      fetchedAt: Math.floor(Date.now() / 1000)
    };
  }

  // -------------------------------------------------------------------
  // Watch / keeper
  // -------------------------------------------------------------------

  private readonly watchRegistry = new Map<string, { registeredAt: number; source: string }>();
  private readonly WATCH_TTL = 7 * 24 * 60 * 60;

  public async registerWatch(address: string, source = 'api') {
    const normalized = normalizeAddress(address);
    const registeredAt = Math.floor(Date.now() / 1000);
    this.watchRegistry.set(normalized, { registeredAt, source });
    return {
      address: normalized,
      registeredAt,
      expiresAt: registeredAt + this.WATCH_TTL,
      source
    };
  }

  public listWatchRegistrations() {
    return Array.from(this.watchRegistry.entries()).map(([address, v]) => ({
      address: address as `0x${string}`,
      registeredAt: v.registeredAt,
      expiresAt: v.registeredAt + this.WATCH_TTL,
      source: v.source
    }));
  }

  // -------------------------------------------------------------------
  // Deleverage preview
  // -------------------------------------------------------------------

  public async previewDeleverage(address: string, leadSeconds: number, targetBps: number) {
    const normalized = normalizeAddress(address);
    const position = mockEngine.positionFor(normalized);
    const liquidationLimit = bn(position.liquidationLimit);
    const targetDebt = (liquidationLimit * BigInt(targetBps)) / 10_000n;
    const debt = bn(position.debt);
    const repayable = debt > targetDebt ? debt - targetDebt : 0n;

    return {
      address: normalized,
      leadSeconds,
      targetBps,
      currentDebt: position.debt,
      liquidationLimit: position.liquidationLimit,
      targetDebt: targetDebt.toString(),
      repayable: repayable.toString(),
      buffer: position.buffer,
      hasFunds: bn(position.buffer) >= repayable,
      fetchedAt: Math.floor(Date.now() / 1000)
    };
  }
}

/** Default singleton service. */
export const acreService = new AcreService();
export const pondService = acreService;
export { AcreService as PondService };
