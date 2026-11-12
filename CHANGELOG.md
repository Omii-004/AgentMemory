# Changelog

All notable changes to **AgentMemory** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Pre-Frontend API Read & Inspection Endpoints:**
  - Added `GET /api/v1/experiments/{experiment_id}/runs` to list experiment runs ordered newest-first (`run_number` descending).
  - Added `GET /api/v1/projects/{project_id}/reports` and `GET /api/v1/runs/{run_id}/reports` to list persisted reports with strict tenant ownership filtering.
  - Added `GET /api/v1/memories/{memory_id}/facts` (`MemoryFactResponse`) to inspect extracted Subject–Predicate–Object triples and temporal bounds (returning `[]` after deletion purge).
- **Regression & Isolation Tests:** Expanded `backend/tests/test_api_and_security.py` to verify all new read endpoints, namespace `run_id` filtering, expected-answer failure snapshots, redacted deletion listing (`status_filter=all`), post-purge fact cleanup, and cross-user `404` anti-enumeration checks.
- **Frontend Foundation (Milestone F1):**
  - Scaffolded `frontend/` with Vite 8, React 19, TypeScript 6, Tailwind CSS v4, React Router, TanStack Query, Zustand, React Hook Form + Zod, Recharts, and Vitest.
  - Added design tokens (`src/styles/tokens.css`), Vite `/api` + `/health` proxy (`vite.config.ts`), full backend-aligned API contracts (`src/types/api.ts`), and centralized HTTP/blob client with `401` handling and `AM_ERR_*` parsing (`src/services/api-client.ts`).
  - **Frontend Authentication, Route Guards & Application Shell (Milestone F2):**
  - Added `auth.service.ts`, `project.service.ts`, and Zustand stores (`auth.store.ts`, `workspace.store.ts`) synchronized with `401` token cleanup.
  - Added `<ProtectedRoute />` (verifying `GET /api/v1/auth/me` before rendering workspace routes) and `<PublicOnlyRoute />`, plus two-column `/login` and `/register` pages using React Hook Form + Zod.
  - Added collapsible `#171923` `<Sidebar />`, `<Topbar />` with active project selector + sign-out, `<AppShell />`, shared UI primitives (`Button`, `StatusBadge`, `MetricCard`, `StateViews`, `ToastContainer`), and Vitest route-guard tests (`src/test/auth-guard.test.tsx`).

### Changed
- **Memory & Namespace Inspection Contracts:**
  - Added `run_id` to `NamespaceResponse` and an optional `include_run_namespaces` query parameter (default `true`, ordered newest-first) on `GET /api/v1/projects/{project_id}/memory-namespaces`.
  - Added `source_message_id`, `parent_memory_id`, and `deleted_at` to `MemoryResponse`, and added `status_filter=all` support on `GET /api/v1/projects/{project_id}/memories` while keeping `"active"` as the default.
- **Task Result & Failure Analysis Payloads:**
  - Exposed `expected_answer_snapshot` and `created_at` on `TaskResultResponse`.
  - Enriched `GET /api/v1/runs/{run_id}/failures` with `task_result_id`, `task_key`, `category`, `expected_answer`, and `retrieved_memory_ids` for Expected-vs-Actual inspection and execution-trace linking.

### Planned
- React + TypeScript + Vite frontend workspace aligned with [`Design Specification`](Design%20Specification) and [`API-SPEC`](API-SPEC%20(API%20Specification)).
- Optional Phase-2 backend schema hardening (Alembic migration for DB unique/check constraints, pgvector HNSW index, token revocation store, and pagination/rate limiting).

---

## [0.1.0] - 2026-11-10

Backend API, 4-architecture memory engine, benchmark runner, statistical analyzer, hardening batches 1–4, and full automated verification suite (`21/21` pytest, `0` mypy issues across 62 files, `0` ruff errors).

### Added
- **Infrastructure & Database Foundation (`8df07e9`)**
  - Added `docker-compose.yml` (`pgvector/pgvector:pg16`), `.env.example`, and `backend/pyproject.toml` (Python 3.12, `uv`, `ruff`, `mypy`, `pytest`).
  - Added SQLAlchemy 2.0 async engine/session setup and Alembic initial migration (`937763e9b78c_initial_20_core_tables.py`) covering all 20 relational & vector tables.
  - Added JWT auth (`python-jose`), native `bcrypt` password hashing, `AM_ERR_*` exception hierarchy, and tenant-isolation FastAPI dependencies.
- **Memory Engine & LLM Adapters (`5b36e89`)**
  - Implemented `BaseMemory` contract and four isolated memory architectures: `HistoryMemory`, `VectorMemory`, `StructuredMemory`, and `HybridMemory`.
  - Added CPU-offloaded `SentenceTransformerEmbeddingService` (`all-MiniLM-L6-v2`, 384 dims) and `ContextBuilder`.
  - Added `BaseLLMAdapter`, `MockLLMAdapter`, `OllamaLLMAdapter`, `OpenAICompatibleLLMAdapter`, and LLM factory.
- **Benchmarking, Evaluation, Observability & REST API (`3a0ac4f`)**
  - Added 6-category synthetic dataset generator (`fact_retrieval`, `temporal_reasoning`, `contradiction_handling`, `multi_hop`, `memory_updating`, `memory_deletion`).
  - Added `BenchmarkRunner`, `GroundTruthEvaluator`, `MetricsCalculator` (TSR, Precision@K, Recall@K, MRR, Memory Utility, failure taxonomy), and `TraceCollector`.
  - Exposed FastAPI `/api/v1` routers for `auth`, `projects` (sessions & messages), `memories`, `datasets`, and `experiments` (runs, comparisons, traces, reports).
- **Consolidation, Statistical Analysis & Test Suite (`2f11ae4`, `ad34ea7`)**
  - Added `MemoryConsolidator` with `derives_from` provenance links and source embedding cleanup.
  - Added `StatisticalAnalyzer` (95% confidence intervals, paired *t*-test, Wilcoxon signed-rank test, Cohen's *d*).
  - Built 21-test `pytest` suite (`tests/test_evaluation.py`, `tests/test_memory_architectures.py`, `tests/test_api_and_security.py`) covering unit evaluation, consolidation/zero-leakage deletion, temporal `as_of` queries, tenant/namespace isolation, fault isolation, and end-to-end 4-architecture benchmark runs.
- **Documentation (`1256aed`)**
  - Updated root `README.md` with `.env` setup instructions, static analysis & test commands, architecture lifecycle updates, and current project status.

### Changed & Hardened
- **Core, Security & API Isolation (`3619381`, `1daf6b6`)**
  - Resolved `.env` reliably from project root regardless of working directory (`ROOT_ENV_FILE`).
  - Added standardized `AM_ERR_VALIDATION_FAILED` 422 JSON error envelope and sensitive secret redaction in `SafeLogFormatter`.
  - Enforced strict cross-project namespace authorization across memory endpoints (`404` on foreign namespace access).
  - Forwarded temporal/structured parameters (`as_of`, `subject`, `predicate`, `object_value`, `valid_from`, `valid_to`), added duplicate architecture / invalid LLM provider validation, and implemented JSON & CSV report downloads with full statistical metadata.
- **LLM Adapters & Benchmark Runner Resilience (`09e2df4`, `ad34ea7`)**
  - Upgraded `MockLLMAdapter` to synthesize answers directly from `ContextBuilder` prompts and support zero-arg default initialization.
  - Added exponential transient retry logic to `OllamaLLMAdapter` and `OpenAICompatibleLLMAdapter` while allowing keyless local OpenAI-compatible URLs.
  - Hardened `BenchmarkRunner` with task-level fault isolation, cancellation race guards, and plain-dataclass snapshotting (`_TaskSnapshot`, `_RunArchSnapshot`) so DB rollbacks never expire loop ORM state (`MissingGreenlet`).
- **Memory Lifecycle, Consolidation & Typing (`1df5e03`, `ad34ea7`)**
  - Extracted shared `app/memory/lifecycle.py` for transitive `derives_from` + `parent_memory_id` purges (`[REDACTED]` canonical scrubbing and hard-deletion of derived embeddings/facts/versions/relations).
  - Added `_safe_rollback()` recovery in `BaseMemory`, contradiction superseding & `as_of` point-in-time retrieval in `HybridMemory`, and monotonic version numbering.
  - Modernized type annotations to Python 3.12 (PEP 695 generic schemas `APIResponse[T]` / `PaginatedResponse[T]`, `X | None`, `datetime.UTC`), resolving all `mypy` (`0` errors / 62 files) and `ruff` (`0` errors) checks.