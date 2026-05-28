import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CURRENCIES, formatMoney } from '@split-wise/shared';
import {
  Button,
  ErrorBanner,
  Field,
  H1,
  InfoBanner,
  Screen,
  Sub,
} from '../src/components/ui';
import { trpc } from '../src/lib/trpc';

export default function SettingsScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const fx = trpc.fx.latest.useQuery();
  const [home, setHome] = useState<string>('USD');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me.data?.homeCurrency) setHome(me.data.homeCurrency);
  }, [me.data?.homeCurrency]);

  const update = trpc.auth.updateHomeCurrency.useMutation({
    onSuccess: async () => {
      setSaved(true);
      await Promise.all([
        utils.auth.me.invalidate(),
        utils.expenses.forGroup.invalidate(),
      ]);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const preview = useMemo(() => {
    if (!fx.data) return null;
    const rate = fx.data.rates[home];
    if (!rate) return null;
    return formatMoney((Number(rate) * 100).toFixed(2), home);
  }, [fx.data, home]);

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <Button variant="ghost" onPress={() => router.back()}>
          ← Back
        </Button>
        <View className="mt-2">
          <H1>Settings</H1>
          <Sub>{me.data?.email ?? '…'}</Sub>
        </View>

        <View className="mt-6 gap-3">
          <Field label="Home currency">
            <Text className="text-xs text-slate-500">
              Balances and totals are converted to this currency. Individual expenses still show
              their native currency.
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {CURRENCIES.map((c) => {
                const sel = home === c.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => setHome(c.code)}
                    className={`rounded-full border px-3 py-2 ${sel ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={sel ? 'text-white' : 'text-slate-700'}>
                      {c.symbol} {c.code}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          {preview ? (
            <InfoBanner>
              Live preview · €100 EUR ≈ {preview} ({home})
              {fx.data?.asOf ? ` · rates as of ${fx.data.asOf.slice(0, 10)}` : ''}
            </InfoBanner>
          ) : (
            <InfoBanner>
              FX rates aren&apos;t available yet — totals will fall back to per-currency.
            </InfoBanner>
          )}

          {update.error ? <ErrorBanner error={update.error.message} /> : null}
          {saved ? <InfoBanner kind="success">Home currency updated.</InfoBanner> : null}

          <Button
            onPress={() => update.mutate({ homeCurrency: home })}
            disabled={update.isPending || home === me.data?.homeCurrency}
            loading={update.isPending}
          >
            Save
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
