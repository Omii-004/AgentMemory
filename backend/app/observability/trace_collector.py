import uuid
from decimal import Decimal
from typing import Any, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.models.evaluation import ExecutionTrace


class TraceCollector:
    """
    Records granular step-by-step execution events for debugging,
    failure analysis, and observability (SAD Section 4.7).
    """

    def __init__(self, db: AsyncSession, run_id: uuid.UUID):
        self.db = db
        self.run_id = run_id

    async def log_event(
        self,
        event_type: str,
        component: str,
        event_data: Optional[Dict[str, Any]] = None,
        task_result_id: Optional[uuid.UUID] = None,
        duration_ms: Optional[float] = None
    ) -> ExecutionTrace:
        """Persists a trace event to the execution_traces table."""
        trace = ExecutionTrace(
            run_id=self.run_id,
            task_result_id=task_result_id,
            event_type=event_type,
            component=component,
            event_data=event_data or {},
            duration_ms=Decimal(str(round(duration_ms, 3))) if duration_ms is not None else None
        )
        self.db.add(trace)
        return trace