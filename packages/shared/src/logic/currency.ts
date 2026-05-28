import { type Decimal, D, type DecimalLike } from '../utils/decimal.js';
import { getCurrency } from '../constants/currencies.js';

export interface FxRate {
  base: string;
  quote: string;
  rate: DecimalLike;
  asOf: string;
}

export interface FxTable {
  /** Single base currency (e.g., "EUR"); all stored rates are base→quote. */
  base: string;
  /** quote -> rate (base→quote) */
  rates: Record<string, DecimalLike>;
}

/** Convert via cross-rate through the table's base currency. */
export function convert(amount: DecimalLike, from: string, to: string, table: FxTable): Decimal {
  if (from === to) return D(amount);
  const amt = D(amount);
  if (from === table.base) {
    const r = table.rates[to];
    if (!r) throw new Error(`no FX rate for ${to}`);
    return amt.times(r);
  }
  if (to === table.base) {
    const r = table.rates[from];
    if (!r) throw new Error(`no FX rate for ${from}`);
    return amt.dividedBy(r);
  }
  const fromRate = table.rates[from];
  const toRate = table.rates[to];
  if (!fromRate || !toRate) throw new Error(`no FX rate for ${from} or ${to}`);
  return amt.dividedBy(fromRate).times(toRate);
}

/** Format an amount according to the currency's decimals + locale. Uses Intl. */
export function formatMoney(amount: DecimalLike, currency: string, locale = 'en-US'): string {
  const info = getCurrency(currency);
  const decimals = info?.decimals ?? 2;
  const n = D(amount).toDecimalPlaces(decimals).toNumber();
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Convert an amount to the user's home currency using a single FxTable. Returns
 * null if the conversion isn't possible (missing rate). Callers should fall
 * back to displaying the native amount alone.
 */
export function convertToHomeCurrency(
  amount: DecimalLike,
  from: string,
  homeCurrency: string,
  table: FxTable,
): Decimal | null {
  if (from === homeCurrency) return D(amount);
  try {
    return convert(amount, from, homeCurrency, table);
  } catch {
    return null;
  }
}

export interface ConvertedAmount {
  /** Original amount in its native currency, formatted to the currency's decimals. */
  native: { amount: string; currency: string };
  /** Same amount converted to the home currency, if a rate was available. */
  home: { amount: string; currency: string } | null;
}

/**
 * Per-display helper: package the native + home-currency view of a single
 * amount. Use this everywhere balances/totals render so the conversion is
 * computed exactly once per (amount, currency).
 */
export function toConvertedAmount(
  amount: DecimalLike,
  currency: string,
  homeCurrency: string,
  table: FxTable | null,
): ConvertedAmount {
  const native = { amount: D(amount).toFixed(getCurrency(currency)?.decimals ?? 2), currency };
  if (!table || currency === homeCurrency) {
    return { native, home: currency === homeCurrency ? { ...native, currency: homeCurrency } : null };
  }
  const homeAmount = convertToHomeCurrency(amount, currency, homeCurrency, table);
  if (homeAmount == null) return { native, home: null };
  const decimals = getCurrency(homeCurrency)?.decimals ?? 2;
  return {
    native,
    home: { amount: homeAmount.toDecimalPlaces(decimals).toFixed(decimals), currency: homeCurrency },
  };
}

/**
 * Aggregate a list of (amount, currency) into a single home-currency total.
 * Skips entries that can't be converted (no rate available) — caller can detect
 * partial coverage by comparing `skipped` to the input length.
 */
export function sumInHomeCurrency(
  entries: ReadonlyArray<{ amount: DecimalLike; currency: string }>,
  homeCurrency: string,
  table: FxTable | null,
): { total: Decimal; skipped: number } {
  let total = D(0);
  let skipped = 0;
  for (const e of entries) {
    if (e.currency === homeCurrency) {
      total = total.plus(e.amount);
      continue;
    }
    if (!table) {
      skipped += 1;
      continue;
    }
    const converted = convertToHomeCurrency(e.amount, e.currency, homeCurrency, table);
    if (converted == null) {
      skipped += 1;
      continue;
    }
    total = total.plus(converted);
  }
  return { total, skipped };
}
