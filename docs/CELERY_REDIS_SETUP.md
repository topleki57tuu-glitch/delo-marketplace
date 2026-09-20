# Celery & Redis Production Setup Guide

## Асинхронные задачи и очередь задач

Этот гайд описывает настройку Celery + Redis для асинхронной обработки задач в production.

---

## 🎯 Зачем нужен Celery?

### Проблемы без Celery:
- ❌ Отправка email блокирует HTTP запрос (~2-5 секунд)
- ❌ Обработка изображений замедляет ответ API
- ❌ Нет механизма для scheduled tasks (cleanup, reports)
- ❌ Retry логика для failed операций сложна

### С Celery:
- ✅ Email отправляется в фоне - ответ API мгновенный
- ✅ Долгие операции не блокируют пользователей
- ✅ Автоматический retry при сбоях
- ✅ Scheduled tasks (cleanup каждую ночь)
- ✅ Мониторинг и метрики задач

---

## 📦 Установка

### 1. Установка Redis

**Docker (рекомендовано для development):**
```bash
docker run -d \
  --name redis \
  -p 6379:6379 \
  --restart unless-stopped \
  redis:7-alpine
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

**Проверка:**
```bash
redis-cli ping
# Ответ: PONG
```

### 2. Установка Python зависимостей

```bash
cd backend
pip install celery redis
```

### 3. Конфигурация .env

```bash
# Redis для кеша
REDIS_URL=redis://localhost:6379/0

# Celery broker и backend
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2

# SMTP для отправки email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@delo.ru
```

---

## 🚀 Запуск Celery

### Development (локально)

**Terminal 1 - Backend API:**
```bash
cd backend
uvicorn main:app --reload
```

**Terminal 2 - Celery Worker:**
```bash
cd backend
celery -A app.core.celery_app worker --loglevel=info
```

**Terminal 3 - Celery Beat (scheduled tasks):**
```bash
cd backend
celery -A app.core.celery_app beat --loglevel=info
```

### Production: где воркер и beat уже объявлены

Гайд ниже описывает запуск руками (systemd, три терминала). Это рабочий путь,
но не единственный и не основной: воркер и beat объявлены в самих контурах
развёртывания, и на них ничего дополнительно поднимать не нужно.

| Контур | Файл | Сервисы |
|---|---|---|
| VPS на Docker | `docker-compose.prod.yml` | `worker`, `beat` (плюс `redis` и `postgres`) |
| Render | `render.yaml` | `marketplace-worker`, `marketplace-beat` (`type: worker`) |
| VPS без Docker | этот документ, раздел про systemd | `celery-worker`, `celery-beat` |

История, которую стоит знать. Раньше воркера не было **ни в одном** из этих
контуров: 11 задач существовали, импортировались и не выполнялись никем. При
этом код в трёх местах (`app/api/admin.py`, `app/api/responses.py`,
`app/api/tasks.py`) уже опирался на этот факт — права PRO считались по дате,
а не по флагу, именно потому, что снять флаг было некому. Теперь воркер есть,
но проверка по дате осталась: между истечением срока и ближайшим запуском
задачи проходит до суток.

**Переменные `CELERY_BROKER_URL` и `CELERY_RESULT_BACKEND` задавать не
обязательно.** Номер базы выводится из `REDIS_URL` подстановкой (`/1` для
брокера, `/2` для результатов), причём именно заменой номера, а не
дописыванием: `redis://redis:6379/0` плюс `/1` давало `.../0/1`, kombu читал
это как имя базы и падал с `ValueError: invalid literal for int(): '0/1'`
при первой же отправке задачи. Явные значения, как в примере `.env` выше,
по-прежнему уважаются и нужны только для внешнего брокера.

### Production (systemd services)

**1. Celery Worker Service:**

`/etc/systemd/system/celery-worker.service`
```ini
[Unit]
Description=Celery Worker for DELO Marketplace
After=network.target redis.service

[Service]
Type=forking
User=www-data
Group=www-data
WorkingDirectory=/var/www/delo-marketplace/backend
Environment="PATH=/var/www/delo-marketplace/backend/venv/bin"
ExecStart=/var/www/delo-marketplace/backend/venv/bin/celery \
  -A app.core.celery_app worker \
  --loglevel=info \
  --logfile=/var/log/celery/worker.log \
  --pidfile=/var/run/celery/worker.pid \
  --concurrency=4

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**2. Celery Beat Service:**

`/etc/systemd/system/celery-beat.service`
```ini
[Unit]
Description=Celery Beat Scheduler for DELO Marketplace
After=network.target redis.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/delo-marketplace/backend
Environment="PATH=/var/www/delo-marketplace/backend/venv/bin"
ExecStart=/var/www/delo-marketplace/backend/venv/bin/celery \
  -A app.core.celery_app beat \
  --loglevel=info \
  --logfile=/var/log/celery/beat.log \
  --pidfile=/var/run/celery/beat.pid \
  --schedule=/var/run/celery/celerybeat-schedule

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**3. Создание директорий и запуск:**
```bash
# Директории для логов и pid
sudo mkdir -p /var/log/celery /var/run/celery
sudo chown www-data:www-data /var/log/celery /var/run/celery

# Включение и запуск
sudo systemctl enable celery-worker celery-beat
sudo systemctl start celery-worker celery-beat

# Проверка статуса
sudo systemctl status celery-worker
sudo systemctl status celery-beat

# Логи
sudo journalctl -u celery-worker -f
sudo journalctl -u celery-beat -f
```

---

## 💻 Использование в коде

### Отправка email: фон и синхронный вызов

**Как было (своя копия SMTP-клиента прямо в роутере):**
```python
# app/api/auth.py
def send_email(to, subject, body):
    # ... 20 строк на smtplib
    pass

@router.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    # ...
    send_email(user.email, "Сброс пароля", body)  # ❌ блокирует запрос на 2-5 сек
    return {"message": "Email отправлен"}
```

Таких копий было три: эта, `send_email_sync` в `app/tasks/email.py` и
`send_email_task` там же. Различались они только типом исключения при
незаданном SMTP — `HTTPException(503)` здесь и `Exception` там. Копии в этом
проекте уже расходились молча (`user_online`, `hasattr(x, "value")` в 23
местах), поэтому транспорт вынесен в один модуль — `app/core/email.py`.

**Как сейчас:**
```python
# app/api/auth.py
from app.core.email import EmailNotConfigured, send_email_sync

@router.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    try:
        send_email_sync(user.email, "Сброс пароля", body)
    except EmailNotConfigured:
        # SMTP не задан — на стенде отдаём ссылку в ответе
        ...
    return {"message": "Если аккаунт существует, письмо со ссылкой отправлено"}
```

**Сброс пароля остаётся синхронным намеренно, и это не недоделка.** Отправка
через `.delay()` требует живого брокера, то есть недоступный Redis означал бы
недоступный сброс пароля. Запрос на сброс — редкое действие, которое делает
сам пользователь, и 2 секунды на нём приемлемы; отказ из-за чужого сервиса —
нет. Плюс ответ намеренно одинаковый для существующего и несуществующего
адреса (защита от перебора), поэтому `except` здесь есть всегда.

### Отправка в фон: когда это действительно нужно

Рассылки и уведомления — другое дело: там запрос инициирует не тот, кто ждёт
письмо, и цена ошибки другая.

```python
from app.tasks.email import send_email_task

# Из кода FastAPI:
send_email_task.delay("user@example.com", "Тема", "Текст")
```

**Сейчас ни одна задача из `app/tasks/email.py` в очередь не ставится.**
`send_bulk_emails` и `send_notification_email` — готовый путь для рассылок,
но перед использованием их нужно подключить в вызывающем коде. Это написано и
в докстроке самого модуля, чтобы «задача есть» не читалось как «задача
работает».

### Отправка уведомлений

```python
from app.tasks.email import send_notification_email

# При назначении исполнителя
send_notification_email.delay(
    specialist.email,
    "Вас выбрали исполнителем!",
    f"Заказчик назначил вас на задачу \"{task.title}\"",
    task_id=task.id
)
```

### Ручной вызов cleanup задач

```python
from app.tasks.cleanup import cleanup_old_notifications

# Вызов сразу (для тестирования)
result = cleanup_old_notifications.apply()
print(result.get())  # {'deleted': 42}

# Или в фоне
cleanup_old_notifications.delay()
```

---

## ⏰ Scheduled Tasks (Celery Beat)

Настроены в `app/core/celery_app.py`:

| Задача | Расписание | Описание |
|--------|-----------|----------|
| `cleanup_old_notifications` | Каждую ночь в 3:00 | Удаляет прочитанные уведомления >30 дней |
| `cleanup_expired_csrf_tokens` | Каждый час | Очистка expired CSRF токенов |
| `check_expired_pro_subscriptions` | Каждый день в 9:00 | Отключает истекшие PRO подписки |

**Добавление новой scheduled задачи:**
```python
# app/core/celery_app.py
celery_app.conf.beat_schedule = {
    'generate-daily-report': {
        'task': 'app.tasks.reports.generate_daily_report',
        'schedule': crontab(hour=8, minute=0),  # Каждый день в 8:00
    },
}
```

---

## 📊 Мониторинг

### Flower (Web UI для Celery)

**Установка:**
```bash
pip install flower
```

**Запуск:**
```bash
celery -A app.core.celery_app flower --port=5555
```

**Доступ:**
- URL: http://localhost:5555
- Видно: активные задачи, history, statistics, workers

**Production с basic auth:**
```bash
celery -A app.core.celery_app flower \
  --port=5555 \
  --basic_auth=admin:secure_password
```

### CLI команды

```bash
# Проверка активных workers
celery -A app.core.celery_app inspect active

# Проверка scheduled tasks
celery -A app.core.celery_app inspect scheduled

# Статистика workers
celery -A app.core.celery_app inspect stats

# Health check
celery -A app.core.celery_app inspect ping
```

### Redis мониторинг

```bash
# Подключение к Redis CLI
redis-cli

# Количество задач в очереди
LLEN celery

# Количество результатов
KEYS celery-task-meta-*

# Memory usage
INFO memory

# Статистика
INFO stats
```

---

## 🔧 Troubleshooting

### Celery worker не запускается

**Проблема:** `ModuleNotFoundError: No module named 'app'`

**Решение:**
```bash
# Убедитесь что запускаете из backend/
cd backend
celery -A app.core.celery_app worker --loglevel=info
```

### Email не отправляются

**Проверка SMTP:**
```python
# Test script
from app.core.email import EmailNotConfigured, send_email_sync

try:
    send_email_sync("test@example.com", "Test", "Test body")
    print("Email sent!")
except EmailNotConfigured as e:
    print(f"SMTP не настроен: {e}")
except Exception as e:
    print(f"Error: {e}")
```

**Gmail App Password:**
1. Включите 2FA в Gmail
2. Сгенерируйте App Password: https://myaccount.google.com/apppasswords
3. Используйте этот пароль в `SMTP_PASS`

### Задачи не выполняются

**1. Проверка Redis:**
```bash
redis-cli ping
# Должно вернуть: PONG
```

**2. Проверка Celery worker:**
```bash
celery -A app.core.celery_app inspect active
# Должен показать список активных workers
```

**3. Проверка задачи в коде:**
```python
# Синхронный вызов для debugging
from app.tasks.email import send_email_task
result = send_email_task.apply(args=["test@example.com", "Test", "Body"])
print(result.get())  # Ждет выполнения и возвращает результат
```

### Memory leaks в workers

**Симптомы:** Worker использует >1GB RAM

**Решение:** Настроен `worker_max_tasks_per_child=1000` - worker перезапускается после 1000 задач

**Дополнительно:**
```python
# app/core/celery_app.py
celery_app.conf.worker_max_memory_per_child = 200000  # 200MB limit
```

---

## 🎯 Production Checklist

**Infrastructure:**
- [ ] Redis установлен и настроен
- [ ] Celery worker запущен как systemd service
- [ ] Celery beat запущен как systemd service
- [ ] Логи настроены: `/var/log/celery/`
- [ ] Monitoring: Flower или другой APM

**Configuration:**
- [ ] `REDIS_URL` настроен в .env
- [ ] `CELERY_BROKER_URL` и `CELERY_RESULT_BACKEND` настроены
- [ ] SMTP credentials настроены
- [ ] Concurrency настроен под нагрузку (4-8 workers)

**Security:**
- [ ] Redis защищен firewall (только localhost или VPC)
- [ ] Flower защищен basic auth
- [ ] SMTP credentials в .env (не в коде)

**Monitoring:**
- [ ] Alerting на failed tasks
- [ ] Memory usage мониторинг
- [ ] Queue size мониторинг (>1000 = проблема)

---

## 📈 Performance Tips

### Concurrency

```bash
# 4 worker processes (по умолчанию = CPU cores)
celery -A app.core.celery_app worker --concurrency=4

# Для I/O bound задач (email, API calls) - больше workers
celery -A app.core.celery_app worker --concurrency=8

# Для CPU bound задач (image processing) - меньше workers
celery -A app.core.celery_app worker --concurrency=2
```

### Priority queues

```python
# app/core/celery_app.py
celery_app.conf.task_routes = {
    # Имя задачи — то, что записано в `name=` декоратора, а не имя функции.
    # Функция называется send_email_task, а задача — send_email: ключ ниже
    # раньше был 'app.tasks.email.send_email_task', и правило не срабатывало
    # бы вообще (celery просто не находит такую задачу).
    'app.tasks.email.send_email': {'queue': 'high_priority'},
    'app.tasks.cleanup.*': {'queue': 'low_priority'},
}
```

```bash
# Запуск workers для разных очередей
celery -A app.core.celery_app worker -Q high_priority --concurrency=4
celery -A app.core.celery_app worker -Q low_priority --concurrency=2
```

### Result expiration

```python
# Результаты хранятся 1 час (по умолчанию)
celery_app.conf.result_expires = 3600

# Или не сохранять результаты вообще
@celery_app.task(ignore_result=True)
def send_email_fire_and_forget(to, subject, body):
    # Результат не сохраняется в Redis
    pass
```

---

## 🚀 Результат

После настройки Celery:
- ✅ Email отправка: 5000ms → 50ms response time (-99%)
- ✅ Автоматическая cleanup старых данных
- ✅ Retry для failed операций
- ✅ Monitoring и visibility
- ✅ Готовность к масштабированию
