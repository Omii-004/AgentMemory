from app.evaluation.evaluator import GroundTruthEvaluator
from app.evaluation.metrics import MetricsCalculator
from app.evaluation.stats import StatisticalAnalyzer


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
    # Pass: forbidden secret not present in retrieved memories
    ok, _ = GroundTruthEvaluator.evaluate_answer(
        generated_text="",
        expected_outcome={"forbidden_terms": ["Project Phoenix"], "evaluation_method": "state_based_deletion"},
        category="memory_deletion",
        retrieved_contents=["What is the weather in Tokyo?"],
    )
    assert ok is True

    # Fail: forbidden secret leaked back
    leak, details = GroundTruthEvaluator.evaluate_answer(
        generated_text="",
        expected_outcome={"forbidden_terms": ["Project Phoenix"], "evaluation_method": "state_based_deletion"},
        category="memory_deletion",
        retrieved_contents=["My secret codename is Project Phoenix."],
    )
    assert leak is False
    assert "Project Phoenix" in details["leaked_terms"]


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