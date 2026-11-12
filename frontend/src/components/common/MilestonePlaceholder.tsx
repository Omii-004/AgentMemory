import { useWorkspaceStore } from '@/stores/workspace.store';

export function MilestonePlaceholder({
  title,
  description,
  milestone,
}: {
  title: string;
  description: string;
  milestone: string;
}) {
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
        <p className="text-sm text-text-secondary mt-1">{description}</p>
      </div>
      <div className="bg-surface border border-border rounded-lg p-6">
        <p className="text-sm text-text-primary font-medium">
          Protected workspace route active ({milestone}).
        </p>
        <p className="text-xs text-text-secondary font-mono mt-2">
          Active Project ID: {activeProjectId ?? 'none'}
        </p>
      </div>
    </div>
  );
}