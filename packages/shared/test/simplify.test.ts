import { describe, expect, it } from 'vitest';
import { D, sum, ZERO } from '../src/utils/decimal.js';
import { simplifyDebts } from '../src/logic/simplify.js';
import { computeNetBalances, type ExpenseEvent } from '../src/logic/balances.js';

const ev = (
  paidById: string,
  amount: string,
  currency: string,
  shares: Array<[string, string]>,
): ExpenseEvent => ({
  paidById,
  amount,
  currency,
  shares: shares.map(([userId, amt]) => ({ userId, amount: amt })),
});

describe('simplifyDebts', () => {
  it('returns empty edges when everyone is even', () => {
    const out = simplifyDebts(
      [
        ev('a', '30', 'USD', [
          ['a', '10'],
          ['b', '10'],
          ['c', '10'],
        ]),
        ev('b', '30', 'USD', [
          ['a', '10'],
          ['b', '10'],
          ['c', '10'],
        ]),
        ev('c', '30', 'USD', [
          ['a', '10'],
          ['b', '10'],
          ['c', '10'],
        ]),
      ],
      [],
    );
    expect(out).toEqual([]);
  });

  it('preserves each member’s net balance', () => {
    const expenses = [
      ev('a', '100', 'USD', [
        ['a', '25'],
        ['b', '25'],
        ['c', '25'],
        ['d', '25'],
      ]),
      ev('b', '40', 'USD', [
        ['c', '20'],
        ['d', '20'],
      ]),
    ];
    const nets = computeNetBalances(expenses, []);
    const edges = simplifyDebts(expenses, []);

    // recompute nets from edges and verify they match
    const reconstructed = new Map<string, ReturnType<typeof D>>();
    const bump = (k: string, v: ReturnType<typeof D>) =>
      reconstructed.set(k, (reconstructed.get(k) ?? ZERO).plus(v));
    for (const e of edges) {
      bump(`${e.currency}:${e.fromUserId}`, e.amount); // settling debt increases from balance
      bump(`${e.currency}:${e.toUserId}`, e.amount.negated());
    }
    for (const [k, expected] of nets.entries()) {
      const got = reconstructed.get(k) ?? ZERO;
      // after applying simplified edges, nets should be zero
      expect(expected.plus(got).toFixed(2)).toBe('0.00');
    }
  });

  it('emits at most N-1 edges per currency', () => {
    const expenses = [
      ev('a', '60', 'USD', [
        ['b', '20'],
        ['c', '20'],
        ['d', '20'],
      ]),
      ev('b', '90', 'USD', [
        ['c', '30'],
        ['d', '30'],
        ['e', '30'],
      ]),
    ];
    const edges = simplifyDebts(expenses, []);
    // 5 users → at most 4 edges
    expect(edges.length).toBeLessThanOrEqual(4);
  });

  it('keeps currencies separate', () => {
    const expenses = [
      ev('a', '50', 'USD', [['b', '50']]),
      ev('b', '50', 'EUR', [['a', '50']]),
    ];
    const edges = simplifyDebts(expenses, []);
    const currencies = new Set(edges.map((e) => e.currency));
    expect(currencies).toEqual(new Set(['USD', 'EUR']));
  });
});
