import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Dashboard & Projects Workflow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    useAuthStore.setState({
      token: 'valid-token',
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'researcher@example.com',
        display_name: 'Researcher',
        is_active: true,
        created_at: '2026-11-12T00:00:00Z',
      },
    });
    useWorkspaceStore.setState({ activeProjectId: null, toasts: [] });
  });

  it('renders empty state on Dashboard when user has zero projects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        success: true,
        data: [],
        pagination: { page: 1, page_size: 50, total_items: 0, total_pages: 1 },
      }),
    );

    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/dashboard']}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no research projects yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /create first project/i })).toBeInTheDocument();
  });

  it('lists projects and creates a new project via dialog', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const createdProject = {
      id: 'proj-new',
      owner_id: 'u1',
      name: 'Hybrid Eval Study',
      description: 'Testing temporal recall',
      status: 'active',
      created_at: '2026-11-12T00:00:00Z',
      updated_at: '2026-11-12T00:00:00Z',
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/projects') && init?.method === 'POST') {
        return jsonResponse({ success: true, message: 'Created', data: createdProject }, 201);
      }
      if (url.includes('/projects/proj-new')) {
        if (url.endsWith('/projects/proj-new')) {
          return jsonResponse({ success: true, message: 'ok', data: createdProject });
        }
        return jsonResponse({ success: true, message: 'ok', data: [] });
      }
      return jsonResponse({
        success: true,
        data: [],
        pagination: { page: 1, page_size: 50, total_items: 0, total_pages: 1 },
      });
    });

    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no projects found/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0]);
    fireEvent.change(screen.getByLabelText(/project name/i), {
      target: { value: 'Hybrid Eval Study' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i }).slice(-1)[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Hybrid Eval Study' })).toBeInTheDocument();
    });
  });
});