import { requestData } from '@/services/api-client';
import type {
  DatasetCreate,
  DatasetResponse,
  DatasetValidationResult,
  SyntheticGenerateRequest,
  TaskResponse,
} from '@/types/api';

export async function listDatasets(projectId: string): Promise<DatasetResponse[]> {
  return requestData<DatasetResponse[]>(`/projects/${projectId}/datasets`);
}

export async function createDataset(
  projectId: string,
  payload: DatasetCreate,
): Promise<DatasetResponse> {
  return requestData<DatasetResponse>(`/projects/${projectId}/datasets`, {
    method: 'POST',
    body: payload,
  });
}

export async function getDataset(datasetId: string): Promise<DatasetResponse> {
  return requestData<DatasetResponse>(`/datasets/${datasetId}`);
}

export async function listTasks(datasetId: string): Promise<TaskResponse[]> {
  return requestData<TaskResponse[]>(`/datasets/${datasetId}/tasks`);
}

export async function generateSyntheticTasks(
  datasetId: string,
  payload: SyntheticGenerateRequest = {},
): Promise<{ generated_count: number; total_tasks: number }> {
  return requestData<{ generated_count: number; total_tasks: number }>(
    `/datasets/${datasetId}/generate-synthetic`,
    { method: 'POST', body: payload },
  );
}

export async function importTasks(
  datasetId: string,
  tasks: Array<Record<string, unknown>>,
): Promise<{ imported_count: number; total_tasks: number }> {
  return requestData<{ imported_count: number; total_tasks: number }>(
    `/datasets/${datasetId}/tasks/import`,
    { method: 'POST', body: { tasks } },
  );
}

export async function validateDataset(datasetId: string): Promise<DatasetValidationResult> {
  return requestData<DatasetValidationResult>(`/datasets/${datasetId}/validate`, {
    method: 'POST',
  });
}