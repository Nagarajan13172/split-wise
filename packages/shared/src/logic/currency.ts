import { Decimal, D, type DecimalLike } from '../utils/decimal.js';
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
