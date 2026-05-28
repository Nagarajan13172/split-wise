import { describe, expect, it } from 'vitest';
import {
  convert,
  convertToHomeCurrency,
  sumInHomeCurrency,
  toConvertedAmount,
  type FxTable,
} from '../src/logic/currency.js';

// Hand-built table: 1 EUR = 1.10 USD, 0.85 GBP, 90.00 INR
const TABLE: FxTable = {
  base: 'EUR',
  rates: { USD: '1.10', GBP: '0.85', INR: '90.00', EUR: '1' },
};

describe('convert', () => {
  it('returns the same amount when from === to', () => {
    expect(convert('10.00', 'USD', 'USD', TABLE).toFixed(2)).toBe('10.00');
  });

  it('converts base → quote', () => {
    expect(convert('10.00', 'EUR', 'USD', TABLE).toFixed(2)).toBe('11.00');
  });

  it('converts quote → base', () => {
    // 11 USD / 1.10 = 10 EUR
    expect(convert('11.00', 'USD', 'EUR', TABLE).toFixed(2)).toBe('10.00');
  });

  it('cross-converts quote → quote via base', () => {
    // 11 USD → 10 EUR → 8.50 GBP
    expect(convert('11.00', 'USD', 'GBP', TABLE).toFixed(2)).toBe('8.50');
  });

  it('throws when a rate is missing', () => {
    expect(() => convert('1', 'XYZ', 'USD', TABLE)).toThrow(/no FX rate/);
  });
});

describe('convertToHomeCurrency', () => {
  it('returns the same amount when currency matches home', () => {
    expect(convertToHomeCurrency('25.00', 'USD', 'USD', TABLE)!.toFixed(2)).toBe('25.00');
  });

  it('returns null when conversion fails', () => {
    expect(convertToHomeCurrency('10', 'XYZ', 'USD', TABLE)).toBeNull();
  });

  it('cross-converts to a non-base home currency', () => {
    // 100 INR → /90 EUR → *1.10 USD ≈ 1.22
    const r = convertToHomeCurrency('100.00', 'INR', 'USD', TABLE);
    expect(r!.toDecimalPlaces(2).toFixed(2)).toBe('1.22');
  });
});

describe('toConvertedAmount', () => {
  it('returns both native and home when conversion succeeds', () => {
    const r = toConvertedAmount('100.00', 'EUR', 'USD', TABLE);
    expect(r.native).toEqual({ amount: '100.00', currency: 'EUR' });
    expect(r.home).toEqual({ amount: '110.00', currency: 'USD' });
  });

  it('returns native-only when no FX table is provided', () => {
    const r = toConvertedAmount('100.00', 'EUR', 'USD', null);
    expect(r.native).toEqual({ amount: '100.00', currency: 'EUR' });
    expect(r.home).toBeNull();
  });

  it('returns native-only when the rate is missing', () => {
    const r = toConvertedAmount('100.00', 'XYZ', 'USD', TABLE);
    expect(r.home).toBeNull();
  });

  it('collapses native and home when currencies match', () => {
    const r = toConvertedAmount('50.00', 'USD', 'USD', TABLE);
    expect(r.native.currency).toBe('USD');
    expect(r.home).toEqual({ amount: '50.00', currency: 'USD' });
  });

  it('respects JPY zero-decimal currency formatting', () => {
    const table: FxTable = { base: 'EUR', rates: { JPY: '160.00', USD: '1.10' } };
    const r = toConvertedAmount('10.00', 'EUR', 'JPY', table);
    // 10 * 160 = 1600 — JPY has 0 decimals
    expect(r.home).toEqual({ amount: '1600', currency: 'JPY' });
  });
});

describe('sumInHomeCurrency', () => {
  it('sums mixed-currency entries to a single home total', () => {
    const r = sumInHomeCurrency(
      [
        { amount: '100.00', currency: 'USD' },
        { amount: '10.00', currency: 'EUR' }, // 11.00 USD
        { amount: '90.00', currency: 'INR' }, // 1.10 USD
      ],
      'USD',
      TABLE,
    );
    expect(r.skipped).toBe(0);
    expect(r.total.toDecimalPlaces(2).toFixed(2)).toBe('112.10');
  });

  it('skips entries with unknown rates and counts them', () => {
    const r = sumInHomeCurrency(
      [
        { amount: '10', currency: 'USD' },
        { amount: '5', currency: 'XYZ' },
      ],
      'USD',
      TABLE,
    );
    expect(r.skipped).toBe(1);
    expect(r.total.toFixed(2)).toBe('10.00');
  });

  it('skips all non-home entries when table is null', () => {
    const r = sumInHomeCurrency(
      [
        { amount: '10', currency: 'USD' },
        { amount: '20', currency: 'EUR' },
      ],
      'USD',
      null,
    );
    expect(r.skipped).toBe(1);
    expect(r.total.toFixed(2)).toBe('10.00');
  });
});
