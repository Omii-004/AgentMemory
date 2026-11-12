import { requestData } from '@/services/api-client';
import type {
  ArchitectureCatalogItem,
  ConsolidationResult,
  MemoryEventResponse,
  MemoryFactResponse,
  MemoryOperationResult,
  MemoryResponse,
  MemoryRetrieveRequest,
  MemoryStoreRequest,
  MemoryUpdateRequest,
  MemoryVersionResponse,
  NamespaceCreate,
  NamespaceResponse,
  NamespaceUpdate,
} from '@/types/api';

export async function listArchitectures(): Promise<ArchitectureCatalogItem[]> {
  return requestData<ArchitectureCatalogItem[]>('/architectures');
}

export async function listNamespaces(
  projectId: string,
  includeRunNamespaces = true,
): Promise<NamespaceResponse[]> {
  return requestData<NamespaceResponse[]>(
    `/projects/${projectId}/memory-namespaces?include_run_namespaces=${includeRunNamespaces}`,
  );
}

export async function createNamespace(
  projectId: string,
  payload: NamespaceCreate,
): Promise<NamespaceResponse> {
  return requestData<NamespaceResponse>(`/projects/${projectId}/memory-namespaces`, {
    method: 'POST',
    body: payload,
  });
}

export async function updateNamespace(
  namespaceId: string,
  payload: NamespaceUpdate,
): Promise<NamespaceResponse> {
  return requestData<NamespaceResponse>(`/memory-namespaces/${namespaceId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function consolidateNamespace(
  namespaceId: string,
  payload: { min_memories?: number; llm_provider?: string | null } = {},
): Promise<ConsolidationResult> {
  return requestData<ConsolidationResult>(`/memory-namespaces/${namespaceId}/consolidate`, {
    method: 'POST',
    body: payload,
  });
}

export async function storeMemory(
  projectId: string,
  payload: MemoryStoreRequest,
): Promise<MemoryOperationResult> {
  return requestData<MemoryOperationResult>(`/projects/${projectId}/memories`, {
    method: 'POST',
    body: payload,
  });
}

export async function retrieveMemories(
  projectId: string,
  payload: MemoryRetrieveRequest,
): Promise<MemoryOperationResult> {
  return requestData<MemoryOperationResult>(`/projects/${projectId}/memories/retrieve`, {
    method: 'POST',
    body: payload,
  });
}

export async function listMemories(
  projectId: string,
  namespaceId: string,
  statusFilter = 'active',
): Promise<MemoryResponse[]> {
  const params = new URLSearchParams({
    namespace_id: namespaceId,
    status_filter: statusFilter,
  });
  return requestData<MemoryResponse[]>(`/projects/${projectId}/memories?${params.toString()}`);
}

export async function getMemory(memoryId: string): Promise<MemoryResponse> {
  return requestData<MemoryResponse>(`/memories/${memoryId}`);
}

export async function updateMemory(
  memoryId: string,
  payload: MemoryUpdateRequest,
): Promise<MemoryOperationResult> {
  return requestData<MemoryOperationResult>(`/memories/${memoryId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function deleteMemory(memoryId: string): Promise<MemoryOperationResult> {
  return requestData<MemoryOperationResult>(`/memories/${memoryId}`, {
    method: 'DELETE',
  });
}

export async function getMemoryFacts(memoryId: string): Promise<MemoryFactResponse[]> {
  return requestData<MemoryFactResponse[]>(`/memories/${memoryId}/facts`);
}

export async function getMemoryVersions(memoryId: string): Promise<MemoryVersionResponse[]> {
  return requestData<MemoryVersionResponse[]>(`/memories/${memoryId}/versions`);
}

export async function getMemoryEvents(memoryId: string): Promise<MemoryEventResponse[]> {
  return requestData<MemoryEventResponse[]>(`/memories/${memoryId}/events`);
}