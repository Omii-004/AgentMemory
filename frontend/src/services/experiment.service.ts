import { downloadBlob, requestData } from '@/services/api-client';
import type {
  ComparisonResponse,
  ExecutionTraceResponse,
  ExperimentCreate,
  ExperimentResponse,
  FailureAnalysisItem,
  MetricResultResponse,
  ReportResponse,
  RunArchitectureResponse,
  RunConfigurationSnapshot,
  RunResponse,
  RunStatisticsResponse,
  TaskResultResponse,
} from '@/types/api';

export async function listExperiments(projectId: string): Promise<ExperimentResponse[]> {
  return requestData<ExperimentResponse[]>(`/projects/${projectId}/experiments`);
}

export async function createExperiment(
  projectId: string,
  payload: ExperimentCreate,
): Promise<ExperimentResponse> {
  return requestData<ExperimentResponse>(`/projects/${projectId}/experiments`, {
    method: 'POST',
    body: payload,
  });
}

export async function getExperiment(experimentId: string): Promise<ExperimentResponse> {
  return requestData<ExperimentResponse>(`/experiments/${experimentId}`);
}

export async function deleteExperiment(experimentId: string): Promise<{ deleted_id: string }> {
  return requestData<{ deleted_id: string }>(`/experiments/${experimentId}`, {
    method: 'DELETE',
  });
}

export async function listExperimentRuns(experimentId: string): Promise<RunResponse[]> {
  return requestData<RunResponse[]>(`/experiments/${experimentId}/runs`);
}

export async function startRun(
  experimentId: string,
  payload: { random_seed?: number | null } = { random_seed: 42 },
): Promise<RunResponse> {
  return requestData<RunResponse>(`/experiments/${experimentId}/runs`, {
    method: 'POST',
    body: payload,
  });
}

export async function getRun(runId: string): Promise<RunResponse> {
  return requestData<RunResponse>(`/runs/${runId}`);
}

export async function cancelRun(runId: string): Promise<RunResponse> {
  return requestData<RunResponse>(`/runs/${runId}/cancel`, { method: 'POST' });
}

export async function listRunArchitectures(runId: string): Promise<RunArchitectureResponse[]> {
  return requestData<RunArchitectureResponse[]>(`/runs/${runId}/architectures`);
}

export async function getRunConfiguration(runId: string): Promise<RunConfigurationSnapshot> {
  return requestData<RunConfigurationSnapshot>(`/runs/${runId}/configuration`);
}

export async function getRunResults(runId: string): Promise<TaskResultResponse[]> {
  return requestData<TaskResultResponse[]>(`/runs/${runId}/results`);
}

export async function getRunMetrics(runId: string): Promise<MetricResultResponse[]> {
  return requestData<MetricResultResponse[]>(`/runs/${runId}/metrics`);
}

export async function getRunComparison(runId: string): Promise<ComparisonResponse> {
  return requestData<ComparisonResponse>(`/runs/${runId}/comparison`);
}

export async function getMetricsByCategory(
  runId: string,
): Promise<Record<string, Record<string, number>>> {
  return requestData<Record<string, Record<string, number>>>(
    `/runs/${runId}/metrics/by-category`,
  );
}

export async function getRunStatistics(runId: string): Promise<RunStatisticsResponse> {
  return requestData<RunStatisticsResponse>(`/runs/${runId}/statistics`);
}

export async function getRunFailures(runId: string): Promise<FailureAnalysisItem[]> {
  return requestData<FailureAnalysisItem[]>(`/runs/${runId}/failures`);
}

export async function listTraces(runId: string): Promise<ExecutionTraceResponse[]> {
  return requestData<ExecutionTraceResponse[]>(`/runs/${runId}/traces`);
}

export async function getTrace(traceId: string): Promise<ExecutionTraceResponse> {
  return requestData<ExecutionTraceResponse>(`/traces/${traceId}`);
}

export async function listProjectReports(projectId: string): Promise<ReportResponse[]> {
  return requestData<ReportResponse[]>(`/projects/${projectId}/reports`);
}

export async function listRunReports(runId: string): Promise<ReportResponse[]> {
  return requestData<ReportResponse[]>(`/runs/${runId}/reports`);
}

export async function generateReport(
  runId: string,
  reportType: 'json' | 'csv',
): Promise<ReportResponse> {
  return requestData<ReportResponse>(`/runs/${runId}/reports`, {
    method: 'POST',
    body: { report_type: reportType },
  });
}

export async function downloadReportFile(
  reportId: string,
  fallbackFilename: string,
): Promise<void> {
  return downloadBlob(`/reports/${reportId}/download`, fallbackFilename);
}