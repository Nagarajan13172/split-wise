import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CATEGORIES,
  CURRENCIES,
  formatMoney,
  type SplitType,
} from '@split-wise/shared';
import {
  Button,
  ErrorBanner,
  Field,
  H1,
  Input,
  Screen,
  Sub,
} from '../../../../src/components/ui';
import { trpc } from '../../../../src/lib/trpc';

type Mode = Extract<SplitType, 'EQUAL' | 'SHARES' | 'PERCENT' | 'EXACT'>;

const MODE_LABELS: Record<Mode, string> = {
  EQUAL: 'Equal',
  SHARES: 'Shares',
  PERCENT: 'Percent',
  EXACT: 'Exact',
};

export default function EditExpenseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string; expenseId: string }>();
  const groupId = String(params.groupId);
  const expenseId = String(params.expenseId);

  const utils = trpc.useUtils();
  const group = trpc.groups.get.useQuery({ groupId });
  const me = trpc.auth.me.useQuery();
  const expense = trpc.expenses.get.useQuery({ expenseId });

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [paidById, setPaidById] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('EQUAL');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [categoryKey, setCategoryKey] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (!expense.data || !group.data) return;
    setDescription(expense.data.description);
    setAmount(expense.data.amount);
    setCurrency(expense.data.currency);
    setPaidById(expense.data.paidBy.id);
    setNotes(expense.data.notes ?? '');
    setCategoryKey(expense.data.category?.key ?? undefined);
    const existingType = (expense.data.splitType ?? 'EQUAL') as Mode | 'ITEMIZED';
    const effectiveMode: Mode = existingType === 'ITEMIZED' ? 'EQUAL' : existingType;
    setMode(effectiveMode);
    if (effectiveMode === 'EQUAL') {
      const shareIds = new Set(expense.data.shares.map((s) => s.userId));
      setExcluded(new Set(group.data.members.map((m) => m.id).filter((id) => !shareIds.has(id))));
    } else {
      const next: Record<string, string> = {};
      for (const s of expense.data.shares) {
        if (effectiveMode === 'EXACT') {
          next[s.userId] = s.amount;
        } else {
          // SHARES/PERCENT — prefer rawUnit if API returned it
          const ru = (s as { rawUnit?: string | null }).rawUnit;
          next[s.userId] = ru ?? s.amount;
        }
      }
      setValues(next);
    }
    setInitialized(true);
  }, [expense.data, group.data, initialized]);

  const members = group.data?.members ?? [];
  const numericAmount = Number(amount);

  const splitAmongUserIds = useMemo(() => {
    if (mode === 'EQUAL') return members.filter((m) => !excluded.has(m.id)).map((m) => m.id);
    return members.filter((m) => Number(values[m.id] ?? '') > 0).map((m) => m.id);
  }, [members, excluded, values, mode]);

  const valuesSum = useMemo(() => {
    if (mode === 'EQUAL') return 0;
    return members.reduce((acc, m) => acc + (Number(values[m.id] ?? '') || 0), 0);
  }, [members, values, mode]);

  const perPerson =
    mode === 'EQUAL' && Number.isFinite(numericAmount) && numericAmount > 0 && splitAmongUserIds.length > 0
      ? (numericAmount / splitAmongUserIds.length).toFixed(2)
      : null;

  const update = trpc.expenses.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.list.invalidate({ groupId }),
        utils.expenses.get.invalidate({ expenseId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
      router.back();
    },
    onError: (err) => setError(err.message),
  });

  function clientValidate(): string | null {
    if (!description.trim()) return 'Description is required.';
    if (!paidById) return 'Choose who paid.';
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return 'Amount must be positive.';
    if (mode === 'EQUAL') {
      if (splitAmongUserIds.length === 0) return 'Pick at least one member.';
      return null;
    }
    if (splitAmongUserIds.length === 0) return 'Enter a value for at least one member.';
    if (mode === 'PERCENT' && Math.abs(valuesSum - 100) > 0.001) {
      return `Percents must sum to 100 (currently ${valuesSum.toFixed(2)}).`;
    }
    if (mode === 'EXACT' && Math.abs(valuesSum - numericAmount) > 0.005) {
      return `Shares must sum to ${numericAmount.toFixed(2)} (currently ${valuesSum.toFixed(2)}).`;
    }
    return null;
  }

  const validationError = clientValidate();

  const submit = () => {
    setError(null);
    if (!expense.data || !paidById) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    const base = {
      expenseId,
      expectedVersion: expense.data.version,
      description: description.trim(),
      notes: notes.trim() || undefined,
      amount: numericAmount.toFixed(2),
      currency,
      occurredAt: expense.data.occurredAt,
      paidById,
      categoryKey,
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

  const renderPerMemberInputs = (suffix: string) => (
    <View className="gap-2">
      {members.map((m) => (
        <View key={m.id} className="flex-row items-center gap-2">
          <Text className="flex-1 text-sm text-slate-800">
            {m.displayName}
            {m.id === me.data?.id ? ' (you)' : ''}
          </Text>
          <View className="w-32">
            <Input
              keyboardType="decimal-pad"
              placeholder="0"
              value={values[m.id] ?? ''}
              onChangeText={(v) => setValues((cur) => ({ ...cur, [m.id]: v }))}
            />
          </View>
          <Text className="w-6 text-xs text-slate-500">{suffix}</Text>
        </View>
      ))}
    </View>
  );

  if (expense.isLoading || group.isLoading) {
    return (
      <Screen>
        <Text className="text-sm text-slate-500">Loading…</Text>
      </Screen>
    );
  }
  if (expense.error) {
    return (
      <Screen>
        <Button variant="ghost" onPress={() => router.back()}>
          ← Back
        </Button>
        <View className="mt-4">
          <ErrorBanner error={expense.error.message} />
        </View>
      </Screen>
    );
  }
  if (!expense.data || !group.data) return null;

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <Button variant="ghost" onPress={() => router.back()}>
          ← Cancel
        </Button>
        <View className="mt-2">
          <H1>Edit expense</H1>
          <Sub>
            {group.data.name} · v{expense.data.version}
          </Sub>
        </View>

        <View className="mt-6 gap-4">
          <Field label="What for?">
            <Input value={description} onChangeText={setDescription} />
          </Field>

          <Field label={`Amount (${currency})`}>
            <Input
              keyboardType="decimal-pad"
              placeholder="0.00"
              value={amount}
              onChangeText={setAmount}
            />
          </Field>

          <Field label="Currency">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {CURRENCIES.map((c) => {
                  const sel = currency === c.code;
                  return (
                    <Pressable
                      key={c.code}
                      onPress={() => setCurrency(c.code)}
                      className={`rounded-full border px-3 py-2 ${sel ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                    >
                      <Text className={sel ? 'text-white' : 'text-slate-700'}>
                        {c.symbol} {c.code}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Field>

          <Field label="Paid by">
            <View className="gap-1">
              {members.map((m) => {
                const selected = paidById === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setPaidById(m.id)}
                    className={`rounded-md border px-3 py-2 ${selected ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={selected ? 'text-white' : 'text-slate-800'}>
                      {m.displayName}
                      {m.id === me.data?.id ? ' (you)' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <Field label="Split method">
            <View className="flex-row gap-2">
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => {
                const sel = mode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setMode(m);
                      // When switching modes, seed sensible defaults
                      if (m !== 'EQUAL' && Object.keys(values).length === 0) {
                        const next: Record<string, string> = {};
                        for (const member of members) {
                          next[member.id] =
                            m === 'PERCENT'
                              ? (100 / members.length).toFixed(2)
                              : m === 'EXACT'
                                ? (numericAmount / members.length || 0).toFixed(2)
                                : '1';
                        }
                        setValues(next);
                      }
                    }}
                    className={`flex-1 rounded-md border px-3 py-2 ${sel ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={`text-center ${sel ? 'text-white' : 'text-slate-700'}`}>
                      {MODE_LABELS[m]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          {mode === 'EQUAL' ? (
            <Field label="Split equally among">
              <View className="gap-1">
                {members.map((m) => {
                  const included = !excluded.has(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => {
                        const next = new Set(excluded);
                        if (included) next.add(m.id);
                        else next.delete(m.id);
                        setExcluded(next);
                      }}
                      className={`flex-row items-center justify-between rounded-md border px-3 py-2 ${included ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}
                    >
                      <Text className={included ? 'text-emerald-900' : 'text-slate-500'}>
                        {m.displayName}
                        {m.id === me.data?.id ? ' (you)' : ''}
                      </Text>
                      <Text className={included ? 'text-emerald-700' : 'text-slate-400'}>
                        {included ? '✓ included' : 'excluded'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {perPerson ? (
                <Text className="mt-2 text-xs text-slate-500">
                  ~ {formatMoney(perPerson, currency)} per person
                </Text>
              ) : null}
            </Field>
          ) : null}

          {mode === 'SHARES' ? (
            <Field label="Shares per member">
              {renderPerMemberInputs('×')}
              <Text className="mt-2 text-xs text-slate-500">
                Total units: {valuesSum.toFixed(2)}
              </Text>
            </Field>
          ) : null}

          {mode === 'PERCENT' ? (
            <Field label="Percent per member">
              {renderPerMemberInputs('%')}
              <Text
                className={`mt-2 text-xs ${Math.abs(valuesSum - 100) > 0.001 ? 'text-rose-600' : 'text-emerald-700'}`}
              >
                Sum: {valuesSum.toFixed(2)}%{' '}
                {Math.abs(valuesSum - 100) > 0.001 ? '(must be 100)' : '✓'}
              </Text>
            </Field>
          ) : null}

          {mode === 'EXACT' ? (
            <Field label={`Exact amount per member (${currency})`}>
              {renderPerMemberInputs(currency)}
              <Text
                className={`mt-2 text-xs ${Math.abs(valuesSum - numericAmount) > 0.005 ? 'text-rose-600' : 'text-emerald-700'}`}
              >
                Sum: {valuesSum.toFixed(2)} of {numericAmount.toFixed(2)}
                {Math.abs(valuesSum - numericAmount) > 0.005 ? ' (must match total)' : ' ✓'}
              </Text>
            </Field>
          ) : null}

          <Field label="Category (optional)">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {CATEGORIES.map((c) => {
                  const selected = categoryKey === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() => setCategoryKey(selected ? undefined : c.key)}
                      className={`rounded-full border px-3 py-2 ${selected ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                    >
                      <Text className={selected ? 'text-white' : 'text-slate-700'}>
                        {c.icon} {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Field>

          <Field label="Notes (optional)">
            <Input
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="anything to remember about this expense"
            />
          </Field>

          <ErrorBanner error={error} />

          <Button
            onPress={submit}
            disabled={!!validationError || update.isPending}
            loading={update.isPending}
          >
            Save changes
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
