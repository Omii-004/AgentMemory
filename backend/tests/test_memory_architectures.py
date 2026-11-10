import uuid
import pytest
from app.core.security import get_password_hash
from app.database.models.memory import MemoryNamespace
from app.database.models.user import Project, User
from app.memory.factory import get_memory_architecture
from app.memory.schemas import MemoryItem
from app.memory.consolidation import MemoryConsolidator


async def _create_test_namespace(db, cleanup_users, arch_type: str) -> uuid.UUID:
    user = User(email=f"memtest_{uuid.uuid4()}@example.com", password_hash=get_password_hash("Pass1234!"))
    db.add(user)
    await db.flush()
    cleanup_users.append(user.id)

    project = Project(owner_id=user.id, name="Memory Test Project")
    db.add(project)
    await db.flush()

    ns = MemoryNamespace(project_id=project.id, architecture_type=arch_type, name=f"ns_{arch_type}", config={})
    db.add(ns)
    await db.commit()
    return ns.id


@pytest.mark.asyncio
async def test_history_memory_lifecycle(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "history")
    mem = get_memory_architecture("history", db_session, ns_id, {"window_size": 2})

    r1 = await mem.store(MemoryItem(content="Message 1"))
    r2 = await mem.store(MemoryItem(content="Message 2"))
    r3 = await mem.store(MemoryItem(content="Message 3"))

    # Sliding window of 2 should return Message 2 and Message 3
    ret = await mem.retrieve("anything", top_k=5)
    assert [m.content for m in ret.retrieved_memories] == ["Message 2", "Message 3"]

    # Update Message 3
    upd = await mem.update(r3.affected_memory_ids[0], MemoryItem(content="Message 3 Updated"))
    assert upd.status == "success"

    # Delete Message 3 Updated
    d = await mem.delete(r3.affected_memory_ids[0])
    assert d.status == "success"

    ret_after = await mem.retrieve("anything", top_k=5)
    assert "Message 3 Updated" not in [m.content for m in ret_after.retrieved_memories]


@pytest.mark.asyncio
async def test_vector_memory_semantic_search_and_zero_leakage_deletion(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "vector")
    mem = get_memory_architecture("vector", db_session, ns_id)

    res_secret = await mem.store(MemoryItem(content="My preferred programming language is Rust."))
    await mem.store(MemoryItem(content="The weather in Paris is sunny today."))

    ret = await mem.retrieve("Which coding language do I like?", top_k=1)
    assert len(ret.retrieved_memories) == 1
    assert "Rust" in ret.retrieved_memories[0].content

    # Delete and verify vector is physically purged
    del_res = await mem.delete(res_secret.affected_memory_ids[0])
    assert del_res.status == "success"

    ret_after = await mem.retrieve("Rust programming language", top_k=5)
    contents = " ".join(m.content for m in ret_after.retrieved_memories)
    assert "Rust" not in contents


@pytest.mark.asyncio
async def test_structured_memory_contradiction_superseding(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "structured")
    mem = get_memory_architecture("structured", db_session, ns_id)

    await mem.store(MemoryItem(content="Project database PostgreSQL", subject="Project", predicate="database", object_value="PostgreSQL"))
    await mem.store(MemoryItem(content="Project database MongoDB", subject="Project", predicate="database", object_value="MongoDB"))

    ret = await mem.retrieve("What database does Project use?", top_k=5)
    assert len(ret.retrieved_memories) == 1
    assert "MongoDB" in ret.retrieved_memories[0].content


@pytest.mark.asyncio
async def test_hybrid_memory_and_namespace_isolation(db_session, cleanup_users):
    ns_a = await _create_test_namespace(db_session, cleanup_users, "hybrid")
    ns_b = await _create_test_namespace(db_session, cleanup_users, "hybrid")

    mem_a = get_memory_architecture("hybrid", db_session, ns_a)
    mem_b = get_memory_architecture("hybrid", db_session, ns_b)

    await mem_a.store(MemoryItem(content="Secret project alpha launch date is Monday.", importance=0.9))

    # Namespace B must NOT see Namespace A's memories
    ret_b = await mem_b.retrieve("Secret project alpha", top_k=5)
    assert len(ret_b.retrieved_memories) == 0


@pytest.mark.asyncio
async def test_memory_consolidation(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "hybrid")
    mem = get_memory_architecture("hybrid", db_session, ns_id)
    await mem.store(MemoryItem(content="User develops with Python."))
    await mem.store(MemoryItem(content="User builds APIs using FastAPI."))
    await mem.store(MemoryItem(content="User deploys on Arch Linux."))
    consolidator = MemoryConsolidator(db_session, ns_id)
    res = await consolidator.consolidate(min_memories=2, llm_provider="mock")
    assert res.status == "success"
    assert res.source_count == 3
    assert "Python" in res.summary_content
    assert "FastAPI" in res.summary_content
    # Retrieve after consolidation should return the single consolidated summary
    ret = await mem.retrieve("What tools does the user use?", top_k=5)
    assert len(ret.retrieved_memories) == 1
    assert "Consolidated Knowledge" in ret.retrieved_memories[0].content