from pydantic import BaseModel, EmailStr, field_validator, Field
from typing import Optional, List
import json

from app.models import UserRole, TaskStatus, TaskCategory, TransactionType

MAX_TASK_IMAGES = 10
MAX_IMAGE_PATH_LEN = 500

# bcrypt молча обрезает всё после 72-го байта, поэтому два разных длинных пароля
# с общим префиксом стали бы эквивалентны — длину проверяем явно.
BCRYPT_MAX_BYTES = 72


def _check_password(v: str) -> str:
    """Единая политика пароля для регистрации и сброса.

    Порог в 8 символов совпадает с тем, что обещает интерфейс
    («Пароль (от 8 символов)»).
    """
    if len(v) < 8:
        raise ValueError("Пароль должен содержать минимум 8 символов")
    if len(v.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError("Пароль слишком длинный: максимум 72 байта")
    return v


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: UserRole = UserRole.customer
    name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        return _check_password(v)

class UserOut(BaseModel):
    id: int
    email: EmailStr
    role: UserRole
    name: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    balance: int = 0
    verified: bool = False
    is_pro: bool = False
    response_credits: int = 5
    rating: Optional[float] = None
    reviews_count: Optional[int] = None
    is_online: Optional[bool] = False

    class Config:
        from_attributes = True

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    skills: Optional[str] = None  # JSON string
    portfolio: Optional[str] = None  # JSON string

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        return _check_password(v)

MIN_WITHDRAWAL = 500
WITHDRAWAL_METHODS = {"card", "sbp"}

class WithdrawalCreateRequest(BaseModel):
    """Заявка на вывод заработанных средств."""
    amount: int = Field(gt=0, description="Сумма вывода в рублях")
    method: str = "card"          # card — на карту, sbp — по номеру телефона
    requisites: str               # номер карты или телефон

    @field_validator("method")
    @classmethod
    def _validate_method(cls, v: str) -> str:
        if v not in WITHDRAWAL_METHODS:
            raise ValueError("Способ вывода: card или sbp")
        return v

    @field_validator("requisites")
    @classmethod
    def _validate_requisites(cls, v: str) -> str:
        clean = (v or "").strip()
        if len(clean) < 5:
            raise ValueError("Укажите реквизиты для выплаты")
        if len(clean) > 100:
            raise ValueError("Реквизиты слишком длинные")
        return clean

class WithdrawalReviewRequest(BaseModel):
    action: str                   # approve | reject
    comment: Optional[str] = None

class TaskCreate(BaseModel):
    title: str
    description: str
    budget: Optional[int] = None
    category: TaskCategory = TaskCategory.other
    city: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    deadline: Optional[str] = None
    is_remote: bool = False
    images: Optional[str] = None

    @field_validator("images")
    @classmethod
    def _validate_images(cls, v: Optional[str]) -> Optional[str]:
        """Изображения приходят JSON-строкой — проверяем, что это список строк.

        Раньше значение уходило в колонку как есть, а читалось потом через
        json.loads: одна кривая строка ломала открытие задания.
        """
        if v is None or v == "":
            return None
        try:
            parsed = json.loads(v)
        except (TypeError, ValueError):
            raise ValueError("Поле images должно быть JSON-массивом")

        if not isinstance(parsed, list):
            raise ValueError("Поле images должно быть JSON-массивом")
        if len(parsed) > MAX_TASK_IMAGES:
            raise ValueError(f"Не больше {MAX_TASK_IMAGES} изображений на задание")

        for item in parsed:
            if not isinstance(item, str):
                raise ValueError("Элементы images должны быть строками")
            if len(item) > MAX_IMAGE_PATH_LEN:
                raise ValueError("Слишком длинный путь к изображению")

        return json.dumps(parsed, ensure_ascii=False)

class TaskOut(TaskCreate):
    id: int
    customer_id: int
    executor_id: Optional[int] = None
    status: str
    responses_count: Optional[int] = 0
    distance_km: Optional[float] = None

    class Config:
        from_attributes = True

class ResponseCreate(BaseModel):
    text: str
    proposed_price: Optional[int] = None
    estimated_days: Optional[int] = None

class ResponseOut(ResponseCreate):
    id: int
    task_id: int
    specialist_id: int
    specialist_name: Optional[str] = None
    specialist_avatar: Optional[str] = None
    specialist_rating: Optional[float] = None
    specialist_reviews_count: Optional[int] = 0

    class Config:
        from_attributes = True

class MessageCreate(BaseModel):
    text: str

class MessageOut(BaseModel):
    id: int
    task_id: int
    sender_id: int
    text: str
    is_read: bool = False
    created_at: str
    sender_name: Optional[str] = None

    class Config:
        from_attributes = True

class ChatDialogOut(BaseModel):
    task_id: int
    task_title: str
    task_status: str
    task_budget: Optional[int] = None
    other_user_id: Optional[int] = None
    other_user_name: Optional[str] = None
    other_user_avatar: Optional[str] = None
    other_user_role: Optional[str] = None
    last_message: Optional[str] = None
    last_message_time: Optional[str] = None
    unread_count: int = 0

class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = ""
    target: Optional[str] = "specialist"

class ReviewOut(BaseModel):
    id: int
    task_id: int
    reviewer_id: int
    reviewer_name: Optional[str] = None
    specialist_id: int
    rating: int
    comment: Optional[str] = None
    target: str = "specialist"

    class Config:
        from_attributes = True

class DepositRequest(BaseModel):
    amount: int

class DisputeCreate(BaseModel):
    reason: str = Field(min_length=5, max_length=2000)

class DisputeResolve(BaseModel):
    decision: str  # "refund_customer" | "pay_specialist"
    comment: Optional[str] = None

class SpecialistOut(BaseModel):
    id: int
    name: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    avatar: Optional[str] = None
    skills: Optional[str] = None
    verified: bool = False
    is_pro: bool = False
    rating: Optional[float] = None
    reviews_count: int = 0
    completed_tasks: int = 0
    online: bool = False

class VerificationSubmitRequest(BaseModel):
    full_name: str
    document_type: str = "passport" # passport, inn_self_employed
    document_number: Optional[str] = None
    file_url: Optional[str] = None

class VerificationReviewRequest(BaseModel):
    action: str # "approve" or "reject"
    reason: Optional[str] = None

class VerificationRequestOut(BaseModel):
    id: int
    user_id: int
    full_name: str
    document_type: str
    document_number: Optional[str] = None
    file_url: Optional[str] = None
    status: str
    rejection_reason: Optional[str] = None
    created_at: str
    resolved_at: Optional[str] = None

    class Config:
        from_attributes = True

class VerificationStatusOut(BaseModel):
    verified: bool
    request: Optional[VerificationRequestOut] = None

class AIChatRequest(BaseModel):
    prompt: str
    current_task: Optional[dict] = None
