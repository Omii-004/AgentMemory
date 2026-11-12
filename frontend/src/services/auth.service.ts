import { requestData, setStoredToken } from '@/services/api-client';
import type {
  TokenResponse,
  UserLoginRequest,
  UserRegisterRequest,
  UserResponse,
} from '@/types/api';

export async function loginUser(payload: UserLoginRequest): Promise<TokenResponse> {
  const result = await requestData<TokenResponse>('/auth/login', {
    method: 'POST',
    body: payload,
    skipAuthRedirect: true,
  });
  setStoredToken(result.access_token);
  return result;
}

export async function registerUser(payload: UserRegisterRequest): Promise<UserResponse> {
  return requestData<UserResponse>('/auth/register', {
    method: 'POST',
    body: payload,
    skipAuthRedirect: true,
  });
}

export async function fetchCurrentUser(): Promise<UserResponse> {
  return requestData<UserResponse>('/auth/me', {
    method: 'GET',
    skipAuthRedirect: true,
  });
}

export async function logoutUser(): Promise<void> {
  try {
    await requestData<{ logged_out: boolean }>('/auth/logout', {
      method: 'POST',
      skipAuthRedirect: true,
    });
  } catch {
    // Client-side token discard still completes logout cleanly
  } finally {
    setStoredToken(null);
  }
}