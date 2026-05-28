import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { zGroupCreate, type GroupCreateDTO, CURRENCIES, formatMoney } from '@split-wise/shared';
import { Button, Banner, Field, FormError, Input } from '../components/ui.js';
import { trpc } from '../lib/trpc.js';
import { useAuth } from '../lib/auth.js';
import { navigate } from '../router.js';

export function Groups() {
  const me = trpc.auth.me.useQuery();
  const list = trpc.groups.list.useQuery();
  const activity = trpc.expenses.activity.useQuery({ limit: 20 });
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      useAuth.getState().clear();
      navigate('/sign-in');
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const form = useForm<GroupCreateDTO>({
    resolver: zodResolver(zGroupCreate),
    defaultValues: {
      name: '',
      defaultCurrency: me.data?.homeCurrency ?? 'USD',
      simplifyDebts: true,
    },
  });
  const create = trpc.groups.create.useMutation({
    onSuccess: async (g) => {
      await utils.groups.list.invalidate();
      setShowCreate(false);
      form.reset();
      navigate(`/groups/${g.id}`);
    },
    onError: (err) => setCreateError(err.message),
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your groups</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {me.data?.email ?? '…'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : 'New group'}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/settings')}>
            Settings
          </Button>
          <Button variant="ghost" onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </header>

      {me.data && !me.data.emailVerifiedAt ? (
        <div className="mt-6">
          <Banner kind="info">
            Your email isn't verified yet — check Mailpit at{' '}
            <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="underline">
              http://localhost:8025
            </a>
            .
          </Banner>
        </div>
      ) : null}

      {showCreate && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            New group
          </h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={form.handleSubmit((v) => {
              setCreateError(null);
              create.mutate(v);
            })}
          >
            <Field label="Name" htmlFor="g-name" error={form.formState.errors.name?.message}>
              <Input id="g-name" placeholder="Apartment, Bali trip…" {...form.register('name')} />
            </Field>
            <Field
              label="Default currency"
              htmlFor="g-cur"
              error={form.formState.errors.defaultCurrency?.message}
            >
              <select
                id="g-cur"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                {...form.register('defaultCurrency')}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('simplifyDebts')} />
              Simplify debts (recommend the fewest settlements)
            </label>
            <FormError error={createError} />
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create group'}
            </Button>
          </form>
        </section>
      )}

      <section className="mt-8 space-y-3">
        {list.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : list.error ? (
          <FormError error={list.error.message} />
        ) : list.data && list.data.length === 0 ? (
          <Banner kind="info">
            No groups yet. Tap <strong>New group</strong> to create your first one.
          </Banner>
        ) : (
          list.data?.map((g) => (
            <button
              key={g.id}
              onClick={() => navigate(`/groups/${g.id}`)}
              className="w-full rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">{g.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {g.memberCount} member{g.memberCount === 1 ? '' : 's'} ·{' '}
                    {g.defaultCurrency}
                  </p>
                </div>
                <span className="text-xs text-slate-400">→</span>
              </div>
            </button>
          ))
        )}
      </section>

      {activity.data && activity.data.items.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recent activity
          </h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {activity.data.items.map((it) => (
              <li key={`${it.kind}:${it.id}`}>
                <button
                  onClick={() => navigate(`/groups/${it.group.id}`)}
                  className="flex w-full items-start justify-between gap-2 px-5 py-3 text-left hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {it.icon ? `${it.icon} ` : ''}
                      {it.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {it.group.name} · {it.subtitle}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(it.occurredAt).toLocaleDateString()}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatMoney(it.amount, it.currency)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
