import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recognize } from 'node-tesseract-ocr';
import type { OcrHints, OcrProvider, OcrRecognizeResult } from './provider.js';

/**
 * Self-hosted Tesseract via `node-tesseract-ocr`, which shells out to the
 * `tesseract` CLI. The CLI must be installed on the host (apk add tesseract-ocr
 * in the worker Dockerfile). Language packs are passed via the `lang` option.
 */
export interface TesseractOptions {
  /** Tesseract language code(s), e.g. 'eng' or 'eng+fra'. */
  lang?: string;
  /** Page segmentation mode. 6 = "assume a uniform block of text" — works well for receipts. */
  psm?: number;
  /** Optional override for the tesseract binary path. */
  binary?: string;
}

export class TesseractOcrProvider implements OcrProvider {
  readonly name = 'tesseract';
  private readonly defaultLang: string;
  private readonly psm: number;
  private readonly binary?: string;

  constructor(opts: TesseractOptions = {}) {
    this.defaultLang = opts.lang ?? 'eng';
    this.psm = opts.psm ?? 6;
    this.binary = opts.binary;
  }

  async recognize(image: Buffer, hints?: OcrHints): Promise<OcrRecognizeResult> {
    const lang = hints?.language ?? this.defaultLang;
    const dir = await mkdtemp(join(tmpdir(), 'ocr-'));
    const file = join(dir, 'page.png');
    try {
      await writeFile(file, image);
      const text = await recognize(file, {
        lang,
        oem: 1, // LSTM only
        psm: this.psm,
        ...(this.binary ? { binary: this.binary } : {}),
      });
      return { text };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
