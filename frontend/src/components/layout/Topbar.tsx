import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut, Menu } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listProjects } from '@/services/project.service';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  'memory-lab': 'Memory Lab',
  'memory-inspector': 'Memory Inspector',
  'benchmark-studio': 'Benchmark Studio',
  analytics: 'Experiment Analytics',
  reports: 'Reports',
};

export function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const { activeProjectId, setActiveProjectId, setMobileNavOpen } = useWorkspaceStore();

  const { data: projectsPage, isSuccess } = useQuery({
    queryKey: ['projects', 'selector'],
    queryFn: () => listProjects(1, 50),
    enabled: Boolean(user),
  });

  const projects = useMemo(() => projectsPage?.data ?? [], [projectsPage]);

  useEffect(() => {
    if (!isSuccess) return;
    if (projects.length === 0) {
      if (activeProjectId !== null) setActiveProjectId(null);
      return;
    }
    const exists = projects.some((p) => p.id === activeProjectId);
    if (!activeProjectId || !exists) {
      setActiveProjectId(projects[0].id);
    }
  }, [isSuccess, projects, activeProjectId, setActiveProjectId]);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const firstSegment = location.pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
  const currentSection = ROUTE_LABELS[firstSegment] ?? 'Workspace';

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    setActiveProjectId(null);
    navigate('/login', { replace: true });
  };

  return (
    <header className="h-16 bg-surface border-b border-border px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 rounded-md text-text-secondary hover:bg-canvas hover:text-text-primary cursor-pointer"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Project Switcher */}
        <div className="flex items-center gap-2 min-w-0">
          <label htmlFor="active-project-select" className="text-xs font-medium text-text-secondary hidden sm:inline">
            Project
          </label>
          <select
            id="active-project-select"
            value={activeProject?.id ?? ''}
            onChange={(e) => setActiveProjectId(e.target.value || null)}
            disabled={projects.length === 0}
            className="h-9 max-w-[200px] sm:max-w-[240px] rounded-md border border-border bg-canvas px-2.5 text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {projects.length === 0 ? (
              <option value="">No projects yet</option>
            ) : (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1.5 text-sm text-text-secondary min-w-0">
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium text-text-primary">{currentSection}</span>
        </nav>
      </div>

      {/* User identity + Sign out */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-text-primary leading-tight">
            {user?.display_name || user?.email}
          </p>
          <p className="text-xs text-text-secondary font-mono">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium text-text-primary hover:bg-canvas cursor-pointer"
        >
          <LogOut className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}