import { describe, expect, it } from 'vitest';
import { D, sum } from '../src/utils/decimal.js';
import { computeItemizedSplit } from '../src/logic/itemized.js';

const sumPerUser = (perUser: ReadonlyArray<{ amount: string }>) =>
  sum(perUser.map((u) => u.amount));

describe('computeItemizedSplit', () => {
  it('splits a single item among assignees and rolls up per user', () => {
    const r = computeItemizedSplit({
      items: [{ label: 'Pizza', amount: '20.00', assigneeIds: ['a', 'b'] }],
    });
    expect(r.subtotal).toBe('20.00');
    expect(r.total).toBe('20.00');
    expect(r.perItem[0]!.shares).toEqual([
      { userId: 'a', amount: '10.00' },
      { userId: 'b', amount: '10.00' },
    ]);
    expect(r.perUser).toEqual([
      { userId: 'a', amount: '10.00' },
      { userId: 'b', amount: '10.00' },
    ]);
  });

  it('reconciles remainder cents within an item deterministically', () => {
    const r = computeItemizedSplit({
      items: [{ label: 'Cake', amount: '10.00', assigneeIds: ['a', 'b', 'c'] }],
    });
    expect(r.perItem[0]!.shares.map((s) => s.amount)).toEqual(['3.34', '3.33', '3.33']);
    expect(sumPerUser(r.perUser).toFixed(2)).toBe('10.00');
  });

  it('distributes tax pro-rata by user subtotal', () => {
    // a's items: 30, b's items: 70 → total 100. Tax 10 → a gets 3.00, b gets 7.00.
    const r = computeItemizedSplit({
      items: [
        { label: 'Salad', amount: '30.00', assigneeIds: ['a'] },
        { label: 'Steak', amount: '70.00', assigneeIds: ['b'] },
      ],
      tax: '10.00',
    });
    expect(r.subtotal).toBe('100.00');
    expect(r.total).toBe('110.00');
    const aTotal = r.perUser.find((u) => u.userId === 'a')!.amount;
    const bTotal = r.perUser.find((u) => u.userId === 'b')!.amount;
    expect(aTotal).toBe('33.00');
    expect(bTotal).toBe('77.00');
    expect(sumPerUser(r.perUser).toFixed(2)).toBe('110.00');
  });

  it('distributes tip equally when configured', () => {
    const r = computeItemizedSplit({
      items: [
        { label: 'Salad', amount: '30.00', assigneeIds: ['a'] },
        { label: 'Steak', amount: '70.00', assigneeIds: ['b'] },
      ],
      tip: '15.00',
      tipDistribution: 'EQUAL',
    });
    const a = r.perUser.find((u) => u.userId === 'a')!.amount;
    const b = r.perUser.find((u) => u.userId === 'b')!.amount;
    // tip 15 split equally → 7.50 each. a: 30 + 7.50 = 37.50. b: 70 + 7.50 = 77.50.
    expect(a).toBe('37.50');
    expect(b).toBe('77.50');
    expect(sumPerUser(r.perUser).toFixed(2)).toBe('115.00');
  });

  it('distributes tip pro-rata by default', () => {
    const r = computeItemizedSplit({
      items: [
        { label: 'Salad', amount: '30.00', assigneeIds: ['a'] },
        { label: 'Steak', amount: '70.00', assigneeIds: ['b'] },
      ],
      tip: '15.00',
    });
    const a = r.perUser.find((u) => u.userId === 'a')!.amount;
    const b = r.perUser.find((u) => u.userId === 'b')!.amount;
    // pro-rata tip: a 30/100 * 15 = 4.50, b 70/100 * 15 = 10.50.
    expect(a).toBe('34.50');
    expect(b).toBe('80.50');
  });

  it('per-user totals always sum to subtotal+tax+tip', () => {
    const r = computeItemizedSplit({
      items: [
        { label: 'A', amount: '12.33', assigneeIds: ['a', 'b'] },
        { label: 'B', amount: '7.77', assigneeIds: ['b', 'c'] },
        { label: 'C', amount: '4.99', assigneeIds: ['a', 'c', 'd'] },
      ],
      tax: '2.13',
      tip: '4.27',
    });
    const expected = D(r.subtotal).plus('2.13').plus('4.27');
    expect(sumPerUser(r.perUser).toFixed(2)).toBe(expected.toFixed(2));
  });

  it('throws on item with no assignees', () => {
    expect(() =>
      computeItemizedSplit({
        items: [{ label: 'orphan', amount: '5', assigneeIds: [] }],
      }),
    ).toThrow(/no assignees/);
  });

  it('handles shared items across all members evenly', () => {
    const r = computeItemizedSplit({
      items: [
        { label: 'Wine', amount: '60.00', assigneeIds: ['a', 'b', 'c'] },
        { label: 'Bread', amount: '9.00', assigneeIds: ['a', 'b', 'c'] },
      ],
    });
    expect(r.subtotal).toBe('69.00');
    expect(sumPerUser(r.perUser).toFixed(2)).toBe('69.00');
    // each user should get exactly 23.00
    for (const u of r.perUser) expect(u.amount).toBe('23.00');
  });
});
