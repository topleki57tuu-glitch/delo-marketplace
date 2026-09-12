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
from app.api.disputes import router as disputes_router
from app.api.verification import router as verification_router
from app.api.withdrawals import router as withdrawals_router
from app.api.admin import router as admin_router

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
    "ai_router",
    "disputes_router",
    "verification_router",
    "withdrawals_router",
    "admin_router"
]
