import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import { CreateProjectModal } from '@/features/projects/CreateProjectModal';
import { formatDateTime } from '@/lib/utils';
import { ApiClientError } from '@/services/api-client';
import { deleteProject, listProjects } from '@/services/project.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ProjectResponse } from '@/types/api';

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, setActiveProjectId, pushToast } = useWorkspaceStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [deleteTarget, setDeleteTarget] = useState<ProjectResponse | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', 'list'],
    queryFn: () => listProjects(1, 50),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: (_data, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (activeProjectId === deletedId) {
        setActiveProjectId(null);
      }
      pushToast({
        title: 'Project deleted',
        description: 'The project and its associated workspaces were removed.',
        variant: 'info',
      });
      setDeleteTarget(null);
    },
    onError: (err) => {
      pushToast({
        title: 'Delete failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to delete project.',
        variant: 'error',
      });
    },
  });

  const allProjects = useMemo(() => projectsQuery.data?.data ?? [], [projectsQuery.data]);
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allProjects.filter((project) => {
      if (statusFilter !== 'all' && project.status.toLowerCase() !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        project.name.toLowerCase().includes(q) ||
        (project.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allProjects, search, statusFilter]);

  if (projectsQuery.isPending) {
    return <LoadingState label="Loading projects..." />;
  }

  if (projectsQuery.isError) {
    const msg =
      projectsQuery.error instanceof ApiClientError
        ? projectsQuery.error.message
        : 'Unable to retrieve projects.';
    return <ErrorState message={msg} onRetry={() => void projectsQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Projects</h1>
          <p className="text-sm text-text-secondary mt-1">
            Isolated research containers for memory architectures, datasets, and experiments.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create Project
        </Button>
      </div>

      {/* Filters bar */}
      <div className="bg-surface border border-border rounded-lg p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search
            className="h-4 w-4 text-text-secondary absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter projects by name or description..."
            aria-label="Filter projects"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-canvas text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'archived')}
          className="h-9 px-3 rounded-md border border-border bg-canvas text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {allProjects.length === 0 ? (
        <EmptyState
          title="No projects found"
          description="Create your first project to begin configuring memory namespaces and benchmarks."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Project
            </Button>
          }
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          title="No matching projects"
          description="Try clearing your search text or changing the status filter."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-canvas/70 text-xs font-medium text-text-secondary">
                  <th className="py-2.5 px-4">Project Name</th>
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Updated</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredProjects.map((project) => {
                  const isActive = project.id === activeProjectId;
                  return (
                    <tr key={project.id} className="hover:bg-canvas/50">
                      <td className="py-3 px-4 font-medium text-text-primary">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveProjectId(project.id);
                              navigate(`/projects/${project.id}`);
                            }}
                            className="hover:text-primary cursor-pointer text-left"
                          >
                            {project.name}
                          </button>
                          {isActive && (
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-text-secondary mt-0.5">
                          {project.id}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-text-secondary max-w-md">
                        <p className="line-clamp-2">{project.description || '—'}</p>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={project.status} />
                      </td>
                      <td className="py-3 px-4 text-text-secondary whitespace-nowrap">
                        {formatDateTime(project.updated_at)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActiveProjectId(project.id);
                              navigate(`/projects/${project.id}`);
                            }}
                          >
                            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(project)}
                            aria-label={`Delete ${project.name}`}
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
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(proj) => navigate(`/projects/${proj.id}`)}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Project"
        description="This permanently removes the project along with its namespaces, datasets, experiments, and reports."
      >
        <div className="space-y-4">
          <p className="text-sm text-text-primary">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{deleteTarget?.name}</span>?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              isLoading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete Project
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}