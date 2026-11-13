import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Clock,
  Cpu,
  Database,
  Layers,
  Network,
  Plus,
  Search,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/lib/utils';
import { ApiClientError } from '@/services/api-client';
import {
  consolidateNamespace,
  createNamespace,
  listArchitectures,
  listNamespaces,
  retrieveMemories,
  storeMemory,
  updateNamespace,
} from '@/services/memory.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type {
  ArchitectureType,
  ConsolidationResult,
  MemoryOperationResult,
  MemoryRetrieveRequest,
  MemoryStoreRequest,
  NamespaceResponse,
} from '@/types/api';

const ARCHITECTURE_METADATA: Record<
  ArchitectureType,
  {
    icon: typeof Cpu;
    tagline: string;
    description: string;
    capabilities: string[];
    defaultConfigSummary: string;
  }
> = {
  history: {
    icon: Clock,
    tagline: 'Sliding Context Window',
    description:
      'Retains raw interaction turns and supplies the most recent N turns in chronological sequence without vector indexing.',
    capabilities: ['Sliding context window', 'Zero embedding latency', 'Chronological preservation'],
    defaultConfigSummary: 'window_size: 5',
  },
  vector: {
    icon: Cpu,
    tagline: 'Semantic Dense Retrieval',
    description:
      'Encodes content into 384-dimensional dense vectors using all-MiniLM-L6-v2 and queries via pgvector cosine distance (<=>).',
    capabilities: ['pgvector cosine distance', 'SentenceTransformers', 'Top-K semantic similarity'],
    defaultConfigSummary: 'similarity_threshold: 0.0',
  },
  structured: {
    icon: Network,
    tagline: 'Relational S-P-O Facts',
    description:
      'Extracts Subject-Predicate-Object triples with temporal validity bounds (valid_from, valid_to), point-in-time queries, and contradiction superseding.',
    capabilities: ['Explicit fact triples', 'Temporal validity bounds', 'Contradiction handling'],
    defaultConfigSummary: 'Exact relational matching',
  },
  hybrid: {
    icon: Layers,
    tagline: 'Multi-Factor Composite Ranking',
    description:
      'Combines semantic similarity, importance, recency time-decay, and confidence into a normalized composite score with fact boosting.',
    capabilities: ['Composite score ranking', 'Time-decay recency', 'Contradiction superseding'],
    defaultConfigSummary: 'sim: 0.5, imp: 0.2, rec: 0.2, conf: 0.1',
  },
};

export function MemoryLabPage() {
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useWorkspaceStore();

  const [createNsOpen, setCreateNsOpen] = useState(false);
  const [selectedNamespaceId, setSelectedNamespaceId] = useState<string | null>(null);
  const [editingNamespace, setEditingNamespace] = useState<NamespaceResponse | null>(null);
  const [workbenchTab, setWorkbenchTab] = useState<'store' | 'retrieve' | 'consolidate'>('store');

  // Queries
  const archCatalogQuery = useQuery({
    queryKey: ['architectures'],
    queryFn: listArchitectures,
  });

  const namespacesQuery = useQuery({
    queryKey: ['namespaces', activeProjectId, false],
    queryFn: () => listNamespaces(activeProjectId!, false),
    enabled: Boolean(activeProjectId),
  });

  const namespaces = useMemo(() => namespacesQuery.data ?? [], [namespacesQuery.data]);
  const activeNamespace = useMemo(
    () => namespaces.find((n) => n.id === selectedNamespaceId) ?? namespaces[0] ?? null,
    [namespaces, selectedNamespaceId],
  );

  // Architecture breakdown counts
  const namespaceCountByArch = useMemo(() => {
    const counts: Record<string, number> = { history: 0, vector: 0, structured: 0, hybrid: 0 };
    for (const ns of namespaces) {
      if (counts[ns.architecture_type] !== undefined) {
        counts[ns.architecture_type] += 1;
      }
    }
    return counts;
  }, [namespaces]);

  // Workbench operation states
  const [lastStoreResult, setLastStoreResult] = useState<MemoryOperationResult | null>(null);
  const [lastRetrieveResult, setLastRetrieveResult] = useState<MemoryOperationResult | null>(null);
  const [lastConsolidateResult, setLastConsolidateResult] = useState<ConsolidationResult | null>(
    null,
  );

  // Store form state
  const [storeContent, setStoreContent] = useState('');
  const [storeType, setStoreType] = useState('semantic');
  const [storeImportance, setStoreImportance] = useState('0.5');
  const [storeConfidence, setStoreConfidence] = useState('1.0');
  const [storeSubject, setStoreSubject] = useState('');
  const [storePredicate, setStorePredicate] = useState('');
  const [storeObject, setStoreObject] = useState('');

  // Retrieve form state
  const [retrieveQuery, setRetrieveQuery] = useState('');
  const [retrieveTopK, setRetrieveTopK] = useState('5');
  const [retrieveAsOf, setRetrieveAsOf] = useState('');

  // Consolidate form state
  const [consolidateMin, setConsolidateMin] = useState('2');

  // Mutations
  const storeMutation = useMutation({
    mutationFn: (payload: MemoryStoreRequest) => storeMemory(activeProjectId!, payload),
    onSuccess: (res) => {
      setLastStoreResult(res);
      setStoreContent('');
      setStoreSubject('');
      setStorePredicate('');
      setStoreObject('');
      void queryClient.invalidateQueries({ queryKey: ['memories', activeProjectId] });
      pushToast({
        title: 'Memory stored',
        description: `${res.affected_memory_ids.length} record(s) created in ${res.latency_ms} ms.`,
        variant: 'success',
      });
    },
    onError: (err) => {
      pushToast({
        title: 'Store failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to store memory.',
        variant: 'error',
      });
    },
  });

  const retrieveMutation = useMutation({
    mutationFn: (payload: MemoryRetrieveRequest) => retrieveMemories(activeProjectId!, payload),
    onSuccess: (res) => {
      setLastRetrieveResult(res);
      pushToast({
        title: 'Retrieval completed',
        description: `Returned ${res.retrieved_memories.length} candidate(s) in ${res.latency_ms} ms.`,
        variant: 'info',
      });
    },
    onError: (err) => {
      pushToast({
        title: 'Retrieval failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to retrieve memories.',
        variant: 'error',
      });
    },
  });

  const consolidateMutation = useMutation({
    mutationFn: (payload: { min_memories: number }) =>
      consolidateNamespace(activeNamespace!.id, payload),
    onSuccess: (res) => {
      setLastConsolidateResult(res);
      void queryClient.invalidateQueries({ queryKey: ['memories', activeProjectId] });
      pushToast({
        title: 'Consolidation finished',
        description: `${res.source_count} memories consolidated into summary.`,
        variant: 'success',
      });
    },
    onError: (err) => {
      pushToast({
        title: 'Consolidation failed',
        description: err instanceof ApiClientError ? err.message : 'Consolidation failed.',
        variant: 'error',
      });
    },
  });

  const handleStoreSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!activeNamespace || !storeContent.trim()) return;

    const payload: MemoryStoreRequest = {
      namespace_id: activeNamespace.id,
      content: storeContent.trim(),
      memory_type: storeType,
      importance: Number(storeImportance) || 0.5,
      confidence: Number(storeConfidence) || 1.0,
      subject: storeSubject.trim() || null,
      predicate: storePredicate.trim() || null,
      object_value: storeObject.trim() || null,
    };
    storeMutation.mutate(payload);
  };

  const handleRetrieveSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!activeNamespace || !retrieveQuery.trim()) return;

    const payload: MemoryRetrieveRequest = {
      namespace_id: activeNamespace.id,
      query: retrieveQuery.trim(),
      top_k: Number(retrieveTopK) || 5,
      as_of: retrieveAsOf ? new Date(retrieveAsOf).toISOString() : null,
    };
    retrieveMutation.mutate(payload);
  };

  const handleConsolidateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!activeNamespace) return;
    consolidateMutation.mutate({ min_memories: Number(consolidateMin) || 2 });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Memory Lab</h1>
          <p className="text-sm text-text-secondary mt-1">
            Configure built-in memory architectures, manage project stores, and interactively test
            retrieval and consolidation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/memory-inspector">
            <Button variant="outline">
              <Search className="h-4 w-4" aria-hidden="true" />
              Memory Inspector
            </Button>
          </Link>
          <Button onClick={() => setCreateNsOpen(true)} disabled={!activeProjectId}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Namespace
          </Button>
        </div>
      </div>

      {/* SECTION 1: Built-in Architecture Catalog (4 Cards) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider text-xs">
            Built-in Memory Architectures
          </h2>
          <span className="text-xs text-text-secondary">
            4 isolated architectures implemented under unified BaseMemory contract
          </span>
        </div>

        {archCatalogQuery.isPending ? (
          <LoadingState label="Loading architecture catalog..." />
        ) : archCatalogQuery.isError ? (
          <ErrorState
            message="Could not load architectures catalog."
            onRetry={() => void archCatalogQuery.refetch()}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(['history', 'vector', 'structured', 'hybrid'] as ArchitectureType[]).map((arch) => {
              const meta = ARCHITECTURE_METADATA[arch];
              const Icon = meta.icon;
              const count = namespaceCountByArch[arch] ?? 0;
              return (
                <div
                  key={arch}
                  className="bg-surface border border-border rounded-lg p-5 flex flex-col justify-between hover:border-primary/40 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="inline-flex items-center justify-center p-2 rounded-md bg-canvas border border-border text-primary">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-canvas border border-border text-text-secondary uppercase">
                        {arch}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-text-primary capitalize">{arch}</h3>
                    <p className="text-xs font-medium text-primary mt-0.5">{meta.tagline}</p>
                    <p className="text-xs text-text-secondary mt-2 line-clamp-3 leading-relaxed">
                      {meta.description}
                    </p>

                    <div className="mt-3 pt-3 border-t border-border space-y-1">
                      {meta.capabilities.map((cap) => (
                        <div
                          key={cap}
                          className="flex items-center gap-1.5 text-[11px] text-text-secondary"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                          <span className="truncate">{cap}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                    <span className="text-text-secondary">
                      Stores: <strong className="text-text-primary font-mono">{count}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={!activeProjectId}
                      onClick={() => setCreateNsOpen(true)}
                      className="text-primary hover:underline font-medium cursor-pointer disabled:opacity-40"
                    >
                      + Add store
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 2 & 3: Project Namespaces & Interactive Workbench */}
      {!activeProjectId ? (
        <EmptyState
          title="No active workspace selected"
          description="Select or create a research project from the Topbar to configure memory stores and run interactive workbench evaluations."
          action={
            <Link to="/projects">
              <Button>
                <Database className="h-4 w-4" aria-hidden="true" />
                Go to Projects
              </Button>
            </Link>
          }
        />
      ) : namespacesQuery.isPending ? (
        <LoadingState label="Loading project memory stores..." />
      ) : namespacesQuery.isError ? (
        <ErrorState
          title="Memory Lab Unavailable"
          message={
            namespacesQuery.error instanceof ApiClientError
              ? namespacesQuery.error.message
              : 'Could not load project memory namespaces.'
          }
          onRetry={() => void namespacesQuery.refetch()}
        />
      ) : (
        <>
          {/* SECTION 2: Project Namespaces */}
          <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-text-primary">
                  Project Memory Namespaces ({namespaces.length})
                </h2>
                <p className="text-xs text-text-secondary">
                  Select an active store to inspect or run workbench experiments against.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setCreateNsOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New Store
              </Button>
            </div>

            {namespaces.length === 0 ? (
              <EmptyState
                title="No memory namespaces configured"
                description="Create a manual memory namespace to test storage, retrieval, and consolidation."
                action={
                  <Button size="sm" onClick={() => setCreateNsOpen(true)}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Create First Store
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {namespaces.map((ns) => {
                  const isSelected = activeNamespace?.id === ns.id;
                  return (
                    <div
                      key={ns.id}
                      onClick={() => setSelectedNamespaceId(ns.id)}
                      className={`p-4 rounded-lg border text-left cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                          : 'border-border bg-canvas/40 hover:bg-canvas hover:border-border/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-mono text-xs font-semibold uppercase px-2 py-0.5 rounded bg-surface border border-border text-text-primary">
                          {ns.architecture_type}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNamespace(ns);
                          }}
                          className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-canvas cursor-pointer"
                          title="Edit configuration"
                          aria-label={`Edit ${ns.name} configuration`}
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-sm font-semibold text-text-primary truncate">{ns.name}</p>
                      <p className="font-mono text-[11px] text-text-secondary truncate mt-0.5">
                        {ns.id}
                      </p>
                                            <div className="mt-2 pt-2 border-t border-border/70 flex items-center justify-between text-[11px] text-text-secondary">
                        <span className="truncate">
                          {Object.keys(ns.config ?? {}).length > 0
                            ? JSON.stringify(ns.config ?? {}).slice(0, 30)
                            : 'Default config'}
                        </span>
                        <span className="shrink-0">{formatDateTime(ns.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 3: Interactive Workbench (Store / Retrieve / Consolidate) */}
          {activeNamespace && (
            <section className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-canvas/40">
                <div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-text-primary">Interactive Workbench</h2>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      {activeNamespace.name} ({activeNamespace.architecture_type})
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Send live requests to verify latency, ranking behavior, and semantic consolidation.
                  </p>
                </div>

                <div className="flex items-center gap-1 bg-surface border border-border rounded-md p-1">
                  <button
                    type="button"
                    onClick={() => setWorkbenchTab('store')}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                      workbenchTab === 'store'
                        ? 'bg-primary text-white'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Store Memory
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkbenchTab('retrieve')}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                      workbenchTab === 'retrieve'
                        ? 'bg-primary text-white'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Retrieve Memories
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkbenchTab('consolidate')}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                      workbenchTab === 'consolidate'
                        ? 'bg-primary text-white'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Consolidate
                  </button>
                </div>
              </div>

              <div className="p-5">
                {/* WORKBENCH TAB 1: STORE MEMORY */}
                {workbenchTab === 'store' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <form onSubmit={handleStoreSubmit} className="lg:col-span-6 space-y-4">
                      <div>
                        <label htmlFor="store-content" className="block text-xs font-medium text-text-secondary mb-1">
                          Memory Content <span className="text-error">*</span>
                        </label>
                        <textarea
                          id="store-content"
                          required
                          rows={4}
                          value={storeContent}
                          onChange={(e) => setStoreContent(e.target.value)}
                          placeholder="e.g., The system operates in UTC. User changed timezone preference to Asia/Tokyo on 2026-11-12."
                          className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-primary"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label htmlFor="store-type" className="block text-xs font-medium text-text-secondary mb-1">
                            Memory Type
                          </label>
                          <select
                            id="store-type"
                            value={storeType}
                            onChange={(e) => setStoreType(e.target.value)}
                            className="w-full h-9 px-2 rounded-md border border-border bg-surface text-xs font-mono"
                          >
                            <option value="semantic">semantic</option>
                            <option value="episodic">episodic</option>
                            <option value="structured">structured</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="store-importance" className="block text-xs font-medium text-text-secondary mb-1">
                            Importance: {storeImportance}
                          </label>
                          <input
                            id="store-importance"
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={storeImportance}
                            onChange={(e) => setStoreImportance(e.target.value)}
                            className="w-full"
                          />
                        </div>

                        <div>
                          <label htmlFor="store-confidence" className="block text-xs font-medium text-text-secondary mb-1">
                            Confidence: {storeConfidence}
                          </label>
                          <input
                            id="store-confidence"
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={storeConfidence}
                            onChange={(e) => setStoreConfidence(e.target.value)}
                            className="w-full"
                          />
                        </div>
                      </div>

                      {(activeNamespace.architecture_type === 'structured' ||
                        activeNamespace.architecture_type === 'hybrid') && (
                        <div className="p-3 rounded-md border border-border bg-canvas/40 space-y-2">
                          <p className="text-xs font-semibold text-text-primary">
                            Optional Relational Fact Attributes (S-P-O)
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={storeSubject}
                              onChange={(e) => setStoreSubject(e.target.value)}
                              placeholder="Subject (e.g. user_preference)"
                              className="h-8 px-2 rounded border border-border bg-surface text-xs font-mono"
                            />
                            <input
                              type="text"
                              value={storePredicate}
                              onChange={(e) => setStorePredicate(e.target.value)}
                              placeholder="Predicate (e.g. timezone)"
                              className="h-8 px-2 rounded border border-border bg-surface text-xs font-mono"
                            />
                            <input
                              type="text"
                              value={storeObject}
                              onChange={(e) => setStoreObject(e.target.value)}
                              placeholder="Object (e.g. Asia/Tokyo)"
                              className="h-8 px-2 rounded border border-border bg-surface text-xs font-mono"
                            />
                          </div>
                        </div>
                      )}

                      <Button type="submit" isLoading={storeMutation.isPending} className="w-full">
                        <Database className="h-4 w-4" aria-hidden="true" />
                        Store Into {activeNamespace.name}
                      </Button>
                    </form>

                    <div className="lg:col-span-6 bg-canvas/40 border border-border rounded-lg p-4 flex flex-col justify-between">
                      <div>
                        <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">
                          Store Operation Trace
                        </h3>
                        {!lastStoreResult ? (
                          <p className="text-xs text-text-secondary leading-relaxed">
                            Submit a memory above to view real execution latency, affected UUIDs, and
                            vector embeddings created.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={lastStoreResult.status} />
                              <span className="font-mono text-xs text-text-secondary">
                                Latency: {lastStoreResult.latency_ms.toFixed(2)} ms
                              </span>
                            </div>
                            <div className="bg-surface border border-border rounded p-3 font-mono text-xs text-text-primary space-y-1">
                              <p>Architecture: {lastStoreResult.architecture}</p>
                              <p>Operation: {lastStoreResult.operation}</p>
                              <p className="truncate">
                                Affected IDs: {lastStoreResult.affected_memory_ids.join(', ')}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-border flex justify-end">
                        <Link
                          to="/memory-inspector"
                          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Open in Memory Inspector
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </div>
                )}

                {/* WORKBENCH TAB 2: RETRIEVE MEMORIES */}
                {workbenchTab === 'retrieve' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <form onSubmit={handleRetrieveSubmit} className="lg:col-span-5 space-y-4">
                      <div>
                        <label htmlFor="retrieve-query" className="block text-xs font-medium text-text-secondary mb-1">
                          Retrieval Query <span className="text-error">*</span>
                        </label>
                        <textarea
                          id="retrieve-query"
                          required
                          rows={3}
                          value={retrieveQuery}
                          onChange={(e) => setRetrieveQuery(e.target.value)}
                          placeholder="e.g., What timezone does the user prefer?"
                          className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-primary"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="retrieve-topk" className="block text-xs font-medium text-text-secondary mb-1">
                            Top-K Candidates
                          </label>
                          <input
                            id="retrieve-topk"
                            type="number"
                            min="1"
                            max="50"
                            value={retrieveTopK}
                            onChange={(e) => setRetrieveTopK(e.target.value)}
                            className="w-full h-9 px-3 rounded-md border border-border bg-surface text-xs font-mono"
                          />
                        </div>

                        <div>
                          <label htmlFor="retrieve-asof" className="block text-xs font-medium text-text-secondary mb-1">
                            Point-in-Time (as_of)
                          </label>
                          <input
                            id="retrieve-asof"
                            type="datetime-local"
                            value={retrieveAsOf}
                            onChange={(e) => setRetrieveAsOf(e.target.value)}
                            className="w-full h-9 px-2 rounded-md border border-border bg-surface text-xs"
                          />
                        </div>
                      </div>

                      <Button type="submit" isLoading={retrieveMutation.isPending} className="w-full">
                        <Search className="h-4 w-4" aria-hidden="true" />
                        Run Retrieval Query
                      </Button>
                    </form>

                    <div className="lg:col-span-7 bg-canvas/40 border border-border rounded-lg p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                            Retrieved Candidates
                          </h3>
                          {lastRetrieveResult && (
                            <span className="font-mono text-xs text-text-secondary">
                              {lastRetrieveResult.retrieved_memories.length} results ·{' '}
                              {lastRetrieveResult.latency_ms.toFixed(2)} ms
                            </span>
                          )}
                        </div>

                        {!lastRetrieveResult ? (
                          <p className="text-xs text-text-secondary leading-relaxed">
                            Enter a retrieval query to inspect ranked candidate memories, similarity
                            scores, and composite ranking factors.
                          </p>
                        ) : lastRetrieveResult.retrieved_memories.length === 0 ? (
                          <p className="text-xs text-text-secondary">
                            No candidates matched this query within the configured thresholds.
                          </p>
                        ) : (
                          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                            {lastRetrieveResult.retrieved_memories.map((rm, idx) => (
                              <div
                                key={rm.id}
                                className="bg-surface border border-border rounded-md p-3 text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono font-semibold text-primary">
                                    #{idx + 1} · Score: {rm.score.toFixed(4)}
                                  </span>
                                  <span className="font-mono text-[11px] text-text-secondary">
                                    {formatDateTime(rm.created_at)}
                                  </span>
                                </div>
                                <p className="text-text-primary leading-relaxed">{rm.content}</p>
                                <div className="flex flex-wrap gap-2 pt-1 font-mono text-[11px] text-text-secondary">
                                  {rm.similarity !== null && <span>Sim: {rm.similarity.toFixed(3)}</span>}
                                  {rm.importance !== null && <span>Imp: {rm.importance.toFixed(3)}</span>}
                                  {rm.recency !== null && <span>Rec: {rm.recency.toFixed(3)}</span>}
                                  {rm.confidence !== null && <span>Conf: {rm.confidence.toFixed(3)}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-border flex justify-end">
                        <Link
                          to="/memory-inspector"
                          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Inspect All in Memory Inspector
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </div>
                )}

                {/* WORKBENCH TAB 3: CONSOLIDATE */}
                {workbenchTab === 'consolidate' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <form onSubmit={handleConsolidateSubmit} className="lg:col-span-5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary">
                          Semantic Memory Consolidation
                        </h3>
                        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                          Merges multiple individual memory records into a higher-level consolidated
                          summary with <span className="font-mono text-primary">derives_from</span>{' '}
                          provenance links, while pruning redundant source embeddings.
                        </p>
                      </div>

                      <div>
                        <label htmlFor="consolidate-min" className="block text-xs font-medium text-text-secondary mb-1">
                          Minimum Source Memories Threshold
                        </label>
                        <input
                          id="consolidate-min"
                          type="number"
                          min="2"
                          max="100"
                          value={consolidateMin}
                          onChange={(e) => setConsolidateMin(e.target.value)}
                          className="w-full h-9 px-3 rounded-md border border-border bg-surface text-xs font-mono"
                        />
                      </div>

                      <Button
                        type="submit"
                        isLoading={consolidateMutation.isPending}
                        className="w-full"
                      >
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                        Execute Semantic Consolidation
                      </Button>
                    </form>

                    <div className="lg:col-span-7 bg-canvas/40 border border-border rounded-lg p-4">
                      <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">
                        Consolidation Outcome
                      </h3>
                      {!lastConsolidateResult ? (
                        <p className="text-xs text-text-secondary leading-relaxed">
                          Run consolidation to see synthesized summary content and provenance links.
                        </p>
                      ) : (
                        <div className="space-y-3 text-xs">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={lastConsolidateResult.status} />
                            <span className="font-mono text-text-secondary">
                              Consolidated {lastConsolidateResult.source_count} source records
                            </span>
                          </div>

                          {lastConsolidateResult.summary_content && (
                            <div className="bg-surface border border-border rounded p-3">
                              <p className="font-semibold text-text-primary mb-1">Synthesized Summary:</p>
                              <p className="text-text-primary leading-relaxed whitespace-pre-wrap">
                                {lastConsolidateResult.summary_content}
                              </p>
                            </div>
                          )}

                          {lastConsolidateResult.source_memory_ids.length > 0 && (
                            <div className="bg-surface border border-border rounded p-3">
                              <p className="font-semibold text-text-primary mb-1">
                                Provenance (derives_from):
                              </p>
                              <div className="space-y-0.5 font-mono text-[11px] text-text-secondary">
                                {lastConsolidateResult.source_memory_ids.map((id) => (
                              <p key={id} className="truncate">
                                • {id}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
        </>
      )}

      {/* MODAL 1: Create Namespace Modal */}
      {activeProjectId && (
        <CreateNamespaceModal
          open={createNsOpen}
          projectId={activeProjectId}
          onClose={() => setCreateNsOpen(false)}
          onCreated={(ns) => {
            setSelectedNamespaceId(ns.id);
            void queryClient.invalidateQueries({ queryKey: ['namespaces', activeProjectId] });
          }}
        />
      )}

      {/* MODAL 2: Edit Namespace Config Modal */}
      {editingNamespace && (
        <EditNamespaceConfigModal
          key={`${editingNamespace.id}:${editingNamespace.name}`}
          namespace={editingNamespace}
          onClose={() => setEditingNamespace(null)}
          onSaved={() => {
            setEditingNamespace(null);
            void queryClient.invalidateQueries({ queryKey: ['namespaces', activeProjectId] });
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponent: Create Namespace Modal
// -----------------------------------------------------------------------------
interface CreateNamespaceModalProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (ns: NamespaceResponse) => void;
}

function CreateNamespaceModal({ open, projectId, onClose, onCreated }: CreateNamespaceModalProps) {
  const queryClient = useQueryClient();
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [name, setName] = useState('');
  const [arch, setArch] = useState<ArchitectureType>('hybrid');
  const [windowSize, setWindowSize] = useState('5');
  const [similarityThreshold, setSimilarityThreshold] = useState('0.0');

  const createMutation = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {};
      if (arch === 'history') {
        config.window_size = Number(windowSize) || 5;
      } else if (arch === 'vector') {
        config.similarity_threshold = Number(similarityThreshold) || 0.0;
      }
      return createNamespace(projectId, {
        architecture_type: arch,
        name: name.trim(),
        config,
      });
    },
    onSuccess: (ns) => {
      void queryClient.invalidateQueries({ queryKey: ['namespaces', projectId] });
      pushToast({
        title: 'Namespace created',
        description: `${ns.name} (${ns.architecture_type}) ready.`,
        variant: 'success',
      });
      setName('');
      onClose();
      onCreated(ns);
    },
    onError: (err) => {
      pushToast({
        title: 'Creation failed',
        description: err instanceof ApiClientError ? err.message : 'Could not create namespace.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Memory Namespace"
      description="Namespaces isolate memory stores within your project."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-ns-name" className="block text-sm font-medium text-text-primary mb-1">
            Store Name <span className="text-error">*</span>
          </label>
          <input
            id="new-ns-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Evaluation Vector Store"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
          />
        </div>

        <div>
          <label htmlFor="new-ns-arch" className="block text-sm font-medium text-text-primary mb-1">
            Architecture Type
          </label>
          <select
            id="new-ns-arch"
            value={arch}
            onChange={(e) => setArch(e.target.value as ArchitectureType)}
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm font-mono"
          >
            <option value="history">history (sliding window)</option>
            <option value="vector">vector (pgvector embeddings)</option>
            <option value="structured">structured (S-P-O facts)</option>
            <option value="hybrid">hybrid (multi-factor ranking)</option>
          </select>
        </div>

        {arch === 'history' && (
          <div>
            <label htmlFor="ns-window-size" className="block text-xs font-medium text-text-secondary mb-1">
              Window Size (turns)
            </label>
            <input
              id="ns-window-size"
              type="number"
              min="1"
              max="50"
              value={windowSize}
              onChange={(e) => setWindowSize(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm font-mono"
            />
          </div>
        )}

        {arch === 'vector' && (
          <div>
            <label htmlFor="ns-sim-thresh" className="block text-xs font-medium text-text-secondary mb-1">
              Similarity Threshold (0.0 to 1.0)
            </label>
            <input
              id="ns-sim-thresh"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={similarityThreshold}
              onChange={(e) => setSimilarityThreshold(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm font-mono"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={createMutation.isPending}>
            Create Store
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Subcomponent: Edit Namespace Config Modal
// -----------------------------------------------------------------------------
interface EditNamespaceConfigModalProps {
  namespace: NamespaceResponse;
  onClose: () => void;
  onSaved: () => void;
}

function EditNamespaceConfigModal({
  namespace,
  onClose,
  onSaved,
}: EditNamespaceConfigModalProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [name, setName] = useState(namespace.name);
  const [configJson, setConfigJson] = useState(
    JSON.stringify(namespace.config ?? {}, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (parsedConfig: Record<string, unknown>) =>
      updateNamespace(namespace.id, {
        name: name.trim(),
        config: parsedConfig,
      }),
    onSuccess: () => {
      pushToast({ title: 'Namespace configuration updated', variant: 'success' });
      onSaved();
    },
    onError: (err) => {
      pushToast({
        title: 'Update failed',
        description: err instanceof ApiClientError ? err.message : 'Could not update namespace.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setJsonError(null);
    try {
      const parsed = JSON.parse(configJson) as Record<string, unknown>;
      updateMutation.mutate(parsed);
    } catch {
      setJsonError('Invalid JSON format. Check configuration syntax.');
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Configure ${namespace.name}`}
      description={`Architecture: ${namespace.architecture_type}`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="edit-ns-name" className="block text-sm font-medium text-text-primary mb-1">
            Store Name
          </label>
          <input
            id="edit-ns-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
          />
        </div>

        <div>
          <label htmlFor="edit-ns-config" className="block text-sm font-medium text-text-primary mb-1">
            Configuration (JSON)
          </label>
          <textarea
            id="edit-ns-config"
            rows={6}
            value={configJson}
            onChange={(e) => {
              setConfigJson(e.target.value);
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
          <Button type="submit" isLoading={updateMutation.isPending}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}