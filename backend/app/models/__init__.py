import json
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Text,
    Enum as SqlaEnum, LargeBinary as SqlaLargeBinary, DateTime
)
from app.core.database import Base

class UserRole(str, PyEnum):
    customer = "customer"
    specialist = "specialist"

class TaskStatus(str, PyEnum):
    open = "open"
    in_progress = "in_progress"
    completed = "completed"
    disputed = "disputed"    # открыт спор (арбитраж)
    cancelled = "cancelled"  # отменён (эскроу возвращён заказчику)

class TaskCategory(str, PyEnum):
    design = "design"
    development = "development"
    writing = "writing"
    repairs = "repairs"
    cleaning = "cleaning"
    delivery = "delivery"
    photo_video = "photo_video"
    tutoring = "tutoring"
    beauty = "beauty"
    events = "events"
    business = "business"
    other = "other"

class TransactionType(str, PyEnum):
    deposit = "deposit"
    escrow_hold = "escrow_hold"
    escrow_release = "escrow_release"
    escrow_refund = "escrow_refund"  # возврат эскроу заказчику (отмена/арбитраж)
    purchase = "purchase"            # покупка пакета откликов / PRO
    withdraw_hold = "withdraw_hold"      # заморозка под заявку на вывод средств
    withdraw_refund = "withdraw_refund"  # возврат заявки на вывод (отклонена/отменена)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(SqlaEnum(UserRole), default=UserRole.customer)
    name = Column(String, nullable=True)
    bio = Column(String, nullable=True)
    balance = Column(Integer, default=0)
    city = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    avatar = Column(String, nullable=True)
    portfolio = Column(Text, nullable=True)  # JSON string with portfolio items
    skills = Column(Text, nullable=True)     # JSON string with skills array
    verified = Column(Boolean, default=False)
    last_seen = Column(String, nullable=True) # ISO time of last activity
    response_credits = Column(Integer, default=5) # Paid responses bonus
    is_pro = Column(Boolean, default=False)       # PRO subscription
    pro_until = Column(String, nullable=True)
    # Времени регистрации не было — без него не посчитать рост пользователей
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    amount = Column(Integer)
    type = Column(SqlaEnum(TransactionType))
    task_id = Column(Integer, nullable=True)
    fee = Column(Integer, default=0) # Комиссия сервиса (например, 5% при escrow_release)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class VerificationStatus(str, PyEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class VerificationRequest(Base):
    __tablename__ = "verification_requests"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    full_name = Column(String)
    document_type = Column(String, default="passport") # passport / inn_self_employed
    document_number = Column(String, nullable=True)
    file_url = Column(String, nullable=True)
    status = Column(SqlaEnum(VerificationStatus), default=VerificationStatus.pending)
    rejection_reason = Column(String, nullable=True)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    resolved_at = Column(String, nullable=True)

class PaymentRecord(Base):
    __tablename__ = "payment_records"
    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(String, unique=True, index=True)
    user_id = Column(Integer, index=True)
    amount = Column(Integer)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    type = Column(String) # "new_response", "assigned", "message", "completed", "review"
    title = Column(String)
    text = Column(String)
    task_id = Column(Integer, nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class Response(Base):
    __tablename__ = "responses"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)
    specialist_id = Column(Integer)
    text = Column(String)
    proposed_price = Column(Integer, nullable=True)
    estimated_days = Column(Integer, nullable=True)

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(String)
    budget = Column(Integer, nullable=True)
    category = Column(SqlaEnum(TaskCategory), default=TaskCategory.other, index=True)
    customer_id = Column(Integer)
    executor_id = Column(Integer, nullable=True)
    status = Column(SqlaEnum(TaskStatus), default=TaskStatus.open)
    city = Column(String, nullable=True, index=True)
    address = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    deadline = Column(String, nullable=True)
    is_remote = Column(Boolean, default=False)
    images = Column(Text, nullable=True) # JSON string with image URLs
    # Времени создания не было вовсе — из-за этого нельзя было ни показать
    # «опубликовано 2 часа назад», ни построить метрики по дням.
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)
    sender_id = Column(Integer)
    text = Column(String)
    is_read = Column(Boolean, default=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class Review(Base):
    __tablename__ = "reviews"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)
    reviewer_id = Column(Integer)
    specialist_id = Column(Integer, index=True)
    rating = Column(Integer)
    comment = Column(String, nullable=True)
    target = Column(String, default="specialist")

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    token = Column(String, unique=True, index=True)
    expires_at = Column(String)
    used = Column(Boolean, default=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class DisputeStatus(str, PyEnum):
    open = "open"
    resolved_customer = "resolved_customer"    # арбитраж: деньги заказчику
    resolved_specialist = "resolved_specialist"  # арбитраж: деньги исполнителю
    closed = "closed"  # спор отозван инициатором

class Dispute(Base):
    __tablename__ = "disputes"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)
    opened_by = Column(Integer)  # user_id инициатора
    reason = Column(String)
    status = Column(SqlaEnum(DisputeStatus), default=DisputeStatus.open)
    resolution_comment = Column(String, nullable=True)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    resolved_at = Column(String, nullable=True)

class StoredFile(Base):
    __tablename__ = "stored_files"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    content_type = Column(String, default="image/jpeg")
    data = Column(SqlaLargeBinary)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())


class WithdrawalStatus(str, PyEnum):
    pending = "pending"      # ожидает решения модератора
    paid = "paid"            # выплачено
    rejected = "rejected"    # отклонено, деньги вернулись на баланс
    cancelled = "cancelled"  # отменено самим пользователем


class WithdrawalRequest(Base):
    """Заявка на вывод заработанных средств.

    Деньги списываются с баланса в момент подачи заявки (как эскроу при
    назначении исполнителя): иначе пользователь мог бы подать заявку,
    потратить баланс и уйти в минус к моменту решения модератора.
    При отклонении или отмене сумма возвращается на баланс.
    """
    __tablename__ = "withdrawal_requests"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    amount = Column(Integer)
    method = Column(String, default="card")   # card | sbp
    # Реквизиты — такие же персональные данные, как номер документа при
    # верификации, поэтому в БД лежат зашифрованными (см. app/core/security.py)
    requisites = Column(String)
    status = Column(SqlaEnum(WithdrawalStatus), default=WithdrawalStatus.pending)
    comment = Column(String, nullable=True)   # причина отклонения
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    resolved_at = Column(String, nullable=True)


class RefreshToken(Base):
    """Refresh токены для безопасной ротации access токенов.

    Access токены живут 15 минут, refresh токены — 7 дней.
    При компрометации access токена достаточно дождаться его истечения.
    Refresh токены можно отозвать через blacklist, что даёт контроль над сессиями.
    """
    __tablename__ = "refresh_tokens"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    token = Column(String, unique=True, index=True)  # jti (JWT ID)
    expires_at = Column(String)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    revoked = Column(Boolean, default=False)  # Отозван ли токен
    revoked_at = Column(String, nullable=True)
