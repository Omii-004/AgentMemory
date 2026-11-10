import random
from typing import List
from app.benchmark.schemas import (
    BenchmarkTaskSchema,
    ConversationMessageSchema,
    EvaluationQuerySchema,
    ExpectedOutcomeSchema,
)

# Neutral distractor conversations designed to push older facts out of sliding history windows
DISTRACTOR_MESSAGES = [
    "What is the weather like in Tokyo today?",
    "Can you help me calculate the compound interest on $10,000 at 5%?",
    "Tell me a quick summary of the French Revolution.",
    "How do I boil an egg perfectly?",
    "Explain the difference between TCP and UDP protocols.",
    "What are the primary ingredients in a classic Margherita pizza?",
    "Suggest three good sci-fi books from the 1980s.",
    "How many kilometers are in a marathon?",
    "Write a haiku about autumn leaves falling.",
    "What is the capital city of Australia?",
    "Explain photosynthesis in two sentences.",
    "Who painted The Starry Night?",
    "What is the boiling point of water at high altitude?",
    "Give me five tips for better sleep hygiene.",
    "How do binary search trees maintain balance?",
]


class SyntheticBenchmarkGenerator:
    """
    Generates standardized benchmark tasks across all 6 categories
    defined in Benchmark Spec Section 3 & 4, with configurable distractor turns.
    """

    def __init__(self, seed: int = 42, distractor_count: int = 6):
        self.rng = random.Random(seed)
        self.distractor_count = distractor_count

    def _get_distractors(self, count: int, start_seq: int) -> List[ConversationMessageSchema]:
        turns = []
        for i in range(count):
            msg = self.rng.choice(DISTRACTOR_MESSAGES)
            turns.append(
                ConversationMessageSchema(
                    sequence_number=start_seq + i,
                    role="user",
                    content=msg,
                    is_evidence=False,
                )
            )
        return turns

    def generate_fact_retrieval(self, count: int = 5) -> List[BenchmarkTaskSchema]:
        samples = [
            ("Python", "programming language", "User", "prefers", "Python"),
            ("Rust", "systems language", "User", "uses", "Rust"),
            ("PostgreSQL", "primary database", "User", "uses", "PostgreSQL"),
            ("Neovim", "code editor", "User", "prefers", "Neovim"),
            ("Arch Linux", "operating system", "User", "uses", "Arch Linux"),
            ("FastAPI", "backend framework", "User", "uses", "FastAPI"),
        ]
        tasks = []
        for i in range(count):
            val, attr, sub, pred, obj = samples[i % len(samples)]
            turns = [
                ConversationMessageSchema(
                    sequence_number=1,
                    role="user",
                    content=f"My preferred {attr} is {val}.",
                    is_evidence=True,
                    subject=sub,
                    predicate=f"preferred_{attr.replace(' ', '_')}",
                    object_value=obj,
                )
            ]
            turns.extend(self._get_distractors(self.distractor_count, start_seq=2))
            tasks.append(
                BenchmarkTaskSchema(
                    task_key=f"FACT_{i+1:03d}",
                    category="fact_retrieval",
                    difficulty="medium" if self.distractor_count >= 5 else "easy",
                    conversation_sequence=turns,
                    evaluation_query=EvaluationQuerySchema(
                        operation="retrieve",
                        question=f"What is my preferred {attr}?",
                    ),
                    expected_answer=ExpectedOutcomeSchema(
                        answer=val,
                        accepted_answers=[val],
                        evaluation_method="normalized",
                    ),
                )
            )
        return tasks

    def generate_temporal_reasoning(self, count: int = 5) -> List[BenchmarkTaskSchema]:
        scenarios = [
            ("January", "Flask", "June", "FastAPI", "backend framework"),
            ("2024", "MySQL", "2026", "PostgreSQL", "database"),
            ("Q1", "React", "Q3", "Svelte", "frontend library"),
        ]
        tasks = []
        for i in range(count):
            t1, old_val, t2, new_val, attr = scenarios[i % len(scenarios)]
            turns = [
                ConversationMessageSchema(
                    sequence_number=1,
                    role="user",
                    content=f"In {t1}, our team's {attr} was {old_val}.",
                    is_evidence=False,
                    subject="Team",
                    predicate=attr.replace(" ", "_"),
                    object_value=old_val,
                )
            ]
            turns.extend(self._get_distractors(max(2, self.distractor_count // 2), start_seq=2))
            next_seq = len(turns) + 1
            turns.append(
                ConversationMessageSchema(
                    sequence_number=next_seq,
                    role="user",
                    content=f"In {t2}, we switched our {attr} to {new_val}.",
                    is_evidence=True,
                    subject="Team",
                    predicate=attr.replace(" ", "_"),
                    object_value=new_val,
                )
            )
            tasks.append(
                BenchmarkTaskSchema(
                    task_key=f"TEMP_{i+1:03d}",
                    category="temporal_reasoning",
                    difficulty="medium",
                    conversation_sequence=turns,
                    evaluation_query=EvaluationQuerySchema(
                        operation="temporal_retrieve",
                        question=f"Which {attr} did the team use in {t2}?",
                    ),
                    expected_answer=ExpectedOutcomeSchema(
                        answer=new_val,
                        accepted_answers=[new_val],
                        evaluation_method="normalized",
                    ),
                )
            )
        return tasks

    def generate_contradiction_handling(self, count: int = 5) -> List[BenchmarkTaskSchema]:
        pairs = [
            ("PostgreSQL", "MongoDB", "database"),
            ("AWS", "GCP", "cloud provider"),
            ("TypeScript", "Python", "primary scripting language"),
        ]
        tasks = []
        for i in range(count):
            old_val, new_val, attr = pairs[i % len(pairs)]
            turns = [
                ConversationMessageSchema(
                    sequence_number=1,
                    role="user",
                    content=f"Project uses {old_val} as its {attr}.",
                    is_evidence=False,
                    subject="Project",
                    predicate=attr.replace(" ", "_"),
                    object_value=old_val,
                )
            ]
            turns.extend(self._get_distractors(max(2, self.distractor_count // 2), start_seq=2))
            turns.append(
                ConversationMessageSchema(
                    sequence_number=len(turns) + 1,
                    role="user",
                    content=f"Project migrated to {new_val} as its {attr}.",
                    is_evidence=True,
                    subject="Project",
                    predicate=attr.replace(" ", "_"),
                    object_value=new_val,
                )
            )
            tasks.append(
                BenchmarkTaskSchema(
                    task_key=f"CONTRA_{i+1:03d}",
                    category="contradiction_handling",
                    difficulty="hard",
                    conversation_sequence=turns,
                    evaluation_query=EvaluationQuerySchema(
                        operation="resolve_conflict",
                        question=f"Which {attr} does the project currently use?",
                    ),
                    expected_answer=ExpectedOutcomeSchema(
                        answer=new_val,
                        accepted_answers=[new_val],
                        evaluation_method="normalized",
                    ),
                )
            )
        return tasks

    def generate_multi_hop(self, count: int = 5) -> List[BenchmarkTaskSchema]:
        stacks = [
            ("React", "FastAPI", "PostgreSQL"),
            ("Vue", "Django", "MySQL"),
            ("Svelte", "Go", "Redis"),
        ]
        tasks = []
        for i in range(count):
            fe, be, db = stacks[i % len(stacks)]
            turns = [
                ConversationMessageSchema(
                    sequence_number=1,
                    role="user",
                    content=f"The project frontend uses {fe}.",
                    is_evidence=True,
                    subject="Project",
                    predicate="frontend",
                    object_value=fe,
                ),
            ]
            turns.extend(self._get_distractors(2, start_seq=2))
            turns.append(
                ConversationMessageSchema(
                    sequence_number=len(turns) + 1,
                    role="user",
                    content=f"The project backend uses {be}.",
                    is_evidence=True,
                    subject="Project",
                    predicate="backend",
                    object_value=be,
                )
            )
            turns.extend(self._get_distractors(2, start_seq=len(turns) + 1))
            turns.append(
                ConversationMessageSchema(
                    sequence_number=len(turns) + 1,
                    role="user",
                    content=f"The project database uses {db}.",
                    is_evidence=True,
                    subject="Project",
                    predicate="database",
                    object_value=db,
                )
            )
            tasks.append(
                BenchmarkTaskSchema(
                    task_key=f"MHOP_{i+1:03d}",
                    category="multi_hop",
                    difficulty="hard",
                    conversation_sequence=turns,
                    evaluation_query=EvaluationQuerySchema(
                        operation="multi_hop_retrieve",
                        question="List the frontend, backend, and database technologies of the project.",
                        top_k=10,
                    ),
                    expected_answer=ExpectedOutcomeSchema(
                        answer=f"{fe}, {be}, {db}",
                        required_terms=[fe, be, db],
                        evaluation_method="contains_all",
                    ),
                )
            )
        return tasks

    def generate_memory_updating(self, count: int = 5) -> List[BenchmarkTaskSchema]:
        updates = [
            ("VS Code", "Neovim", "editor"),
            ("Docker", "Podman", "container engine"),
            ("macOS", "Arch Linux", "workstation OS"),
        ]
        tasks = []
        for i in range(count):
            old_v, new_v, attr = updates[i % len(updates)]
            turns = [
                ConversationMessageSchema(
                    sequence_number=1,
                    role="user",
                    content=f"User uses {old_v} as their {attr}.",
                    is_evidence=False,
                    subject="User",
                    predicate=attr.replace(" ", "_"),
                    object_value=old_v,
                ),
                ConversationMessageSchema(
                    sequence_number=2,
                    role="user",
                    content=f"User switched to {new_v} for their {attr}.",
                    is_evidence=True,
                    subject="User",
                    predicate=attr.replace(" ", "_"),
                    object_value=new_v,
                ),
            ]
            turns.extend(self._get_distractors(self.distractor_count, start_seq=3))
            tasks.append(
                BenchmarkTaskSchema(
                    task_key=f"UPD_{i+1:03d}",
                    category="memory_updating",
                    difficulty="medium",
                    conversation_sequence=turns,
                    evaluation_query=EvaluationQuerySchema(
                        operation="retrieve",
                        question=f"Which {attr} does the user currently use?",
                    ),
                    expected_answer=ExpectedOutcomeSchema(
                        answer=new_v,
                        accepted_answers=[new_v],
                        evaluation_method="normalized",
                    ),
                )
            )
        return tasks

    def generate_memory_deletion(self, count: int = 5) -> List[BenchmarkTaskSchema]:
        secrets = [
            ("Project Phoenix", "secret codename"),
            ("Blueberry42", "temporary recovery passphrase"),
            ("Zurich", "private meeting location"),
        ]
        tasks = []
        for i in range(count):
            secret_val, label = secrets[i % len(secrets)]
            turns = [
                ConversationMessageSchema(
                    sequence_number=1,
                    role="user",
                    content=f"My {label} is {secret_val}.",
                    is_evidence=True,
                    is_delete_target=True,
                    subject="User",
                    predicate=label.replace(" ", "_"),
                    object_value=secret_val,
                )
            ]
            turns.extend(self._get_distractors(3, start_seq=2))
            tasks.append(
                BenchmarkTaskSchema(
                    task_key=f"DEL_{i+1:03d}",
                    category="memory_deletion",
                    difficulty="medium",
                    conversation_sequence=turns,
                    evaluation_query=EvaluationQuerySchema(
                        operation="delete",
                        question=f"What is my {label}?",
                    ),
                    expected_answer=ExpectedOutcomeSchema(
                        answer="",
                        forbidden_terms=[secret_val],
                        evaluation_method="state_based_deletion",
                    ),
                )
            )
        return tasks

    def generate_suite(self, per_category: int = 5) -> List[BenchmarkTaskSchema]:
        """Generates a balanced dataset across all 6 categories."""
        all_tasks: List[BenchmarkTaskSchema] = []
        all_tasks.extend(self.generate_fact_retrieval(per_category))
        all_tasks.extend(self.generate_temporal_reasoning(per_category))
        all_tasks.extend(self.generate_contradiction_handling(per_category))
        all_tasks.extend(self.generate_multi_hop(per_category))
        all_tasks.extend(self.generate_memory_updating(per_category))
        all_tasks.extend(self.generate_memory_deletion(per_category))
        return all_tasks