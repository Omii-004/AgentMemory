import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.core.security import get_password_hash
from app.database.models.memory import (
    Memory,
    MemoryEmbedding,
    MemoryEvent,
    MemoryFact,
    MemoryNamespace,
    MemoryRelation,
    MemoryVersion,
)
from app.database.models.user import Project, User
from app.memory.consolidation import MemoryConsolidator
from app.memory.factory import get_memory_architecture
from app.memory.schemas import MemoryItem


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
    assert r1.status == "success" and r2.status == "success" and r3.status == "success"

    ret = await mem.retrieve("anything", top_k=5)
    assert [m.content for m in ret.retrieved_memories] == ["Message 2", "Message 3"]

    upd = await mem.update(r3.affected_memory_ids[0], MemoryItem(content="Message 3 Updated"))
    assert upd.status == "success"

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
async def test_structured_memory_punctuation_versioning_and_point_in_time(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "structured")
    mem = get_memory_architecture("structured", db_session, ns_id)

    t1 = datetime(2025, 1, 1, tzinfo=UTC)
    t_mid = datetime(2025, 3, 1, tzinfo=UTC)
    t2 = datetime(2025, 6, 1, tzinfo=UTC)

    await mem.store(
        MemoryItem(
            content="Team backend_framework Flask",
            subject="Team",
            predicate="backend_framework",
            object_value="Flask",
            valid_from=t1,
        )
    )
    r_cur = await mem.store(
        MemoryItem(
            content="Team backend_framework FastAPI",
            subject="Team",
            predicate="backend_framework",
            object_value="FastAPI",
            valid_from=t2,
        )
    )
    await mem.store(MemoryItem(content="What is the weather in Tokyo?"))

    cur_ret = await mem.retrieve("Which backend framework does Team currently use?", top_k=5)
    assert len(cur_ret.retrieved_memories) == 1
    assert "FastAPI" in cur_ret.retrieved_memories[0].content

    hist_engine = get_memory_architecture("structured", db_session, ns_id, {"as_of": t_mid.isoformat()})
    hist_ret = await hist_engine.retrieve("Which backend framework did Team use?", top_k=5)
    assert any("Flask" in m.content for m in hist_ret.retrieved_memories)
    assert all("FastAPI" not in m.content for m in hist_ret.retrieved_memories)

    # Sequential updates must increment version_number monotonically
    cur_id = r_cur.affected_memory_ids[0]
    await mem.update(cur_id, MemoryItem(content="Team backend_framework Litestar", object_value="Litestar"))
    await mem.update(cur_id, MemoryItem(content="Team backend_framework Django", object_value="Django"))

    ver_res = await db_session.execute(
        select(MemoryVersion).where(MemoryVersion.memory_id == uuid.UUID(cur_id)).order_by(MemoryVersion.version_number.asc())
    )
    assert [v.version_number for v in ver_res.scalars().all()] == [1, 2]

    fact_res = await db_session.execute(select(MemoryFact).where(MemoryFact.memory_id == uuid.UUID(cur_id)))
    assert fact_res.scalars().first().object_value == "Django"


@pytest.mark.asyncio
async def test_hybrid_memory_and_namespace_isolation(db_session, cleanup_users):
    ns_a = await _create_test_namespace(db_session, cleanup_users, "hybrid")
    ns_b = await _create_test_namespace(db_session, cleanup_users, "hybrid")

    mem_a = get_memory_architecture("hybrid", db_session, ns_a)
    mem_b = get_memory_architecture("hybrid", db_session, ns_b)

    await mem_a.store(MemoryItem(content="Secret project alpha launch date is Monday.", importance=0.9))

    ret_b = await mem_b.retrieve("Secret project alpha", top_k=5)
    assert len(ret_b.retrieved_memories) == 0


@pytest.mark.asyncio
async def test_hybrid_memory_fact_superseding_and_versioning(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "hybrid")
    mem = get_memory_architecture("hybrid", db_session, ns_id)

    await mem.store(
        MemoryItem(
            content="Project uses PostgreSQL as its database.",
            subject="Project",
            predicate="database",
            object_value="PostgreSQL",
        )
    )
    r_new = await mem.store(
        MemoryItem(
            content="Project migrated to MongoDB as its database.",
            subject="Project",
            predicate="database",
            object_value="MongoDB",
        )
    )

    ret = await mem.retrieve("Which database does the project currently use?", top_k=5)
    contents = " ".join(m.content for m in ret.retrieved_memories)
    assert "MongoDB" in contents
    assert "PostgreSQL" not in contents

    new_id = r_new.affected_memory_ids[0]
    await mem.update(new_id, MemoryItem(content="Project migrated to CockroachDB.", object_value="CockroachDB"))
    await mem.update(new_id, MemoryItem(content="Project migrated to Spanner.", object_value="Spanner"))
    ver_res = await db_session.execute(
        select(MemoryVersion).where(MemoryVersion.memory_id == uuid.UUID(new_id)).order_by(MemoryVersion.version_number.asc())
    )
    assert [v.version_number for v in ver_res.scalars().all()] == [1, 2]


@pytest.mark.asyncio
async def test_memory_consolidation_and_zero_leakage_deletion(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "hybrid")
    mem = get_memory_architecture("hybrid", db_session, ns_id)

    secret_res = await mem.store(MemoryItem(content="My secret passphrase is Aurora99."))
    await mem.store(MemoryItem(content="User develops with Python."))
    await mem.store(MemoryItem(content="User deploys on Arch Linux."))

    consolidator = MemoryConsolidator(db_session, ns_id)
    res = await consolidator.consolidate(min_memories=2, llm_provider="mock")
    assert res.status == "success"
    assert res.source_count == 3
    assert "Aurora99" in res.summary_content

    ret = await mem.retrieve("What tools does the user use?", top_k=5)
    assert len(ret.retrieved_memories) == 1
    assert "Consolidated Knowledge" in ret.retrieved_memories[0].content

    # Delete original consolidated source -> must purge consolidated summary too (zero leakage)
    secret_uuid = uuid.UUID(secret_res.affected_memory_ids[0])
    consolidated_uuid = uuid.UUID(res.consolidated_memory_id)  # type: ignore[arg-type]

    del_res = await mem.delete(str(secret_uuid))
    assert del_res.status == "success"

    ret_after = await mem.retrieve("secret passphrase Aurora99", top_k=5)
    assert len(ret_after.retrieved_memories) == 0

    # Verify DDD Section 14 content redaction & artifact purges
    mems = (
        await db_session.execute(select(Memory).where(Memory.id.in_([secret_uuid, consolidated_uuid])))
    ).scalars().all()
    assert len(mems) == 2
    assert all(m.status == "deleted" and m.content == "[REDACTED]" for m in mems)

    embs = (
        await db_session.execute(
            select(MemoryEmbedding).where(MemoryEmbedding.memory_id.in_([secret_uuid, consolidated_uuid]))
        )
    ).scalars().all()
    rels = (
        await db_session.execute(
            select(MemoryRelation).where(MemoryRelation.source_memory_id == consolidated_uuid)
        )
    ).scalars().all()
    assert len(embs) == 0 and len(rels) == 0

    events = (
        await db_session.execute(
            select(MemoryEvent).where(MemoryEvent.memory_id == secret_uuid, MemoryEvent.event_type == "deleted")
        )
    ).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_base_memory_rollback_recovery_on_sql_error(db_session, cleanup_users):
    ns_id = await _create_test_namespace(db_session, cleanup_users, "vector")
    mem = get_memory_architecture("vector", db_session, ns_id)

    # Non-existent source_message_id violates FK constraint during DB commit
    bad_res = await mem.store(
        MemoryItem(content="Will fail FK check", source_message_id=uuid.uuid4())
    )
    assert bad_res.status == "error"

    # Session must have rolled back cleanly and remain usable immediately
    ok_res = await mem.store(MemoryItem(content="Recovered after SQL rollback"))
    assert ok_res.status == "success"