import uuid
import pytest


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

    # User A creates a project
    p_resp = await client.post(
        "/api/v1/projects",
        json={"name": "User A Confidential Project"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert p_resp.status_code == 201
    project_id = p_resp.json()["data"]["id"]

    # User B tries to access User A's project -> MUST BE DENIED (404 AM_ERR_NOT_FOUND)
    denied = await client.get(
        f"/api/v1/projects/{project_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert denied.status_code == 404
    assert denied.json()["success"] is False


@pytest.mark.asyncio
async def test_end_to_end_benchmark_pipeline(client, db_session, cleanup_users):
    email = f"researcher_{uuid.uuid4()}@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}

    me = await client.get("/api/v1/auth/me", headers=headers)
    cleanup_users.append(uuid.UUID(me.json()["data"]["id"]))

    # 1. Create Project
    proj = await client.post("/api/v1/projects", json={"name": "E2E Benchmark Project"}, headers=headers)
    project_id = proj.json()["data"]["id"]

    # 2. Create Dataset & Generate Synthetic 6-Category Suite (1 task per category = 6 tasks)
    ds = await client.post(f"/api/v1/projects/{project_id}/datasets", json={"name": "E2E Suite"}, headers=headers)
    dataset_id = ds.json()["data"]["id"]

    gen = await client.post(
        f"/api/v1/datasets/{dataset_id}/generate-synthetic",
        json={"tasks_per_category": 1, "distractor_count": 5},
        headers=headers,
    )
    assert gen.status_code == 201
    assert gen.json()["data"]["total_tasks"] == 6

    # 3. Create Experiment comparing all 4 architectures
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

     # 4. Trigger Run (FastAPI BackgroundTasks executes BenchmarkRunner automatically via ASGITransport)
    run_resp = await client.post(f"/api/v1/experiments/{exp_id}/runs", json={"random_seed": 42}, headers=headers)
    assert run_resp.status_code == 202
    run_id = uuid.UUID(run_resp.json()["data"]["id"])

    # 5. Fetch Side-by-Side Architecture Comparison
    comp = await client.get(f"/api/v1/runs/{run_id}/comparison", headers=headers)
    assert comp.status_code == 200
    comp_data = comp.json()["data"]
    assert comp_data["status"] == "completed"
    for arch in ["history", "vector", "structured", "hybrid"]:
        assert arch in comp_data["architectures"]
        assert "task_success_rate" in comp_data["architectures"][arch]

    stats_resp = await client.get(f"/api/v1/runs/{run_id}/statistics", headers=headers)
    assert stats_resp.status_code == 200
    assert "descriptive_ci_95" in stats_resp.json()["data"]
    assert "pairwise_comparisons" in stats_resp.json()["data"]

    # 6. Fetch Traces & Generate JSON Report
    traces = await client.get(f"/api/v1/runs/{run_id}/traces", headers=headers)
    assert traces.status_code == 200
    assert len(traces.json()["data"]) == 24  # 4 architectures x 6 tasks

    rep = await client.post(f"/api/v1/runs/{run_id}/reports", json={"report_type": "json"}, headers=headers)
    assert rep.status_code == 201
    report_id = rep.json()["data"]["id"]

    dl = await client.get(f"/api/v1/reports/{report_id}/download", headers=headers)
    assert dl.status_code == 200