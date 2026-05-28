import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, CURRENCIES, formatMoney, type SplitType } from '@split-wise/shared';
import { Banner, Button, Field, FormError, Input } from '../components/ui.js';
import { trpc } from '../lib/trpc.js';
import { navigate } from '../router.js';

type SplitMode = Extract<SplitType, 'EQUAL' | 'SHARES' | 'PERCENT' | 'EXACT'>;
const SPLIT_MODES: SplitMode[] = ['EQUAL', 'SHARES', 'PERCENT', 'EXACT'];
const SPLIT_LABELS: Record<SplitMode, string> = {
  EQUAL: 'Equal',
  SHARES: 'Shares',
  PERCENT: 'Percent',
  EXACT: 'Exact',
};

export function GroupDetail({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const group = trpc.groups.get.useQuery({ groupId });
  const me = trpc.auth.me.useQuery();
  const expenses = trpc.expenses.list.useQuery({ groupId, limit: 30 });
  const balances = trpc.expenses.forGroup.useQuery({ groupId });
  const settlements = trpc.expenses.listSettlements.useQuery({ groupId });
  const invites = trpc.groups.listInvites.useQuery({ groupId }, { enabled: !!group.data });

  const [inviteEmail, setInviteEmail] = useState('');
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showSettleUp, setShowSettleUp] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [simplify, setSimplify] = useState(false);

  useEffect(() => {
    if (group.data?.simplifyDebts !== undefined) setSimplify(group.data.simplifyDebts);
  }, [group.data?.simplifyDebts]);

  const createInvite = trpc.groups.createInvite.useMutation({
    onSuccess: async (data) => {
      setCreatedInviteUrl(data.url);
      setCopied(false);
      setInviteEmail('');
      await utils.groups.listInvites.invalidate({ groupId });
    },
  });
  const revoke = trpc.groups.revokeInvite.useMutation({
    onSuccess: () => utils.groups.listInvites.invalidate({ groupId }),
  });
  const removeMember = trpc.groups.removeMember.useMutation({
    onSuccess: () => utils.groups.get.invalidate({ groupId }),
  });
  const leave = trpc.groups.leave.useMutation({
    onSuccess: () => {
      utils.groups.list.invalidate();
      navigate('/');
    },
  });
  const del = trpc.groups.delete.useMutation({
    onSuccess: () => {
      utils.groups.list.invalidate();
      navigate('/');
    },
  });
  const deleteExpense = trpc.expenses.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.list.invalidate({ groupId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
    },
    onError: (err) => setTopError(err.message),
  });
  const voidSettlement = trpc.expenses.voidSettlement.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.listSettlements.invalidate({ groupId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
    },
    onError: (err) => setTopError(err.message),
  });

  if (group.isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (group.error) return <FormError error={group.error.message} />;
  if (!group.data) return null;

  const isAdmin = group.data.myRole === 'OWNER' || group.data.myRole === 'ADMIN';
  const isOwner = group.data.myRole === 'OWNER';
  const memberById = new Map(group.data.members.map((m) => [m.id, m]));
  const myUserId = me.data?.id;
  const myNet = balances.data?.members.find((m) => m.userId === myUserId)?.net ?? [];

  const copyInvite = async () => {
    if (!createdInviteUrl) return;
    await navigator.clipboard.writeText(createdInviteUrl);
    setCopied(true);
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <button onClick={() => navigate('/')} className="text-xs text-slate-500 hover:underline">
        ← All groups
      </button>
      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{group.data.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Default currency: {group.data.defaultCurrency} · You are{' '}
            <span className="font-medium">{group.data.myRole.toLowerCase()}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {!isOwner && (
            <Button variant="ghost" onClick={() => leave.mutate({ groupId })}>
              Leave group
            </Button>
          )}
          {isOwner && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm('Delete this group? Expenses are preserved but the group disappears for everyone.')) {
                  del.mutate({ groupId });
                }
              }}
            >
              Delete group
            </Button>
          )}
        </div>
      </div>

      {/* Your balance */}
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Your balance in this group
        </h2>
        {balances.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Calculating…</p>
        ) : myNet.length === 0 ? (
          <p className="mt-2 text-sm text-slate-700">You're all settled up.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {myNet.map((b) => {
              const positive = !b.amount.startsWith('-');
              return (
                <li
                  key={b.currency}
                  className={`text-base font-semibold ${positive ? 'text-emerald-700' : 'text-rose-700'}`}
                >
                  {positive ? 'You are owed ' : 'You owe '}
                  {formatMoney(positive ? b.amount : b.amount.slice(1), b.currency)}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <Button onClick={() => setShowAddExpense((v) => !v)}>
            {showAddExpense ? 'Cancel' : '+ Add expense'}
          </Button>
          <Button variant="ghost" onClick={() => setShowSettleUp((v) => !v)}>
            {showSettleUp ? 'Cancel' : 'Settle up'}
          </Button>
        </div>
      </section>

      {topError && (
        <div className="mt-4">
          <FormError error={topError} />
        </div>
      )}

      {showAddExpense && (
        <AddExpenseForm
          groupId={groupId}
          defaultCurrency={group.data.defaultCurrency}
          members={group.data.members}
          meId={myUserId}
          onDone={() => setShowAddExpense(false)}
        />
      )}

      {showSettleUp && (
        <SettleUpForm
          groupId={groupId}
          defaultCurrency={group.data.defaultCurrency}
          members={group.data.members}
          meId={myUserId}
          suggestions={(balances.data?.pairwise ?? []).filter((p) => p.fromUserId === myUserId)}
          onDone={() => setShowSettleUp(false)}
        />
      )}

      {/* Who owes whom (toggleable: pairwise vs simplified) */}
      {balances.data && (balances.data.pairwise.length > 0 || balances.data.simplified.length > 0) && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Who owes whom
            </h2>
            <button
              onClick={() => setSimplify((v) => !v)}
              className={`rounded-full border px-3 py-1 text-xs ${simplify ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
            >
              {simplify ? 'Simplified ✓' : 'Simplify debts'}
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {(simplify ? balances.data.simplified : balances.data.pairwise).map((p, i) => (
              <li key={i}>
                <span className="font-medium">{memberById.get(p.fromUserId)?.displayName ?? 'Someone'}</span>{' '}
                owes{' '}
                <span className="font-medium">{memberById.get(p.toUserId)?.displayName ?? 'Someone'}</span>{' '}
                {formatMoney(p.amount, p.currency)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            {simplify
              ? 'Fewest transfers (per-currency). FX is not applied.'
              : 'Raw pairwise debts.'}
          </p>
        </section>
      )}

      {/* Expenses */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Expenses</h2>
        {expenses.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : expenses.data?.items.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No expenses yet. Click "+ Add expense" to get started.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {expenses.data?.items.map((e) => {
              if (editingExpenseId === e.id) {
                return (
                  <li key={e.id} className="py-3">
                    <EditExpenseForm
                      groupId={groupId}
                      expenseId={e.id}
                      members={group.data!.members}
                      meId={myUserId}
                      onDone={() => setEditingExpenseId(null)}
                    />
                  </li>
                );
              }
              const myShare = e.shares.find((s) => s.userId === myUserId);
              const youPaid = e.paidBy.id === myUserId;
              const blurb = youPaid
                ? `you paid · ${formatMoney(e.amount, e.currency)}`
                : myShare
                  ? `${e.paidBy.displayName} paid · your share ${formatMoney(myShare.amount, e.currency)}`
                  : `${e.paidBy.displayName} paid`;
              return (
                <li key={e.id} className="flex items-start justify-between gap-2 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {e.category?.icon ? `${e.category.icon} ` : ''}
                      {e.description}
                    </p>
                    <p className="text-xs text-slate-500">{blurb}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(e.occurredAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">
                      {formatMoney(e.amount, e.currency)}
                    </p>
                    <div className="mt-1 flex justify-end gap-3">
                      <button
                        className="text-xs text-slate-600 hover:underline"
                        onClick={() => setEditingExpenseId(e.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-xs text-rose-600 hover:underline"
                        onClick={() => {
                          if (confirm(`Delete "${e.description}"?`)) {
                            deleteExpense.mutate({ expenseId: e.id });
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Settlements */}
      {settlements.data && settlements.data.length > 0 && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Settlements
          </h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {settlements.data.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 py-2">
                <div>
                  <p className="text-sm text-slate-900">
                    {s.fromUser.displayName} → {s.toUser.displayName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(s.occurredAt).toLocaleDateString()}
                    {s.method ? ` · ${s.method}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatMoney(s.amount, s.currency)}</p>
                  <button
                    className="mt-1 text-xs text-rose-600 hover:underline"
                    onClick={() => {
                      if (confirm('Void this settlement?')) {
                        voidSettlement.mutate({ settlementId: s.id });
                      }
                    }}
                  >
                    Void
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Members */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Members ({group.data.members.length})
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {group.data.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">{m.displayName}</p>
                <p className="text-xs text-slate-500">
                  {m.email} · {m.role.toLowerCase()}
                </p>
              </div>
              {isAdmin && m.id !== me.data?.id && m.role !== 'OWNER' && (
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => {
                    if (confirm(`Remove ${m.displayName} from this group?`)) {
                      removeMember.mutate({ groupId, userId: m.id });
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Invite people
          </h2>
          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <Button
                onClick={() => createInvite.mutate({ groupId, expiresInHours: 24 * 7 })}
                disabled={createInvite.isPending}
              >
                {createInvite.isPending ? 'Generating…' : 'Generate share link'}
              </Button>
            </div>
            <div>
              <Field label="Or invite by email" htmlFor="inv-email">
                <div className="flex gap-2">
                  <Input
                    id="inv-email"
                    type="email"
                    placeholder="friend@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <Button
                    onClick={() =>
                      createInvite.mutate({
                        groupId,
                        email: inviteEmail,
                        expiresInHours: 24 * 7,
                      })
                    }
                    disabled={!inviteEmail || createInvite.isPending}
                  >
                    Send
                  </Button>
                </div>
              </Field>
            </div>

            {createdInviteUrl && (
              <Banner kind="success">
                <div className="space-y-2">
                  <p>Share this link (expires in 7 days):</p>
                  <div className="flex gap-2">
                    <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">
                      {createdInviteUrl}
                    </code>
                    <button onClick={copyInvite} className="text-xs underline">
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </Banner>
            )}

            {invites.data && invites.data.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Active invites
                </h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {invites.data
                    .filter((i) => !i.expired && !i.acceptedAt)
                    .map((i) => (
                      <li key={i.id} className="flex items-center justify-between py-2">
                        <span className="text-xs text-slate-600">
                          {i.email ?? 'Link invite'} · expires{' '}
                          {new Date(i.expiresAt).toLocaleDateString()}
                        </span>
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => revoke.mutate({ inviteId: i.id })}
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

interface Member {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

function AddExpenseForm({
  groupId,
  defaultCurrency,
  members,
  meId,
  onDone,
}: {
  groupId: string;
  defaultCurrency: string;
  members: readonly Member[];
  meId?: string;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [paidById, setPaidById] = useState(meId ?? members[0]?.id ?? '');
  const [mode, setMode] = useState<SplitMode>('EQUAL');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [categoryKey, setCategoryKey] = useState<string | ''>('');
  const [error, setError] = useState<string | null>(null);

  const splitAmongUserIds = useMemo(() => {
    if (mode === 'EQUAL') return members.filter((m) => !excluded.has(m.id)).map((m) => m.id);
    return members.filter((m) => Number(values[m.id] ?? '') > 0).map((m) => m.id);
  }, [members, excluded, values, mode]);

  const valuesSum = useMemo(() => {
    if (mode === 'EQUAL') return 0;
    return members.reduce((acc, m) => acc + (Number(values[m.id] ?? '') || 0), 0);
  }, [members, values, mode]);

  const numericAmount = Number(amount);

  const create = trpc.expenses.create.useMutation({
    onMutate: async (input) => {
      await utils.expenses.list.cancel({ groupId });
      const prev = utils.expenses.list.getData({ groupId, limit: 30 });
      const payer = members.find((m) => m.id === input.paidById);
      const participantIds =
        input.splitType === 'EQUAL'
          ? input.splitAmongUserIds
          : input.splitType === 'SHARES'
            ? input.shareUnits.map((u) => u.userId)
            : input.splitType === 'PERCENT'
              ? input.percents.map((p) => p.userId)
              : input.exactAmounts.map((a) => a.userId);
      utils.expenses.list.setData({ groupId, limit: 30 }, (cur) => {
        const item = {
          id: `tmp_${Math.random().toString(36).slice(2)}`,
          amount: input.amount,
          currency: input.currency,
          description: input.description,
          occurredAt: input.occurredAt,
          paidBy: { id: input.paidById, displayName: payer?.displayName ?? 'You' },
          category: null as null | { key: string; label: string; icon: string },
          shares: participantIds.map((userId) => ({
            userId,
            amount: (Number(input.amount) / participantIds.length).toFixed(2),
          })),
        };
        return cur ? { ...cur, items: [item, ...cur.items] } : { items: [item], nextCursor: undefined };
      });
      return { prev };
    },
    onError: (err, _input, ctx) => {
      setError(err.message);
      if (ctx?.prev) utils.expenses.list.setData({ groupId, limit: 30 }, ctx.prev);
    },
    onSettled: async () => {
      await Promise.all([
        utils.expenses.list.invalidate({ groupId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
    },
    onSuccess: onDone,
  });

  const validationError = (() => {
    if (!description.trim()) return 'Description is required.';
    if (!paidById) return 'Choose who paid.';
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return 'Amount must be positive.';
    if (mode === 'EQUAL' && splitAmongUserIds.length === 0) return 'Pick at least one member.';
    if (mode !== 'EQUAL' && splitAmongUserIds.length === 0)
      return 'Enter a value for at least one member.';
    if (mode === 'PERCENT' && Math.abs(valuesSum - 100) > 0.001) {
      return `Percents must sum to 100 (currently ${valuesSum.toFixed(2)}).`;
    }
    if (mode === 'EXACT' && Math.abs(valuesSum - numericAmount) > 0.005) {
      return `Shares must sum to ${numericAmount.toFixed(2)} (currently ${valuesSum.toFixed(2)}).`;
    }
    return null;
  })();

  const submit = () => {
    setError(null);
    if (validationError) {
      setError(validationError);
      return;
    }
    const base = {
      groupId,
      paidById,
      description: description.trim(),
      amount: numericAmount.toFixed(2),
      currency,
      occurredAt: new Date().toISOString(),
      categoryKey: categoryKey || undefined,
    };
    if (mode === 'EQUAL') {
      create.mutate({ ...base, splitType: 'EQUAL', splitAmongUserIds });
    } else if (mode === 'SHARES') {
      create.mutate({
        ...base,
        splitType: 'SHARES',
        shareUnits: members
          .filter((m) => Number(values[m.id] ?? '') > 0)
          .map((m) => ({ userId: m.id, units: values[m.id]! })),
      });
    } else if (mode === 'PERCENT') {
      create.mutate({
        ...base,
        splitType: 'PERCENT',
        percents: members
          .filter((m) => Number(values[m.id] ?? '') > 0)
          .map((m) => ({ userId: m.id, percent: values[m.id]! })),
      });
    } else {
      create.mutate({
        ...base,
        splitType: 'EXACT',
        exactAmounts: members
          .filter((m) => Number(values[m.id] ?? '') > 0)
          .map((m) => ({ userId: m.id, amount: Number(values[m.id]).toFixed(2) })),
      });
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-slate-300 bg-slate-50 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">New expense</h2>
      <div className="mt-4 space-y-4">
        <Field label="What for?" htmlFor="exp-desc">
          <Input
            id="exp-desc"
            placeholder="e.g. Dinner at Luigi's"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label={`Amount (${currency})`} htmlFor="exp-amt">
            <Input
              id="exp-amt"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Currency" htmlFor="exp-cur">
            <select
              id="exp-cur"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">Paid by</p>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {members.map((m) => {
              const sel = paidById === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setPaidById(m.id)}
                  className={`rounded-md border px-3 py-2 text-sm ${sel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                >
                  {m.displayName}
                  {m.id === meId ? ' (you)' : ''}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">Split method</p>
          <div className="mt-1 grid grid-cols-4 gap-2">
            {SPLIT_MODES.map((m) => {
              const sel = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md border px-3 py-2 text-sm ${sel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                >
                  {SPLIT_LABELS[m]}
                </button>
              );
            })}
          </div>
        </div>

        {mode === 'EQUAL' && (
          <div>
            <p className="text-sm font-medium text-slate-700">Split equally among</p>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {members.map((m) => {
                const included = !excluded.has(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      const next = new Set(excluded);
                      if (included) next.add(m.id);
                      else next.delete(m.id);
                      setExcluded(next);
                    }}
                    className={`rounded-md border px-3 py-2 text-sm ${included ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-400'}`}
                  >
                    {included ? '✓ ' : '✗ '}
                    {m.displayName}
                  </button>
                );
              })}
            </div>
            {numericAmount > 0 && splitAmongUserIds.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                ~ {formatMoney((numericAmount / splitAmongUserIds.length).toFixed(2), currency)} per person
              </p>
            )}
          </div>
        )}

        {mode !== 'EQUAL' && (
          <PerMemberInputs
            members={members}
            values={values}
            onChange={setValues}
            suffix={
              mode === 'PERCENT' ? '%' : mode === 'SHARES' ? '×' : currency
            }
          />
        )}

        {mode === 'PERCENT' && (
          <p
            className={`text-xs ${Math.abs(valuesSum - 100) > 0.001 ? 'text-rose-600' : 'text-emerald-700'}`}
          >
            Sum: {valuesSum.toFixed(2)}%{' '}
            {Math.abs(valuesSum - 100) > 0.001 ? '(must be 100)' : '✓'}
          </p>
        )}
        {mode === 'EXACT' && (
          <p
            className={`text-xs ${Math.abs(valuesSum - numericAmount) > 0.005 ? 'text-rose-600' : 'text-emerald-700'}`}
          >
            Sum: {valuesSum.toFixed(2)} of {numericAmount.toFixed(2)}
            {Math.abs(valuesSum - numericAmount) > 0.005 ? ' (must match total)' : ' ✓'}
          </p>
        )}
        {mode === 'SHARES' && (
          <p className="text-xs text-slate-500">Total units: {valuesSum.toFixed(2)}</p>
        )}

        <div>
          <p className="text-sm font-medium text-slate-700">Category (optional)</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const sel = categoryKey === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setCategoryKey(sel ? '' : c.key)}
                  className={`rounded-full border px-3 py-1 text-xs ${sel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                >
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <FormError error={error} />

        <div className="flex gap-2">
          <Button disabled={!!validationError || create.isPending} onClick={submit}>
            {create.isPending ? 'Saving…' : 'Save expense'}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}

function PerMemberInputs({
  members,
  values,
  onChange,
  suffix,
}: {
  members: readonly Member[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  suffix: string;
}) {
  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.id} className="flex items-center gap-3">
          <span className="flex-1 text-sm text-slate-800">{m.displayName}</span>
          <input
            inputMode="decimal"
            placeholder="0"
            value={values[m.id] ?? ''}
            onChange={(e) => onChange({ ...values, [m.id]: e.target.value })}
            className="w-32 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <span className="w-10 text-xs text-slate-500">{suffix}</span>
        </div>
      ))}
    </div>
  );
}

function SettleUpForm({
  groupId,
  defaultCurrency,
  members,
  meId,
  suggestions,
  onDone,
}: {
  groupId: string;
  defaultCurrency: string;
  members: readonly Member[];
  meId?: string;
  suggestions: Array<{ fromUserId: string; toUserId: string; amount: string; currency: string }>;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [fromUserId, setFromUserId] = useState(meId ?? '');
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [method, setMethod] = useState('');
  const [error, setError] = useState<string | null>(null);

  const memberById = new Map(members.map((m) => [m.id, m]));

  const record = trpc.expenses.recordSettlement.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.listSettlements.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
      onDone();
    },
    onError: (err) => setError(err.message),
  });

  const submit = () => {
    setError(null);
    if (!fromUserId || !toUserId) return setError('Choose payer and payee.');
    if (fromUserId === toUserId) return setError('Payer and payee must differ.');
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError('Enter a positive amount.');
    record.mutate({
      groupId,
      fromUserId,
      toUserId,
      amount: n.toFixed(2),
      currency,
      occurredAt: new Date().toISOString(),
      method: method.trim() || undefined,
    });
  };

  return (
    <section className="mt-6 rounded-xl border border-slate-300 bg-slate-50 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Record a settlement
      </h2>

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-slate-500">Quick fill from your debts:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((p, i) => (
              <button
                key={i}
                onClick={() => {
                  setFromUserId(p.fromUserId);
                  setToUserId(p.toUserId);
                  setAmount(p.amount);
                  setCurrency(p.currency);
                }}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                Pay {memberById.get(p.toUserId)?.displayName ?? '?'}{' '}
                {formatMoney(p.amount, p.currency)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-700">From (who paid)</p>
          <select
            value={fromUserId}
            onChange={(e) => setFromUserId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— choose —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
                {m.id === meId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">To (who was paid)</p>
          <select
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— choose —</option>
            {members
              .filter((m) => m.id !== fromUserId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
          </select>
        </div>

        <Field label={`Amount (${currency})`} htmlFor="stl-amt">
          <Input
            id="stl-amt"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        <Field label="Method (optional)" htmlFor="stl-method">
          <Input
            id="stl-method"
            placeholder="e.g. Venmo, cash"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          />
        </Field>

        <FormError error={error} />

        <div className="flex gap-2">
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? 'Saving…' : 'Record settlement'}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}

function EditExpenseForm({
  groupId,
  expenseId,
  members,
  meId,
  onDone,
}: {
  groupId: string;
  expenseId: string;
  members: readonly Member[];
  meId?: string;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.expenses.get.useQuery({ expenseId });

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [paidById, setPaidById] = useState<string>('');
  const [mode, setMode] = useState<SplitMode>('EQUAL');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [categoryKey, setCategoryKey] = useState<string | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (!detail.data) return;
    setDescription(detail.data.description);
    setAmount(detail.data.amount);
    setCurrency(detail.data.currency);
    setPaidById(detail.data.paidBy.id);
    setNotes(detail.data.notes ?? '');
    setCategoryKey(detail.data.category?.key ?? '');
    const existingType = (detail.data.splitType ?? 'EQUAL') as SplitType;
    const effectiveMode: SplitMode =
      existingType === 'ITEMIZED' ? 'EQUAL' : (existingType as SplitMode);
    setMode(effectiveMode);
    if (effectiveMode === 'EQUAL') {
      const shareIds = new Set(detail.data.shares.map((s) => s.userId));
      setExcluded(new Set(members.filter((m) => !shareIds.has(m.id)).map((m) => m.id)));
    } else {
      const next: Record<string, string> = {};
      for (const s of detail.data.shares) {
        next[s.userId] =
          effectiveMode === 'EXACT' ? s.amount : (s.rawUnit ?? s.amount);
      }
      setValues(next);
    }
    setInitialized(true);
  }, [detail.data, initialized, members]);

  const numericAmount = Number(amount);

  const splitAmongUserIds = useMemo(() => {
    if (mode === 'EQUAL') return members.filter((m) => !excluded.has(m.id)).map((m) => m.id);
    return members.filter((m) => Number(values[m.id] ?? '') > 0).map((m) => m.id);
  }, [members, excluded, values, mode]);

  const valuesSum = useMemo(() => {
    if (mode === 'EQUAL') return 0;
    return members.reduce((acc, m) => acc + (Number(values[m.id] ?? '') || 0), 0);
  }, [members, values, mode]);

  const update = trpc.expenses.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.list.invalidate({ groupId }),
        utils.expenses.get.invalidate({ expenseId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
      onDone();
    },
    onError: (err) => setError(err.message),
  });

  if (detail.isLoading || !initialized) {
    return <p className="text-sm text-slate-500">Loading expense…</p>;
  }
  if (detail.error) {
    return <FormError error={detail.error.message} />;
  }
  if (!detail.data) return null;

  const validationError = (() => {
    if (!description.trim()) return 'Description is required.';
    if (!paidById) return 'Choose who paid.';
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return 'Amount must be positive.';
    if (splitAmongUserIds.length === 0) return 'Pick at least one member.';
    if (mode === 'PERCENT' && Math.abs(valuesSum - 100) > 0.001) {
      return `Percents must sum to 100 (currently ${valuesSum.toFixed(2)}).`;
    }
    if (mode === 'EXACT' && Math.abs(valuesSum - numericAmount) > 0.005) {
      return `Shares must sum to ${numericAmount.toFixed(2)} (currently ${valuesSum.toFixed(2)}).`;
    }
    return null;
  })();

  const submit = () => {
    setError(null);
    if (validationError) {
      setError(validationError);
      return;
    }
    const base = {
      expenseId,
      expectedVersion: detail.data!.version,
      description: description.trim(),
      notes: notes.trim() || undefined,
      amount: numericAmount.toFixed(2),
      currency,
      occurredAt: detail.data!.occurredAt,
      paidById,
      categoryKey: categoryKey || undefined,
    };
    if (mode === 'EQUAL') {
      update.mutate({ ...base, splitType: 'EQUAL', splitAmongUserIds });
    } else if (mode === 'SHARES') {
      update.mutate({
        ...base,
        splitType: 'SHARES',
        shareUnits: members
          .filter((m) => Number(values[m.id] ?? '') > 0)
          .map((m) => ({ userId: m.id, units: values[m.id]! })),
      });
    } else if (mode === 'PERCENT') {
      update.mutate({
        ...base,
        splitType: 'PERCENT',
        percents: members
          .filter((m) => Number(values[m.id] ?? '') > 0)
          .map((m) => ({ userId: m.id, percent: values[m.id]! })),
      });
    } else {
      update.mutate({
        ...base,
        splitType: 'EXACT',
        exactAmounts: members
          .filter((m) => Number(values[m.id] ?? '') > 0)
          .map((m) => ({ userId: m.id, amount: Number(values[m.id]).toFixed(2) })),
      });
    }
  };

  return (
    <section className="rounded-xl border border-slate-300 bg-slate-50 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Edit expense · v{detail.data.version}
      </h3>
      <div className="mt-4 space-y-4">
        <Field label="What for?" htmlFor={`edit-desc-${expenseId}`}>
          <Input
            id={`edit-desc-${expenseId}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label={`Amount (${currency})`} htmlFor={`edit-amt-${expenseId}`}>
            <Input
              id={`edit-amt-${expenseId}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Currency" htmlFor={`edit-cur-${expenseId}`}>
            <select
              id={`edit-cur-${expenseId}`}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">Paid by</p>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {members.map((m) => {
              const sel = paidById === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setPaidById(m.id)}
                  className={`rounded-md border px-3 py-2 text-sm ${sel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                >
                  {m.displayName}
                  {m.id === meId ? ' (you)' : ''}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">Split method</p>
          <div className="mt-1 grid grid-cols-4 gap-2">
            {SPLIT_MODES.map((m) => {
              const sel = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md border px-3 py-2 text-sm ${sel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                >
                  {SPLIT_LABELS[m]}
                </button>
              );
            })}
          </div>
        </div>

        {mode === 'EQUAL' && (
          <div>
            <p className="text-sm font-medium text-slate-700">Split equally among</p>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {members.map((m) => {
                const included = !excluded.has(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      const next = new Set(excluded);
                      if (included) next.add(m.id);
                      else next.delete(m.id);
                      setExcluded(next);
                    }}
                    className={`rounded-md border px-3 py-2 text-sm ${included ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-400'}`}
                  >
                    {included ? '✓ ' : '✗ '}
                    {m.displayName}
                  </button>
                );
              })}
            </div>
            {numericAmount > 0 && splitAmongUserIds.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                ~ {formatMoney((numericAmount / splitAmongUserIds.length).toFixed(2), currency)} per person
              </p>
            )}
          </div>
        )}

        {mode !== 'EQUAL' && (
          <PerMemberInputs
            members={members}
            values={values}
            onChange={setValues}
            suffix={mode === 'PERCENT' ? '%' : mode === 'SHARES' ? '×' : currency}
          />
        )}

        {mode === 'PERCENT' && (
          <p
            className={`text-xs ${Math.abs(valuesSum - 100) > 0.001 ? 'text-rose-600' : 'text-emerald-700'}`}
          >
            Sum: {valuesSum.toFixed(2)}%{' '}
            {Math.abs(valuesSum - 100) > 0.001 ? '(must be 100)' : '✓'}
          </p>
        )}
        {mode === 'EXACT' && (
          <p
            className={`text-xs ${Math.abs(valuesSum - numericAmount) > 0.005 ? 'text-rose-600' : 'text-emerald-700'}`}
          >
            Sum: {valuesSum.toFixed(2)} of {numericAmount.toFixed(2)}
            {Math.abs(valuesSum - numericAmount) > 0.005 ? ' (must match total)' : ' ✓'}
          </p>
        )}
        {mode === 'SHARES' && (
          <p className="text-xs text-slate-500">Total units: {valuesSum.toFixed(2)}</p>
        )}

        <div>
          <p className="text-sm font-medium text-slate-700">Category (optional)</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const sel = categoryKey === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setCategoryKey(sel ? '' : c.key)}
                  className={`rounded-full border px-3 py-1 text-xs ${sel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                >
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Notes (optional)" htmlFor={`edit-notes-${expenseId}`}>
          <Input
            id={`edit-notes-${expenseId}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <FormError error={error} />

        <div className="flex gap-2">
          <Button disabled={!!validationError || update.isPending} onClick={submit}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}
