import os
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    verify_refresh_token, rate_limit, oauth2_scheme
)
from app.core.csrf import verify_csrf
from app.models import User, PasswordResetToken, RefreshToken
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
def register(user: UserCreate, request: Request, db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
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

    # Создаём access токен (15 минут) и refresh токен (7 дней)
    access_token = create_access_token({
        "sub": str(user.id),
        "role": user.role.value if hasattr(user.role, "value") else str(user.role)
    })
    refresh_token, jti = create_refresh_token(user.id)

    # Сохраняем refresh токен в БД
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    db_refresh = RefreshToken(
        user_id=user.id,
        token=jti,
        expires_at=expires_at
    )
    db.add(db_refresh)
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "role": user.role.value if hasattr(user.role, "value") else str(user.role)
    }


@router.post("/refresh")
def refresh_access_token(refresh_token: str, db: Session = Depends(get_db)):
    """Обновляет access токен используя refresh токен.

    Access токены живут 15 минут, refresh токены — 7 дней.
    При компрометации access токена достаточно дождаться его истечения.
    """
    payload = verify_refresh_token(refresh_token, db)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Невалидный или отозванный refresh токен"
        )

    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    # Создаём новый access токен
    access_token = create_access_token({
        "sub": str(user.id),
        "role": user.role.value if hasattr(user.role, "value") else str(user.role)
    })

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


@router.post("/logout")
def logout(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Отзывает все refresh токены пользователя (выход со всех устройств)."""
    from app.core.security import decode_token
    payload = decode_token(token)
    user_id = int(payload.get("sub"))

    # Отзываем все refresh токены пользователя
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked == False
    ).update({
        "revoked": True,
        "revoked_at": datetime.now(timezone.utc)
    })
    db.commit()

    return {"message": "Вы вышли из всех устройств"}


@router.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    import time
    start_time = time.time()

    rate_limit(request, "forgot", limit=5, window_sec=3600)
    user = db.query(User).filter(User.email == req.email).first()
    dev_reset_link = None
    if user:
        token = secrets.token_urlsafe(32)
        reset = PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
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
            # В development без SMTP возвращаем ссылку в ответе, чтобы флоу можно было проверить.
            if not settings.IS_PRODUCTION:
                dev_reset_link = link

    # Защита от timing attack: всегда отвечаем за одинаковое время (~200ms)
    # Атакующий не может определить существует ли email в системе по времени ответа
    elapsed = time.time() - start_time
    if elapsed < 0.2:
        time.sleep(0.2 - elapsed)

    resp = {"message": "Если аккаунт существует, письмо со ссылкой отправлено"}
    if dev_reset_link:
        resp["dev_reset_link"] = dev_reset_link
    return resp

@router.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    reset = db.query(PasswordResetToken).filter(PasswordResetToken.token == req.token).first()
    if not reset or reset.used:
        raise HTTPException(400, "Ссылка недействительна или уже использована")
    if reset.expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "Ссылка истекла, запросите сброс заново")
    user = db.query(User).filter(User.id == reset.user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    user.hashed_password = hash_password(req.new_password)
    reset.used = True
    db.commit()
    return {"message": "Пароль обновлён, войдите с новым паролем"}
