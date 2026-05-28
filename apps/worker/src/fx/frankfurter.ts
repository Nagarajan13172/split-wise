/**
 * Frankfurter API client. https://api.frankfurter.app/
 * Free, no API key, ECB-sourced, updated daily around 16:00 CET.
 *
 * We pull `/latest?from=EUR&to=<comma-list>` so the response is
 * EUR→quote rates — matching our locked architecture choice ("base=EUR").
 */
const FRANKFURTER_BASE = process.env.FRANKFURTER_BASE_URL ?? 'https://api.frankfurter.app';

/** Quote currencies we keep rates for. EUR is the base, so it's not listed. */
export const FX_QUOTE_CODES = [
  'USD', 'GBP', 'INR', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'SGD', 'AED', 'BRL', 'MXN', 'KRW',
] as const;

export interface FrankfurterLatestResponse {
  amount: number;
  base: string;
  date: string; // ISO date "YYYY-MM-DD"
  rates: Record<string, number>;
}

export async function fetchLatestRates(opts: { signal?: AbortSignal } = {}): Promise<FrankfurterLatestResponse> {
  const url = new URL('/latest', FRANKFURTER_BASE);
  url.searchParams.set('from', 'EUR');
  url.searchParams.set('to', FX_QUOTE_CODES.join(','));
  const res = await fetch(url.toString(), { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`frankfurter ${url.pathname} → HTTP ${res.status}`);
  }
  const body = (await res.json()) as FrankfurterLatestResponse;
  if (!body || body.base !== 'EUR' || typeof body.rates !== 'object' || !body.date) {
    throw new Error(`frankfurter response malformed: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}
