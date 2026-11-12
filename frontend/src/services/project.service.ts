import { requestData, requestRaw } from '@/services/api-client';
import type {
  MessageCreate,
  MessageResponse,
  PaginatedResponse,
  ProjectCreate,
  ProjectResponse,
  ProjectUpdate,
  SessionCreate,
  SessionResponse,
} from '@/types/api';

export async function listProjects(page = 1, pageSize = 50): Promise<PaginatedResponse<ProjectResponse>> {
  return requestRaw<PaginatedResponse<ProjectResponse>>(
    `/projects?page=${page}&page_size=${pageSize}`,
  );
}

export async function createProject(payload: ProjectCreate): Promise<ProjectResponse> {
  return requestData<ProjectResponse>('/projects', { method: 'POST', body: payload });
}

export async function getProject(projectId: string): Promise<ProjectResponse> {
  return requestData<ProjectResponse>(`/projects/${projectId}`);
}

export async function updateProject(projectId: string, payload: ProjectUpdate): Promise<ProjectResponse> {
  return requestData<ProjectResponse>(`/projects/${projectId}`, { method: 'PATCH', body: payload });
}

export async function deleteProject(projectId: string): Promise<{ deleted_id: string }> {
  return requestData<{ deleted_id: string }>(`/projects/${projectId}`, { method: 'DELETE' });
}

export async function listSessions(projectId: string): Promise<SessionResponse[]> {
  return requestData<SessionResponse[]>(`/projects/${projectId}/sessions`);
}

export async function createSession(projectId: string, payload: SessionCreate): Promise<SessionResponse> {
  return requestData<SessionResponse>(`/projects/${projectId}/sessions`, {
    method: 'POST',
    body: payload,
  });
}

export async function listMessages(sessionId: string): Promise<MessageResponse[]> {
  return requestData<MessageResponse[]>(`/sessions/${sessionId}/messages`);
}

export async function addMessage(sessionId: string, payload: MessageCreate): Promise<MessageResponse> {
  return requestData<MessageResponse>(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: payload,
  });
}