# AgentMemory — Long-Term Memory Benchmark for AI Agents

AgentMemory is a standardized benchmarking and research platform designed to evaluate how effectively AI agent long-term memory architectures retain, retrieve, update, consolidate, and forget information over extended multi-turn interactions.

## Supported Architectures
1. **Conversation-History Memory** (Sliding context baseline)
2. **Vector-Based Memory** (pgvector + `sentence-transformers/all-MiniLM-L6-v2`)
3. **Structured Memory** (Explicit subject-predicate-object facts with temporal bounds)
4. **Hybrid Memory** (Episodic + Semantic + Structured + Vector retrieval)

## Tech Stack
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (asyncio), Alembic
- **Database:** PostgreSQL 16 + pgvector
- **Package Management:** `uv`
- **Containers:** Docker Compose

## Quick Start (Backend)

### 1. Start Database
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