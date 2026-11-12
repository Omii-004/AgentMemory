import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import { useAuthStore } from '@/stores/auth.store';

function renderAtPath(path: string) {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('Frontend Route Protection & Auth Guards', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null, token: null, status: 'idle' });
  });

  it.each([
    '/dashboard',
    '/projects',
    '/memory-lab',
    '/memory-inspector',
    '/benchmark-studio',
    '/analytics',
    '/reports',
  ])('redirects unauthenticated direct navigation to %s -> /login', async (protectedPath) => {
    renderAtPath(protectedPath);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in to agentmemory/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/protected workspace route active/i)).not.toBeInTheDocument();
  });

  it('clears invalid stored token when /auth/me fails and redirects to /login', async () => {
    window.localStorage.setItem('agentmemory_access_token', 'expired.jwt.token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'AM_ERR_UNAUTHORIZED', message: 'Invalid token', details: null },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderAtPath('/benchmark-studio');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in to agentmemory/i })).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('agentmemory_access_token')).toBeNull();
  });

  it('renders protected route when /auth/me verifies active session', async () => {
    window.localStorage.setItem('agentmemory_access_token', 'valid.jwt.token');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/me')) {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'ok',
            data: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'researcher@example.com',
              display_name: 'Dr. Researcher',
              is_active: true,
              created_at: '2026-11-12T00:00:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          pagination: { page: 1, page_size: 50, total_items: 0, total_pages: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderAtPath('/memory-lab');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /memory lab/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Dr. Researcher')).toBeInTheDocument();
  });
});