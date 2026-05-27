export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', decimals: 2 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0 },
] as const;

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export const isCurrencyCode = (code: string): boolean =>
  CURRENCY_CODES.includes(code);

export const getCurrency = (code: string): CurrencyInfo | undefined =>
  CURRENCIES.find((c) => c.code === code);
