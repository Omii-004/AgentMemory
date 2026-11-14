import { useState } from 'react';
import { Database, FlaskConical, PlayCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/StateViews';
import { DatasetManager } from '@/features/benchmark-studio/DatasetManager';
import { ExperimentWizard } from '@/features/benchmark-studio/ExperimentWizard';
import { RunMonitor } from '@/features/benchmark-studio/RunMonitor';
import { useWorkspaceStore } from '@/stores/workspace.store';

type StudioTab = 'wizard' | 'monitor' | 'datasets';

export function BenchmarkStudioPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProjectId } = useWorkspaceStore();

  const rawTab = searchParams.get('tab') as StudioTab | null;
  const activeTab: StudioTab =
    rawTab === 'wizard' || rawTab === 'monitor' || rawTab === 'datasets' ? rawTab : 'wizard';

  const [wizardDatasetId, setWizardDatasetId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const setTab = (tab: StudioTab) => {
    setSearchParams({ tab });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Benchmark Studio</h1>
          <p className="text-sm text-text-secondary mt-1">
            Define, configure, and execute controlled multi-architecture benchmarks with live
            progress monitoring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/analytics">
            <Button variant="outline">Experiment Analytics</Button>
          </Link>
          <Link to="/reports">
            <Button variant="outline">Export Reports</Button>
          </Link>
        </div>
      </div>

      {!activeProjectId ? (
        <EmptyState
          title="No active workspace selected"
          description="Select or create a research project from the Topbar to configure benchmark datasets and run experiments."
          action={
            <Link to="/projects">
              <Button>
                <Database className="h-4 w-4" aria-hidden="true" />
                Go to Projects
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Studio Tab Navigation */}
          <div className="border-b border-border flex items-center gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setTab('wizard')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === 'wizard'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
              Experiment Wizard
            </button>
            <button
              type="button"
              onClick={() => setTab('monitor')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === 'monitor'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              Run Monitor
            </button>
            <button
              type="button"
              onClick={() => setTab('datasets')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === 'datasets'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              <Database className="h-4 w-4" aria-hidden="true" />
              Datasets & Tasks
            </button>
          </div>

          {/* TAB 1: EXPERIMENT WIZARD */}
          {activeTab === 'wizard' && (
            <ExperimentWizard
              projectId={activeProjectId}
              initialDatasetId={wizardDatasetId}
              onRunStarted={(run) => {
                setSelectedRunId(run.id);
                setTab('monitor');
              }}
              onGoToDatasets={() => setTab('datasets')}
            />
          )}

          {/* TAB 2: RUN MONITOR */}
          {activeTab === 'monitor' && (
            <RunMonitor
              projectId={activeProjectId}
              selectedRunId={selectedRunId}
              onSelectRun={(runId) => setSelectedRunId(runId)}
            />
          )}

          {/* TAB 3: DATASETS & TASKS */}
          {activeTab === 'datasets' && (
            <DatasetManager
              projectId={activeProjectId}
              onSelectDatasetForExperiment={(dsId) => {
                setWizardDatasetId(dsId);
                setTab('wizard');
              }}
            />
          )}
        </>
      )}
    </div>
  );
}