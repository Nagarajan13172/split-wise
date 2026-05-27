export interface CategoryInfo {
  key: string;
  label: string;
  icon: string;
  parent?: string;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { key: 'food.dining', label: 'Dining out', icon: '🍽️', parent: 'food' },
  { key: 'food.groceries', label: 'Groceries', icon: '🛒', parent: 'food' },
  { key: 'food.coffee', label: 'Coffee', icon: '☕', parent: 'food' },
  { key: 'transport.taxi', label: 'Taxi / rideshare', icon: '🚕', parent: 'transport' },
  { key: 'transport.fuel', label: 'Fuel', icon: '⛽', parent: 'transport' },
  { key: 'transport.flights', label: 'Flights', icon: '✈️', parent: 'transport' },
  { key: 'transport.transit', label: 'Public transit', icon: '🚆', parent: 'transport' },
  { key: 'housing.rent', label: 'Rent', icon: '🏠', parent: 'housing' },
  { key: 'housing.utilities', label: 'Utilities', icon: '💡', parent: 'housing' },
  { key: 'housing.internet', label: 'Internet', icon: '📶', parent: 'housing' },
  { key: 'entertainment.movies', label: 'Movies', icon: '🎬', parent: 'entertainment' },
  { key: 'entertainment.events', label: 'Events / tickets', icon: '🎫', parent: 'entertainment' },
  { key: 'travel.lodging', label: 'Lodging', icon: '🏨', parent: 'travel' },
  { key: 'travel.activities', label: 'Activities', icon: '🗺️', parent: 'travel' },
  { key: 'shopping.general', label: 'Shopping', icon: '🛍️', parent: 'shopping' },
  { key: 'health.medical', label: 'Medical', icon: '🏥', parent: 'health' },
  { key: 'other', label: 'Other', icon: '📌' },
] as const;

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
