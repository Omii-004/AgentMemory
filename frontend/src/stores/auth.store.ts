import { create } from 'zustand';
import { getStoredToken, setStoredToken, setUnauthorizedHandler } from '@/services/api-client';
import { fetchCurrentUser, loginUser, logoutUser, registerUser } from '@/services/auth.service';
import type { UserLoginRequest, UserRegisterRequest, UserResponse } from '@/types/api';

export type AuthStatus = 'idle' | 'checking' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: UserResponse | null;
  token: string | null;
  status: AuthStatus;
  initialize: () => Promise<void>;
  login: (payload: UserLoginRequest) => Promise<UserResponse>;
  register: (payload: UserRegisterRequest) => Promise<UserResponse>;
  logout: () => Promise<void>;
  markUnauthenticated: () => void;
}

let inFlightInit: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: getStoredToken(),
  status: 'idle',

  initialize: async () => {
    const current = get();
    if (current.status === 'authenticated' && current.user) {
      return;
    }
    if (inFlightInit) {
      return inFlightInit;
    }

    const token = getStoredToken();
    if (!token) {
      set({ user: null, token: null, status: 'unauthenticated' });
      return;
    }

    set({ status: 'checking', token });
    inFlightInit = (async () => {
      try {
        const user = await fetchCurrentUser();
        set({ user, token, status: 'authenticated' });
      } catch {
        setStoredToken(null);
        set({ user: null, token: null, status: 'unauthenticated' });
      } finally {
        inFlightInit = null;
      }
    })();

    return inFlightInit;
  },

  login: async (payload) => {
    const data = await loginUser(payload);
    set({
      user: data.user,
      token: data.access_token,
      status: 'authenticated',
    });
    return data.user;
  },

  register: async (payload) => {
    const user = await registerUser(payload);
    return user;
  },

  logout: async () => {
    inFlightInit = null;
    await logoutUser();
    set({ user: null, token: null, status: 'unauthenticated' });
  },

  markUnauthenticated: () => {
    inFlightInit = null;
    setStoredToken(null);
    set({ user: null, token: null, status: 'unauthenticated' });
  },
}));

setUnauthorizedHandler(() => {
  useAuthStore.getState().markUnauthenticated();
});