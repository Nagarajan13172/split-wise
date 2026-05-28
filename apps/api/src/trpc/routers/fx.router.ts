import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';
import { type FxService } from '../../modules/fx/fx.service.js';

let fxService: FxService;

export function attachFxServices(s: { fx: FxService }) {
  fxService = s.fx;
}

export const fxRouter = router({
  /** Latest base→quote rates + the asOf date. Returns null if no rates yet. */
  latest: protectedProcedure.query(async () => {
    const snap = await fxService.latestSnapshot();
    if (!snap) return null;
    return {
      base: snap.table.base,
      asOf: snap.asOf,
      rates: snap.table.rates,
    };
  }),

  /** One-off convert — handy for ad-hoc UI like "what is 50 EUR in USD?" */
  convert: protectedProcedure
    .input(
      z.object({
        amount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
        from: z.string().length(3),
        to: z.string().length(3),
      }),
    )
    .query(async ({ input }) => {
      const result = await fxService.convert(input.amount, input.from, input.to);
      return result == null ? { ok: false as const } : { ok: true as const, amount: result.toFixed(4) };
    }),
});
