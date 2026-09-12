# ❓ FAQ — Частые вопросы и проблемы

## 📋 Содержание

- [Установка и запуск](#установка-и-запуск)
- [База данных и миграции](#база-данных-и-миграции)
- [Аутентификация и безопасность](#аутентификация-и-безопасность)
- [Эскроу и транзакции](#эскроу-и-транзакции)
- [WebSocket и чат](#websocket-и-чат)
- [Production деплой](#production-деплой)
- [Тестирование](#тестирование)
- [Разработка](#разработка)

---

## Установка и запуск

### ❓ Backend не запускается: `ModuleNotFoundError: No module named 'app'`

**Причина**: Запуск из неправильной директории.

**Решение**:
```bash
# Убедитесь, что вы в директории backend/
cd backend
uvicorn main:app --reload

# Или из корня репозитория:
cd delo-marketplace
uvicorn backend.main:app --reload
```

---

### ❓ Frontend показывает ошибку `Failed to fetch` при API запросах

**Причина**: Backend не запущен или прокси не настроен.

**Решение 1** (dev mode):
```bash
# 1. Запустите backend на порту 8000
cd backend
uvicorn main:app --reload --port 8000

# 2. В другом терминале запустите frontend
cd frontend
npm run dev  # Vite прокси /api → http://localhost:8000
```

**Решение 2** (проверить прокси):
```javascript
// frontend/vite.config.js
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8000',  // Должен быть настроен
      '/ws': 'http://localhost:8000',
    }
  }
})
```

---

### ❓ Ошибка `SECRET_KEY is required in production`

**Причина**: В production режиме обязателен `SECRET_KEY`.

**Решение**:
```bash
# Создайте .env файл в backend/
cd backend
cat > .env << EOF
ENV=production
SECRET_KEY=ваш-секретный-ключ-минимум-32-символа
DATABASE_URL=postgresql://user:pass@localhost/dbname
EOF

# Или сгенерируйте ключ:
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

### ❓ `npm install` выдаёт ошибки на Windows

**Причина**: Несовместимость line endings (CRLF vs LF).

**Решение**:
```bash
# Настройте git для автоконвертации
git config --global core.autocrlf true

# Переклонируйте репозиторий
git clone https://github.com/your-repo/delo-marketplace.git
cd delo-marketplace/frontend
npm install
```

---

## База данных и миграции

### ❓ Ошибка `table "users" already exists` при миграции

**Причина**: База создана через `Base.metadata.create_all()`, а потом запущена Alembic миграция.

**Решение**:
```bash
# Отметьте текущую схему как актуальную
cd backend
alembic stamp head

# Теперь применяйте только новые миграции
alembic upgrade head
```

---

### ❓ SQLite: `database is locked`

**Причина**: Несколько процессов пытаются писать в SQLite одновременно.

**Решение 1** (для dev):
```bash
# Остановите все процессы backend
pkill -f uvicorn

# Запустите только один инстанс
uvicorn main:app --reload
```

**Решение 2** (для prod):
```bash
# Используйте PostgreSQL вместо SQLite
# В .env:
DATABASE_URL=postgresql://user:pass@localhost/delo_marketplace
```

---

### ❓ Как сбросить базу данных?

**SQLite (dev)**:
```bash
cd backend
rm marketplace_v3.db   # Удаляем файл БД
python seed_demo.py    # Пересоздаём с демо-данными
```

**PostgreSQL (prod)**:
```bash
# Осторожно: удалит все данные!
psql -U postgres
DROP DATABASE delo_marketplace;
CREATE DATABASE delo_marketplace;
\q

cd backend
alembic upgrade head   # Применяем миграции
python seed_demo.py    # Опционально: демо-данные
```

---

### ❓ Alembic: `Can't locate revision identified by 'xxxx'`

**Причина**: История миграций сломана или миграция удалена.

**Решение**:
```bash
# Проверьте текущую ревизию в БД
alembic current

# Если её нет в migrations/versions/, сбросьте:
alembic stamp head  # Установить последнюю ревизию

# Или создайте новую миграцию от текущего состояния:
alembic revision --autogenerate -m "sync_database"
alembic upgrade head
```

---

## Аутентификация и безопасность

### ❓ Ошибка `Could not validate credentials` при каждом запросе

**Причина 1**: `SECRET_KEY` изменился (токены стали невалидными).

**Решение**:
```bash
# Перелогиньтесь
# В frontend: localStorage.clear() в console браузера
# Затем войдите снова через /login
```

**Причина 2**: Токен истёк.

**Решение**:
```javascript
// В frontend используйте refresh token
if (response.status === 401) {
  const newToken = await refreshAccessToken(refreshToken);
  // Повторите запрос с новым токеном
}
```

---

### ❓ CSRF token validation failed

**Причина**: CSRF токен не отправляется или не совпадает с cookie.

**Решение**:
```javascript
// 1. Получите CSRF токен при загрузке приложения
const response = await fetch('/csrf-token');
const { csrf_token } = await response.json();

// 2. Сохраните в localStorage
localStorage.setItem('csrf_token', csrf_token);

// 3. Отправляйте в заголовке для state-changing запросов
fetch('/api/tasks/', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': localStorage.getItem('csrf_token'),
    'Content-Type': 'application/json'
  },
  credentials: 'include'  // Важно для cookies!
})
```

---

### ❓ Как сбросить пароль пользователя вручную?

**Через SQL**:
```bash
# 1. Сгенерируйте хеш нового пароля
python -c "from passlib.hash import bcrypt; print(bcrypt.hash('newpassword123'))"

# 2. Обновите в БД
psql delo_marketplace
UPDATE users SET password = '$2b$12$...' WHERE email = 'user@example.com';
```

**Через Python**:
```python
from app.core.database import SessionLocal
from app.models import User
from app.core.security import get_password_hash

db = SessionLocal()
user = db.query(User).filter(User.email == "user@example.com").first()
user.password = get_password_hash("newpassword123")
db.commit()
```

---

### ❓ Rate limit: `Too many requests`

**Причина**: Превышен лимит 10 запросов/мин с одного IP.

**Решение 1** (для dev):
```python
# В backend/app/core/config.py временно отключите
RATE_LIMIT_ENABLED = False
```

**Решение 2** (для prod с load balancer):
```python
# В app/core/rate_limit.py проверьте X-Forwarded-For
# Убедитесь, что load balancer в TRUSTED_PROXIES
TRUSTED_PROXIES = ["10.0.0.0/8", "172.16.0.0/12"]
```

---

## Эскроу и транзакции

### ❓ Ошибка `Insufficient balance` при назначении исполнителя

**Причина**: У заказчика недостаточно средств на балансе.

**Решение**:
```bash
# Development: пополните через демо-эндпоинт
curl -X POST http://localhost:8000/wallet/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100000}'

# Production: купите пакет или пополните через ЮKassa
```

---

### ❓ Заказ завершён дважды (двойная выплата)

**Причина**: Race condition — два запроса `/complete` одновременно.

**Проверка**:
```sql
-- Проверьте транзакции в БД
SELECT * FROM transactions WHERE task_id = 123 AND type = 'task_completed';
-- Должна быть только ОДНА запись!
```

**Решение** (уже реализовано):
```python
# В app/api/tasks.py используется SELECT FOR UPDATE
task = db.query(Task).filter(Task.id == task_id).with_for_update().first()

# + Idempotency check
if task.status != "in_progress":
    raise HTTPException(status_code=400, detail="Task already completed")
```

---

### ❓ Комиссия платформы не учитывается

**Причина**: Забыли проверить `is_pro` статус.

**Проверка**:
```python
# В app/api/tasks.py @router.put("/{id}/complete")
specialist = db.query(User).filter(User.id == task.assigned_to).first()

# Для PRO комиссия 0%
if specialist.is_pro:
    fee = 0
else:
    fee = int(task.budget * 0.05)  # 5%

payout = task.budget - fee
```

---

### ❓ Как вернуть средства из эскроу вручную?

**SQL**:
```sql
BEGIN;
  -- Вернуть заказчику
  UPDATE users SET balance = balance + 10000 WHERE id = <customer_id>;
  
  -- Изменить статус заказа
  UPDATE tasks SET status = 'cancelled' WHERE id = <task_id>;
  
  -- Добавить транзакцию
  INSERT INTO transactions (type, user_id, task_id, amount, created_at) 
  VALUES ('escrow_refund', <customer_id>, <task_id>, 10000, NOW());
COMMIT;
```

---

## WebSocket и чат

### ❓ WebSocket не подключается: `WebSocket connection failed`

**Причина 1**: Backend не поддерживает WebSocket (используется gunicorn).

**Решение**:
```bash
# Используйте uvicorn с --workers 1 или без workers
uvicorn main:app --host 0.0.0.0 --port 8000

# Не используйте gunicorn без конфигурации WebSocket!
```

**Причина 2**: Nginx не проксирует WebSocket.

**Решение** (nginx.conf):
```nginx
location /ws {
    proxy_pass http://backend:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

---

### ❓ Сообщения в чате не приходят в реальном времени

**Причина**: WebSocket соединение не установлено.

**Проверка** (browser console):
```javascript
// Проверьте, что WebSocket подключён
const ws = new WebSocket('ws://localhost:3000/ws/tasks/123?token=your_jwt');
ws.onopen = () => console.log('Connected');
ws.onmessage = (msg) => console.log('Message:', msg.data);
```

**Fallback**: Используйте polling (REST API):
```javascript
// Каждые 3 секунды запрашивайте новые сообщения
setInterval(async () => {
  const res = await fetch(`/api/tasks/${taskId}/messages`);
  const messages = await res.json();
  updateChat(messages);
}, 3000);
```

---

### ❓ WebSocket rate limit: `Rate limit exceeded`

**Причина**: Более 10 сообщений в минуту от одного пользователя.

**Решение 1** (для dev):
```python
# В app/api/chat.py увеличьте лимит
WS_MESSAGE_LIMIT = 100  # Было 10
WS_WINDOW_SECONDS = 60
```

**Решение 2** (для prod):
```javascript
// Добавьте debounce на клиенте
let lastSent = 0;
function sendMessage(text) {
  const now = Date.now();
  if (now - lastSent < 6000) {  // Минимум 6 секунд между сообщениями
    alert('Пожалуйста, подождите перед отправкой следующего сообщения');
    return;
  }
  ws.send(JSON.stringify({ message: text }));
  lastSent = now;
}
```

---

## Production деплой

### ❓ Docker: `Connection refused` к PostgreSQL

**Причина**: Backend стартует раньше, чем PostgreSQL готов принимать соединения.

**Решение** (docker-compose.yml):
```yaml
services:
  backend:
    depends_on:
      postgres:
        condition: service_healthy  # Ждём healthcheck
    
  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
```

---

### ❓ Nginx 502 Bad Gateway

**Причина**: Backend не запущен или недоступен.

**Проверка**:
```bash
# Проверьте, что backend работает
docker-compose ps

# Проверьте логи
docker-compose logs backend

# Проверьте, что backend отвечает изнутри контейнера
docker-compose exec nginx curl http://backend:8000/health
```

**Решение**:
```bash
# Перезапустите backend
docker-compose restart backend

# Или пересоберите
docker-compose up -d --build backend
```

---

### ❓ Sentry не получает ошибки

**Причина 1**: `SENTRY_DSN` не задан.

**Решение**:
```bash
# В .env добавьте
SENTRY_DSN=https://xxx@sentry.io/yyy
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

**Причина 2**: Ошибки ловятся до Sentry.

**Проверка**:
```python
# Убедитесь, что в коде нет голых try-except
try:
    risky_operation()
except Exception as e:
    # BAD: ошибка проглочена
    print(f"Error: {e}")

# GOOD: ошибка пробрасывается или логируется
try:
    risky_operation()
except Exception as e:
    logger.error(f"Operation failed", exc_info=True)  # Отправится в Sentry
    raise
```

---

### ❓ Redis не подключается: `Connection refused`

**Причина**: Redis не запущен или `REDIS_URL` неверный.

**Решение**:
```bash
# Проверьте Redis
docker-compose ps redis

# Проверьте соединение
docker-compose exec redis redis-cli ping
# Должен вернуть: PONG

# Проверьте REDIS_URL в .env
REDIS_URL=redis://redis:6379/0  # В Docker
# или
REDIS_URL=redis://localhost:6379/0  # Локально
```

**Fallback**: Rate limiting без Redis (in-memory):
```python
# В app/core/container.py уже реализован fallback
def get_redis(self):
    try:
        client = redis.from_url(settings.REDIS_URL)
        client.ping()
        return client
    except Exception:
        return None  # Rate limiter использует dict
```

---

## Тестирование

### ❓ E2E тест падает: `AssertionError: Expected 200, got 401`

**Причина**: JWT токен не передаётся в запросах.

**Проверка**:
```python
# В tests/e2e_api_test.py убедитесь, что токен в headers
response = requests.get(
    f"{API_BASE}/users/me",
    headers={"Authorization": f"Bearer {token}"}  # Обязательно!
)
```

---

### ❓ Как запустить только один тест?

**pytest**:
```bash
# Установите pytest
pip install pytest

# Запустите конкретный тест
pytest tests/e2e_api_test.py::test_create_task -v

# Или по паттерну
pytest tests/ -k "test_escrow" -v
```

**unittest** (текущий способ):
```python
# В конце файла tests/e2e_api_test.py
if __name__ == "__main__":
    suite = unittest.TestLoader().loadTestsFromName('__main__.TestAPI.test_create_task')
    unittest.TextTestRunner(verbosity=2).run(suite)
```

---

### ❓ Как мокировать внешние сервисы (ЮKassa, SMTP)?

**pytest-mock**:
```python
# tests/conftest.py
import pytest
from unittest.mock import Mock, patch

@pytest.fixture
def mock_yookassa():
    with patch('app.api.payments.yookassa_payment') as mock:
        mock.return_value = {"id": "test_payment", "status": "pending"}
        yield mock

# tests/test_payments.py
def test_create_payment(mock_yookassa):
    response = client.post("/monetization/buy", json={"package": "pro_1"})
    assert response.status_code == 200
    mock_yookassa.assert_called_once()
```

---

## Разработка

### ❓ Как добавить новое поле в модель?

**Шаги**:
```python
# 1. Обновите модель в backend/app/models/__init__.py
class User(Base):
    # ... existing fields
    phone_number = Column(String, nullable=True)  # Новое поле

# 2. Создайте Alembic миграцию
cd backend
alembic revision --autogenerate -m "add_user_phone_number"

# 3. Проверьте сгенерированную миграцию
# backend/migrations/versions/xxxx_add_user_phone_number.py

# 4. Примените миграцию
alembic upgrade head

# 5. Обновите Pydantic схему (если нужна в API)
# backend/app/schemas.py
class UserPublic(BaseModel):
    phone_number: Optional[str] = None
```

---

### ❓ Как добавить новый API endpoint?

**Шаги**:
```python
# 1. Создайте роутер (или используйте существующий)
# backend/app/api/my_feature.py
from fastapi import APIRouter, Depends
from app.core.security import get_current_user

router = APIRouter(prefix="/my-feature", tags=["My Feature"])

@router.get("/")
def my_endpoint(current_user = Depends(get_current_user)):
    return {"message": "Hello from my feature"}

# 2. Подключите в main.py
from app.api.my_feature import router as my_feature_router

app.include_router(my_feature_router)

# 3. Тестируйте
curl http://localhost:8000/my-feature/
```

---

### ❓ Как отладить SQL запросы?

**Включите SQL логирование**:
```python
# backend/app/core/database.py
engine = create_engine(
    DATABASE_URL,
    echo=True  # Печатает все SQL запросы в консоль
)
```

**Или используйте SQL Alchemy events**:
```python
from sqlalchemy import event
from sqlalchemy.engine import Engine
import logging

logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

@event.listens_for(Engine, "before_cursor_execute")
def receive_before_cursor_execute(conn, cursor, statement, params, context, executemany):
    print(f"SQL: {statement}")
    print(f"Params: {params}")
```

---

### ❓ Как работать с datetime правильно?

**Рекомендация**:
```python
# Всегда используйте UTC
from datetime import datetime, timezone

# BAD
now = datetime.now()  # Локальное время (может сломаться при деплое)

# GOOD
now = datetime.utcnow()  # UTC время

# BETTER (Python 3.11+)
now = datetime.now(timezone.utc)  # Timezone-aware

# В моделях (после datetime миграции):
from sqlalchemy import DateTime

class Task(Base):
    created_at = Column(DateTime, default=datetime.utcnow)  # Не .isoformat()!
```

---

### ❓ Как профилировать производительность?

**Line profiler**:
```bash
pip install line_profiler

# Добавьте декоратор
@profile
def slow_function():
    # ваш код

# Запустите
kernprof -l -v backend/app/api/tasks.py
```

**FastAPI middleware**:
```python
import time

@app.middleware("http")
async def log_slow_requests(request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    
    if duration > 1.0:  # Медленнее 1 секунды
        logger.warning(f"Slow request: {request.url.path} took {duration:.2f}s")
    
    return response
```

---

### ❓ Git: как откатить последний коммит?

**Soft reset** (изменения остаются):
```bash
git reset --soft HEAD~1
# Изменения в staging, можно отредактировать и закоммитить снова
```

**Hard reset** (изменения удалятся):
```bash
git reset --hard HEAD~1
# Осторожно: изменения потеряны!
```

**Revert** (создаёт новый коммит с откатом):
```bash
git revert HEAD
# Безопасный способ, сохраняет историю
```

---

## 🆘 Где получить помощь?

1. **Документация проекта**:
   - [README.md](../README.md)
   - [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md)
   - [TASK_STATES_DIAGRAM.md](TASK_STATES_DIAGRAM.md)
   - [SECURITY_IMPROVEMENTS.md](SECURITY_IMPROVEMENTS.md)
   - [ARCHITECTURE_IMPROVEMENTS.md](ARCHITECTURE_IMPROVEMENTS.md)

2. **API документация**:
   - Swagger UI: http://localhost:8000/docs
   - ReDoc: http://localhost:8000/redoc

3. **Логи**:
   ```bash
   # Backend логи
   docker-compose logs -f backend
   
   # Frontend логи (browser console)
   F12 → Console
   
   # Sentry (production)
   https://sentry.io/your-project
   ```

4. **Дебаггинг**:
   ```python
   # Добавьте в код для точки останова
   import pdb; pdb.set_trace()
   
   # Или используйте IDE (VS Code, PyCharm)
   ```

---

**Дата**: 2026-09-12  
**Версия**: 2.2.0

Не нашли ответ? Создайте issue в GitHub: [github.com/your-repo/issues](https://github.com/topleki57tuu-glitch/delo-marketplace/issues)
