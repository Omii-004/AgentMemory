import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

describe('Experiment Analytics & Reports Workflows', () => {
  let queryClient: QueryClient;

  const mockUser = {
    id: 'user-1',
    email: 'researcher@agentmemory.ai',
    display_name: 'Dr. Memory Researcher',
    full_name: 'Dr. Memory Researcher',
    is_active: true,
    is_superuser: false,
    created_at: '2026-11-14T00:00:00Z',
  };

  const mockProject = {
    id: 'proj-1',
    name: 'Long-Term Memory Evaluation Lab',
    description: 'Benchmarking memory retention across 1,000 turns',
    owner_id: 'user-1',
    created_at: '2026-11-14T00:00:00Z',
    updated_at: '2026-11-14T00:00:00Z',
  };

  const mockExperiment = {
    id: 'exp-1',
    project_id: 'proj-1',
    dataset_id: 'ds-1',
    name: 'Multi-Architecture Benchmark',
    description: '4-architecture benchmark comparison',
    configuration: { architectures: ['history', 'vector', 'structured', 'hybrid'] },
    status: 'completed',
    created_at: '2026-11-14T10:00:00Z',
  };

  const mockRun = {
    id: 'run-1',
    experiment_id: 'exp-1',
    run_number: 1,
    status: 'completed',
    random_seed: 42,
    started_at: '2026-11-14T10:05:00Z',
    completed_at: '2026-11-14T10:07:30Z',
    error_message: null,
    created_at: '2026-11-14T10:05:00Z',
  };

  const mockComparison = {
    run_id: 'run-1',
    status: 'completed',
    architectures: {
      history: {
        task_success_rate: 0.5,
        precision_at_k: 0.45,
        recall_at_k: 0.4,
        mrr: 0.48,
        avg_total_latency_ms: 120.0,
        total_tokens: 1200,
        memory_utility: 0.42,
        categories: { fact_retrieval: 0.6, temporal_reasoning: 0.4 },
      },
      vector: {
        task_success_rate: 0.75,
        precision_at_k: 0.7,
        recall_at_k: 0.68,
        mrr: 0.72,
        avg_total_latency_ms: 110.0,
        total_tokens: 1100,
        memory_utility: 0.65,
        categories: { fact_retrieval: 0.85, temporal_reasoning: 0.6 },
      },
      structured: {
        task_success_rate: 0.8,
        precision_at_k: 0.85,
        recall_at_k: 0.78,
        mrr: 0.81,
        avg_total_latency_ms: 105.0,
        total_tokens: 980,
        memory_utility: 0.82,
        categories: { fact_retrieval: 0.9, temporal_reasoning: 0.85 },
      },
      hybrid: {
        task_success_rate: 0.92,
        precision_at_k: 0.9,
        recall_at_k: 0.88,
        mrr: 0.89,
        avg_total_latency_ms: 115.0,
        total_tokens: 950,
        memory_utility: 0.91,
        categories: { fact_retrieval: 0.95, temporal_reasoning: 0.9 },
      },
    },
  };

  const mockStatistics = {
    descriptive_ci_95: {
      history: { mean: 0.5, std: 0.12, ci_low: 0.42, ci_high: 0.58 },
      vector: { mean: 0.75, std: 0.1, ci_low: 0.68, ci_high: 0.82 },
      structured: { mean: 0.8, std: 0.09, ci_low: 0.74, ci_high: 0.86 },
      hybrid: { mean: 0.92, std: 0.06, ci_low: 0.87, ci_high: 0.96 },
    },
    pairwise_comparisons: [
      {
        arch_a: 'hybrid',
        arch_b: 'history',
        n_paired: 24,
        mean_diff: 0.42,
        t_statistic: 4.85,
        p_value_ttest: 0.0001,
        p_value_wilcoxon: 0.0003,
        cohens_d: 1.45,
        effect_magnitude: 'large',
        statistically_significant_05: true,
      },
      {
        arch_a: 'hybrid',
        arch_b: 'vector',
        n_paired: 24,
        mean_diff: 0.17,
        t_statistic: 2.45,
        p_value_ttest: 0.022,
        p_value_wilcoxon: 0.028,
        cohens_d: 0.68,
        effect_magnitude: 'medium',
        statistically_significant_05: true,
      },
    ],
  };

  const mockFailures = [
    {
      task_result_id: 'tr-fail-1',
      architecture: 'history',
      task_id: 't-1',
      task_key: 'fact-retrieval-noise-01',
      category: 'fact_retrieval',
      failure_classification: 'Retrieval Failure',
      expected_answer: { target: 'Alice is a Senior AI Engineer' },
      generated_answer: { text: 'I do not recall Alice.' },
      retrieved_memory_ids: ['mem-1', 'mem-2'],
      evaluation_details: { overlap: 0.1 },
    },
  ];

  const mockTraces = [
    {
      id: 'trace-1',
      run_id: 'run-1',
      task_result_id: 'tr-fail-1',
      event_type: 'memory_retrieval_and_eval',
      component: 'memory_history',
      event_data: {
        query: 'What is Alice position?',
        retrieved_ids: ['mem-1', 'mem-2'],
        prompt: 'Evaluate question: What is Alice position?',
        completion: 'I do not recall Alice.',
      },
      duration_ms: 122.5,
      created_at: '2026-11-14T10:06:00Z',
    },
  ];

  const mockReports = [
    {
      id: 'rep-1',
      project_id: 'proj-1',
      run_id: 'run-1',
      report_type: 'json',
      file_location: '/reports/report_run-1_rep-1.json',
      status: 'completed',
      created_at: '2026-11-14T10:08:00Z',
    },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

        useAuthStore.setState({
      user: mockUser,
      token: 'valid-test-token',
      status: 'authenticated',
    });

    useWorkspaceStore.setState({
      activeProjectId: mockProject.id,
    });

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      // Reports endpoints
      if (url.includes('/projects/proj-1/reports')) {
        return new Response(JSON.stringify({ message: 'ok', data: mockReports }));
      }
      if (url.includes('/runs/run-1/reports') && method === 'POST') {
        const body = JSON.parse((init?.body as string) || '{}');
        const created = {
          id: 'rep-new-2',
          project_id: 'proj-1',
          run_id: 'run-1',
          report_type: body.report_type || 'json',
          file_location: `/reports/report_run-1_new.${body.report_type || 'json'}`,
          status: 'completed',
          created_at: new Date().toISOString(),
        };
        return new Response(JSON.stringify({ message: 'created', data: created }));
      }
      if (url.includes('/reports/rep-1/download')) {
        return new Response(JSON.stringify({ report: 'sample report json content' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Experiments & Runs endpoints
      if (url.includes('/projects/proj-1/experiments')) {
        return new Response(JSON.stringify({ message: 'ok', data: [mockExperiment] }));
      }
      if (url.includes('/experiments/exp-1/runs')) {
        return new Response(JSON.stringify({ message: 'ok', data: [mockRun] }));
      }
      if (url.includes('/runs/run-1/comparison')) {
        return new Response(JSON.stringify({ message: 'ok', data: mockComparison }));
      }
      if (url.includes('/runs/run-1/statistics')) {
        return new Response(JSON.stringify({ message: 'ok', data: mockStatistics }));
      }
      if (url.includes('/runs/run-1/failures')) {
        return new Response(JSON.stringify({ message: 'ok', data: mockFailures }));
      }
      if (url.includes('/runs/run-1/traces')) {
        return new Response(JSON.stringify({ message: 'ok', data: mockTraces }));
      }
      if (url.includes('/runs/run-1')) {
        return new Response(JSON.stringify({ message: 'ok', data: mockRun }));
      }

      return new Response(JSON.stringify({ message: 'default', data: {} }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Experiment Analytics with comparison matrix, statistics, and failure traces', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/analytics?runId=run-1']}>
          <AnalyticsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Verify main page header
    expect(
      screen.getByRole('heading', { name: /experiment analytics/i }),
    ).toBeInTheDocument();

    // Wait for data load and verify Run #1 overview
    await waitFor(() => {
      expect(screen.getByText(/Benchmark Run #1/i)).toBeInTheDocument();
    });

    // Check Top Performer metric
    expect(screen.getAllByText('92.0%').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Hybrid \(Multi-Factor Ranking\)/i).length).toBeGreaterThan(0);

    // Verify Architecture Comparison Matrix entries
    expect(screen.getByText(/Architecture Comparison Matrix/i)).toBeInTheDocument();
    expect(screen.getByText(/Top Performer/i)).toBeInTheDocument();

    // Verify Statistical Significance section
    expect(
      screen.getByText(/Statistical Significance & 95% Confidence Intervals/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/p < 0.05 \(Significant\)/i).length).toBeGreaterThan(0);

    // Verify Failure Analysis & Root Cause Inspection
    expect(screen.getByText(/fact-retrieval-noise-01/i)).toBeInTheDocument();
    expect(screen.getByText(/Retrieval Failure/i)).toBeInTheDocument();

    // Click "View Trace" and inspect modal
    const viewTraceBtn = screen.getByRole('button', { name: /view trace/i });
    fireEvent.click(viewTraceBtn);

    await waitFor(() => {
      expect(screen.getByText(/Execution Trace: memory_history/i)).toBeInTheDocument();
      expect(screen.getByText(/Copy JSON/i)).toBeInTheDocument();
    });
  });

  it('renders Reports page, lists reports, and opens generation modal', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports']}>
          <ReportsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Verify main heading
    expect(
      screen.getByRole('heading', { name: /reports & data exports/i }),
    ).toBeInTheDocument();

    // Wait for reports table to load
    await waitFor(() => {
      expect(screen.getByText(/Generated Benchmark Reports/i)).toBeInTheDocument();
      expect(screen.getByText(/rep-1/i)).toBeInTheDocument();
    });

    // Open Generate Report modal
    const generateBtn = screen.getByRole('button', { name: /generate report/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Generate Evaluation Report/i)).toBeInTheDocument();
      expect(screen.getByText(/JSON Archive/i)).toBeInTheDocument();
      expect(screen.getByText(/CSV Metrics Table/i)).toBeInTheDocument();
    });
  });
});