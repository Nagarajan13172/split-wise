import { z } from 'zod';
import { Decimal } from '../utils/decimal.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

/** Money values cross the wire as strings to avoid float drift. */
export const zMoney = z
  .string()
  .regex(/^-?\d+(\.\d{1,8})?$/, 'must be a decimal string like "12.34"')
  .refine((s) => {
    try {
      new Decimal(s);
      return true;
    } catch {
      return false;
    }
  }, 'must parse as a Decimal');

export const zPositiveMoney = zMoney.refine(
  (s) => new Decimal(s).greaterThan(0),
  'must be greater than 0',
);

export const zNonNegativeMoney = zMoney.refine(
  (s) => new Decimal(s).greaterThanOrEqualTo(0),
  'must be >= 0',
);

export const zCurrencyCode = z.enum(CURRENCY_CODES as [string, ...string[]]);

export const zCuid = z.string().min(1).max(50);

export const zIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?)?$/, 'invalid ISO date');
