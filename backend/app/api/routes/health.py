from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    service: str
    environment: str
    timestamp: datetime


@router.get("/health", response_model=HealthResponse, summary="Check service health")
async def health_check() -> HealthResponse:
    """Return a lightweight response suitable for uptime checks."""
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        environment=settings.environment,
        timestamp=datetime.now(UTC),
    )
