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

describe('Benchmark Studio Workflows', () => {
  const sampleProject = {
    id: 'proj-1',
    owner_id: 'u1',
    name: 'Primary Study',
    description: 'Benchmarking study',
    status: 'active',
    created_at: '2026-11-12T00:00:00Z',
    updated_at: '2026-11-12T00:00:00Z',
  };

  const sampleDataset = {
    id: 'ds-1',
    project_id: 'proj-1',
    name: 'Core Evaluation Suite',
    version: '1.0.0',
    description: '6-category benchmark suite',
    task_count: 12,
    is_public: false,
    created_at: '2026-11-12T00:00:00Z',
  };

  const sampleTasks = [
    {
      id: 'task-1',
      dataset_id: 'ds-1',
      task_key: 'fact_retrieval_001',
      category: 'fact_retrieval',
      difficulty: 'medium',
      conversation_sequence: [{ sequence_number: 1, role: 'user', content: 'Hello' }],
      evaluation_query: { question: 'What is user greeting?' },
      created_at: '2026-11-12T00:00:00Z',
    },
  ];

  const sampleExperiment = {
    id: 'exp-1',
    project_id: 'proj-1',
    dataset_id: 'ds-1',
    name: '4-Architecture Evaluation',
    description: 'Comparing TSR across architectures',
    configuration: {
      architectures: ['history', 'vector', 'structured', 'hybrid'],
      num_trials: 1,
      llm_provider: 'mock',
    },
    status: 'configured',
    created_at: '2026-11-12T00:00:00Z',
  };

  const sampleRun = {
    id: 'run-1',
    experiment_id: 'exp-1',
    run_number: 1,
    status: 'completed',
    random_seed: 42,
    started_at: '2026-11-12T00:00:00Z',
    completed_at: '2026-11-12T00:01:00Z',
    error_message: null,
    created_at: '2026-11-12T00:00:00Z',
  };

  const sampleRunArchs = [
    {
      id: 'ra-1',
      run_id: 'run-1',
      namespace_id: 'ns-1',
      architecture_type: 'hybrid',
      configuration: {},
      status: 'completed',
      started_at: '2026-11-12T00:00:00Z',
      completed_at: '2026-11-12T00:01:00Z',
    },
  ];

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

  it('renders Benchmark Studio with Experiment Wizard and steps', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/datasets')) {
        return jsonResponse({ success: true, data: [sampleDataset] });
      }
      if (url.includes('/experiments')) {
        return jsonResponse({ success: true, data: [sampleExperiment] });
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
        <MemoryRouter initialEntries={['/benchmark-studio?tab=wizard']}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Benchmark Studio' })).toBeInTheDocument();
    });

    // Check wizard step 1
    await waitFor(() => {
      expect(screen.getByText(/Step 1 — Experiment Details/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Experiment Name/i)).toBeInTheDocument();

    // Fill name and progress to step 2
    fireEvent.change(screen.getByLabelText(/Experiment Name/i), {
      target: { value: 'Test Benchmark Study' },
    });
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    // Verify step 2 (architectures)
    await waitFor(() => {
      expect(screen.getByText(/Step 2 — Select Memory Architectures/i)).toBeInTheDocument();
    });
  });

  it('renders Datasets & Tasks tab and inspects tasks', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/tasks')) {
        return jsonResponse({ success: true, data: sampleTasks });
      }
      if (url.includes('/datasets')) {
        return jsonResponse({ success: true, data: [sampleDataset] });
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
        <MemoryRouter initialEntries={['/benchmark-studio?tab=datasets']}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Benchmark Studio' })).toBeInTheDocument();
    });

    // Check dataset card
    await waitFor(() => {
      expect(screen.getAllByText('Core Evaluation Suite').length).toBeGreaterThan(0);
    });

    // Check tasks list
    await waitFor(() => {
      expect(screen.getAllByText('fact_retrieval_001').length).toBeGreaterThan(0);
    });
  });

  it('renders Run Monitor tab with completed run metrics', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/architectures')) {
        return jsonResponse({ success: true, data: sampleRunArchs });
      }
      if (url.includes('/results')) {
        return jsonResponse({ success: true, data: [] });
      }
      if (url.includes('/runs/run-1')) {
        return jsonResponse({ success: true, data: sampleRun });
      }
      if (url.includes('/runs')) {
        return jsonResponse({ success: true, data: [sampleRun] });
      }
      if (url.includes('/experiments')) {
        return jsonResponse({ success: true, data: [sampleExperiment] });
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
        <MemoryRouter initialEntries={['/benchmark-studio?tab=monitor']}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Benchmark Studio' })).toBeInTheDocument();
    });

    // Check Run details
    await waitFor(() => {
      expect(screen.getByText(/Run #1/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Architecture Execution Status/i)).toBeInTheDocument();
  });
});