import re
import string
from typing import Any


class GroundTruthEvaluator:
    """
    Evaluates task outputs strictly isolated from architecture-facing processes.
    Implements deterministic evaluation policies and failure classification
    as specified in Benchmark Specification Sections 6 and 12.
    """

    @staticmethod
    def normalize_text(text: str) -> str:
        """Lowercases, strips punctuation and extra whitespace for normalized matching."""
        text = str(text).lower().strip()
        text = text.translate(str.maketrans("", "", string.punctuation))
        return re.sub(r"\s+", " ", text).strip()

    @classmethod
    def evaluate_answer(
        cls,
        generated_text: str,
        expected_outcome: dict[str, Any],
        category: str,
        retrieved_contents: list[str] | None = None
    ) -> tuple[bool, dict[str, Any]]:
        """
        Determines task success based on category-specific evaluation policy.
        Returns: (is_correct: bool, evaluation_details: dict)
        """
        method = expected_outcome.get("evaluation_method", "normalized")
        expected_answer = str(expected_outcome.get("answer", ""))
        accepted_answers: list[str] = [str(a) for a in expected_outcome.get("accepted_answers", [expected_answer])]

        # Special policy for Category F: Memory Deletion
        if category == "memory_deletion" or method == "state_based_deletion":
            forbidden_terms = expected_outcome.get("forbidden_terms", accepted_answers)
            retrieved_blob = " ".join(retrieved_contents or []).lower()

            # Check if any deleted fact leaked back into retrieval
            leaked_terms = [term for term in forbidden_terms if term.lower() in retrieved_blob]
            is_correct = len(leaked_terms) == 0

            return is_correct, {
                "method": "state_based_deletion",
                "leaked_terms": leaked_terms,
                "deletion_verified": is_correct
            }

        # Exact match
        if method == "exact":
            is_correct = generated_text.strip() in [a.strip() for a in accepted_answers]
            return is_correct, {"method": "exact", "expected": accepted_answers}

        # Multi-hop / contains all required terms
        if method == "contains_all" or category == "multi_hop":
            norm_gen = cls.normalize_text(generated_text)
            required_terms = expected_outcome.get("required_terms", accepted_answers)
            missing = [t for t in required_terms if cls.normalize_text(str(t)) not in norm_gen]
            is_correct = len(missing) == 0
            return is_correct, {"method": "contains_all", "missing_terms": missing}

        # Default: Normalized substring / match
        norm_gen = cls.normalize_text(generated_text)
        norm_accepted = [cls.normalize_text(a) for a in accepted_answers]
        is_correct = any(ans in norm_gen or norm_gen == ans for ans in norm_accepted if ans)

        return is_correct, {
            "method": "normalized",
            "normalized_generated": norm_gen,
            "normalized_expected": norm_accepted
        }

    @classmethod
    def classify_failure(
        cls,
        is_correct: bool,
        category: str,
        retrieved_memory_ids: list[str],
        required_memory_ids: list[str],
        error_occurred: bool = False
    ) -> str | None:
        """
        Assigns a diagnostic failure classification label (Benchmark Spec Section 12).
        """
        if is_correct:
            return None
        if error_occurred:
            return "Execution Failure"

        if category == "memory_deletion":
            return "Deletion Failure"
        if category == "memory_updating":
            return "Update Failure"

        # Check if required evidence was retrieved
        if required_memory_ids:
            retrieved_set = set(retrieved_memory_ids)
            required_set = set(required_memory_ids)
            if not retrieved_set.intersection(required_set):
                return "Retrieval Failure"
            if category == "temporal_reasoning":
                return "Temporal Failure"
            if category == "contradiction_handling":
                return "Contradiction Failure"
            if category == "multi_hop":
                return "Multi-hop Failure"
            return "Generation Failure"

        if not retrieved_memory_ids:
            return "Retrieval Failure"

        return "Generation Failure"