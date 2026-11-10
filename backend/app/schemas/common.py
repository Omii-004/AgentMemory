from pydantic import BaseModel


class PaginationMeta(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class APIResponse[T](BaseModel):
    """Standard success response envelope specified in API-SPEC Section 2.4."""

    success: bool = True
    message: str = "Operation completed successfully"
    data: T | None = None


class PaginatedResponse[T](BaseModel):
    """Standard paginated response envelope specified in API-SPEC Section 2.5."""

    success: bool = True
    data: list[T]
    pagination: PaginationMeta