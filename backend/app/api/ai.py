from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.schemas import AIChatRequest

router = APIRouter(prefix="/ai", tags=["AI Assistant"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

@router.post("/task-helper")
def assist_task_creation(req: AIChatRequest, token: str = Depends(oauth2_scheme)):
    decode_token_or_401(token)
    prompt = req.prompt.strip()
    
    # Smart helper logic for task structuring
    suggested_category = "other"
    lower = prompt.lower()
    if any(w in lower for w in ["сайт", "код", "программ", "разработк", "бот", "frontend", "backend"]):
        suggested_category = "development"
    elif any(w in lower for w in ["дизайн", "логотип", "баннер", "макет", "figma"]):
        suggested_category = "design"
    elif any(w in lower for w in ["текст", "стать", "копирайт", "перевод"]):
        suggested_category = "writing"
    elif any(w in lower for w in ["ремонт", "починить", "сантехник", "электрик"]):
        suggested_category = "repairs"
    elif any(w in lower for w in ["уборка", "клининг", "мыть"]):
        suggested_category = "cleaning"
    elif any(w in lower for w in ["доставка", "курьер", "привезти"]):
        suggested_category = "delivery"
    elif any(w in lower for w in ["фото", "видео", "монтаж", "съемка"]):
        suggested_category = "photo_video"
    elif any(w in lower for w in ["репетитор", "урок", "английский", "обучение"]):
        suggested_category = "tutoring"

    title_suggestion = prompt.split(".")[0].strip()[:80]
    if len(title_suggestion) < 5:
        title_suggestion = f"Требуется специалист: {prompt[:50]}"

    structured_description = (
        f"{prompt}\n\n"
        f"📋 Требования к исполнителю:\n"
        f"• Качественное и своевременное выполнение работы\n"
        f"• Наличие примеров аналогичных работ или опыта\n"
        f"• Быть на связи в процессе выполнения"
    )

    return {
        "suggested_title": title_suggestion,
        "suggested_description": structured_description,
        "suggested_category": suggested_category,
        "suggested_budget": 3000 if not req.current_task or not req.current_task.get("budget") else req.current_task.get("budget")
    }
