# 🏗️ Архитектурная диаграмма платформы ДЕЛО

## Обзор системы

```
┌─────────────────────────────────────────────────────────────────────┐
│                          КЛИЕНТСКИЙ СЛОЙ                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────┐         ┌──────────────────┐                 │
│  │   React SPA      │         │  Telegram Bot    │                 │
│  │  (Vite + React)  │         │  (Python-telegram)│                │
│  │                  │         │                   │                 │
│  │  • Vite dev:3000 │         │  • Уведомления   │                 │
│  │  • Production:80 │         │  • Радар заказов │                 │
│  │  • React Router  │         │  • Фильтры       │                 │
│  └────────┬─────────┘         └────────┬─────────┘                 │
│           │                             │                            │
└───────────┼─────────────────────────────┼────────────────────────────┘
            │ HTTP/WS                     │ HTTP
            │                             │
┌───────────▼─────────────────────────────▼────────────────────────────┐
│                          ПРОКСИ СЛОЙ                                  │
├───────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Nginx (production)                         │   │
│  │                                                               │   │
│  │  • SSL/TLS терминация                                        │   │
│  │  • Статика (React build) → /                                │   │
│  │  • API proxy → /api → backend:8000                           │   │
│  │  • WebSocket proxy → /ws                                     │   │
│  │  • Gzip compression                                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                        │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
┌────────────────────────────────▼───────────────────────────────────────┐
│                          БЭКЕНД СЛОЙ                                   │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                   FastAPI Application                           │  │
│  │                        (main.py)                                │  │
│  │                                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                    MIDDLEWARE STACK                      │  │  │
│  │  ├─────────────────────────────────────────────────────────┤  │  │
│  │  │  1. CORS (явные origins)                               │  │  │
│  │  │  2. Security Headers (CSP, X-Frame-Options)            │  │  │
│  │  │  3. Request Logging (structured JSON)                  │  │  │
│  │  │  4. Upload Size Limit (10MB)                           │  │  │
│  │  │  5. Last Seen Tracking                                 │  │  │
│  │  │  6. Sentry Error Tracking                              │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                    API ROUTERS                           │  │  │
│  │  ├─────────────────────────────────────────────────────────┤  │  │
│  │  │  /auth          • register, login, logout, refresh     │  │  │
│  │  │  /users         • profile, switch-role, public         │  │  │
│  │  │  /tasks         • CRUD, assign, complete, cancel       │  │  │
│  │  │  /responses     • create, list (PRO priority)          │  │  │
│  │  │  /reviews       • create, list                         │  │  │
│  │  │  /chat          • messages (REST + WebSocket)          │  │  │
│  │  │  /payments      • ЮKassa integration                   │  │  │
│  │  │  /wallet        • transactions, deposit, CSV export    │  │  │
│  │  │  /notifications • list, read-all                       │  │  │
│  │  │  /disputes      • create, resolve (admin)              │  │  │
│  │  │  /verification  • request, approve/reject (admin)      │  │  │
│  │  │  /withdrawals   • request, process (admin)             │  │  │
│  │  │  /admin         • disputes management                  │  │  │
│  │  │  /files         • upload, retrieve                     │  │  │
│  │  │  /ai            • task-helper                          │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                 CORE SERVICES                            │  │  │
│  │  ├─────────────────────────────────────────────────────────┤  │  │
│  │  │  • security.py   → JWT, CSRF, hashing                  │  │  │
│  │  │  • database.py   → SQLAlchemy session                  │  │  │
│  │  │  • container.py  → DI (DB, Redis, services)            │  │  │
│  │  │  • config.py     → Settings (env vars)                 │  │  │
│  │  │  • logging.py    → Structured logs                     │  │  │
│  │  │  • rate_limit.py → HTTP + WebSocket limiter            │  │  │
│  │  │  • csrf.py       → Double Submit Cookie                │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└────────────────────────────┬──────────────┬─────────────────────────────┘
                             │              │
         ┌───────────────────┘              └─────────────┐
         │                                                 │
┌────────▼──────────┐                           ┌─────────▼──────────┐
│   DATA LAYER      │                           │   CACHE LAYER      │
├───────────────────┤                           ├────────────────────┤
│                   │                           │                    │
│  ┌─────────────┐ │                           │  ┌──────────────┐ │
│  │ PostgreSQL  │ │                           │  │    Redis     │ │
│  │  (prod)     │ │                           │  │              │ │
│  │             │ │                           │  │ • Rate limit │ │
│  │ or SQLite   │ │                           │  │ • Cache      │ │
│  │  (dev)      │ │                           │  │ • Sessions   │ │
│  └─────────────┘ │                           │  └──────────────┘ │
│                   │                           │                    │
│  Models:          │                           │  Port: 6379       │
│  • User           │                           │  Optional         │
│  • Task           │                           └────────────────────┘
│  • Response       │
│  • Message        │                           ┌────────────────────┐
│  • Transaction    │                           │  MONITORING        │
│  • Review         │                           ├────────────────────┤
│  • Notification   │                           │                    │
│  • Dispute        │                           │  ┌──────────────┐ │
│  • RefreshToken   │                           │  │   Sentry     │ │
│  • VerificationReq│                           │  │              │ │
│  • WithdrawalReq  │                           │  │ • Errors     │ │
│  • PaymentRecord  │                           │  │ • Traces     │ │
│  • StoredFile     │                           │  │ • Performance│ │
│  • PasswordReset  │                           │  └──────────────┘ │
│                   │                           │                    │
└───────────────────┘                           │  Production only   │
                                                └────────────────────┘
```

---

## Поток данных

### 1. Аутентификация

```
User → React SPA
         │
         ├─→ POST /register {email, password, role}
         │      │
         │      ├─→ hash password (bcrypt)
         │      ├─→ save to DB
         │      └─→ return user_id
         │
         ├─→ POST /login {email, password}
         │      │
         │      ├─→ verify password
         │      ├─→ create access_token (15 min)
         │      ├─→ create refresh_token (7 days) + save jti to DB
         │      └─→ return {access_token, refresh_token}
         │
         ├─→ POST /auth/refresh {refresh_token}
         │      │
         │      ├─→ verify token + check blacklist
         │      ├─→ create new access_token
         │      └─→ return {access_token}
         │
         └─→ POST /auth/logout
                │
                ├─→ revoke all user's refresh tokens (set revoked=True)
                └─→ return success
```

### 2. Создание заказа и отклик

```
Заказчик → POST /tasks/ {title, description, budget, category, city}
             │
             ├─→ validate role = "customer"
             ├─→ save Task (status="open")
             ├─→ notify Telegram subscribers
             └─→ return task_id
             
Специалист → GET /tasks/ (фильтры: category, city, search)
             │
             └─→ return tasks list (status="open")

Специалист → POST /tasks/{id}/responses {cover_letter}
             │
             ├─→ check response_credits > 0 (или is_pro=True)
             ├─→ save Response
             ├─→ decrement credits (если не PRO)
             ├─→ create Notification для заказчика
             └─→ return response_id

Заказчик → GET /tasks/{id}/responses
             │
             ├─→ load all responses
             ├─→ sort: PRO users first, then by created_at
             └─→ return responses[]
```

### 3. Эскроу и выполнение заказа

```
Заказчик → PUT /tasks/{id}/assign?specialist_id=X
             │
             ├─→ validate: task.customer_id == current_user.id
             ├─→ validate: customer.balance >= task.budget
             ├─→ BEGIN TRANSACTION
             │    ├─→ UPDATE users SET balance = balance - budget WHERE id = customer_id
             │    ├─→ UPDATE tasks SET status = "in_progress", assigned_to = X
             │    ├─→ INSERT transaction (type="escrow_hold")
             │    └─→ COMMIT
             ├─→ create Notification для специалиста
             └─→ return success

Специалист/Заказчик → WS /ws/tasks/{id} (чат)
                       │
                       ├─→ rate limit: 10 msg/min
                       ├─→ save Message
                       └─→ broadcast to all connected clients

Заказчик → PUT /tasks/{id}/complete
             │
             ├─→ validate: task.status == "in_progress"
             ├─→ validate: task.customer_id == current_user.id
             ├─→ BEGIN TRANSACTION (SELECT FOR UPDATE)
             │    ├─→ calculate fee = budget * 0.05 (или 0 если PRO)
             │    ├─→ payout = budget - fee
             │    ├─→ UPDATE users SET balance = balance + payout WHERE id = specialist_id
             │    ├─→ UPDATE tasks SET status = "completed"
             │    ├─→ INSERT transaction (type="task_completed", amount=payout, fee=fee)
             │    ├─→ INSERT transaction (type="platform_fee", amount=fee) [система]
             │    └─→ COMMIT
             ├─→ create Notification для специалиста
             └─→ return success
```

### 4. Арбитраж (споры)

```
Любая сторона → POST /tasks/{id}/dispute {reason, description}
                  │
                  ├─→ validate: participant in [customer, specialist]
                  ├─→ validate: task.status == "in_progress"
                  ├─→ UPDATE tasks SET status = "disputed"
                  ├─→ INSERT dispute (status="open")
                  ├─→ notify admins
                  └─→ return dispute_id

Арбитр → POST /admin/disputes/{id}/resolve {decision: "refund_customer" | "pay_specialist"}
          │
          ├─→ validate: current_user.email in ADMIN_EMAILS
          ├─→ BEGIN TRANSACTION
          │    ├─→ if "refund_customer":
          │    │    ├─→ UPDATE users SET balance = balance + budget WHERE id = customer_id
          │    │    ├─→ INSERT transaction (type="escrow_refund")
          │    │    └─→ UPDATE tasks SET status = "cancelled"
          │    │
          │    └─→ if "pay_specialist":
          │         ├─→ calculate fee, payout (как при complete)
          │         ├─→ UPDATE users SET balance = balance + payout WHERE id = specialist_id
          │         ├─→ INSERT transaction (type="task_completed", fee=fee)
          │         └─→ UPDATE tasks SET status = "completed"
          │
          ├─→ UPDATE disputes SET status = "resolved"
          ├─→ notify both parties
          └─→ COMMIT
```

---

## Компоненты безопасности

```
┌────────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                            │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TRANSPORT                                                   │
│     └─→ HTTPS/WSS (SSL/TLS) в production                       │
│                                                                  │
│  2. AUTHENTICATION                                              │
│     ├─→ JWT Access Token (15 min)                              │
│     ├─→ JWT Refresh Token (7 days) + blacklist в БД            │
│     └─→ bcrypt password hashing (cost=12)                      │
│                                                                  │
│  3. AUTHORIZATION                                               │
│     ├─→ Role-based: customer, specialist, admin                │
│     ├─→ Ownership checks: task.customer_id == current_user.id  │
│     └─→ Admin emails whitelist (ADMIN_EMAILS)                  │
│                                                                  │
│  4. CSRF PROTECTION                                             │
│     ├─→ Double Submit Cookie pattern                           │
│     ├─→ Signed httpOnly cookies                                │
│     └─→ X-CSRF-Token header validation                         │
│                                                                  │
│  5. RATE LIMITING                                               │
│     ├─→ HTTP: 10 req/min per IP (Redis/in-memory)             │
│     └─→ WebSocket: 10 msg/min per user                        │
│                                                                  │
│  6. INPUT VALIDATION                                            │
│     ├─→ Pydantic schemas на все endpoints                      │
│     ├─→ File upload: magic bytes + size limit (10MB)           │
│     └─→ SQL injection protection: SQLAlchemy ORM               │
│                                                                  │
│  7. HEADERS                                                     │
│     ├─→ Content-Security-Policy (strict в prod)                │
│     ├─→ X-Frame-Options: DENY                                  │
│     ├─→ X-Content-Type-Options: nosniff                        │
│     └─→ Referrer-Policy: strict-origin-when-cross-origin       │
│                                                                  │
│  8. TRANSACTION SAFETY                                          │
│     ├─→ SELECT FOR UPDATE (pessimistic locking)                │
│     ├─→ Database transactions (ACID)                           │
│     └─→ Idempotency checks (предотвращение двойной выплаты)    │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

---

## Масштабирование

### Текущая архитектура (монолит)
```
Load Balancer
     │
     ├─→ FastAPI Instance 1 ──┐
     ├─→ FastAPI Instance 2 ──┼─→ PostgreSQL (primary)
     └─→ FastAPI Instance 3 ──┘        │
                                        └─→ PostgreSQL (replica) [read-only]
          
     Redis (shared) ← все инстансы
```

### Возможное разделение (микросервисы)
```
API Gateway (Kong/Nginx)
     │
     ├─→ Auth Service (JWT, login, register)
     ├─→ Tasks Service (CRUD, assign, complete)
     ├─→ Chat Service (WebSocket, messages)
     ├─→ Payment Service (эскроу, transactions)
     ├─→ Notifications Service (email, push, Telegram)
     └─→ Admin Service (disputes, verification)
     
Message Queue (RabbitMQ/Kafka)
     ├─→ task.created → notify subscribers
     ├─→ task.completed → send review request
     └─→ dispute.created → notify admins
```

---

## Зависимости и технологии

| Слой | Технология | Версия | Назначение |
|------|-----------|--------|-----------|
| **Frontend** | React | 18.x | UI framework |
| | Vite | 5.x | Build tool |
| | React Router | 6.x | SPA routing |
| **Backend** | FastAPI | 0.115.x | REST API framework |
| | SQLAlchemy | 2.x | ORM |
| | Pydantic | 2.x | Validation |
| | python-jose | 3.x | JWT |
| | bcrypt | 4.x | Password hashing |
| | Alembic | 1.x | Migrations |
| | Sentry SDK | 2.x | Error monitoring |
| **Database** | PostgreSQL | 15+ | Production DB |
| | SQLite | 3.x | Development DB |
| **Cache** | Redis | 7+ | Rate limit, cache |
| **Bot** | python-telegram-bot | 21.x | Telegram integration |
| **Deploy** | Docker | 20.x | Containerization |
| | Nginx | 1.25+ | Reverse proxy |

---

**Дата**: 2026-09-12  
**Версия**: 2.2.0  
**Статус**: Production-ready
