import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  FolderKanban,
  Plus,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { MetricCard } from '@/components/common/MetricCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import { CreateProjectModal } from '@/features/projects/CreateProjectModal';
import { formatDateTime } from '@/lib/utils';
import { ApiClientError } from '@/services/api-client';
import { listDatasets } from '@/services/dataset.service';
import {
  listExperimentRuns,
  listExperiments,
  listProjectReports,
} from '@/services/experiment.service';
import { listNamespaces } from '@/services/memory.service';
import { listProjects } from '@/services/project.service';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { RunResponse } from '@/types/api';

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { activeProjectId, setActiveProjectId } = useWorkspaceStore();
  const [createOpen, setCreateOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects', 'list'],
    queryFn: () => listProjects(1, 50),
  });

  const projects = useMemo(() => projectsQuery.data?.data ?? [], [projectsQuery.data]);
  const totalProjects = projectsQuery.data?.pagination.total_items ?? 0;

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  );

  const projectId = activeProject?.id ?? null;

  const experimentsQuery = useQuery({
    queryKey: ['experiments', projectId],
    queryFn: () => listExperiments(projectId!),
    enabled: Boolean(projectId),
  });

  const datasetsQuery = useQuery({
    queryKey: ['datasets', projectId],
    queryFn: () => listDatasets(projectId!),
    enabled: Boolean(projectId),
  });

  const namespacesQuery = useQuery({
    queryKey: ['namespaces', projectId, 'manual'],
    queryFn: () => listNamespaces(projectId!, false),
    enabled: Boolean(projectId),
  });

  const reportsQuery = useQuery({
    queryKey: ['reports', 'project', projectId],
    queryFn: () => listProjectReports(projectId!),
    enabled: Boolean(projectId),
  });

  const experiments = useMemo(() => experimentsQuery.data ?? [], [experimentsQuery.data]);
  const datasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);
  const datasetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ds of datasets) {
      map.set(ds.id, ds.name);
    }
    return map;
  }, [datasets]);

  const recentExperiments = useMemo(() => experiments.slice(0, 8), [experiments]);
  const runQueries = useQueries({
    queries: recentExperiments.map((exp) => ({
      queryKey: ['experiment-runs', exp.id],
      queryFn: () => listExperimentRuns(exp.id),
      enabled: Boolean(projectId),
    })),
  });

  const latestRunByExperiment = useMemo(() => {
    const map = new Map<string, RunResponse | undefined>();
    recentExperiments.forEach((exp, idx) => {
      const runs = runQueries[idx]?.data ?? [];
      map.set(exp.id, runs[0]);
    });
    return map;
  }, [recentExperiments, runQueries]);

  const runSummary = useMemo(() => {
    let completed = 0;
    let running = 0;
    for (const q of runQueries) {
      for (const run of q.data ?? []) {
        if (run.status === 'completed') completed += 1;
        if (run.status === 'running' || run.status === 'pending') running += 1;
      }
    }
    return { completed, running };
  }, [runQueries]);

  if (projectsQuery.isPending) {
    return <LoadingState label="Loading your research workspace..." />;
  }

  if (projectsQuery.isError) {
    const msg =
      projectsQuery.error instanceof ApiClientError
        ? projectsQuery.error.message
        : 'Could not load workspace summary.';
    return <ErrorState message={msg} onRetry={() => void projectsQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Welcome back, {user?.display_name || user?.email}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {activeProject
              ? `Active workspace: ${activeProject.name}`
              : 'Create a project to organize memory namespaces, datasets, and benchmarks.'}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="No research projects yet"
          description="Projects keep your memory architectures, benchmark datasets, experiment configurations, and reports isolated."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create First Project
            </Button>
          }
        />
      ) : (
        <>
          {/* Summary metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Projects"
              value={totalProjects}
              subtitle="Across your account"
              icon={<FolderKanban className="h-4 w-4" aria-hidden="true" />}
            />
            <MetricCard
              label="Experiments"
              value={experiments.length}
              subtitle={activeProject ? `In ${activeProject.name}` : undefined}
              icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}
            />
            <MetricCard
              label="Completed Runs"
              value={runSummary.completed}
              subtitle="Verified benchmark executions"
              icon={<CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
            />
            <MetricCard
              label="Active Runs"
              value={runSummary.running}
              subtitle={`${datasets.length} datasets · ${(reportsQuery.data ?? []).length} reports`}
              icon={<Activity className="h-4 w-4 text-info" aria-hidden="true" />}
            />
          </div>

          {/* Middle row: Recent Projects + Workspace Summary & Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-6 bg-surface border border-border rounded-lg">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Recent Projects</h2>
                <Link to="/projects" className="text-xs font-medium text-primary hover:underline">
                  View all
                </Link>
              </div>
              <div className="divide-y divide-border">
                {projects.slice(0, 5).map((project) => {
                  const isActive = project.id === activeProject?.id;
                  return (
                    <div
                      key={project.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-canvas/60"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveProjectId(project.id);
                              navigate(`/projects/${project.id}`);
                            }}
                            className="text-sm font-medium text-text-primary hover:text-primary truncate cursor-pointer text-left"
                          >
                            {project.name}
                          </button>
                          {isActive && (
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary truncate mt-0.5">
                          {project.description || 'No description provided'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={project.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="lg:col-span-6 bg-surface border border-border rounded-lg p-5 flex flex-col justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-text-primary">
                  Active Workspace Quick Actions
                </h2>
                <p className="text-xs text-text-secondary mt-1">
                  Jump directly into a research workflow for{' '}
                  <span className="font-medium text-text-primary">{activeProject?.name}</span>.
                </p>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="border border-border rounded-md p-3 bg-canvas/50">
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Manual Namespaces</span>
                    </div>
                    <p className="text-lg font-semibold font-mono mt-1">
                      {(namespacesQuery.data ?? []).length}
                    </p>
                  </div>
                  <div className="border border-border rounded-md p-3 bg-canvas/50">
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <Database className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Datasets</span>
                    </div>
                    <p className="text-lg font-semibold font-mono mt-1">{datasets.length}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Link
                  to="/memory-lab"
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-md border border-border hover:border-primary/40 hover:bg-canvas text-sm font-medium text-text-primary"
                >
                  <span>Open Memory Lab</span>
                  <ArrowRight className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                </Link>
                <Link
                  to="/benchmark-studio"
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-md border border-border hover:border-primary/40 hover:bg-canvas text-sm font-medium text-text-primary"
                >
                  <span>Benchmark Studio</span>
                  <ArrowRight className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                </Link>
                <Link
                  to="/analytics"
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-md border border-border hover:border-primary/40 hover:bg-canvas text-sm font-medium text-text-primary"
                >
                  <span>Compare Analytics</span>
                  <ArrowRight className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                </Link>
                <Link
                  to="/reports"
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-md border border-border hover:border-primary/40 hover:bg-canvas text-sm font-medium text-text-primary"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
                    Export Reports
                  </span>
                  <ArrowRight className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                </Link>
              </div>
            </section>
          </div>

          {/* Recent Experiments table */}
          <section className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">
                Recent Experiments ({activeProject?.name})
              </h2>
              <Link
                to={`/projects/${activeProject?.id}?tab=experiments`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Manage experiments
              </Link>
            </div>

            {recentExperiments.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-text-secondary">
                  No experiments configured in this project yet.
                </p>
                <Link
                  to="/benchmark-studio"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mt-2"
                >
                  Configure first benchmark experiment
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-canvas/70 text-xs font-medium text-text-secondary">
                      <th className="py-2.5 px-4">Experiment</th>
                      <th className="py-2.5 px-4">Architectures</th>
                      <th className="py-2.5 px-4">Dataset</th>
                      <th className="py-2.5 px-4">Latest Run</th>
                      <th className="py-2.5 px-4">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentExperiments.map((exp) => {
                      const archs = Array.isArray(exp.configuration.architectures)
                        ? (exp.configuration.architectures as string[])
                        : [];
                      const latestRun = latestRunByExperiment.get(exp.id);
                      return (
                        <tr key={exp.id} className="hover:bg-canvas/50">
                          <td className="py-3 px-4 font-medium text-text-primary">
                            <Link to="/benchmark-studio" className="hover:text-primary">
                              {exp.name}
                            </Link>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {archs.map((a) => (
                                <span
                                  key={a}
                                  className="px-1.5 py-0.5 rounded border border-border bg-canvas font-mono text-[11px] text-text-primary"
                                >
                                  {a}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-text-secondary">
                            {datasetNameMap.get(exp.dataset_id) ?? exp.dataset_id.slice(0, 8)}
                          </td>
                          <td className="py-3 px-4">
                            {latestRun ? (
                              <div className="inline-flex items-center gap-2">
                                <StatusBadge status={latestRun.status} />
                                <span className="font-mono text-xs text-text-secondary">
                                  #{latestRun.run_number}
                                </span>
                              </div>
                            ) : (
                              <StatusBadge status={exp.status} />
                            )}
                          </td>
                          <td className="py-3 px-4 text-text-secondary">
                            {formatDateTime(exp.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(proj) => navigate(`/projects/${proj.id}`)}
      />
    </div>
  );
}