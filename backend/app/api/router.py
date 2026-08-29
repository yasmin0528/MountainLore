from fastapi import APIRouter

from app.api.routes import fieldwork, health, workbench

api_router = APIRouter()
api_router.include_router(health.router, tags=["system"])
api_router.include_router(fieldwork.router, tags=["fieldwork"])
api_router.include_router(workbench.router, tags=["workbench"])
