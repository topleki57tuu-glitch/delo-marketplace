from pydantic import BaseModel, EmailStr, field_validator, Field
from typing import Optional, List
import json
import re
from datetime import date, datetime, timedelta

from app.models import UserRole, TaskStatus, TaskCategory, TransactionType

MAX_TASK_IMAGES = 10
MAX_IMAGE_PATH_LEN = 500

# Максимальная длина ссылки на вложение в сообщении чата.
#
# Раньше ограничения не было вообще, а фронтенд клал в это поле data-URL
# целиком (`FileReader.readAsDataURL` с клиентским лимитом 10 МБ). Файл на
# 10 МБ превращался в ~13.4 МБ base64 внутри одной строки БД, и столько же
# приезжало на каждое чтение чата — ответ рос линейно от числа картинок
# в переписке. Замер: вложение 1.5 МБ → ответ 1.5 МБ, два вложения → 3.0 МБ.
#
# Теперь вложение сначала загружается в `/upload/image` (лимит файла 5 МБ),
# а в поле приходит короткая ссылка `/files/<id>` или `/files/<id>?token=...`.
# Ограничение оставлено как страховка: оно закрывает путь и для старого
# клиента, который всё ещё пробует отправить base64.
MAX_MESSAGE_FILE_URL_LEN = 500

# Ссылка на файл в БД: только наш внутренний путь. Внешние адреса здесь
# запрещены намеренно — см. _check_file_url.
FILE_PATH_RE = re.compile(r"^/files/\d+(\?[^\s]*)?$")

# ---------- Границы пользовательского ввода ----------
#
# Раньше задания, отклики и профиль принимались без проверок: пустое название
# и отрицательный бюджет публиковались в ленте, имя в 100 000 символов
# попадало на страницу специалиста, а бюджет 3 000 000 000 доходил до INSERT
# и отвечал 500 — колонки сумм INTEGER, в PostgreSQL это до 2 147 483 647.
# Тексты ошибок — по-русски: фронтенд показывает их как есть (utils/apiError.js).
MAX_MONEY_RUB = 10_000_000        # бюджет задания, цена в отклике, цена товара
MAX_TITLE_LEN = 200               # как maxLength полей на фронтенде
MAX_DESCRIPTION_LEN = 5000
MAX_PLACE_LEN = 200               # город, адрес
MAX_RESPONSE_TEXT_LEN = 3000
MAX_ESTIMATED_DAYS = 365
MAX_STOCK = 100_000
MAX_NAME_LEN = 100
MAX_BIO_LEN = 2000
MAX_PHONE_LEN = 30
MAX_SKILLS_LEN = 2000


def _rub(amount: int) -> str:
    return f"{amount:,}".replace(",", " ") + " ₽"


def _clean_text(v: Optional[str], *, label: str, max_len: int, min_len: int = 0,
                required_msg: Optional[str] = None) -> Optional[str]:
    """Обрезает пробелы по краям и проверяет длину.

    required_msg задан — поле обязательное (пустое и из одних пробелов — ошибка);
    иначе пустое значение превращается в None.
    """
    v = (v or "").strip()
    if not v:
        if required_msg:
            raise ValueError(required_msg)
        return None
    if len(v) < min_len:
        raise ValueError(f"{label} — минимум {min_len} символа")
    if len(v) > max_len:
        raise ValueError(f"{label} — не длиннее {max_len} символов")
    return v


def _check_max_len(v: Optional[str], *, label: str, max_len: int) -> Optional[str]:
    """Только верхняя граница: для полей профиля, где пустая строка — «очистить»."""
    if v is not None and len(v) > max_len:
        raise ValueError(f"{label} — не длиннее {max_len} символов")
    return v


def _check_money(v: Optional[int], *, label: str) -> Optional[int]:
    """Необязательная сумма в рублях: 0 и пусто — «не указана»."""
    if v is None or v == 0:
        return None
    if v < 0:
        raise ValueError(f"{label} не может быть меньше нуля")
    if v > MAX_MONEY_RUB:
        raise ValueError(f"{label} — не больше {_rub(MAX_MONEY_RUB)}")
    return v



def _check_file_url(
    v: Optional[str], *, field: str, allow_external: bool = False
) -> Optional[str]:
    """Ссылка на файл — короткий путь к загруженному файлу, а не его содержимое.

    Раньше проверки не было ни на одном таком поле, и через них в БД попадало
    что угодно: data-URL целиком (весь файл base64 внутри строки), `javascript:`
    и `data:text/html` — то есть заготовка под XSS в момент, когда значение
    отрисуют без экранирования.

    Почему это общая функция, а не валидатор одного поля: дефект уже чинили
    точечно — поправили `MessageCreate.file_url`, а `VerificationSubmitRequest`
    с тем же полем остался открыт. Поле верификации хуже: его значение уходит
    модератору, то есть XSS прилетел бы на самый привилегированный экран.
    Второй раз наступать на это не нужно — оба поля ходят сюда.
    """
    if v is None or v == "":
        return None

    if len(v) > MAX_MESSAGE_FILE_URL_LEN:
        raise ValueError(
            f"Ссылка в поле {field} слишком длинная — загрузите файл через "
            "POST /upload/image и передайте полученный url"
        )

    if FILE_PATH_RE.match(v):
        return v

    if allow_external and v.startswith(("http://", "https://")):
        return v

    raise ValueError(
        f"Недопустимая ссылка в поле {field}: ожидается /files/<id>"
        + (" или http(s)-адрес" if allow_external else " (внешние адреса не принимаются)")
    )

# bcrypt молча обрезает всё после 72-го байта, поэтому два разных длинных пароля
# с общим префиксом стали бы эквивалентны — длину проверяем явно.
BCRYPT_MAX_BYTES = 72


def _check_password(v: str) -> str:
    """Единая политика пароля для регистрации и сброса.

    Требования:
    - Минимум 8 символов
    - Хотя бы одна цифра (защита от простых словарных паролей)
    - Максимум 72 байта (ограничение bcrypt)
    """
    if len(v) < 8:
        raise ValueError("Пароль должен содержать минимум 8 символов")
    if not any(c.isdigit() for c in v):
        raise ValueError("Пароль должен содержать хотя бы одну цифру")
    if len(v.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError("Пароль слишком длинный: максимум 72 байта")
    return v


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    # Роль намеренно НЕ принимается от клиента: раньше поле приходило в теле
    # запроса, и зарегистрироваться сразу специалистом мог любой. Роль
    # выдаётся сервером (customer по умолчанию) и меняется через
    # POST /users/me/switch-role — там же, где остальные проверки.
    name: Optional[str] = None
    # Две отдельные отметки, а не одна: с 1 сентября 2025 года согласие на
    # обработку персональных данных оформляется отдельно от других документов
    # (ст. 9 152-ФЗ в ред. 156-ФЗ). По умолчанию False — без обеих отметок
    # регистрация отклоняется с понятным сообщением, а не с ошибкой схемы.
    accept_terms: bool = False
    pd_consent: bool = False

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        return _check_password(v)


class LegalConsentRequest(BaseModel):
    """Согласие уже зарегистрированного пользователя: аккаунты, созданные до
    появления документов, и пользователи со старой редакцией."""
    accept_terms: bool = False
    pd_consent: bool = False

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

    # Только верхние границы: None — «не менять», пустая строка — «очистить».
    # Аватар и портфолио проверяет app/api/users.py.
    @field_validator("name")
    @classmethod
    def _name_len(cls, v: Optional[str]) -> Optional[str]:
        return _check_max_len(v, label="Имя", max_len=MAX_NAME_LEN)

    @field_validator("bio")
    @classmethod
    def _bio_len(cls, v: Optional[str]) -> Optional[str]:
        return _check_max_len(v, label="О себе", max_len=MAX_BIO_LEN)

    @field_validator("city")
    @classmethod
    def _city_len(cls, v: Optional[str]) -> Optional[str]:
        return _check_max_len(v, label="Город", max_len=MAX_PLACE_LEN)

    @field_validator("phone")
    @classmethod
    def _phone_len(cls, v: Optional[str]) -> Optional[str]:
        return _check_max_len(v, label="Телефон", max_len=MAX_PHONE_LEN)

    @field_validator("skills")
    @classmethod
    def _skills_len(cls, v: Optional[str]) -> Optional[str]:
        return _check_max_len(v, label="Навыки", max_len=MAX_SKILLS_LEN)

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class RefreshTokenRequest(BaseModel):
    """Refresh-токен в теле запроса: /auth/refresh и /auth/logout.

    Длина ограничена: настоящий токен — около 250 символов, а без предела
    сюда можно было бы прислать мегабайты на разбор подписи."""
    refresh_token: str = Field(..., min_length=1, max_length=4096)

class VerifyEmailRequest(BaseModel):
    """Токен из ссылки в письме (app/core/email_verification.py)."""
    token: str = Field(..., min_length=1, max_length=4096)

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        return _check_password(v)

class PasswordChangeRequest(BaseModel):
    """Смена пароля из-под логина.

    Отдельно от ResetPasswordRequest: тот работает по токену из письма и
    текущий пароль не спрашивает (человек его как раз забыл). Здесь наоборот —
    текущий пароль обязателен, иначе угнанный access-токен позволял бы сменить
    пароль и запереть владельца в его же аккаунте.
    """
    current_password: str
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

class TaskBase(BaseModel):
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


class TaskCreate(TaskBase):
    """Новое задание. Проверки — только здесь, а не в TaskBase: схема ответа
    TaskOut не должна падать на заданиях, созданных до появления проверок."""

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        return _clean_text(v, label="Название задания", min_len=3, max_len=MAX_TITLE_LEN,
                           required_msg="Укажите название задания")

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        return _clean_text(v, label="Описание", max_len=MAX_DESCRIPTION_LEN,
                           required_msg="Опишите задание")

    @field_validator("budget")
    @classmethod
    def _validate_budget(cls, v: Optional[int]) -> Optional[int]:
        # 0 — то же, что пустое поле: «цена договорная».
        return _check_money(v, label="Бюджет")

    @field_validator("city")
    @classmethod
    def _validate_city(cls, v: Optional[str]) -> Optional[str]:
        return _clean_text(v, label="Город", max_len=MAX_PLACE_LEN)

    @field_validator("address")
    @classmethod
    def _validate_address(cls, v: Optional[str]) -> Optional[str]:
        return _clean_text(v, label="Адрес", max_len=MAX_PLACE_LEN)

    @field_validator("latitude")
    @classmethod
    def _validate_latitude(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not -90 <= v <= 90:
            raise ValueError("Некорректные координаты точки на карте")
        return v

    @field_validator("longitude")
    @classmethod
    def _validate_longitude(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not -180 <= v <= 180:
            raise ValueError("Некорректные координаты точки на карте")
        return v

    @field_validator("deadline")
    @classmethod
    def _validate_deadline(cls, v: Optional[str]) -> Optional[str]:
        """Срок — дата из поля type=date (ГГГГ-ММ-ДД) или дата со временем в ISO.

        Прошедшую дату не принимаем; день запаса — на разницу часовых поясов
        между браузером и сервером.
        """
        v = (v or "").strip()
        if not v:
            return None
        try:
            day = date.fromisoformat(v) if len(v) == 10 else datetime.fromisoformat(v).date()
        except ValueError:
            raise ValueError("Срок выполнения — дата в формате ГГГГ-ММ-ДД")
        if day < date.today() - timedelta(days=1):
            raise ValueError("Срок выполнения не может быть в прошлом")
        return v

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

class TaskOut(TaskBase):
    id: int
    customer_id: int
    executor_id: Optional[int] = None
    status: str
    responses_count: Optional[int] = 0
    distance_km: Optional[float] = None

    class Config:
        from_attributes = True

class ResponseBase(BaseModel):
    text: str
    proposed_price: Optional[int] = None
    estimated_days: Optional[int] = None


class ResponseCreate(ResponseBase):
    @field_validator("text")
    @classmethod
    def _validate_text(cls, v: str) -> str:
        return _clean_text(v, label="Сообщение заказчику", max_len=MAX_RESPONSE_TEXT_LEN,
                           required_msg="Напишите сообщение заказчику")

    @field_validator("proposed_price")
    @classmethod
    def _validate_price(cls, v: Optional[int]) -> Optional[int]:
        return _check_money(v, label="Цена")

    @field_validator("estimated_days")
    @classmethod
    def _validate_days(cls, v: Optional[int]) -> Optional[int]:
        if v is None or v == 0:
            return None
        if not 1 <= v <= MAX_ESTIMATED_DAYS:
            raise ValueError(f"Срок — от 1 до {MAX_ESTIMATED_DAYS} дней")
        return v


class ResponseOut(ResponseBase):
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
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None

    @field_validator("file_url")
    @classmethod
    def _validate_file_url(cls, v: Optional[str]) -> Optional[str]:
        """Вложение — короткая внутренняя ссылка, а не содержимое файла.

        Поле принимает только `/files/<id>` (с необязательной подписью) или
        http(s)-адрес. Base64-строку оно больше не пропускает: раньше через
        это поле в БД попадал весь файл, и каждое чтение чата возвращало его
        целиком (см. MAX_MESSAGE_FILE_URL_LEN).
        """
        # Внешние ссылки в чате допустимы: пользователь может прислать ссылку
        # на файлообменник, и это не наша ответственность.
        return _check_file_url(v, field="file_url", allow_external=True)

class MessageOut(BaseModel):
    id: int
    task_id: int
    sender_id: int
    text: str
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None
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

    @field_validator("file_url")
    @classmethod
    def _validate_file_url(cls, v: Optional[str]) -> Optional[str]:
        """Скан документа — только наш файл, внешние адреса не принимаются.

        Поле уходило в БД без проверки вообще, хотя это единственное поле
        заявки, которое отдаётся модератору (`GET /verification/admin/list`).
        Через него можно было положить base64 (раздувая БД, как это было в
        чате) или `javascript:`/`data:text/html` — заготовку под XSS на самом
        привилегированном экране, которая сработала бы, как только скан начнут
        показывать.

        Внешние ссылки запрещены намеренно: документ должен лежать у нас, иначе
        мы не можем ни закрыть к нему доступ, ни удалить его.
        """
        return _check_file_url(v, field="file_url", allow_external=False)

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
    # `str`, а не datetime: схема отдаётся наружу как есть, и приведение делает
    # `_request_out` через `.isoformat()`. Поле объявлено необязательным,
    # потому что колонка в БД допускает NULL — иначе ответ падал бы на
    # валидации, а не отдавал null.
    created_at: Optional[str] = None
    resolved_at: Optional[str] = None

    class Config:
        from_attributes = True

class VerificationStatusOut(BaseModel):
    verified: bool
    request: Optional[VerificationRequestOut] = None

class AIChatRequest(BaseModel):
    prompt: str
    current_task: Optional[dict] = None


# ============================================================================
# MARKETPLACE ТОВАРОВ
# ============================================================================

from app.models import ProductCategory, ProductCondition, OrderStatus

MAX_PRODUCT_IMAGES = 10

class ProductCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=5000)
    category: ProductCategory = ProductCategory.other
    condition: ProductCondition = ProductCondition.new
    price: int = Field(gt=0, description="Цена в рублях")
    stock: int = Field(ge=1, default=1, description="Количество на складе")
    images: Optional[str] = None  # JSON array URLs
    city: Optional[str] = None
    delivery_options: str = "both"  # pickup, delivery, both

    @field_validator("images")
    @classmethod
    def _validate_images(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        try:
            parsed = json.loads(v)
        except (TypeError, ValueError):
            raise ValueError("Поле images должно быть JSON-массивом")

        if not isinstance(parsed, list):
            raise ValueError("Поле images должно быть JSON-массивом")
        if len(parsed) > MAX_PRODUCT_IMAGES:
            raise ValueError(f"Не больше {MAX_PRODUCT_IMAGES} изображений")

        for item in parsed:
            if not isinstance(item, str):
                raise ValueError("Элементы images должны быть строками")
            if len(item) > MAX_IMAGE_PATH_LEN:
                raise ValueError("Слишком длинный путь к изображению")

        return json.dumps(parsed, ensure_ascii=False)

    @field_validator("delivery_options")
    @classmethod
    def _validate_delivery(cls, v: str) -> str:
        if v not in ["pickup", "delivery", "both"]:
            raise ValueError("delivery_options: pickup, delivery или both")
        return v

    # Нижние границы цены и количества — в Field выше, верхние — здесь:
    # без них большое число доходило до INSERT и отвечало 500.
    @field_validator("price")
    @classmethod
    def _validate_price_max(cls, v: int) -> int:
        if v > MAX_MONEY_RUB:
            raise ValueError(f"Цена — не больше {_rub(MAX_MONEY_RUB)}")
        return v

    @field_validator("stock")
    @classmethod
    def _validate_stock_max(cls, v: int) -> int:
        if v > MAX_STOCK:
            raise ValueError(f"Количество — не больше {MAX_STOCK:,}".replace(",", " "))
        return v

    @field_validator("city")
    @classmethod
    def _validate_city(cls, v: Optional[str]) -> Optional[str]:
        return _clean_text(v, label="Город", max_len=MAX_PLACE_LEN)


class ProductOut(BaseModel):
    id: int
    seller_id: int
    title: str
    description: str
    category: str
    condition: str
    price: int
    stock: int
    images: Optional[str]
    city: Optional[str]
    delivery_options: str
    status: str
    created_at: str
    seller_name: Optional[str] = None
    seller_avatar: Optional[str] = None
    seller_rating: Optional[float] = None
    seller_verified: Optional[bool] = False

    class Config:
        from_attributes = True


class OrderCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(ge=1, default=1)
    delivery_method: str  # pickup или delivery
    delivery_address: Optional[str] = None

    @field_validator("delivery_method")
    @classmethod
    def _validate_delivery_method(cls, v: str) -> str:
        if v not in ["pickup", "delivery"]:
            raise ValueError("delivery_method: pickup или delivery")
        return v


class OrderOut(BaseModel):
    id: int
    product_id: int
    buyer_id: int
    seller_id: int
    quantity: int
    total_price: int
    delivery_method: str
    delivery_address: Optional[str]
    tracking_number: Optional[str]
    status: str
    platform_fee: int
    created_at: str
    product_title: Optional[str] = None
    product_image: Optional[str] = None
    buyer_name: Optional[str] = None
    seller_name: Optional[str] = None

    class Config:
        from_attributes = True
