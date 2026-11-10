import itertools
from typing import Any

import numpy as np
from scipy import stats


class StatisticalAnalyzer:
    """
    Implements Experiment Protocol Section 11:
    - Descriptive statistics & 95% Confidence Intervals
    - Paired t-test & Wilcoxon signed-rank test across architectures
    - Cohen's d effect size calculation
    """

    @staticmethod
    def confidence_interval_95(values: list[float]) -> dict[str, float]:
        n = len(values)
        if n == 0:
            return {"mean": 0.0, "std": 0.0, "ci_low": 0.0, "ci_high": 0.0}
        arr = np.array(values, dtype=float)
        mean = float(np.mean(arr))
        std = float(np.std(arr, ddof=1)) if n > 1 else 0.0
        margin = 1.96 * (std / np.sqrt(n)) if n > 1 else 0.0
        return {
            "mean": round(mean, 4),
            "std": round(std, 4),
            "ci_low": round(mean - margin, 4),
            "ci_high": round(mean + margin, 4),
        }

    @staticmethod
    def cohens_d(a: np.ndarray, b: np.ndarray) -> float:
        diff = a - b
        if len(diff) < 2:
            return 0.0
        sd = float(np.std(diff, ddof=1))
        if sd == 0.0:
            return 0.0
        return round(float(np.mean(diff)) / sd, 4)

    @staticmethod
    def interpret_effect_size(d: float) -> str:
        abs_d = abs(d)
        if abs_d < 0.2:
            return "negligible"
        elif abs_d < 0.5:
            return "small"
        elif abs_d < 0.8:
            return "medium"
        return "large"

    @classmethod
    def compare_paired_arrays(cls, scores_a: list[float], scores_b: list[float]) -> dict[str, Any]:
        """Runs paired t-test, Wilcoxon signed-rank test, and Cohen's d between two architectures."""
        a = np.array(scores_a, dtype=float)
        b = np.array(scores_b, dtype=float)
        diff = a - b

        if len(a) < 2 or np.all(diff == 0):
            return {
                "n_paired": len(a),
                "mean_diff": 0.0,
                "t_statistic": 0.0,
                "p_value_ttest": 1.0,
                "p_value_wilcoxon": 1.0,
                "cohens_d": 0.0,
                "effect_magnitude": "negligible",
                "statistically_significant_05": False,
            }

        # Paired t-test
        t_stat, p_ttest = stats.ttest_rel(a, b)
        p_ttest_val = 1.0 if np.isnan(p_ttest) else float(p_ttest)

        # Wilcoxon signed-rank test (non-parametric)
        try:
            _, p_wilcox = stats.wilcoxon(diff)
            p_wilcox_val = 1.0 if np.isnan(p_wilcox) else float(p_wilcox)
        except ValueError:
            p_wilcox_val = 1.0

        d_val = cls.cohens_d(a, b)
        return {
            "n_paired": len(a),
            "mean_diff": round(float(np.mean(diff)), 4),
            "t_statistic": round(float(t_stat) if not np.isnan(t_stat) else 0.0, 4),
            "p_value_ttest": round(p_ttest_val, 6),
            "p_value_wilcoxon": round(p_wilcox_val, 6),
            "cohens_d": d_val,
            "effect_magnitude": cls.interpret_effect_size(d_val),
            "statistically_significant_05": p_ttest_val < 0.05,
        }

    @classmethod
    def analyze_run(cls, arch_results: dict[str, dict[str, float]]) -> dict[str, Any]:
        """
        arch_results format: { "vector": { "task_key_or_id_trial": 1.0, ... }, "hybrid": { ... } }
        """
        descriptive = {}
        for arch, task_map in arch_results.items():
            vals = [v * 100.0 for v in task_map.values()]
            descriptive[arch] = cls.confidence_interval_95(vals)

        pairwise = []
        arch_names = sorted(arch_results.keys())
        for arch_a, arch_b in itertools.combinations(arch_names, 2):
            shared_keys = sorted(set(arch_results[arch_a].keys()).intersection(arch_results[arch_b].keys()))
            scores_a = [arch_results[arch_a][k] for k in shared_keys]
            scores_b = [arch_results[arch_b][k] for k in shared_keys]
            comparison = cls.compare_paired_arrays(scores_a, scores_b)
            pairwise.append({"arch_a": arch_a, "arch_b": arch_b, **comparison})

        return {"descriptive_ci_95": descriptive, "pairwise_comparisons": pairwise}