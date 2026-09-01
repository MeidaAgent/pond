/**
 * Domain types describing the shape of API responses.
 *
 * Most numbers are returned as `string` because the underlying values are
 * 256-bit unsigned integers that exceed JavaScript's safe number range.
 * The frontend's `WAD = 10^18` convention is preserved so callers can compare
 * to the same constants the contracts use.
 */

export type HexAddress = `0x${string}` | string;
export type BigIntString = string;

export interface PoolTotals {
  supplied: BigIntString;
  borrowed: BigIntString;
  utilization: BigIntString;
  borrowRatePerSecond: BigIntString;
  cash: BigIntString;
  supplyAprPercent: number;
  borrowAprPercent: number;
}

export interface PoolCaps {
  supplyCap: BigIntString;
  borrowCap: BigIntString;
  supplyHeadroom: BigIntString;
  borrowHeadroom: BigIntString;
}

export interface PoolPaused {
  supply: boolean;
  borrow: boolean;
}

export interface PoolOverview {
  totals: PoolTotals;
  caps: PoolCaps;
  paused: PoolPaused;
  loanToken: { address: HexAddress; symbol: string; decimals: number };
  collateral: Array<{
    address: HexAddress;
    symbol: string;
    name: string;
    decimals: number;
    correlationGroup: number;
    price: BigIntString;
  }>;
  fetchedAt: number;
}

export interface UserPosition {
  address: HexAddress;
  supplyShares: BigIntString;
  supplyAssets: BigIntString;
  debt: BigIntString;
  borrowLimit: BigIntString;
  liquidationLimit: BigIntString;
  collateralValue: BigIntString;
  liquidatable: boolean;
  buffer: BigIntString;
  plan: { leadSeconds: number; targetBps: number; enabled: boolean } | null;
  deleverage: { repayable: BigIntString; due: boolean };
  collateral: Array<{
    address: HexAddress;
    symbol: string;
    name: string;
    decimals: number;
    posted: BigIntString;
    value: BigIntString;
    walletBalance: BigIntString;
    allowance: BigIntString;
  }>;
  walletLoanBalance: BigIntString;
  loanAllowance: BigIntString;
  fetchedAt: number;
}

export interface UnlockableRow {
  address: HexAddress;
  symbol: string;
  name: string;
  decimals: number;
  balance: BigIntString;
  price: BigIntString;
  value: BigIntString;
  ltvNow: BigIntString;
  ltvWeekend: BigIntString;
  unlockNow: BigIntString;
  unlockWeekend: BigIntString;
}

export interface CalendarStatus {
  currentSession: number;       // 0 = closed, 1 = pre, 2 = regular, 3 = post
  currentSessionName: string;
  secondsUntilOpen: BigIntString;
  resolvedOpen: boolean;
  now: number;                 // unix seconds
  weekendTimestamp: number;
}

export interface RebateStatus {
  account: HexAddress;
  configured: boolean;
  supplied: BigIntString;
  acreBalance: BigIntString;
  pondBalance?: BigIntString;
  tierIndex: number;
  rebateBps: number;
  pending: BigIntString;
  banked: BigIntString;
  solvency: { owed: BigIntString; held: BigIntString; covered: boolean } | null;
  tiers: Array<{ name: string; minimum: string; bps: number }>;
}

export interface Series {
  id: number;
  asset: HexAddress;
  assetSymbol: string;
  subscriptionEnd: number;
  expiry: number;
  strike: BigIntString;
  sellerCollateral: BigIntString;
  unitsSold: BigIntString;
  premiumCollected: BigIntString;
  settlementPrice: BigIntString;
  status: string;
  availableUnits: BigIntString;
  premiumPerUnit: BigIntString;
}

export interface TransferAddressSet {
  deposit: HexAddress;
  withdraw: HexAddress;
  repay: HexAddress;
  pendingWithdrawal: BigIntString;
  pendingRepayment: BigIntString;
}

export interface TransferHoldings {
  account: HexAddress;
  addresses: { deposit: HexAddress; withdraw: HexAddress; repay: HexAddress };
  waiting: {
    deposit: TransferRow[];
    withdraw: TransferRow[];
    repay: TransferRow[];
  };
  totals: { waitingCount: number; misplacedCount: number };
  fetchedAt: number;
}

export interface TransferRow {
  address: HexAddress;
  symbol: string;
  name: string;
  decimals: number;
  kind: 'loan' | 'collateral' | 'shares';
  amount: BigIntString;
  expected: boolean;
}

export interface LegacyEntry {
  label: string;
  pool: HexAddress;
  oracle?: HexAddress;
  note: string;
  shares: BigIntString;
  supplyAssets: BigIntString;
  debt: BigIntString;
  collateralValue: BigIntString;
  buffer: BigIntString;
}

export interface WatchRegistration {
  address: HexAddress;
  registeredAt: number;
  expiresAt: number;
  source: string;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
