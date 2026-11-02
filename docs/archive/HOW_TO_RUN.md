# 🚀 Запуск ДЕЛО Marketplace

## Быстрый старт (локально)

### 1. Запуск Backend (FastAPI)

```bash
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend будет доступен на: **http://localhost:8000**

API Docs (Swagger): **http://localhost:8000/docs**

### 2. Запуск Frontend (React)

Открой новый терминал:

```bash
cd frontend
npm run dev
```

Frontend будет доступен на: **http://localhost:5173**

---

## 📱 Готовые ссылки для открытия

После запуска обоих серверов:

### Frontend (пользовательский интерфейс):
🔗 **http://localhost:5173**

### Backend API:
🔗 **http://localhost:8000/docs** - Swagger UI (документация API)
🔗 **http://localhost:8000/payments/status** - проверка статуса платежных систем

---

## ⚡ Быстрая проверка

### 1. Проверь что backend работает:
```bash
curl http://localhost:8000/payments/status
```

Должен вернуть:
```json
{
  "yookassa": {"configured": false},
  "yoomoney": {"configured": true}
}
```

### 2. Открой браузер:
```
http://localhost:5173
```

### 3. Создай тестовый аккаунт:
- Нажми "Регистрация"
- Email: test@example.com
- Пароль: password123
- Роль: Заказчик или Исполнитель
- Готово! ✅

---

## 🌐 Production URLs (после деплоя)

После деплоя на сервер замени localhost на свой домен:

### Если используешь один домен:
- Frontend: **https://yourdomain.com**
- Backend: **https://yourdomain.com/api**

### Если используешь поддомены:
- Frontend: **https://delo-marketplace.com**
- Backend: **https://api.delo-marketplace.com**

---

## 🐳 Альтернатива: запуск через Docker (опционально)

Если хочешь использовать Docker, нужно создать:

```bash
# 1. Создай Dockerfile для backend
# 2. Создай Dockerfile для frontend
# 3. Создай docker-compose.yml
# 4. Запусти: docker-compose up
```

---

## 🔥 Текущий статус серверов

Проверь запущены ли серверы:

```bash
# Backend
curl http://localhost:8000/docs

# Frontend
curl http://localhost:5173
```

Если не запущены - запусти их командами выше!

---

## 📞 Нужна помощь?

Если серверы не запускаются:

1. **Backend не стартует:**
   ```bash
   cd backend
   pip install -r requirements.txt
   python -m uvicorn app.main:app --reload
   ```

2. **Frontend не стартует:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. **Порты заняты:**
   - Backend на другом порту: `--port 8001`
   - Frontend на другом порту: `npm run dev -- --port 5174`
