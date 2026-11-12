import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/components/common/Button';

export function LoadingState({ label = 'Loading workspace data...' }: { label?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-10 flex flex-col items-center justify-center text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary mb-3" aria-hidden="true" />
      <p className="text-sm text-text-secondary">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-10 flex flex-col items-center justify-center text-center">
      <div className="h-10 w-10 rounded-lg bg-canvas border border-border flex items-center justify-center mb-3">
        <Inbox className="h-5 w-5 text-text-secondary" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <p className="text-sm text-text-secondary mt-1 max-w-md">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Unable to load data',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-surface border border-error/30 rounded-lg p-6 flex items-start gap-3"
    >
      <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="text-sm text-text-secondary mt-1">{message}</p>
        {onRetry && (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}