import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'splitwise.refreshToken';

export async function getStoredRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setStoredRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_KEY, token);
}

export async function clearStoredRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
