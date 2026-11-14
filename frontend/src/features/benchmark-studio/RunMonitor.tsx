import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  Clock,
  FileText,
  StopCircle,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { MetricCard } from '@/components/common/MetricCard';
import { Modal } from '@/components/common/Modal';
import { EmptyState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/lib/utils';
import { ApiClientError } from '@/services/api-client';
import {
  cancelRun,
  getRun,
  getRunResults,
  listExperimentRuns,
  listExperiments,
  listRunArchitectures,
} from '@/services/experiment.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { RunArchitectureResponse, TaskResultResponse } from '@/types/api';

interface RunMonitorProps {
  projectId: string;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

export function RunMonitor({ projectId, selectedRunId, onSelectRun }: RunMonitorProps) {
  const queryClient = useQueryClient();
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Experiments in Project
  const experimentsQuery = useQuery({
    queryKey: ['experiments', projectId],
    queryFn: () => listExperiments(projectId),
    enabled: Boolean(projectId),
  });

  const experiments = useMemo(() => experimentsQuery.data ?? [], [experimentsQuery.data]);
  const activeExperiment = experiments[0] ?? null;

  // Runs for the most recent or active experiment
  const runsQuery = useQuery({
    queryKey: ['experiment-runs', activeExperiment?.id],
    queryFn: () => listExperimentRuns(activeExperiment!.id),
    enabled: Boolean(activeExperiment),
  });

  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const activeRunId = useMemo(
    () => (runs.some((r) => r.id === selectedRunId) ? selectedRunId : (runs[0]?.id ?? null)),
    [runs, selectedRunId],
  );

  // Active Run Polling Query (every 2s while running or pending)
  const runQuery = useQuery({
    queryKey: ['run', activeRunId],
    queryFn: () => getRun(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      return st === 'running' || st === 'pending' ? 2000 : false;
    },
  });

  const run = runQuery.data ?? null;
  const isRunning = run?.status === 'running' || run?.status === 'pending';

  // Architectures for Run
  const archsQuery = useQuery({
    queryKey: ['run-architectures', activeRunId],
    queryFn: () => listRunArchitectures(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: isRunning ? 2000 : false,
  });

  const runArchs = useMemo(() => archsQuery.data ?? [], [archsQuery.data]);

  // Results for Run
  const resultsQuery = useQuery({
    queryKey: ['run-results', activeRunId],
    queryFn: () => getRunResults(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: isRunning ? 2000 : false,
  });

  const results = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data]);

  // Cancel Run Mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(activeRunId!),
    onSuccess: (updated) => {
      setConfirmCancelOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['run', activeRunId] });
      void queryClient.invalidateQueries({ queryKey: ['experiment-runs'] });
      pushToast({
        title: 'Run cancelled',
        description: `Run #${updated.run_number} was halted.`,
        variant: 'info',
      });
    },
    onError: (err) => {
      pushToast({
        title: 'Cancellation failed',
        description: err instanceof ApiClientError ? err.message : 'Could not cancel run.',
        variant: 'error',
      });
    },
  });

  if (experimentsQuery.isPending) {
    return <LoadingState label="Loading benchmark runs..." />;
  }

  if (experiments.length === 0 || runs.length === 0) {
    return (
      <EmptyState
        title="No benchmark runs executed yet"
        description="Configure architectures and launch your first experiment in the Experiment Wizard tab."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Selector & Active Run Header */}
      <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <span className="text-xs font-mono uppercase text-text-secondary">
              Benchmark Run Monitor
            </span>
            <div className="flex items-center gap-3 mt-1">
              <h2 className="text-xl font-semibold text-text-primary">
                Run #{run?.run_number ?? '—'}
              </h2>
              {run && <StatusBadge status={run.status} />}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Select benchmark run"
              value={activeRunId ?? ''}
              onChange={(e) => onSelectRun(e.target.value)}
              className="h-9 px-3 rounded-md border border-border bg-canvas text-xs font-mono"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  Run #{r.run_number} ({r.status})
                </option>
              ))}
            </select>

            {isRunning && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmCancelOpen(true)}
              >
                <StopCircle className="h-4 w-4" aria-hidden="true" />
                Cancel Run
              </Button>
            )}

            {run?.status === 'completed' && (
              <>
                <Link to={`/analytics?run_id=${run.id}`}>
                  <Button size="sm">
                    <Activity className="h-4 w-4" aria-hidden="true" />
                    Analytics
                  </Button>
                </Link>
                <Link to={`/reports?run_id=${run.id}`}>
                  <Button size="sm" variant="outline">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Reports
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Live Metrics Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          <MetricCard
            label="Completed Tasks"
            value={results.length}
            subtitle={isRunning ? 'Execution in progress…' : 'Finished executions'}
            icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          />
          <MetricCard
            label="Architectures"
            value={runArchs.length}
            subtitle="Isolated test stores"
            icon={<Activity className="h-4 w-4 text-info" />}
          />
          <MetricCard
            label="Random Seed"
            value={run?.random_seed ?? 42}
            subtitle="Deterministic trials"
            icon={<Clock className="h-4 w-4 text-text-secondary" />}
          />
          <MetricCard
            label="Execution Status"
            value={run?.status ?? '—'}
            subtitle={run?.started_at ? formatDateTime(run.started_at) : 'Waiting'}
            icon={<Activity className="h-4 w-4 text-primary" />}
          />
        </div>
      </div>

      {/* Architectures Status Grid */}
      <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider text-xs">
          Architecture Execution Status ({runArchs.length})
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {runArchs.map((ra: RunArchitectureResponse) => {
            const archResults = results.filter((r) => r.run_architecture_id === ra.id);
            const correctCount = archResults.filter((r) => r.is_correct === true).length;
            const accuracy =
              archResults.length > 0
                ? Math.round((correctCount / archResults.length) * 100)
                : 0;

            return (
              <div
                key={ra.id}
                className="p-4 rounded-lg border border-border bg-canvas/30 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold uppercase text-text-primary">
                    {ra.architecture_type}
                  </span>
                  <StatusBadge status={ra.status} />
                </div>
                <div className="space-y-1 font-mono text-xs text-text-secondary">
                  <p>Tasks: {archResults.length}</p>
                  <p>Correct: {correctCount}</p>
                  <p className="text-text-primary font-semibold">TSR: {accuracy}%</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Results Stream */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-canvas/40 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            Execution Results Stream ({results.length})
          </h3>
          {isRunning && (
            <span className="flex items-center gap-1.5 text-xs text-info font-mono">
              <span className="h-2 w-2 rounded-full bg-info animate-pulse" />
              Polling live…
            </span>
          )}
        </div>

        {results.length === 0 ? (
          <div className="p-8 text-center text-xs text-text-secondary">
            {isRunning ? 'Waiting for first task execution…' : 'No task results recorded.'}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-canvas/70 text-xs font-medium text-text-secondary">
                  <th className="py-2.5 px-4">Trial</th>
                  <th className="py-2.5 px-4">Result</th>
                  <th className="py-2.5 px-4">Retrieval Latency</th>
                  <th className="py-2.5 px-4">LLM Latency</th>
                  <th className="py-2.5 px-4">Tokens</th>
                  <th className="py-2.5 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {results.slice(-50).reverse().map((r: TaskResultResponse) => (
                  <tr key={r.id} className="hover:bg-canvas/40">
                    <td className="py-2 px-4">#{r.trial_number}</td>
                    <td className="py-2 px-4">
                      {r.is_correct === true ? (
                        <span className="inline-flex items-center gap-1 text-success font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Correct
                        </span>
                      ) : r.is_correct === false ? (
                        <span className="inline-flex items-center gap-1 text-error font-semibold">
                          <XCircle className="h-3.5 w-3.5" />
                          Incorrect
                        </span>
                      ) : (
                        <span className="text-text-secondary">{r.task_status}</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-text-secondary">
                      {r.retrieval_latency_ms !== null ? `${r.retrieval_latency_ms.toFixed(1)}ms` : '—'}
                    </td>
                    <td className="py-2 px-4 text-text-secondary">
                      {r.llm_latency_ms !== null ? `${r.llm_latency_ms.toFixed(1)}ms` : '—'}
                    </td>
                    <td className="py-2 px-4 text-text-secondary">{r.total_tokens ?? '—'}</td>
                    <td className="py-2 px-4 text-text-secondary font-sans text-xs">
                      {formatDateTime(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      <Modal
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        title="Confirm Benchmark Run Cancellation"
        description="Stop executing further benchmark tasks for this run."
      >
        <div className="space-y-4">
          <p className="text-sm text-text-primary">
            Are you sure you want to cancel Run #{run?.run_number}? Tasks currently executing will
            safely finalize their local turn.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmCancelOpen(false)}>
              Keep Running
            </Button>
            <Button
              variant="destructive"
              isLoading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Cancel Run
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}