from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
import asyncio

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import settings
from app.fieldwork.store import initialize_database
from app.services.workflow import recover_tasks
from app.services.tide_report import weekly_tide_refresh_loop


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Reserve a single place for startup and shutdown resources."""
    initialize_database()
    recover_tasks()
    stop_event = asyncio.Event()
    refresh_task = asyncio.create_task(weekly_tide_refresh_loop(stop_event), name="weekly-tide-refresh")
    try:
        yield
    finally:
        stop_event.set()
        refresh_task.cancel()
        try:
            await refresh_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Backend API for MountainLore.",
    debug=settings.debug,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "request_error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail, "request_id": "request-error"})


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"message": f"Welcome to {settings.app_name}"}
