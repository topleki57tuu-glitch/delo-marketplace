import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
import jwt
from jwt import PyJWTError as JWTError
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.enums import enum_value
from app.core.security import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    verify_refresh_token, rate_limit, oauth2_scheme,
    check_account_login_allowed, record_login_failure, clear_login_failures,
    find_user_by_email, is_reserved_admin_email, normalize_email,
)
from app.core.csrf import verify_csrf
from app.core.money import claim
from app.core.email import EmailNotConfigured, send_email_sync
from app.core.legal import CONSENT_REQUIRED_MESSAGE, LEGAL_VERSION
from app.models import User, PasswordResetToken, RefreshToken, UserRole
from app.schemas import (
    UserCreate, ForgotPasswordRequest, ResetPasswordRequest, RefreshTokenRequest
)

router = APIRouter(tags=["Authentication"])

logger = logging.getLogger(__name__)

@router.post("/register/")
def register(user: UserCreate, request: Request, db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    rate_limit(request, "register", limit=5, window_sec=3600)
    # Без согласия аккаунт не создаём: иначе мы начали бы обрабатывать
    # персональные данные (email, имя) без правового основания. Проверка
    # здесь, а не только в форме, — API доступен и в обход фронтенда.
    if not (user.accept_terms and user.pd_consent):
        raise HTTPException(400, CONSENT_REQUIRED_MESSAGE)
    # Почту храним в каноническом виде и дубли ищем без учёта регистра:
    # иначе рядом с admin@delo.ru регистрировался «Admin@delo.ru».
    email = normalize_email(user.email)
    # Адреса модераторов с сайта не регистрируются: почта здесь не
    # подтверждается, и права модератора получил бы тот, кто первым занял
    # адрес из ADMIN_EMAILS. Аккаунт модератора заводится на сервере
    # (scripts/admin_access.sh). Ответ тот же, что для занятого адреса, —
    # по нему не узнать, какие адреса принадлежат модераторам.
    if is_reserved_admin_email(email) or db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(400, "Email уже зарегистрирован в системе")
    # Роль задаём сами: в схеме её больше нет, иначе клиент мог бы сразу
    # зарегистрироваться специалистом в обход обычного переключения роли.
    now = datetime.utcnow()
    new_user = User(
        email=email,
        hashed_password=hash_password(user.password),
        role=UserRole.customer,
        name=user.name,
        terms_accepted_at=now,
        pd_consent_at=now,
        legal_version=LEGAL_VERSION,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "Успешная регистрация", "user_id": new_user.id}

# Хэш случайной строки для выравнивания времени ответа при неизвестном email.
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(16))


def _reset_token_digest(token: str) -> str:
    """Токен сброса хранится в базе только как SHA-256.

    Раньше в таблице лежал сам токен: любой, кто видел дамп или реплику базы
    (бэкап, read-only доступ аналитика), мог сбросить пароль любому, у кого
    ссылка ещё действует. Токен — 32 байта случайности, поэтому соль и
    медленный хэш не нужны: перебирать нечего.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    rate_limit(request, "login", limit=10, window_sec=300)
    # Лимит по IP не мешает перебирать ОДИН аккаунт с разных адресов: каждый
    # новый адрес приносит свои 10 попыток. Поэтому перед проверкой пароля
    # смотрим счётчик неудач по самой учётной записи.
    check_account_login_allowed(request, form.username)

    user = find_user_by_email(db, form.username)
    if not user:
        # bcrypt всё равно считаем: без этого ответ для несуществующего email
        # приходил на ~200 мс быстрее, и по времени перебирались
        # зарегистрированные адреса.
        verify_password(form.password, _DUMMY_PASSWORD_HASH)
    if not user or not verify_password(form.password, user.hashed_password):
        record_login_failure(form.username)
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    # Вход удался — снимаем счётчик, иначе владелец, опечатавшийся восемь раз,
    # ждал бы окно, уже доказав, что пароль знает.
    clear_login_failures(form.username)

    # Создаём access токен (15 минут) и refresh токен (7 дней)
    access_token = create_access_token({
        "sub": str(user.id),
        "role": enum_value(user.role)
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
        "role": enum_value(user.role)
    }


def _access_token_from_refresh(refresh_token: str, db: Session) -> dict:
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
        "role": enum_value(user.role)
    })

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": enum_value(user.role),
    }


@router.post("/refresh")
def refresh_access_token(refresh_token: str, db: Session = Depends(get_db)):
    """Обновляет access токен используя refresh токен.

    Access токены живут 15 минут, refresh токены — 7 дней.
    При компрометации access токена достаточно дождаться его истечения.

    Старый вход: токен в строке запроса. Оставлен для API-клиентов и тестов,
    фронтенд ходит в /auth/refresh.
    """
    return _access_token_from_refresh(refresh_token, db)


@router.post("/auth/refresh")
def refresh_access_token_from_body(req: RefreshTokenRequest, db: Session = Depends(get_db)):
    """Обновить access-токен; refresh-токен — в теле запроса.

    Фронтенд продлевает сессию сам, когда access-токен истёк (15 минут).
    Раньше продления не было вовсе: через 15 минут после входа все запросы
    получали 401, а интерфейс продолжал показывать пользователя вошедшим.

    Отдельный путь, а не /refresh, по двум причинам. /refresh не проксирует
    production-nginx: POST уходил в SPA и получал 405. /auth/* nginx и Vite
    уже отправляют на бэкенд. И токен в теле, а не в адресе: адрес запроса
    пишется в журналы прокси, а refresh-токен — это 7 дней доступа.

    CSRF здесь не нужен: запрос ничего не берёт из cookie, право на него
    даёт только сам refresh-токен.
    """
    return _access_token_from_refresh(req.refresh_token, db)


@router.post("/auth/logout")
def logout_this_device(req: RefreshTokenRequest, db: Session = Depends(get_db)):
    """Выход на этом устройстве: отзывает переданный refresh-токен.

    /logout ниже отзывает токены на всех устройствах и требует живой
    access-токен — а при выходе он мог уже истечь. Здесь достаточно самого
    refresh-токена. Отвечаем 200 и на просроченный или уже отозванный
    токен: выйти должно получаться всегда, а мёртвый токен отзывать незачем.
    """
    try:
        payload = jwt.decode(req.refresh_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        payload = None
    jti = payload.get("jti") if payload and payload.get("type") == "refresh" else None
    if jti:
        db.query(RefreshToken).filter(
            RefreshToken.token == jti,
            RefreshToken.user_id == int(payload.get("sub")),
            RefreshToken.revoked == False,  # noqa: E712
        ).update({
            "revoked": True,
            "revoked_at": datetime.now(timezone.utc),
        })
        db.commit()
    return {"message": "Вы вышли из аккаунта"}


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
    user = find_user_by_email(db, req.email)
    dev_reset_link = None
    if user:
        token = secrets.token_urlsafe(32)
        reset = PasswordResetToken(
            user_id=user.id,
            token=_reset_token_digest(token),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
        )
        db.add(reset)
        db.commit()
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
        link = f"{frontend_url}/reset?token={token}"
        try:
            send_email_sync(
                user.email,
                "ДЕЛО — сброс пароля",
                f"Здравствуйте!\n\nКто-то запросил сброс пароля на маркетплейсе ДЕЛО.\n"
                f"Ссылка действительна 1 час:\n\n{link}\n\n"
                f"Если вы не запрашивали сброс — просто проигнорируйте это письмо."
            )
        except EmailNotConfigured:
            # Штатный случай на стенде: SMTP не задан. В development возвращаем
            # ссылку в ответе, чтобы флоу можно было проверить.
            if not settings.IS_PRODUCTION:
                dev_reset_link = link
        except Exception as exc:
            # SMTP задан, но письмо не ушло. Раньше это молча проглатывалось:
            # в продакшене пользователь не получал ссылку, а в логе не было
            # ни строки. Теперь сбой видно.
            logger.warning("Письмо о сбросе пароля не отправлено: %s", exc)
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
    reset = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == _reset_token_digest(req.token)
    ).first()
    if not reset or reset.used:
        raise HTTPException(400, "Ссылка недействительна или уже использована")
    # Колонка DateTime без timezone=True отдаёт naive datetime, а сравнивать
    # его с aware нельзя — было TypeError и 500 на каждом сбросе пароля.
    # Приводим прочитанное значение к UTC, а не полагаемся на то, как СУБД
    # вернула тип.
    expires_at = reset.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is not None and expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "Ссылка истекла, запросите сброс заново")
    user = db.query(User).filter(User.id == reset.user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    # Токен гасится условным UPDATE: два одновременных запроса с одной
    # ссылкой иначе оба проходили проверку `used` выше.
    if not claim(db, PasswordResetToken,
                 [PasswordResetToken.id == reset.id, PasswordResetToken.used == False],  # noqa: E712
                 {"used": True}):
        db.rollback()
        raise HTTPException(400, "Ссылка недействительна или уже использована")
    user.hashed_password = hash_password(req.new_password)

    # Сброс пароля — это обычно «меня взломали». Значит, все выданные сессии
    # должны умереть: раньше refresh-токены переживали сброс, и угнанная
    # сессия продолжала жить свои 7 дней с новым паролем владельца.
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id,
        RefreshToken.revoked == False,  # noqa: E712
    ).update({
        "revoked": True,
        "revoked_at": datetime.now(timezone.utc),
    }, synchronize_session=False)
    # Остальные неиспользованные ссылки на сброс этого пользователя тоже гасим.
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used == False,  # noqa: E712
    ).update({"used": True}, synchronize_session=False)
    db.commit()
    return {"message": "Пароль обновлён, войдите с новым паролем"}
