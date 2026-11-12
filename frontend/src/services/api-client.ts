import type { APIErrorEnvelope, APIResponse } from '@/types/api';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
const TOKEN_STORAGE_KEY = 'agentmemory_access_token';

export class ApiClientError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number,
    code = 'AM_ERR_UNKNOWN',
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

function buildUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  try {
    const body = (await response.json()) as Partial<APIErrorEnvelope> & { detail?: string };
    if (body?.error?.message) {
      return new ApiClientError(
        body.error.message,
        response.status,
        body.error.code ?? `HTTP_${response.status}`,
        body.error.details ?? null,
      );
    }
    if (typeof body?.detail === 'string') {
      return new ApiClientError(body.detail, response.status, `HTTP_${response.status}`);
    }
  } catch {
    // Response body is not valid JSON
  }
  return new ApiClientError(
    response.statusText || `Request failed (${response.status})`,
    response.status,
    `HTTP_${response.status}`,
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  skipAuthRedirect?: boolean;
  signal?: AbortSignal;
}

export async function requestRaw<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    throw new ApiClientError(
      'Unable to reach the AgentMemory backend server. Check that FastAPI is running on port 8000.',
      0,
      'AM_ERR_NETWORK',
    );
  }

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect) {
      setStoredToken(null);
      unauthorizedHandler?.();
    }
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as T;
}

export async function requestData<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await requestRaw<APIResponse<T>>(path, options);
  if (envelope.data === null || envelope.data === undefined) {
    throw new ApiClientError(envelope.message || 'Empty response payload', 500, 'AM_ERR_EMPTY_DATA');
  }
  return envelope.data;
}

export async function downloadBlob(path: string, fallbackFilename: string): Promise<void> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(path), { method: 'GET', headers });
  if (!response.ok) {
    if (response.status === 401) {
      setStoredToken(null);
      unauthorizedHandler?.();
    }
    throw await parseErrorResponse(response);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}