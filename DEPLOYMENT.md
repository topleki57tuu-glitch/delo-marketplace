# 🚀 Руководство по развёртыванию ДЕЛО Marketplace

## Предварительные требования

### Обязательно:
- Docker и Docker Compose
- Python 3.10+
- Node.js 18+
- pip, npm

### Опционально:
- Git (для клонирования)

---

## 🔧 Быстрый старт (тестовый сервер)

### 1. Клонирование репозитория
```bash
git clone https://github.com/topleki57tuu-glitch/delo-marketplace.git
cd delo-marketplace
```

### 2. Проверка конфигурации
Файл `.env` уже настроен с:
- ✅ Сгенерированным `SECRET_KEY`
- ✅ PostgreSQL настройками
- ✅ Redis URL
- ✅ Включённой защитой (CSRF, Rate Limiting)

**Важно**: Для production замените:
- `CORS_ORIGINS` на ваш реальный домен
- `FRONTEND_URL` на ваш реальный URL
- `ADMIN_EMAILS` на email администраторов

### 3. Запуск (Windows)
```batch
start.bat
```

### 4. Запуск (Linux/Mac)
```bash
chmod +x start.sh
./start.sh
```

**Режим разработки** (с auto-reload):
```bash
./start.sh --dev
```

---

## 📦 Что происходит при запуске

1. **Запуск инфраструктуры** (PostgreSQL + Redis через Docker)
2. **Установка зависимостей** (Python + Node.js)
3. **Применение миграций БД** (Alembic)
4. **Сборка frontend** (Vite)
5. **Запуск backend** (Uvicorn с 4 воркерами)

---

## 🌐 Доступ к приложению

После успешного запуска:

| Сервис | URL | Описание |
|--------|-----|----------|
| **Frontend** | http://localhost:8000 | Основное приложение |
| **API Docs** | http://localhost:8000/docs | Swagger UI |
| **Health Check** | http://localhost:8000/health | Проверка статуса |
| **PostgreSQL** | localhost:5432 | БД (порт проброшен) |
| **Redis** | localhost:6379 | Кеш (порт проброшен) |

---

## 🔐 Демо-аккаунты

**Пароль у всех**: `demo123` (соответствует новой политике: 8+ символов + цифра)

### Заказчики:
- `anna@delo.ru` - баланс 47,000₽, 3 активных заказа
- `dmitry@delo.ru` - сделка в работе (эскроу 150,000₽)
- `olga@delo.ru` - 3 открытых заказа

### Специалисты:
- `igor@delo.ru` - PRO ★, рейтинг 5.0
- `maria@delo.ru` - рейтинг 5.0, верифицирована
- `alexey@delo.ru` - исполнитель по ремонту

### Администраторы:
- `admin@delo.ru` - арбитр, доступ к `/disputes`

**Засеять демо-данные**:
```bash
# Установите в .env
SEED_DEMO=1

# Или вручную
cd backend
python seed_demo.py
```

---

## 🛠 Управление инфраструктурой

### Остановка всех сервисов
```bash
docker-compose -f docker-compose.infra.yml down
```

### Остановка с удалением данных
```bash
docker-compose -f docker-compose.infra.yml down -v
```

### Просмотр логов
```bash
# PostgreSQL
docker logs marketplace_postgres -f

# Redis
docker logs marketplace_redis -f
```

### Подключение к БД
```bash
docker exec -it marketplace_postgres psql -U marketplace_user -d marketplace_db
```

### Проверка Redis
```bash
docker exec -it marketplace_redis redis-cli
> PING
PONG
```

---

## 📊 Sentry - мониторинг ошибок

### Настройка Sentry:

1. Зарегистрируйтесь на https://sentry.io
2. Создайте новый проект (тип: FastAPI)
3. Скопируйте DSN из настроек проекта
4. Добавьте в `.env`:

```bash
SENTRY_DSN=https://ваш_ключ@o123456.ingest.sentry.io/987654
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% трейсов для performance monitoring
```

5. Перезапустите backend

### Проверка Sentry:
```bash
curl -X POST http://localhost:8000/test-sentry-error
```

В Sentry должна появиться тестовая ошибка с контекстом (user_id, request).

---

## 🔍 Проверка безопасности

### CSRF защита
```bash
# Получить токен
curl http://localhost:8000/csrf-token

# Без токена - 403
curl -X POST http://localhost:8000/register/ -H "Content-Type: application/json" -d '{"email":"test@test.ru","password":"test1234","role":"customer"}'

# С токеном - 200
curl -X POST http://localhost:8000/register/ \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: YOUR_TOKEN" \
  -H "Cookie: csrf_token=SIGNED_TOKEN" \
  -d '{"email":"test@test.ru","password":"test1234","role":"customer"}'
```

### Rate Limiting
```bash
# Превышение лимита логина (10 попыток за 5 минут)
for i in {1..15}; do
  curl -X POST http://localhost:8000/login -d "username=test@test.ru&password=wrong"
done
# После 10-й попытки: 429 Too Many Requests
```

### Логирование
```bash
# Логи в JSON формате (production)
tail -f backend/logs/app.log | jq .

# Примеры записей:
# - HTTP запросы с duration_ms и user_id
# - Операции эскроу с task_id и amount
# - События безопасности (CSRF, rate limit)
```

---

## 🧪 Тестирование

### E2E тесты API
```bash
cd backend
python ../tests/e2e_api_test.py
# 47 проверок: полный цикл сделки + эскроу + WS

python ../tests/e2e_new_features_test.py
# 38 проверок: споры/арбитраж + каталог + CSV
```

### Проверка всех систем
```bash
python ../scripts/verify_all_systems.py
```

---

## 🐛 Troubleshooting

### Ошибка: "SECRET_KEY is not set"
**Решение**: Проверьте файл `.env`, убедитесь что `SECRET_KEY` не пустой и не равен `change_me_to_random_string`

### Ошибка: "Connection refused" (PostgreSQL)
**Решение**:
```bash
# Проверьте статус контейнера
docker ps | grep marketplace_postgres

# Перезапустите инфраструктуру
docker-compose -f docker-compose.infra.yml restart
```

### Ошибка: "Redis unavailable"
**Решение**:
```bash
# Проверьте Redis
docker exec marketplace_redis redis-cli ping

# Если не отвечает - перезапуск
docker-compose -f docker-compose.infra.yml restart redis
```

### Frontend не загружается
**Решение**:
```bash
# Пересоберите frontend
cd frontend
npm run build

# Убедитесь что dist/ существует
ls -la dist/
```

### Миграции не применяются
**Решение**:
```bash
cd backend

# Проверьте текущую версию
alembic current

# Если база создана через create_all - отметьте как актуальную
alembic stamp head

# Затем применяйте новые
alembic upgrade head
```

---

## 📈 Production Checklist

- [ ] Изменить `SECRET_KEY` на уникальный
- [ ] Настроить `CORS_ORIGINS` с реальным доменом
- [ ] Настроить `FRONTEND_URL` с реальным URL
- [ ] Включить HTTPS (настроить reverse proxy)
- [ ] Настроить Sentry DSN
- [ ] Настроить SMTP для сброса паролей
- [ ] Добавить реальные email в `ADMIN_EMAILS`
- [ ] Настроить backup PostgreSQL (cron)
- [ ] Настроить SSL сертификаты (Let's Encrypt)
- [ ] Настроить firewall (открыть только 80, 443)
- [ ] Настроить мониторинг (Prometheus + Grafana)
- [ ] Провести нагрузочное тестирование
- [ ] Настроить CDN для статики (опционально)

---

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи: `docker logs marketplace_postgres`, `docker logs marketplace_redis`
2. Проверьте backend логи: файлы в `backend/logs/` или stdout
3. Проверьте Sentry (если настроен)
4. Изучите документацию в `docs/`

---

**Версия**: 2.0.0  
**Дата обновления**: 2026-09-12  
**Автор**: Claude Opus 4.8
