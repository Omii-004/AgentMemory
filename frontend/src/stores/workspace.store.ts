import { create } from 'zustand';

const ACTIVE_PROJECT_KEY = 'agentmemory_active_project_id';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

function readStoredProjectId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeStoredProjectId(id: string | null): void {
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  } catch {
    // Ignore storage issues
  }
}

interface WorkspaceState {
  activeProjectId: string | null;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  toasts: ToastMessage[];
  setActiveProjectId: (projectId: string | null) => void;
  toggleSidebarCollapsed: () => void;
  setMobileNavOpen: (open: boolean) => void;
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeProjectId: readStoredProjectId(),
  sidebarCollapsed: false,
  mobileNavOpen: false,
  toasts: [],

  setActiveProjectId: (projectId) => {
    writeStoredProjectId(projectId);
    set({ activeProjectId: projectId });
  },

  toggleSidebarCollapsed: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),

  pushToast: (toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (toast.variant !== 'error') {
      window.setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, 4500);
    }
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));