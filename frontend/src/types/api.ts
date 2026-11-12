export type ArchitectureType = 'history' | 'vector' | 'structured' | 'hybrid';

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface APIResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: PaginationMeta;
}

export interface APIErrorDetail {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

export interface APIErrorEnvelope {
  success: false;
  error: APIErrorDetail;
}

// Auth
export interface UserResponse {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserResponse;
}

export interface UserLoginRequest {
  email: string;
  password: string;
}

export interface UserRegisterRequest {
  email: string;
  password: string;
  display_name?: string | null;
}

// Projects & Sessions
export interface ProjectResponse {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string | null;
}

export interface ProjectUpdate {
  name?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface SessionResponse {
  id: string;
  project_id: string;
  name: string | null;
  session_type: string;
  created_at: string;
}

export interface SessionCreate {
  name?: string | null;
  session_type?: string;
}

export interface MessageResponse {
  id: string;
  session_id: string;
  sequence_number: number;
  role: string;
  content: string;
  created_at: string;
}

export interface MessageCreate {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
}

// Architectures & Memory
export interface ArchitectureCatalogItem {
  type: ArchitectureType;
  name: string;
  default_config: Record<string, unknown>;
}

export interface NamespaceResponse {
  id: string;
  project_id: string;
  run_id: string | null;
  architecture_type: ArchitectureType | string;
  name: string;
  config: Record<string, unknown>;
  created_at: string;
}

export interface NamespaceCreate {
  architecture_type: ArchitectureType;
  name: string;
  config?: Record<string, unknown>;
}

export interface NamespaceUpdate {
  name?: string | null;
  config?: Record<string, unknown> | null;
}

export interface MemoryResponse {
  id: string;
  namespace_id: string;
  source_message_id: string | null;
  parent_memory_id: string | null;
  memory_type: string;
  content: string;
  importance: number | null;
  confidence: number | null;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryStoreRequest {
  namespace_id: string;
  content: string;
  memory_type?: string;
  importance?: number | null;
  confidence?: number | null;
  subject?: string | null;
  predicate?: string | null;
  object_value?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MemoryRetrieveRequest {
  namespace_id: string;
  query: string;
  top_k?: number;
  as_of?: string | null;
}

export interface MemoryUpdateRequest {
  content: string;
  importance?: number | null;
  confidence?: number | null;
  subject?: string | null;
  predicate?: string | null;
  object_value?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  change_reason?: string | null;
}

export interface RetrievedMemory {
  id: string;
  content: string;
  memory_type: string;
  score: number;
  similarity: number | null;
  importance: number | null;
  recency: number | null;
  confidence: number | null;
  source_message_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface MemoryOperationResult {
  operation: string;
  architecture: string;
  status: string;
  latency_ms: number;
  retrieved_memories: RetrievedMemory[];
  retrieved_memory_ids: string[];
  affected_memory_ids: string[];
  metadata: Record<string, unknown>;
  error_message: string | null;
}

export interface MemoryFactResponse {
  id: string;
  memory_id: string;
  subject: string;
  predicate: string;
  object_value: string;
  object_type: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number | null;
  created_at: string;
}

export interface MemoryVersionResponse {
  id: string;
  memory_id: string;
  version_number: number;
  previous_content: string | null;
  new_content: string;
  change_reason: string | null;
  created_at: string;
}

export interface MemoryEventResponse {
  id: string;
  memory_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ConsolidationResult {
  status: string;
  consolidated_memory_id: string | null;
  source_count: number;
  summary_content: string;
  source_memory_ids: string[];
}

// Datasets & Tasks
export interface DatasetResponse {
  id: string;
  project_id: string;
  name: string;
  version: string;
  description: string | null;
  task_count: number;
  is_public: boolean;
  created_at: string;
}

export interface DatasetCreate {
  name: string;
  version?: string;
  description?: string | null;
  is_public?: boolean;
}

export interface SyntheticGenerateRequest {
  tasks_per_category?: number;
  distractor_count?: number;
  seed?: number;
}

export interface TaskResponse {
  id: string;
  dataset_id: string;
  task_key: string;
  category: string;
  difficulty: string;
  conversation_sequence: Array<Record<string, unknown>>;
  evaluation_query: Record<string, unknown>;
  created_at: string;
}

export interface DatasetValidationResult {
  valid: boolean;
  task_count: number;
  category_breakdown: Record<string, number>;
}

// Experiments, Runs, Analytics & Reports
export interface ExperimentResponse {
  id: string;
  project_id: string;
  dataset_id: string;
  name: string;
  description: string | null;
  configuration: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface ExperimentCreate {
  dataset_id: string;
  name: string;
  description?: string | null;
  architectures: ArchitectureType[];
  llm_provider: string;
  llm_model?: string | null;
  num_trials?: number;
  temperature?: number;
  max_tokens?: number;
  architecture_configs?: Record<string, Record<string, unknown>>;
}

export interface RunResponse {
  id: string;
  experiment_id: string;
  run_number: number;
  status: string;
  random_seed: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface RunArchitectureResponse {
  id: string;
  run_id: string;
  namespace_id: string;
  architecture_type: ArchitectureType | string;
  configuration: Record<string, unknown>;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface RunConfigurationSnapshot {
  run_id: string;
  run_number: number;
  random_seed: number | null;
  software_version: string | null;
  architectures: Array<{
    architecture_type: string;
    namespace_id: string;
    configuration: Record<string, unknown>;
    status: string;
  }>;
  experiment_config: Record<string, unknown>;
}

export interface TaskResultResponse {
  id: string;
  run_architecture_id: string;
  task_id: string;
  trial_number: number;
  generated_answer: Record<string, unknown> | null;
  expected_answer_snapshot: Record<string, unknown> | null;
  task_status: string;
  is_correct: boolean | null;
  retrieval_latency_ms: number | null;
  llm_latency_ms: number | null;
  total_latency_ms: number | null;
  total_tokens: number | null;
  retrieved_memory_ids: string[] | null;
  evaluation_details: Record<string, unknown>;
  created_at: string | null;
}

export interface MetricResultResponse {
  id: string;
  run_architecture_id: string;
  metric_name: string;
  metric_value: number;
  metric_unit: string | null;
  category: string | null;
}

export interface ExecutionTraceResponse {
  id: string;
  run_id: string;
  task_result_id: string | null;
  event_type: string;
  component: string;
  event_data: Record<string, unknown>;
  duration_ms: number | null;
  created_at: string;
}

export interface ArchitectureComparisonMetrics {
  task_success_rate?: number;
  precision_at_k?: number;
  recall_at_k?: number;
  mrr?: number;
  avg_retrieval_latency_ms?: number;
  avg_llm_latency_ms?: number;
  avg_total_latency_ms?: number;
  avg_tokens_per_task?: number;
  total_tokens?: number;
  memory_utility?: number;
  categories: Record<string, number>;
  [key: string]: number | Record<string, number> | undefined;
}

export interface ComparisonResponse {
  run_id: string;
  status: string;
  architectures: Record<string, ArchitectureComparisonMetrics>;
}

export interface ConfidenceIntervalSummary {
  mean: number;
  std: number;
  ci_low: number;
  ci_high: number;
}

export interface PairwiseComparisonItem {
  arch_a: string;
  arch_b: string;
  n_paired: number;
  mean_diff: number;
  t_statistic: number;
  p_value_ttest: number;
  p_value_wilcoxon: number;
  cohens_d: number;
  effect_magnitude: string;
  statistically_significant_05: boolean;
}

export interface RunStatisticsResponse {
  descriptive_ci_95: Record<string, ConfidenceIntervalSummary>;
  pairwise_comparisons: PairwiseComparisonItem[];
}

export interface FailureAnalysisItem {
  task_result_id: string;
  architecture: string;
  task_id: string;
  task_key: string;
  category: string;
  failure_classification: string;
  expected_answer: Record<string, unknown> | null;
  generated_answer: Record<string, unknown> | null;
  retrieved_memory_ids: string[];
  evaluation_details: Record<string, unknown>;
}

export interface ReportResponse {
  id: string;
  project_id: string;
  run_id: string;
  report_type: 'json' | 'csv' | string;
  file_location: string | null;
  status: string;
  created_at: string;
}