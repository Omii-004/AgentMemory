# AgentMemory — Long-Term Memory Benchmark for AI Agents

**AgentMemory** is a research and benchmarking platform designed to rigorously evaluate how effectively AI agent long-term memory architectures retain, retrieve, update, consolidate, and forget information over hundreds or thousands of interactions.

> **Central Research Question:**
> *"Does a more sophisticated memory system actually improve an AI agent's ability to complete tasks reliably over time, or does it merely retrieve more information?"*

---

## Architecture Overview

AgentMemory implements four distinct memory architectures under a unified, isolated asynchronous interface (`BaseMemory`):

| Architecture | Description | Key Mechanism |
|---|---|---|
| **History** | Baseline sliding context window | Retrieves the latest $N$ messages in chronological sequence. |
| **Vector** | Semantic similarity retrieval | 384-dimensional dense vectors indexed in PostgreSQL via `pgvector` (`<=>` cosine distance). |
| **Structured** | Explicit relational facts | Subject-Predicate-Object triples with temporal validity bounds (`valid_from`, `valid_to`) and automatic contradiction superseding. |
| **Hybrid** | Multi-tiered representation | Multi-factor composite ranking: $\text{Score} = w_1 \cdot \text{Sim} + w_2 \cdot \text{Imp} + w_3 \cdot \text{Rec} + w_4 \cdot \text{Conf}$ with exponential time-decay. |

---

## Core Capabilities Built

- **20 Core Relational Tables:** Fully normalized PostgreSQL 16 schema managed via SQLAlchemy 2.0 (asyncio) and Alembic migrations.
- **Local CPU Embeddings:** `sentence-transformers/all-MiniLM-L6-v2` with asynchronous thread-pooling to avoid event-loop blocking.
- **Provider-Independent LLM Layer:** Unified adapter interface supporting:
  - `MockLLM`: Deterministic, zero-cost offline test harness.
  - `OllamaLLM`: Local inference (`http://localhost:11434`).
  - `OpenAICompatibleLLM`: Cloud providers (OpenAI, Groq, DeepSeek).
- **Multi-Tenant Security:** Enforces strict namespace and project isolation per user, preventing cross-tenant memory leakage.
- **Zero-Leakage Deletion:** Hard-purges vector embeddings and closes fact validity intervals upon deletion requests.

---

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (asyncio), Alembic, Pydantic v2
- **Vector Database:** PostgreSQL 16 + `pgvector`
- **Embeddings:** `sentence-transformers` (`all-MiniLM-L6-v2`)
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
│       ├── core/                   # Config, security (JWT/bcrypt), logging, exceptions
│       ├── database/               # Connection manager, 20 SQLAlchemy models
│       ├── embeddings/             # SentenceTransformers CPU embedding service
│       ├── memory/                 # BaseMemory, History, Vector, Structured, Hybrid, Factory
│       ├── llm/                    # BaseLLMAdapter, Mock, Ollama, OpenAI adapters, Factory
│       ├── agent/                  # Context builder & prompt synthesis
│       └── api/                    # Dependencies & FastAPI routers
```