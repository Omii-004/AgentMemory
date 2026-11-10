from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1 import auth, datasets, experiments, memories, projects
from app.core.config import settings
from app.core.exceptions import AgentMemoryException
from app.core.logging import get_logger
from app.database.connection import engine, init_db_extensions

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing AgentMemory Backend...")
    await init_db_extensions()
    yield
    logger.info("Shutting down AgentMemory Backend...")
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Long-Term Memory Research & Benchmarking API for AI Agents",
    lifespan=lifespan,
)

# Configure CORS for local development & future React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global Standardized Error Handlers (API-SPEC Section 2.4 & 14)
@app.exception_handler(AgentMemoryException)
async def agentmemory_exception_handler(request: Request, exc: AgentMemoryException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": {
                "code": "AM_ERR_VALIDATION_FAILED",
                "message": "Input validation failed.",
                "details": {"errors": jsonable_encoder(exc.errors())},
            },
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {"code": f"HTTP_{exc.status_code}", "message": str(exc.detail), "details": None},
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error during request %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "AM_ERR_INTERNAL_ERROR",
                "message": "An unexpected internal error occurred.",
                "details": None,
            },
        },
    )


# Mount all /api/v1 routers
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(projects.router, prefix=settings.API_V1_STR)
app.include_router(memories.router, prefix=settings.API_V1_STR)
app.include_router(datasets.router, prefix=settings.API_V1_STR)
app.include_router(experiments.router, prefix=settings.API_V1_STR)


@app.get("/health", tags=["System"])
async def health_check():
    """Verifies API responsiveness and PostgreSQL + pgvector database health."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "healthy", "database": "connected", "version": "1.0.0"}


@app.get("/", tags=["System"])
async def root():
    """Root API metadata and navigation endpoints."""
    return {
        "service": settings.PROJECT_NAME,
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/health",
        "api_v1": settings.API_V1_STR,
    }


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Silences automatic browser favicon requests with 204 No Content."""
    return Response(status_code=204)