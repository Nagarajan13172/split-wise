import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { S3Service } from '../../common/s3/s3.service.js';
import { QueueService } from '../../common/queue/queue.service.js';

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB — phone receipts are well under this

@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {}

  /**
   * Reserve a receipt scan slot and return a presigned URL for direct upload.
   * The client PUTs the image bytes directly to S3/R2, then calls `enqueue()`.
   */
  async createUploadUrl(input: {
    actorId: string;
    contentType: string;
    byteSize: number;
  }) {
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `unsupported contentType ${input.contentType}; allowed: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`,
      });
    }
    if (input.byteSize <= 0 || input.byteSize > MAX_UPLOAD_BYTES) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `byteSize must be between 1 and ${MAX_UPLOAD_BYTES}`,
      });
    }

    const objectKey = `receipts/${input.actorId}/${Date.now()}-${randomBytes(8).toString('hex')}`;
    const scan = await this.prisma.receiptScan.create({
      data: {
        userId: input.actorId,
        objectKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
        status: 'UPLOADED',
      },
    });

    const uploadUrl = await this.s3.presignUpload({
      bucket: this.s3.receiptsBucket,
      key: objectKey,
      contentType: input.contentType,
    });

    return {
      receiptScanId: scan.id,
      uploadUrl,
      objectKey,
      bucket: this.s3.receiptsBucket,
    };
  }

  /** Kick off the OCR pipeline. Idempotent — re-enqueue is safe. */
  async enqueueScan(actorId: string, receiptScanId: string) {
    const scan = await this.prisma.receiptScan.findFirst({
      where: { id: receiptScanId, userId: actorId },
    });
    if (!scan) throw new TRPCError({ code: 'NOT_FOUND', message: 'receipt scan not found' });
    if (scan.status === 'CONFIRMED') {
      throw new TRPCError({ code: 'CONFLICT', message: 'scan already finalized' });
    }
    await this.queue.enqueueOcr({
      receiptScanId: scan.id,
      objectKey: scan.objectKey,
      bucket: this.s3.receiptsBucket,
      contentType: scan.contentType,
    });
    return { ok: true };
  }

  /** Poll for status + parsed payload. Used by the itemize editor. */
  async getScan(actorId: string, receiptScanId: string) {
    const scan = await this.prisma.receiptScan.findFirst({
      where: { id: receiptScanId, userId: actorId },
    });
    if (!scan) throw new TRPCError({ code: 'NOT_FOUND', message: 'receipt scan not found' });
    return {
      id: scan.id,
      status: scan.status,
      contentType: scan.contentType,
      objectKey: scan.objectKey,
      parsedTotal: scan.parsedTotal ? scan.parsedTotal.toFixed(2) : null,
      parsedCurrency: scan.parsedCurrency ?? null,
      parsedItems: scan.parsedItems ?? null,
      errorMessage: scan.errorMessage ?? null,
      createdAt: scan.createdAt.toISOString(),
      processedAt: scan.processedAt?.toISOString() ?? null,
    };
  }

  /** Mark a scan CONFIRMED — called after expense.create with the receiptScanId. */
  async markConfirmed(actorId: string, receiptScanId: string) {
    const scan = await this.prisma.receiptScan.findFirst({
      where: { id: receiptScanId, userId: actorId },
    });
    if (!scan) throw new TRPCError({ code: 'NOT_FOUND', message: 'receipt scan not found' });
    if (scan.status === 'CONFIRMED') return;
    await this.prisma.receiptScan.update({
      where: { id: scan.id },
      data: { status: 'CONFIRMED' },
    });
  }

  async deleteScan(actorId: string, receiptScanId: string) {
    const scan = await this.prisma.receiptScan.findFirst({
      where: { id: receiptScanId, userId: actorId },
    });
    if (!scan) throw new TRPCError({ code: 'NOT_FOUND', message: 'receipt scan not found' });
    // best-effort S3 cleanup
    try {
      await this.s3.deleteObject(this.s3.receiptsBucket, scan.objectKey);
    } catch {
      /* ignore — DB record is the source of truth */
    }
    await this.prisma.receiptScan.delete({ where: { id: scan.id } });
  }
}
