import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CURRENCIES,
  D,
  computeItemizedSplit,
  formatMoney,
  type ReceiptOcrResult,
} from '@split-wise/shared';
import {
  Button,
  ErrorBanner,
  Field,
  H1,
  InfoBanner,
  Input,
  Screen,
  Sub,
} from '../../../../src/components/ui';
import { trpc } from '../../../../src/lib/trpc';

interface EditableItem {
  /** Stable client-side id so React keys + assignee maps survive re-orders. */
  key: string;
  label: string;
  amount: string;
  assigneeIds: string[];
}

function uid() {
  return `it_${Math.random().toString(36).slice(2, 10)}`;
}

function safeNumber(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Itemize editor. Polls the receipt scan every 2s while it's PROCESSING; once
 * PARSED, hydrates the item list. The user can edit labels/amounts, add or
 * remove items, and toggle assignees per item. A live computation shows each
 * member's running total. On submit we send an ITEMIZED expense.create.
 */
export default function ItemizeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string; receiptScanId: string }>();
  const groupId = String(params.groupId);
  const receiptScanId = String(params.receiptScanId);

  const utils = trpc.useUtils();
  const group = trpc.groups.get.useQuery({ groupId });
  const me = trpc.auth.me.useQuery();
  const scan = trpc.receipts.get.useQuery(
    { receiptScanId },
    {
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === 'UPLOADED' || s === 'PROCESSING' ? 2000 : false;
      },
    },
  );

  const [items, setItems] = useState<EditableItem[]>([]);
  const [tax, setTax] = useState('');
  const [tip, setTip] = useState('');
  const [tipMode, setTipMode] = useState<'PRO_RATA' | 'EQUAL'>('PRO_RATA');
  const [description, setDescription] = useState('');
  const [paidById, setPaidById] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const members = group.data?.members ?? [];
  const effectivePaidById = paidById ?? me.data?.id ?? null;
  const effectiveCurrency = currency ?? group.data?.defaultCurrency ?? 'USD';

  // Hydrate from parsed OCR result the first time PARSED data is available.
  useEffect(() => {
    if (hydrated) return;
    if (scan.data?.status !== 'PARSED') return;
    const parsed = scan.data.parsedItems as ReceiptOcrResult | null;
    if (!parsed) return;
    const initialAssignees = members.map((m) => m.id);
    setItems(
      parsed.items.length > 0
        ? parsed.items.map((it) => ({
            key: uid(),
            label: it.label,
            amount: it.amount,
            assigneeIds: [...initialAssignees],
          }))
        : [{ key: uid(), label: '', amount: '', assigneeIds: [...initialAssignees] }],
    );
    setTax(parsed.tax ?? '');
    setTip(parsed.tip ?? '');
    if (parsed.merchant) setDescription(parsed.merchant);
    if (parsed.currency) setCurrency(parsed.currency);
    setHydrated(true);
  }, [scan.data?.status, scan.data?.parsedItems, members, hydrated]);

  const preview = useMemo(() => {
    const valid = items.filter(
      (it) => it.label.trim().length > 0 && safeNumber(it.amount) > 0 && it.assigneeIds.length > 0,
    );
    if (valid.length === 0) return null;
    try {
      return computeItemizedSplit({
        items: valid.map((it) => ({
          id: it.key,
          label: it.label,
          amount: it.amount,
          assigneeIds: it.assigneeIds,
        })),
        tax: tax || '0',
        tip: tip || '0',
        tipDistribution: tipMode,
      });
    } catch {
      return null;
    }
  }, [items, tax, tip, tipMode]);

  const create = trpc.expenses.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.list.invalidate({ groupId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
      router.replace({ pathname: '/groups/[groupId]', params: { groupId } });
    },
    onError: (err) => setError(err.message),
  });

  function setItem(key: string, patch: Partial<EditableItem>) {
    setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setItems((cur) => cur.filter((it) => it.key !== key));
  }
  function addItem() {
    setItems((cur) => [
      ...cur,
      { key: uid(), label: '', amount: '', assigneeIds: members.map((m) => m.id) },
    ]);
  }
  function toggleAssignee(key: string, userId: string) {
    setItem(
      key,
      (() => {
        const it = items.find((i) => i.key === key);
        if (!it) return {};
        const has = it.assigneeIds.includes(userId);
        return {
          assigneeIds: has
            ? it.assigneeIds.filter((id) => id !== userId)
            : [...it.assigneeIds, userId],
        };
      })(),
    );
  }

  const validationError = (() => {
    if (!hydrated) return null;
    if (!description.trim()) return 'Description is required.';
    if (!effectivePaidById) return 'Choose who paid.';
    if (items.length === 0) return 'Add at least one item.';
    const valid = items.filter(
      (it) => it.label.trim() && safeNumber(it.amount) > 0 && it.assigneeIds.length > 0,
    );
    if (valid.length === 0) {
      return 'Each item needs a label, an amount, and at least one assignee.';
    }
    for (const it of items) {
      if (it.label.trim() && safeNumber(it.amount) <= 0) {
        return `Item "${it.label}" needs a positive amount.`;
      }
      if (it.label.trim() && it.assigneeIds.length === 0) {
        return `Item "${it.label}" needs at least one assignee.`;
      }
    }
    return null;
  })();

  function submit() {
    if (!effectivePaidById || !preview) return;
    setError(null);
    const e = validationError;
    if (e) {
      setError(e);
      return;
    }
    const finalItems = items
      .filter((it) => it.label.trim() && safeNumber(it.amount) > 0 && it.assigneeIds.length > 0)
      .map((it) => ({
        label: it.label.trim(),
        amount: D(it.amount).toFixed(2),
        quantity: 1,
        assigneeIds: it.assigneeIds,
      }));
    create.mutate({
      groupId,
      paidById: effectivePaidById,
      description: description.trim(),
      amount: preview.total,
      currency: effectiveCurrency,
      occurredAt: new Date().toISOString(),
      splitType: 'ITEMIZED',
      items: finalItems,
      tax: tax ? D(tax).toFixed(2) : undefined,
      tip: tip ? D(tip).toFixed(2) : undefined,
      tipDistribution: tipMode,
      receiptScanId,
    });
  }

  // ---- render ----

  if (scan.isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }
  if (scan.error) {
    return (
      <Screen>
        <Button variant="ghost" onPress={() => router.back()}>
          ← Back
        </Button>
        <ErrorBanner error={scan.error.message} />
      </Screen>
    );
  }
  if (scan.data?.status === 'FAILED') {
    return (
      <Screen>
        <Button variant="ghost" onPress={() => router.back()}>
          ← Back
        </Button>
        <View className="mt-4">
          <H1>OCR failed</H1>
          <Sub>{scan.data.errorMessage ?? 'We could not read this receipt.'}</Sub>
        </View>
        <View className="mt-6">
          <Button onPress={() => router.replace({ pathname: '/groups/[groupId]/scan-receipt', params: { groupId } })}>
            Try a different photo
          </Button>
        </View>
      </Screen>
    );
  }
  if (scan.data?.status === 'UPLOADED' || scan.data?.status === 'PROCESSING') {
    return (
      <Screen>
        <Button variant="ghost" onPress={() => router.back()}>
          ← Cancel
        </Button>
        <View className="mt-2">
          <H1>Reading receipt…</H1>
          <Sub>This usually takes 5–20 seconds.</Sub>
        </View>
        <View className="mt-8 flex-row items-center gap-2">
          <ActivityIndicator />
          <Text className="text-sm text-slate-600">Status: {scan.data.status}</Text>
        </View>
      </Screen>
    );
  }

  const perUser = preview?.perUser ?? [];

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-12">
        <Button variant="ghost" onPress={() => router.back()}>
          ← Cancel
        </Button>
        <View className="mt-2">
          <H1>Itemize receipt</H1>
          <Sub>{group.data?.name ?? ''} · review items, assign people, then save.</Sub>
        </View>

        <View className="mt-6 gap-4">
          <Field label="Description">
            <Input
              placeholder="e.g. Dinner at Luigi's"
              value={description}
              onChangeText={setDescription}
            />
          </Field>

          <Field label="Paid by">
            <View className="gap-1">
              {members.map((m) => {
                const sel = effectivePaidById === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setPaidById(m.id)}
                    className={`rounded-md border px-3 py-2 ${sel ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={sel ? 'text-white' : 'text-slate-800'}>
                      {m.displayName}
                      {m.id === me.data?.id ? ' (you)' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <Field label="Currency">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {CURRENCIES.map((c) => {
                  const sel = effectiveCurrency === c.code;
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

          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-slate-700">Line items</Text>
              <Pressable onPress={addItem}>
                <Text className="text-sm font-medium text-emerald-700">+ Add item</Text>
              </Pressable>
            </View>

            {items.map((it) => (
              <View key={it.key} className="rounded-md border border-slate-200 bg-white p-3">
                <View className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <Input
                      placeholder="Item label"
                      value={it.label}
                      onChangeText={(v) => setItem(it.key, { label: v })}
                    />
                  </View>
                  <View className="w-28">
                    <Input
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      value={it.amount}
                      onChangeText={(v) => setItem(it.key, { amount: v })}
                    />
                  </View>
                  <Pressable onPress={() => removeItem(it.key)}>
                    <Text className="text-rose-600">✕</Text>
                  </Pressable>
                </View>
                <View className="mt-2 flex-row flex-wrap gap-2">
                  {members.map((m) => {
                    const sel = it.assigneeIds.includes(m.id);
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => toggleAssignee(it.key, m.id)}
                        className={`rounded-full border px-3 py-1 ${sel ? 'border-emerald-400 bg-emerald-100' : 'border-slate-200 bg-white'}`}
                      >
                        <Text className={`text-xs ${sel ? 'text-emerald-900' : 'text-slate-500'}`}>
                          {m.displayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Field label="Tax">
                <Input
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  value={tax}
                  onChangeText={setTax}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Tip">
                <Input
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  value={tip}
                  onChangeText={setTip}
                />
              </Field>
            </View>
          </View>

          <Field label="Tip distribution">
            <View className="flex-row gap-2">
              {(['PRO_RATA', 'EQUAL'] as const).map((m) => {
                const sel = tipMode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setTipMode(m)}
                    className={`flex-1 rounded-md border px-3 py-2 ${sel ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={`text-center text-sm ${sel ? 'text-white' : 'text-slate-700'}`}>
                      {m === 'PRO_RATA' ? 'Pro-rata' : 'Equal'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          {preview ? (
            <InfoBanner kind="success">
              <View>
                <Text className="text-sm text-emerald-900">
                  Subtotal {formatMoney(preview.subtotal, effectiveCurrency)} · Total{' '}
                  {formatMoney(preview.total, effectiveCurrency)}
                </Text>
                {perUser.map((u) => {
                  const member = members.find((m) => m.id === u.userId);
                  return (
                    <Text key={u.userId} className="mt-1 text-xs text-emerald-800">
                      {member?.displayName ?? 'Member'}: {formatMoney(u.amount, effectiveCurrency)}
                    </Text>
                  );
                })}
              </View>
            </InfoBanner>
          ) : (
            <InfoBanner>Add at least one item with a label, amount, and assignee.</InfoBanner>
          )}

          <ErrorBanner error={error} />

          <Button
            onPress={submit}
            disabled={!!validationError || !preview || create.isPending}
            loading={create.isPending}
          >
            Save itemized expense
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
