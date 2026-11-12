import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  Download,
  FlaskConical,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { MetricCard } from '@/components/common/MetricCard';
import { Modal } from '@/components/common/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/lib/utils';
import { ApiClientError } from '@/services/api-client';
import {
  createDataset,
  generateSyntheticTasks,
  listDatasets,
  validateDataset,
} from '@/services/dataset.service';
import {
  deleteExperiment,
  downloadReportFile,
  listExperiments,
  listProjectReports,
} from '@/services/experiment.service';
import { createNamespace, listNamespaces } from '@/services/memory.service';
import {
  addMessage,
  createSession,
  deleteProject,
  getProject,
  listMessages,
  listSessions,
  updateProject,
} from '@/services/project.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ArchitectureType, DatasetValidationResult, ProjectResponse } from '@/types/api';

type ProjectTab = 'overview' | 'namespaces' | 'datasets' | 'experiments' | 'sessions' | 'settings';

const TABS: Array<{ id: ProjectTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'namespaces', label: 'Namespaces' },
  { id: 'datasets', label: 'Datasets' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'settings', label: 'Settings' },
];

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setActiveProjectId, pushToast } = useWorkspaceStore();

  const rawTab = searchParams.get('tab') as ProjectTab | null;
  const activeTab: ProjectTab = TABS.some((t) => t.id === rawTab) ? (rawTab as ProjectTab) : 'overview';

  useEffect(() => {
    if (projectId) setActiveProjectId(projectId);
  }, [projectId, setActiveProjectId]);

  // Namespace form state
  const [includeRunNamespaces, setIncludeRunNamespaces] = useState(false);
  const [nsName, setNsName] = useState('');
  const [nsArch, setNsArch] = useState<ArchitectureType>('hybrid');

  // Dataset form state
  const [dsName, setDsName] = useState('');
  const [dsVersion, setDsVersion] = useState('1.0.0');
  const [dsDesc, setDsDesc] = useState('');
  const [validationMap, setValidationMap] = useState<Record<string, DatasetValidationResult>>({});

  // Sessions & messages state
  const [sessionName, setSessionName] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [msgRole, setMsgRole] = useState<'user' | 'assistant' | 'system' | 'tool'>('user');
  const [msgContent, setMsgContent] = useState('');

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const namespacesQuery = useQuery({
    queryKey: ['namespaces', projectId, includeRunNamespaces],
    queryFn: () => listNamespaces(projectId!, includeRunNamespaces),
    enabled: Boolean(projectId),
  });

  const datasetsQuery = useQuery({
    queryKey: ['datasets', projectId],
    queryFn: () => listDatasets(projectId!),
    enabled: Boolean(projectId),
  });

  const experimentsQuery = useQuery({
    queryKey: ['experiments', projectId],
    queryFn: () => listExperiments(projectId!),
    enabled: Boolean(projectId),
  });

  const reportsQuery = useQuery({
    queryKey: ['reports', 'project', projectId],
    queryFn: () => listProjectReports(projectId!),
    enabled: Boolean(projectId),
  });

  const sessionsQuery = useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => listSessions(projectId!),
    enabled: Boolean(projectId),
  });

  const sessions = sessionsQuery.data ?? [];
  const activeSessionId = sessions.some((s) => s.id === selectedSessionId)
    ? selectedSessionId
    : (sessions[0]?.id ?? null);

  const messagesQuery = useQuery({
    queryKey: ['messages', activeSessionId],
    queryFn: () => listMessages(activeSessionId!),
    enabled: Boolean(activeSessionId),
  });

  const createNsMutation = useMutation({
    mutationFn: () =>
      createNamespace(projectId!, {
        architecture_type: nsArch,
        name: nsName.trim(),
        config: {},
      }),
    onSuccess: (ns) => {
      setNsName('');
      void queryClient.invalidateQueries({ queryKey: ['namespaces', projectId] });
      pushToast({ title: 'Namespace created', description: `${ns.name} (${ns.architecture_type})`, variant: 'success' });
    },
    onError: (err) => {
      pushToast({
        title: 'Namespace creation failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to create namespace.',
        variant: 'error',
      });
    },
  });

  const createDsMutation = useMutation({
    mutationFn: () =>
      createDataset(projectId!, {
        name: dsName.trim(),
        version: dsVersion.trim() || '1.0.0',
        description: dsDesc.trim() || null,
      }),
    onSuccess: (ds) => {
      setDsName('');
      setDsDesc('');
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      pushToast({ title: 'Dataset created', description: ds.name, variant: 'success' });
    },
    onError: (err) => {
      pushToast({
        title: 'Dataset creation failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to create dataset.',
        variant: 'error',
      });
    },
  });

  const generateMutation = useMutation({
    mutationFn: (datasetId: string) =>
      generateSyntheticTasks(datasetId, { tasks_per_category: 2, distractor_count: 6, seed: 42 }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      pushToast({
        title: 'Synthetic tasks generated',
        description: `Added ${res.generated_count} tasks (total: ${res.total_tasks}).`,
        variant: 'success',
      });
    },
    onError: (err) => {
      pushToast({
        title: 'Generation failed',
        description: err instanceof ApiClientError ? err.message : 'Failed to generate tasks.',
        variant: 'error',
      });
    },
  });

  const validateMutation = useMutation({
    mutationFn: (datasetId: string) => validateDataset(datasetId),
    onSuccess: (res, datasetId) => {
      setValidationMap((prev) => ({ ...prev, [datasetId]: res }));
    },
  });

  const deleteExpMutation = useMutation({
    mutationFn: (expId: string) => deleteExperiment(expId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['experiments', projectId] });
      pushToast({ title: 'Experiment deleted', variant: 'info' });
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: () => createSession(projectId!, { name: sessionName.trim() || null }),
    onSuccess: (sess) => {
      setSessionName('');
      setSelectedSessionId(sess.id);
      void queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      pushToast({ title: 'Session created', variant: 'success' });
    },
  });

  const addMessageMutation = useMutation({
    mutationFn: () =>
      addMessage(activeSessionId!, { role: msgRole, content: msgContent.trim() }),
    onSuccess: () => {
      setMsgContent('');
      void queryClient.invalidateQueries({ queryKey: ['messages', activeSessionId] });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (payload: { name: string; description: string | null; status: string }) =>
      updateProject(projectId!, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      pushToast({ title: 'Project updated', variant: 'success' });
    },
    onError: (err) => {
      pushToast({
        title: 'Update failed',
        description: err instanceof ApiClientError ? err.message : 'Could not update project.',
        variant: 'error',
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: () => deleteProject(projectId!),
    onSuccess: () => {
      setActiveProjectId(null);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      pushToast({ title: 'Project deleted', variant: 'info' });
      navigate('/projects', { replace: true });
    },
  });

  const setTab = (tab: ProjectTab) => {
    setSearchParams({ tab });
  };

  if (projectQuery.isPending) {
    return <LoadingState label="Loading project workspace..." />;
  }

  if (projectQuery.isError || !projectQuery.data) {
    const msg =
      projectQuery.error instanceof ApiClientError
        ? projectQuery.error.message
        : 'Project not found or access denied.';
    return <ErrorState title="Project unavailable" message={msg} onRetry={() => void projectQuery.refetch()} />;
  }

  const project = projectQuery.data;
  const namespaces = namespacesQuery.data ?? [];
  const datasets = datasetsQuery.data ?? [];
  const experiments = experimentsQuery.data ?? [];
  const reports = reportsQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link
            to="/projects"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            All Projects
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-text-primary">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="text-sm text-text-secondary mt-1">
            {project.description || 'No description provided.'}
          </p>
          <p className="text-xs font-mono text-text-secondary mt-1">ID: {project.id}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={() => navigate('/memory-lab')}>
            Memory Lab
          </Button>
          <Button onClick={() => navigate('/benchmark-studio')}>
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            Benchmark Studio
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border flex items-center gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Namespaces" value={namespaces.length} subtitle="Memory stores" />
            <MetricCard label="Datasets" value={datasets.length} subtitle="Benchmark suites" />
            <MetricCard label="Experiments" value={experiments.length} subtitle="Configured studies" />
            <MetricCard label="Reports" value={reports.length} subtitle="Exported artifacts" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-surface border border-border rounded-lg">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Recent Experiments</h2>
                <button
                  type="button"
                  onClick={() => setTab('experiments')}
                  className="text-xs font-medium text-primary hover:underline cursor-pointer"
                >
                  View tab
                </button>
              </div>
              {experiments.length === 0 ? (
                <div className="p-6 text-sm text-text-secondary">
                  No experiments configured yet. Open Benchmark Studio to create one.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {experiments.slice(0, 5).map((exp) => (
                    <div key={exp.id} className="px-5 py-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary">{exp.name}</p>
                        <p className="text-xs text-text-secondary">
                          {formatDateTime(exp.created_at)}
                        </p>
                      </div>
                      <StatusBadge status={exp.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-surface border border-border rounded-lg">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Latest Reports</h2>
                <Link to="/reports" className="text-xs font-medium text-primary hover:underline">
                  All reports
                </Link>
              </div>
              {reports.length === 0 ? (
                <div className="p-6 text-sm text-text-secondary">
                  No reports generated yet. Run a benchmark and export JSON/CSV reports.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {reports.slice(0, 5).map((rep) => (
                    <div key={rep.id} className="px-5 py-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary uppercase font-mono">
                          {rep.report_type} Report
                        </p>
                        <p className="text-xs text-text-secondary">
                          {formatDateTime(rep.created_at)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void downloadReportFile(rep.id, `report_${rep.run_id}.${rep.report_type}`)
                        }
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: NAMESPACES */}
      {activeTab === 'namespaces' && (
        <div className="space-y-6">
          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              Create Memory Namespace
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!nsName.trim()) return;
                createNsMutation.mutate();
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
            >
              <div className="sm:col-span-5">
                <label htmlFor="ns-name" className="block text-xs font-medium text-text-secondary mb-1">
                  Namespace Name
                </label>
                <input
                  id="ns-name"
                  type="text"
                  required
                  value={nsName}
                  onChange={(e) => setNsName(e.target.value)}
                  placeholder="e.g., Hybrid Lab Store"
                  className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
                />
              </div>
              <div className="sm:col-span-4">
                <label htmlFor="ns-arch" className="block text-xs font-medium text-text-secondary mb-1">
                  Architecture
                </label>
                <select
                  id="ns-arch"
                  value={nsArch}
                  onChange={(e) => setNsArch(e.target.value as ArchitectureType)}
                  className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
                >
                  <option value="history">history</option>
                  <option value="vector">vector</option>
                  <option value="structured">structured</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </div>
              <div className="sm:col-span-3">
                <Button type="submit" isLoading={createNsMutation.isPending} className="w-full">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create Namespace
                </Button>
              </div>
            </form>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">
              Project Namespaces ({namespaces.length})
            </h3>
            <label className="inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeRunNamespaces}
                onChange={(e) => setIncludeRunNamespaces(e.target.checked)}
                className="rounded border-border"
              />
              Include benchmark run namespaces
            </label>
          </div>

          {namespaces.length === 0 ? (
            <EmptyState
              title="No namespaces in this view"
              description="Create a manual namespace above or toggle benchmark run namespaces."
            />
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-canvas/70 text-xs font-medium text-text-secondary">
                    <th className="py-2.5 px-4">Name</th>
                    <th className="py-2.5 px-4">Architecture</th>
                    <th className="py-2.5 px-4">Origin</th>
                    <th className="py-2.5 px-4">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {namespaces.map((ns) => (
                    <tr key={ns.id} className="hover:bg-canvas/50">
                      <td className="py-3 px-4 font-medium text-text-primary">
                        {ns.name}
                        <p className="font-mono text-[11px] text-text-secondary">{ns.id}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">{ns.architecture_type}</td>
                      <td className="py-3 px-4 text-xs text-text-secondary">
                        {ns.run_id ? `Run (${ns.run_id.slice(0, 8)}…)` : 'Manual'}
                      </td>
                      <td className="py-3 px-4 text-text-secondary">{formatDateTime(ns.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DATASETS */}
      {activeTab === 'datasets' && (
        <div className="space-y-6">
          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text-primary mb-3">Create Dataset</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!dsName.trim()) return;
                createDsMutation.mutate();
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
            >
              <div className="sm:col-span-4">
                <label htmlFor="ds-name" className="block text-xs font-medium text-text-secondary mb-1">
                  Dataset Name
                </label>
                <input
                  id="ds-name"
                  type="text"
                  required
                  value={dsName}
                  onChange={(e) => setDsName(e.target.value)}
                  placeholder="e.g., Core Evaluation Suite"
                  className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ds-ver" className="block text-xs font-medium text-text-secondary mb-1">
                  Version
                </label>
                <input
                  id="ds-ver"
                  type="text"
                  value={dsVersion}
                  onChange={(e) => setDsVersion(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm font-mono"
                />
              </div>
              <div className="sm:col-span-4">
                <label htmlFor="ds-desc" className="block text-xs font-medium text-text-secondary mb-1">
                  Description
                </label>
                <input
                  id="ds-desc"
                  type="text"
                  value={dsDesc}
                  onChange={(e) => setDsDesc(e.target.value)}
                  placeholder="Optional description"
                  className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" isLoading={createDsMutation.isPending} className="w-full">
                  Create
                </Button>
              </div>
            </form>
          </div>

          {datasets.length === 0 ? (
            <EmptyState
              title="No datasets in this project"
              description="Create a dataset container above, then generate synthetic 6-category benchmark tasks or import JSON tasks."
            />
          ) : (
            <div className="space-y-3">
              {datasets.map((ds) => {
                const validation = validationMap[ds.id];
                return (
                  <div
                    key={ds.id}
                    className="bg-surface border border-border rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-primary" aria-hidden="true" />
                        <span className="text-sm font-semibold text-text-primary">{ds.name}</span>
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-canvas border border-border">
                          v{ds.version}
                        </span>
                        <span className="text-xs font-mono text-text-secondary">
                          {ds.task_count} tasks
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary mt-1">
                        {ds.description || 'No description'} · Created {formatDateTime(ds.created_at)}
                      </p>
                      {validation && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 font-medium text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {validation.valid ? 'Valid' : 'Empty'} ({validation.task_count} tasks)
                          </span>
                          {Object.entries(validation.category_breakdown).map(([cat, count]) => (
                            <span
                              key={cat}
                              className="px-1.5 py-0.5 rounded bg-canvas border border-border font-mono text-[11px]"
                            >
                              {cat}: {count}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={generateMutation.isPending}
                        onClick={() => generateMutation.mutate(ds.id)}
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        +12 Synthetic Tasks
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => validateMutation.mutate(ds.id)}
                      >
                        Validate
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: EXPERIMENTS */}
      {activeTab === 'experiments' && (
        <div className="space-y-4">
          {experiments.length === 0 ? (
            <EmptyState
              title="No experiments configured"
              description="Use Benchmark Studio to select a dataset and architectures for evaluation."
              action={
                <Button onClick={() => navigate('/benchmark-studio')}>Open Benchmark Studio</Button>
              }
            />
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-canvas/70 text-xs font-medium text-text-secondary">
                    <th className="py-2.5 px-4">Experiment</th>
                    <th className="py-2.5 px-4">Architectures</th>
                    <th className="py-2.5 px-4">LLM / Trials</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {experiments.map((exp) => {
                    const archs = Array.isArray(exp.configuration.architectures)
                      ? (exp.configuration.architectures as string[])
                      : [];
                    return (
                      <tr key={exp.id} className="hover:bg-canvas/50">
                        <td className="py-3 px-4 font-medium text-text-primary">
                          {exp.name}
                          <p className="text-xs text-text-secondary font-normal">
                            {exp.description || formatDateTime(exp.created_at)}
                          </p>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">{archs.join(', ')}</td>
                        <td className="py-3 px-4 font-mono text-xs text-text-secondary">
                          {String(exp.configuration.llm_provider ?? 'mock')} ·{' '}
                          {String(exp.configuration.num_trials ?? 1)} trial(s)
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={exp.status} />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate('/benchmark-studio')}
                            >
                              Open Studio
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteExpMutation.mutate(exp.id)}
                              aria-label={`Delete ${exp.name}`}
                              className="text-error hover:text-error"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: SESSIONS & MESSAGES */}
      {activeTab === 'sessions' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-surface border border-border rounded-lg p-4 space-y-4">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
              Conversation Sessions
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createSessionMutation.mutate();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Session title..."
                className="flex-1 h-9 px-3 rounded-md border border-border bg-canvas text-sm"
              />
              <Button size="sm" type="submit" isLoading={createSessionMutation.isPending}>
                Add
              </Button>
            </form>

            <div className="divide-y divide-border border border-border rounded-md">
              {sessions.length === 0 ? (
                <p className="p-3 text-xs text-text-secondary">No sessions recorded yet.</p>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSessionId(s.id)}
                    className={`w-full text-left px-3 py-2.5 text-sm cursor-pointer ${
                      activeSessionId === s.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-canvas'
                    }`}
                  >
                    <p className="truncate">{s.name || 'Untitled Session'}</p>
                    <p className="text-[11px] font-mono text-text-secondary">
                      {s.session_type} · {formatDateTime(s.created_at)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-8 bg-surface border border-border rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-semibold text-text-primary">Session Interaction Log</h3>
            {!activeSessionId ? (
              <p className="text-sm text-text-secondary">Select or create a session to inspect messages.</p>
            ) : (
              <>
                <div className="border border-border rounded-md divide-y divide-border max-h-80 overflow-y-auto">
                  {(messagesQuery.data ?? []).length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">No messages in this session yet.</p>
                  ) : (
                    (messagesQuery.data ?? []).map((msg) => (
                      <div key={msg.id} className="p-3 text-sm">
                        <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                          <span className="font-mono font-semibold uppercase text-text-primary">
                            #{msg.sequence_number} · {msg.role}
                          </span>
                          <span>{formatDateTime(msg.created_at)}</span>
                        </div>
                        <p className="text-text-primary whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!msgContent.trim()) return;
                    addMessageMutation.mutate();
                  }}
                  className="flex flex-col sm:flex-row gap-2"
                >
                  <select
                    value={msgRole}
                    onChange={(e) => setMsgRole(e.target.value as 'user' | 'assistant' | 'system' | 'tool')}
                    aria-label="Message role"
                    className="h-10 px-3 rounded-md border border-border bg-surface text-sm font-mono"
                  >
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                    <option value="system">system</option>
                    <option value="tool">tool</option>
                  </select>
                  <input
                    type="text"
                    value={msgContent}
                    onChange={(e) => setMsgContent(e.target.value)}
                    placeholder="Record an interaction turn..."
                    className="flex-1 h-10 px-3 rounded-md border border-border bg-surface text-sm"
                  />
                  <Button type="submit" isLoading={addMessageMutation.isPending}>
                    Append Turn
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: SETTINGS */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <ProjectSettingsForm
            key={`${project.id}:${project.updated_at}`}
            project={project}
            isSaving={updateProjectMutation.isPending}
            onSave={(payload) => updateProjectMutation.mutate(payload)}
          />

          <div className="lg:col-span-5 bg-surface border border-error/30 rounded-lg p-5 space-y-3 h-fit">
            <h3 className="text-sm font-semibold text-error">Danger Zone</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Deleting this project permanently removes all associated memory namespaces, stored
              records, benchmark datasets, experiment runs, traces, and reports.
            </p>
            <Button variant="destructive" onClick={() => setConfirmDeleteOpen(true)}>
              Delete Project
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Confirm Project Deletion"
        description="This action cannot be undone."
      >
        <div className="space-y-4">
          <p className="text-sm text-text-primary">
            Delete <span className="font-semibold">{project.name}</span> and all child data?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              isLoading={deleteProjectMutation.isPending}
              onClick={() => deleteProjectMutation.mutate()}
            >
              Delete Permanently
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface ProjectSettingsFormProps {
  project: ProjectResponse;
  isSaving: boolean;
  onSave: (payload: { name: string; description: string | null; status: string }) => void;
}

function ProjectSettingsForm({ project, isSaving, onSave }: ProjectSettingsFormProps) {
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description ?? '');
  const [editStatus, setEditStatus] = useState(project.status);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    onSave({
      name: editName.trim(),
      description: editDesc.trim() || null,
      status: editStatus,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="lg:col-span-7 bg-surface border border-border rounded-lg p-5 space-y-4"
    >
      <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
        <Settings className="h-4 w-4 text-text-secondary" aria-hidden="true" />
        Project Settings
      </h2>

      <div>
        <label htmlFor="edit-proj-name" className="block text-sm font-medium mb-1">
          Project Name
        </label>
        <input
          id="edit-proj-name"
          type="text"
          required
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
        />
      </div>

      <div>
        <label htmlFor="edit-proj-desc" className="block text-sm font-medium mb-1">
          Description
        </label>
        <textarea
          id="edit-proj-desc"
          rows={3}
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm"
        />
      </div>

      <div>
        <label htmlFor="edit-proj-status" className="block text-sm font-medium mb-1">
          Status
        </label>
        <select
          id="edit-proj-status"
          value={editStatus}
          onChange={(e) => setEditStatus(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
        >
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </div>

      <Button type="submit" isLoading={isSaving}>
        Save Changes
      </Button>
    </form>
  );
}