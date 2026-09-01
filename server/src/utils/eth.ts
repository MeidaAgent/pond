/**
 * Lightweight Ethereum address + decimal helpers.
 *
 * The frontend has the same helpers embedded; this is a port that uses the same
 * exact rules so an address passing one validator passes the other.
 */

export function isHexAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normalizeAddress(value: string): `0x${string}` {
  if (!isHexAddress(value)) {
    throw new Error(`Invalid Ethereum address: ${value}`);
  }
  return value.toLowerCase() as `0x${string}`;
}

/** Convert a decimal string to a base-units BigInt, never using floating point. */
export function parseUnits(value: string, decimals: number): bigint {
  const text = String(value).trim();
  if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') {
    throw new Error('not a number');
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error('too many decimal places');
  const padded = fraction.padEnd(decimals, '0');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

/** Format a base-units BigInt into a human decimal string. */
export function formatUnits(value: bigint, decimals: number, places = 4): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  let fractionText = fraction.toString().padStart(decimals, '0').slice(0, places);
  fractionText = fractionText.replace(/0+$/, '');
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + wholeText + (fractionText ? '.' + fractionText : '');
}

/** Convert a per-second WAD rate into a compounded annual percentage. */
export function annualisedPercent(ratePerSecond: bigint): number {
  const r = Number(ratePerSecond) / 1e18;
  if (!isFinite(r) || r <= 0) return 0;
  const annual = Math.pow(1 + r, 31_536_000) - 1;
  return isFinite(annual) ? annual * 100 : 0;
}

/** Cheap deterministic mock price oracle, used when no real chain is available. */
export function mockPriceUsd(symbol: string): bigint {
  // WAD dollars (1e18 = $1)
  switch (symbol) {
    case 'AAPL':  return 200n * 10n ** 18n;
    case 'MSFT':  return 410n * 10n ** 18n;
    case 'GOOGL': return 170n * 10n ** 18n;
    case 'AMZN':  return 190n * 10n ** 18n;
    case 'META':  return 500n * 10n ** 18n;
    case 'NVDA':  return 120n * 10n ** 18n;
    case 'TSLA':  return 250n * 10n ** 18n;
    case 'SPCX':  return 230n * 10n ** 18n;
    default:      return 1n * 10n ** 18n;
  }
}

export function toBigIntString(value: bigint | number | string): string {
  return BigInt(value).toString();
}
