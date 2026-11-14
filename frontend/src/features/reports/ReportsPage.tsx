import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Database,
  Download,
  Eye,
  FileCode,
  FileSpreadsheet,
  FileText,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/StateViews';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ApiClientError } from '@/services/api-client';
import {
  downloadReportFile,
  generateReport,
  getReportContent,
  listExperiments,
  listExperimentRuns,
  listProjectReports,
} from '@/services/experiment.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ReportResponse } from '@/types/api';

export function ReportsPage() {
  const queryClient = useQueryClient();
  const { activeProjectId } = useWorkspaceStore();
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [createOpen, setCreateOpen] = useState(false);
  const [previewReport, setPreviewReport] = useState<ReportResponse | null>(null);

  // 1. Fetch project reports
  const reportsQuery = useQuery({
    queryKey: ['project-reports', activeProjectId],
    queryFn: () => listProjectReports(activeProjectId!),
    enabled: !!activeProjectId,
  });
  const reports = reportsQuery.data ?? [];

  // 2. Fetch project experiments for report generator modal
  const experimentsQuery = useQuery({
    queryKey: ['experiments', activeProjectId],
    queryFn: () => listExperiments(activeProjectId!),
    enabled: !!activeProjectId && createOpen,
  });
  const experiments = experimentsQuery.data ?? [];

  const handleDownload = async (report: ReportResponse) => {
    try {
      const ext = report.report_type;
      const filename = `agentmemory_report_${report.run_id.slice(0, 8)}_${report.id.slice(0, 8)}.${ext}`;
      await downloadReportFile(report.id, filename);
      pushToast({
        title: 'Report downloaded',
        description: filename,
        variant: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Download failed',
        description: err instanceof ApiClientError ? err.message : 'Could not download report file.',
        variant: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Reports & Data Exports
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Generate and download standardized, audit-ready evaluation reports in
            machine-readable JSON and CSV formats.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/analytics">
            <Button variant="outline">Experiment Analytics</Button>
          </Link>
          <Button onClick={() => setCreateOpen(true)} disabled={!activeProjectId}>
            <Plus className="h-4 w-4" />
            Generate Report
          </Button>
        </div>
      </div>

      {!activeProjectId ? (
        <EmptyState
          title="No active workspace selected"
          description="Select or create a research project from the Topbar to manage benchmark reports."
          action={
            <Link to="/projects">
              <Button>
                <Database className="h-4 w-4" />
                Go to Projects
              </Button>
            </Link>
          }
        />
      ) : reportsQuery.isLoading ? (
        <LoadingState label="Loading generated benchmark reports..." />
      ) : reportsQuery.isError ? (
        <ErrorState
          title="Failed to load reports"
          message="Could not retrieve reports for this project from the server."
          onRetry={() => reportsQuery.refetch()}
        />
      ) : reports.length === 0 ? (
        <EmptyState
          title="No reports generated yet"
          description="Generate a comprehensive machine-readable JSON evaluation archive or CSV dataset from any completed experiment run."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Generate First Report
            </Button>
          }
        />
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text-primary">
                Generated Benchmark Reports
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-canvas border border-border text-text-secondary">
                {reports.length} reports
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                reportsQuery.refetch();
                pushToast({ title: 'Refreshed reports', variant: 'info' });
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas border-b border-border text-xs uppercase text-text-secondary font-semibold">
                <tr>
                  <th className="px-4 py-3">Report ID</th>
                  <th className="px-4 py-3">Run Reference</th>
                  <th className="px-4 py-3">Format</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Generated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {reports.map((report) => (
                  <tr key={report.id} className="hover:bg-canvas transition-colors">
                    <td className="px-4 py-3 font-semibold text-text-primary">
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-text-secondary" />
                        <span>{report.id.slice(0, 8)}...</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(report.id);
                            pushToast({
                              title: 'Report ID copied',
                              description: report.id,
                              variant: 'info',
                            });
                          }}
                          className="p-1 rounded text-text-secondary hover:text-text-primary"
                          title="Copy UUID"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-sans text-text-secondary">
                      <Link
                        to={`/analytics?runId=${report.run_id}`}
                        className="text-primary hover:underline font-mono text-xs inline-flex items-center gap-1"
                      >
                        Run {report.run_id.slice(0, 8)}...
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-sans">
                      {report.report_type === 'json' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20">
                          <FileCode className="h-3 w-3" />
                          JSON
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <FileSpreadsheet className="h-3 w-3" />
                          CSV
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="px-4 py-3 text-text-secondary font-sans">
                      {new Date(report.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-sans">
                      <div className="flex items-center justify-end gap-2">
                        {report.report_type === 'json' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPreviewReport(report)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Preview
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(report)}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

            {/* Generate Report Modal */}
      {createOpen && activeProjectId && (
        <GenerateReportModal
          open={createOpen}
          experiments={experiments}
          onClose={() => setCreateOpen(false)}
          onGenerated={() => {
            queryClient.invalidateQueries({ queryKey: ['project-reports', activeProjectId] });
            setCreateOpen(false);
          }}
        />
      )}

      {/* JSON Report Preview Modal */}
      {previewReport && (
        <ReportPreviewModal
          report={previewReport}
          onClose={() => setPreviewReport(null)}
          onDownload={() => handleDownload(previewReport)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate Report Modal Subcomponent
// ---------------------------------------------------------------------------

interface GenerateReportModalProps {
  open: boolean;
  experiments: Array<{ id: string; name: string }>;
  onClose: () => void;
  onGenerated: () => void;
}

function GenerateReportModal({
  open,
  experiments,
  onClose,
  onGenerated,
}: GenerateReportModalProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const [selectedExpId, setSelectedExpId] = useState<string>(
    experiments[0]?.id ?? '',
  );
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [reportType, setReportType] = useState<'json' | 'csv'>('json');

  // Fetch runs for the selected experiment
  const runsQuery = useQuery({
    queryKey: ['experiment-runs-modal', selectedExpId],
    queryFn: () => listExperimentRuns(selectedExpId),
    enabled: !!selectedExpId,
  });
  const runs = runsQuery.data ?? [];

  // Derive initial run selection during render
  const effectiveRunId =
    selectedRunId && runs.some((r) => r.id === selectedRunId)
      ? selectedRunId
      : runs[0]?.id ?? '';

  const generateMutation = useMutation({
    mutationFn: () => generateReport(effectiveRunId, reportType),
    onSuccess: (res) => {
      pushToast({
        title: 'Report generated successfully',
        description: `Format: ${res.report_type.toUpperCase()} | Run: ${res.run_id.slice(0, 8)}`,
        variant: 'success',
      });
      onGenerated();
    },
    onError: (err) => {
      pushToast({
        title: 'Generation failed',
        description: err instanceof ApiClientError ? err.message : 'Could not generate report.',
        variant: 'error',
      });
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate Evaluation Report"
      description="Compile benchmark results, statistical significance tests, and failure distributions into an exportable document."
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {/* Experiment Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary uppercase">
            Select Experiment
          </label>
          <select
            value={selectedExpId}
            onChange={(e) => {
              setSelectedExpId(e.target.value);
              setSelectedRunId('');
            }}
            className="w-full h-10 px-3 text-sm bg-canvas border border-border rounded-md text-text-primary focus:outline-none focus:border-primary"
          >
            {experiments.length === 0 ? (
              <option value="">No experiments found</option>
            ) : (
              experiments.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Run Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary uppercase">
            Select Completed Benchmark Run
          </label>
          <select
            value={effectiveRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            disabled={runs.length === 0}
            className="w-full h-10 px-3 text-sm bg-canvas border border-border rounded-md text-text-primary focus:outline-none focus:border-primary disabled:opacity-50"
          >
            {runs.length === 0 ? (
              <option value="">No runs recorded for this experiment</option>
            ) : (
              runs.map((r) => (
                <option key={r.id} value={r.id}>
                  Run #{r.run_number} ({r.status}) — Seed {r.random_seed ?? 'None'}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Format Selection Cards */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-secondary uppercase">
            Report Format
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setReportType('json')}
              className={`p-3.5 border rounded-lg text-left transition-all cursor-pointer ${
                reportType === 'json'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-canvas hover:border-primary/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm text-text-primary">
                  JSON Archive
                </span>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                Full machine-readable payload with configs, 95% CIs, pairwise significance,
                and failure items.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setReportType('csv')}
              className={`p-3.5 border rounded-lg text-left transition-all cursor-pointer ${
                reportType === 'csv'
                  ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30'
                  : 'border-border bg-canvas hover:border-emerald-500/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold text-sm text-text-primary">
                  CSV Metrics Table
                </span>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                Flattened tabular metrics ideal for statistical workflows in Python pandas,
                R, or spreadsheet tools.
              </p>
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={generateMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!effectiveRunId || generateMutation.isPending}
          >
            {generateMutation.isPending ? 'Generating Report...' : 'Generate Report'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Report Preview Modal Subcomponent
// ---------------------------------------------------------------------------

interface ReportPreviewModalProps {
  report: ReportResponse;
  onClose: () => void;
  onDownload: () => void;
}

function ReportPreviewModal({ report, onClose, onDownload }: ReportPreviewModalProps) {
  const pushToast = useWorkspaceStore((state) => state.pushToast);

  const contentQuery = useQuery({
    queryKey: ['report-content', report.id],
    queryFn: () => getReportContent(report.id),
  });

  const reportData = contentQuery.data;

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Report Preview: ${report.id.slice(0, 8)}...`}
      description={`Format: ${report.report_type.toUpperCase()} | Generated: ${new Date(report.created_at).toLocaleString()}`}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {contentQuery.isLoading ? (
          <LoadingState label="Fetching report contents from secure storage..." />
        ) : contentQuery.isError ? (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-md text-xs text-rose-600 dark:text-rose-400">
            Could not parse or load report content. Please use the direct download button
            below.
          </div>
        ) : (
          <>
            {/* Quick Summary Pill Banner */}
            <div className="p-3 bg-canvas border border-border rounded-md flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-text-primary">
                  Status: <span className="font-mono text-emerald-600 dark:text-emerald-400">Completed</span>
                </span>
                <span className="text-text-secondary">
                  Run ID: <span className="font-mono text-text-primary">{report.run_id.slice(0, 8)}...</span>
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(reportData, null, 2));
                  pushToast({ title: 'Report JSON copied', variant: 'info' });
                }}
              >
                <Copy className="h-3 w-3" />
                Copy JSON
              </Button>
            </div>

            {/* Formatted JSON Tree */}
            <pre className="font-mono text-xs bg-sidebar text-slate-200 p-4 rounded-md overflow-x-auto max-h-[460px]">
              {JSON.stringify(reportData, null, 2)}
            </pre>
          </>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Button variant="outline" onClick={onDownload}>
            <Download className="h-4 w-4" />
            Download File
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}