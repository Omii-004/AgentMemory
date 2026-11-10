from typing import Any

from fastapi import HTTPException, status


class AgentMemoryException(HTTPException):
    """Base exception for all custom AgentMemory errors."""
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        details: dict[str, Any] | None = None
    ):
        super().__init__(
            status_code=status_code,
            detail={
                "code": error_code,
                "message": message,
                "details": details or {}
            }
        )


class UnauthorizedException(AgentMemoryException):
    def __init__(self, message: str = "Invalid credentials or token expired.", details: dict[str, Any] | None = None):
        super().__init__(status.HTTP_401_UNAUTHORIZED, "AM_ERR_UNAUTHORIZED", message, details)


class ForbiddenException(AgentMemoryException):
    def __init__(self, message: str = "You do not have access to this resource.", details: dict[str, Any] | None = None):
        super().__init__(status.HTTP_403_FORBIDDEN, "AM_ERR_FORBIDDEN", message, details)


class NotFoundException(AgentMemoryException):
    def __init__(self, message: str = "Requested resource not found.", details: dict[str, Any] | None = None):
        super().__init__(status.HTTP_404_NOT_FOUND, "AM_ERR_NOT_FOUND", message, details)


class ValidationException(AgentMemoryException):
    def __init__(self, message: str = "Input validation failed.", details: dict[str, Any] | None = None):
        super().__init__(status.HTTP_422_UNPROCESSABLE_ENTITY, "AM_ERR_VALIDATION_FAILED", message, details)


class ConflictException(AgentMemoryException):
    def __init__(self, message: str = "A resource conflict occurred.", details: dict[str, Any] | None = None):
        super().__init__(status.HTTP_409_CONFLICT, "AM_ERR_CONFLICT", message, details)


class ArchitectureUnsupportedException(AgentMemoryException):
    def __init__(self, architecture: str):
        super().__init__(
            status.HTTP_400_BAD_REQUEST,
            "AM_ERR_ARCHITECTURE_UNSUPPORTED",
            f"Memory architecture '{architecture}' is not supported.",
            {"supported_architectures": ["history", "vector", "structured", "hybrid"]}
        )


class ExperimentBusyException(AgentMemoryException):
    def __init__(self, message: str = "Experiment run is already active or cannot be modified."):
        super().__init__(status.HTTP_409_CONFLICT, "AM_ERR_EXPERIMENT_BUSY", message)


class MemoryOperationException(AgentMemoryException):
    def __init__(self, message: str = "Failed to perform memory operation.", details: dict[str, Any] | None = None):
        super().__init__(status.HTTP_500_INTERNAL_SERVER_ERROR, "AM_ERR_MEMORY_OPERATION_FAILED", message, details)