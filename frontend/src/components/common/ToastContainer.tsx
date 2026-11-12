import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useWorkspaceStore, type ToastVariant } from '@/stores/workspace.store';
import { cn } from '@/lib/utils';

const TOAST_STYLES: Record<ToastVariant, string> = {
  info: 'border-info/30 bg-surface',
  success: 'border-success/30 bg-surface',
  warning: 'border-warning/30 bg-surface',
  error: 'border-error/40 bg-surface',
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === 'success') return <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />;
  if (variant === 'error' || variant === 'warning') {
    return (
      <AlertCircle
        className={cn('h-4 w-4 shrink-0 mt-0.5', variant === 'error' ? 'text-error' : 'text-warning')}
      />
    );
  }
  return <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />;
}

export function ToastContainer() {
  const { toasts, dismissToast } = useWorkspaceStore();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'pointer-events-auto border rounded-lg shadow-sm p-3.5 flex items-start gap-3',
            TOAST_STYLES[toast.variant],
          )}
        >
          <ToastIcon variant={toast.variant} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary">{toast.title}</p>
            {toast.description && (
              <p className="text-xs text-text-secondary mt-0.5 break-words">{toast.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
            className="text-text-secondary hover:text-text-primary cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}