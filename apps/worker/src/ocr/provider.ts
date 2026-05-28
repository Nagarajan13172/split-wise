/**
 * Pluggable OCR backend. The processor is decoupled from the OCR vendor —
 * swapping to Claude vision or Google Vision is a one-file change.
 */
export interface OcrProvider {
  readonly name: string;
  /**
   * Run OCR over an image buffer and return the raw text. Image is already
   * downloaded + preprocessed by the caller.
   */
  recognize(image: Buffer, hints?: OcrHints): Promise<OcrRecognizeResult>;
}

export interface OcrHints {
  /** ISO 639-1/639-2 language code, e.g. 'eng', 'fra'. */
  language?: string;
  /** Hint about expected output (e.g. 'receipt') for vendor models. */
  documentKind?: 'receipt' | 'general';
}

export interface OcrRecognizeResult {
  text: string;
  /** Confidence in [0, 1] if the backend provides it; otherwise undefined. */
  confidence?: number;
  /** Raw vendor payload for debugging / future feature use. */
  raw?: unknown;
}
