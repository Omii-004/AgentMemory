# AgentMemory — Long-Term Memory Benchmark for AI Agents

**AgentMemory** is a research and benchmarking platform designed to rigorously evaluate how effectively AI agent long-term memory architectures retain, retrieve, update, consolidate, and forget information over hundreds or thousands of interactions.

> **Central Research Question:**
> *"Does a more sophisticated memory system actually improve an AI agent's ability to complete tasks reliably over time, or does it merely retrieve more information?"*

---

## Architecture Overview

AgentMemory implements four interchangeable memory architectures under a unified, namespace-isolated asynchronous contract (`BaseMemory`):

| Architecture | Description | Key Mechanism |
|---|---|---|
| **History** | Baseline sliding context window | Retrieves the latest $N$ messages in chronological sequence. |
| **Vector** | Semantic similarity retrieval | 384-dimensional dense vectors indexed in PostgreSQL via `pgvector` (`<=>` cosine distance). |
| **Structured** | Explicit relational facts | Subject-Predicate-Object triples with temporal validity bounds (`valid_from`, `valid_to`) and automatic contradiction superseding. |
| **Hybrid** | Multi-tiered representation | Multi-factor composite ranking: $\text{Score} = w_1 \cdot \text{Sim} + w_2 \cdot \text{Imp} + w_3 \cdot \text{Rec} + w_4 \cdot \text{Conf}$ with exponential time-decay. |

---

## Core Capabilities Built

- **20 Core Relational Tables:** Fully normalized PostgreSQL 16 schema managed via SQLAlchemy 2.0 (asyncio) and Alembic migrations.
- **Local CPU Embeddings:** `sentence-transformers/all-MiniLM-L6-v2` with asynchronous thread-pooling to avoid blocking FastAPI's event loop.
- **Provider-Independent LLM Layer:** Unified adapter interface supporting `MockLLM` (deterministic offline testing), `OllamaLLM` (local models), and `OpenAICompatibleLLM` (cloud providers).
- **6-Category Synthetic Benchmark Suite:** Automated benchmark task generation and execution across:
  1. **Fact Retrieval** (with configurable conversational noise distractors)
  2. **Temporal Reasoning**
  3. **Contradiction Handling**
  4. **Multi-Hop Retrieval**
  5. **Memory Updating**
  6. **Memory Deletion** (verifying zero retrieval or vector leakage)
- **Quantitative Evaluation & Observability Engine:** Calculates **Task Success Rate (TSR)**, **Precision@K**, **Recall@K**, **MRR**, latencies, token usage, **Memory Utility**, failure classifications, and step-by-step execution traces.
- **Full RESTful API (`/api/v1`):** 56 HTTP endpoints covering Auth, Projects, Sessions, Memory Lab & Inspector, Datasets, Async Background Experiment Runs, Side-by-Side Architecture Comparisons, Traces, and JSON/CSV Report Exports.

---

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (asyncio), Alembic, Pydantic v2
- **Database:** PostgreSQL 16 + `pgvector`
- **Embeddings:** `sentence-transformers` (`all-MiniLM-L6-v2`)
- **Security:** JWT (`python-jose`), native `bcrypt` password hashing, multi-tenant project isolation
- **Package Manager:** `uv`
- **Containers:** Docker Compose

---

## Getting Started (Backend)

### 1. Launch PostgreSQL + pgvector
```bash
docker compose up -d
```

### 2. Set Up Virtual Environment
```bash
cd backend
uv venv --python 3.12
source .venv/bin/activate
uv pip install -e ".[dev]"
```

### 3. Run Database Migrations
```bash
alembic upgrade head
```

### 4. Start the API Server
```bash
uvicorn app.main:app --reload
```

* **API Root:** http://127.0.0.1:8000/
* **Interactive Swagger Docs:** http://127.0.0.1:8000/docs
* **Health Check:** http://127.0.0.1:8000/health

---

## Project Structure

```text
AgentMemory/
├── docker-compose.yml              # PostgreSQL 16 + pgvector container
├── .env.example                    # Environment template
├── README.md                       # Documentation
├── backend/
│   ├── pyproject.toml              # Python 3.12 dependencies and tooling
│   ├── alembic.ini                 # Database migration config
│   ├── migrations/                 # Alembic async migration versions
│   └── app/
│       ├── main.py                 # FastAPI entrypoint, CORS, exception handlers
│       ├── core/                   # Config, native bcrypt/JWT security, logging, exceptions
│       ├── database/               # Connection pool, 20 SQLAlchemy models
│       ├── embeddings/             # SentenceTransformers CPU embedding service
│       ├── memory/                 # BaseMemory, History, Vector, Structured, Hybrid, Factory
│       ├── llm/                    # BaseLLMAdapter, Mock, Ollama, OpenAI adapters, Factory
│       ├── agent/                  # Context builder & prompt synthesis
│       ├── benchmark/              # Task schemas, 6-category generator, async BenchmarkRunner
│       ├── evaluation/             # GroundTruthEvaluator, failure classifier, MetricsCalculator
│       ├── observability/          # Execution TraceCollector
│       ├── schemas/                # Pydantic v2 API request/response contracts
│       └── api/                    # Tenant-isolated dependencies & /api/v1 routers
```