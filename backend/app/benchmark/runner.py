import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List
from sqlalchemy import select
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


class BenchmarkRunner:
    """
    Core Benchmark Execution Engine (Benchmark Spec Section 8 & SAD Section 4.3).
    Executes an ExperimentRun across all configured RunArchitectures inside
    isolated memory namespaces, capturing execution traces, task outcomes,
    and aggregated evaluation metrics.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def execute_run(self, run_id: uuid.UUID) -> None:
        # 1. Load ExperimentRun and parent Experiment
        run_res = await self.db.execute(select(ExperimentRun).where(ExperimentRun.id == run_id))
        run = run_res.scalars().first()
        if not run:
            logger.error(f"ExperimentRun {run_id} not found.")
            return
        if run.status in ("running", "completed"):
            logger.warning(f"ExperimentRun {run_id} is already '{run.status}'. Skipping duplicate execution.")
            return

        exp_res = await self.db.execute(select(Experiment).where(Experiment.id == run.experiment_id))
        experiment = exp_res.scalars().first()
        if not experiment:
            run.status = "failed"
            run.error_message = "Parent experiment not found."
            await self.db.commit()
            return

        # 2. Load Benchmark Tasks
        tasks_res = await self.db.execute(
            select(BenchmarkTask)
            .where(BenchmarkTask.dataset_id == experiment.dataset_id)
            .order_by(BenchmarkTask.task_key)
        )
        tasks = tasks_res.scalars().all()
        if not tasks:
            run.status = "failed"
            run.error_message = "Dataset contains no benchmark tasks."
            await self.db.commit()
            return

        # 3. Load RunArchitectures
        arch_res = await self.db.execute(
            select(RunArchitecture).where(RunArchitecture.run_id == run.id)
        )
        run_architectures = arch_res.scalars().all()

        # Mark run as running
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        await self.db.commit()

        trace_collector = TraceCollector(self.db, run.id)
        exp_config = experiment.configuration or {}
        llm_provider = exp_config.get("llm_provider", "mock")
        llm_model = exp_config.get("llm_model")
        num_trials = int(exp_config.get("num_trials", 1))
        llm_adapter = get_llm_adapter(provider=llm_provider, model_name=llm_model)

        try:
            for run_arch in run_architectures:
                # Check if run was cancelled externally
                await self.db.refresh(run)
                if run.status == "cancelled":
                    break

                run_arch.status = "running"
                run_arch.started_at = datetime.now(timezone.utc)
                await self.db.commit()

                memory_engine = get_memory_architecture(
                    architecture_type=run_arch.architecture_type,
                    db=self.db,
                    namespace_id=run_arch.namespace_id,
                    config=run_arch.configuration,
                )

                arch_task_records: List[Dict[str, Any]] = []

                for trial in range(1, num_trials + 1):
                    for task in tasks:
                        # Isolate each task cleanly by clearing the namespace
                        await memory_engine.clear()

                        task_start = time.perf_counter()
                        required_memory_ids: List[str] = []
                        delete_target_ids: List[str] = []

                        # Step A: Conversation Replay (Memory Formation)
                        for turn in task.conversation_sequence:
                            item = MemoryItem(
                                content=turn["content"],
                                memory_type="episodic" if run_arch.architecture_type == "history" else "semantic",
                                subject=turn.get("subject"),
                                predicate=turn.get("predicate"),
                                object_value=turn.get("object_value"),
                                metadata={"role": turn.get("role", "user"), "seq": turn.get("sequence_number")},
                            )
                            store_res = await memory_engine.store(item)
                            if turn.get("is_evidence") and store_res.affected_memory_ids:
                                required_memory_ids.extend(store_res.affected_memory_ids)
                            if turn.get("is_delete_target") and store_res.affected_memory_ids:
                                delete_target_ids.extend(store_res.affected_memory_ids)

                        # Step B: Evaluation Operation
                        eval_query = task.evaluation_query
                        operation = eval_query.get("operation", "retrieve")
                        question = eval_query.get("question", "")
                        top_k = int(eval_query.get("top_k", 5))

                        if operation == "delete":
                            for del_id in delete_target_ids:
                                await memory_engine.delete(del_id)

                        ret_res = await memory_engine.retrieve(query=question, top_k=top_k)
                        retrieved_contents = [m.content for m in ret_res.retrieved_memories]

                        # Step C: LLM Answer Generation
                        if operation == "delete":
                            generated_text = " ".join(retrieved_contents)
                            llm_latency = 0.0
                            prompt_tokens, completion_tokens, total_tokens = 0, 0, 0
                        else:
                            prompt = ContextBuilder.build_prompt(query=question, memories=ret_res.retrieved_memories)
                            llm_res = await llm_adapter.generate(
                                prompt=prompt,
                                system_prompt=ContextBuilder.DEFAULT_SYSTEM_PROMPT,
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
                            expected_outcome=task.expected_answer,
                            category=task.category,
                            retrieved_contents=retrieved_contents,
                        )
                        failure_label = GroundTruthEvaluator.classify_failure(
                            is_correct=is_correct,
                            category=task.category,
                            retrieved_memory_ids=ret_res.retrieved_memory_ids,
                            required_memory_ids=required_memory_ids,
                        )
                        if failure_label:
                            eval_details["failure_classification"] = failure_label

                        task_result = TaskResult(
                            run_id=run.id,
                            run_architecture_id=run_arch.id,
                            task_id=task.id,
                            trial_number=trial,
                            generated_answer={"text": generated_text},
                            expected_answer_snapshot=task.expected_answer,
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
                            component=run_arch.architecture_type,
                            task_result_id=task_result.id,
                            duration_ms=total_latency,
                            event_data={
                                "task_key": task.task_key,
                                "category": task.category,
                                "is_correct": is_correct,
                                "failure_label": failure_label,
                                "retrieved_ids": ret_res.retrieved_memory_ids,
                            },
                        )

                        arch_task_records.append({
                            "category": task.category,
                            "is_correct": is_correct,
                            "required_memory_ids": required_memory_ids,
                            "retrieved_memory_ids": ret_res.retrieved_memory_ids,
                            "retrieval_latency_ms": ret_res.latency_ms,
                            "llm_latency_ms": llm_latency,
                            "total_latency_ms": total_latency,
                            "total_tokens": total_tokens,
                        })

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
                            run_architecture_id=run_arch.id,
                            metric_name=m_name,
                            metric_value=Decimal(str(round(float(m_val), 8))),
                            metric_unit=m_unit,
                            category=m_cat,
                        )
                    )

                run_arch.status = "completed"
                run_arch.completed_at = datetime.now(timezone.utc)
                await self.db.commit()

            if run.status != "cancelled":
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                await self.db.commit()

        except Exception as e:
            logger.exception(f"Benchmark run {run.id} failed: {e}")
            run.status = "failed"
            run.error_message = str(e)
            run.completed_at = datetime.now(timezone.utc)
            await self.db.commit()