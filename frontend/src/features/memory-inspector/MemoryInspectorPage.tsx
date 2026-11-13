import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Database,
  Edit2,
  FileCode,
  FileText,
  Filter,
  Layers,
  Network,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { EmptyState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/lib/utils';
import { ApiClientError } from '@/services/api-client';
import {
  deleteMemory,
  getMemoryEvents,
  getMemoryFacts,
  getMemoryVersions,
  listMemories,
  listNamespaces,
  updateMemory,
} from '@/services/memory.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type {
  MemoryEventResponse,
  MemoryFactResponse,
  MemoryResponse,
  MemoryUpdateRequest,
  MemoryVersionResponse,
} from '@/types/api';

type InspectorTab = 'content' | 'facts' | 'versions' | 'lifecycle' | 'json';

export function MemoryInspectorPage() {
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useWorkspaceStore();

  // Filters State
  const [includeRunNamespaces, setIncludeRunNamespaces] = useState(false);
  const [selectedNamespaceId, setSelectedNamespaceId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('active');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);

  // Detail panel active tab & modal states
  const [activeTab, setActiveTab] = useState<InspectorTab>('content');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Namespaces Query
  const namespacesQuery = useQuery({
    queryKey: ['namespaces', activeProjectId, includeRunNamespaces],
    queryFn: () => listNamespaces(activeProjectId!, includeRunNamespaces),
    enabled: Boolean(activeProjectId),
  });

  const namespaces = useMemo(() => namespacesQuery.data ?? [], [namespacesQuery.data]);
  const activeNamespaceId = useMemo(
    () =>
      namespaces.some((n) => n.id === selectedNamespaceId)
        ? selectedNamespaceId
        : (namespaces[0]?.id ?? null),
    [namespaces, selectedNamespaceId],
  );

  const activeNamespace = useMemo(
    () => namespaces.find((n) => n.id === activeNamespaceId) ?? null,
    [namespaces, activeNamespaceId],
  );

  // Memories Query
  const memoriesQuery = useQuery({
    queryKey: ['memories', activeProjectId, activeNamespaceId, statusFilter],
    queryFn: () => listMemories(activeProjectId!, activeNamespaceId!, statusFilter),
    enabled: Boolean(activeProjectId && activeNamespaceId),
  });

  const rawMemories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);

  // Client-side filtering
  const filteredMemories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rawMemories.filter((mem) => {
      if (typeFilter !== 'all' && mem.memory_type.toLowerCase() !== typeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        mem.id.toLowerCase().includes(q) ||
        mem.content.toLowerCase().includes(q) ||
        mem.memory_type.toLowerCase().includes(q)
      );
    });
  }, [rawMemories, typeFilter, searchQuery]);

  const activeMemory = useMemo(
    () =>
      filteredMemories.find((m) => m.id === selectedMemoryId) ??
      filteredMemories[0] ??
      null,
    [filteredMemories, selectedMemoryId],
  );

  const activeMemoryId = activeMemory?.id ?? null;

  // Facts, Versions, and Events Queries
  const factsQuery = useQuery({
    queryKey: ['memory-facts', activeMemoryId],
    queryFn: () => getMemoryFacts(activeMemoryId!),
    enabled: Boolean(activeMemoryId && activeTab === 'facts'),
  });

  const versionsQuery = useQuery({
    queryKey: ['memory-versions', activeMemoryId],
    queryFn: () => getMemoryVersions(activeMemoryId!),
    enabled: Boolean(activeMemoryId && activeTab === 'versions'),
  });

  const eventsQuery = useQuery({
    queryKey: ['memory-events', activeMemoryId],
    queryFn: () => getMemoryEvents(activeMemoryId!),
    enabled: Boolean(activeMemoryId && activeTab === 'lifecycle'),
  });

  // Zero-Leakage Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory(activeMemoryId!),
    onSuccess: (res) => {
      setDeleteConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['memories', activeProjectId] });
      void queryClient.invalidateQueries({ queryKey: ['memory-facts', activeMemoryId] });
      void queryClient.invalidateQueries({ queryKey: ['memory-events', activeMemoryId] });
      pushToast({
        title: 'Zero-leakage purge executed',
        description: `Memory purged in ${res.latency_ms} ms. Content scrubbed to [REDACTED].`,
        variant: 'info',
      });
    },
    onError: (err) => {
      pushToast({
        title: 'Deletion failed',
        description: err instanceof ApiClientError ? err.message : 'Could not purge memory.',
        variant: 'error',
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Memory Inspector</h1>
          <p className="text-sm text-text-secondary mt-1">
            Deep inspection of memory records, extracted S-P-O facts, version histories, and
            lifecycle events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/memory-lab">
            <Button variant="outline">
              <Layers className="h-4 w-4" aria-hidden="true" />
              Open Memory Lab
            </Button>
          </Link>
          <Button
            variant="secondary"
            onClick={() => void memoriesQuery.refetch()}
            isLoading={memoriesQuery.isRefetching}
            disabled={!activeProjectId}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {!activeProjectId ? (
        <EmptyState
          title="No active workspace selected"
          description="Select or create a research project from the Topbar to inspect memory namespaces and records."
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
      ) : (
        /* 3-PANEL DESKTOP LAYOUT (Design Spec 6.5) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* PANEL 1: FILTERS & PARAMETERS (lg:col-span-3) */}
          <section className="lg:col-span-3 bg-surface border border-border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-border">
              <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-text-primary">Inspector Filters</h2>
            </div>

            <div>
              <label htmlFor="ns-selector" className="block text-xs font-medium text-text-secondary mb-1">
                Memory Store / Namespace
              </label>
              <select
                id="ns-selector"
                value={activeNamespaceId ?? ''}
                onChange={(e) => setSelectedNamespaceId(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-surface text-xs font-mono"
              >
                {namespaces.length === 0 ? (
                  <option value="">No namespaces available</option>
                ) : (
                  namespaces.map((ns) => (
                    <option key={ns.id} value={ns.id}>
                      {ns.name} ({ns.architecture_type}
                      {ns.run_id ? ' · run' : ''})
                    </option>
                  ))
                )}
              </select>

              <label className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeRunNamespaces}
                  onChange={(e) => setIncludeRunNamespaces(e.target.checked)}
                  className="rounded border-border"
                />
                Include benchmark run namespaces
              </label>
            </div>

            <div>
              <label htmlFor="status-filter" className="block text-xs font-medium text-text-secondary mb-1">
                Lifecycle Status
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-surface text-xs font-mono"
              >
                <option value="active">active (default)</option>
                <option value="superseded">superseded</option>
                <option value="consolidated">consolidated</option>
                <option value="deleted">deleted (redacted)</option>
                <option value="all">all statuses</option>
              </select>
            </div>

            <div>
              <label htmlFor="type-filter" className="block text-xs font-medium text-text-secondary mb-1">
                Memory Type
              </label>
              <select
                id="type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-surface text-xs font-mono"
              >
                <option value="all">All Types</option>
                <option value="semantic">semantic</option>
                <option value="episodic">episodic</option>
                <option value="structured">structured</option>
              </select>
            </div>

            <div>
              <label htmlFor="search-filter" className="block text-xs font-medium text-text-secondary mb-1">
                Search Content / UUID
              </label>
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-text-secondary absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  id="search-filter"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter memories..."
                  className="w-full h-9 pl-8 pr-2.5 rounded-md border border-border bg-canvas text-xs"
                />
              </div>
            </div>

            {activeNamespace && (
              <div className="pt-3 border-t border-border space-y-1.5 text-xs text-text-secondary">
                <p className="font-semibold text-text-primary">Namespace Summary</p>
                <p className="font-mono text-[11px] truncate">ID: {activeNamespace.id}</p>
                <p>Arch: {activeNamespace.architecture_type}</p>
                <p>Origin: {activeNamespace.run_id ? 'Benchmark Run' : 'Manual Workspace'}</p>
              </div>
            )}
          </section>

          {/* PANEL 2: MEMORY RECORDS LIST (lg:col-span-4) */}
          <section className="lg:col-span-4 bg-surface border border-border rounded-lg overflow-hidden flex flex-col h-[700px]">
            <div className="px-4 py-3 border-b border-border bg-canvas/40 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                Memory Records ({filteredMemories.length})
              </h2>
              <span className="text-[11px] font-mono text-text-secondary">
                filter: {statusFilter}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {memoriesQuery.isPending ? (
                <div className="p-6 text-center text-xs text-text-secondary">
                  Loading memory records...
                </div>
              ) : filteredMemories.length === 0 ? (
                <div className="p-6 text-center text-xs text-text-secondary space-y-2">
                  <p>No memory records found in this view.</p>
                  <Link
                    to="/memory-lab"
                    className="text-primary hover:underline font-medium inline-block"
                  >
                    Store first memory in Memory Lab →
                  </Link>
                </div>
              ) : (
                filteredMemories.map((mem) => {
                  const isSelected = activeMemory?.id === mem.id;
                  const isDeleted = mem.status === 'deleted';
                  return (
                    <button
                      key={mem.id}
                      type="button"
                      onClick={() => setSelectedMemoryId(mem.id)}
                      className={`w-full text-left p-3.5 transition-colors cursor-pointer block ${
                        isSelected
                          ? 'bg-primary/10 border-l-2 border-primary'
                          : 'hover:bg-canvas/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={mem.status} />
                          <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-canvas border border-border text-text-secondary">
                            {mem.memory_type}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-text-secondary truncate">
                          {formatDateTime(mem.created_at)}
                        </span>
                      </div>

                      <p
                        className={`text-xs mt-1 line-clamp-2 ${
                          isDeleted ? 'font-mono text-error font-medium' : 'text-text-primary'
                        }`}
                      >
                        {mem.content}
                      </p>

                      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-text-secondary">
                        <span className="truncate">{mem.id.slice(0, 14)}…</span>
                        <span>
                          imp: {mem.importance ?? '—'} · conf: {mem.confidence ?? '—'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* PANEL 3: MEMORY DETAILS & LIFECYCLE DRAWER (lg:col-span-5) */}
          <section className="lg:col-span-5 bg-surface border border-border rounded-lg overflow-hidden flex flex-col h-[700px]">
            {!activeMemory ? (
              <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div className="max-w-xs space-y-2">
                  <FileText className="h-8 w-8 text-text-secondary mx-auto" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-text-primary">No Record Selected</h3>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    Select a memory record from the middle list to inspect its content, extracted
                    facts, version history, and lifecycle events.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Detail Header & Action Buttons */}
                <div className="px-5 py-4 border-b border-border bg-canvas/40 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={activeMemory.status} />
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface border border-border text-text-primary uppercase">
                          {activeMemory.memory_type}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-text-secondary truncate mt-1">
                        ID: {activeMemory.id}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditOpen(true)}
                        disabled={activeMemory.status === 'deleted'}
                      >
                        <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteConfirmOpen(true)}
                        disabled={activeMemory.status === 'deleted'}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Purge
                      </Button>
                    </div>
                  </div>

                  {/* Tab Navigation */}
                  <div className="flex items-center gap-1 border-b border-border/60 -mb-4 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setActiveTab('content')}
                      className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                        activeTab === 'content'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Content & Metadata
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('facts')}
                      className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                        activeTab === 'facts'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Extracted Facts
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('versions')}
                      className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                        activeTab === 'versions'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Version History
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('lifecycle')}
                      className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                        activeTab === 'lifecycle'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Lifecycle Timeline
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('json')}
                      className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                        activeTab === 'json'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Raw JSON
                    </button>
                  </div>
                </div>

                {/* Detail Tab Contents */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* TAB 1: CONTENT & METADATA */}
                  {activeTab === 'content' && (
                    <div className="space-y-4">
                      {activeMemory.status === 'deleted' && (
                        <div className="p-3 rounded-md border border-error/30 bg-error/10 text-xs text-error space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                            Zero-Leakage Purged Record
                          </div>
                          <p>
                            Canonical text was scrubbed to [REDACTED], dense embeddings were
                            hard-deleted, and facts were removed to prevent retrieval or leakage.
                          </p>
                        </div>
                      )}

                      <div>
                        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                          Memory Content
                        </h4>
                        <div className="p-3.5 rounded-md border border-border bg-canvas/60 text-xs font-mono text-text-primary whitespace-pre-wrap leading-relaxed">
                          {activeMemory.content}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <div className="p-3 rounded border border-border bg-canvas/30 text-xs">
                          <span className="text-text-secondary block">Importance</span>
                          <span className="font-mono font-semibold text-text-primary mt-0.5 block">
                            {activeMemory.importance !== null ? activeMemory.importance : '—'}
                          </span>
                        </div>
                        <div className="p-3 rounded border border-border bg-canvas/30 text-xs">
                          <span className="text-text-secondary block">Confidence</span>
                          <span className="font-mono font-semibold text-text-primary mt-0.5 block">
                            {activeMemory.confidence !== null ? activeMemory.confidence : '—'}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 rounded-md border border-border bg-canvas/30 space-y-1.5 font-mono text-[11px] text-text-secondary">
                        <p>Namespace: {activeMemory.namespace_id}</p>
                        <p>Source Message: {activeMemory.source_message_id ?? 'None'}</p>
                        <p>Parent Memory: {activeMemory.parent_memory_id ?? 'None'}</p>
                        <p>Created: {formatDateTime(activeMemory.created_at)}</p>
                        <p>Updated: {formatDateTime(activeMemory.updated_at)}</p>
                        {activeMemory.deleted_at && (
                          <p className="text-error">
                            Deleted: {formatDateTime(activeMemory.deleted_at)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 2: EXTRACTED FACTS */}
                  {activeTab === 'facts' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                          Subject-Predicate-Object Triples
                        </h4>
                        <span className="text-xs text-text-secondary">
                          {(factsQuery.data ?? []).length} fact(s)
                        </span>
                      </div>

                      {factsQuery.isPending ? (
                        <p className="text-xs text-text-secondary">Loading extracted facts…</p>
                      ) : (factsQuery.data ?? []).length === 0 ? (
                        <div className="p-6 text-center text-xs text-text-secondary border border-border rounded-md bg-canvas/30">
                          {activeMemory.status === 'deleted'
                            ? 'Facts were permanently purged following zero-leakage deletion.'
                            : 'No explicit relational facts extracted for this memory record.'}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(factsQuery.data ?? []).map((fact: MemoryFactResponse) => (
                            <div
                              key={fact.id}
                              className="p-3 rounded-md border border-border bg-canvas/40 space-y-1.5 text-xs font-mono"
                            >
                              <div className="flex items-center gap-2 text-text-primary font-semibold">
                                <Network className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                <span className="text-primary">{fact.subject}</span>
                                <span className="text-text-secondary">→</span>
                                <span className="text-info">{fact.predicate}</span>
                                <span className="text-text-secondary">→</span>
                                <span>{fact.object_value}</span>
                              </div>
                              <div className="flex flex-wrap gap-2 text-[11px] text-text-secondary pt-1 border-t border-border/50">
                                <span>type: {fact.object_type}</span>
                                {fact.confidence !== null && <span>conf: {fact.confidence}</span>}
                                {fact.valid_from && (
                                  <span>valid_from: {formatDateTime(fact.valid_from)}</span>
                                )}
                                {fact.valid_to && (
                                  <span>valid_to: {formatDateTime(fact.valid_to)}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: VERSION HISTORY */}
                  {activeTab === 'versions' && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                        Monotonic Version Trail
                      </h4>
                      {versionsQuery.isPending ? (
                        <p className="text-xs text-text-secondary">Loading version history…</p>
                      ) : (versionsQuery.data ?? []).length === 0 ? (
                        <div className="p-6 text-center text-xs text-text-secondary border border-border rounded-md bg-canvas/30">
                          No previous versions recorded. Memory is at original version.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {(versionsQuery.data ?? []).map((v: MemoryVersionResponse) => (
                            <div
                              key={v.id}
                              className="p-3 rounded-md border border-border bg-canvas/40 space-y-2 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-semibold text-primary">
                                  Version {v.version_number}
                                </span>
                                <span className="text-text-secondary font-mono text-[11px]">
                                  {formatDateTime(v.created_at)}
                                </span>
                              </div>
                              {v.change_reason && (
                                <p className="text-xs text-text-secondary">
                                  Reason: <strong className="text-text-primary">{v.change_reason}</strong>
                                </p>
                              )}
                              <div className="font-mono text-[11px] space-y-1">
                                {v.previous_content && (
                                  <p className="p-2 rounded bg-error/10 text-error border border-error/20">
                                    - {v.previous_content}
                                  </p>
                                )}
                                <p className="p-2 rounded bg-success/10 text-success border border-success/20">
                                  + {v.new_content}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 4: LIFECYCLE TIMELINE */}
                  {activeTab === 'lifecycle' && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                        Lifecycle Event Audit
                      </h4>
                      {eventsQuery.isPending ? (
                        <p className="text-xs text-text-secondary">Loading lifecycle events…</p>
                      ) : (eventsQuery.data ?? []).length === 0 ? (
                        <div className="p-6 text-center text-xs text-text-secondary border border-border rounded-md bg-canvas/30">
                          No audit events recorded for this memory record.
                        </div>
                      ) : (
                        <div className="relative pl-4 border-l border-border space-y-4">
                          {(eventsQuery.data ?? []).map((ev: MemoryEventResponse) => (
                            <div key={ev.id} className="relative">
                              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary border-2 border-surface" />
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-xs text-text-primary uppercase">
                                  {ev.event_type}
                                </span>
                                <span className="font-mono text-[11px] text-text-secondary">
                                  {formatDateTime(ev.created_at)}
                                </span>
                              </div>
                              {Object.keys(ev.details ?? {}).length > 0 && (
                                <div className="mt-1 p-2 rounded bg-canvas border border-border font-mono text-[11px] text-text-secondary">
                                  {JSON.stringify(ev.details, null, 2)}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 5: RAW JSON */}
                  {activeTab === 'json' && (
                    <div>
                      <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
                        Raw API Response Payload
                      </h4>
                      <pre className="p-3.5 rounded-md border border-border bg-canvas text-[11px] font-mono text-text-primary overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(activeMemory, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* MODAL 1: Edit Memory Modal */}
      {activeMemory && (
        <EditMemoryModal
          key={`${activeMemory.id}:${activeMemory.updated_at}`}
          open={editOpen}
          memory={activeMemory}
          onClose={() => setEditOpen(false)}
          onUpdated={() => {
            setEditOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['memories', activeProjectId] });
            void queryClient.invalidateQueries({ queryKey: ['memory-versions', activeMemory.id] });
          }}
        />
      )}

      {/* MODAL 2: Confirm Zero-Leakage Delete Modal */}
      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Confirm Zero-Leakage Memory Purge"
        description="Permanently redact content and erase dense embeddings and extracted facts."
      >
        <div className="space-y-4">
          <p className="text-sm text-text-primary">
            Are you sure you want to purge memory record{' '}
            <span className="font-mono font-semibold">{activeMemory?.id}</span>?
          </p>
          <div className="p-3 rounded-md border border-error/30 bg-error/10 text-xs text-error space-y-1">
            <p className="font-semibold">Zero-Leakage Safeguard:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Canonical text is permanently overwritten with [REDACTED].</li>
              <li>Dense 384-d pgvector embeddings are hard-deleted.</li>
              <li>Extracted S-P-O facts and derivative relations are deleted.</li>
            </ul>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              isLoading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Purge Memory
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponent: Edit Memory Modal
// -----------------------------------------------------------------------------
interface EditMemoryModalProps {
  open: boolean;
  memory: MemoryResponse;
  onClose: () => void;
  onUpdated: () => void;
}

function EditMemoryModal({ open, memory, onClose, onUpdated }: EditMemoryModalProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [content, setContent] = useState(memory.content);
  const [importance, setImportance] = useState(
    memory.importance !== null ? String(memory.importance) : '0.5',
  );
  const [confidence, setConfidence] = useState(
    memory.confidence !== null ? String(memory.confidence) : '1.0',
  );
  const [changeReason, setChangeReason] = useState('manual_edit');

  const updateMutation = useMutation({
    mutationFn: (payload: MemoryUpdateRequest) => updateMemory(memory.id, payload),
    onSuccess: (res) => {
      pushToast({
        title: 'Memory updated',
        description: `Monotonic version incremented in ${res.latency_ms} ms.`,
        variant: 'success',
      });
      onUpdated();
    },
    onError: (err) => {
      pushToast({
        title: 'Update failed',
        description: err instanceof ApiClientError ? err.message : 'Could not update memory.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    updateMutation.mutate({
      content: content.trim(),
      importance: Number(importance) || 0.5,
      confidence: Number(confidence) || 1.0,
      change_reason: changeReason.trim() || 'manual_edit',
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Memory Record"
      description="Updating creates a monotonic version entry and records an audit event."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="edit-mem-content" className="block text-sm font-medium text-text-primary mb-1">
            Memory Content <span className="text-error">*</span>
          </label>
          <textarea
            id="edit-mem-content"
            rows={4}
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm font-mono text-text-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-mem-importance" className="block text-xs font-medium text-text-secondary mb-1">
              Importance: {importance}
            </label>
            <input
              id="edit-mem-importance"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={importance}
              onChange={(e) => setImportance(e.target.value)}
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="edit-mem-confidence" className="block text-xs font-medium text-text-secondary mb-1">
              Confidence: {confidence}
            </label>
            <input
              id="edit-mem-confidence"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label htmlFor="edit-mem-reason" className="block text-xs font-medium text-text-secondary mb-1">
            Change Reason
          </label>
          <input
            id="edit-mem-reason"
            type="text"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder="e.g., corrected user preference"
            className="w-full h-9 px-3 rounded-md border border-border bg-surface text-xs"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={updateMutation.isPending}>
            Save Version
          </Button>
        </div>
      </form>
    </Modal>
  );
}