import { describe, expect, it } from 'vitest';
import { sum } from '../src/utils/decimal.js';
import {
  splitByExactAmounts,
  splitByPercentage,
  splitByShares,
  splitEqually,
} from '../src/logic/splits.js';

const sumShares = (shares: ReadonlyArray<{ amount: string }>) =>
  sum(shares.map((s) => s.amount));

describe('splitEqually', () => {
  it('splits evenly when divisible', () => {
    const out = splitEqually({ total: '30.00', memberIds: ['a', 'b', 'c'] });
    expect(out.map((o) => o.amount)).toEqual(['10.00', '10.00', '10.00']);
  });

  it('distributes remainder cents to first members', () => {
    const out = splitEqually({ total: '10.00', memberIds: ['a', 'b', 'c'] });
    expect(out.map((o) => o.amount)).toEqual(['3.34', '3.33', '3.33']);
    expect(sumShares(out).toFixed(2)).toBe('10.00');
  });

  it('handles single member', () => {
    const out = splitEqually({ total: '7.25', memberIds: ['solo'] });
    expect(out).toEqual([{ userId: 'solo', amount: '7.25' }]);
  });

  it('throws on empty members', () => {
    expect(() => splitEqually({ total: '1', memberIds: [] })).toThrow();
  });
});

describe('splitByExactAmounts', () => {
  it('passes through when sum matches', () => {
    const out = splitByExactAmounts({
      total: '50.00',
      amountsByMember: [
        { userId: 'a', amount: '20.00' },
        { userId: 'b', amount: '30.00' },
      ],
    });
    expect(out).toEqual([
      { userId: 'a', amount: '20.00' },
      { userId: 'b', amount: '30.00' },
    ]);
  });

  it('throws when sum does not match total', () => {
    expect(() =>
      splitByExactAmounts({
        total: '50.00',
        amountsByMember: [
          { userId: 'a', amount: '20.00' },
          { userId: 'b', amount: '20.00' },
        ],
      }),
    ).toThrow(/must equal total/);
  });
});

describe('splitByShares', () => {
  it('distributes proportionally', () => {
    const out = splitByShares({
      total: '90.00',
      sharesByMember: [
        { userId: 'a', shares: '1' },
        { userId: 'b', shares: '2' },
      ],
    });
    expect(out.map((o) => o.amount)).toEqual(['30.00', '60.00']);
  });

  it('reconciles remainder cents on non-divisible splits', () => {
    const out = splitByShares({
      total: '10.00',
      sharesByMember: [
        { userId: 'a', shares: '1' },
        { userId: 'b', shares: '1' },
        { userId: 'c', shares: '1' },
      ],
    });
    expect(sumShares(out).toFixed(2)).toBe('10.00');
  });
});

describe('splitByPercentage', () => {
  it('validates percent sums to 100', () => {
    expect(() =>
      splitByPercentage({
        total: '100',
        percentsByMember: [
          { userId: 'a', percent: '40' },
          { userId: 'b', percent: '50' },
        ],
      }),
    ).toThrow(/must sum to 100/);
  });

  it('produces shares summing to total', () => {
    const out = splitByPercentage({
      total: '100',
      percentsByMember: [
        { userId: 'a', percent: '33.33' },
        { userId: 'b', percent: '33.33' },
        { userId: 'c', percent: '33.34' },
      ],
    });
    expect(sumShares(out).toFixed(2)).toBe('100.00');
  });
});
