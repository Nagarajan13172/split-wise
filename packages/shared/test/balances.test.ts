import { describe, expect, it } from 'vitest';
import {
  computeNetBalances,
  computePairwiseBalances,
  type ExpenseEvent,
  type SettlementEvent,
} from '../src/logic/balances.js';

describe('computeNetBalances', () => {
  it('credits the payer and debits each share', () => {
    const expenses: ExpenseEvent[] = [
      {
        paidById: 'alice',
        amount: '30',
        currency: 'USD',
        shares: [
          { userId: 'alice', amount: '10' },
          { userId: 'bob', amount: '10' },
          { userId: 'carol', amount: '10' },
        ],
      },
    ];
    const nets = computeNetBalances(expenses, []);
    expect(nets.get('USD:alice')?.toString()).toBe('20'); // paid 30, owes 10
    expect(nets.get('USD:bob')?.toString()).toBe('-10');
    expect(nets.get('USD:carol')?.toString()).toBe('-10');
  });

  it('applies settlements: from-user balance increases, to-user decreases', () => {
    const settlements: SettlementEvent[] = [
      { fromUserId: 'bob', toUserId: 'alice', amount: '10', currency: 'USD' },
    ];
    const nets = computeNetBalances([], settlements);
    expect(nets.get('USD:bob')?.toString()).toBe('10'); // paid back, so debt decreased
    expect(nets.get('USD:alice')?.toString()).toBe('-10');
  });

  it('keeps currencies separate', () => {
    const expenses: ExpenseEvent[] = [
      {
        paidById: 'alice',
        amount: '20',
        currency: 'USD',
        shares: [{ userId: 'bob', amount: '20' }],
      },
      {
        paidById: 'bob',
        amount: '50',
        currency: 'EUR',
        shares: [{ userId: 'alice', amount: '50' }],
      },
    ];
    const nets = computeNetBalances(expenses, []);
    expect(nets.get('USD:alice')?.toString()).toBe('20');
    expect(nets.get('EUR:alice')?.toString()).toBe('-50');
  });
});

describe('computePairwiseBalances', () => {
  it('produces a single edge per pair per currency', () => {
    const expenses: ExpenseEvent[] = [
      {
        paidById: 'alice',
        amount: '30',
        currency: 'USD',
        shares: [
          { userId: 'alice', amount: '10' },
          { userId: 'bob', amount: '20' },
        ],
      },
    ];
    const edges = computePairwiseBalances(expenses, []);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ currency: 'USD', fromUserId: 'bob', toUserId: 'alice' });
    expect(edges[0]!.amount.toString()).toBe('20');
  });

  it('settles a debt to zero', () => {
    const expenses: ExpenseEvent[] = [
      {
        paidById: 'alice',
        amount: '20',
        currency: 'USD',
        shares: [{ userId: 'bob', amount: '20' }],
      },
    ];
    const settlements: SettlementEvent[] = [
      { fromUserId: 'bob', toUserId: 'alice', amount: '20', currency: 'USD' },
    ];
    expect(computePairwiseBalances(expenses, settlements)).toEqual([]);
  });
});
