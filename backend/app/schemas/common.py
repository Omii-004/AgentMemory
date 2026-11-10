from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class PaginationMeta(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class APIResponse(BaseModel, Generic[T]):
    """Standard success response envelope specified in API-SPEC Section 2.4."""
    success: bool = True
    message: str = "Operation completed successfully"
    data: Optional[T] = None


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard paginated response envelope specified in API-SPEC Section 2.5."""
    success: bool = True
    data: List[T]
    pagination: PaginationMeta