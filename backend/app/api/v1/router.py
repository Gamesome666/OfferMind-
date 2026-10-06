"""v1 路由聚合：各领域路由在此挂载。"""
from fastapi import APIRouter

from app.api.v1 import (
    admin,
    answers,
    auth,
    health,
    history,
    interview,
    report,
    resume,
    training,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(training.router, tags=["training"])
api_router.include_router(answers.router, tags=["answers"])
api_router.include_router(resume.router, tags=["resume"])
api_router.include_router(interview.router, tags=["interview"])
api_router.include_router(report.router, tags=["report"])
api_router.include_router(history.router, tags=["history"])
api_router.include_router(admin.router, tags=["admin"])
