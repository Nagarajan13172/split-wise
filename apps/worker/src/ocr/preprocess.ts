import sharp from 'sharp';

/**
 * Receipt OCR preprocessor. Tesseract accuracy collapses on phone photos
 * unless we (a) downscale, (b) convert to greyscale, (c) normalize contrast,
 * and (d) apply an adaptive threshold so text becomes near-pure black on white.
 *
 * Returns a PNG buffer ready to feed to the OCR provider. The provider can
 * write it to a temp file (Tesseract CLI requires a path).
 */
export interface PreprocessOptions {
  /** Long edge in pixels after downscale. 1600 is a good Tesseract sweet spot. */
  maxDimension?: number;
}

export async function preprocessReceiptImage(
  input: Buffer,
  opts: PreprocessOptions = {},
): Promise<Buffer> {
  const maxDim = opts.maxDimension ?? 1600;

  const pipeline = sharp(input, { failOn: 'none' })
    .rotate() // honour EXIF orientation
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize() // stretches contrast to use full 0-255 range
    .median(1) // small de-noise; bigger kernels eat thin glyphs
    .sharpen({ sigma: 0.8 })
    .threshold(160) // hard B/W — Tesseract loves high-contrast input
    .png();

  return pipeline.toBuffer();
}
