import { create } from 'zustand';
import {
  clearStoredRefreshToken,
  setStoredRefreshToken,
} from './secure-store';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  ready: boolean;

  setReady: () => void;
  /** Persist refresh token to SecureStore and set in-memory state. */
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => Promise<void>;
  /** In-memory only (used after refresh; refresh token also rotates). */
  setSessionWithoutPersist: (user: AuthUser, accessToken: string) => void;
  clear: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  ready: false,
  setReady: () => set({ ready: true }),
  setSession: async (user, accessToken, refreshToken) => {
    await setStoredRefreshToken(refreshToken);
    set({ user, accessToken });
  },
  setSessionWithoutPersist: (user, accessToken) => set({ user, accessToken }),
  clear: async () => {
    await clearStoredRefreshToken();
    set({ user: null, accessToken: null });
  },
}));

export const getAccessToken = () => useAuth.getState().accessToken;
