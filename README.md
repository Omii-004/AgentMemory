# AgentMemory — Long-Term Memory Benchmark for AI Agents

**AgentMemory** is a research and benchmarking platform designed to rigorously evaluate how effectively AI agent long-term memory architectures retain, retrieve, update, consolidate, and forget information over hundreds or thousands of interactions.

> **Central Research Question:**
> *"Does a more sophisticated memory system actually improve an AI agent's ability to complete tasks reliably over time, or does it merely retrieve more information?"*

> **Project Status:**
> - **Backend API & Benchmarking Engine (`v1.0`):** Complete and verified (`21/21` pytest, `0` mypy issues across 62 files, `0` ruff errors).
> - **Frontend Workspace (`Milestones F1–F6`):** Foundation, JWT auth + route guards, app shell, Dashboard, Projects list, 6-tab Project Detail workspace, Memory Lab, 3-panel Memory Inspector, Benchmark Studio, Experiment Analytics, and Reports complete and verified (`18/18` Vitest, `0` ESLint issues, production Vite build clean). Full end-to-end memory research platform operational.

---

## Architecture Overview

AgentMemory implements four interchangeable memory architectures under a unified, namespace-isolated asynchronous contract (`BaseMemory` with automatic SQL session rollback recovery):

| Architecture | Description | Key Mechanism |
|---|---|---|
| **History** | Baseline sliding context window | Retrieves the latest $N$ messages in chronological sequence. |
| **Vector** | Semantic similarity retrieval | 384-dimensional dense vectors indexed in PostgreSQL via `pgvector` (`<=>` cosine distance). |
| **Structured** | Explicit relational facts | Subject-Predicate-Object triples with temporal validity bounds (`valid_from`, `valid_to`), point-in-time (`as_of`) queries, and contradiction superseding. |
| **Hybrid** | Multi-tiered representation | Multi-factor composite ranking ($\text{Score} = w_1 \cdot \text{Sim} + w_2 \cdot \text{Imp} + w_3 \cdot \text{Rec} + w_4 \cdot \text{Conf}$ + fact boost) with time-decay, contradiction superseding, and `as_of` temporal filtering. |

---

## Core Capabilities Built

- **20 Core Relational Tables:** Normalized PostgreSQL 16 schema managed via SQLAlchemy 2.0 (asyncio) and Alembic migrations.
- **Memory Lifecycle & Consolidation:** Supports memory formation, monotonic versioned updates, contradiction superseding, point-in-time (`as_of`) retrieval, semantic consolidation (`MemoryConsolidator`) with `derives_from` provenance links, and transitive zero-leakage purges (`[REDACTED]` canonical scrubbing + hard-deletion of derived embeddings/facts/versions/relations).
- **Local CPU Embeddings:** `sentence-transformers/all-MiniLM-L6-v2` with asynchronous thread-pooling to avoid blocking FastAPI's event loop.
- **Provider-Independent LLM Layer:** Unified adapter interface (`MockLLMAdapter` for deterministic offline benchmarking, `OllamaLLMAdapter` for local models, and `OpenAICompatibleLLMAdapter` for OpenAI-compatible endpoints) with transient retry handling.
- **6-Category Synthetic Benchmark Suite & Fault-Tolerant Runner:** Automated dataset generation and execution (`BenchmarkRunner`) with per-task fault isolation, run cancellation, deterministic seeded trials, and evaluation across:
  1. **Fact Retrieval** (with configurable conversational noise distractors)
  2. **Temporal Reasoning**
  3. **Contradiction Handling**
  4. **Multi-Hop Retrieval**
  5. **Memory Updating**
  6. **Memory Deletion** (verifying zero retrieval or vector leakage)
- **Quantitative Evaluation, Statistics & Observability:** Computes **Task Success Rate (TSR)**, **Precision@K**, **Recall@K**, **MRR**, latencies, token usage, **Memory Utility**, failure classifications, step-by-step execution traces, and paired statistical comparisons (95% CI, paired *t*-test, Wilcoxon signed-rank test, Cohen's *d*).
- **Hardened RESTful API (`/api/v1`):** Auth, Projects, Sessions, Memory Lab & Consolidation, Memory Facts/Versions/Events Inspection, Datasets, Async Background Experiment Runs & Run History, Side-by-Side Architecture Comparisons, Expected-vs-Actual Failure Analysis, Statistical Analysis, Traces, JSON/CSV Report Management & Exports, strict cross-project tenant/namespace isolation, and standardized `AM_ERR_*` error envelopes.
- **Research Frontend Workspace (`/frontend`):** React 19 + TypeScript workspace featuring verified `<ProtectedRoute />` authentication, collapsible workspace shell + active project switcher, real-time Dashboard KPIs, searchable Projects view, and 6-tab Project Detail workspace (`Overview`, `Namespaces`, `Datasets`, `Experiments`, `Sessions`, `Settings`).

---

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (asyncio), Alembic, Pydantic v2
- **Database:** PostgreSQL 16 + `pgvector`
- **Embeddings & Stats:** `sentence-transformers` (`all-MiniLM-L6-v2`), `numpy`, `scipy`, `scikit-learn`, `pandas`
- **Frontend:** React 19, TypeScript 6, Vite 8, Tailwind CSS v4, React Router v7, TanStack Query v5, Zustand v5, React Hook Form + Zod, Recharts, Lucide React
- **Security:** JWT (`python-jose`), native `bcrypt` password hashing, multi-tenant project & namespace isolation, secret-redacting log formatter, strict frontend auth verification (`GET /api/v1/auth/me`)
- **Testing & Quality:** `pytest`, `pytest-asyncio`, `httpx` (`ASGITransport`), `mypy`, `ruff`, `vitest`, `@testing-library/react`, `eslint`
- **Package Managers:** `uv` (backend), `npm` (frontend)
- **Containers:** Docker Compose

---

## Getting Started (Backend)

### 1. Configure Environment
```bash
cp .env.example .env
```

### 2. Launch PostgreSQL + pgvector
```bash
docker compose up -d
```

### 3. Set Up Virtual Environment
```bash
cd backend
uv venv --python 3.12
source .venv/bin/activate
uv pip install -e ".[dev]"
```

### 4. Run Database Migrations
```bash
alembic upgrade head
```

### 5. Start the API Server
```bash
uvicorn app.main:app --reload
```

* **API Root:** http://127.0.0.1:8000/
* **Interactive Swagger Docs:** http://127.0.0.1:8000/docs
* **Health Check:** http://127.0.0.1:8000/health

### 6. Run Backend Tests & Quality Checks
```bash
cd backend
.venv/bin/pytest -v
.venv/bin/mypy app
.venv/bin/ruff check app tests
```

---

## Getting Started (Frontend)

With PostgreSQL and the FastAPI backend running on `:8000`:

### 1. Install Dependencies & Start Dev Server
```bash
cd frontend
npm install
npm run dev
```

* **Web App:** http://localhost:5173/ (Vite automatically proxies `/api` and `/health` to `http://127.0.0.1:8000`)

### 2. Run Frontend Checks & Tests
```bash
cd frontend
npm run lint
npm run build
npm test
```

---

## Project Structure

```text
AgentMemory/
├── docker-compose.yml              # PostgreSQL 16 + pgvector container
├── .env.example                    # Environment variable template
├── README.md                       # Project documentation
├── CHANGELOG.md                    # Release and hardening history
├── SECURITY.md                     # Security policy, implemented controls, and roadmap
├── backend/
│   ├── pyproject.toml              # Python 3.12 dependencies, ruff, mypy, pytest config
│   ├── alembic.ini                 # Database migration config
│   ├── migrations/                 # Alembic async migration versions
│   ├── tests/                      # Unit, memory architecture, security & E2E benchmark tests (21 tests)
│   └── app/
│       ├── main.py                 # FastAPI entrypoint, CORS, AM_ERR_* exception handlers
│       ├── core/                   # Config, native bcrypt/JWT security, safe logging, exceptions
│       ├── database/               # Connection pool, 20 SQLAlchemy models
│       ├── embeddings/             # SentenceTransformers CPU embedding service
│       ├── memory/                 # BaseMemory, lifecycle purge, History, Vector, Structured, Hybrid, Consolidation
│       ├── llm/                    # BaseLLMAdapter, Mock, Ollama, OpenAI-compatible adapters, Factory
│       ├── agent/                  # Context builder & prompt synthesis
│       ├── benchmark/              # Task schemas, 6-category generator, fault-tolerant BenchmarkRunner
│       ├── evaluation/             # GroundTruthEvaluator, MetricsCalculator, StatisticalAnalyzer
│       ├── observability/          # Execution TraceCollector
│       ├── schemas/                # Pydantic v2 API request/response contracts
│       └── api/                    # Tenant-isolated dependencies & /api/v1 routers
└── frontend/
    ├── package.json                # React 19, Vite 8, Tailwind v4, Vitest dependencies
    ├── vite.config.ts              # Vite build + /api & /health backend proxy config
    ├── vitest.config.ts            # JSDOM test runner configuration
    └── src/
        ├── app/                    # AppProviders (QueryClient, ToastContainer) & AppRouter
        ├── components/             # Auth route guards, AppShell/Sidebar/Topbar, shared UI primitives
        ├── features/               # Auth pages, Dashboard, Projects list & 6-tab Project Detail workspace
        ├── lib/                    # Formatting and UI utility helpers
        ├── services/               # Centralized API client (AM_ERR_* & 401 handling) + typed resource services
        ├── stores/                 # Zustand auth & workspace state stores
        ├── styles/                 # Design tokens (tokens.css) & Tailwind theme setup
        ├── types/                  # TypeScript API request/response interfaces matching backend schemas
        └── test/                   # Vitest component & route-guard integration tests
```