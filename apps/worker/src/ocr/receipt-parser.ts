import { D, type DecimalLike } from '@split-wise/shared';
import type { ReceiptOcrResult, ReceiptOcrItem } from '@split-wise/shared';

/**
 * Regex-and-heuristics parser for receipt OCR text. Tesseract output is noisy,
 * so this prioritises reasonable extraction over perfection — the editor surfaces
 * the result and lets the user fix it.
 *
 * Strategy:
 *   1. Tokenise into lines, strip empties, normalise spacing.
 *   2. The "merchant" is the first non-empty, non-numeric line.
 *   3. Find a "total" line — last occurrence of /total/i + amount wins.
 *   4. Find subtotal / tax / tip lines independently.
 *   5. Everything between the merchant and the totals block is candidate items.
 *   6. An item line ends in a money amount; we extract `label` (left side) +
 *      `amount` (right side) + optional `x2` quantity hint.
 *   7. Reject obvious non-items (lines matching subtotal/tax/tip/total).
 *
 * If we can't find a total, we fall back to summing the items.
 */

const MONEY_RX = /(\d{1,4}(?:[.,]\d{2,3}))/;
const TRAILING_MONEY_RX = /^(.*?)\s+(\d{1,4}(?:[.,]\d{2,3}))\s*$/;
const QUANTITY_RX = /\s+x\s*(\d+)\s*$/i;
const TOTAL_RX = /^(?:grand\s+)?total\b/i;
const SUBTOTAL_RX = /^sub[\s-]?total\b/i;
const TAX_RX = /^(?:tax|vat|gst|hst)\b/i;
const TIP_RX = /^(?:tip|gratuity|service\s*charge)\b/i;
const CURRENCY_SYMBOL_RX = /([$€£¥₹])\s*\d/;
const CURRENCY_CODE_RX = /\b(USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|SGD|AED|BRL|MXN|KRW|CNY)\b/i;
// receipt-meta lines we want to ignore when scanning for items
const NOISE_RX = /^(?:thank|change|cash|card|visa|mc|mastercard|amex|debit|balance|tendered|order|table|server|cashier|store|invoice|receipt|date|time|customer|terminal|ref|txn|approval)\b/i;

const SYMBOL_TO_CODE: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY', // ambiguous with CNY — UI will let user override
  '₹': 'INR',
};

function normalise(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function parseAmount(s: string): string | null {
  const m = s.match(MONEY_RX);
  if (!m) return null;
  // tolerate "1.234" (european thousands) by length check
  const raw = m[1]!.replace(/,/g, '.');
  // if the fractional has 3 digits, treat as decimal-comma thousands ("1.234,56" → "1234.56")
  const parts = raw.split('.');
  if (parts.length === 2 && parts[1]!.length === 3) {
    return parts.join('');
  }
  // sanity: parses as decimal
  try {
    return D(raw).toFixed(2);
  } catch {
    return null;
  }
}

function findLineAmount(line: string, rx: RegExp): string | null {
  if (!rx.test(line)) return null;
  const m = line.match(MONEY_RX);
  return m ? parseAmount(m[1]!) : null;
}

function detectCurrency(text: string): string | undefined {
  const codeMatch = text.match(CURRENCY_CODE_RX);
  if (codeMatch) return codeMatch[1]!.toUpperCase();
  const symMatch = text.match(CURRENCY_SYMBOL_RX);
  if (symMatch) return SYMBOL_TO_CODE[symMatch[1]!];
  return undefined;
}

function isItemizable(line: string): boolean {
  if (!TRAILING_MONEY_RX.test(line)) return false;
  if (TOTAL_RX.test(line) || SUBTOTAL_RX.test(line) || TAX_RX.test(line) || TIP_RX.test(line)) return false;
  if (NOISE_RX.test(line)) return false;
  // Reject lines that look like dates / times only
  if (/^\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?$/.test(line)) return false;
  return true;
}

export function parseReceipt(rawText: string): ReceiptOcrResult {
  const warnings: string[] = [];
  const lines = rawText
    .split(/\r?\n/)
    .map(normalise)
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      items: [],
      total: '0.00',
      warnings: ['empty OCR text'],
    };
  }

  // merchant: first non-numeric line
  let merchant: string | undefined;
  for (const line of lines) {
    if (!MONEY_RX.test(line) && !/^\d+$/.test(line)) {
      merchant = line;
      break;
    }
  }

  // totals
  let subtotal: string | undefined;
  let tax: string | undefined;
  let tip: string | undefined;
  let total: string | undefined;

  // search totals — prefer last match for "total" (handles "subtotal" appearing first)
  for (const line of lines) {
    if (!subtotal) {
      const v = findLineAmount(line, SUBTOTAL_RX);
      if (v) subtotal = v;
    }
    if (!tax) {
      const v = findLineAmount(line, TAX_RX);
      if (v) tax = v;
    }
    if (!tip) {
      const v = findLineAmount(line, TIP_RX);
      if (v) tip = v;
    }
    const totalCandidate = findLineAmount(line, TOTAL_RX);
    if (totalCandidate) total = totalCandidate; // last one wins
  }

  // items
  const items: ReceiptOcrItem[] = [];
  for (const line of lines) {
    if (!isItemizable(line)) continue;
    const m = line.match(TRAILING_MONEY_RX);
    if (!m) continue;
    const labelRaw = m[1]!;
    const amount = parseAmount(m[2]!);
    if (!amount || amount === '0.00') continue;
    // quantity hint
    let quantity = 1;
    let label = labelRaw;
    const q = labelRaw.match(QUANTITY_RX);
    if (q) {
      quantity = Math.max(1, Number(q[1]) || 1);
      label = labelRaw.replace(QUANTITY_RX, '').trim();
    }
    if (label.length === 0) continue;
    items.push({ label, amount, quantity });
  }

  // fallback total = sum of items + tax + tip if no explicit total
  if (!total) {
    if (items.length > 0) {
      let sum: DecimalLike = '0';
      for (const it of items) sum = D(sum).plus(it.amount);
      let computed = D(sum);
      if (tax) computed = computed.plus(tax);
      if (tip) computed = computed.plus(tip);
      total = computed.toFixed(2);
      warnings.push('total inferred from items + tax + tip');
    } else {
      total = '0.00';
      warnings.push('no total or items detected');
    }
  }

  // sanity: items sum should be close to subtotal (or total - tax - tip)
  if (items.length > 0 && subtotal) {
    let itemsSum = D(0);
    for (const it of items) itemsSum = itemsSum.plus(it.amount);
    const drift = itemsSum.minus(subtotal).abs();
    if (drift.greaterThan('1.00')) {
      warnings.push(
        `items sum ${itemsSum.toFixed(2)} differs from subtotal ${subtotal} by ${drift.toFixed(2)}`,
      );
    }
  }

  return {
    merchant,
    items,
    subtotal,
    tax,
    tip,
    total: total ?? '0.00',
    currency: detectCurrency(rawText),
    warnings,
  };
}
