import bcrypt
import os
import time
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List
from jose import JWTError, jwt
from fastapi import HTTPException, Request, Depends, status
from fastapi.security import OAuth2PasswordBearer
from app.core.config import settings
from app.core.logging import log_security_event

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# Время жизни токенов
ACCESS_TOKEN_EXPIRE_MINUTES = 15  # Короткий access token
REFRESH_TOKEN_EXPIRE_DAYS = 7     # Длинный refresh token

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


def generate_strong_password(length: int = 20) -> str:
    """Случайный пароль, заведомо проходящий политику из app/schemas.

    secrets.token_urlsafe здесь не годится: он может выдать строку без единой
    цифры, а политика требует хотя бы одну. Поэтому собираем сами и проверяем.
    """
    import string
    alphabet = string.ascii_letters + string.digits
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.isdigit() for c in candidate) and any(c.isalpha() for c in candidate):
            return candidate


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Создаёт access токен с коротким временем жизни (15 минут)."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(user_id: int) -> tuple[str, str]:
    """Создаёт refresh токен с длинным временем жизни (7 дней).

    Возвращает: (token_string, jti) где jti — уникальный ID токена для blacklist.
    """
    jti = secrets.token_urlsafe(32)  # JWT ID для отзыва
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {
        "sub": str(user_id),
        "exp": expire,
        "type": "refresh",
        "jti": jti
    }
    token = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, jti


def verify_refresh_token(token: str, db) -> Optional[dict]:
    """Проверяет refresh токен и возвращает payload.

    Проверяет:
    1. Подпись токена
    2. Срок действия
    3. Тип токена (должен быть refresh)
    4. Что токен есть в refresh_tokens, не отозван, принадлежит тому же юзеру
       и выпущен не раньше, чем создан сам аккаунт
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

        # Проверка типа токена
        if payload.get("type") != "refresh":
            return None

        # Белый список, а не чёрный. Раньше здесь искалась строка с revoked=True,
        # и отсутствие строки означало «токен жив». Из-за этого удаление записи
        # не отзывало токен, а воскрешало отозванный. Измерено: после удаления
        # аккаунта вместе с его токенами refresh выдавал access-токен на новый
        # аккаунт, которому достался тот же id. Теперь без строки токен мёртв.
        from app.models import RefreshToken
        jti = payload.get("jti")
        if not jti:
            return None  # без jti токен нечем отозвать — не принимаем

        row = db.query(RefreshToken).filter(RefreshToken.token == jti).first()
        if not row or row.revoked:
            return None

        # sub сверяем со строкой в базе, а не только с подписью: если id когда-то
        # переиспользуется, токен не должен «переехать» на нового владельца.
        if str(row.user_id) != str(payload.get("sub")):
            return None

        # Токен не может быть старше аккаунта. Совпадения user_id недостаточно:
        # аккаунт удаляют, строки его токенов остаются (обычная уборка трогает
        # только users), следующий пользователь получает тот же id — и живая
        # строка начинает указывать на него. Измерено: refresh-токеном удалённого
        # A выдавалась сессия новому B. Дата выпуска токена против даты создания
        # аккаунта эти случаи различает.
        from app.models import User
        user = db.query(User).filter(User.id == row.user_id).first()
        if user is None:
            return None
        if row.created_at and user.created_at and row.created_at < user.created_at:
            return None

        return payload
    except JWTError:
        return None

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


# ---------------------------------------------------------------------------
# Подпись ссылок на приватные файлы.
#
# `GET /files/{id}` публичен, а `id` — последовательное целое. Для аватаров и
# фотографий товаров это нормально, для вложений в личной переписке — нет.
# Токен ниже даёт доступ к конкретному файлу, не требуя заголовка Authorization:
# картинка в чате отрисовывается через `<img src>`, а он заголовки не шлёт.
#
# Подпись не хранится в БД и не выдаётся по запросу «дайте токен» — её считает
# сервер и подставляет в те ответы, где у получателя уже проверено право видеть
# файл (участник сделки в `app/api/chat.py`). Значит, обладание токеном
# равносильно праву на файл, и перебрать его нельзя.
#
# Оговорка: подпись выводится из SECRET_KEY, а в development ключ генерируется
# случайным при каждом старте. Ссылки на приватные файлы после перезапуска
# перестают работать — на dev это приемлемо, в production ключ фиксирован.
# ---------------------------------------------------------------------------

_FILE_TOKEN_PREFIX = "f1"


def sign_file_token(file_id: int) -> str:
    """Подпись для доступа к приватному файлу."""
    import hashlib
    import hmac

    digest = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"file:{file_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{_FILE_TOKEN_PREFIX}{digest}"


def verify_file_token(file_id: int, token: Optional[str]) -> bool:
    """Проверяет подпись файла. Сравнение постоянного времени."""
    import hmac

    if not token:
        return False
    return hmac.compare_digest(sign_file_token(file_id), token)


def file_url_with_token(url: Optional[str]) -> Optional[str]:
    """Дописывает подпись к внутренней ссылке `/files/<id>`.

    Нужна там, где файл отдаётся получателю с уже проверенным правом доступа —
    сейчас это сообщения чата. Для публичных файлов лишняя подпись безвредна:
    `GET /files/{id}` её просто не смотрит. Значения другого вида (например,
    унаследованные data-URL из старых сообщений) возвращаются как есть.
    """
    if not url or not url.startswith("/files/"):
        return url

    rest = url[len("/files/"):]
    file_id_part, _, _query = rest.partition("?")
    if not file_id_part.isdigit():
        return url

    token = sign_file_token(int(file_id_part))
    return f"/files/{file_id_part}?token={token}"


def is_admin(user) -> bool:
    """Права модератора платформы.

    Только строгое совпадение email из ADMIN_EMAILS: подстрочная проверка
    («admin» in email) выдала бы права модератора любому admin-vasya@x.com.
    Раньше эта функция была скопирована в трёх роутерах — теперь одна.

    Дефолта нет намеренно. Раньше при незаданной переменной админом
    становился владелец admin@delo.ru — а почта при регистрации не
    подтверждается, поэтому права модератора получал любой, кто первым
    занял этот адрес (и вместе с ними — очередь выплат с реквизитами).
    Нет переменной — нет модераторов.

    Список берём из settings, а не из os.environ напрямую: так он читается
    из того же .env, что и остальные настройки, и о пустом значении
    предупреждает старт приложения (app/core/config.py).
    """
    email = getattr(user, "email", None)
    return bool(email and email.lower() in settings.ADMIN_EMAILS)


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


def client_ip(request: Request) -> str:
    """Адрес клиента с учётом X-Forwarded-For от нашего прокси.

    Публичная, а не приватная: нужна не только лимитам, но и журналу событий
    безопасности. В аудите должен стоять адрес нарушителя, а не адрес
    обратного прокси, иначе все записи выглядят как один и тот же клиент.
    """
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


def _prune_rate_buckets(now: float, window_sec: int) -> None:
    """Чистит протухшие ключи, когда словарь разросся.

    Без этого каждый новый IP оставлял бы запись в памяти навсегда, и она
    росла бы вместе с числом клиентов.
    """
    if len(_rate_buckets) <= _MEMORY_KEYS_SOFT_LIMIT:
        return
    stale = [k for k, v in _rate_buckets.items() if not v or now - v[-1] > window_sec]
    for k in stale:
        _rate_buckets.pop(k, None)


def _rate_limit_memory(key: str, limit: int, window_sec: int) -> None:
    now = time.time()
    hits = [t for t in _rate_buckets.get(key, []) if now - t < window_sec]
    if len(hits) >= limit:
        _rate_buckets[key] = hits
        raise _too_many_requests()

    hits.append(now)
    _rate_buckets[key] = hits
    _prune_rate_buckets(now, window_sec)


def rate_limit(request: Request, bucket: str, limit: int = 60, window_sec: int = 60):
    if not settings.RATE_LIMIT_ENABLED:
        return

    ip = client_ip(request)
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


# ---------------------------------------------------------------------------
# Перебор пароля к конкретному аккаунту.
#
# Лимит выше считается по IP, и одного его мало. Злоумышленник с пула адресов
# (или просто с мобильного интернета, где адрес меняется на каждом запросе)
# получает свежие 10 попыток на каждый новый IP — а цель у него одна и та же
# учётная запись. Поэтому считаем ещё и по аккаунту, а не только по адресу.
#
# Считаем ТОЛЬКО неудачные попытки и обнуляем счётчик при успешном входе.
# Если считать все запросы подряд, знание чужой почты становится оружием:
# достаточно забить лимит мусорными паролями, и владелец не войдёт. Если не
# обнулять на успехе, владелец, восемь раз опечатавшийся, ждал бы окно зря.
# ---------------------------------------------------------------------------

ACCOUNT_LOGIN_LIMIT = 8
ACCOUNT_LOGIN_WINDOW_SEC = 900


def _account_key(email: str) -> str:
    # Регистр приводим сами: в базе почта лежит как введена при регистрации,
    # и Admin@delo.ru с admin@delo.ru иначе считались бы разными аккаунтами,
    # то есть лимит обходился бы сменой регистра.
    return f"rl:login_acct:{email.strip().lower()}"


def _account_failures(key: str, window_sec: int) -> int:
    """Сколько неудач накопилось по ключу. Ничего не меняет и не бросает."""
    client = _get_redis()
    if client is not None:
        try:
            value = client.get(key)
            return int(value) if value else 0
        except Exception as exc:
            print(f"[rate_limit] сбой Redis ({exc}); считаем в памяти процесса")
    now = time.time()
    return len([t for t in _rate_buckets.get(key, []) if now - t < window_sec])


def check_account_login_allowed(
    request: Request,
    email: str,
    limit: int = ACCOUNT_LOGIN_LIMIT,
    window_sec: int = ACCOUNT_LOGIN_WINDOW_SEC,
) -> None:
    """Отказывает, если по этому аккаунту уже набралось неудач сверх меры.

    Вызывать ДО проверки пароля: смысл в том, чтобы не давать перебирать.
    """
    if not settings.RATE_LIMIT_ENABLED:
        return

    key = _account_key(email)
    failures = _account_failures(key, window_sec)
    if failures >= limit:
        log_security_event(
            event_type="login_account_throttled",
            ip=client_ip(request),
            details=f"account={email.strip().lower()}, failures={failures}, limit={limit}",
        )
        minutes = max(1, window_sec // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Слишком много неудачных попыток входа в этот аккаунт. "
                f"Повторите через {minutes} мин."
            ),
        )


def record_login_failure(email: str, window_sec: int = ACCOUNT_LOGIN_WINDOW_SEC) -> None:
    if not settings.RATE_LIMIT_ENABLED:
        return

    key = _account_key(email)
    client = _get_redis()
    if client is not None:
        try:
            count = client.incr(key)
            if count == 1:
                client.expire(key, window_sec)
            return
        except Exception as exc:
            print(f"[rate_limit] сбой Redis ({exc}); считаем в памяти процесса")

    now = time.time()
    hits = [t for t in _rate_buckets.get(key, []) if now - t < window_sec]
    hits.append(now)
    _rate_buckets[key] = hits
    _prune_rate_buckets(now, window_sec)


def clear_login_failures(email: str) -> None:
    """Успешный вход обнуляет счётчик: владелец не должен ждать окна."""
    key = _account_key(email)
    client = _get_redis()
    if client is not None:
        try:
            client.delete(key)
        except Exception as exc:
            print(f"[rate_limit] сбой Redis ({exc}); чистим в памяти процесса")
    _rate_buckets.pop(key, None)

