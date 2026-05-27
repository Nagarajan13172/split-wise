import { trpc } from './lib/trpc.js';

export function App() {
  const ping = trpc.ping.useQuery();
  const health = trpc.health.useQuery();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Splitwise</h1>
      <p className="mt-2 text-slate-600">Phase 0 — foundation smoke test.</p>

      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          tRPC: ping
        </h2>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs">
          {ping.isLoading
            ? 'loading…'
            : ping.error
              ? `error: ${ping.error.message}`
              : JSON.stringify(ping.data, null, 2)}
        </pre>
      </section>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          tRPC: health (db + redis)
        </h2>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs">
          {health.isLoading
            ? 'loading…'
            : health.error
              ? `error: ${health.error.message}`
              : JSON.stringify(health.data, null, 2)}
        </pre>
      </section>
    </main>
  );
}
