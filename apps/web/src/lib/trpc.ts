import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '@split-wise/api/src/trpc/app.router.js';
import { getAccessToken, useAuth } from './auth.js';

export const trpc = createTRPCReact<AppRouter>();

/** Tracks an in-flight refresh so concurrent 401s coalesce into one request. */
let refreshInFlight: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/trpc/auth.refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: {} }),
      });
      if (!res.ok) {
        useAuth.getState().clear();
        return false;
      }
      const body = await res.json();
      const data = body?.result?.data?.json;
      if (!data?.accessToken) {
        useAuth.getState().clear();
        return false;
      }
      useAuth.getState().setSession(data.user, data.accessToken);
      return true;
    } catch {
      useAuth.getState().clear();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      transformer: superjson,
      async headers() {
        const token = getAccessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      async fetch(url, opts) {
        const doFetch = (extraHeaders?: HeadersInit) => {
          const merged = new Headers(opts?.headers);
          if (extraHeaders) new Headers(extraHeaders).forEach((v, k) => merged.set(k, v));
          return fetch(url, { ...opts, headers: merged, credentials: 'include' });
        };
        let res = await doFetch();
        if (res.status === 401) {
          const refreshed = await attemptRefresh();
          if (refreshed) {
            const token = getAccessToken();
            res = await doFetch(token ? { authorization: `Bearer ${token}` } : undefined);
          }
        }
        return res;
      },
    }),
  ],
});

/** Best-effort silent refresh on app start so a returning user lands on the home screen. */
export async function bootstrapSession(): Promise<void> {
  await attemptRefresh();
  useAuth.getState().setReady();
}
