import { Decimal, D, ZERO } from '../utils/decimal.js';

export interface ExpenseEvent {
  paidById: string;
  amount: Decimal | string;
  currency: string;
  shares: ReadonlyArray<{ userId: string; amount: Decimal | string }>;
}

export interface SettlementEvent {
  fromUserId: string;
  toUserId: string;
  amount: Decimal | string;
  currency: string;
}

/** Map keyed by `${currency}:${userId}` → net amount (positive = owed to user). */
export type NetBalanceMap = Map<string, Decimal>;

export function computeNetBalances(
  expenses: readonly ExpenseEvent[],
  settlements: readonly SettlementEvent[],
): NetBalanceMap {
  const balances: NetBalanceMap = new Map();
  const bump = (currency: string, userId: string, delta: Decimal) => {
    const key = `${currency}:${userId}`;
    balances.set(key, (balances.get(key) ?? ZERO).plus(delta));
  };

  for (const exp of expenses) {
    bump(exp.currency, exp.paidById, D(exp.amount));
    for (const s of exp.shares) {
      bump(exp.currency, s.userId, D(s.amount).negated());
    }
  }
  for (const stl of settlements) {
    bump(stl.currency, stl.fromUserId, D(stl.amount));
    bump(stl.currency, stl.toUserId, D(stl.amount).negated());
  }
  return balances;
}

export interface PairwiseBalance {
  currency: string;
  fromUserId: string;
  toUserId: string;
  amount: Decimal;
}

/**
 * Build pairwise balances (debtor → creditor) per currency from expense + settlement events.
 * `amount` is always positive; direction is encoded by from/to.
 */
export function computePairwiseBalances(
  expenses: readonly ExpenseEvent[],
  settlements: readonly SettlementEvent[],
): PairwiseBalance[] {
  // currency -> Map<"a|b" with a<b lexicographically> -> Decimal (positive means a owes b)>
  const map = new Map<string, Map<string, Decimal>>();

  const bump = (currency: string, debtor: string, creditor: string, amount: Decimal) => {
    if (debtor === creditor || amount.isZero()) return;
    const [a, b] = debtor < creditor ? [debtor, creditor] : [creditor, debtor];
    const sign = debtor < creditor ? 1 : -1;
    const inner = map.get(currency) ?? new Map<string, Decimal>();
    const key = `${a}|${b}`;
    const cur = inner.get(key) ?? ZERO;
    inner.set(key, cur.plus(amount.times(sign)));
    map.set(currency, inner);
  };

  for (const exp of expenses) {
    for (const s of exp.shares) {
      // s.userId owes exp.paidById the share amount
      bump(exp.currency, s.userId, exp.paidById, D(s.amount));
    }
  }
  for (const stl of settlements) {
    // settlement reduces debt: fromUserId paid toUserId
    bump(stl.currency, stl.fromUserId, stl.toUserId, D(stl.amount).negated());
  }

  const out: PairwiseBalance[] = [];
  for (const [currency, inner] of map.entries()) {
    for (const [pairKey, signed] of inner.entries()) {
      if (signed.isZero()) continue;
      const [a, b] = pairKey.split('|') as [string, string];
      // positive signed means a owes b
      if (signed.greaterThan(0)) {
        out.push({ currency, fromUserId: a, toUserId: b, amount: signed });
      } else {
        out.push({ currency, fromUserId: b, toUserId: a, amount: signed.negated() });
      }
    }
  }
  return out;
}
