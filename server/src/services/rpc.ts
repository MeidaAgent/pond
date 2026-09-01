/**
 * Lightweight JSON-RPC client + deterministic mock engine.
 *
 * Designed for read-only call patterns. Falls back to the mock engine when no
 * RPC is configured or the configured endpoint is unreachable. The mock is
 * deterministic so tests and offline development are stable.
 */

import { PROTOCOL_CONFIG } from '../config/protocol';
import { mockPriceUsd } from '../utils/eth';

export interface RpcClientOptions {
  rpcUrl?: string;
  allowMock?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class RpcError extends Error {
  public readonly code: number;
  public readonly data?: unknown;
  constructor(message: string, code = -32000, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let rpcId = 0;

export class RpcClient {
  private readonly url: string;
  private readonly allowMock: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RpcClientOptions = {}) {
    this.url = (opts.rpcUrl || process.env.RPC_URL || PROTOCOL_CONFIG.rpcUrl || '').trim();
    this.allowMock = opts.allowMock ?? (process.env.ALLOW_MOCK || 'true').toLowerCase() !== 'false';
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  public get isMock(): boolean {
    return !this.url;
  }

  /** Single JSON-RPC call against the configured endpoint. */
  public async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.url) {
      throw new RpcError('No RPC endpoint configured', -32010);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new RpcError(`RPC HTTP ${res.status}`, -32020);
      }

      const body = (await res.json()) as JsonRpcResponse<T>;
      if (body.error) {
        throw new RpcError(body.error.message || 'RPC error', body.error.code, body.error.data);
      }
      if (typeof body.result === 'undefined') {
        throw new RpcError('RPC returned no result', -32021);
      }
      return body.result;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new RpcError(`RPC transport failure: ${message}`, -32030);
    } finally {
      clearTimeout(timer);
    }
  }

  /** True if the RPC is configured and reachable. */
  public async ping(): Promise<boolean> {
    if (this.isMock) return this.allowMock;
    try {
      await this.call<string>('eth_chainId');
      return true;
    } catch {
      return false;
    }
  }
}

function n(v: bigint): string {
  return v.toString();
}

/**
 * In-process mock engine.
 *
 * Mirrors the same interface the RpcClient exposes for read calls, but produces
 * deterministic data instead of round-tripping to the network. Powers the
 * /check, /positions, /pool/stats and /series endpoints in dev mode.
 *
 * All numeric outputs are returned as base-unit `string` (decimals preserved),
 * matching the BigIntString convention used across the domain types and the
 * on-chain contract returns.
 */
export class MockEngine {
  public readonly chainId: number = PROTOCOL_CONFIG.chainId;
  public readonly chainName: string = PROTOCOL_CONFIG.chainName;

  /** Returns the (mocked) current pool totals. */
  public poolTotals() {
    return {
      supplied:         n(12_500_000n * 10n ** 6n),         // 12.5M USDG
      borrowed:         n(4_750_000n * 10n ** 6n),           //  4.75M USDG
      utilization:          n(380_000_000_000_000_000n),     // 38% in WAD
      borrowRatePerSecond:    n(1_200_000_000_000n),         // ~3.9% APR
      cash:             n(7_750_000n * 10n ** 6n)
    };
  }

  public poolCaps() {
    return {
      supplyCap:       n(25_000_000n * 10n ** 6n),
      borrowCap:       n(20_000_000n * 10n ** 6n),
      supplyHeadroom:  n(12_500_000n * 10n ** 6n),
      borrowHeadroom:  n(15_250_000n * 10n ** 6n)
    };
  }

  public poolPaused() {
    return { supply: false, borrow: false };
  }

  public oraclePrices() {
    return PROTOCOL_CONFIG.collateral.map((asset) => ({
      address: asset.address,
      symbol: asset.symbol,
      name: asset.name ?? asset.symbol,
      decimals: asset.decimals,
      correlationGroup: asset.correlationGroup,
      price: n(mockPriceUsd(asset.symbol))
    }));
  }

  /** A small, fully deterministic borrow-limit and position simulation per address. */
  public positionFor(address: string) {
    const hashSeed = BigInt('0x' + (address.slice(2).padStart(8, '0').slice(-8)));
    const mod = (val: bigint, m: bigint) => ((val % m) + m) % m;

    const supplyShares = mod(hashSeed, 5_000n) + 50n;
    const supplyAssets = supplyShares * 10n ** 18n; // 1:1 in the mock
    const debt = (mod(hashSeed, 1_500n) + 100n) * 10n ** 6n;
    const borrowLimit = supplyAssets * 7n / 10n;     // 70% LTV
    const liquidationLimit = supplyAssets * 8n / 10n;
    const collateralValue = supplyAssets;
    const liquidatable = debt > liquidationLimit;

    return {
      supplyShares: n(supplyShares * 10n ** 18n),
      supplyAssets: n(supplyAssets),
      debt: n(debt),
      borrowLimit: n(borrowLimit),
      liquidationLimit: n(liquidationLimit),
      collateralValue: n(collateralValue),
      liquidatable,
      buffer: n((mod(hashSeed, 50n) + 5n) * 10n ** 6n),
      walletLoanBalance: n((mod(hashSeed, 800n) + 50n) * 10n ** 6n),
      loanAllowance: n((mod(hashSeed, 2_000n) + 100n) * 10n ** 6n),
      collateral: PROTOCOL_CONFIG.collateral.map((asset) => ({
        address: asset.address,
        symbol: asset.symbol,
        name: asset.name ?? asset.symbol,
        decimals: asset.decimals,
        posted: '0',
        value: '0',
        walletBalance: n((mod(hashSeed, 1_000n) + 1n) * 10n ** BigInt(asset.decimals)),
        allowance: '0'
      }))
    };
  }

  public rebateFor(address: string) {
    const hashSeed = BigInt('0x' + (address.slice(2).padStart(8, '0').slice(-8)));
    const mod = (val: bigint, m: bigint) => ((val % m) + m) % m;
    const pondBalance = mod(hashSeed, 30_000_000n);
    const acreBalance = pondBalance;
    let tierIndex = PROTOCOL_CONFIG.rebateTiers.length; // "none" by default
    for (let i = 0; i < PROTOCOL_CONFIG.rebateTiers.length; i++) {
      if (pondBalance >= BigInt(PROTOCOL_CONFIG.rebateTiers[i].minimum)) {
        tierIndex = i;
      }
    }
    return {
      supplied: n(mod(hashSeed, 1_000n) * 10n ** 6n),
      acreBalance: n(acreBalance * 10n ** 18n),
      pondBalance: n(pondBalance * 10n ** 18n),
      tierIndex,
      rebateBps: tierIndex < PROTOCOL_CONFIG.rebateTiers.length
        ? PROTOCOL_CONFIG.rebateTiers[tierIndex].bps
        : 0,
      pending: n(mod(hashSeed, 25n) * 10n ** 6n),
      banked: n(mod(hashSeed, 50n) * 10n ** 6n)
    };
  }

  public series() {
    const now = Math.floor(Date.now() / 1000);
    const oneWeek = 7 * 24 * 60 * 60;
    return PROTOCOL_CONFIG.collateral.slice(0, 4).map((asset, i) => {
      const id = i + 1;
      const strike = mockPriceUsd(asset.symbol);
      const strikeStr = n(strike);
      return {
        id,
        asset: asset.address,
        assetSymbol: asset.symbol,
        subscriptionEnd: now + 3 * 24 * 60 * 60,
        expiry: now + oneWeek,
        strike: strikeStr,
        sellerCollateral: n(strike * 5n),
        unitsSold: n(100n * 10n ** 18n),
        premiumCollected: n((strike / 50n) * 100n),
        settlementPrice: '0',
        status: 'Open',
        availableUnits: n(900n * 10n ** 18n),
        premiumPerUnit: n(strike / 50n)
      };
    });
  }

  public rebateSolvency() {
    return { owed: n(12_345n * 10n ** 18n), held: n(12_345n * 10n ** 18n), covered: true };
  }
}

/** Default singleton mock engine. */
export const mockEngine = new MockEngine();
