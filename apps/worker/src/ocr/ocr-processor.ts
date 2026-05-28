import { type PrismaClient } from '@prisma/client';
import { type S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Logger } from 'pino';
import { parseReceipt } from './receipt-parser.js';
import { preprocessReceiptImage } from './preprocess.js';
import type { OcrProvider } from './provider.js';

export interface OcrJobPayload {
  receiptScanId: string;
  objectKey: string;
  bucket: string;
  contentType: string;
}

export interface OcrProcessorDeps {
  prisma: PrismaClient;
  s3: S3Client;
  provider: OcrProvider;
  log: Logger;
}

async function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Process one OCR job:
 *   1. Mark scan PROCESSING
 *   2. Download image from S3
 *   3. Preprocess with sharp (downscale, greyscale, normalize, threshold)
 *   4. Run OCR via provider
 *   5. Parse text → ReceiptOcrResult
 *   6. Persist parsed payload + mark PARSED (or FAILED on error)
 *   7. Write a RECEIPT_READY notification row so the client can surface it
 */
export async function processOcrJob(
  deps: OcrProcessorDeps,
  payload: OcrJobPayload,
): Promise<void> {
  const { prisma, s3, provider, log } = deps;
  const { receiptScanId, objectKey, bucket } = payload;
  const childLog = log.child({ receiptScanId, provider: provider.name });

  childLog.info('starting OCR job');
  const scanRow = await prisma.receiptScan.update({
    where: { id: receiptScanId },
    data: { status: 'PROCESSING' },
    select: { userId: true },
  });

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!obj.Body) throw new Error('S3 object has no body');
    const raw = await streamToBuffer(obj.Body as unknown as AsyncIterable<Uint8Array>);

    const preprocessed = await preprocessReceiptImage(raw);
    const ocr = await provider.recognize(preprocessed, { documentKind: 'receipt' });
    const parsed = parseReceipt(ocr.text);

    childLog.info(
      { items: parsed.items.length, total: parsed.total, warnings: parsed.warnings.length },
      'OCR + parse done',
    );

    await prisma.$transaction(async (tx) => {
      await tx.receiptScan.update({
        where: { id: receiptScanId },
        data: {
          status: 'PARSED',
          rawOcrText: ocr.text,
          parsedItems: parsed as unknown as object,
          parsedTotal: parsed.total,
          parsedCurrency: parsed.currency,
          processedAt: new Date(),
          errorMessage: null,
        },
      });
      await tx.notification.create({
        data: {
          userId: scanRow.userId,
          kind: 'RECEIPT_READY',
          title: 'Receipt ready',
          body: parsed.merchant
            ? `Items extracted from ${parsed.merchant} — tap to itemize.`
            : 'Items extracted from your receipt — tap to itemize.',
          data: { receiptScanId, itemCount: parsed.items.length },
        },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    childLog.error({ err }, 'OCR job failed');
    await prisma.receiptScan.update({
      where: { id: receiptScanId },
      data: {
        status: 'FAILED',
        errorMessage: message,
        processedAt: new Date(),
      },
    });
    throw err;
  }
}
