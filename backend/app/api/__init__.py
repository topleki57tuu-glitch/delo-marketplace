from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.tasks import router as tasks_router
from app.api.responses import router as responses_router
from app.api.reviews import router as reviews_router
from app.api.chat import router as chat_router
from app.api.payments import router as payments_router
from app.api.files import router as files_router
from app.api.notifications import router as notifications_router
from app.api.ai import router as ai_router

__all__ = [
    "auth_router",
    "users_router",
    "tasks_router",
    "responses_router",
    "reviews_router",
    "chat_router",
    "payments_router",
    "files_router",
    "notifications_router",
    "ai_router"
]
