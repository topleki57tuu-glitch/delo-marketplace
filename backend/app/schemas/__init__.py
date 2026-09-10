from pydantic import BaseModel, EmailStr, field_validator, Field
from typing import Optional, List
from app.models import UserRole, TaskStatus, TaskCategory, TransactionType

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: UserRole = UserRole.customer
    name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Пароль должен содержать минимум 6 символов")
        return v

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
        if len(v) < 6:
            raise ValueError("Пароль должен содержать минимум 6 символов")
        return v

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
    created_at: str
    sender_name: Optional[str] = None

    class Config:
        from_attributes = True

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

class AIChatRequest(BaseModel):
    prompt: str
    current_task: Optional[dict] = None
