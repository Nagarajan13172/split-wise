import { Decimal, D, ZERO } from '../utils/decimal.js';
import { computeNetBalances, type ExpenseEvent, type SettlementEvent } from './balances.js';

export interface SimplifiedEdge {
  currency: string;
  fromUserId: string;
  toUserId: string;
  amount: Decimal;
}

/**
 * Greedy min-cash-flow / debt simplification, computed per currency.
 *
 * Splitwise default: never convert across currencies before simplifying — produces
 * one debt list per currency so settlements don't bake in today's FX rate.
 */
export function simplifyDebts(
  expenses: readonly ExpenseEvent[],
  settlements: readonly SettlementEvent[],
): SimplifiedEdge[] {
  const nets = computeNetBalances(expenses, settlements);

  // Group by currency
  const byCurrency = new Map<string, Map<string, Decimal>>();
  for (const [key, value] of nets.entries()) {
    const [currency, userId] = key.split(':') as [string, string];
    const inner = byCurrency.get(currency) ?? new Map<string, Decimal>();
    inner.set(userId, value);
    byCurrency.set(currency, inner);
  }

  const out: SimplifiedEdge[] = [];

  for (const [currency, nets] of byCurrency.entries()) {
    // Round to 2dp so floating residue (e.g., 0.001) doesn't generate phantom edges
    const creditors: Array<{ userId: string; amount: Decimal }> = [];
    const debtors: Array<{ userId: string; amount: Decimal }> = [];
    for (const [userId, amt] of nets.entries()) {
      const rounded = amt.toDecimalPlaces(2);
      if (rounded.greaterThan(0)) creditors.push({ userId, amount: rounded });
      else if (rounded.lessThan(0)) debtors.push({ userId, amount: rounded.negated() });
    }

    // Sort largest-first; deterministic tiebreak on userId for stable output
    const cmp = (a: { amount: Decimal; userId: string }, b: { amount: Decimal; userId: string }) =>
      b.amount.comparedTo(a.amount) || a.userId.localeCompare(b.userId);
    creditors.sort(cmp);
    debtors.sort(cmp);

    let ci = 0;
    let di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const cr = creditors[ci]!;
      const db = debtors[di]!;
      const transfer = Decimal.min(cr.amount, db.amount);
      out.push({
        currency,
        fromUserId: db.userId,
        toUserId: cr.userId,
        amount: transfer,
      });
      cr.amount = cr.amount.minus(transfer);
      db.amount = db.amount.minus(transfer);
      if (cr.amount.isZero()) ci++;
      if (db.amount.isZero()) di++;
    }
  }

  return out;
}

/** Sum of a member's net balance — useful for invariants in tests. */
export function netForUser(
  nets: Map<string, Decimal>,
  currency: string,
  userId: string,
): Decimal {
  return nets.get(`${currency}:${userId}`) ?? ZERO;
}
