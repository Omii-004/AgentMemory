import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Eye,
  FileSpreadsheet,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/common/Button';
import { MetricCard } from '@/components/common/MetricCard';
import { Modal } from '@/components/common/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import {
  getRun,
  getRunComparison,
  getRunFailures,
  getRunStatistics,
  listExperiments,
  listExperimentRuns,
  listTraces,
} from '@/services/experiment.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type {
  ExecutionTraceResponse,
  FailureAnalysisItem,
  PairwiseComparisonItem,
  RunResponse,
} from '@/types/api';

function normalizePercent(val: number | null | undefined): number {
  if (val === null || val === undefined || isNaN(val)) return 0;
  // If backend already returned a percentage (e.g. 100.0 or 66.67), keep it;
  // if it returned a 0.0 - 1.0 fraction (e.g. 0.92 or 0.5), scale by 100.
  const scaled = val > 1.0 ? val : val * 100;
  return Number(scaled.toFixed(1));
}

function formatPercent(val: number | null | undefined): string {
  return `${normalizePercent(val).toFixed(1)}%`;
}

const ARCHITECTURE_NAMES: Record<string, string> = {
  history: 'History (Sliding Window)',
  vector: 'Vector (Dense pgvector)',
  structured: 'Structured (Relational Triples)',
  hybrid: 'Hybrid (Multi-Factor Ranking)',
};

const ARCHITECTURE_COLORS: Record<string, string> = {
  history: '#64748B', // slate
  vector: '#0EA5E9', // sky
  structured: '#8B5CF6', // purple
  hybrid: '#635BDB', // brand primary
};

const BENCHMARK_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'fact_retrieval', label: 'Fact Retrieval' },
  { key: 'temporal_reasoning', label: 'Temporal Reasoning' },
  { key: 'contradiction_handling', label: 'Contradiction Handling' },
  { key: 'multi_hop', label: 'Multi-Hop' },
  { key: 'memory_updating', label: 'Memory Updating' },
  { key: 'memory_deletion', label: 'Memory Deletion' },
];

export function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProjectId } = useWorkspaceStore();
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  // Failure filters & active trace modal
  const [archFilter, setArchFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [failureSearch, setFailureSearch] = useState<string>('');
  const [selectedTrace, setSelectedTrace] = useState<ExecutionTraceResponse | null>(null);

  // 1. Fetch experiments for active project
  const experimentsQuery = useQuery({
    queryKey: ['experiments', activeProjectId],
    queryFn: () => listExperiments(activeProjectId!),
    enabled: !!activeProjectId,
  });
  const experiments = experimentsQuery.data ?? [];

  // Derive experiment selection
  const rawExpId = searchParams.get('experimentId');
  const selectedExpId =
    rawExpId && experiments.some((e) => e.id === rawExpId)
      ? rawExpId
      : experiments[0]?.id ?? null;

  // 2. Fetch runs for selected experiment
  const runsQuery = useQuery({
    queryKey: ['experiment-runs', selectedExpId],
    queryFn: () => listExperimentRuns(selectedExpId!),
    enabled: !!selectedExpId,
  });
  const runs = runsQuery.data ?? [];

  // Derive active run selection
  const rawRunId = searchParams.get('runId');
  const activeRunId =
    rawRunId && runs.some((r) => r.id === rawRunId)
      ? rawRunId
      : runs[0]?.id ?? null;

  // 3. Fetch details for active run
  const runQuery = useQuery({
    queryKey: ['run-detail', activeRunId],
    queryFn: () => getRun(activeRunId!),
    enabled: !!activeRunId,
  });
  const activeRun: RunResponse | undefined = runQuery.data;

  // 4. Fetch comparison, statistics, failures, traces
  const comparisonQuery = useQuery({
    queryKey: ['run-comparison', activeRunId],
    queryFn: () => getRunComparison(activeRunId!),
    enabled: !!activeRunId,
  });
  const statisticsQuery = useQuery({
    queryKey: ['run-statistics', activeRunId],
    queryFn: () => getRunStatistics(activeRunId!),
    enabled: !!activeRunId,
  });
  const failuresQuery = useQuery({
    queryKey: ['run-failures', activeRunId],
    queryFn: () => getRunFailures(activeRunId!),
    enabled: !!activeRunId,
  });
  const tracesQuery = useQuery({
    queryKey: ['run-traces', activeRunId],
    queryFn: () => listTraces(activeRunId!),
    enabled: !!activeRunId,
  });

  const comparison = comparisonQuery.data;
  const statistics = statisticsQuery.data;
  const failures = useMemo(() => failuresQuery.data ?? [], [failuresQuery.data]);
  const traces = useMemo(() => tracesQuery.data ?? [], [tracesQuery.data]);

  const handleSelectRun = (newRunId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('runId', newRunId);
      return next;
    });
  };

  const handleSelectExperiment = (newExpId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('experimentId', newExpId);
      next.delete('runId');
      return next;
    });
  };

  // Derived Top-Performing Architecture
  const archEntries = useMemo(() => {
    return Object.entries(comparison?.architectures ?? {});
  }, [comparison]);

  const bestArchitecture = useMemo(() => {
    if (!archEntries.length) return null;
    let top = archEntries[0];
    for (const entry of archEntries) {
      if ((entry[1].task_success_rate ?? 0) > (top[1].task_success_rate ?? 0)) {
        top = entry;
      }
    }
    return { arch: top[0], metrics: top[1] };
  }, [archEntries]);

  // Overall metric aggregates
  const overallMetrics = useMemo(() => {
    if (!archEntries.length) return null;
    let sumTsr = 0;
    let maxPrecision = 0;
    let maxRecall = 0;
    let sumMrr = 0;
    let sumLatency = 0;
    let totalTokens = 0;

    for (const [, m] of archEntries) {
      sumTsr += normalizePercent(m.task_success_rate);
      maxPrecision = Math.max(maxPrecision, normalizePercent(m.precision_at_k));
      maxRecall = Math.max(maxRecall, normalizePercent(m.recall_at_k));
      sumMrr += m.mrr ?? 0;
      sumLatency += m.avg_total_latency_ms ?? 0;
      totalTokens += m.total_tokens ?? 0;
    }

    return {
      avgTsr: sumTsr / archEntries.length,
      maxPrecision,
      maxRecall,
      avgMrr: sumMrr / archEntries.length,
      avgLatency: sumLatency / archEntries.length,
      totalTokens,
    };
  }, [archEntries]);

  // Recharts Chart Data
  const tsrBarData = useMemo(() => {
    return archEntries.map(([arch, m]) => ({
      architecture: ARCHITECTURE_NAMES[arch] ?? arch,
      key: arch,
      TSR: normalizePercent(m.task_success_rate),
      Precision: normalizePercent(m.precision_at_k),
      Recall: normalizePercent(m.recall_at_k),
    }));
  }, [archEntries]);

  const categoryBarData = useMemo(() => {
    return BENCHMARK_CATEGORIES.map((cat) => {
      const row: Record<string, string | number> = { category: cat.label };
      for (const [arch, m] of archEntries) {
        const catScore =
          m.categories?.[cat.key] ?? (m[cat.key] as number | undefined) ?? 0;
        row[arch] = normalizePercent(catScore);
      }
      return row;
    });
  }, [archEntries]);

  const efficiencyBarData = useMemo(() => {
    return archEntries.map(([arch, m]) => ({
      architecture: ARCHITECTURE_NAMES[arch] ?? arch,
      key: arch,
      'Avg Latency (ms)': Number((m.avg_total_latency_ms ?? 0).toFixed(1)),
      'Tokens (x100)': Number(((m.total_tokens ?? 0) / 100).toFixed(1)),
    }));
  }, [archEntries]);

  // Filtered Failures List
  const filteredFailures = useMemo(() => {
    return failures.filter((f) => {
      if (archFilter !== 'all' && f.architecture !== archFilter) return false;
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (failureSearch.trim()) {
        const q = failureSearch.toLowerCase();
        const keyMatch = f.task_key.toLowerCase().includes(q);
        const classMatch = f.failure_classification.toLowerCase().includes(q);
        const ansMatch = JSON.stringify(f.generated_answer ?? {})
          .toLowerCase()
          .includes(q);
        if (!keyMatch && !classMatch && !ansMatch) return false;
      }
      return true;
    });
  }, [failures, archFilter, categoryFilter, failureSearch]);

  const handleInspectTrace = (failure: FailureAnalysisItem) => {
    const matchedTrace = traces.find(
      (t) => t.task_result_id === failure.task_result_id,
    );
    if (matchedTrace) {
      setSelectedTrace(matchedTrace);
    } else {
      setSelectedTrace({
        id: failure.task_result_id,
        run_id: activeRunId!,
        task_result_id: failure.task_result_id,
        event_type: 'task_failure_evaluation',
        component: `memory_${failure.architecture}`,
        event_data: {
          task_key: failure.task_key,
          category: failure.category,
          classification: failure.failure_classification,
          expected_answer: failure.expected_answer,
          generated_answer: failure.generated_answer,
          retrieved_memory_ids: failure.retrieved_memory_ids,
          evaluation_details: failure.evaluation_details,
        },
        duration_ms: 0,
        created_at: new Date().toISOString(),
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Experiment Analytics
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Side-by-side architecture benchmarks, 95% confidence intervals, statistical
            significance, and failure analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/benchmark-studio">
            <Button variant="outline">
              <Sparkles className="h-4 w-4" />
              Benchmark Studio
            </Button>
          </Link>
          <Link to="/reports">
            <Button variant="outline">
              <FileSpreadsheet className="h-4 w-4" />
              Reports & Exports
            </Button>
          </Link>
        </div>
      </div>

      {!activeProjectId ? (
        <EmptyState
          title="No active workspace selected"
          description="Select or create a research project from the Topbar to view experiment analytics."
          action={
            <Link to="/projects">
              <Button>
                <Database className="h-4 w-4" />
                Go to Projects
              </Button>
            </Link>
          }
        />
      ) : experimentsQuery.isLoading ? (
        <LoadingState label="Loading experiments and runs..." />
      ) : experimentsQuery.isError ? (
        <ErrorState
          title="Failed to load experiments"
          message="Could not retrieve project experiments from the server."
          onRetry={() => experimentsQuery.refetch()}
        />
      ) : experiments.length === 0 ? (
        <EmptyState
          title="No experiments found"
          description="Configure and launch your first multi-architecture experiment in Benchmark Studio to generate performance analytics."
          action={
            <Link to="/benchmark-studio?tab=wizard">
              <Button>
                <Sparkles className="h-4 w-4" />
                Launch First Experiment
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Experiment & Run Selector Toolbar */}
          <div className="p-4 bg-surface border border-border rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Experiment:
                </span>
                <select
                  value={selectedExpId ?? ''}
                  onChange={(e) => handleSelectExperiment(e.target.value)}
                  className="h-9 px-3 text-sm bg-canvas border border-border rounded-md font-medium text-text-primary focus:outline-none focus:border-primary"
                >
                  {experiments.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      {exp.name} ({exp.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Run:
                </span>
                <select
                  value={activeRunId ?? ''}
                  onChange={(e) => handleSelectRun(e.target.value)}
                  disabled={runs.length === 0}
                  className="h-9 px-3 text-sm bg-canvas border border-border rounded-md font-medium text-text-primary focus:outline-none focus:border-primary disabled:opacity-50"
                >
                  {runs.length === 0 ? (
                    <option value="">No runs recorded</option>
                  ) : (
                    runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        Run #{r.run_number} ({r.status}) — Seed {r.random_seed ?? 'N/A'}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  comparisonQuery.refetch();
                  statisticsQuery.refetch();
                  failuresQuery.refetch();
                  tracesQuery.refetch();
                  pushToast({ title: 'Refreshed analytics', variant: 'info' });
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>

          {!activeRun ? (
            <EmptyState
              title="No runs executed yet"
              description="This experiment has no recorded benchmark runs. Launch a run in Benchmark Studio to compute metrics."
              action={
                <Link to="/benchmark-studio">
                  <Button>Launch Run</Button>
                </Link>
              }
            />
          ) : (
            <>
              {/* Run Overview Metadata Banner */}
              <div className="p-4 bg-surface border border-border rounded-lg flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-mono font-bold text-sm shrink-0">
                    #{activeRun.run_number}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text-primary text-base">
                        Benchmark Run #{activeRun.run_number}
                      </span>
                      <StatusBadge status={activeRun.status} />
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5 font-mono">
                      ID: {activeRun.id}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {activeRun.started_at
                        ? new Date(activeRun.started_at).toLocaleString()
                        : 'Not started'}
                    </span>
                  </div>
                  {activeRun.random_seed !== null && (
                    <div className="flex items-center gap-1.5 font-mono bg-canvas px-2.5 py-1 rounded border border-border">
                      Seed: {activeRun.random_seed}
                    </div>
                  )}
                  {activeRun.status === 'running' && (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                      <Clock className="h-3.5 w-3.5 animate-spin" />
                      Live Run in Progress
                    </div>
                  )}
                </div>
              </div>

              {/* Top KPI Metric Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard
                  label="Top Architecture"
                  value={
                    bestArchitecture
                      ? formatPercent(bestArchitecture.metrics.task_success_rate)
                      : 'N/A'
                  }
                  subtitle={
                    bestArchitecture
                      ? ARCHITECTURE_NAMES[bestArchitecture.arch] ?? bestArchitecture.arch
                      : 'No data'
                  }
                  icon={<Award className="h-4 w-4 text-primary" />}
                />
                <MetricCard
                  label="Avg Task Success"
                  value={
                    overallMetrics
                      ? `${overallMetrics.avgTsr.toFixed(1)}%`
                      : 'N/A'
                  }
                  subtitle="Across all evaluated archs"
                  icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                />
                <MetricCard
                  label="Peak Precision@K"
                  value={
                    overallMetrics
                      ? `${overallMetrics.maxPrecision.toFixed(1)}%`
                      : 'N/A'
                  }
                  subtitle="Best retrieval precision"
                  icon={<Layers className="h-4 w-4 text-sky-500" />}
                />
                <MetricCard
                  label="Mean Reciprocal Rank"
                  value={
                    overallMetrics ? overallMetrics.avgMrr.toFixed(3) : 'N/A'
                  }
                  subtitle="Ranked retrieval quality"
                  icon={<BarChart3 className="h-4 w-4 text-purple-500" />}
                />
                <MetricCard
                  label="Avg Latency"
                  value={
                    overallMetrics
                      ? `${overallMetrics.avgLatency.toFixed(1)}ms`
                      : 'N/A'
                  }
                  subtitle="End-to-end task time"
                  icon={<Clock className="h-4 w-4 text-amber-500" />}
                />
                <MetricCard
                  label="Total Tokens"
                  value={
                    overallMetrics
                      ? overallMetrics.totalTokens.toLocaleString()
                      : 'N/A'
                  }
                  subtitle="LLM context + output"
                  icon={<Zap className="h-4 w-4 text-text-secondary" />}
                />
              </div>

              {/* Side-by-Side Architecture Comparison Matrix */}
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-text-primary">
                      Architecture Comparison Matrix
                    </h2>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Direct side-by-side performance metrics across evaluated memory
                      architectures.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-text-secondary">
                    {archEntries.length} evaluated architectures
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-canvas border-b border-border text-xs uppercase text-text-secondary font-semibold">
                      <tr>
                        <th className="px-4 py-3">Architecture</th>
                        <th className="px-4 py-3">Task Success (TSR)</th>
                        <th className="px-4 py-3">Precision@K</th>
                        <th className="px-4 py-3">Recall@K</th>
                        <th className="px-4 py-3">MRR</th>
                        <th className="px-4 py-3">Memory Utility</th>
                        <th className="px-4 py-3">Avg Latency</th>
                        <th className="px-4 py-3">Tokens</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-mono text-xs">
                      {archEntries.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-8 text-center text-text-secondary font-sans"
                          >
                            No architecture comparison metrics computed yet.
                          </td>
                        </tr>
                      ) : (
                        archEntries.map(([arch, m]) => {
                          const isWinner = bestArchitecture?.arch === arch;
                          const tsrPercent = normalizePercent(m.task_success_rate);
                          const precisionPercent = normalizePercent(m.precision_at_k);
                          const recallPercent = normalizePercent(m.recall_at_k);
                          const mrr = (m.mrr ?? 0).toFixed(3);
                          const utility = (m.memory_utility ?? 0).toFixed(3);
                          const latency = (m.avg_total_latency_ms ?? 0).toFixed(1);
                          const tokens = (m.total_tokens ?? 0).toLocaleString();

                          return (
                            <tr
                              key={arch}
                              className={
                                isWinner
                                  ? 'bg-primary/5 hover:bg-primary/10 transition-colors'
                                  : 'hover:bg-canvas transition-colors'
                              }
                            >
                              <td className="px-4 py-3 font-sans font-medium text-text-primary">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{
                                      backgroundColor:
                                        ARCHITECTURE_COLORS[arch] ?? '#635BDB',
                                    }}
                                  />
                                  <span>{ARCHITECTURE_NAMES[arch] ?? arch}</span>
                                  {isWinner && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary text-white">
                                      <Award className="h-3 w-3" />
                                      Top Performer
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-1">
                                  <span className="font-semibold text-text-primary">
                                    {tsrPercent}%
                                  </span>
                                  <div className="w-24 bg-border rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all duration-300"
                                      style={{
                                        width: `${Math.min(100, Math.max(0, tsrPercent))}%`,
                                        backgroundColor:
                                          ARCHITECTURE_COLORS[arch] ?? '#635BDB',
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-text-primary">
                                {precisionPercent}%
                              </td>
                              <td className="px-4 py-3 text-text-primary">
                                {recallPercent}%
                              </td>
                              <td className="px-4 py-3 text-text-primary">{mrr}</td>
                              <td className="px-4 py-3 text-text-primary">{utility}</td>
                              <td className="px-4 py-3 text-text-primary">{latency} ms</td>
                              <td className="px-4 py-3 text-text-primary">{tokens}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Interactive Visualizations */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Chart 1: Task Success Rate Comparison */}
                <div className="p-5 bg-surface border border-border rounded-lg space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      Task Success Rate by Architecture
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Overall task completion rate (%) under benchmark trials.
                    </p>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height={240} minWidth={100} minHeight={200}>
                      <BarChart
                        data={tsrBarData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                        <XAxis
                          dataKey="architecture"
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          interval={0}
                          angle={-10}
                          textAnchor="end"
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          domain={[0, 100]}
                          tickFormatter={(v) => `${v}%`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#171923',
                            borderColor: '#2D3748',
                            borderRadius: '6px',
                            color: '#fff',
                            fontSize: '12px',
                          }}
                          formatter={(value: unknown) => {
                            const num = typeof value === 'number' ? value : Number(value);
                            return [`${num}%`, 'Task Success'];
                          }}
                        />
                        <Bar
                          dataKey="TSR"
                          fill="#635BDB"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 2: Category Accuracy Breakdown */}
                <div className="p-5 bg-surface border border-border rounded-lg space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      Accuracy Breakdown by Benchmark Category
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Evaluated across the 6 synthetic benchmark failure modes.
                    </p>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height={240} minWidth={100} minHeight={200}>
                      <BarChart
                        data={categoryBarData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                        <XAxis
                          dataKey="category"
                          stroke="#64748b"
                          fontSize={10}
                          tickLine={false}
                          interval={0}
                          angle={-15}
                          textAnchor="end"
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          domain={[0, 100]}
                          tickFormatter={(v) => `${v}%`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#171923',
                            borderColor: '#2D3748',
                            borderRadius: '6px',
                            color: '#fff',
                            fontSize: '12px',
                          }}
                          formatter={(value: unknown, name: unknown) => {
                            const num = typeof value === 'number' ? value : Number(value);
                            const archKey = String(name);
                            return [
                              `${num}%`,
                              ARCHITECTURE_NAMES[archKey] ?? archKey,
                            ];
                          }}
                        />
                        <Legend
                          formatter={(value: string) => (
                            <span className="text-xs text-text-secondary">
                              {ARCHITECTURE_NAMES[value] ?? value}
                            </span>
                          )}
                        />
                        {archEntries.map(([arch]) => (
                          <Bar
                            key={arch}
                            dataKey={arch}
                            fill={ARCHITECTURE_COLORS[arch] ?? '#635BDB'}
                            radius={[2, 2, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 3: Latency & Cost Efficiency */}
                <div className="p-5 bg-surface border border-border rounded-lg space-y-4 lg:col-span-2">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      Latency & Resource Efficiency
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Average total execution latency (ms) and total token consumption
                      (hundreds).
                    </p>
                  </div>
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height={240} minWidth={100} minHeight={200}>
                      <BarChart
                        data={efficiencyBarData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                        <XAxis
                          dataKey="architecture"
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                        />
                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#171923',
                            borderColor: '#2D3748',
                            borderRadius: '6px',
                            color: '#fff',
                            fontSize: '12px',
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="Avg Latency (ms)"
                          fill="#F59E0B"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="Tokens (x100)"
                          fill="#635BDB"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Statistical Significance Analysis Panel */}
              <div className="bg-surface border border-border rounded-lg overflow-hidden space-y-4 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-text-primary">
                        Statistical Significance & 95% Confidence Intervals
                      </h2>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                        Hypothesis Testing
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mt-1">
                      Paired Student's t-test, Wilcoxon signed-rank test, and Cohen's d effect
                      size to test whether memory complexity yields statistically significant
                      improvements.
                    </p>
                  </div>
                </div>

                {/* 95% Confidence Intervals Table */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    Descriptive Statistics & 95% Confidence Intervals
                  </h4>
                  <div className="overflow-x-auto border border-border rounded-md">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-canvas border-b border-border font-semibold text-text-secondary uppercase">
                        <tr>
                          <th className="px-3 py-2">Architecture</th>
                          <th className="px-3 py-2">Mean TSR</th>
                          <th className="px-3 py-2">Std Dev</th>
                          <th className="px-3 py-2">95% Confidence Interval</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {!statistics?.descriptive_ci_95 ||
                        Object.keys(statistics.descriptive_ci_95).length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-3 py-4 text-center text-text-secondary font-sans"
                            >
                              No statistical distribution data available for this run.
                            </td>
                          </tr>
                        ) : (
                          Object.entries(statistics.descriptive_ci_95).map(
                            ([arch, stat]) => (
                              <tr key={arch} className="hover:bg-canvas">
                                <td className="px-3 py-2 font-sans font-medium text-text-primary">
                                  {ARCHITECTURE_NAMES[arch] ?? arch}
                                </td>
                                <td className="px-3 py-2 font-semibold text-text-primary">
                                  {formatPercent(stat.mean)}
                                </td>
                                <td className="px-3 py-2 text-text-secondary">
                                  {stat.std.toFixed(3)}
                                </td>
                                <td className="px-3 py-2 text-primary font-semibold">
                                  [{formatPercent(stat.ci_low)}, {formatPercent(stat.ci_high)}]
                                </td>
                              </tr>
                            ),
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pairwise Comparisons Table */}
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    Pairwise Significance Tests (Architecture A vs. Architecture B)
                  </h4>
                  <div className="overflow-x-auto border border-border rounded-md">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-canvas border-b border-border font-semibold text-text-secondary uppercase">
                        <tr>
                          <th className="px-3 py-2">Comparison</th>
                          <th className="px-3 py-2">N (Paired)</th>
                          <th className="px-3 py-2">Mean Diff (Δ)</th>
                          <th className="px-3 py-2">t-test (p-value)</th>
                          <th className="px-3 py-2">Wilcoxon (p-value)</th>
                          <th className="px-3 py-2">Cohen's d</th>
                          <th className="px-3 py-2">Significance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {!statistics?.pairwise_comparisons ||
                        statistics.pairwise_comparisons.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-3 py-4 text-center text-text-secondary font-sans"
                            >
                              Requires 2 or more architectures evaluated over multiple trials to
                              compute paired significance tests.
                            </td>
                          </tr>
                        ) : (
                          statistics.pairwise_comparisons.map(
                            (pair: PairwiseComparisonItem, idx: number) => {
                              const pT =
                                pair.p_value_ttest < 0.001
                                  ? '< 0.001'
                                  : pair.p_value_ttest.toFixed(4);
                              const pW =
                                pair.p_value_wilcoxon < 0.001
                                  ? '< 0.001'
                                  : pair.p_value_wilcoxon.toFixed(4);

                              return (
                                <tr key={idx} className="hover:bg-canvas">
                                  <td className="px-3 py-2 font-sans font-medium text-text-primary">
                                    <span className="capitalize">{pair.arch_a}</span> vs.{' '}
                                    <span className="capitalize">{pair.arch_b}</span>
                                  </td>
                                  <td className="px-3 py-2 text-text-secondary">
                                    {pair.n_paired}
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-text-primary">
                                    {pair.mean_diff >= 0 ? '+' : ''}
                                    {(pair.mean_diff * (Math.abs(pair.mean_diff) > 1.0 ? 1 : 100)).toFixed(1)}%
                                  </td>
                                  <td className="px-3 py-2 text-text-primary">
                                    t={pair.t_statistic.toFixed(2)} (p={pT})
                                  </td>
                                  <td className="px-3 py-2 text-text-primary">p={pW}</td>
                                  <td className="px-3 py-2 text-text-primary">
                                    {pair.cohens_d.toFixed(2)} ({pair.effect_magnitude})
                                  </td>
                                  <td className="px-3 py-2">
                                    {pair.statistically_significant_05 ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                        <CheckCircle2 className="h-3 w-3" />
                                        p &lt; 0.05 (Significant)
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-text-secondary border border-border">
                                        p ≥ 0.05 (Not Significant)
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            },
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Failure Analysis & Execution Trace Inspection */}
              <div className="bg-surface border border-border rounded-lg overflow-hidden space-y-4 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-text-primary">
                        Failure Analysis & Root Cause Inspection
                      </h2>
                      <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                        {failures.length} Failed Trials
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Inspect task failures, expected vs. actual snapshots, retrieved memory
                      provenance, and execution traces.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Arch filter */}
                    <select
                      value={archFilter}
                      onChange={(e) => setArchFilter(e.target.value)}
                      className="h-8 px-2 text-xs bg-canvas border border-border rounded font-medium text-text-primary focus:outline-none"
                    >
                      <option value="all">All Architectures</option>
                      <option value="history">History</option>
                      <option value="vector">Vector</option>
                      <option value="structured">Structured</option>
                      <option value="hybrid">Hybrid</option>
                    </select>

                    {/* Category filter */}
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="h-8 px-2 text-xs bg-canvas border border-border rounded font-medium text-text-primary focus:outline-none"
                    >
                      <option value="all">All Categories</option>
                      {BENCHMARK_CATEGORIES.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>

                    {/* Search */}
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-text-secondary" />
                      <input
                        type="text"
                        placeholder="Search key or answers..."
                        value={failureSearch}
                        onChange={(e) => setFailureSearch(e.target.value)}
                        className="h-8 pl-8 pr-3 text-xs bg-canvas border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary w-44"
                      />
                    </div>
                  </div>
                </div>

                {filteredFailures.length === 0 ? (
                  <div className="py-8 text-center text-text-secondary text-sm space-y-1">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto" />
                    <p className="font-medium text-text-primary">
                      No matching failure cases found
                    </p>
                    <p className="text-xs">
                      {failures.length === 0
                        ? 'Zero task failures were recorded for this benchmark run!'
                        : 'Adjust the filters above to inspect other failure classifications.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-border rounded-md">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-canvas border-b border-border text-text-secondary uppercase font-semibold">
                        <tr>
                          <th className="px-3 py-2.5">Architecture</th>
                          <th className="px-3 py-2.5">Task Key</th>
                          <th className="px-3 py-2.5">Category</th>
                          <th className="px-3 py-2.5">Classification</th>
                          <th className="px-3 py-2.5">Expected Answer</th>
                          <th className="px-3 py-2.5">Generated Answer</th>
                          <th className="px-3 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filteredFailures.map((item, idx) => (
                          <tr key={idx} className="hover:bg-canvas">
                            <td className="px-3 py-2.5 font-medium capitalize text-text-primary">
                              <span
                                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono"
                                style={{
                                  backgroundColor: `${ARCHITECTURE_COLORS[item.architecture] ?? '#635BDB'}20`,
                                  color: ARCHITECTURE_COLORS[item.architecture] ?? '#635BDB',
                                }}
                              >
                                {item.architecture}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-text-primary">
                              {item.task_key}
                            </td>
                            <td className="px-3 py-2.5 capitalize text-text-secondary">
                              {item.category.replace('_', ' ')}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                {item.failure_classification}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-text-secondary max-w-xs truncate">
                              {JSON.stringify(item.expected_answer ?? 'N/A')}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-text-secondary max-w-xs truncate">
                              {JSON.stringify(item.generated_answer ?? 'N/A')}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleInspectTrace(item)}
                              >
                                <Eye className="h-3 w-3" />
                                View Trace
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Execution Trace Inspection Modal */}
      {selectedTrace && (
        <Modal
          open={!!selectedTrace}
          onClose={() => setSelectedTrace(null)}
          title={`Execution Trace: ${selectedTrace.component}`}
          description={`Trace ID: ${selectedTrace.id} | Event: ${selectedTrace.event_type}`}
          maxWidth="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 bg-canvas border border-border rounded">
                <span className="text-text-secondary block">Component</span>
                <span className="font-semibold text-text-primary font-mono">
                  {selectedTrace.component}
                </span>
              </div>
              <div className="p-2.5 bg-canvas border border-border rounded">
                <span className="text-text-secondary block">Duration</span>
                <span className="font-semibold text-text-primary font-mono">
                  {selectedTrace.duration_ms !== null
                    ? `${selectedTrace.duration_ms} ms`
                    : 'N/A'}
                </span>
              </div>
              <div className="p-2.5 bg-canvas border border-border rounded">
                <span className="text-text-secondary block">Event Type</span>
                <span className="font-semibold text-text-primary font-mono">
                  {selectedTrace.event_type}
                </span>
              </div>
              <div className="p-2.5 bg-canvas border border-border rounded">
                <span className="text-text-secondary block">Created At</span>
                <span className="font-semibold text-text-primary font-mono truncate block">
                  {new Date(selectedTrace.created_at).toLocaleTimeString()}
                </span>
              </div>
            </div>

            {/* Trace Payload Viewer */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Trace Event Details & Retrieval Payload
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      JSON.stringify(selectedTrace.event_data, null, 2),
                    );
                    pushToast({ title: 'Trace JSON copied to clipboard', variant: 'info' });
                  }}
                >
                  <Copy className="h-3 w-3" />
                  Copy JSON
                </Button>
              </div>
              <pre className="font-mono text-xs bg-sidebar text-slate-200 p-4 rounded-md overflow-x-auto max-h-96">
                {JSON.stringify(selectedTrace.event_data, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setSelectedTrace(null)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}