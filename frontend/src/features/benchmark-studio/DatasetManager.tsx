import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Database,
  Eye,
  FileCode,
  Layers,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { EmptyState, LoadingState } from '@/components/common/StateViews';
import { formatDateTime } from '@/lib/utils';
import { ApiClientError } from '@/services/api-client';
import {
  createDataset,
  generateSyntheticTasks,
  importTasks,
  listDatasets,
  listTasks,
  validateDataset,
} from '@/services/dataset.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { DatasetResponse, DatasetValidationResult, TaskResponse } from '@/types/api';

interface DatasetManagerProps {
  projectId: string;
  onSelectDatasetForExperiment?: (datasetId: string) => void;
}

export function DatasetManager({ projectId, onSelectDatasetForExperiment }: DatasetManagerProps) {
  const queryClient = useQueryClient();
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [createOpen, setCreateOpen] = useState(false);
  const [syntheticOpen, setSyntheticOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [inspectTask, setInspectTask] = useState<TaskResponse | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [validationResult, setValidationResult] = useState<DatasetValidationResult | null>(null);

  const datasetsQuery = useQuery({
    queryKey: ['datasets', projectId],
    queryFn: () => listDatasets(projectId),
    enabled: Boolean(projectId),
  });

  const datasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);
  const activeDatasetId = useMemo(
    () =>
      datasets.some((d) => d.id === selectedDatasetId)
        ? selectedDatasetId
        : (datasets[0]?.id ?? null),
    [datasets, selectedDatasetId],
  );

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId],
  );

  const tasksQuery = useQuery({
    queryKey: ['tasks', activeDatasetId],
    queryFn: () => listTasks(activeDatasetId!),
    enabled: Boolean(activeDatasetId),
  });

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.task_key.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.difficulty.toLowerCase().includes(q),
    );
  }, [tasks, search]);

  const validateMutation = useMutation({
    mutationFn: () => validateDataset(activeDatasetId!),
    onSuccess: (res) => {
      setValidationResult(res);
      pushToast({
        title: 'Validation complete',
        description: `${res.task_count} tasks across ${Object.keys(res.category_breakdown).length} categories.`,
        variant: res.valid ? 'success' : 'info',
      });
    },
    onError: (err) => {
      pushToast({
        title: 'Validation failed',
        description: err instanceof ApiClientError ? err.message : 'Could not validate dataset.',
        variant: 'error',
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Top Bar: Dataset List & Actions */}
      <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              Benchmark Datasets ({datasets.length})
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Curate benchmark suites containing factual queries, temporal sequences, and
              distractors.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Dataset
          </Button>
        </div>

        {datasetsQuery.isPending ? (
          <LoadingState label="Loading benchmark datasets..." />
        ) : datasets.length === 0 ? (
          <EmptyState
            title="No benchmark datasets in this project"
            description="Create a dataset container to generate 6-category benchmark tasks or bulk-import custom evaluation tasks."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create First Dataset
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {datasets.map((ds) => {
              const isSelected = ds.id === activeDatasetId;
              return (
                <div
                  key={ds.id}
                  onClick={() => {
                    setSelectedDatasetId(ds.id);
                    setValidationResult(null);
                  }}
                  className={`p-4 rounded-lg border text-left cursor-pointer transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                      : 'border-border bg-canvas/40 hover:bg-canvas'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Database className="h-4 w-4 text-primary" aria-hidden="true" />
                      <span className="font-semibold text-sm text-text-primary truncate">
                        {ds.name}
                      </span>
                    </div>
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface border border-border">
                      v{ds.version}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary line-clamp-2">
                    {ds.description || 'No description provided.'}
                  </p>
                  <div className="mt-3 pt-2 border-t border-border/70 flex items-center justify-between text-[11px] text-text-secondary font-mono">
                    <span className="font-semibold text-text-primary">{ds.task_count} tasks</span>
                    <span>{formatDateTime(ds.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Dataset Inspection & Tasks Browser */}
      {activeDataset && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {/* Header Action Bar */}
          <div className="p-5 border-b border-border bg-canvas/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-text-primary">{activeDataset.name}</h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface border border-border">
                  v{activeDataset.version}
                </span>
                <span className="text-xs font-mono text-text-secondary">
                  {activeDataset.task_count} total tasks
                </span>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                {activeDataset.description || 'No description'} · ID:{' '}
                <span className="font-mono">{activeDataset.id}</span>
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSyntheticOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Generate Suite
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Import JSON
              </Button>
              <Button
                size="sm"
                variant="secondary"
                isLoading={validateMutation.isPending}
                onClick={() => validateMutation.mutate()}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Validate
              </Button>
              {onSelectDatasetForExperiment && (
                <Button
                  size="sm"
                  onClick={() => onSelectDatasetForExperiment(activeDataset.id)}
                  disabled={activeDataset.task_count === 0}
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  Use in Experiment
                </Button>
              )}
            </div>
          </div>

          {/* Validation Breakdown Banner */}
          {validationResult && (
            <div className="px-5 py-3 bg-surface border-b border-border flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-text-primary flex items-center gap-1.5 mr-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                Validation Breakdown:
              </span>
              {Object.entries(validationResult.category_breakdown).map(([cat, count]) => (
                <span
                  key={cat}
                  className="px-2 py-0.5 rounded bg-canvas border border-border font-mono text-[11px] text-text-primary"
                >
                  {cat}: {count}
                </span>
              ))}
            </div>
          )}

          {/* Tasks Filter & Search */}
          <div className="p-4 border-b border-border flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="h-3.5 w-3.5 text-text-secondary absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks by key or category..."
                aria-label="Filter tasks"
                className="w-full h-8 pl-8 pr-3 rounded-md border border-border bg-canvas text-xs"
              />
            </div>
            <span className="text-xs font-mono text-text-secondary">
              Showing {filteredTasks.length} of {tasks.length} tasks
            </span>
          </div>

          {/* Tasks Table */}
          {tasksQuery.isPending ? (
            <div className="p-8 text-center text-xs text-text-secondary">Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <p className="text-sm text-text-secondary">
                This dataset does not contain any evaluation tasks yet.
              </p>
              <Button size="sm" onClick={() => setSyntheticOpen(true)}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Generate 6-Category Synthetic Suite
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-canvas/70 text-xs font-medium text-text-secondary">
                    <th className="py-2.5 px-4">Task Key</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Difficulty</th>
                    <th className="py-2.5 px-4">Turns</th>
                    <th className="py-2.5 px-4">Evaluation Query</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono text-xs">
                  {filteredTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-canvas/50">
                      <td className="py-2.5 px-4 font-semibold text-text-primary">{t.task_key}</td>
                      <td className="py-2.5 px-4">
                        <span className="px-1.5 py-0.5 rounded bg-canvas border border-border text-[11px]">
                          {t.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 uppercase text-[11px] text-text-secondary">
                        {t.difficulty}
                      </td>
                      <td className="py-2.5 px-4 text-text-secondary">
                        {t.conversation_sequence.length} turn(s)
                      </td>
                      <td className="py-2.5 px-4 font-sans text-xs text-text-secondary truncate max-w-xs">
                        {String(t.evaluation_query.question ?? '—')}
                      </td>
                      <td className="py-2.5 px-4 text-right font-sans">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setInspectTask(t)}
                          aria-label={`Inspect ${t.task_key}`}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: Create Dataset */}
      <CreateDatasetModal
        open={createOpen}
        projectId={projectId}
        onClose={() => setCreateOpen(false)}
        onCreated={(ds) => {
          setSelectedDatasetId(ds.id);
          void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
        }}
      />

      {/* MODAL 2: Synthetic Generator */}
      {activeDataset && (
        <SyntheticGeneratorModal
          key={`synth-${activeDataset.id}`}
          open={syntheticOpen}
          dataset={activeDataset}
          onClose={() => setSyntheticOpen(false)}
          onGenerated={() => {
            setSyntheticOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
            void queryClient.invalidateQueries({ queryKey: ['tasks', activeDataset.id] });
          }}
        />
      )}

      {/* MODAL 3: Bulk Task Import */}
      {activeDataset && (
        <ImportTasksModal
          key={`import-${activeDataset.id}`}
          open={importOpen}
          dataset={activeDataset}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
            void queryClient.invalidateQueries({ queryKey: ['tasks', activeDataset.id] });
          }}
        />
      )}

      {/* MODAL 4: Inspect Task Details */}
      {inspectTask && (
        <InspectTaskModal task={inspectTask} onClose={() => setInspectTask(null)} />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponent: Create Dataset Modal
// -----------------------------------------------------------------------------
interface CreateDatasetModalProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (ds: DatasetResponse) => void;
}

function CreateDatasetModal({ open, projectId, onClose, onCreated }: CreateDatasetModalProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createDataset(projectId, {
        name: name.trim(),
        version: version.trim() || '1.0.0',
        description: description.trim() || null,
      }),
    onSuccess: (ds) => {
      pushToast({ title: 'Dataset created', description: ds.name, variant: 'success' });
      setName('');
      setDescription('');
      onClose();
      onCreated(ds);
    },
    onError: (err) => {
      pushToast({
        title: 'Creation failed',
        description: err instanceof ApiClientError ? err.message : 'Could not create dataset.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Benchmark Dataset"
      description="Datasets contain standardized multi-turn conversations and ground-truth tasks."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="create-ds-name" className="block text-sm font-medium text-text-primary mb-1">
            Dataset Name <span className="text-error">*</span>
          </label>
          <input
            id="create-ds-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Core 6-Category Benchmark Suite"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
          />
        </div>

        <div>
          <label htmlFor="create-ds-ver" className="block text-sm font-medium text-text-primary mb-1">
            Version
          </label>
          <input
            id="create-ds-ver"
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm font-mono"
          />
        </div>

        <div>
          <label htmlFor="create-ds-desc" className="block text-sm font-medium text-text-primary mb-1">
            Description
          </label>
          <textarea
            id="create-ds-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Evaluation target, domain notes, or methodology"
            className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={mutation.isPending}>
            Create Dataset
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Subcomponent: Synthetic Generator Modal
// -----------------------------------------------------------------------------
interface SyntheticGeneratorModalProps {
  open: boolean;
  dataset: DatasetResponse;
  onClose: () => void;
  onGenerated: () => void;
}

function SyntheticGeneratorModal({
  open,
  dataset,
  onClose,
  onGenerated,
}: SyntheticGeneratorModalProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);
  const [tasksPerCat, setTasksPerCat] = useState('2');
  const [distractorCount, setDistractorCount] = useState('6');
  const [seed, setSeed] = useState('42');

  const mutation = useMutation({
    mutationFn: () =>
      generateSyntheticTasks(dataset.id, {
        tasks_per_category: Number(tasksPerCat) || 2,
        distractor_count: Number(distractorCount) || 6,
        seed: Number(seed) || 42,
      }),
    onSuccess: (res) => {
      pushToast({
        title: 'Synthetic tasks generated',
        description: `Added ${res.generated_count} tasks (total: ${res.total_tasks}).`,
        variant: 'success',
      });
      onGenerated();
    },
    onError: (err) => {
      pushToast({
        title: 'Generation failed',
        description: err instanceof ApiClientError ? err.message : 'Could not generate tasks.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const totalTasks = (Number(tasksPerCat) || 2) * 6;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate 6-Category Synthetic Suite"
      description={`Generate benchmark tasks into ${dataset.name}.`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 rounded-md border border-border bg-canvas/40 text-xs text-text-secondary leading-relaxed">
          Generates balanced tasks across: <strong>fact_retrieval</strong>,{' '}
          <strong>temporal_reasoning</strong>, <strong>contradiction_handling</strong>,{' '}
          <strong>multi_hop</strong>, <strong>memory_updating</strong>, and{' '}
          <strong>memory_deletion</strong>.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="synth-per-cat" className="block text-xs font-medium text-text-secondary mb-1">
              Tasks Per Category ({tasksPerCat} × 6 = {totalTasks})
            </label>
            <input
              id="synth-per-cat"
              type="number"
              min="1"
              max="50"
              value={tasksPerCat}
              onChange={(e) => setTasksPerCat(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm font-mono"
            />
          </div>

          <div>
            <label htmlFor="synth-distractors" className="block text-xs font-medium text-text-secondary mb-1">
              Distractor Turns
            </label>
            <input
              id="synth-distractors"
              type="number"
              min="0"
              max="20"
              value={distractorCount}
              onChange={(e) => setDistractorCount(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label htmlFor="synth-seed" className="block text-xs font-medium text-text-secondary mb-1">
            Deterministic Random Seed
          </label>
          <input
            id="synth-seed"
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm font-mono"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={mutation.isPending}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Generate {totalTasks} Tasks
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Subcomponent: Bulk Task Import Modal
// -----------------------------------------------------------------------------
interface ImportTasksModalProps {
  open: boolean;
  dataset: DatasetResponse;
  onClose: () => void;
  onImported: () => void;
}

const SAMPLE_IMPORT_JSON = JSON.stringify(
  [
    {
      task_key: 'custom_fact_001',
      category: 'fact_retrieval',
      difficulty: 'easy',
      conversation_sequence: [
        { sequence_number: 1, role: 'user', content: 'My favorite editor is Vim.' },
        { sequence_number: 2, role: 'assistant', content: 'Noted that you like Vim.' },
      ],
      evaluation_query: {
        operation: 'retrieve',
        question: 'What editor does the user prefer?',
        top_k: 5,
      },
      expected_answer: {
        answer: 'Vim',
        accepted_answers: ['Vim', 'vim'],
        required_terms: ['Vim'],
        forbidden_terms: [],
        evaluation_method: 'normalized',
      },
      metadata: {},
    },
  ],
  null,
  2,
);

function ImportTasksModal({ open, dataset, onClose, onImported }: ImportTasksModalProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);
  const [jsonText, setJsonText] = useState(SAMPLE_IMPORT_JSON);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (tasks: Array<Record<string, unknown>>) => importTasks(dataset.id, tasks),
    onSuccess: (res) => {
      pushToast({
        title: 'Import completed',
        description: `Imported ${res.imported_count} task(s). Total: ${res.total_tasks}`,
        variant: 'success',
      });
      onImported();
    },
    onError: (err) => {
      pushToast({
        title: 'Import failed',
        description: err instanceof ApiClientError ? err.message : 'Failed to import tasks.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setJsonError(null);
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setJsonError('Expected a non-empty JSON array of task objects.');
        return;
      }
      mutation.mutate(parsed as Array<Record<string, unknown>>);
    } catch {
      setJsonError('Invalid JSON format. Check syntax and commas.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk Import Benchmark Tasks"
      description={`Import task objects into ${dataset.name}.`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="import-json-text" className="block text-xs font-medium text-text-secondary mb-1">
            Tasks JSON Array
          </label>
          <textarea
            id="import-json-text"
            rows={10}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            className="w-full px-3 py-2 rounded-md border border-border bg-canvas text-xs font-mono text-text-primary"
          />
          {jsonError && <p className="text-xs text-error mt-1">{jsonError}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={mutation.isPending}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import Tasks
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Subcomponent: Inspect Task Modal
// -----------------------------------------------------------------------------
interface InspectTaskModalProps {
  task: TaskResponse;
  onClose: () => void;
}

function InspectTaskModal({ task, onClose }: InspectTaskModalProps) {
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Task Inspection: ${task.task_key}`}
      description={`Category: ${task.category} · Difficulty: ${task.difficulty}`}
    >
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <div>
          <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            Conversation Sequence ({task.conversation_sequence.length} turns)
          </h4>
          <div className="space-y-2 border border-border rounded-md p-3 bg-canvas/30 text-xs">
            {task.conversation_sequence.map((turn, i) => (
              <div key={i} className="space-y-0.5 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                <span className="font-mono text-[11px] font-semibold uppercase text-text-secondary">
                  #{String(turn.sequence_number ?? i + 1)} · {String(turn.role ?? 'user')}
                </span>
                <p className="text-text-primary font-sans">{String(turn.content ?? '')}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <FileCode className="h-3.5 w-3.5 text-primary" />
            Evaluation Query
          </h4>
          <div className="p-3 rounded-md border border-border bg-canvas/40 font-mono text-xs text-text-primary">
            <p>
              <strong>Question:</strong> {String(task.evaluation_query.question ?? '')}
            </p>
            <p className="text-text-secondary mt-1">
              Operation: {String(task.evaluation_query.operation ?? 'retrieve')} · Top-K:{' '}
              {String(task.evaluation_query.top_k ?? 5)}
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}