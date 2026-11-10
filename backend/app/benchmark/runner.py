import random
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.context_builder import ContextBuilder
from app.core.logging import get_logger
from app.database.models.benchmark import BenchmarkTask
from app.database.models.evaluation import MetricResult, TaskResult
from app.database.models.experiment import Experiment, ExperimentRun, RunArchitecture
from app.evaluation.evaluator import GroundTruthEvaluator
from app.evaluation.metrics import MetricsCalculator
from app.llm.factory import get_llm_adapter
from app.memory.factory import get_memory_architecture
from app.memory.schemas import MemoryItem
from app.observability.trace_collector import TraceCollector

logger = get_logger(__name__)


@dataclass(slots=True)
class _TaskSnapshot:
    id: uuid.UUID
    task_key: str
    category: str
    conversation_sequence: list[dict[str, Any]]
    evaluation_query: dict[str, Any]
    expected_answer: dict[str, Any]


@dataclass(slots=True)
class _RunArchSnapshot:
    id: uuid.UUID
    architecture_type: str
    namespace_id: uuid.UUID
    configuration: dict[str, Any]


class BenchmarkRunner:
    """
    Core Benchmark Execution Engine (Benchmark Spec Section 8 & SAD Section 4.3).
    Executes an ExperimentRun across all configured RunArchitectures inside
    isolated memory namespaces, capturing execution traces, task outcomes,
    and aggregated evaluation metrics.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _is_run_cancelled(self, run_id: uuid.UUID) -> bool:
        status_val = (
            await self.db.execute(select(ExperimentRun.status).where(ExperimentRun.id == run_id))
        ).scalar_one_or_none()
        return status_val == "cancelled"

    async def execute_run(self, run_id: uuid.UUID) -> None:
        # 1. Load ExperimentRun and parent Experiment
        run_res = await self.db.execute(select(ExperimentRun).where(ExperimentRun.id == run_id))
        run = run_res.scalars().first()
        if not run:
            logger.error("ExperimentRun %s not found.", run_id)
            return
        if run.status in ("running", "completed", "cancelled"):
            logger.warning(
                "ExperimentRun %s is already '%s'. Skipping duplicate execution.", run_id, run.status
            )
            return

        exp_res = await self.db.execute(select(Experiment).where(Experiment.id == run.experiment_id))
        experiment = exp_res.scalars().first()
        if not experiment:
            run.status = "failed"
            run.error_message = "Parent experiment not found."
            await self.db.commit()
            return

        # 2. Load Benchmark Tasks and snapshot into pure Python objects before commits/rollbacks
        tasks_res = await self.db.execute(
            select(BenchmarkTask)
            .where(BenchmarkTask.dataset_id == experiment.dataset_id)
            .order_by(BenchmarkTask.task_key)
        )
        tasks = list(tasks_res.scalars().all())
        if not tasks:
            run.status = "failed"
            run.error_message = "Dataset contains no benchmark tasks."
            await self.db.commit()
            return

        task_snapshots = [
            _TaskSnapshot(
                id=t.id,
                task_key=t.task_key,
                category=t.category,
                conversation_sequence=[dict(turn) for turn in t.conversation_sequence],
                evaluation_query=dict(t.evaluation_query),
                expected_answer=dict(t.expected_answer),
            )
            for t in tasks
        ]

        # 3. Load and snapshot RunArchitectures
        arch_res = await self.db.execute(
            select(RunArchitecture).where(RunArchitecture.run_id == run.id)
        )
        arch_snapshots = [
            _RunArchSnapshot(
                id=ra.id,
                architecture_type=ra.architecture_type,
                namespace_id=ra.namespace_id,
                configuration=dict(ra.configuration or {}),
            )
            for ra in arch_res.scalars().all()
        ]

        exp_config = dict(experiment.configuration or {})
        random_seed = run.random_seed

        # Mark run as running
        run.status = "running"
        run.started_at = datetime.now(UTC)
        await self.db.commit()

        llm_provider = exp_config.get("llm_provider", "mock")
        llm_model = exp_config.get("llm_model")
        num_trials = int(exp_config.get("num_trials", 1))
        temperature = float(exp_config.get("temperature", 0.0))
        max_tokens = int(exp_config.get("max_tokens", 512))
        rng = random.Random(random_seed) if random_seed is not None else None
        trace_collector = TraceCollector(self.db, run_id)

        try:
            llm_adapter = get_llm_adapter(provider=llm_provider, model_name=llm_model)

            for arch_snap in arch_snapshots:
                run_arch_id = arch_snap.id
                arch_type = arch_snap.architecture_type
                namespace_id = arch_snap.namespace_id
                arch_config = arch_snap.configuration

                # Re-check cancellation before starting this architecture
                if await self._is_run_cancelled(run_id):
                    break

                run_arch = (
                    await self.db.execute(
                        select(RunArchitecture).where(RunArchitecture.id == run_arch_id)
                    )
                ).scalars().one()
                run_arch.status = "running"
                run_arch.started_at = datetime.now(UTC)
                await self.db.commit()

                memory_engine = get_memory_architecture(
                    architecture_type=arch_type,
                    db=self.db,
                    namespace_id=namespace_id,
                    config=arch_config,
                )

                arch_task_records: list[dict[str, Any]] = []
                cancelled_mid_arch = False

                for trial in range(1, num_trials + 1):
                    trial_tasks = list(task_snapshots)
                    if rng is not None and len(trial_tasks) > 1 and trial > 1:
                        rng.shuffle(trial_tasks)

                    for task_snap in trial_tasks:
                        task_id = task_snap.id
                        task_key = task_snap.task_key
                        task_category = task_snap.category
                        conv_seq = task_snap.conversation_sequence
                        eval_query = task_snap.evaluation_query
                        expected_answer = task_snap.expected_answer

                        # Promptly obey cancellation during long runs
                        if await self._is_run_cancelled(run_id):
                            cancelled_mid_arch = True
                            break

                        task_start = time.perf_counter()
                        required_memory_ids: list[str] = []
                        delete_target_ids: list[str] = []
                        all_stored_ids: list[str] = []

                        try:
                            # Isolate each task cleanly by clearing the namespace
                            await memory_engine.clear()

                            # Step A: Conversation Replay (Memory Formation)
                            for turn in conv_seq:
                                item = MemoryItem(
                                    content=turn["content"],
                                    memory_type="episodic" if arch_type == "history" else "semantic",
                                    subject=turn.get("subject"),
                                    predicate=turn.get("predicate"),
                                    object_value=turn.get("object_value"),
                                    metadata={
                                        "role": turn.get("role", "user"),
                                        "seq": turn.get("sequence_number"),
                                    },
                                )
                                store_res = await memory_engine.store(item)
                                if store_res.status == "error":
                                    raise RuntimeError(
                                        store_res.error_message or "Memory store error"
                                    )
                                all_stored_ids.extend(store_res.affected_memory_ids)
                                if turn.get("is_evidence") and store_res.affected_memory_ids:
                                    required_memory_ids.extend(store_res.affected_memory_ids)
                                if turn.get("is_delete_target") and store_res.affected_memory_ids:
                                    delete_target_ids.extend(store_res.affected_memory_ids)

                            # Step B: Evaluation Operation
                            operation = eval_query.get("operation", "retrieve")
                            question = eval_query.get("question", "")
                            top_k = int(eval_query.get("top_k", 5))

                            if operation == "delete":
                                for del_id in delete_target_ids:
                                    await memory_engine.delete(del_id)
                            elif operation == "update" and eval_query.get("update_content"):
                                update_targets = required_memory_ids or all_stored_ids[-1:]
                                for upd_id in update_targets:
                                    await memory_engine.update(
                                        upd_id,
                                        MemoryItem(content=str(eval_query["update_content"])),
                                    )

                            ret_res = await memory_engine.retrieve(query=question, top_k=top_k)
                            if ret_res.status == "error":
                                raise RuntimeError(
                                    ret_res.error_message or "Memory retrieval error"
                                )
                            retrieved_contents = [m.content for m in ret_res.retrieved_memories]

                            # Step C: LLM Answer Generation
                            if operation == "delete":
                                generated_text = " ".join(retrieved_contents)
                                llm_latency = 0.0
                                prompt_tokens, completion_tokens, total_tokens = 0, 0, 0
                            else:
                                prompt = ContextBuilder.build_prompt(
                                    query=question,
                                    memories=ret_res.retrieved_memories,
                                )
                                llm_res = await llm_adapter.generate(
                                    prompt=prompt,
                                    system_prompt=ContextBuilder.DEFAULT_SYSTEM_PROMPT,
                                    max_tokens=max_tokens,
                                    temperature=temperature,
                                )
                                generated_text = llm_res.text
                                llm_latency = llm_res.latency_ms
                                prompt_tokens = llm_res.prompt_tokens
                                completion_tokens = llm_res.completion_tokens
                                total_tokens = llm_res.total_tokens

                            total_latency = (time.perf_counter() - task_start) * 1000

                            # Step D: Ground-Truth Evaluation
                            is_correct, eval_details = GroundTruthEvaluator.evaluate_answer(
                                generated_text=generated_text,
                                expected_outcome=expected_answer,
                                category=task_category,
                                retrieved_contents=retrieved_contents,
                            )
                            failure_label = GroundTruthEvaluator.classify_failure(
                                is_correct=is_correct,
                                category=task_category,
                                retrieved_memory_ids=ret_res.retrieved_memory_ids,
                                required_memory_ids=required_memory_ids,
                            )
                            if failure_label:
                                eval_details["failure_classification"] = failure_label

                            task_result = TaskResult(
                                run_id=run_id,
                                run_architecture_id=run_arch_id,
                                task_id=task_id,
                                trial_number=trial,
                                generated_answer={"text": generated_text},
                                expected_answer_snapshot=expected_answer,
                                task_status="success" if is_correct else "failure",
                                is_correct=is_correct,
                                retrieval_latency_ms=Decimal(str(round(ret_res.latency_ms, 2))),
                                llm_latency_ms=Decimal(str(round(llm_latency, 2))),
                                total_latency_ms=Decimal(str(round(total_latency, 2))),
                                prompt_tokens=prompt_tokens,
                                completion_tokens=completion_tokens,
                                total_tokens=total_tokens,
                                retrieved_memory_ids=ret_res.retrieved_memory_ids,
                                evaluation_details=eval_details,
                            )
                            self.db.add(task_result)
                            await self.db.flush()

                            await trace_collector.log_event(
                                event_type="task_evaluated",
                                component=arch_type,
                                task_result_id=task_result.id,
                                duration_ms=total_latency,
                                event_data={
                                    "task_key": task_key,
                                    "category": task_category,
                                    "operation": operation,
                                    "random_seed": random_seed,
                                    "is_correct": is_correct,
                                    "failure_label": failure_label,
                                    "retrieved_ids": ret_res.retrieved_memory_ids,
                                },
                            )

                            arch_task_records.append({
                                "category": task_category,
                                "is_correct": is_correct,
                                "required_memory_ids": required_memory_ids,
                                "retrieved_memory_ids": ret_res.retrieved_memory_ids,
                                "retrieval_latency_ms": ret_res.latency_ms,
                                "llm_latency_ms": llm_latency,
                                "total_latency_ms": total_latency,
                                "total_tokens": total_tokens,
                            })

                        except Exception as task_err:
                            # Fault isolation: record failed task without aborting entire run
                            logger.exception(
                                "Task %s (%s) failed on architecture '%s'",
                                task_key,
                                task_id,
                                arch_type,
                            )
                            try:
                                await self.db.rollback()
                            except (SQLAlchemyError, RuntimeError, OSError) as rb_err:
                                logger.warning(
                                    "Rollback after task failure encountered error: %s", rb_err
                                )

                            total_latency = (time.perf_counter() - task_start) * 1000
                            failure_label = GroundTruthEvaluator.classify_failure(
                                is_correct=False,
                                category=task_category,
                                retrieved_memory_ids=[],
                                required_memory_ids=required_memory_ids,
                                error_occurred=True,
                            )
                            err_result = TaskResult(
                                run_id=run_id,
                                run_architecture_id=run_arch_id,
                                task_id=task_id,
                                trial_number=trial,
                                generated_answer={"text": ""},
                                expected_answer_snapshot=expected_answer,
                                task_status="error",
                                is_correct=False,
                                total_latency_ms=Decimal(str(round(total_latency, 2))),
                                retrieved_memory_ids=[],
                                evaluation_details={
                                    "error": str(task_err),
                                    "failure_classification": failure_label,
                                },
                            )
                            self.db.add(err_result)
                            await self.db.flush()

                            await trace_collector.log_event(
                                event_type="task_error",
                                component=arch_type,
                                task_result_id=err_result.id,
                                duration_ms=total_latency,
                                event_data={
                                    "task_key": task_key,
                                    "category": task_category,
                                    "failure_label": failure_label,
                                    "error": str(task_err),
                                },
                            )
                            await self.db.commit()

                            arch_task_records.append({
                                "category": task_category,
                                "is_correct": False,
                                "required_memory_ids": required_memory_ids,
                                "retrieved_memory_ids": [],
                                "retrieval_latency_ms": 0.0,
                                "llm_latency_ms": 0.0,
                                "total_latency_ms": total_latency,
                                "total_tokens": 0,
                            })

                    if cancelled_mid_arch:
                        break

                run_arch = (
                    await self.db.execute(
                        select(RunArchitecture).where(RunArchitecture.id == run_arch_id)
                    )
                ).scalars().one()

                if cancelled_mid_arch:
                    run_arch.status = "cancelled"
                    run_arch.completed_at = datetime.now(UTC)
                    await self.db.commit()
                    break

                # Step E: Aggregate and Persist Metrics for this Architecture
                agg = MetricsCalculator.calculate_aggregate_metrics(arch_task_records)
                metric_mappings = [
                    ("task_success_rate", agg.get("task_success_rate", 0.0), "%", None),
                    ("precision_at_k", agg.get("precision_at_k", 0.0), "ratio", None),
                    ("recall_at_k", agg.get("recall_at_k", 0.0), "ratio", None),
                    ("mrr", agg.get("mrr", 0.0), "ratio", None),
                    ("avg_retrieval_latency_ms", agg.get("avg_retrieval_latency_ms", 0.0), "ms", None),
                    ("avg_llm_latency_ms", agg.get("avg_llm_latency_ms", 0.0), "ms", None),
                    ("avg_total_latency_ms", agg.get("avg_total_latency_ms", 0.0), "ms", None),
                    ("avg_tokens_per_task", agg.get("avg_tokens_per_task", 0.0), "tokens", None),
                    ("memory_utility", agg.get("memory_utility", 0.0), "score", None),
                ]
                for cat, acc in agg.get("category_accuracies", {}).items():
                    metric_mappings.append(("category_accuracy", acc, "%", cat))

                for m_name, m_val, m_unit, m_cat in metric_mappings:
                    self.db.add(
                        MetricResult(
                            run_architecture_id=run_arch_id,
                            metric_name=m_name,
                            metric_value=Decimal(str(round(float(m_val), 8))),
                            metric_unit=m_unit,
                            category=m_cat,
                        )
                    )

                run_arch.status = "completed"
                run_arch.completed_at = datetime.now(UTC)
                await self.db.commit()

            # Re-fetch fresh run state to prevent race overwriting a cancel triggered during final architecture
            final_run = (
                await self.db.execute(select(ExperimentRun).where(ExperimentRun.id == run_id))
            ).scalars().first()
            if final_run and final_run.status != "cancelled":
                final_run.status = "completed"
                final_run.completed_at = datetime.now(UTC)
                await self.db.commit()

        except Exception as e:
            logger.exception("Benchmark run %s failed", run_id)
            try:
                await self.db.rollback()
                err_res = await self.db.execute(
                    select(ExperimentRun).where(ExperimentRun.id == run_id)
                )
                failed_run = err_res.scalars().first()
                if failed_run:
                    failed_run.status = "failed"
                    failed_run.error_message = str(e)
                    failed_run.completed_at = datetime.now(UTC)
                    await self.db.commit()
            except Exception:
                logger.exception("Failed to persist failed status for run %s", run_id)