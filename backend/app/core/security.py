import bcrypt
import os
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from jose import JWTError, jwt
from fastapi import HTTPException, Request, Depends, status
from fastapi.security import OAuth2PasswordBearer
from app.core.config import settings
from app.core.logging import log_security_event

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=7)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или просроченный токен авторизации",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Шифрование чувствительных данных (номера документов при верификации).
#
# В базе номер паспорта/ИНН хранится не открытым текстом, а токеном Fernet:
# при утечке дампа персональные данные не читаются. Ключ выводим из SECRET_KEY
# через SHA-256 — отдельную переменную окружения не заводим, чтобы не плодить
# обязательные настройки и не забыть их выставить в проде.
# ---------------------------------------------------------------------------

# Fernet-токены всегда начинаются с этой версии — по ней отличаем
# зашифрованные записи от унаследованных незашифрованных.
_FERNET_PREFIX = "gAAAAA"


def _fernet() -> "Fernet":
    import base64
    import hashlib
    from cryptography.fernet import Fernet

    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_sensitive(value: Optional[str]) -> Optional[str]:
    """Шифрует значение для хранения в БД. Пустое значение возвращает как есть."""
    if value is None or value == "":
        return value
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_sensitive(value: Optional[str]) -> Optional[str]:
    """Расшифровывает значение из БД.

    Записи, сделанные до включения шифрования, лежат открытым текстом — их
    возвращаем как есть, чтобы не потерять доступ к уже поданным заявкам.
    Если токен похож на Fernet, но не расшифровывается (сменился SECRET_KEY),
    возвращаем None: показать шифротекст вместо номера хуже, чем ничего.
    """
    if value is None or value == "":
        return value
    if not value.startswith(_FERNET_PREFIX):
        return value  # унаследованная незашифрованная запись
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except Exception:
        return None


def mask_document_number(value: Optional[str]) -> Optional[str]:
    """Маскирует номер документа, оставляя последние 4 символа."""
    if not value:
        return value
    clean = value.strip()
    if len(clean) <= 4:
        return "•" * len(clean)
    return "•" * (len(clean) - 4) + clean[-4:]


def mask_requisites(value: Optional[str]) -> Optional[str]:
    """Маскирует платёжные реквизиты, оставляя последние 4 символа."""
    if not value:
        return value
    clean = value.strip()
    if len(clean) <= 4:
        return "•" * len(clean)
    return "•" * (len(clean) - 4) + clean[-4:]


def is_admin(user) -> bool:
    """Права модератора платформы.

    Только строгое совпадение email из ADMIN_EMAILS: подстрочная проверка
    («admin» in email) выдала бы права модератора любому admin-vasya@x.com.
    Раньше эта функция была скопирована в трёх роутерах — теперь одна.
    """
    raw = os.environ.get("ADMIN_EMAILS", "admin@delo.ru")
    admins = [e.strip().lower() for e in raw.split(",") if e.strip()]
    email = getattr(user, "email", None)
    return bool(email and email.lower() in admins)


# ---------------------------------------------------------------------------
# Ограничение частоты запросов.
#
# Счётчики живут в Redis, если задан REDIS_URL, иначе — в памяти процесса.
# Память подходит для одного воркера; при нескольких воркерах у каждого свой
# словарь и реальный порог умножается на их число, поэтому в проде нужен Redis.
# ---------------------------------------------------------------------------

_rate_buckets: Dict[str, List[float]] = {}
_redis_client = None
_redis_checked = False
_MEMORY_KEYS_SOFT_LIMIT = 1000


def _get_redis():
    """Ленивая инициализация клиента Redis. None — если он не настроен или недоступен."""
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client
    _redis_checked = True

    url = settings.REDIS_URL
    if not url:
        return None
    try:
        import redis

        client = redis.Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
        client.ping()
        _redis_client = client
    except Exception as exc:  # нет пакета, нет соединения, нет прав — не падаем
        print(f"[rate_limit] Redis недоступен ({exc}); считаем лимиты в памяти процесса")
        _redis_client = None
    return _redis_client


def _client_ip(request: Request) -> str:
    import ipaddress
    client_host = request.client.host if request.client else "unknown"
    # X-Forwarded-For доверяем только когда запрос пришёл с приватного адреса —
    # т.е. с нашего собственного reverse-proxy. Иначе клиент подделает заголовок
    # и обойдёт лимит. Берём последнюю запись — её добавил ближайший прокси.
    forwarded = request.headers.get("x-forwarded-for")
    try:
        is_private = ipaddress.ip_address(client_host).is_private
    except ValueError:
        is_private = False
    if forwarded and is_private:
        return forwarded.split(",")[-1].strip()
    return request.headers.get("x-real-ip") or client_host


def _too_many_requests() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Слишком много запросов, пожалуйста, повторите попытку через минуту",
    )


def _rate_limit_memory(key: str, limit: int, window_sec: int) -> None:
    now = time.time()
    hits = [t for t in _rate_buckets.get(key, []) if now - t < window_sec]
    if len(hits) >= limit:
        _rate_buckets[key] = hits
        raise _too_many_requests()

    hits.append(now)
    _rate_buckets[key] = hits

    # Чистим протухшие ключи: без этого каждый новый IP оставлял бы запись
    # в словаре навсегда и память росла бы вместе с числом клиентов.
    if len(_rate_buckets) > _MEMORY_KEYS_SOFT_LIMIT:
        stale = [k for k, v in _rate_buckets.items() if not v or now - v[-1] > window_sec]
        for k in stale:
            _rate_buckets.pop(k, None)


def rate_limit(request: Request, bucket: str, limit: int = 60, window_sec: int = 60):
    if not settings.RATE_LIMIT_ENABLED:
        return

    ip = _client_ip(request)
    key = f"rl:{bucket}:{ip}"

    client = _get_redis()
    if client is not None:
        try:
            count = client.incr(key)
            if count == 1:
                client.expire(key, window_sec)
            if count > limit:
                # Логируем превышение лимита
                log_security_event(
                    event_type="rate_limit_exceeded",
                    ip=ip,
                    details=f"bucket={bucket}, count={count}, limit={limit}"
                )
                raise _too_many_requests()
            return
        except HTTPException:
            raise
        except Exception as exc:
            # Redis отвалился на ходу — не роняем запрос, досчитываем в памяти
            print(f"[rate_limit] сбой Redis ({exc}); переходим на память процесса")

    _rate_limit_memory(key, limit, window_sec)

