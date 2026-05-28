import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { type ReceiptsService } from '../../modules/receipts/receipts.service.js';

let receiptsService: ReceiptsService;

export function attachReceiptsServices(s: { receipts: ReceiptsService }) {
  receiptsService = s.receipts;
}

const zContentType = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export const receiptsRouter = router({
  createUploadUrl: protectedProcedure
    .input(
      z.object({
        contentType: zContentType,
        byteSize: z.number().int().min(1).max(8 * 1024 * 1024),
      }),
    )
    .mutation(({ ctx, input }) =>
      receiptsService.createUploadUrl({
        actorId: ctx.user.id,
        contentType: input.contentType,
        byteSize: input.byteSize,
      }),
    ),

  enqueue: protectedProcedure
    .input(z.object({ receiptScanId: z.string() }))
    .mutation(({ ctx, input }) => receiptsService.enqueueScan(ctx.user.id, input.receiptScanId)),

  get: protectedProcedure
    .input(z.object({ receiptScanId: z.string() }))
    .query(({ ctx, input }) => receiptsService.getScan(ctx.user.id, input.receiptScanId)),

  delete: protectedProcedure
    .input(z.object({ receiptScanId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await receiptsService.deleteScan(ctx.user.id, input.receiptScanId);
      return { ok: true };
    }),
});
