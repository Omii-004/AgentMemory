import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLE: Record<string, { classes: string; label: string }> = {
  completed: { classes: 'bg-success/10 text-success border-success/25', label: 'Completed' },
  active: { classes: 'bg-success/10 text-success border-success/25', label: 'Active' },
  success: { classes: 'bg-success/10 text-success border-success/25', label: 'Success' },
  running: { classes: 'bg-info/10 text-info border-info/25', label: 'Running' },
  pending: { classes: 'bg-warning/10 text-warning border-warning/25', label: 'Pending' },
  queued: { classes: 'bg-warning/10 text-warning border-warning/25', label: 'Queued' },
  configured: { classes: 'bg-info/10 text-info border-info/25', label: 'Configured' },
  draft: { classes: 'bg-canvas text-text-secondary border-border', label: 'Draft' },
  superseded: { classes: 'bg-warning/10 text-warning border-warning/25', label: 'Superseded' },
  consolidated: { classes: 'bg-info/10 text-info border-info/25', label: 'Consolidated' },
  cancelled: { classes: 'bg-canvas text-text-secondary border-border', label: 'Cancelled' },
  failed: { classes: 'bg-error/10 text-error border-error/25', label: 'Failed' },
  error: { classes: 'bg-error/10 text-error border-error/25', label: 'Error' },
  failure: { classes: 'bg-error/10 text-error border-error/25', label: 'Failure' },
  deleted: { classes: 'bg-error/10 text-error border-error/25', label: 'Deleted' },
  archived: { classes: 'bg-canvas text-text-secondary border-border', label: 'Archived' },
};

function renderStatusIcon(status: string) {
  const key = status.toLowerCase();
  if (key === 'completed' || key === 'active' || key === 'success') {
    return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (key === 'running') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
  }
  if (key === 'failed' || key === 'error' || key === 'failure' || key === 'deleted') {
    return <XCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (key === 'pending' || key === 'queued' || key === 'superseded') {
    return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (key === 'cancelled' || key === 'archived') {
    return <MinusCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  return <Clock className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  const cfg = STATUS_STYLE[normalized] ?? {
    classes: 'bg-canvas text-text-secondary border-border',
    label: status,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium capitalize',
        cfg.classes,
        className,
      )}
    >
      {renderStatusIcon(normalized)}
      <span>{cfg.label}</span>
    </span>
  );
}