# AgentMemory — Complete User Guide

Welcome to **AgentMemory**, a long-term memory research and benchmarking platform for AI agents. This guide covers everything you need to install, configure, run experiments, connect external or local LLMs, interpret statistical analytics, audit execution traces, and export reproducible reports.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Prerequisites & Installation](#2-prerequisites--installation)
3. [Environment & LLM Provider Configuration](#3-environment--llm-provider-configuration)
4. [Quickstart: Your First 5-Minute Benchmark](#4-quickstart-your-first-5-minute-benchmark)
5. [Workspace & UI Navigation Guide](#5-workspace--ui-navigation-guide)
6. [Memory Architectures Explained](#6-memory-architectures-explained)
7. [Benchmark Categories & Evaluation Engine](#7-benchmark-categories--evaluation-engine)
8. [Running Experiments & Live Monitoring](#8-running-experiments--live-monitoring)
9. [How to Interpret Experiment Analytics](#9-how-to-interpret-experiment-analytics)
10. [Auditing Outputs & Trusting Results](#10-auditing-outputs--trusting-results)
11. [Exporting Reports & Reproducibility](#11-exporting-reports--reproducibility)
12. [API Reference & Testing Commands](#12-api-reference--testing-commands)
13. [Troubleshooting & FAQ](#13-troubleshooting--faq)

---

## 1. Platform Overview

**AgentMemory** answers a core engineering and research question:

> *"Does a more sophisticated memory architecture actually improve an AI agent's ability to complete tasks reliably over time, or does it merely retrieve more information at higher token and latency cost?"*

### What You Can Do
- **Prototype & Inspect Memories:** Store, retrieve, update, consolidate, and hard-purge memories interactively across isolated namespaces.
- **Benchmark Memory Architectures:** Pit 4 interchangeable memory engines (`history`, `vector`, `structured`, `hybrid`) head-to-head on identical datasets.
- **Test Any LLM:** Run deterministic offline evaluations (`mock`), local open-weight models (`ollama`), or cloud/Hugging Face models (`openai_compatible` via OpenRouter, OpenAI, vLLM, etc.).
- **Measure Scientific Rigor:** Evaluate Task Success Rate (TSR), Precision@K, Recall@K, MRR, latency, token consumption, Memory Utility, 95% confidence intervals, paired *t*-tests, Wilcoxon signed-rank tests, and Cohen's *d*.
- **Audit Every Decision:** Inspect full step-by-step execution traces and failure classifications without relying on black-box LLM judges.

---

## 2. Prerequisites & Installation

### System Requirements
- **OS:** Linux / macOS / WSL2
- **Docker & Docker Compose** (for PostgreSQL 16 + `pgvector`)
- **Python 3.12+** & [`uv`](https://docs.astral.sh/uv/) (backend)
- **Node.js 20+** & `npm` (frontend)

### Step 1: Clone & Configure Environment
```bash
git clone https://github.com/Omii-004/AgentMemory.git
cd AgentMemory
cp .env.example .env
```

### Step 2: Start PostgreSQL + `pgvector`
```bash
docker compose up -d
```
Verify the container is healthy:
```bash
docker compose ps
```

### Step 3: Set Up & Start the Backend API
```bash
cd backend
uv venv --python 3.12
source .venv/bin/activate
uv pip install -e ".[dev]"

# Apply all database migrations
alembic upgrade head

# Launch FastAPI server
uvicorn app.main:app --reload
```
- **API Base URL:** `http://127.0.0.1:8000`
- **Interactive Swagger Docs:** `http://127.0.0.1:8000/docs`
- **Health Check:** `http://127.0.0.1:8000/health`

> **Note:** On first startup or first embedding operation, `sentence-transformers/all-MiniLM-L6-v2` (~90 MB) downloads automatically and runs locally on CPU.

### Step 4: Set Up & Start the Frontend Workspace
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
- **Web App:** `http://localhost:5173` (Vite automatically proxies `/api` and `/health` to `http://127.0.0.1:8000`).

---

## 3. Environment & LLM Provider Configuration

All configuration lives in the root `.env` file. The backend loads `.env` with `override=True`, ensuring `.env` values stay consistent across reloads.

### Core `.env` Variables

```ini
# Application & Auth
ENVIRONMENT=development
DEBUG=True
SECRET_KEY=<generate_a_64_char_random_secret>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Database (must match your PostgreSQL / docker-compose.yml credentials)
POSTGRES_USER=<your_db_user>
POSTGRES_PASSWORD=<your_db_password>
POSTGRES_SERVER=localhost
POSTGRES_PORT=5432
POSTGRES_DB=agentmemory
DATABASE_URL=postgresql+asyncpg://<your_db_user>:<your_db_password>@localhost:5432/agentmemory
DATABASE_URL_SYNC=postgresql://<your_db_user>:<your_db_password>@localhost:5432/agentmemory

# Local Embeddings
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384

# LLM Provider Configuration
LLM_PROVIDER=mock
OPENAI_API_KEY=<your_api_key_if_using_remote_provider>
OPENAI_BASE_URL=https://api.openai.com/v1
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_LLM_MODEL=gpt-4o-mini
```

### Connecting Different LLM Providers

AgentMemory supports three provider modes when creating an experiment in **Benchmark Studio**:

#### Option A: `mock` (Offline, Free, Instant)
- No API key required.
- Deterministically extracts top-matching retrieved context to test memory retrieval pipelines without spending tokens.

#### Option B: `ollama` (Local Open-Weight Models)
1. Install Ollama and pull a model:
   ```bash
   ollama pull llama3.2
   ```
2. Ensure `OLLAMA_BASE_URL=http://localhost:11434` is set in `.env`.
3. In Benchmark Studio, select provider **`ollama`** and set model to `llama3.2`.

#### Option C: `openai_compatible` (OpenRouter, Hugging Face, OpenAI, Groq, vLLM)
Any provider exposing a `/chat/completions` OpenAI-compatible API works seamlessly:

- **OpenRouter (Recommended for Free & Open-Source Hugging Face Models):**
  ```ini
  OPENAI_BASE_URL=https://openrouter.ai/api/v1
  OPENAI_API_KEY=sk-or-v1-your-key-here
  ```
  Example model IDs to enter in Benchmark Studio:
  - `nvidia/nemotron-3.5-lightning:free`
  - `meta-llama/llama-3.3-70b-instruct:free`
  - `qwen/qwen-2.5-72b-instruct`

- **OpenAI:**
  ```ini
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_API_KEY=sk-your-openai-key
  ```
  Example model ID: `gpt-4o-mini`

- **Local vLLM / LM Studio:**
  ```ini
  OPENAI_BASE_URL=http://localhost:1234/v1
  OPENAI_API_KEY=
  ```
  *(API key is automatically optional when `localhost` or `127.0.0.1` is detected).*

> **Important:** After editing `.env`, restart `uvicorn` (and run `unset OPENAI_BASE_URL OPENAI_API_KEY` if you previously exported them in your terminal) to guarantee clean settings.

---

## 4. Quickstart: Your First 5-Minute Benchmark

1. **Register an Account:** Open `http://localhost:5173/register`, create your researcher account, and log in.
2. **Create a Project:** Go to **Projects** (`/projects`), click **New Project**, give it a name (e.g., *"Memory Architecture Study"*), and set it as your **Active Project** in the top bar.
3. **Generate a Synthetic Dataset:** Open your Project → **Datasets** tab → click **Generate Synthetic Dataset** (e.g., 2–5 tasks per category).
4. **Create an Experiment:** Go to **Benchmark Studio** (`/benchmark-studio`):
   - Select your dataset.
   - Select architectures to compare (e.g., `history`, `vector`, `structured`, `hybrid`).
   - Pick your LLM provider (`mock`, `ollama`, or `openai_compatible`) and model name.
   - Set **Temperature** to `0.0` for deterministic reproducibility and set a **Random Seed** (e.g., `42`).
5. **Launch & Monitor:** Click **Launch Run**. Watch live per-architecture progress, task status, token usage, and latency stream in real time.
6. **Analyze & Export:** Click **View Analytics** (`/analytics`) to inspect charts, statistical significance, and failure traces, then generate a JSON or CSV report in **Reports** (`/reports`).

---

## 5. Workspace & UI Navigation Guide

| Page | Route | Purpose |
| :--- | :--- | :--- |
| **Dashboard** | `/dashboard` | High-level KPIs across projects, active datasets, recent runs, and quick navigation. |
| **Projects** | `/projects` | Create, search, and switch between isolated research workspaces. |
| **Project Detail** | `/projects/:projectId` | 6-tab workspace: **Overview**, **Namespaces**, **Datasets**, **Experiments**, **Sessions**, and **Settings**. |
| **Memory Lab** | `/memory-lab` | Interactive sandbox to test `store`, `retrieve`, `update`, `consolidate`, and `delete` operations against any of the 4 memory engines. |
| **Memory Inspector** | `/memory-inspector` | 3-panel deep inspector to browse raw memories, extracted Subject-Predicate-Object facts, version history, provenance links, and lifecycle events. |
| **Benchmark Studio** | `/benchmark-studio` | Configure experiments, select architectures/LLMs, launch async runs, cancel in-flight runs, and monitor task results live. |
| **Experiment Analytics** | `/analytics` | KPI summary cards, side-by-side comparison matrix, category accuracy charts, latency/token efficiency plots, statistical significance tables, and failure trace viewer. |
| **Reports** | `/reports` | Generate, list, download, and manage reproducible JSON and CSV research reports. |

---

## 6. Memory Architectures Explained

Every architecture implements the exact same `BaseMemory` asynchronous contract and operates inside an isolated namespace so architectures never contaminate each other's data.

| Architecture | Internal Mechanism | Strengths | Typical Weaknesses |
| :--- | :--- | :--- | :--- |
| **`history`** | Sliding window of the latest $N$ chronological messages. | Simple baseline; preserves recent conversational order. | Context stuffing, high token usage, drops older facts, vulnerable to distractors. |
| **`vector`** | 384-dim dense embeddings (`all-MiniLM-L6-v2`) indexed via PostgreSQL `pgvector` cosine distance (`<=>`). | Fast semantic similarity search over large histories. | Weak on temporal ordering, contradictions, and multi-hop links. |
| **`structured`** | Explicit Subject-Predicate-Object triples with temporal bounds (`valid_from`, `valid_to`), `as_of` point-in-time queries, and contradiction superseding. | High precision on factual updates, timelines, and conflict resolution. | Can miss unstructured nuance if phrasing diverges from triple extraction. |
| **`hybrid`** | Multi-factor composite ranking combining semantic similarity, importance, recency decay, confidence, and structured fact boosts, plus `as_of` filtering and contradiction superseding. | Best all-around balance across factual, temporal, multi-hop, and update workloads. | Slightly higher retrieval complexity than pure history or vector. |

### Hybrid Ranking Formula
$$\text{Score} = w_1 \cdot \text{Similarity} + w_2 \cdot \text{Importance} + w_3 \cdot \text{Recency} + w_4 \cdot \text{Confidence} + \text{FactBoost}$$

### Memory Lifecycle Operations
- **Consolidation (`MemoryConsolidator`):** Merges semantically related memories into distilled summaries linked via `derives_from` provenance records.
- **Zero-Leakage Deletion:** Hard-deletes derived embeddings, structured facts, versions, and relations while scrubbing canonical content to `[REDACTED]`, preventing deleted facts from leaking into future retrievals.

---

## 7. Benchmark Categories & Evaluation Engine

### The 6 Benchmark Categories

| Category Key | What It Tests | Evaluation Policy |
| :--- | :--- | :--- |
| **`fact_retrieval`** | Recalling specific facts buried under conversational distractor noise. | Normalized string & accepted-answer matching. |
| **`temporal_reasoning`** | Resolving time-bound facts (e.g., state at time $T_1$ vs. $T_2$). | Normalized matching against chronological ground truth. |
| **`contradiction_handling`** | Overriding outdated facts when newer conflicting facts arrive. | Normalized matching verifying only the latest valid state is returned. |
| **`multi_hop`** | Combining two or more separate memories to answer a single question. | `contains_all` verification checking every required bridge term appears. |
| **`memory_updating`** | Explicitly modifying an existing memory and retrieving the updated value. | Normalized matching against the updated ground truth. |
| **`memory_deletion`** | Verifying a deleted memory is completely forgotten and never retrieved. | `state_based_deletion` checking zero forbidden terms leak into retrieved context. |

### Failure Classification Taxonomy
Whenever a task fails, `GroundTruthEvaluator.classify_failure` automatically attributes the root cause:
- **`Retrieval Failure`:** Required ground-truth memory IDs were not retrieved (the LLM never saw the answer).
- **`Generation Failure`:** Required memories *were* retrieved, but the LLM failed to produce the right answer (hallucination or reasoning miss).
- **`Temporal Failure` / `Contradiction Failure` / `Multi-hop Failure` / `Update Failure` / `Deletion Failure`:** Category-specific reasoning or state-management breakdowns.
- **`Execution Failure`:** Runtime or upstream provider error (isolated per-task so the rest of the run continues).

---

## 8. Running Experiments & Live Monitoring

### Key Experiment Parameters
- **Architectures:** Select 2 or more architectures to enable pairwise statistical comparisons.
- **LLM Provider & Model:** Choose `mock`, `ollama`, or `openai_compatible` and specify the exact model identifier.
- **Number of Trials (`num_trials`):** Increase trials (e.g., `3`–`5`) for tighter confidence intervals and higher statistical power.
- **Temperature:** Keep at `0.0` for deterministic, reproducible evaluations.
- **Max Tokens:** Recommended `512` (or `1024` for reasoning models that emit thinking tokens before the final answer).
- **Random Seed:** Pin an integer seed (e.g., `42`) to reproduce exact task ordering and sampling.

### Fault Tolerance & Cancellation
- Runs execute asynchronously in background tasks (`HTTP 202 Accepted`).
- If a single task encounters a transient HTTP error (`429`, `500`, `502`, `503`, `504`), the adapter automatically retries with backoff.
- If a task still fails, it is logged as an `Execution Failure` and the runner proceeds to the next task without aborting the entire experiment.
- You can safely click **Cancel Run** at any time; the runner checks cancellation checkpoints between tasks and architectures.

---

## 9. How to Interpret Experiment Analytics

Use this 4-step framework when reading `/analytics`:

### Step 1: Accuracy & Category Breakdown
- Check **Task Success Rate (TSR %)** overall and per category.
- Identify architectural specialization: e.g., if `vector` matches `hybrid` on `fact_retrieval` but drops sharply on `contradiction_handling` and `temporal_reasoning`, conclude that dense similarity alone cannot track mutable state over time.

### Step 2: Retrieval Quality (Precision@K, Recall@K, MRR)
- **Low Recall@K:** Your memory engine is missing relevant facts → tune embeddings, increase `top_k`, or switch to `hybrid`.
- **High Recall@K + Low Precision@K:** The engine retrieves the right fact buried in irrelevant noise → tighten similarity thresholds or use structured/hybrid filtering.
- **Low MRR:** Relevant memories are found but ranked too low (causing "lost-in-the-middle" LLM degradation).

### Step 3: Efficiency & ROI (Memory Utility)
Don't pick an architecture solely for a 1–2% TSR edge if it costs 5x more tokens or latency. Compare **Avg Latency**, **Total Tokens**, and **Memory Utility**:

$$\text{Memory Utility} = \frac{\text{TSR}}{1 + (\lambda_{\text{tokens}} \cdot \text{avg\_tokens}) + (\mu_{\text{latency}} \cdot \text{avg\_latency})}$$

Higher Memory Utility indicates a better accuracy-to-cost-and-speed trade-off for production deployments.

### Step 4: Statistical Significance
Check the **Statistical Analysis** panel before declaring a winner:
- **95% Confidence Intervals (CI):** Non-overlapping intervals indicate a reliable performance gap.
- **$p$-value (Paired *t*-test / Wilcoxon):** $p < 0.05$ indicates the difference is statistically significant and unlikely due to random chance.
- **Cohen's $d$ Effect Size:** $|d| \approx 0.2$ (small), $0.5$ (medium), $\ge 0.8$ (large practical impact).

---

## 10. Auditing Outputs & Trusting Results

AgentMemory avoids opaque evaluation scores:
1. **Deterministic Rules:** Ground-truth evaluation is 100% deterministic—zero LLM-judge drift.
2. **Inspect Every Trace:** Scroll to **Failure Traces** in `/analytics` (or query `GET /api/v1/runs/{run_id}/traces`) to view:
   - The exact user question.
   - The exact retrieved memories and scores.
   - The exact prompt sent to the LLM.
   - The raw model output text.
   - The expected ground truth and exact matching diagnostics (`normalized_generated` vs. `normalized_expected`, `missing_terms`, or `leaked_terms`).
3. **Verify Memory State Directly:** Open **Memory Inspector** (`/memory-inspector`) to confirm stored triples, version histories, consolidation links, and `[REDACTED]` deletion records.

---

## 11. Exporting Reports & Reproducibility

Navigate to **Reports** (`/reports`), pick a completed run, and click **Generate Report**:

- **JSON Report:** Complete machine-readable research bundle containing experiment metadata, random seed, full configuration, side-by-side comparison matrix (including `total_tokens`), statistical significance results, and failure summary. Ideal for Python notebooks and archival.
- **CSV Report:** Clean tabular export ready for spreadsheets, LaTeX tables, or plotting tools.

Every report is persisted under `experiment-artifacts/` and can be re-downloaded or deleted from the Reports table at any time.

---

## 12. API Reference & Testing Commands

### Key API Route Groups (`/api/v1`)
- **Auth:** `/auth/register`, `/auth/login`, `/auth/me`
- **Projects & Sessions:** `/projects`, `/projects/{id}/sessions`, `/projects/{id}/namespaces`
- **Memories:** `/namespaces/{id}/memories`, `/memories/retrieve`, `/memories/{id}`, `/namespaces/{id}/consolidate`
- **Datasets:** `/projects/{id}/datasets`, `/projects/{id}/datasets/generate`
- **Experiments & Analytics:** `/projects/{id}/experiments`, `/experiments/{id}/runs`, `/runs/{id}/comparison`, `/runs/{id}/statistics`, `/runs/{id}/failures`, `/runs/{id}/traces`, `/runs/{id}/reports`

Explore and test all endpoints interactively at `http://127.0.0.1:8000/docs`.

### Running Verification & Quality Suites

**Backend:**
```bash
cd backend
.venv/bin/pytest -v
.venv/bin/mypy app
.venv/bin/ruff check app tests
```

**Frontend:**
```bash
cd frontend
npm test
npm run lint
npm run build
```

---

## 13. Troubleshooting & FAQ

### `ValueError: OPENAI_API_KEY is required when using a remote OpenAI-compatible provider`
- **Cause:** You selected `openai_compatible` with a remote `OPENAI_BASE_URL` while `OPENAI_API_KEY` is blank in `.env`.
- **Fix:** Add your API key to `.env` and restart `uvicorn`. (For local `localhost`/`127.0.0.1` endpoints, no key is required.)

### `httpx.ConnectError: [Errno -5] No address associated with hostname`
- **Cause:** Invalid or deprecated `OPENAI_BASE_URL` (for example, the retired `https://api-inference.huggingface.co/v1`), or stale shell environment variables overriding `.env`.
- **Fix:** Set a valid endpoint in `.env` (e.g., `OPENAI_BASE_URL=https://openrouter.ai/api/v1`), then run:
  ```bash
  unset OPENAI_BASE_URL OPENAI_API_KEY
  uvicorn app.main:app --reload
  ```

### Reasoning Models Returning Empty or `null` Content
- **Cause:** Some reasoning models spend their token budget in `reasoning_content` before writing final `content`.
- **Fix:** AgentMemory automatically falls back to `reasoning_content` / `refusal` safely without crashing. For best results with reasoning models, increase `max_tokens` to `1024` or higher in Benchmark Studio.

### Database Connection Refused on Startup
- **Cause:** PostgreSQL Docker container is stopped or migrations haven't been applied.
- **Fix:**
  ```bash
  docker compose up -d
  cd backend && alembic upgrade head
  ```

### Frontend Cannot Reach Backend (`Network Error` / `500`)
- **Cause:** FastAPI isn't running on port `8000`.
- **Fix:** Verify `http://127.0.0.1:8000/health` returns `{"status": "healthy"}` before using `http://localhost:5173`.