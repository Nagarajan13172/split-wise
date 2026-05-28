import type { OcrProvider, OcrRecognizeResult } from './provider.js';

/**
 * Deterministic stub. Used in tests and in dev when Tesseract isn't installed.
 * The text is intentionally similar to a real grocery / restaurant receipt
 * so the parser has something realistic to chew on.
 */
const FIXTURE = `Trattoria Luigi
123 Main Street
2026-04-12 19:42

Margherita Pizza       18.50
Caesar Salad            12.00
Tiramisu                 8.50
Sparkling Water  x2      6.00

Subtotal                45.00
Tax                      3.94
Tip                      8.00
Total                   56.94

Thank you!
`;

export class StubOcrProvider implements OcrProvider {
  readonly name = 'stub';
  constructor(private readonly text: string = FIXTURE) {}

  async recognize(): Promise<OcrRecognizeResult> {
    return { text: this.text, confidence: 0.95 };
  }
}
