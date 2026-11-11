import asyncio
import csv
import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, get_project_for_user
from app.benchmark.runner import BenchmarkRunner
from app.core.exceptions import (
    ArchitectureUnsupportedException,
    ExperimentBusyException,
    NotFoundException,
)
from app.database.connection import AsyncSessionLocal, get_db
from app.database.models.benchmark import BenchmarkDataset, BenchmarkTask
from app.database.models.evaluation import ExecutionTrace, MetricResult, Report, TaskResult
from app.database.models.experiment import Experiment, ExperimentRun, RunArchitecture
from app.database.models.memory import MemoryNamespace
from app.database.models.user import Project, User
from app.evaluation.stats import StatisticalAnalyzer
from app.schemas.benchmark import (
    ExecutionTraceResponse,
    ExperimentCreate,
    ExperimentResponse,
    ExperimentUpdate,
    MetricResultResponse,
    ReportCreateRequest,
    ReportResponse,
    RunArchitectureResponse,
    RunResponse,
    RunStartRequest,
    TaskResultResponse,
)
from app.schemas.common import APIResponse

router = APIRouter(tags=["Experiments, Analytics & Reports"])
SUPPORTED_ARCHS = {"history", "vector", "structured", "hybrid"}
REPORTS_DIR = Path(__file__).resolve().parents[4] / "experiment-artifacts" / "reports"


def _write_json_report(file_path: Path, payload_data: dict[str, Any]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("w", encoding="utf-8") as f:
        json.dump(payload_data, f, indent=2, default=str)


def _write_csv_report(
    file_path: Path,
    architectures: dict[str, Any],
    stats_data: dict[str, Any],
    failure_summary: dict[str, dict[str, int]],
) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Architecture", "Metric", "Value"])
        for arch, metrics in architectures.items():
            for m_name, val in metrics.items():
                if m_name != "categories":
                    writer.writerow([arch, m_name, val])
                else:
                    for cat, c_val in val.items():
                        writer.writerow([arch, f"category_{cat}", c_val])
        for arch, ci in stats_data.get("descriptive_ci_95", {}).items():
            writer.writerow([arch, "ci_95_low", ci.get("ci_low", 0.0)])
            writer.writerow([arch, "ci_95_high", ci.get("ci_high", 0.0)])
        for arch, counts in failure_summary.items():
            for label, cnt in counts.items():
                writer.writerow([arch, f"failure_{label}", cnt])


async def _run_benchmark_background(run_id: uuid.UUID) -> None:
    """Opens a dedicated background async session for long-running benchmark execution."""
    async with AsyncSessionLocal() as bg_db:
        runner = BenchmarkRunner(bg_db)
        await runner.execute_run(run_id)


async def _get_owned_experiment(experiment_id: uuid.UUID, db: AsyncSession, current_user: User) -> Experiment:
    stmt = (
        select(Experiment)
        .join(Project, Experiment.project_id == Project.id)
        .where(Experiment.id == experiment_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    exp = res.scalars().first()
    if not exp:
        raise NotFoundException("Experiment not found or access denied.")
    return exp


async def _get_owned_run(run_id: uuid.UUID, db: AsyncSession, current_user: User) -> tuple[ExperimentRun, Experiment]:
    stmt = (
        select(ExperimentRun, Experiment)
        .join(Experiment, ExperimentRun.experiment_id == Experiment.id)
        .join(Project, Experiment.project_id == Project.id)
        .where(ExperimentRun.id == run_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        raise NotFoundException("Experiment run not found or access denied.")
    return row[0], row[1]


@router.post("/projects/{project_id}/experiments", response_model=APIResponse[ExperimentResponse], status_code=status.HTTP_201_CREATED)
async def create_experiment(
    payload: ExperimentCreate,
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
):
    for arch in payload.architectures:
        if arch not in SUPPORTED_ARCHS:
            raise ArchitectureUnsupportedException(arch)

    ds_res = await db.execute(
        select(BenchmarkDataset).where(BenchmarkDataset.id == payload.dataset_id, BenchmarkDataset.project_id == project.id)
    )
    if not ds_res.scalars().first():
        raise NotFoundException("Dataset not found in this project.")

    config = {
        "architectures": payload.architectures,
        "llm_provider": payload.llm_provider,
        "llm_model": payload.llm_model,
        "num_trials": payload.num_trials,
        "temperature": payload.temperature,
        "max_tokens": payload.max_tokens,
        "architecture_configs": payload.architecture_configs,
    }
    exp = Experiment(
        project_id=project.id,
        dataset_id=payload.dataset_id,
        name=payload.name,
        description=payload.description,
        configuration=config,
        status="configured",
    )
    db.add(exp)
    await db.commit()
    await db.refresh(exp)
    return APIResponse(message="Experiment created", data=ExperimentResponse.model_validate(exp))


@router.get("/projects/{project_id}/experiments", response_model=APIResponse[list[ExperimentResponse]])
async def list_experiments(project: Project = Depends(get_project_for_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Experiment).where(Experiment.project_id == project.id).order_by(Experiment.created_at.desc()))
    return APIResponse(message="Experiments retrieved", data=[ExperimentResponse.model_validate(e) for e in res.scalars().all()])


@router.get("/experiments/{experiment_id}", response_model=APIResponse[ExperimentResponse])
async def get_experiment(
    experiment_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    exp = await _get_owned_experiment(experiment_id, db, current_user)
    return APIResponse(message="Experiment retrieved", data=ExperimentResponse.model_validate(exp))


@router.patch("/experiments/{experiment_id}", response_model=APIResponse[ExperimentResponse])
async def update_experiment(
    experiment_id: uuid.UUID,
    payload: ExperimentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exp = await _get_owned_experiment(experiment_id, db, current_user)
    if payload.name is not None:
        exp.name = payload.name
    if payload.description is not None:
        exp.description = payload.description
    await db.commit()
    await db.refresh(exp)
    return APIResponse(message="Experiment updated", data=ExperimentResponse.model_validate(exp))


@router.delete("/experiments/{experiment_id}", response_model=APIResponse[dict[str, str]])
async def delete_experiment(
    experiment_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    exp = await _get_owned_experiment(experiment_id, db, current_user)
    await db.delete(exp)
    await db.commit()
    return APIResponse(message="Experiment deleted", data={"deleted_id": str(experiment_id)})


@router.post("/experiments/{experiment_id}/runs", response_model=APIResponse[RunResponse], status_code=status.HTTP_202_ACCEPTED)
async def start_experiment_run(
    experiment_id: uuid.UUID,
    payload: RunStartRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exp = await _get_owned_experiment(experiment_id, db, current_user)
    max_run_res = await db.execute(
        select(func.coalesce(func.max(ExperimentRun.run_number), 0)).where(
            ExperimentRun.experiment_id == exp.id
        )
    )
    next_run_num = int(max_run_res.scalar() or 0) + 1

    run = ExperimentRun(
        experiment_id=exp.id,
        run_number=next_run_num,
        status="pending",
        random_seed=payload.random_seed,
    )
    db.add(run)
    await db.flush()

    archs = exp.configuration.get("architectures", ["history", "vector", "structured", "hybrid"])
    arch_configs = exp.configuration.get("architecture_configs", {})

    for arch in archs:
        cfg = arch_configs.get(arch, {})
        ns = MemoryNamespace(
            project_id=exp.project_id,
            run_id=run.id,
            architecture_type=arch,
            name=f"run_{run.run_number}_{arch}",
            config=cfg,
        )
        db.add(ns)
        await db.flush()

        db.add(
            RunArchitecture(
                run_id=run.id,
                namespace_id=ns.id,
                architecture_type=arch,
                configuration=cfg,
                status="pending",
            )
        )

    await db.commit()
    await db.refresh(run)

    background_tasks.add_task(_run_benchmark_background, run.id)
    return APIResponse(message="Benchmark run queued and started", data=RunResponse.model_validate(run))


@router.get("/runs/{run_id}", response_model=APIResponse[RunResponse])
async def get_run_status(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    return APIResponse(message="Run status retrieved", data=RunResponse.model_validate(run))


@router.get("/experiments/{experiment_id}/runs", response_model=APIResponse[list[RunResponse]])
async def list_experiment_runs(
    experiment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exp = await _get_owned_experiment(experiment_id, db, current_user)
    res = await db.execute(
        select(ExperimentRun)
        .where(ExperimentRun.experiment_id == exp.id)
        .order_by(ExperimentRun.run_number.desc())
    )
    return APIResponse(
        message="Experiment runs retrieved",
        data=[RunResponse.model_validate(r) for r in res.scalars().all()],
    )


@router.post("/runs/{run_id}/cancel", response_model=APIResponse[RunResponse])
async def cancel_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    if run.status in ("completed", "failed", "cancelled"):
        raise ExperimentBusyException(f"Cannot cancel run already in '{run.status}' state.")
    run.status = "cancelled"

    pending_res = await db.execute(
        select(RunArchitecture).where(RunArchitecture.run_id == run.id, RunArchitecture.status == "pending")
    )
    for ra in pending_res.scalars().all():
        ra.status = "cancelled"

    await db.commit()
    await db.refresh(run)
    return APIResponse(message="Run cancelled", data=RunResponse.model_validate(run))


@router.get("/runs/{run_id}/architectures", response_model=APIResponse[list[RunArchitectureResponse]])
async def list_run_architectures(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    res = await db.execute(select(RunArchitecture).where(RunArchitecture.run_id == run.id))
    return APIResponse(message="Run architectures retrieved", data=[RunArchitectureResponse.model_validate(ra) for ra in res.scalars().all()])


@router.get("/runs/{run_id}/configuration", response_model=APIResponse[dict[str, Any]])
async def get_run_configuration(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, exp = await _get_owned_run(run_id, db, current_user)
    arch_res = await db.execute(
        select(RunArchitecture).where(RunArchitecture.run_id == run.id).order_by(RunArchitecture.created_at.asc())
    )
    frozen_architectures = [
        {
            "architecture_type": ra.architecture_type,
            "namespace_id": str(ra.namespace_id),
            "configuration": ra.configuration,
            "status": ra.status,
        }
        for ra in arch_res.scalars().all()
    ]
    return APIResponse(
        message="Run configuration snapshot",
        data={
            "run_id": str(run.id),
            "run_number": run.run_number,
            "random_seed": run.random_seed,
            "software_version": run.software_version,
            "architectures": frozen_architectures,
            "experiment_config": exp.configuration,
        },
    )


@router.get("/runs/{run_id}/results", response_model=APIResponse[list[TaskResultResponse]])
async def get_run_results(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    res = await db.execute(select(TaskResult).where(TaskResult.run_id == run.id).order_by(TaskResult.created_at.asc()))
    return APIResponse(message="Task results retrieved", data=[TaskResultResponse.model_validate(tr) for tr in res.scalars().all()])


@router.get("/runs/{run_id}/metrics", response_model=APIResponse[list[MetricResultResponse]])
async def get_run_metrics(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    stmt = (
        select(MetricResult)
        .join(RunArchitecture, MetricResult.run_architecture_id == RunArchitecture.id)
        .where(RunArchitecture.run_id == run.id)
    )
    res = await db.execute(stmt)
    return APIResponse(message="Run metrics retrieved", data=[MetricResultResponse.model_validate(m) for m in res.scalars().all()])


@router.get("/runs/{run_id}/comparison", response_model=APIResponse[dict[str, Any]])
async def compare_architectures(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Produces a clean side-by-side comparison matrix across all evaluated architectures."""
    run, _ = await _get_owned_run(run_id, db, current_user)
    arch_res = await db.execute(select(RunArchitecture).where(RunArchitecture.run_id == run.id))
    run_archs = arch_res.scalars().all()

    comparison: dict[str, Any] = {}
    for ra in run_archs:
        m_res = await db.execute(select(MetricResult).where(MetricResult.run_architecture_id == ra.id))
        metrics_data: dict[str, Any] = {"categories": {}}
        for m in m_res.scalars().all():
            if m.category:
                metrics_data["categories"][m.category] = float(m.metric_value)
            else:
                metrics_data[m.metric_name] = float(m.metric_value)
        comparison[ra.architecture_type] = metrics_data

    return APIResponse(message="Architecture comparison generated", data={"run_id": str(run.id), "status": run.status, "architectures": comparison})


@router.get("/runs/{run_id}/statistics", response_model=APIResponse[dict[str, Any]])
async def get_run_statistics(
    run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """Calculates 95% confidence intervals and pairwise significance tests (t-test, Wilcoxon, Cohen's d)."""
    run, _ = await _get_owned_run(run_id, db, current_user)
    stmt = (
        select(RunArchitecture.architecture_type, TaskResult)
        .join(TaskResult, TaskResult.run_architecture_id == RunArchitecture.id)
        .where(RunArchitecture.run_id == run.id)
    )
    res = await db.execute(stmt)
    arch_results: dict[str, dict[str, float]] = {}
    for arch_type, tr in res.all():
        key = f"{tr.task_id}_{tr.trial_number}"
        arch_results.setdefault(arch_type, {})[key] = 1.0 if tr.is_correct else 0.0

    analysis = StatisticalAnalyzer.analyze_run(arch_results)
    return APIResponse(message="Statistical significance analysis completed", data=analysis)


@router.get("/runs/{run_id}/metrics/by-category", response_model=APIResponse[dict[str, Any]])
async def get_metrics_by_category(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    stmt = (
        select(RunArchitecture.architecture_type, MetricResult)
        .join(MetricResult, MetricResult.run_architecture_id == RunArchitecture.id)
        .where(RunArchitecture.run_id == run.id, MetricResult.category.isnot(None))
    )
    res = await db.execute(stmt)
    breakdown: dict[str, dict[str, float]] = {}
    for arch_type, metric in res.all():
        if not metric.category:
            continue
        breakdown.setdefault(metric.category, {})[arch_type] = float(metric.metric_value)
    return APIResponse(message="Category metrics retrieved", data=breakdown)


@router.get("/runs/{run_id}/failures", response_model=APIResponse[list[dict[str, Any]]])
async def get_failure_analysis(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run, _ = await _get_owned_run(run_id, db, current_user)
    stmt = (
        select(
            RunArchitecture.architecture_type,
            TaskResult,
            BenchmarkTask.task_key,
            BenchmarkTask.category,
        )
        .join(RunArchitecture, TaskResult.run_architecture_id == RunArchitecture.id)
        .join(BenchmarkTask, TaskResult.task_id == BenchmarkTask.id)
        .where(TaskResult.run_id == run.id, TaskResult.is_correct.is_(False))
        .order_by(TaskResult.created_at.asc())
    )
    res = await db.execute(stmt)
    failures = [
        {
            "task_result_id": str(tr.id),
            "architecture": arch_type,
            "task_id": str(tr.task_id),
            "task_key": task_key,
            "category": category,
            "failure_classification": tr.evaluation_details.get("failure_classification", "Unknown"),
            "expected_answer": tr.expected_answer_snapshot,
            "generated_answer": tr.generated_answer,
            "retrieved_memory_ids": tr.retrieved_memory_ids or [],
            "evaluation_details": tr.evaluation_details,
        }
        for arch_type, tr, task_key, category in res.all()
    ]
    return APIResponse(message="Failure analysis retrieved", data=failures)


@router.get("/runs/{run_id}/traces", response_model=APIResponse[list[ExecutionTraceResponse]])
async def list_traces(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    res = await db.execute(select(ExecutionTrace).where(ExecutionTrace.run_id == run.id).order_by(ExecutionTrace.created_at.asc()))
    return APIResponse(message="Execution traces retrieved", data=[ExecutionTraceResponse.model_validate(t) for t in res.scalars().all()])


@router.get("/traces/{trace_id}", response_model=APIResponse[ExecutionTraceResponse])
async def get_trace(trace_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    stmt = (
        select(ExecutionTrace)
        .join(ExperimentRun, ExecutionTrace.run_id == ExperimentRun.id)
        .join(Experiment, ExperimentRun.experiment_id == Experiment.id)
        .join(Project, Experiment.project_id == Project.id)
        .where(ExecutionTrace.id == trace_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    trace = res.scalars().first()
    if not trace:
        raise NotFoundException("Trace not found or access denied.")
    return APIResponse(message="Trace details retrieved", data=ExecutionTraceResponse.model_validate(trace))


@router.post("/runs/{run_id}/reports", response_model=APIResponse[ReportResponse], status_code=status.HTTP_201_CREATED)
async def generate_report(
    run_id: uuid.UUID,
    payload: ReportCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run, exp = await _get_owned_run(run_id, db, current_user)
    report_id = uuid.uuid4()
    ext = payload.report_type
    file_path = REPORTS_DIR / f"report_{run.id}_{report_id}.{ext}"

    comp_resp = await compare_architectures(run_id=run.id, db=db, current_user=current_user)
    stats_resp = await get_run_statistics(run_id=run.id, db=db, current_user=current_user)
    failures_resp = await get_failure_analysis(run_id=run.id, db=db, current_user=current_user)
    config_resp = await get_run_configuration(run_id=run.id, db=db, current_user=current_user)

    comp_data = comp_resp.data or {"run_id": str(run.id), "status": run.status, "architectures": {}}
    stats_data = stats_resp.data or {}
    failures_data = failures_resp.data or []
    config_data = config_resp.data or {}

    failure_summary: dict[str, dict[str, int]] = {}
    for item in failures_data:
        arch = str(item.get("architecture", "unknown"))
        label = str(item.get("failure_classification", "Unknown"))
        arch_bucket = failure_summary.setdefault(arch, {})
        arch_bucket[label] = arch_bucket.get(label, 0) + 1

    if ext == "json":
        report_payload = {
            **comp_data,
            "experiment_id": str(exp.id),
            "experiment_name": exp.name,
            "run_number": run.run_number,
            "random_seed": run.random_seed,
            "software_version": run.software_version,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "configuration": config_data,
            "statistical_analysis": stats_data,
            "failure_summary": failure_summary,
            "failures": failures_data,
        }
        await asyncio.to_thread(_write_json_report, file_path, report_payload)
    else:
        await asyncio.to_thread(
            _write_csv_report,
            file_path,
            comp_data.get("architectures", {}),
            stats_data,
            failure_summary,
        )

    report = Report(
        id=report_id,
        project_id=exp.project_id,
        run_id=run.id,
        report_type=ext,
        file_location=str(file_path),
        status="completed",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return APIResponse(message="Report generated successfully", data=ReportResponse.model_validate(report))


@router.get("/projects/{project_id}/reports", response_model=APIResponse[list[ReportResponse]])
async def list_project_reports(
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Report)
        .where(Report.project_id == project.id)
        .order_by(Report.created_at.desc())
    )
    return APIResponse(
        message="Project reports retrieved",
        data=[ReportResponse.model_validate(r) for r in res.scalars().all()],
    )


@router.get("/runs/{run_id}/reports", response_model=APIResponse[list[ReportResponse]])
async def list_run_reports(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run, _ = await _get_owned_run(run_id, db, current_user)
    res = await db.execute(
        select(Report)
        .where(Report.run_id == run.id)
        .order_by(Report.created_at.desc())
    )
    return APIResponse(
        message="Run reports retrieved",
        data=[ReportResponse.model_validate(r) for r in res.scalars().all()],
    )

    
@router.get("/reports/{report_id}", response_model=APIResponse[ReportResponse])
async def get_report(report_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    stmt = (
        select(Report)
        .join(Project, Report.project_id == Project.id)
        .where(Report.id == report_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    report = res.scalars().first()
    if not report:
        raise NotFoundException("Report not found or access denied.")
    return APIResponse(message="Report metadata retrieved", data=ReportResponse.model_validate(report))


@router.get("/reports/{report_id}/download")
async def download_report(report_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    stmt = (
        select(Report)
        .join(Project, Report.project_id == Project.id)
        .where(Report.id == report_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    report = res.scalars().first()
    if not report or not report.file_location:
        raise NotFoundException("Report file not found.")

    file_path = Path(report.file_location)
    exists = await asyncio.to_thread(file_path.exists)
    if not exists:
        raise NotFoundException("Report file not found.")

    media = "application/json" if report.report_type == "json" else "text/csv"
    return FileResponse(path=str(file_path), media_type=media, filename=file_path.name)