# 🤝 Contributing Guide — Руководство для разработчиков

Добро пожаловать в проект **ДЕЛО Marketplace**! Этот документ поможет вам начать разработку и внести свой вклад.

---

## 📋 Содержание

- [Быстрый старт](#быстрый-старт)
- [Структура проекта](#структура-проекта)
- [Рабочий процесс](#рабочий-процесс)
- [Стандарты кода](#стандарты-кода)
- [Тестирование](#тестирование)
- [Git workflow](#git-workflow)
- [Code Review](#code-review)
- [Миграции БД](#миграции-бд)
- [Документация](#документация)

---

## 🚀 Быстрый старт

### Требования

- **Python**: 3.11+
- **Node.js**: 18+
- **PostgreSQL**: 15+ (опционально, для production-like окружения)
- **Redis**: 7+ (опционально, для rate limiting)
- **Git**: 2.30+

### Установка окружения

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/topleki57tuu-glitch/delo-marketplace.git
cd delo-marketplace

# 2. Backend setup
cd backend
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или
venv\Scripts\activate  # Windows

pip install -r requirements.txt

# 3. Создайте .env файл
cp .env.example .env
# Отредактируйте .env (минимум: SECRET_KEY)

# 4. Примените миграции
alembic upgrade head

# 5. Загрузите демо-данные (опционально)
python seed_demo.py

# 6. Запустите backend
uvicorn main:app --reload --port 8000

# 7. Frontend setup (в новом терминале)
cd ../frontend
npm install
npm run dev  # Запустится на http://localhost:3000

# 8. Откройте в браузере
# http://localhost:3000
```

### Проверка установки

```bash
# Проверьте backend
curl http://localhost:8000/health
# Ожидается: {"status": "ok", "timestamp": "..."}

# Проверьте API docs
open http://localhost:8000/docs

# Проверьте frontend
open http://localhost:3000
```

---

## 📁 Структура проекта

```
delo-marketplace/
├── backend/                    # FastAPI приложение
│   ├── app/
│   │   ├── api/               # API роутеры (auth, tasks, users, chat, ...)
│   │   ├── core/              # Ядро (config, security, database, container)
│   │   ├── models/            # SQLAlchemy модели
│   │   └── schemas.py         # Pydantic схемы
│   ├── migrations/            # Alembic миграции
│   │   └── versions/          # Файлы миграций
│   ├── tests/                 # E2E тесты
│   ├── main.py                # Точка входа FastAPI
│   ├── seed_demo.py           # Загрузка демо-данных
│   ├── requirements.txt       # Python зависимости
│   └── .env                   # Переменные окружения (не коммитится)
│
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── components/        # React компоненты
│   │   ├── pages/             # Страницы (TaskList, TaskDetail, Chat, ...)
│   │   ├── utils/             # Утилиты (api.js, auth.js)
│   │   └── App.jsx            # Главный компонент
│   ├── public/                # Статические файлы
│   ├── package.json           # npm зависимости
│   └── vite.config.js         # Vite конфигурация
│
├── bot/                        # Telegram бот
│   ├── bot.py                 # Точка входа бота
│   └── requirements.txt       # Python зависимости
│
├── docs/                       # Документация
│   ├── ARCHITECTURE_DIAGRAM.md
│   ├── TASK_STATES_DIAGRAM.md
│   ├── SECURITY_IMPROVEMENTS.md
│   ├── ARCHITECTURE_IMPROVEMENTS.md
│   ├── FAQ.md
│   └── CONTRIBUTING.md        # Этот файл
│
├── docker-compose.yml         # Docker orchestration
├── README.md                  # Главная документация
└── .gitignore                 # Игнорируемые файлы
```

---

## 🔄 Рабочий процесс

### 1. Выбор задачи

- Проверьте [GitHub Issues](https://github.com/topleki57tuu-glitch/delo-marketplace/issues)
- Выберите задачу с меткой `good first issue` или `help wanted`
- Оставьте комментарий: "Беру в работу"

### 2. Создание ветки

```bash
# Обновите main
git checkout main
git pull origin main

# Создайте feature ветку
git checkout -b feature/task-123-add-notifications

# Соглашение по именованию:
# feature/...  - новая функциональность
# fix/...      - исправление бага
# refactor/... - рефакторинг
# docs/...     - документация
```

### 3. Разработка

**Локальный dev сервер**:
```bash
# Terminal 1: Backend
cd backend
source venv/bin/activate
uvicorn main:app --reload

# Terminal 2: Frontend
cd frontend
npm run dev
```

**Hot reload**:
- Backend: автоматически перезагружается при изменении `.py` файлов
- Frontend: автоматически обновляется при изменении `.jsx` файлов

### 4. Коммиты

```bash
# Добавьте файлы
git add backend/app/api/notifications.py
git add frontend/src/pages/Notifications.jsx

# Коммит с осмысленным сообщением
git commit -m "feat: add notifications page with real-time updates

- Add GET /notifications endpoint
- Add NotificationsPage component
- WebSocket integration for real-time notifications
- Mark all as read functionality

Closes #123"
```

**Формат коммитов** (Conventional Commits):
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Типы**:
- `feat`: новая функция
- `fix`: исправление бага
- `refactor`: рефакторинг без изменения функциональности
- `docs`: документация
- `test`: добавление/исправление тестов
- `chore`: обслуживание (обновление зависимостей, конфиг)
- `perf`: улучшение производительности
- `style`: форматирование (не CSS, а код style)

**Примеры**:
```
feat(api): add pagination to tasks endpoint
fix(auth): resolve JWT expiration race condition
refactor(chat): extract WebSocket logic to separate service
docs(readme): update installation instructions
test(escrow): add tests for refund flow
```

### 5. Тестирование

```bash
# Запустите E2E тесты
cd backend
python tests/e2e_api_test.py
python tests/e2e_new_features_test.py

# Проверьте, что все тесты проходят
# Expected: OK (47 tests) и OK (38 tests)
```

### 6. Push и Pull Request

```bash
# Push в свою ветку
git push origin feature/task-123-add-notifications

# Создайте Pull Request через GitHub UI
# или с помощью gh CLI:
gh pr create --title "Add notifications page" --body "Closes #123"
```

---

## 📝 Стандарты кода

### Python (Backend)

**Style Guide**: [PEP 8](https://pep8.org/)

**Форматирование**:
```bash
# Установите инструменты
pip install black isort flake8

# Форматирование
black backend/app/
isort backend/app/

# Проверка линтером
flake8 backend/app/ --max-line-length=120
```

**Пример хорошего кода**:
```python
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.database import get_db
from app.core.security import decode_token, oauth2_scheme, rate_limit
from app.models import Task, TaskStatus, User, UserRole
from app.schemas import TaskCreate

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_task(
    task: TaskCreate,
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf),  # обязательна на всех изменяющих методах
):
    """Создать новое задание. Только для заказчиков."""
    # Спам-защита: 10 заданий за 5 минут на адрес.
    rate_limit(request, "create_task", limit=10, window_sec=300)

    # decode_token сам поднимает 401 на битом или просроченном токене.
    payload = decode_token(token)

    # Роль читаем из БД, а не из токена. В JWT роль остаётся прежней до 7 дней
    # после переключения, поэтому проверка по токену пропустила бы бывшего
    # специалиста создавать задания как заказчик.
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user or user.role != UserRole.customer:
        raise HTTPException(403, "Создавать задания могут только заказчики")

    new_task = Task(
        title=task.title,
        description=task.description,
        budget=task.budget,
        category=task.category,
        customer_id=user.id,
        status=TaskStatus.open,
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    return {"message": "Задание создано", "task_id": new_task.id}
```

Обратите внимание на два места, где пример легко сделать небезопасным:

* **`Depends(verify_csrf)`** нужен на каждом POST/PUT/PATCH/DELETE. В production
  проверка включена всегда, и без зависимости маршрут получит 403.
  `tests/test_csrf_coverage.py` перечисляет изменяющие маршруты и падает, если
  зависимость забыта.
* **Роль — из БД, а не из `payload`.** Токен живёт 7 дней и всё это время несёт
  роль, с которой был выдан.

Функции `get_current_user` в проекте нет: авторизация собирается из
`oauth2_scheme` + `decode_token` + чтения пользователя из БД. Схемы `TaskPublic`
тоже нет — выходная схема называется `TaskOut` (см. `app/schemas/__init__.py`).

**Требования**:
- ✅ Type hints для всех функций
- ✅ Docstrings для публичных функций
- ✅ Обработка ошибок с понятными сообщениями
- ✅ Валидация входных данных через Pydantic
- ✅ Использование Depends для инъекции зависимостей

### JavaScript/React (Frontend)

**Style Guide**: [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)

**Форматирование**:
```bash
# Установите Prettier (если нет)
npm install --save-dev prettier

# Форматирование
npm run format

# Или создайте .prettierrc:
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

**Пример хорошего кода**:
```javascript
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

/**
 * Страница деталей задания.
 * Показывает информацию о задании, отклики и чат.
 */
export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadTask();
  }, [id]);

  async function loadTask() {
    try {
      setLoading(true);
      const data = await api.get(`/tasks/${id}`);
      setTask(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div>Загрузка...</div>;
  if (error) return <div>Ошибка: {error}</div>;
  if (!task) return <div>Задание не найдено</div>;

  return (
    <div className="task-detail">
      <h1>{task.title}</h1>
      <p>{task.description}</p>
      <span className="budget">{task.budget} ₽</span>
    </div>
  );
}
```

**Требования**:
- ✅ Функциональные компоненты + хуки
- ✅ PropTypes или TypeScript для типизации
- ✅ Обработка loading и error состояний
- ✅ Осмысленные имена переменных и функций
- ✅ Декомпозиция: один компонент = одна ответственность

### SQL (Миграции)

**Требования**:
- ✅ Используйте Alembic для всех изменений схемы
- ✅ Не изменяйте модели без создания миграции
- ✅ Тестируйте upgrade И downgrade

**Пример**:
```python
# migrations/versions/xxxx_add_user_bio.py
def upgrade():
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('bio', sa.Text(), nullable=True))

def downgrade():
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('bio')
```

---

## 🧪 Тестирование

### Запуск тестов

```bash
# Все тесты
cd backend
python tests/e2e_api_test.py
python tests/e2e_new_features_test.py

# Конкретный тест (pytest)
pip install pytest
pytest tests/e2e_api_test.py::test_create_task -v
```

### Написание тестов

**Создайте файл** `tests/test_my_feature.py`:
```python
import unittest
import requests

API_BASE = "http://localhost:8000"

class TestMyFeature(unittest.TestCase):
    def setUp(self):
        """Выполняется перед каждым тестом."""
        # Создайте тестового пользователя, получите токен
        response = requests.post(f"{API_BASE}/register/", json={
            "email": "test@example.com",
            "password": "test123",
            "full_name": "Test User",
            "role": "customer"
        })
        self.user_id = response.json()["id"]
        
        login_response = requests.post(f"{API_BASE}/login", data={
            "username": "test@example.com",
            "password": "test123"
        })
        self.token = login_response.json()["access_token"]

    def test_my_feature(self):
        """Тест моей новой фичи."""
        response = requests.get(
            f"{API_BASE}/my-feature",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("expected_field", response.json())

if __name__ == "__main__":
    unittest.main()
```

**Покрытие**:
- ✅ Happy path (успешный сценарий)
- ✅ Edge cases (граничные случаи)
- ✅ Error handling (обработка ошибок)
- ✅ Permissions (проверка прав доступа)

---

## 🌿 Git Workflow

### Ветки

- `main` — production-ready код
- `develop` — integration ветка (опционально)
- `feature/*` — новая функциональность
- `fix/*` — исправление багов
- `hotfix/*` — критические исправления для production

### Процесс

```bash
# 1. Создайте ветку от main
git checkout main
git pull origin main
git checkout -b feature/my-feature

# 2. Разработка + коммиты
git add .
git commit -m "feat: add my feature"

# 3. Обновитесь с main (если он изменился)
git fetch origin main
git rebase origin/main

# 4. Push
git push origin feature/my-feature

# 5. Создайте PR на GitHub
gh pr create --base main --head feature/my-feature
```

### Rebase vs Merge

**Используйте rebase** для своих веток:
```bash
git checkout feature/my-feature
git rebase main
# Разрешите конфликты, если есть
git rebase --continue
git push --force-with-lease
```

**Используйте merge** при слиянии в main (через PR):
```bash
# Делается автоматически через GitHub UI
# Выберите "Squash and merge" для чистой истории
```

### Commit Messages

**Хорошие примеры**:
```
✅ feat(auth): add refresh token support
✅ fix(escrow): prevent double payout with SELECT FOR UPDATE
✅ refactor(chat): extract WebSocket manager to separate class
✅ docs(api): add examples to /tasks endpoint documentation
```

**Плохие примеры**:
```
❌ update code
❌ fix bug
❌ wip
❌ asdfasdf
```

---

## 👀 Code Review

### Как создать хороший PR

**Checklist**:
- [ ] Понятное название: "Add user notifications system"
- [ ] Описание: что, почему, как
- [ ] Скриншоты (для UI изменений)
- [ ] Тесты проходят
- [ ] Код отформатирован
- [ ] Нет TODO/FIXME без issue
- [ ] Документация обновлена (если нужно)

**Шаблон PR**:
```markdown
## Описание
Добавлена система уведомлений в реальном времени через WebSocket.

## Что изменилось
- Добавлен endpoint GET /notifications
- Добавлен WebSocket endpoint /ws/notifications
- Новая страница NotificationsPage
- Уведомления отображаются в header с количеством непрочитанных

## Скриншоты
![Notifications](https://...)

## Связанные issues
Closes #123

## Тестирование
- [x] E2E тесты проходят
- [x] Вручную протестировано на dev окружении
- [x] WebSocket соединение работает стабильно

## Checklist
- [x] Код отформатирован (black, prettier)
- [x] Добавлены docstrings/комментарии
- [x] Нет console.log в production коде
- [x] Миграции протестированы (upgrade + downgrade)
```

### Как делать review

**Что проверять**:
1. **Функциональность**: код делает то, что должен?
2. **Тесты**: добавлены тесты, все проходят?
3. **Безопасность**: нет SQL injection, XSS, CSRF уязвимостей?
4. **Производительность**: нет N+1 queries, бесконечных циклов?
5. **Читаемость**: код понятен, есть комментарии где нужно?
6. **Архитектура**: соответствует структуре проекта?

**Тон комментариев**:
```
✅ "Можно добавить docstring к этой функции для ясности"
✅ "Рассмотрели ли вы использование list comprehension здесь?"
✅ "Отличное решение! Возможно стоит добавить тест для edge case X"

❌ "Это плохой код"
❌ "Почему вы так сделали???"
❌ "Переделайте полностью"
```

### Как реагировать на комментарии

```bash
# 1. Прочитайте все комментарии
# 2. Внесите изменения
git add .
git commit -m "fix: address review comments"

# 3. Ответьте на комментарии в GitHub:
# "Исправлено в commit abc123"
# "Добавил тест для этого случая"
# "Не уверен насчёт этого подхода, можем обсудить?"

# 4. Push
git push origin feature/my-feature
```

---

## 🗃️ Миграции БД

### Создание миграции

```bash
# 1. Измените модель в app/models/
class User(Base):
    # ... existing fields
    avatar_url = Column(String, nullable=True)  # NEW

# 2. Создайте миграцию
cd backend
alembic revision --autogenerate -m "add_user_avatar_url"

# 3. Проверьте сгенерированный файл
# migrations/versions/xxxx_add_user_avatar_url.py

# 4. Примените
alembic upgrade head

# 5. Протестируйте откат
alembic downgrade -1
alembic upgrade head
```

### Правила миграций

- ✅ **Одна миграция = одно логическое изменение**
- ✅ **Всегда тестируйте upgrade И downgrade**
- ✅ **Используйте batch_alter_table для SQLite**
- ✅ **Добавляйте default значения для NOT NULL колонок**
- ❌ **Не редактируйте старые миграции** (создавайте новые)
- ❌ **Не удаляйте данные без backup**

**Пример безопасной миграции**:
```python
def upgrade():
    # Добавляем колонку с nullable=True
    op.add_column('users', sa.Column('phone', sa.String(), nullable=True))
    
    # Заполняем дефолтными значениями (если нужно)
    op.execute("UPDATE users SET phone = '' WHERE phone IS NULL")
    
    # Теперь можно сделать NOT NULL
    with op.batch_alter_table('users') as batch_op:
        batch_op.alter_column('phone', nullable=False)
```

---

## 📚 Документация

### Что документировать

- **API endpoints**: добавляйте docstrings в роутеры
- **Модели**: описывайте поля и связи
- **Сложная логика**: комментарии в коде
- **Архитектурные решения**: в docs/
- **Изменения в README**: при добавлении фич

### Docstrings

**Python** (Google style):
```python
def create_task(task_data: TaskCreate, current_user: User, db: Session) -> Task:
    """
    Создать новое задание.
    
    Args:
        task_data: Данные задания (title, description, budget, category)
        current_user: Текущий пользователь (должен быть заказчиком)
        db: Database session
        
    Returns:
        Task: Созданное задание
        
    Raises:
        HTTPException: Если пользователь не заказчик (403)
        HTTPException: Если недостаточно средств (400)
    """
```

**JavaScript** (JSDoc):
```javascript
/**
 * Создать новое задание через API.
 * 
 * @param {Object} taskData - Данные задания
 * @param {string} taskData.title - Заголовок
 * @param {string} taskData.description - Описание
 * @param {number} taskData.budget - Бюджет в рублях
 * @returns {Promise<Task>} Созданное задание
 * @throws {APIError} Если запрос не авторизован или данные невалидны
 */
export async function createTask(taskData) {
  return api.post('/tasks/', taskData);
}
```

### Обновление README

При добавлении новой фичи обновите:
```markdown
## API (основное)

| Метод и путь | Описание |
|---|---|
| ... existing ... |
| `GET /my-feature`, `POST /my-feature` | Моя новая фича | <-- ADD
```

---

## 🎯 Типичные задачи

### Добавить новый endpoint

1. Создайте роутер в `backend/app/api/my_feature.py`
2. Добавьте модели в `backend/app/models/__init__.py` (если нужно)
3. Создайте миграцию: `alembic revision --autogenerate`
4. Добавьте схемы в `backend/app/schemas.py`
5. Подключите роутер в `backend/main.py`
6. Напишите тесты в `tests/test_my_feature.py`
7. Обновите документацию

### Добавить новую страницу

1. Создайте компонент в `frontend/src/pages/MyPage.jsx`
2. Добавьте роут в `frontend/src/App.jsx`
3. Добавьте навигацию в `frontend/src/components/Header.jsx` (если нужно)
4. Подключите API в `frontend/src/utils/api.js`
5. Протестируйте в браузере

### Исправить баг

1. Воспроизведите баг локально
2. Напишите тест, который падает
3. Исправьте код
4. Убедитесь, что тест проходит
5. Проверьте, что не сломали другие тесты
6. Создайте PR с описанием бага и решения

---

## 🛠️ Полезные команды

### Backend
```bash
# Запуск dev сервера
uvicorn main:app --reload --port 8000

# Миграции
alembic upgrade head          # Применить все
alembic downgrade -1          # Откатить одну
alembic revision --autogenerate -m "description"  # Создать

# Тесты
python tests/e2e_api_test.py

# Форматирование
black backend/app/
isort backend/app/
flake8 backend/app/

# Python shell (для отладки)
python
>>> from app.core.database import SessionLocal
>>> from app.models import User
>>> db = SessionLocal()
>>> users = db.query(User).all()
```

### Frontend
```bash
# Запуск dev сервера
npm run dev

# Сборка для production
npm run build

# Форматирование
npm run format

# Линтинг (если настроен ESLint)
npm run lint
```

### Docker
```bash
# Запуск всех сервисов
docker-compose up -d

# Логи
docker-compose logs -f backend

# Перезапуск сервиса
docker-compose restart backend

# Остановка
docker-compose down

# Пересборка после изменений
docker-compose up -d --build
```

### Git
```bash
# Текущая ветка и статус
git status

# История коммитов
git log --oneline --graph

# Откат изменений
git checkout -- file.py

# Stash (временно спрятать изменения)
git stash
git stash pop

# Интерактивный rebase (для чистки коммитов)
git rebase -i HEAD~3
```

---

## 🆘 Нужна помощь?

- **Документация**: [README.md](../README.md), [FAQ.md](FAQ.md)
- **Issues**: [GitHub Issues](https://github.com/topleki57tuu-glitch/delo-marketplace/issues)
- **Вопросы**: создайте issue с меткой `question`

---

## 📜 Лицензия

Указать лицензию проекта (MIT, Apache 2.0, и т.д.)

---

**Спасибо за ваш вклад!** 🎉

Каждый pull request делает проект лучше. Мы ценим ваше время и усилия!

---

**Дата**: 2026-09-12  
**Версия**: 2.2.0
