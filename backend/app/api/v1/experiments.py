import csv
import io
import json
import os
import uuid
from typing import Any, Dict, List
from fastapi import APIRouter, BackgroundTasks, Depends, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.evaluation.stats import StatisticalAnalyzer
from app.api.dependencies import get_current_user, get_project_for_user
from app.benchmark.runner import BenchmarkRunner
from app.core.exceptions import ArchitectureUnsupportedException, ExperimentBusyException, NotFoundException
from app.database.connection import AsyncSessionLocal, get_db
from app.database.models.benchmark import BenchmarkDataset
from app.database.models.evaluation import ExecutionTrace, MetricResult, Report, TaskResult
from app.database.models.experiment import Experiment, ExperimentRun, RunArchitecture
from app.database.models.memory import MemoryNamespace
from app.database.models.user import Project, User
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


@router.get("/projects/{project_id}/experiments", response_model=APIResponse[List[ExperimentResponse]])
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


@router.delete("/experiments/{experiment_id}", response_model=APIResponse[dict])
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
    count_res = await db.execute(select(func.count(ExperimentRun.id)).where(ExperimentRun.experiment_id == exp.id))
    next_run_num = (count_res.scalar() or 0) + 1

    run = ExperimentRun(
        experiment_id=exp.id,
        run_number=next_run_num,
        status="pending",
        random_seed=payload.random_seed,
    )
    db.add(run)
    await db.flush()

    # Create isolated MemoryNamespace and RunArchitecture for each selected architecture
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

    # Dispatch execution asynchronously
    background_tasks.add_task(_run_benchmark_background, run.id)
    return APIResponse(message="Benchmark run queued and started", data=RunResponse.model_validate(run))


@router.get("/runs/{run_id}", response_model=APIResponse[RunResponse])
async def get_run_status(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    return APIResponse(message="Run status retrieved", data=RunResponse.model_validate(run))


@router.post("/runs/{run_id}/cancel", response_model=APIResponse[RunResponse])
async def cancel_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    if run.status in ("completed", "failed", "cancelled"):
        raise ExperimentBusyException(f"Cannot cancel run already in '{run.status}' state.")
    run.status = "cancelled"
    await db.commit()
    await db.refresh(run)
    return APIResponse(message="Run cancelled", data=RunResponse.model_validate(run))


@router.get("/runs/{run_id}/architectures", response_model=APIResponse[List[RunArchitectureResponse]])
async def list_run_architectures(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    res = await db.execute(select(RunArchitecture).where(RunArchitecture.run_id == run.id))
    return APIResponse(message="Run architectures retrieved", data=[RunArchitectureResponse.model_validate(ra) for ra in res.scalars().all()])


@router.get("/runs/{run_id}/configuration", response_model=APIResponse[Dict[str, Any]])
async def get_run_configuration(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, exp = await _get_owned_run(run_id, db, current_user)
    return APIResponse(
        message="Run configuration snapshot",
        data={"run_id": str(run.id), "random_seed": run.random_seed, "software_version": run.software_version, "experiment_config": exp.configuration},
    )


@router.get("/runs/{run_id}/results", response_model=APIResponse[List[TaskResultResponse]])
async def get_run_results(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    res = await db.execute(select(TaskResult).where(TaskResult.run_id == run.id).order_by(TaskResult.created_at.asc()))
    return APIResponse(message="Task results retrieved", data=[TaskResultResponse.model_validate(tr) for tr in res.scalars().all()])


@router.get("/runs/{run_id}/metrics", response_model=APIResponse[List[MetricResultResponse]])
async def get_run_metrics(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    stmt = (
        select(MetricResult)
        .join(RunArchitecture, MetricResult.run_architecture_id == RunArchitecture.id)
        .where(RunArchitecture.run_id == run.id)
    )
    res = await db.execute(stmt)
    return APIResponse(message="Run metrics retrieved", data=[MetricResultResponse.model_validate(m) for m in res.scalars().all()])


@router.get("/runs/{run_id}/comparison", response_model=APIResponse[Dict[str, Any]])
async def compare_architectures(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Produces a clean side-by-side comparison matrix across all evaluated architectures."""
    run, _ = await _get_owned_run(run_id, db, current_user)
    arch_res = await db.execute(select(RunArchitecture).where(RunArchitecture.run_id == run.id))
    run_archs = arch_res.scalars().all()

    comparison: Dict[str, Any] = {}
    for ra in run_archs:
        m_res = await db.execute(select(MetricResult).where(MetricResult.run_architecture_id == ra.id))
        metrics_data: Dict[str, Any] = {"categories": {}}
        for m in m_res.scalars().all():
            if m.category:
                metrics_data["categories"][m.category] = float(m.metric_value)
            else:
                metrics_data[m.metric_name] = float(m.metric_value)
        comparison[ra.architecture_type] = metrics_data

    return APIResponse(message="Architecture comparison generated", data={"run_id": str(run.id), "status": run.status, "architectures": comparison})


@router.get("/runs/{run_id}/statistics", response_model=APIResponse[Dict[str, Any]])
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
    arch_results: Dict[str, Dict[str, float]] = {}
    for arch_type, tr in res.all():
        key = f"{tr.task_id}_{tr.trial_number}"
        arch_results.setdefault(arch_type, {})[key] = 1.0 if tr.is_correct else 0.0

    analysis = StatisticalAnalyzer.analyze_run(arch_results)
    return APIResponse(message="Statistical significance analysis completed", data=analysis)

    
@router.get("/runs/{run_id}/metrics/by-category", response_model=APIResponse[Dict[str, Any]])
async def get_metrics_by_category(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    stmt = (
        select(RunArchitecture.architecture_type, MetricResult)
        .join(MetricResult, MetricResult.run_architecture_id == RunArchitecture.id)
        .where(RunArchitecture.run_id == run.id, MetricResult.category.isnot(None))
    )
    res = await db.execute(stmt)
    breakdown: Dict[str, Dict[str, float]] = {}
    for arch_type, metric in res.all():
        breakdown.setdefault(metric.category, {})[arch_type] = float(metric.metric_value)
    return APIResponse(message="Category metrics retrieved", data=breakdown)


@router.get("/runs/{run_id}/failures", response_model=APIResponse[List[Dict[str, Any]]])
async def get_failure_analysis(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    run, _ = await _get_owned_run(run_id, db, current_user)
    stmt = (
        select(RunArchitecture.architecture_type, TaskResult)
        .join(RunArchitecture, TaskResult.run_architecture_id == RunArchitecture.id)
        .where(TaskResult.run_id == run.id, TaskResult.is_correct.is_(False))
    )
    res = await db.execute(stmt)
    failures = [
        {
            "architecture": arch_type,
            "task_id": str(tr.task_id),
            "failure_classification": tr.evaluation_details.get("failure_classification", "Unknown"),
            "generated_answer": tr.generated_answer,
            "evaluation_details": tr.evaluation_details,
        }
        for arch_type, tr in res.all()
    ]
    return APIResponse(message="Failure analysis retrieved", data=failures)


@router.get("/runs/{run_id}/traces", response_model=APIResponse[List[ExecutionTraceResponse]])
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
    reports_dir = os.path.abspath(os.path.join(os.getcwd(), "..", "experiment-artifacts", "reports"))
    os.makedirs(reports_dir, exist_ok=True)
    report_id = uuid.uuid4()
    ext = payload.report_type
    file_path = os.path.join(reports_dir, f"report_{run.id}_{report_id}.{ext}")

    # Collect comparison metrics & task results
    comp_resp = await compare_architectures(run_id=run.id, db=db, current_user=current_user)
    if ext == "json":
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(comp_resp.data, f, indent=2)
    else:
        with open(file_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Architecture", "Metric", "Value"])
            for arch, metrics in comp_resp.data["architectures"].items():
                for m_name, val in metrics.items():
                    if m_name != "categories":
                        writer.writerow([arch, m_name, val])
                    else:
                        for cat, c_val in val.items():
                            writer.writerow([arch, f"category_{cat}", c_val])

    report = Report(
        id=report_id,
        project_id=exp.project_id,
        run_id=run.id,
        report_type=ext,
        file_location=file_path,
        status="completed",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return APIResponse(message="Report generated successfully", data=ReportResponse.model_validate(report))


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
    if not report or not report.file_location or not os.path.exists(report.file_location):
        raise NotFoundException("Report file not found.")

    media = "application/json" if report.report_type == "json" else "text/csv"
    return FileResponse(path=report.file_location, media_type=media, filename=os.path.basename(report.file_location))