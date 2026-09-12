import re
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from app.core.security import oauth2_scheme, decode_token
from app.schemas import AIChatRequest

router = APIRouter(prefix="/ai", tags=["AI Assistant"])


def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


# Категории и слова-маркеры. Набор совпадает с TaskCategory на бэкенде
# и с выпадающим списком на фронтенде — иначе помощник предлагал бы
# категорию, которую интерфейс не умеет показать.
CATEGORY_KEYWORDS = [
    ("development", ["сайт", "код", "программ", "разработ", "бот", "frontend", "backend", "приложен", "верстк"]),
    ("design", ["дизайн", "логотип", "баннер", "макет", "figma", "иллюстрац", "фирменн"]),
    # Падежи «статьи» выписаны явно: основа «стать» не ловит «статей»,
    # а обрезка до «стат» цепляет «статус» и «статистику».
    ("writing", ["текст", "статья", "статьи", "статью", "статье", "статей", "статьями",
                 "копирайт", "перевод", "контент", "редактур", "сценари", "рерайт", "лонгрид"]),
    ("repairs", ["ремонт", "починить", "сантехник", "электрик", "смесител", "плитк", "обои", "замок"]),
    ("cleaning", ["уборка", "клининг", "мыть", "убрать", "химчистк"]),
    ("delivery", ["доставка", "курьер", "привезти", "перевезти", "грузчик"]),
    ("photo_video", ["фото", "видео", "монтаж", "съемка", "съёмка", "оператор"]),
    ("tutoring", ["репетитор", "урок", "английск", "обучение", "занятия", "подготовк"]),
    ("beauty", ["маникюр", "стрижк", "парикмахер", "макияж", "брови", "косметолог"]),
    ("events", ["ведущ", "праздник", "мероприят", "юбилей", "свадьб", "тамада"]),
    ("business", ["юрист", "бухгалтер", "консультац", "налог", "договор", "регистрац"]),
]

CATEGORY_LABELS = {
    "development": "Разработка сайтов и IT",
    "design": "Дизайн и графика",
    "writing": "Тексты и переводы",
    "repairs": "Ремонт и строительство",
    "cleaning": "Уборка и клининг",
    "delivery": "Курьеры и доставка",
    "photo_video": "Фото и видеосъёмка",
    "tutoring": "Репетиторы и обучение",
    "beauty": "Красота и здоровье",
    "events": "Мероприятия и промо",
    "business": "Бизнес и юридические услуги",
    "other": "Другое",
}

REMOTE_MARKERS = ["удалённо", "удаленно", "remote", "онлайн", "дистанционно", "не выезжая"]

# Города для предзаполнения поля. Геокодер здесь не дёргаем — это лишь
# подсказка, которую пользователь видит и может исправить в форме.
KNOWN_CITIES = [
    "санкт-петербург", "нижний новгород", "нижний тагил", "набережные челны",
    "ростов-на-дону", "новокузнецк", "магнитогорск", "новосибирск", "екатеринбург",
    "владивосток", "красноярск", "калининград", "севастополь", "ставрополь",
    "хабаровск", "ярославль", "воронеж", "волгоград", "краснодар", "саратов",
    "тюмень", "тольятти", "ульяновск", "иркутск", "махачкала", "оренбург",
    "кемерово", "астрахань", "чебоксары", "калининград", "архангельск",
    "казань", "челябинск", "самара", "пермь", "уфа", "омск", "томск", "пенза",
    "липецк", "киров", "тула", "курск", "брянск", "белгород", "сургут",
    "владимир", "иваново", "рязань", "тверь", "сочи", "москва", "петербург",
]

# Базовая ставка по категории — отправная точка для рекомендации бюджета
BASE_BUDGET = {
    "development": 45000,
    "design": 12000,
    "writing": 4000,
    "repairs": 8000,
    "cleaning": 4500,
    "delivery": 2500,
    "photo_video": 15000,
    "tutoring": 2000,
    "beauty": 2500,
    "events": 20000,
    "business": 8000,
    "other": 3000,
}


def _detect_city(lower: str) -> Optional[str]:
    """Ищет город в тексте, допуская падежные окончания.

    Матчим по основе («казан» вместо «казань»), чтобы ловить «в Казани»
    и «из Москвы», но разрешаем не больше трёх букв после основы и требуем
    границу слова — иначе «сочинение» превращалось бы в Сочи.
    """
    for city in KNOWN_CITIES:
        stem = city[:-1] if city[-1] in "аеёиоуыэюяь" else city
        if re.search(r"(?<![а-яёa-z])" + re.escape(stem) + r"[а-яё]{0,3}(?![а-яёa-z])", lower):
            return city.title()
    return None


def _detect_category(lower: str) -> str:
    """Выбирает категорию по числу совпадений, при равенстве — по позиции.

    Одного «первого совпавшего» слова мало: во фразе «генеральная уборка
    трёхкомнатной квартиры после ремонта» есть и «уборка», и «ремонт».
    Считаем совпадения, а ничью разрешаем в пользу того, что упомянуто
    раньше — главный предмет задачи обычно идёт первым.
    """
    best_cat, best_score, best_pos = "other", 0, len(lower) + 1
    for cat, words in CATEGORY_KEYWORDS:
        positions = [lower.find(w) for w in words if w in lower]
        if not positions:
            continue
        score, pos = len(positions), min(positions)
        if score > best_score or (score == best_score and pos < best_pos):
            best_cat, best_score, best_pos = cat, score, pos
    return best_cat


@router.post("/task-helper")
def assist_task_creation(req: AIChatRequest, token: str = Depends(oauth2_scheme)):
    decode_token_or_401(token)

    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(400, "Опишите задачу — пустой запрос разбирать нечего")

    lower = prompt.lower()

    suggested_category = _detect_category(lower)

    is_remote = any(w in lower for w in REMOTE_MARKERS)
    city = None if is_remote else _detect_city(lower)

    title_suggestion = prompt.split(".")[0].strip()[:80]
    if len(title_suggestion) < 5:
        title_suggestion = f"Требуется специалист: {prompt[:50]}"

    structured_description = (
        f"{prompt}\n\n"
        f"📋 Требования к исполнителю:\n"
        f"• Качественное и своевременное выполнение работы\n"
        f"• Наличие примеров аналогичных работ или опыта\n"
        f"• Быть на связи в процессе выполнения"
    )

    # Бюджет: уже введённую пользователем сумму не перебиваем
    current_budget = (req.current_task or {}).get("budget")
    if current_budget:
        try:
            suggested_budget = int(current_budget)
            budget_reason = "оставили указанную вами сумму"
        except (TypeError, ValueError):
            suggested_budget = BASE_BUDGET.get(suggested_category, 3000)
            budget_reason = f"средняя ставка по категории «{CATEGORY_LABELS[suggested_category]}»"
    else:
        suggested_budget = BASE_BUDGET.get(suggested_category, 3000)
        budget_reason = f"средняя ставка по категории «{CATEGORY_LABELS[suggested_category]}»"

    location_note = "работа удалённая" if is_remote else (f"город — {city}" if city else "город не распознан")

    return {
        "suggested_title": title_suggestion,
        "suggested_description": structured_description,
        "suggested_category": suggested_category,
        # Готовая подпись категории — чтобы интерфейс не показывал сырой id
        # и не дублировал словарь названий у себя
        "suggested_category_label": CATEGORY_LABELS[suggested_category],
        "suggested_budget": suggested_budget,
        "is_remote": is_remote,
        "city": city,
        "explanation": (
            f"Категория «{CATEGORY_LABELS[suggested_category]}» определена по ключевым словам "
            f"в описании, бюджет — {budget_reason} ({location_note})."
        ),
    }
