from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ConversationMessageSchema(BaseModel):
    sequence_number: int
    role: str = "user"  # user, assistant, system
    content: str
    timestamp: Optional[str] = None
    is_evidence: bool = False
    is_delete_target: bool = False
    # Optional structured hints for fact extraction testing
    subject: Optional[str] = None
    predicate: Optional[str] = None
    object_value: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class EvaluationQuerySchema(BaseModel):
    operation: str = "retrieve"  # retrieve, temporal_retrieve, resolve_conflict, multi_hop_retrieve, update, delete
    question: str
    top_k: int = 5
    target_entity: Optional[str] = None
    target_attribute: Optional[str] = None
    update_content: Optional[str] = None


class ExpectedOutcomeSchema(BaseModel):
    answer: str
    accepted_answers: List[str] = Field(default_factory=list)
    required_terms: List[str] = Field(default_factory=list)
    forbidden_terms: List[str] = Field(default_factory=list)
    evaluation_method: str = "normalized"  # exact, normalized, contains_all, state_based_deletion


class BenchmarkTaskSchema(BaseModel):
    task_key: str
    category: str  # fact_retrieval, temporal_reasoning, contradiction_handling, multi_hop, memory_updating, memory_deletion
    difficulty: str = "medium"  # easy, medium, hard
    conversation_sequence: List[ConversationMessageSchema]
    evaluation_query: EvaluationQuerySchema
    expected_answer: ExpectedOutcomeSchema
    metadata: Dict[str, Any] = Field(default_factory=dict)