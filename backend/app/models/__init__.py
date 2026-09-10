import json
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Text,
    Enum as SqlaEnum, LargeBinary as SqlaLargeBinary
)
from app.core.database import Base

class UserRole(str, PyEnum):
    customer = "customer"
    specialist = "specialist"

class TaskStatus(str, PyEnum):
    open = "open"
    in_progress = "in_progress"
    completed = "completed"

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

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    amount = Column(Integer)
    type = Column(SqlaEnum(TransactionType))
    task_id = Column(Integer, nullable=True)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

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

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)
    sender_id = Column(Integer)
    text = Column(String)
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

class StoredFile(Base):
    __tablename__ = "stored_files"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    content_type = Column(String, default="image/jpeg")
    data = Column(SqlaLargeBinary)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
