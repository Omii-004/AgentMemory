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

describe('Memory Lab & Memory Inspector Workflows', () => {
  const sampleProject = {
    id: 'proj-1',
    owner_id: 'u1',
    name: 'Primary Study',
    description: 'Benchmarking study',
    status: 'active',
    created_at: '2026-11-12T00:00:00Z',
    updated_at: '2026-11-12T00:00:00Z',
  };

  const sampleNamespace = {
    id: 'ns-test-1',
    project_id: 'proj-1',
    run_id: null,
    architecture_type: 'hybrid',
    name: 'Primary Hybrid Store',
    config: { weight_similarity: 0.5 },
    created_at: '2026-11-12T00:00:00Z',
  };

  const sampleArchitectures = [
    { type: 'history', name: 'History Memory', default_config: { window_size: 5 } },
    { type: 'vector', name: 'Vector Memory', default_config: { similarity_threshold: 0.0 } },
    { type: 'structured', name: 'Structured Memory', default_config: {} },
    { type: 'hybrid', name: 'Hybrid Memory', default_config: { weight_similarity: 0.5 } },
  ];

  const sampleMemory = {
    id: 'mem-test-1',
    namespace_id: 'ns-test-1',
    source_message_id: null,
    parent_memory_id: null,
    memory_type: 'semantic',
    content: 'User prefers Asia/Tokyo timezone.',
    importance: 0.8,
    confidence: 1.0,
    status: 'active',
    deleted_at: null,
    created_at: '2026-11-12T00:00:00Z',
    updated_at: '2026-11-12T00:00:00Z',
  };

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
    useWorkspaceStore.setState({ activeProjectId: 'proj-1', toasts: [] });
  });

  it('renders Memory Lab architecture catalog and interactive workbench', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/memory-namespaces')) {
        return jsonResponse({ success: true, data: [sampleNamespace] });
      }
      if (url.endsWith('/architectures')) {
        return jsonResponse({ success: true, data: sampleArchitectures });
      }
      if (url.includes('/projects')) {
        return jsonResponse({
          success: true,
          data: [sampleProject],
          pagination: { page: 1, page_size: 50, total_items: 1, total_pages: 1 },
        });
      }
      return jsonResponse({ success: true, data: [] });
    });

    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/memory-lab']}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Memory Lab' })).toBeInTheDocument();
    });

    // Check architecture cards & primary store
    await waitFor(() => {
      expect(screen.getAllByText(/Primary Hybrid Store/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('heading', { name: /^history$/i })).toBeInTheDocument();

    // Check workbench tabs
    expect(screen.getByRole('button', { name: /store memory/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retrieve memories/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /consolidate/i })).toBeInTheDocument();
  });

  it('renders Memory Inspector with 3-panel layout and inspects record details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/facts')) {
        return jsonResponse({
          success: true,
          data: [
            {
              id: 'fact-1',
              memory_id: 'mem-test-1',
              subject: 'user_preference',
              predicate: 'timezone',
              object_value: 'Asia/Tokyo',
              object_type: 'string',
              valid_from: null,
              valid_to: null,
              confidence: 1.0,
              created_at: '2026-11-12T00:00:00Z',
            },
          ],
        });
      }
      if (url.includes('/memory-namespaces')) {
        return jsonResponse({ success: true, data: [sampleNamespace] });
      }
      if (url.includes('/memories')) {
        return jsonResponse({ success: true, data: [sampleMemory] });
      }
      if (url.includes('/projects')) {
        return jsonResponse({
          success: true,
          data: [sampleProject],
          pagination: { page: 1, page_size: 50, total_items: 1, total_pages: 1 },
        });
      }
      return jsonResponse({ success: true, data: [] });
    });

    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/memory-inspector']}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Memory Inspector' })).toBeInTheDocument();
    });

    // Check filters and middle records list
    await waitFor(() => {
      expect(screen.getByText('Inspector Filters')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getAllByText(/User prefers Asia\/Tokyo timezone/i).length).toBeGreaterThan(0);
    });

    // Select memory to inspect details
    const memoryRecord = screen.getAllByText(/User prefers Asia\/Tokyo timezone/i)[0];
    fireEvent.click(memoryRecord);

    // Verify detail panel shows content
    await waitFor(() => {
      expect(screen.getByText(/Memory Content/i)).toBeInTheDocument();
    });

    // Switch to Extracted Facts tab
    fireEvent.click(screen.getByRole('button', { name: /extracted facts/i }));

    await waitFor(() => {
      expect(screen.getByText('user_preference')).toBeInTheDocument();
      expect(screen.getByText('timezone')).toBeInTheDocument();
      expect(screen.getByText('Asia/Tokyo')).toBeInTheDocument();
    });
  });
});