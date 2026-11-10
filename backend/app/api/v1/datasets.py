import uuid
from typing import Any

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, get_project_for_user
from app.benchmark.generator import SyntheticBenchmarkGenerator
from app.benchmark.schemas import BenchmarkTaskSchema
from app.core.exceptions import NotFoundException
from app.database.connection import get_db
from app.database.models.benchmark import BenchmarkDataset, BenchmarkTask
from app.database.models.user import Project, User
from app.schemas.benchmark import (
    BulkTaskImportRequest,
    DatasetCreate,
    DatasetResponse,
    SyntheticGenerateRequest,
    TaskResponse,
)
from app.schemas.common import APIResponse

router = APIRouter(tags=["Benchmark Datasets"])


async def _get_owned_dataset(dataset_id: uuid.UUID, db: AsyncSession, current_user: User) -> BenchmarkDataset:
    stmt = (
        select(BenchmarkDataset)
        .join(Project, BenchmarkDataset.project_id == Project.id)
        .where(BenchmarkDataset.id == dataset_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    ds = res.scalars().first()
    if not ds:
        raise NotFoundException("Benchmark dataset not found or access denied.")
    return ds


@router.post("/projects/{project_id}/datasets", response_model=APIResponse[DatasetResponse], status_code=status.HTTP_201_CREATED)
async def create_dataset(
    payload: DatasetCreate,
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
):
    ds = BenchmarkDataset(
        project_id=project.id,
        name=payload.name,
        version=payload.version,
        description=payload.description,
        is_public=payload.is_public,
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return APIResponse(message="Dataset created successfully", data=DatasetResponse.model_validate(ds))


@router.get("/projects/{project_id}/datasets", response_model=APIResponse[list[DatasetResponse]])
async def list_datasets(project: Project = Depends(get_project_for_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(BenchmarkDataset).where(BenchmarkDataset.project_id == project.id))
    return APIResponse(message="Datasets retrieved", data=[DatasetResponse.model_validate(d) for d in res.scalars().all()])


@router.get("/datasets/{dataset_id}", response_model=APIResponse[DatasetResponse])
async def get_dataset(
    dataset_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    ds = await _get_owned_dataset(dataset_id, db, current_user)
    return APIResponse(message="Dataset retrieved", data=DatasetResponse.model_validate(ds))


@router.post("/datasets/{dataset_id}/tasks", response_model=APIResponse[TaskResponse], status_code=status.HTTP_201_CREATED)
async def add_task(
    dataset_id: uuid.UUID,
    payload: BenchmarkTaskSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ds = await _get_owned_dataset(dataset_id, db, current_user)
    task = BenchmarkTask(
        dataset_id=ds.id,
        task_key=payload.task_key,
        category=payload.category,
        difficulty=payload.difficulty,
        conversation_sequence=[m.model_dump() for m in payload.conversation_sequence],
        evaluation_query=payload.evaluation_query.model_dump(),
        expected_answer=payload.expected_answer.model_dump(),
        metadata_=payload.metadata,
    )
    db.add(task)
    ds.task_count += 1
    await db.commit()
    await db.refresh(task)
    return APIResponse(message="Benchmark task added", data=TaskResponse.model_validate(task))


@router.post("/datasets/{dataset_id}/tasks/import", response_model=APIResponse[dict[str, int]], status_code=status.HTTP_201_CREATED)
async def bulk_import_tasks(
    dataset_id: uuid.UUID,
    payload: BulkTaskImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ds = await _get_owned_dataset(dataset_id, db, current_user)
    for item in payload.tasks:
        db.add(
            BenchmarkTask(
                dataset_id=ds.id,
                task_key=item.task_key,
                category=item.category,
                difficulty=item.difficulty,
                conversation_sequence=[m.model_dump() for m in item.conversation_sequence],
                evaluation_query=item.evaluation_query.model_dump(),
                expected_answer=item.expected_answer.model_dump(),
                metadata_=item.metadata,
            )
        )
    ds.task_count += len(payload.tasks)
    await db.commit()
    return APIResponse(message="Tasks imported successfully", data={"imported_count": len(payload.tasks), "total_tasks": ds.task_count})


@router.post("/datasets/{dataset_id}/generate-synthetic", response_model=APIResponse[dict[str, Any]], status_code=status.HTTP_201_CREATED)
async def generate_synthetic_tasks(
    dataset_id: uuid.UUID,
    payload: SyntheticGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Automatically populates the dataset with synthetic benchmark tasks across all 6 categories."""
    ds = await _get_owned_dataset(dataset_id, db, current_user)
    generator = SyntheticBenchmarkGenerator(seed=payload.seed, distractor_count=payload.distractor_count)
    suite = generator.generate_suite(per_category=payload.tasks_per_category)

    for item in suite:
        db.add(
            BenchmarkTask(
                dataset_id=ds.id,
                task_key=item.task_key,
                category=item.category,
                difficulty=item.difficulty,
                conversation_sequence=[m.model_dump() for m in item.conversation_sequence],
                evaluation_query=item.evaluation_query.model_dump(),
                expected_answer=item.expected_answer.model_dump(),
                metadata_=item.metadata,
            )
        )
    ds.task_count += len(suite)
    await db.commit()
    return APIResponse(
        message="Synthetic 6-category benchmark suite generated",
        data={"generated_count": len(suite), "total_tasks": ds.task_count}
    )


@router.get("/datasets/{dataset_id}/tasks", response_model=APIResponse[list[TaskResponse]])
async def list_tasks(
    dataset_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    ds = await _get_owned_dataset(dataset_id, db, current_user)
    res = await db.execute(select(BenchmarkTask).where(BenchmarkTask.dataset_id == ds.id).order_by(BenchmarkTask.task_key))
    return APIResponse(message="Tasks retrieved", data=[TaskResponse.model_validate(t) for t in res.scalars().all()])


@router.post("/datasets/{dataset_id}/validate", response_model=APIResponse[dict[str, Any]])
async def validate_dataset(
    dataset_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    ds = await _get_owned_dataset(dataset_id, db, current_user)
    res = await db.execute(select(BenchmarkTask).where(BenchmarkTask.dataset_id == ds.id))
    tasks = res.scalars().all()
    categories: dict[str, int] = {}
    for t in tasks:
        categories[t.category] = categories.get(t.category, 0) + 1
    return APIResponse(
        message="Dataset validated",
        data={"valid": len(tasks) > 0, "task_count": len(tasks), "category_breakdown": categories},
    )