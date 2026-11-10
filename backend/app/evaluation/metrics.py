import math
from typing import Any, Dict, List, Optional
import numpy as np


class MetricsCalculator:
    """
    Computes Information Retrieval, Task Success, Category Accuracy,
    Operational Resource, and Composite Utility metrics (Benchmark Spec Section 6).
    """

    @staticmethod
    def precision_at_k(retrieved_ids: List[str], relevant_ids: List[str], k: int = 5) -> float:
        if not retrieved_ids or k <= 0:
            return 0.0
        top_k = retrieved_ids[:k]
        relevant_set = set(relevant_ids)
        hits = sum(1 for doc_id in top_k if doc_id in relevant_set)
        return hits / len(top_k)

    @staticmethod
    def recall_at_k(retrieved_ids: List[str], relevant_ids: List[str], k: int = 5) -> float:
        if not relevant_ids:
            return 1.0  # If no specific evidence is required, recall is trivially satisfied
        top_k = retrieved_ids[:k]
        relevant_set = set(relevant_ids)
        hits = sum(1 for doc_id in top_k if doc_id in relevant_set)
        return hits / len(relevant_set)

    @staticmethod
    def reciprocal_rank(retrieved_ids: List[str], relevant_ids: List[str]) -> float:
        relevant_set = set(relevant_ids)
        for rank, doc_id in enumerate(retrieved_ids, start=1):
            if doc_id in relevant_set:
                return 1.0 / rank
        return 0.0

    @classmethod
    def calculate_aggregate_metrics(
        cls,
        task_records: List[Dict[str, Any]],
        lambda_tokens: float = 0.0001,
        mu_latency: float = 0.001
    ) -> Dict[str, Any]:
        """
        Aggregates per-task results into architecture-level metrics:
        - Task Success Rate (TSR %)
        - Precision@K, Recall@K, MRR
        - Update Accuracy, Contradiction Accuracy, Deletion Success Rate
        - Latency & Token averages
        - Composite Memory Utility
        """
        total = len(task_records)
        if total == 0:
            return {}

        correct_count = sum(1 for r in task_records if r.get("is_correct"))
        tsr = (correct_count / total) * 100.0

        precisions, recalls, rrs = [], [], []
        ret_latencies, llm_latencies, total_latencies = [], [], []
        tokens_list = []

        # Category counters
        category_stats: Dict[str, Dict[str, int]] = {}

        for rec in task_records:
            cat = rec.get("category", "general")
            if cat not in category_stats:
                category_stats[cat] = {"total": 0, "correct": 0}
            category_stats[cat]["total"] += 1
            if rec.get("is_correct"):
                category_stats[cat]["correct"] += 1

            # Retrieval metrics (only where required memory references exist)
            req_ids = rec.get("required_memory_ids") or []
            ret_ids = rec.get("retrieved_memory_ids") or []
            if req_ids:
                precisions.append(cls.precision_at_k(ret_ids, req_ids))
                recalls.append(cls.recall_at_k(ret_ids, req_ids))
                rrs.append(cls.reciprocal_rank(ret_ids, req_ids))

            if rec.get("retrieval_latency_ms") is not None:
                ret_latencies.append(float(rec["retrieval_latency_ms"]))
            if rec.get("llm_latency_ms") is not None:
                llm_latencies.append(float(rec["llm_latency_ms"]))
            if rec.get("total_latency_ms") is not None:
                total_latencies.append(float(rec["total_latency_ms"]))
            if rec.get("total_tokens") is not None:
                tokens_list.append(int(rec["total_tokens"]))

        avg_tokens = float(np.mean(tokens_list)) if tokens_list else 0.0
        avg_total_latency = float(np.mean(total_latencies)) if total_latencies else 0.0

        # Experimental Composite Metric: Memory Utility = TSR / (1 + lambda*T + mu*L)
        memory_utility = tsr / (1.0 + (lambda_tokens * avg_tokens) + (mu_latency * avg_total_latency))

        # Per-category accuracies
        category_accuracies = {
            cat: round((vals["correct"] / vals["total"]) * 100.0, 2)
            for cat, vals in category_stats.items() if vals["total"] > 0
        }

        return {
            "task_success_rate": round(tsr, 2),
            "precision_at_k": round(float(np.mean(precisions)), 4) if precisions else 0.0,
            "recall_at_k": round(float(np.mean(recalls)), 4) if recalls else 0.0,
            "mrr": round(float(np.mean(rrs)), 4) if rrs else 0.0,
            "avg_retrieval_latency_ms": round(float(np.mean(ret_latencies)), 2) if ret_latencies else 0.0,
            "avg_llm_latency_ms": round(float(np.mean(llm_latencies)), 2) if llm_latencies else 0.0,
            "avg_total_latency_ms": round(avg_total_latency, 2),
            "avg_tokens_per_task": round(avg_tokens, 2),
            "total_tokens": int(sum(tokens_list)),
            "memory_utility": round(memory_utility, 4),
            "category_accuracies": category_accuracies,
            "total_evaluated": total,
            "total_correct": correct_count,
        }