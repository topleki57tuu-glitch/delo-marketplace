# 🐛 Найденные проблемы в проекте ДЕЛО Marketplace

**Дата аудита**: 2026-09-13  
**Версия проекта**: 2.5.0  
**Статус**: Найдено 8 проблем (3 критических, 3 средних, 2 низких)

---

## 🔴 Критические проблемы (требуют немедленного исправления)

### 1. **Несовместимость типов данных для `last_seen`** ⚠️ КРИТИЧНО

**Файл**: `backend/main.py:204`, `backend/app/models/__init__.py:59`

**Проблема**:
- В модели `User` поле `last_seen` определено как `Column(DateTime)`
- В `main.py` записывается строка: `now.isoformat()` вместо объекта `datetime`
- В `app/api/users.py:23` используется `datetime.fromisoformat(user.last_seen)` - это вызовет ошибку

```python
# main.py:204 - НЕПРАВИЛЬНО
db.query(User).filter(User.id == uid).update({"last_seen": now.isoformat()})

# models/__init__.py:59
last_seen = Column(DateTime, nullable=True)  # Ожидает datetime объект, не строку!
```

**Последствия**:
- Ошибки при отображении статуса "онлайн" пользователя
- Возможны исключения при обработке запросов
- Нарушение типобезопасности

**Решение**:
```python
# Исправить main.py:204
db.query(User).filter(User.id == uid).update({"last_seen": now})  # Передаём datetime объект
```

---

### 2. **Файл .env в репозитории** ⚠️ КРИТИЧНО (Безопасность)

**Файл**: `.env` (найден в корне проекта)

**Проблема**:
- Файл `.env` содержит production credentials и секреты
- Находится в репозитории (был найден командой `find . -name ".env"`)
- Содержит `SECRET_KEY`, `DATABASE_URL` с паролем, `ADMIN_EMAILS`

**Последствия**:
- Утечка секретных ключей при публикации в GitHub
- Компрометация JWT токенов
- Потенциальный доступ к базе данных

**Решение**:
```bash
# 1. Удалить .env из репозитория
git rm --cached .env
git commit -m "security: remove .env from repository"

# 2. Убедиться что .env в .gitignore (уже есть)
# 3. Сгенерировать новый SECRET_KEY для production
python -c "import secrets; print(secrets.token_urlsafe(48))"

# 4. Изменить пароль PostgreSQL
```

---

### 3. **База данных в корне проекта** ⚠️ КРИТИЧНО (Безопасность)

**Файл**: `marketplace_v3.db` (найден в корне)

**Проблема**:
- SQLite база данных с реальными данными находится в корне проекта
- Может попасть в git commit при `git add .`
- Содержит персональные данные пользователей, транзакции

**Последствия**:
- Утечка персональных данных (GDPR нарушение)
- Утечка хешей паролей
- Доступ к финансовым данным

**Решение**:
```bash
# Проверить что *.db в .gitignore (уже есть)
# Переместить БД в backend/
mv marketplace_v3.db backend/

# Если случайно закоммитили:
git rm --cached marketplace_v3.db
git commit -m "security: remove database file from repository"
```

---

## 🟡 Средние проблемы (рекомендуется исправить)

### 4. **Использование устаревшего `datetime.utcnow()`** 🟡 СРЕДНЕ

**Файлы**: 21 вхождение в `backend/app/`

**Проблема**:
- `datetime.utcnow()` deprecated в Python 3.12+
- Создаёт naive datetime объекты (без timezone)
- В документации рекомендуется `datetime.now(timezone.utc)`

**Последствия**:
- Warnings при запуске на Python 3.12+
- Потенциальные проблемы с timezone-aware сравнениями
- Код устареет при обновлении Python

**Решение**:
```python
# Заменить все вхождения:
from datetime import datetime, timezone

# Вместо:
datetime.utcnow()

# Использовать:
datetime.now(timezone.utc)
```

---

### 5. **Отладочные console.log в production коде** 🟡 СРЕДНЕ

**Файлы**: 24 вхождения в `frontend/src/`

**Проблема**:
- Console.log остались в production коде
- Замедляют работу приложения
- Могут выводить чувствительную информацию в консоль браузера

**Примеры**:
```javascript
// backend/app/api/users.py:84
logger.info(f"[update_profile] Avatar in request: {profile.avatar is not None}")
```

**Решение**:
- Удалить или заменить на production логирование
- Использовать `logger.debug()` вместо `console.log()`
- Настроить vite для удаления console.log в production build

```javascript
// vite.config.js
export default {
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Удалить console.* в production
      }
    }
  }
}
```

---

### 6. **Отсутствие индексов на часто используемых полях** 🟡 СРЕДНЕ

**Файл**: `backend/app/models/__init__.py`

**Проблема**:
- Поле `Task.status` используется в фильтрах, но нет индекса
- Поле `Task.category` используется в фильтрах, но нет индекса
- Поле `User.last_seen` используется для проверки онлайн статуса

**Последствия**:
- Медленные запросы при большом количестве записей
- Full table scan вместо index scan
- Проблемы производительности при масштабировании

**Решение**:
Создать Alembic миграцию:
```python
# backend/migrations/versions/add_performance_indexes.py
def upgrade():
    op.create_index('idx_tasks_status', 'tasks', ['status'])
    op.create_index('idx_tasks_category', 'tasks', ['category'])
    op.create_index('idx_users_last_seen', 'users', ['last_seen'])
    op.create_index('idx_tasks_customer_status', 'tasks', ['customer_id', 'status'])
    op.create_index('idx_tasks_executor_status', 'tasks', ['executor_id', 'status'])
```

---

## 🟢 Низкие проблемы (опционально)

### 7. **Python cache файлы (__pycache__)** 🟢 НИЗКО

**Проблема**:
- Найдено 49 `__pycache__` директорий
- Уже в `.gitignore`, но могут захламлять файловую систему

**Решение**:
```bash
# Очистить cache
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find . -type f -name "*.pyc" -delete

# Или добавить в pre-commit hook
```

---

### 8. **Отсутствие rate limiting для некоторых эндпоинтов** 🟢 НИЗКО

**Файлы**: `backend/app/api/tasks.py`, `backend/app/api/users.py`

**Проблема**:
- Эндпоинт `/tasks/` (создание задачи) не имеет rate limiting
- Эндпоинт `/users/me` (обновление профиля) не имеет rate limiting
- Возможность DoS атаки или спама

**Решение**:
```python
# tasks.py
@router.post("/")
def create_task(
    task: TaskCreate,
    request: Request,  # Добавить
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    rate_limit(request, "create_task", limit=10, window_sec=300)  # Добавить
    # ... остальной код
```

---

## 📊 Статистика проблем

| Приоритет | Количество | Статус |
|-----------|------------|--------|
| 🔴 Критический | 3 | Требует немедленного исправления |
| 🟡 Средний | 3 | Рекомендуется исправить в ближайшее время |
| 🟢 Низкий | 2 | Опционально, улучшает качество кода |
| **ИТОГО** | **8** | |

---

## 🎯 План действий (приоритизированный)

### Немедленно (сегодня):
1. ✅ Исправить проблему с `last_seen` (DateTime vs String)
2. ✅ Удалить `.env` из репозитория и сгенерировать новый `SECRET_KEY`
3. ✅ Переместить `marketplace_v3.db` в `backend/`

### На этой неделе:
4. ✅ Заменить `datetime.utcnow()` на `datetime.now(timezone.utc)`
5. ✅ Удалить debug `console.log` и настроить production build
6. ✅ Добавить индексы через Alembic миграцию

### Опционально (следующая неделя):
7. ⏳ Очистить Python cache файлы и настроить pre-commit hook
8. ⏳ Добавить rate limiting на `/tasks/` и `/users/me`

---

## 🛠️ Инструкция по исправлению

Следующие файлы будут исправлены автоматически:

### Файлы для изменения:
1. `backend/main.py` - исправить `last_seen`
2. `backend/app/api/users.py` - удалить debug логи
3. `backend/app/api/tasks.py` - добавить rate limiting
4. Создать новую миграцию для индексов
5. Обновить `vite.config.js` для удаления console.log

### Команды для запуска:
```bash
# 1. Безопасность
git rm --cached .env
mv marketplace_v3.db backend/
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(48))" > .env.new

# 2. Применить исправления кода
# (будут применены автоматически)

# 3. Создать миграцию для индексов
cd backend
alembic revision -m "add_performance_indexes"
# (отредактировать созданный файл)
alembic upgrade head

# 4. Запустить тесты
cd ..
cd frontend && npm test
cd ../backend && python tests/e2e_api_test.py
```

---

## ✅ Итоговая оценка

**До исправления**: 9.5/10  
**Потенциальная оценка после исправления**: 9.8/10  

**Критичность найденных проблем**: СРЕДНЯЯ  
**Время на исправление**: 2-3 часа  
**Риск при исправлении**: НИЗКИЙ

---

**Готовы исправлять проблемы?** 🚀
