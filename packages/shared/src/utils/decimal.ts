import Decimal from 'decimal.js';

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9,
  toExpPos: 21,
});

export { Decimal };

export type DecimalLike = Decimal | string | number;

export const D = (v: DecimalLike): Decimal => new Decimal(v);

export const ZERO = new Decimal(0);

export const toFixed2 = (v: DecimalLike): string => new Decimal(v).toFixed(2);

export const isZero = (v: DecimalLike): boolean => new Decimal(v).isZero();

export const eq = (a: DecimalLike, b: DecimalLike): boolean =>
  new Decimal(a).equals(new Decimal(b));

export const sum = (values: readonly DecimalLike[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);
