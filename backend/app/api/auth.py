import os
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    hash_password, verify_password, create_access_token,
    rate_limit, oauth2_scheme
)
from app.models import User, PasswordResetToken
from app.schemas import (
    UserCreate, ForgotPasswordRequest, ResetPasswordRequest
)

router = APIRouter(tags=["Authentication"])

def send_email(to: str, subject: str, body: str):
    import smtplib
    from email.mime.text import MIMEText
    host = os.environ.get("SMTP_HOST")
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    if not host or not user or not password:
        raise HTTPException(503, "Почтовый сервис не настроен. Обратитесь к администратору.")
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = os.environ.get("SMTP_FROM", user)
    msg["To"] = to
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=20) as server:
        server.starttls()
        server.login(user, password)
        server.send_message(msg)

@router.post("/register/")
def register(user: UserCreate, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, "register", limit=5, window_sec=3600)
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(400, "Email уже зарегистрирован в системе")
    new_user = User(
        email=user.email,
        hashed_password=hash_password(user.password),
        role=user.role,
        name=user.name
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "Успешная регистрация", "user_id": new_user.id}

@router.post("/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    rate_limit(request, "login", limit=10, window_sec=300)
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    token = create_access_token({"sub": str(user.id), "role": user.role.value if hasattr(user.role, "value") else str(user.role)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role.value if hasattr(user.role, "value") else str(user.role)
    }

@router.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, "forgot", limit=5, window_sec=3600)
    user = db.query(User).filter(User.email == req.email).first()
    if user:
        token = secrets.token_urlsafe(32)
        reset = PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=(datetime.utcnow() + timedelta(hours=1)).isoformat()
        )
        db.add(reset)
        db.commit()
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
        link = f"{frontend_url}/reset?token={token}"
        try:
            send_email(
                req.email,
                "ДЕЛО — сброс пароля",
                f"Здравствуйте!\n\nКто-то запросил сброс пароля на маркетплейсе ДЕЛО.\n"
                f"Ссылка действительна 1 час:\n\n{link}\n\n"
                f"Если вы не запрашивали сброс — просто проигнорируйте это письмо."
            )
        except Exception:
            pass
    return {"message": "Если аккаунт существует, письмо со ссылкой отправлено"}

@router.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    reset = db.query(PasswordResetToken).filter(PasswordResetToken.token == req.token).first()
    if not reset or reset.used:
        raise HTTPException(400, "Ссылка недействительна или уже использована")
    if datetime.fromisoformat(reset.expires_at) < datetime.utcnow():
        raise HTTPException(400, "Ссылка истекла, запросите сброс заново")
    user = db.query(User).filter(User.id == reset.user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    user.hashed_password = hash_password(req.new_password)
    reset.used = True
    db.commit()
    return {"message": "Пароль обновлён, войдите с новым паролем"}
