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

/**
 * Property-based invariants for simplifyDebts. Hand-rolled deterministic-seed
 * RNG so failures reproduce, and we don't pull in fast-check just for this.
 *
 * Invariants checked on every generated scenario:
 *   1. After applying simplified edges, every user's net balance is zero.
 *   2. Per-currency, edges <= N-1 (a star or chain — never more).
 *   3. All edges have positive amount.
 *   4. Currencies are not mixed within an edge.
 */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomScenario(seed: number) {
  const rng = mulberry32(seed);
  const memberCount = 2 + Math.floor(rng() * 6); // 2..7
  const members = Array.from({ length: memberCount }, (_, i) => `u${i}`);
  const currencies = ['USD', 'EUR', 'INR'];
  const expenseCount = 1 + Math.floor(rng() * 10);
  const expenses: ExpenseEvent[] = [];
  for (let i = 0; i < expenseCount; i++) {
    const payer = members[Math.floor(rng() * memberCount)]!;
    const totalCents = 100 + Math.floor(rng() * 10_000); // $1..$100
    const total = (totalCents / 100).toFixed(2);
    // pick a random non-empty subset of members for the split
    const participantCount = 1 + Math.floor(rng() * memberCount);
    const shuffled = [...members].sort(() => rng() - 0.5);
    const participants = shuffled.slice(0, participantCount);
    // equal split with remainder cents on first members
    const base = Math.floor(totalCents / participantCount);
    const remainder = totalCents - base * participantCount;
    const shares = participants.map((userId, idx) => ({
      userId,
      amount: ((base + (idx < remainder ? 1 : 0)) / 100).toFixed(2),
    }));
    expenses.push({
      paidById: payer,
      amount: total,
      currency: currencies[Math.floor(rng() * currencies.length)]!,
      shares,
    });
  }
  return { members, expenses };
}

describe('simplifyDebts — property invariants', () => {
  for (let seed = 1; seed <= 30; seed++) {
    it(`random scenario seed=${seed} satisfies all invariants`, () => {
      const { members, expenses } = randomScenario(seed);
      const nets = computeNetBalances(expenses, []);
      const edges = simplifyDebts(expenses, []);

      // (1) net balance preserved (i.e. zeroed after applying edges)
      const reconstructed = new Map<string, ReturnType<typeof D>>();
      const bump = (k: string, v: ReturnType<typeof D>) =>
        reconstructed.set(k, (reconstructed.get(k) ?? ZERO).plus(v));
      for (const e of edges) {
        bump(`${e.currency}:${e.fromUserId}`, e.amount);
        bump(`${e.currency}:${e.toUserId}`, e.amount.negated());
      }
      for (const [key, net] of nets.entries()) {
        const offset = reconstructed.get(key) ?? ZERO;
        expect(net.plus(offset).toFixed(2)).toBe('0.00');
      }

      // (2) per-currency edge count <= N-1
      const edgesByCcy = new Map<string, number>();
      for (const e of edges) edgesByCcy.set(e.currency, (edgesByCcy.get(e.currency) ?? 0) + 1);
      for (const [, count] of edgesByCcy) {
        expect(count).toBeLessThanOrEqual(members.length - 1);
      }

      // (3) positive amounts
      for (const e of edges) {
        expect(e.amount.greaterThan(0)).toBe(true);
      }

      // (4) sanity: never edge to self
      for (const e of edges) {
        expect(e.fromUserId).not.toBe(e.toUserId);
      }
    });
  }

  it('idempotent: simplifying already-simplified edges produces same edges', () => {
    const { expenses } = randomScenario(42);
    const edges1 = simplifyDebts(expenses, []);
    // synthesize "expenses" from the edges so we can re-simplify
    const synthetic: ExpenseEvent[] = edges1.map((e) => ({
      paidById: e.toUserId,
      amount: e.amount.toFixed(2),
      currency: e.currency,
      shares: [{ userId: e.fromUserId, amount: e.amount.toFixed(2) }],
    }));
    const edges2 = simplifyDebts(synthetic, []);
    expect(edges2.length).toBe(edges1.length);
    const norm = (e: { currency: string; fromUserId: string; toUserId: string; amount: { toFixed: (n: number) => string } }) =>
      `${e.currency}|${e.fromUserId}|${e.toUserId}|${e.amount.toFixed(2)}`;
    expect(new Set(edges2.map(norm))).toEqual(new Set(edges1.map(norm)));
  });
});
