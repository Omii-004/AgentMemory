import uuid
from datetime import UTC, datetime

import pytest

from app.agent.context_builder import ContextBuilder
from app.evaluation.evaluator import GroundTruthEvaluator
from app.evaluation.metrics import MetricsCalculator
from app.evaluation.stats import StatisticalAnalyzer
from app.llm.factory import get_llm_adapter
from app.llm.mock import MockLLMAdapter
from app.llm.openai_compatible import OpenAICompatibleLLMAdapter
from app.memory.schemas import RetrievedMemory


def test_evaluator_normalized_match():
    is_correct, details = GroundTruthEvaluator.evaluate_answer(
        generated_text="  The user prefers Python! ",
        expected_outcome={"answer": "Python", "evaluation_method": "normalized"},
        category="fact_retrieval",
    )
    assert is_correct is True
    assert details["method"] == "normalized"


def test_evaluator_multi_hop_contains_all():
    ok, _ = GroundTruthEvaluator.evaluate_answer(
        generated_text="The stack uses React, FastAPI, and PostgreSQL.",
        expected_outcome={
            "answer": "React, FastAPI, PostgreSQL",
            "required_terms": ["React", "FastAPI", "PostgreSQL"],
            "evaluation_method": "contains_all",
        },
        category="multi_hop",
    )
    assert ok is True

    fail, details = GroundTruthEvaluator.evaluate_answer(
        generated_text="The stack uses React and FastAPI.",
        expected_outcome={
            "answer": "React, FastAPI, PostgreSQL",
            "required_terms": ["React", "FastAPI", "PostgreSQL"],
            "evaluation_method": "contains_all",
        },
        category="multi_hop",
    )
    assert fail is False
    assert "PostgreSQL" in details["missing_terms"]


def test_evaluator_deletion_verification():
    ok, _ = GroundTruthEvaluator.evaluate_answer(
        generated_text="",
        expected_outcome={"forbidden_terms": ["Project Phoenix"], "evaluation_method": "state_based_deletion"},
        category="memory_deletion",
        retrieved_contents=["What is the weather in Tokyo?"],
    )
    assert ok is True

    leak, details = GroundTruthEvaluator.evaluate_answer(
        generated_text="",
        expected_outcome={"forbidden_terms": ["Project Phoenix"], "evaluation_method": "state_based_deletion"},
        category="memory_deletion",
        retrieved_contents=["My secret codename is Project Phoenix."],
    )
    assert leak is False
    assert "Project Phoenix" in details["leaked_terms"]


def test_failure_classification_labels():
    assert GroundTruthEvaluator.classify_failure(
        is_correct=False,
        category="fact_retrieval",
        retrieved_memory_ids=[],
        required_memory_ids=["m1"],
        error_occurred=True,
    ) == "Execution Failure"
    assert GroundTruthEvaluator.classify_failure(
        is_correct=False,
        category="fact_retrieval",
        retrieved_memory_ids=["m2"],
        required_memory_ids=["m1"],
    ) == "Retrieval Failure"
    assert GroundTruthEvaluator.classify_failure(
        is_correct=False,
        category="memory_deletion",
        retrieved_memory_ids=[],
        required_memory_ids=[],
    ) == "Deletion Failure"
    assert GroundTruthEvaluator.classify_failure(
        is_correct=False,
        category="memory_updating",
        retrieved_memory_ids=[],
        required_memory_ids=[],
    ) == "Update Failure"


def test_retrieval_and_aggregate_metrics():
    retrieved = ["id_2", "id_1", "id_3"]
    relevant = ["id_1"]
    assert round(MetricsCalculator.precision_at_k(retrieved, relevant, k=3), 4) == 0.3333
    assert MetricsCalculator.recall_at_k(retrieved, relevant, k=3) == 1.0
    assert MetricsCalculator.reciprocal_rank(retrieved, relevant) == 0.5

    records = [
        {
            "category": "fact_retrieval",
            "is_correct": True,
            "required_memory_ids": ["m1"],
            "retrieved_memory_ids": ["m1", "m2"],
            "retrieval_latency_ms": 10.0,
            "llm_latency_ms": 20.0,
            "total_latency_ms": 30.0,
            "total_tokens": 100,
        },
        {
            "category": "memory_deletion",
            "is_correct": False,
            "required_memory_ids": ["m3"],
            "retrieved_memory_ids": ["m4"],
            "retrieval_latency_ms": 12.0,
            "llm_latency_ms": 0.0,
            "total_latency_ms": 12.0,
            "total_tokens": 0,
        },
    ]
    agg = MetricsCalculator.calculate_aggregate_metrics(records)
    assert agg["task_success_rate"] == 50.0
    assert agg["category_accuracies"]["fact_retrieval"] == 100.0
    assert agg["category_accuracies"]["memory_deletion"] == 0.0
    assert agg["memory_utility"] > 0


def test_statistical_significance_and_confidence_intervals():
    arch_results = {
        "history": {f"t{i}": 0.0 for i in range(10)},
        "hybrid": {f"t{i}": (1.0 if i < 9 else 0.0) for i in range(10)},
    }
    analysis = StatisticalAnalyzer.analyze_run(arch_results)
    assert analysis["descriptive_ci_95"]["hybrid"]["mean"] == 90.0
    pair = analysis["pairwise_comparisons"][0]
    assert pair["statistically_significant_05"] is True
    assert pair["p_value_ttest"] < 0.05
    assert pair["effect_magnitude"] == "large"


@pytest.mark.asyncio
async def test_mock_llm_context_builder_and_factory_validation():
    now = datetime.now(UTC)
    memories = [
        RetrievedMemory(id=uuid.uuid4(), content="What is the weather in Tokyo?", memory_type="semantic", created_at=now),
        RetrievedMemory(id=uuid.uuid4(), content="My preferred systems language is Rust.", memory_type="semantic", created_at=now),
    ]
    prompt = ContextBuilder.build_prompt("What is my preferred systems language?", memories)
    adapter = MockLLMAdapter()
    res = await adapter.generate(prompt)
    assert "Rust" in res.text

    multi_memories = [
        RetrievedMemory(id=uuid.uuid4(), content="The project frontend uses React.", memory_type="semantic", created_at=now),
        RetrievedMemory(id=uuid.uuid4(), content="The project backend uses FastAPI.", memory_type="semantic", created_at=now),
    ]
    multi_prompt = ContextBuilder.build_prompt("List the frontend and backend technologies.", multi_memories)
    multi_res = await adapter.generate(multi_prompt)
    assert "React" in multi_res.text and "FastAPI" in multi_res.text

    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        get_llm_adapter("nonexistent_provider")

    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        OpenAICompatibleLLMAdapter(api_key="", base_url="https://api.openai.com/v1")

    local_adapter = OpenAICompatibleLLMAdapter(api_key="", base_url="http://localhost:8000/v1")
    assert local_adapter.base_url == "http://localhost:8000/v1"