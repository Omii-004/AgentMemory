import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileText,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  SearchCode,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace.store';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/memory-lab', label: 'Memory Lab', icon: Cpu },
  { to: '/memory-inspector', label: 'Memory Inspector', icon: SearchCode },
  { to: '/benchmark-studio', label: 'Benchmark Studio', icon: FlaskConical },
  { to: '/analytics', label: 'Experiment Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileText },
];

export function Sidebar() {
  const {
    sidebarCollapsed,
    toggleSidebarCollapsed,
    mobileNavOpen,
    setMobileNavOpen,
  } = useWorkspaceStore();

  const navContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-sidebar text-white select-none">
      {/* Brand header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center font-mono text-xs font-semibold shrink-0">
            AM
          </div>
          {(!sidebarCollapsed || isMobile) && (
            <span className="font-semibold text-sm tracking-tight truncate">
              AgentMemory
            </span>
          )}
        </div>

        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="text-gray-400 hover:text-white p-1 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-white/10 cursor-pointer"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation items */}
      <nav aria-label="Primary navigation" className="flex-1 p-2.5 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => {
              if (isMobile) setMobileNavOpen(false);
            }}
            title={sidebarCollapsed && !isMobile ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white',
                sidebarCollapsed && !isMobile && 'justify-center px-2',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {(!sidebarCollapsed || isMobile) && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Footer version tag */}
      {(!sidebarCollapsed || isMobile) && (
        <div className="px-4 py-3 border-t border-white/10 text-xs text-gray-400 font-mono">
          v0.1 · Research Workspace
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside
        className={cn(
          'hidden lg:block shrink-0 transition-[width] duration-200 border-r border-white/10',
          sidebarCollapsed ? 'w-[68px]' : 'w-[240px]',
        )}
      >
        {navContent(false)}
      </aside>

      {/* Mobile / tablet drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-[240px] max-w-[80vw] h-full z-50">
            {navContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}