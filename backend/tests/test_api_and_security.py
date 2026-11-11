import uuid

import pytest

from app.benchmark.runner import BenchmarkRunner
from app.core.security import get_password_hash
from app.database.models.benchmark import BenchmarkDataset, BenchmarkTask
from app.database.models.experiment import Experiment, ExperimentRun, RunArchitecture
from app.database.models.memory import MemoryNamespace
from app.database.models.user import Project, User
from app.llm.mock import MockLLMAdapter


async def _register_and_login(client, email: str, password: str = "SecurePass123!") -> str:
    reg = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert reg.status_code == 201
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_tenant_isolation_security(client, db_session, cleanup_users):
    email_a = f"user_a_{uuid.uuid4()}@example.com"
    email_b = f"user_b_{uuid.uuid4()}@example.com"

    token_a = await _register_and_login(client, email_a)
    token_b = await _register_and_login(client, email_b)

    me_a = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token_a}"})
    me_b = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token_b}"})
    cleanup_users.extend([uuid.UUID(me_a.json()["data"]["id"]), uuid.UUID(me_b.json()["data"]["id"])])

    p_resp = await client.post(
        "/api/v1/projects",
        json={"name": "User A Confidential Project"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert p_resp.status_code == 201
    project_id = p_resp.json()["data"]["id"]

    denied = await client.get(
        f"/api/v1/projects/{project_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert denied.status_code == 404
    assert denied.json()["success"] is False


@pytest.mark.asyncio
async def test_validation_error_envelope_and_auth_paths(client, db_session, cleanup_users):
    # Invalid email triggers standardized AM_ERR_VALIDATION_FAILED envelope
    bad_reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "not-an-email", "password": "short"},
    )
    assert bad_reg.status_code == 422
    bad_body = bad_reg.json()
    assert bad_body["success"] is False
    assert bad_body["error"]["code"] == "AM_ERR_VALIDATION_FAILED"

    email = f"auth_checks_{uuid.uuid4()}@example.com"
    token = await _register_and_login(client, email)
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    cleanup_users.append(uuid.UUID(me.json()["data"]["id"]))

    # Duplicate email returns 409 conflict
    dup_reg = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "SecurePass123!"},
    )
    assert dup_reg.status_code == 409

    # Wrong password returns 401
    bad_login = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "WrongPassword!"},
    )
    assert bad_login.status_code == 401

    # Unauthenticated request returns 401
    no_auth = await client.get("/api/v1/auth/me")
    assert no_auth.status_code == 401

    logout = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout.status_code == 200


@pytest.mark.asyncio
async def test_cross_project_namespace_isolation_and_memory_api_lifecycle(client, db_session, cleanup_users):
    email = f"ns_iso_{uuid.uuid4()}@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    me = await client.get("/api/v1/auth/me", headers=headers)
    cleanup_users.append(uuid.UUID(me.json()["data"]["id"]))

    proj_a = (await client.post("/api/v1/projects", json={"name": "Project A"}, headers=headers)).json()["data"]["id"]
    proj_b = (await client.post("/api/v1/projects", json={"name": "Project B"}, headers=headers)).json()["data"]["id"]

    ns_b = (
        await client.post(
            f"/api/v1/projects/{proj_b}/memory-namespaces",
            json={"architecture_type": "structured", "name": "B Structured"},
            headers=headers,
        )
    ).json()["data"]["id"]

    # Cross-project leak check: accessing Project B's namespace via Project A URL must fail 404
    leak_store = await client.post(
        f"/api/v1/projects/{proj_a}/memories",
        json={"namespace_id": ns_b, "content": "Unauthorized leak"},
        headers=headers,
    )
    assert leak_store.status_code == 404

    leak_ret = await client.post(
        f"/api/v1/projects/{proj_a}/memories/retrieve",
        json={"namespace_id": ns_b, "query": "leak"},
        headers=headers,
    )
    assert leak_ret.status_code == 404

    leak_list = await client.get(
        f"/api/v1/projects/{proj_a}/memories?namespace_id={ns_b}",
        headers=headers,
    )
    assert leak_list.status_code == 404

    # Temporal store + point-in-time retrieve + update + delete 409 conflict
    s1 = await client.post(
        f"/api/v1/projects/{proj_b}/memories",
        json={
            "namespace_id": ns_b,
            "content": "Project database PostgreSQL",
            "subject": "Project",
            "predicate": "database",
            "object_value": "PostgreSQL",
            "valid_from": "2025-01-01T00:00:00Z",
        },
        headers=headers,
    )
    assert s1.status_code == 201

    s2 = await client.post(
        f"/api/v1/projects/{proj_b}/memories",
        json={
            "namespace_id": ns_b,
            "content": "Project database MongoDB",
            "subject": "Project",
            "predicate": "database",
            "object_value": "MongoDB",
            "valid_from": "2025-06-01T00:00:00Z",
        },
        headers=headers,
    )
    assert s2.status_code == 201
    mem_id = s2.json()["data"]["affected_memory_ids"][0]

    hist_q = await client.post(
        f"/api/v1/projects/{proj_b}/memories/retrieve",
        json={"namespace_id": ns_b, "query": "Which database does Project use?", "as_of": "2025-03-01T00:00:00Z"},
        headers=headers,
    )
    assert hist_q.status_code == 200
    assert "PostgreSQL" in hist_q.json()["data"]["retrieved_memories"][0]["content"]

    upd = await client.patch(
        f"/api/v1/memories/{mem_id}",
        json={"content": "Project database CockroachDB", "object_value": "CockroachDB"},
        headers=headers,
    )
    assert upd.status_code == 200

    ns_list = await client.get(f"/api/v1/projects/{proj_b}/memory-namespaces", headers=headers)
    assert ns_list.status_code == 200 and ns_list.json()["data"][0]["run_id"] is None

    facts = await client.get(f"/api/v1/memories/{mem_id}/facts", headers=headers)
    assert facts.status_code == 200
    assert len(facts.json()["data"]) == 1
    assert facts.json()["data"][0]["subject"] == "Project"
    assert facts.json()["data"][0]["object_value"] == "CockroachDB"

    # Cross-user 404 isolation on /memories/{id}/facts
    other_token = await _register_and_login(client, f"mem_other_{uuid.uuid4()}@example.com")
    other_me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {other_token}"})
    cleanup_users.append(uuid.UUID(other_me.json()["data"]["id"]))
    denied_facts = await client.get(
        f"/api/v1/memories/{mem_id}/facts",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert denied_facts.status_code == 404

    vers = await client.get(f"/api/v1/memories/{mem_id}/versions", headers=headers)
    assert vers.status_code == 200 and vers.json()["data"][0]["version_number"] == 1

    evts = await client.get(f"/api/v1/memories/{mem_id}/events", headers=headers)
    assert evts.status_code == 200 and any(e["event_type"] == "updated" for e in evts.json()["data"])

    del1 = await client.delete(f"/api/v1/memories/{mem_id}", headers=headers)
    assert del1.status_code == 200

    all_mems = await client.get(
        f"/api/v1/projects/{proj_b}/memories?namespace_id={ns_b}&status_filter=all",
        headers=headers,
    )
    deleted_rec = next(m for m in all_mems.json()["data"] if m["id"] == mem_id)
    assert deleted_rec["status"] == "deleted"
    assert deleted_rec["content"] == "[REDACTED]"
    assert deleted_rec["deleted_at"] is not None

    facts_after_del = await client.get(f"/api/v1/memories/{mem_id}/facts", headers=headers)
    assert facts_after_del.status_code == 200 and facts_after_del.json()["data"] == []

    del2 = await client.delete(f"/api/v1/memories/{mem_id}", headers=headers)
    assert del2.status_code == 409

    upd_deleted = await client.patch(
        f"/api/v1/memories/{mem_id}",
        json={"content": "Should fail"},
        headers=headers,
    )
    assert upd_deleted.status_code == 409


@pytest.mark.asyncio
async def test_sessions_datasets_and_experiment_validation(client, db_session, cleanup_users):
    email = f"sess_ds_{uuid.uuid4()}@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    me = await client.get("/api/v1/auth/me", headers=headers)
    cleanup_users.append(uuid.UUID(me.json()["data"]["id"]))

    proj_id = (await client.post("/api/v1/projects", json={"name": "Sessions & DS"}, headers=headers)).json()["data"]["id"]

    sess_id = (
        await client.post(f"/api/v1/projects/{proj_id}/sessions", json={"name": "Run Log"}, headers=headers)
    ).json()["data"]["id"]
    m1 = await client.post(f"/api/v1/sessions/{sess_id}/messages", json={"role": "user", "content": "Hello"}, headers=headers)
    m2 = await client.post(f"/api/v1/sessions/{sess_id}/messages", json={"role": "assistant", "content": "Hi"}, headers=headers)
    assert m1.status_code == 201 and m1.json()["data"]["sequence_number"] == 1
    assert m2.status_code == 201 and m2.json()["data"]["sequence_number"] == 2

    msgs = await client.get(f"/api/v1/sessions/{sess_id}/messages", headers=headers)
    assert [m["sequence_number"] for m in msgs.json()["data"]] == [1, 2]

    ds_id = (
        await client.post(f"/api/v1/projects/{proj_id}/datasets", json={"name": "Custom DS"}, headers=headers)
    ).json()["data"]["id"]
    imp = await client.post(
        f"/api/v1/datasets/{ds_id}/tasks/import",
        json={
            "tasks": [
                {
                    "task_key": "IMP_001",
                    "category": "fact_retrieval",
                    "conversation_sequence": [{"sequence_number": 1, "role": "user", "content": "My language is Python.", "is_evidence": True}],
                    "evaluation_query": {"operation": "retrieve", "question": "What is my language?"},
                    "expected_answer": {"answer": "Python", "accepted_answers": ["Python"]},
                }
            ]
        },
        headers=headers,
    )
    assert imp.status_code == 201
    val = await client.post(f"/api/v1/datasets/{ds_id}/validate", headers=headers)
    assert val.status_code == 200 and val.json()["data"]["valid"] is True

    # Reject duplicate architectures (422) and unsupported provider (422)
    dup_exp = await client.post(
        f"/api/v1/projects/{proj_id}/experiments",
        json={"dataset_id": ds_id, "name": "Dup Archs", "architectures": ["vector", "vector"]},
        headers=headers,
    )
    assert dup_exp.status_code == 422

    bad_prov = await client.post(
        f"/api/v1/projects/{proj_id}/experiments",
        json={"dataset_id": ds_id, "name": "Bad Prov", "architectures": ["vector"], "llm_provider": "invalid"},
        headers=headers,
    )
    assert bad_prov.status_code == 422

    # Unsupported architecture triggers 400 AM_ERR_ARCHITECTURE_UNSUPPORTED
    bad_arch = await client.post(
        f"/api/v1/projects/{proj_id}/experiments",
        json={"dataset_id": ds_id, "name": "Bad Arch", "architectures": ["unknown_mem"]},
        headers=headers,
    )
    assert bad_arch.status_code == 400
    assert bad_arch.json()["error"]["code"] == "AM_ERR_ARCHITECTURE_UNSUPPORTED"


@pytest.mark.asyncio
async def test_end_to_end_benchmark_pipeline(client, db_session, cleanup_users):
    email = f"researcher_{uuid.uuid4()}@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}

    me = await client.get("/api/v1/auth/me", headers=headers)
    cleanup_users.append(uuid.UUID(me.json()["data"]["id"]))

    proj = await client.post("/api/v1/projects", json={"name": "E2E Benchmark Project"}, headers=headers)
    project_id = proj.json()["data"]["id"]

    ds = await client.post(f"/api/v1/projects/{project_id}/datasets", json={"name": "E2E Suite"}, headers=headers)
    dataset_id = ds.json()["data"]["id"]

    gen = await client.post(
        f"/api/v1/datasets/{dataset_id}/generate-synthetic",
        json={"tasks_per_category": 1, "distractor_count": 5},
        headers=headers,
    )
    assert gen.status_code == 201
    assert gen.json()["data"]["total_tasks"] == 6

    exp = await client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={
            "dataset_id": dataset_id,
            "name": "4-Architecture Comparison",
            "architectures": ["history", "vector", "structured", "hybrid"],
            "llm_provider": "mock",
            "num_trials": 1,
        },
        headers=headers,
    )
    assert exp.status_code == 201
    exp_id = exp.json()["data"]["id"]

    run_resp = await client.post(f"/api/v1/experiments/{exp_id}/runs", json={"random_seed": 42}, headers=headers)
    assert run_resp.status_code == 202
    run_id = uuid.UUID(run_resp.json()["data"]["id"])

    comp = await client.get(f"/api/v1/runs/{run_id}/comparison", headers=headers)
    assert comp.status_code == 200
    comp_data = comp.json()["data"]
    assert comp_data["status"] == "completed"
    for arch in ["history", "vector", "structured", "hybrid"]:
        assert arch in comp_data["architectures"]
        assert "task_success_rate" in comp_data["architectures"][arch]

    # Assert meaningful non-zero benchmark accuracy instead of silent 0% failures
    assert comp_data["architectures"]["structured"]["task_success_rate"] >= 80.0
    assert comp_data["architectures"]["hybrid"]["task_success_rate"] >= 80.0
    assert comp_data["architectures"]["vector"]["task_success_rate"] >= 50.0
    assert (
        comp_data["architectures"]["hybrid"]["task_success_rate"]
        > comp_data["architectures"]["history"]["task_success_rate"]
    )

    stats_resp = await client.get(f"/api/v1/runs/{run_id}/statistics", headers=headers)
    assert stats_resp.status_code == 200
    assert "descriptive_ci_95" in stats_resp.json()["data"]
    assert "pairwise_comparisons" in stats_resp.json()["data"]

    cat_resp = await client.get(f"/api/v1/runs/{run_id}/metrics/by-category", headers=headers)
    assert cat_resp.status_code == 200
    assert "fact_retrieval" in cat_resp.json()["data"]

    cfg_resp = await client.get(f"/api/v1/runs/{run_id}/configuration", headers=headers)
    assert cfg_resp.status_code == 200
    assert len(cfg_resp.json()["data"]["architectures"]) == 4

    traces = await client.get(f"/api/v1/runs/{run_id}/traces", headers=headers)
    assert traces.status_code == 200
    assert len(traces.json()["data"]) == 24

    # Completed run cannot be cancelled (409)
    cancel_done = await client.post(f"/api/v1/runs/{run_id}/cancel", headers=headers)
    assert cancel_done.status_code == 409

    # JSON & CSV reports include full metadata/statistics
    rep_json = await client.post(f"/api/v1/runs/{run_id}/reports", json={"report_type": "json"}, headers=headers)
    assert rep_json.status_code == 201
    dl_json = await client.get(f"/api/v1/reports/{rep_json.json()['data']['id']}/download", headers=headers)
    assert dl_json.status_code == 200
    parsed_report = dl_json.json()
    assert parsed_report["experiment_name"] == "4-Architecture Comparison"
    assert "statistical_analysis" in parsed_report

    rep_csv = await client.post(f"/api/v1/runs/{run_id}/reports", json={"report_type": "csv"}, headers=headers)
    assert rep_csv.status_code == 201
    dl_csv = await client.get(f"/api/v1/reports/{rep_csv.json()['data']['id']}/download", headers=headers)
    assert dl_csv.status_code == 200
    assert "Architecture,Metric,Value" in dl_csv.text

    exp_runs = await client.get(f"/api/v1/experiments/{exp_id}/runs", headers=headers)
    assert exp_runs.status_code == 200
    assert [r["id"] for r in exp_runs.json()["data"]] == [str(run_id)]

    manual_ns = await client.get(
        f"/api/v1/projects/{project_id}/memory-namespaces?include_run_namespaces=false",
        headers=headers,
    )
    assert manual_ns.status_code == 200 and manual_ns.json()["data"] == []
    run_ns = await client.get(
        f"/api/v1/projects/{project_id}/memory-namespaces?include_run_namespaces=true",
        headers=headers,
    )
    assert len(run_ns.json()["data"]) == 4
    assert all(ns["run_id"] == str(run_id) for ns in run_ns.json()["data"])

    results_resp = await client.get(f"/api/v1/runs/{run_id}/results", headers=headers)
    assert results_resp.status_code == 200
    assert results_resp.json()["data"][0]["expected_answer_snapshot"] is not None
    assert results_resp.json()["data"][0]["created_at"] is not None

    failures_resp = await client.get(f"/api/v1/runs/{run_id}/failures", headers=headers)
    assert failures_resp.status_code == 200
    first_fail = failures_resp.json()["data"][0]
    assert {"task_result_id", "task_key", "category", "expected_answer", "retrieved_memory_ids"}.issubset(
        first_fail.keys()
    )

    run_reports = await client.get(f"/api/v1/runs/{run_id}/reports", headers=headers)
    proj_reports = await client.get(f"/api/v1/projects/{project_id}/reports", headers=headers)
    assert run_reports.status_code == 200 and len(run_reports.json()["data"]) == 2
    assert proj_reports.status_code == 200 and len(proj_reports.json()["data"]) == 2

    # Cross-user 404 isolation on new list endpoints
    intruder_token = await _register_and_login(client, f"intruder_{uuid.uuid4()}@example.com")
    intruder_headers = {"Authorization": f"Bearer {intruder_token}"}
    intruder_me = await client.get("/api/v1/auth/me", headers=intruder_headers)
    cleanup_users.append(uuid.UUID(intruder_me.json()["data"]["id"]))

    assert (await client.get(f"/api/v1/experiments/{exp_id}/runs", headers=intruder_headers)).status_code == 404
    assert (await client.get(f"/api/v1/runs/{run_id}/reports", headers=intruder_headers)).status_code == 404
    assert (await client.get(f"/api/v1/projects/{project_id}/reports", headers=intruder_headers)).status_code == 404


@pytest.mark.asyncio
async def test_benchmark_runner_fault_isolation_and_cancellation(client, db_session, cleanup_users, monkeypatch):
    user = User(email=f"runner_ops_{uuid.uuid4()}@example.com", password_hash=get_password_hash("Pass1234!"))
    db_session.add(user)
    await db_session.flush()
    cleanup_users.append(user.id)

    login = await client.post("/api/v1/auth/login", json={"email": user.email, "password": "Pass1234!"})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    project = Project(owner_id=user.id, name="Runner Hardening Project")
    db_session.add(project)
    await db_session.flush()

    ds = BenchmarkDataset(project_id=project.id, name="Fault Suite", task_count=2)
    db_session.add(ds)
    await db_session.flush()

    for key, lang in [("T1", "Python"), ("T2", "Rust")]:
        db_session.add(
            BenchmarkTask(
                dataset_id=ds.id,
                task_key=key,
                category="fact_retrieval",
                conversation_sequence=[{"sequence_number": 1, "role": "user", "content": f"User prefers {lang}.", "is_evidence": True}],
                evaluation_query={"operation": "retrieve", "question": "What does User prefer?"},
                expected_answer={"answer": lang, "accepted_answers": [lang]},
            )
        )

    exp = Experiment(
        project_id=project.id,
        dataset_id=ds.id,
        name="Fault Isolation Exp",
        configuration={"architectures": ["vector"], "llm_provider": "mock", "num_trials": 1},
    )
    db_session.add(exp)
    await db_session.flush()

    # 1. Pending run cancellation check
    ns_cancel = MemoryNamespace(project_id=project.id, architecture_type="vector", name="cancel_ns", config={})
    db_session.add(ns_cancel)
    await db_session.flush()
    cancel_run = ExperimentRun(experiment_id=exp.id, run_number=1, status="pending")
    db_session.add(cancel_run)
    await db_session.flush()
    ra_cancel = RunArchitecture(run_id=cancel_run.id, namespace_id=ns_cancel.id, architecture_type="vector", configuration={}, status="pending")
    db_session.add(ra_cancel)
    await db_session.commit()

    c_resp = await client.post(f"/api/v1/runs/{cancel_run.id}/cancel", headers=headers)
    assert c_resp.status_code == 200
    assert c_resp.json()["data"]["status"] == "cancelled"
    await BenchmarkRunner(db_session).execute_run(cancel_run.id)
    await db_session.refresh(cancel_run)
    assert cancel_run.status == "cancelled"

    # 2. Task-level fault isolation: fail on first LLM call, recover cleanly for task 2
    orig_generate = MockLLMAdapter.generate
    call_count = 0

    async def flaky_generate(self, prompt: str, system_prompt: str | None = None, max_tokens: int = 512, temperature: float = 0.0):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("Simulated LLM failure")
        return await orig_generate(self, prompt, system_prompt, max_tokens, temperature)

    monkeypatch.setattr(MockLLMAdapter, "generate", flaky_generate)

    ns_fault = MemoryNamespace(project_id=project.id, architecture_type="vector", name="fault_ns", config={})
    db_session.add(ns_fault)
    await db_session.flush()
    fault_run = ExperimentRun(experiment_id=exp.id, run_number=2, status="pending")
    db_session.add(fault_run)
    await db_session.flush()
    db_session.add(
        RunArchitecture(run_id=fault_run.id, namespace_id=ns_fault.id, architecture_type="vector", configuration={}, status="pending")
    )
    await db_session.commit()

    await BenchmarkRunner(db_session).execute_run(fault_run.id)
    await db_session.refresh(fault_run)
    assert fault_run.status == "completed"

    res_list = await client.get(f"/api/v1/runs/{fault_run.id}/results", headers=headers)
    statuses = sorted(r["task_status"] for r in res_list.json()["data"])
    assert statuses == ["error", "success"]

    fail_list = await client.get(f"/api/v1/runs/{fault_run.id}/failures", headers=headers)
    assert any(f["failure_classification"] == "Execution Failure" for f in fail_list.json()["data"])