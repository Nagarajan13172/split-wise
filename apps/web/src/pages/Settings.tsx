import { useEffect, useState } from 'react';
import { CURRENCIES, formatMoney } from '@split-wise/shared';
import { Banner, Button, Field, FormError } from '../components/ui.js';
import { trpc } from '../lib/trpc.js';
import { navigate } from '../router.js';

export function Settings() {
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
        // Balances depend on home currency rollup — invalidate everywhere.
        utils.expenses.forGroup.invalidate(),
      ]);
      // Brief acknowledgement; clear after a moment so users can change again.
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (me.isLoading) {
    return <main className="mx-auto max-w-2xl px-6 py-12 text-sm text-slate-500">Loading…</main>;
  }

  const sampleConversion = (() => {
    if (!fx.data) return null;
    const rate = fx.data.rates[home];
    if (!rate) return null;
    return formatMoney((Number(rate) * 100).toFixed(2), home);
  })();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <button onClick={() => navigate('/')} className="text-xs text-slate-500 hover:underline">
        ← All groups
      </button>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-slate-600">Signed in as {me.data?.email}</p>

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Home currency
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Balances and totals are displayed in your home currency. Individual expenses still show
          their native currency.
        </p>
        <div className="mt-4 space-y-3">
          <Field label="Home currency" htmlFor="home-cur">
            <select
              id="home-cur"
              value={home}
              onChange={(e) => setHome(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>

          {sampleConversion && (
            <p className="text-xs text-slate-500">
              Live preview · €100 EUR ≈ {sampleConversion} ({home})
              {fx.data?.asOf ? ` · rates as of ${fx.data.asOf.slice(0, 10)}` : ''}
            </p>
          )}
          {!fx.data && (
            <p className="text-xs text-amber-700">
              FX rates aren&apos;t available yet — totals will fall back to per-currency.
            </p>
          )}

          {update.error && <FormError error={update.error.message} />}
          {saved && <Banner kind="success">Home currency updated.</Banner>}

          <Button
            onClick={() => update.mutate({ homeCurrency: home })}
            disabled={update.isPending || home === me.data?.homeCurrency}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </section>
    </main>
  );
}
