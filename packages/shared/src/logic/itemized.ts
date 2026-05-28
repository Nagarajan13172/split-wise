import { Decimal, D, ZERO, type DecimalLike } from '../utils/decimal.js';

export interface ItemizedComputeItem {
  /** Application-stable identifier (cuid in real use; any string in tests). */
  id?: string;
  label: string;
  amount: DecimalLike;
  quantity?: number;
  assigneeIds: readonly string[];
}

export interface ItemizedComputeInput {
  items: readonly ItemizedComputeItem[];
  tax?: DecimalLike;
  tip?: DecimalLike;
  tipDistribution?: 'PRO_RATA' | 'EQUAL';
}

export interface ItemizedItemResult {
  itemIndex: number;
  itemId?: string;
  /** Per-assignee amount (item amount split equally, cents reconciled). */
  shares: Array<{ userId: string; amount: string }>;
}

export interface ItemizedComputeResult {
  /** Sum of all item lines (before tax + tip). */
  subtotal: string;
  /** subtotal + tax + tip. Authoritative total for the expense row. */
  total: string;
  /** Per-item assignee shares. */
  perItem: ItemizedItemResult[];
  /** Aggregated per-user totals across items + tax + tip. */
  perUser: Array<{ userId: string; amount: string }>;
  /** Per-user tax+tip allocation only (excludes item shares). */
  perUserTaxTip: Array<{ userId: string; amount: string }>;
}

/**
 * Split an itemized expense into per-member shares.
 *
 * - Each item amount is split equally among its assignees, with remainder cents
 *   distributed deterministically to the first assignees (same rule as splitEqually).
 * - Tax is distributed pro-rata across users by their item subtotal.
 * - Tip is distributed either pro-rata (default, like Splitwise) or equally
 *   across users who have at least one item assigned.
 * - Final cent residue from tax/tip rounding is absorbed by the first user.
 */
export function computeItemizedSplit(input: ItemizedComputeInput): ItemizedComputeResult {
  const items = input.items;
  if (items.length === 0) throw new Error('computeItemizedSplit: items empty');

  const tax = D(input.tax ?? 0);
  const tip = D(input.tip ?? 0);
  const tipDist = input.tipDistribution ?? 'PRO_RATA';

  // --- per-item shares
  const perItem: ItemizedItemResult[] = [];
  const itemSubtotal = items.reduce<Decimal>((acc, it) => acc.plus(D(it.amount)), ZERO);

  // Aggregate item totals by user (used for tax pro-rata + tip pro-rata).
  const userItemTotal = new Map<string, Decimal>();

  items.forEach((item, idx) => {
    if (item.assigneeIds.length === 0) {
      throw new Error(`item "${item.label}" has no assignees`);
    }
    const itemAmt = D(item.amount);
    const n = item.assigneeIds.length;
    const base = itemAmt.dividedBy(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const distributed = base.times(n);
    const remainderCents = itemAmt.minus(distributed).times(100).round().toNumber();
    const shares = item.assigneeIds.map((userId, i) => {
      const extra = i < remainderCents ? D('0.01') : ZERO;
      const share = base.plus(extra);
      userItemTotal.set(userId, (userItemTotal.get(userId) ?? ZERO).plus(share));
      return { userId, amount: share.toFixed(2) };
    });
    perItem.push({ itemIndex: idx, itemId: item.id, shares });
  });

  // --- tax pro-rata across users by item subtotal
  const userAdditions = new Map<string, Decimal>(); // tax + tip per user
  const userIds = [...userItemTotal.keys()];

  if (tax.greaterThan(0) && itemSubtotal.greaterThan(0)) {
    let assigned = ZERO;
    userIds.forEach((userId, idx) => {
      const itemSum = userItemTotal.get(userId)!;
      const share =
        idx === userIds.length - 1
          ? tax.minus(assigned)
          : tax.times(itemSum).dividedBy(itemSubtotal).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
      assigned = assigned.plus(share);
      userAdditions.set(userId, (userAdditions.get(userId) ?? ZERO).plus(share));
    });
  }

  // --- tip distribution
  if (tip.greaterThan(0)) {
    if (tipDist === 'EQUAL') {
      const n = userIds.length;
      const base = tip.dividedBy(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const distributed = base.times(n);
      const remainderCents = tip.minus(distributed).times(100).round().toNumber();
      userIds.forEach((userId, i) => {
        const extra = i < remainderCents ? D('0.01') : ZERO;
        userAdditions.set(userId, (userAdditions.get(userId) ?? ZERO).plus(base).plus(extra));
      });
    } else {
      // PRO_RATA
      let assigned = ZERO;
      userIds.forEach((userId, idx) => {
        const itemSum = userItemTotal.get(userId)!;
        const share =
          idx === userIds.length - 1
            ? tip.minus(assigned)
            : tip.times(itemSum).dividedBy(itemSubtotal).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
        assigned = assigned.plus(share);
        userAdditions.set(userId, (userAdditions.get(userId) ?? ZERO).plus(share));
      });
    }
  }

  // --- per-user rollup
  const perUser = userIds.map((userId) => {
    const items = userItemTotal.get(userId) ?? ZERO;
    const additions = userAdditions.get(userId) ?? ZERO;
    return { userId, amount: items.plus(additions).toFixed(2) };
  });
  const perUserTaxTip = userIds.map((userId) => ({
    userId,
    amount: (userAdditions.get(userId) ?? ZERO).toFixed(2),
  }));

  const total = itemSubtotal.plus(tax).plus(tip);

  return {
    subtotal: itemSubtotal.toFixed(2),
    total: total.toFixed(2),
    perItem,
    perUser,
    perUserTaxTip,
  };
}
