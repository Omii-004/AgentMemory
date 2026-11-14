import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Database,
  FlaskConical,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { EmptyState, LoadingState } from '@/components/common/StateViews';
import { ApiClientError } from '@/services/api-client';
import { listDatasets } from '@/services/dataset.service';
import { createExperiment, startRun } from '@/services/experiment.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ArchitectureType, ExperimentCreate, RunResponse } from '@/types/api';

interface ExperimentWizardProps {
  projectId: string;
  initialDatasetId?: string | null;
  onRunStarted: (run: RunResponse, experimentId: string) => void;
  onGoToDatasets?: () => void;
}

const ALL_ARCHITECTURES: ArchitectureType[] = ['history', 'vector', 'structured', 'hybrid'];

export function ExperimentWizard({
  projectId,
  initialDatasetId,
  onRunStarted,
  onGoToDatasets,
}: ExperimentWizardProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);

  // Step 1: Details
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Step 2: Architectures
  const [selectedArchs, setSelectedArchs] = useState<ArchitectureType[]>([
    'history',
    'vector',
    'structured',
    'hybrid',
  ]);
  const [historyWindow, setHistoryWindow] = useState('5');
  const [vectorThreshold, setVectorThreshold] = useState('0.0');

  // Step 3: Dataset
  const [datasetId, setDatasetId] = useState<string | null>(initialDatasetId ?? null);

  // Step 4: Model
  const [llmProvider, setLlmProvider] = useState<'mock' | 'ollama' | 'openai_compatible'>('mock');
  const [llmModel, setLlmModel] = useState('mock-evaluator');
  const [temperature, setTemperature] = useState('0.0');
  const [maxTokens, setMaxTokens] = useState('512');

  // Step 5: Controls
  const [numTrials, setNumTrials] = useState('1');
  const [seed, setSeed] = useState('42');

  // Queries
  const datasetsQuery = useQuery({
    queryKey: ['datasets', projectId],
    queryFn: () => listDatasets(projectId),
    enabled: Boolean(projectId),
  });

  const datasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);
  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === datasetId) ?? datasets[0] ?? null,
    [datasets, datasetId],
  );

  const activeDatasetId = selectedDataset?.id ?? null;

  // Launch Mutation
  const launchMutation = useMutation({
    mutationFn: async () => {
      const archConfigs: Record<string, Record<string, unknown>> = {};
      if (selectedArchs.includes('history')) {
        archConfigs.history = { window_size: Number(historyWindow) || 5 };
      }
      if (selectedArchs.includes('vector')) {
        archConfigs.vector = { similarity_threshold: Number(vectorThreshold) || 0.0 };
      }

      const payload: ExperimentCreate = {
        name: name.trim(),
        description: description.trim() || null,
        dataset_id: activeDatasetId!,
        architectures: selectedArchs,
        llm_provider: llmProvider,
        llm_model: llmModel.trim() || null,
        num_trials: Number(numTrials) || 1,
        temperature: Number(temperature) || 0.0,
        max_tokens: Number(maxTokens) || 512,
        architecture_configs: archConfigs,
      };

      const exp = await createExperiment(projectId, payload);
      const run = await startRun(exp.id, { random_seed: Number(seed) || 42 });
      return { exp, run };
    },
    onSuccess: ({ exp, run }) => {
      pushToast({
        title: 'Experiment launched',
        description: `Run #${run.run_number} started for "${exp.name}".`,
        variant: 'success',
      });
      onRunStarted(run, exp.id);
    },
    onError: (err) => {
      pushToast({
        title: 'Launch failed',
        description: err instanceof ApiClientError ? err.message : 'Could not launch experiment.',
        variant: 'error',
      });
    },
  });

  const toggleArch = (arch: ArchitectureType) => {
    setSelectedArchs((prev) =>
      prev.includes(arch) ? prev.filter((a) => a !== arch) : [...prev, arch],
    );
  };

  const estimatedTasks =
    selectedArchs.length * (Number(numTrials) || 1) * (selectedDataset?.task_count ?? 0);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !activeDatasetId || selectedArchs.length === 0) return;
    launchMutation.mutate();
  };

  if (datasetsQuery.isPending) {
    return <LoadingState label="Loading datasets for experiment configuration..." />;
  }

  if (datasets.length === 0) {
    return (
      <EmptyState
        title="No datasets available"
        description="Benchmark experiments require a dataset with tasks. Generate or import tasks in the Datasets & Tasks tab."
        action={
          onGoToDatasets ? (
            <Button onClick={onGoToDatasets}>
              <Database className="h-4 w-4" aria-hidden="true" />
              Go to Datasets Studio
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
      {/* Stepper Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between text-xs font-medium text-text-secondary overflow-x-auto gap-2">
          {[
            { s: 1, label: 'Details' },
            { s: 2, label: 'Architectures' },
            { s: 3, label: 'Dataset' },
            { s: 4, label: 'LLM Model' },
            { s: 5, label: 'Controls' },
            { s: 6, label: 'Review & Launch' },
          ].map(({ s, label }) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s as 1 | 2 | 3 | 4 | 5 | 6)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full whitespace-nowrap cursor-pointer transition-colors ${
                step === s
                  ? 'bg-primary text-white font-semibold'
                  : step > s
                    ? 'text-text-primary hover:bg-canvas'
                    : 'text-text-secondary opacity-60'
              }`}
            >
              <span>{s}.</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* STEP 1: DETAILS */}
        {step === 1 && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h3 className="text-base font-semibold text-text-primary">Step 1 — Experiment Details</h3>
              <p className="text-xs text-text-secondary mt-1">
                Define the research study title and hypothesis to test across memory architectures.
              </p>
            </div>

            <div>
              <label htmlFor="exp-name-input" className="block text-sm font-medium text-text-primary mb-1">
                Experiment Name <span className="text-error">*</span>
              </label>
              <input
                id="exp-name-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., 4-Architecture Temporal Recall Evaluation"
                className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
              />
            </div>

            <div>
              <label htmlFor="exp-desc-input" className="block text-sm font-medium text-text-primary mb-1">
                Research Hypothesis / Description
              </label>
              <textarea
                id="exp-desc-input"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Evaluating whether hybrid composite scoring achieves higher TSR than pure vector cosine similarity on contradiction handling tasks."
                className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm"
              />
            </div>
          </div>
        )}

        {/* STEP 2: ARCHITECTURES */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-text-primary">
                Step 2 — Select Memory Architectures
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Select 1 to 4 architectures to benchmark under identical conditions.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {ALL_ARCHITECTURES.map((arch) => {
                const checked = selectedArchs.includes(arch);
                return (
                  <div
                    key={arch}
                    onClick={() => toggleArch(arch)}
                    className={`p-4 rounded-lg border text-left cursor-pointer transition-all ${
                      checked
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                        : 'border-border bg-canvas/30 hover:bg-canvas opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs font-semibold uppercase">{arch}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {}}
                        aria-label={`Select ${arch} architecture`}
                        className="rounded border-border text-primary"
                      />
                    </div>
                    <p className="text-xs text-text-secondary capitalize">
                      {arch === 'history' && 'Sliding context window (N turns)'}
                      {arch === 'vector' && 'pgvector cosine distance dense retrieval'}
                      {arch === 'structured' && 'Subject-Predicate-Object relational triples'}
                      {arch === 'hybrid' && 'Multi-factor composite score ranking'}
                    </p>
                  </div>
                );
              })}
            </div>

            {selectedArchs.length === 0 && (
              <p className="text-xs text-error font-medium">
                Select at least one architecture for evaluation.
              </p>
            )}

            {/* Per-Architecture Configs */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {selectedArchs.includes('history') && (
                <div className="p-3 border border-border rounded-md bg-canvas/30">
                  <label htmlFor="cfg-history-win" className="block text-xs font-medium text-text-secondary mb-1">
                    History Context Window (turns)
                  </label>
                  <input
                    id="cfg-history-win"
                    type="number"
                    min="1"
                    max="50"
                    value={historyWindow}
                    onChange={(e) => setHistoryWindow(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-border bg-surface text-xs font-mono"
                  />
                </div>
              )}
              {selectedArchs.includes('vector') && (
                <div className="p-3 border border-border rounded-md bg-canvas/30">
                  <label htmlFor="cfg-vector-thresh" className="block text-xs font-medium text-text-secondary mb-1">
                    Vector Similarity Threshold (0.0 to 1.0)
                  </label>
                  <input
                    id="cfg-vector-thresh"
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={vectorThreshold}
                    onChange={(e) => setVectorThreshold(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-border bg-surface text-xs font-mono"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: DATASET */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-text-primary">Step 3 — Select Dataset</h3>
              <p className="text-xs text-text-secondary mt-1">
                Choose the benchmark dataset to execute against each selected architecture.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {datasets.map((ds) => {
                const isSelected = ds.id === activeDatasetId;
                return (
                  <div
                    key={ds.id}
                    onClick={() => setDatasetId(ds.id)}
                    className={`p-4 rounded-lg border text-left cursor-pointer transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                        : 'border-border bg-canvas/30 hover:bg-canvas'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm text-text-primary">{ds.name}</span>
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface border border-border">
                        v{ds.version}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-2">
                      {ds.description || 'No description provided.'}
                    </p>
                    <p className="mt-2 text-xs font-mono font-semibold text-primary">
                      {ds.task_count} tasks
                    </p>
                  </div>
                );
              })}
            </div>

            {selectedDataset && selectedDataset.task_count === 0 && (
              <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-xs text-warning">
                Warning: The selected dataset contains 0 tasks. Populate tasks in the Datasets tab
                before launching.
              </div>
            )}
          </div>
        )}

        {/* STEP 4: MODEL */}
        {step === 4 && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h3 className="text-base font-semibold text-text-primary">Step 4 — LLM Model Setup</h3>
              <p className="text-xs text-text-secondary mt-1">
                Configure the LLM adapter used to answer benchmark evaluation queries.
              </p>
            </div>

            <div>
              <label htmlFor="wizard-llm-provider" className="block text-xs font-medium text-text-secondary mb-1">
                LLM Provider
              </label>
              <select
                id="wizard-llm-provider"
                value={llmProvider}
                onChange={(e) =>
                  setLlmProvider(e.target.value as 'mock' | 'ollama' | 'openai_compatible')
                }
                className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm font-mono"
              >
                <option value="mock">mock (offline deterministic evaluation)</option>
                <option value="ollama">ollama (local model service)</option>
                <option value="openai_compatible">openai_compatible (custom endpoint)</option>
              </select>
            </div>

            <div>
              <label htmlFor="wizard-llm-model" className="block text-xs font-medium text-text-secondary mb-1">
                Model Identifier
              </label>
              <input
                id="wizard-llm-model"
                type="text"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                placeholder="e.g., mock-evaluator, llama3:8b, gpt-4o-mini"
                className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="wizard-llm-temp" className="block text-xs font-medium text-text-secondary mb-1">
                  Temperature: {temperature}
                </label>
                <input
                  id="wizard-llm-temp"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <label htmlFor="wizard-llm-maxtokens" className="block text-xs font-medium text-text-secondary mb-1">
                  Max Output Tokens
                </label>
                <input
                  id="wizard-llm-maxtokens"
                  type="number"
                  min="64"
                  max="4096"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-surface text-xs font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: CONTROLS */}
        {step === 5 && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h3 className="text-base font-semibold text-text-primary">
                Step 5 — Benchmark Run Controls
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Configure repeated trials and deterministic seeded execution.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="wizard-ctrl-trials" className="block text-xs font-medium text-text-secondary mb-1">
                  Repeated Trials (1 to 10)
                </label>
                <input
                  id="wizard-ctrl-trials"
                  type="number"
                  min="1"
                  max="10"
                  value={numTrials}
                  onChange={(e) => setNumTrials(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm font-mono"
                />
              </div>

              <div>
                <label htmlFor="wizard-ctrl-seed" className="block text-xs font-medium text-text-secondary mb-1">
                  Random Seed
                </label>
                <input
                  id="wizard-ctrl-seed"
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm font-mono"
                />
              </div>
            </div>

            <div className="p-3 rounded-md border border-border bg-canvas/30 text-xs text-text-secondary space-y-1">
              <p className="font-semibold text-text-primary">Fault Isolation Policy:</p>
              <p>
                Each task executes with individual session rollback recovery. A task failure does
                not crash the run.
              </p>
            </div>
          </div>
        )}

        {/* STEP 6: REVIEW & LAUNCH */}
        {step === 6 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-text-primary">
                Step 6 — Review Pre-flight & Launch
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Confirm your experiment configuration before starting the benchmark execution.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 border border-border rounded bg-canvas/30">
                <span className="text-text-secondary block">Experiment</span>
                <span className="font-semibold text-text-primary mt-1 block truncate">
                  {name || 'Untitled Experiment'}
                </span>
              </div>
              <div className="p-3 border border-border rounded bg-canvas/30">
                <span className="text-text-secondary block">Dataset</span>
                <span className="font-semibold text-text-primary mt-1 block truncate">
                  {selectedDataset?.name} ({selectedDataset?.task_count} tasks)
                </span>
              </div>
              <div className="p-3 border border-border rounded bg-canvas/30">
                <span className="text-text-secondary block">Architectures</span>
                <span className="font-mono text-primary mt-1 block truncate">
                  {selectedArchs.join(', ')}
                </span>
              </div>
              <div className="p-3 border border-border rounded bg-canvas/30">
                <span className="text-text-secondary block">Estimated Task Executions</span>
                <span className="font-mono text-lg font-bold text-text-primary mt-0.5 block">
                  {estimatedTasks}
                </span>
              </div>
            </div>

            <div className="p-4 border border-border rounded-md bg-canvas/40 space-y-2 text-xs font-mono text-text-secondary">
              <p>LLM Provider: {llmProvider}</p>
              <p>LLM Model: {llmModel}</p>
              <p>Trials: {numTrials} · Random Seed: {seed}</p>
            </div>
          </div>
        )}

        {/* Stepper Footer Controls */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button
            type="button"
            variant="outline"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3 | 4 | 5 | 6)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </Button>

          {step < 6 ? (
            <Button
              type="button"
              disabled={
                (step === 1 && !name.trim()) ||
                (step === 2 && selectedArchs.length === 0) ||
                (step === 3 && !activeDatasetId)
              }
              onClick={() => setStep((s) => Math.min(6, s + 1) as 1 | 2 | 3 | 4 | 5 | 6)}
            >
              Next Step
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              isLoading={launchMutation.isPending}
              disabled={!name.trim() || !activeDatasetId || selectedArchs.length === 0}
            >
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
              Launch Benchmark Run
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}