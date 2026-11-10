from typing import Any

from pydantic import BaseModel, Field


class ConversationMessageSchema(BaseModel):
    sequence_number: int
    role: str = "user"  # user, assistant, system
    content: str
    timestamp: str | None = None
    is_evidence: bool = False
    is_delete_target: bool = False
    # Optional structured hints for fact extraction testing
    subject: str | None = None
    predicate: str | None = None
    object_value: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvaluationQuerySchema(BaseModel):
    operation: str = "retrieve"  # retrieve, temporal_retrieve, resolve_conflict, multi_hop_retrieve, update, delete
    question: str
    top_k: int = 5
    target_entity: str | None = None
    target_attribute: str | None = None
    update_content: str | None = None


class ExpectedOutcomeSchema(BaseModel):
    answer: str
    accepted_answers: list[str] = Field(default_factory=list)
    required_terms: list[str] = Field(default_factory=list)
    forbidden_terms: list[str] = Field(default_factory=list)
    evaluation_method: str = "normalized"  # exact, normalized, contains_all, state_based_deletion


class BenchmarkTaskSchema(BaseModel):
    task_key: str
    category: str  # fact_retrieval, temporal_reasoning, contradiction_handling, multi_hop, memory_updating, memory_deletion
    difficulty: str = "medium"  # easy, medium, hard
    conversation_sequence: list[ConversationMessageSchema]
    evaluation_query: EvaluationQuerySchema
    expected_answer: ExpectedOutcomeSchema
    metadata: dict[str, Any] = Field(default_factory=dict)