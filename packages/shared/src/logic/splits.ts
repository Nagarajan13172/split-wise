import { Decimal, D, ZERO, sum, type DecimalLike } from '../utils/decimal.js';

export interface ShareOutput {
  userId: string;
  amount: string; // money string
  rawUnit?: string;
}

export interface SplitContext {
  total: DecimalLike;
  /** ordered list — deterministic remainder distribution */
  memberIds: readonly string[];
}

/**
 * Split a total equally across members.
 * Distributes the remainder cent-by-cent to the first members in order,
 * so totals always reconcile exactly even with non-divisible amounts.
 */
export function splitEqually({ total, memberIds }: SplitContext): ShareOutput[] {
  if (memberIds.length === 0) throw new Error('splitEqually: memberIds empty');
  const totalD = D(total);
  const n = D(memberIds.length);
  const base = totalD.dividedBy(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const distributed = base.times(n);
  const remainder = totalD.minus(distributed);
  // remainder is in 0.01 increments, length = remainder * 100
  const remainderCents = remainder.times(100).round().toNumber();

  return memberIds.map((userId, idx) => {
    const extra = idx < remainderCents ? D('0.01') : ZERO;
    return { userId, amount: base.plus(extra).toFixed(2) };
  });
}

export interface ByExactInput {
  total: DecimalLike;
  amountsByMember: ReadonlyArray<{ userId: string; amount: DecimalLike }>;
}

export function splitByExactAmounts({ total, amountsByMember }: ByExactInput): ShareOutput[] {
  if (amountsByMember.length === 0) throw new Error('splitByExactAmounts: empty');
  const totalD = D(total);
  const sumD = sum(amountsByMember.map((m) => m.amount));
  if (!sumD.equals(totalD)) {
    throw new Error(
      `splitByExactAmounts: shares (${sumD.toFixed(2)}) must equal total (${totalD.toFixed(2)})`,
    );
  }
  return amountsByMember.map((m) => ({
    userId: m.userId,
    amount: D(m.amount).toFixed(2),
  }));
}

export interface BySharesInput {
  total: DecimalLike;
  sharesByMember: ReadonlyArray<{ userId: string; shares: DecimalLike }>;
}

export function splitByShares({ total, sharesByMember }: BySharesInput): ShareOutput[] {
  if (sharesByMember.length === 0) throw new Error('splitByShares: empty');
  const totalD = D(total);
  const totalShares = sum(sharesByMember.map((m) => m.shares));
  if (totalShares.lessThanOrEqualTo(0)) throw new Error('splitByShares: shares must sum > 0');

  const raw = sharesByMember.map((m) => ({
    userId: m.userId,
    shares: D(m.shares),
    floor: D(m.shares).times(totalD).dividedBy(totalShares).toDecimalPlaces(2, Decimal.ROUND_DOWN),
  }));
  const distributed = sum(raw.map((r) => r.floor));
  const remainderCents = totalD.minus(distributed).times(100).round().toNumber();
  return raw.map((r, idx) => ({
    userId: r.userId,
    amount: (idx < remainderCents ? r.floor.plus('0.01') : r.floor).toFixed(2),
    rawUnit: r.shares.toString(),
  }));
}

export interface ByPercentInput {
  total: DecimalLike;
  percentsByMember: ReadonlyArray<{ userId: string; percent: DecimalLike }>;
}

export function splitByPercentage({ total, percentsByMember }: ByPercentInput): ShareOutput[] {
  if (percentsByMember.length === 0) throw new Error('splitByPercentage: empty');
  const totalPct = sum(percentsByMember.map((m) => m.percent));
  if (!totalPct.equals(100)) {
    throw new Error(`splitByPercentage: percentages must sum to 100, got ${totalPct.toString()}`);
  }
  return splitByShares({
    total,
    sharesByMember: percentsByMember.map((p) => ({ userId: p.userId, shares: p.percent })),
  }).map((s, i) => ({ ...s, rawUnit: D(percentsByMember[i]!.percent).toString() }));
}
