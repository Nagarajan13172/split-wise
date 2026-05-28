import { describe, it, expect } from 'vitest';
import { parseReceipt } from './receipt-parser.js';

const STUB_RESTAURANT = `Trattoria Luigi
123 Main Street
2026-04-12 19:42

Margherita Pizza       18.50
Caesar Salad            12.00
Tiramisu                 8.50
Sparkling Water  x2      6.00

Subtotal                45.00
Tax                      3.94
Tip                      8.00
Total                   56.94

Thank you!
`;

const STUB_GROCERY = `Whole Foods Market
Apples                4.99
Bread                 3.50
Milk x 2              6.00
Subtotal             14.49
Tax                   1.16
TOTAL                15.65
Cash                 20.00
Change                4.35
`;

const STUB_NO_TOTAL = `Cafe Beans
Coffee  4.25
Muffin  3.50
`;

const EU_FORMAT = `Café Paris
Croissant       3,50
Espresso        2,80
Tarte Tatin     6,90
Total          13,20
`;

describe('parseReceipt', () => {
  it('extracts merchant, items, totals from a restaurant receipt', () => {
    const r = parseReceipt(STUB_RESTAURANT);
    expect(r.merchant).toBe('Trattoria Luigi');
    expect(r.items.map((i) => [i.label, i.amount, i.quantity])).toEqual([
      ['Margherita Pizza', '18.50', 1],
      ['Caesar Salad', '12.00', 1],
      ['Tiramisu', '8.50', 1],
      ['Sparkling Water', '6.00', 2],
    ]);
    expect(r.subtotal).toBe('45.00');
    expect(r.tax).toBe('3.94');
    expect(r.tip).toBe('8.00');
    expect(r.total).toBe('56.94');
    expect(r.warnings).toEqual([]);
  });

  it('skips noise lines (cash / change / etc.)', () => {
    const r = parseReceipt(STUB_GROCERY);
    expect(r.items.map((i) => i.label)).toEqual(['Apples', 'Bread', 'Milk']);
    expect(r.items.find((i) => i.label === 'Milk')?.quantity).toBe(2);
    expect(r.total).toBe('15.65');
    expect(r.subtotal).toBe('14.49');
    expect(r.tax).toBe('1.16');
  });

  it('falls back to summing items when no explicit total is present', () => {
    const r = parseReceipt(STUB_NO_TOTAL);
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe('7.75');
    expect(r.warnings.some((w) => /inferred/i.test(w))).toBe(true);
  });

  it('handles european decimal-comma format', () => {
    const r = parseReceipt(EU_FORMAT);
    expect(r.items.map((i) => i.amount)).toEqual(['3.50', '2.80', '6.90']);
    expect(r.total).toBe('13.20');
  });

  it('emits a warning when items do not sum near subtotal', () => {
    const text = `Shop
A   10.00
B   10.00
Subtotal 50.00
Total    50.00`;
    const r = parseReceipt(text);
    expect(r.warnings.some((w) => /differs from subtotal/.test(w))).toBe(true);
  });

  it('returns an empty result for blank text', () => {
    const r = parseReceipt('   \n   \n');
    expect(r.items).toEqual([]);
    expect(r.total).toBe('0.00');
  });

  it('detects currency from a $ symbol', () => {
    const r = parseReceipt(`Shop\nThing  $4.99\nTotal $4.99\n`);
    expect(r.currency).toBe('USD');
  });

  it('detects currency from an explicit code', () => {
    const r = parseReceipt(`Shop EUR\nThing  4.99\nTotal 4.99\n`);
    expect(r.currency).toBe('EUR');
  });
});
