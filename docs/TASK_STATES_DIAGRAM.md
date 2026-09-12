# 🔄 Диаграмма состояний заказа

## Общая схема жизненного цикла заказа

```
                    ┌────────────────────────────────────────────┐
                    │         СОЗДАНИЕ ЗАКАЗА                    │
                    │   POST /tasks/ (только customer)           │
                    └──────────────────┬─────────────────────────┘
                                       │
                                       ▼
                           ┌───────────────────────┐
                           │                       │
                           │        OPEN           │ ◄─────────┐
                           │   (опубликован)       │           │
                           │                       │           │
                           └───────────┬───────────┘           │
                                       │                       │
                   ┌───────────────────┼───────────────────┐   │
                   │                   │                   │   │
            откликов нет        есть отклики         отмена│   │
                   │                   │             заказчиком│
                   │                   │                   │   │
                   ▼                   ▼                   │   │
         ┌─────────────────┐  ┌────────────────┐          │   │
         │   CANCELLED     │  │  Назначение    │          │   │
         │  (без откликов) │  │  исполнителя   │          │   │
         └─────────────────┘  │  PUT /assign   │          │   │
                               └───────┬────────┘          │   │
                                       │                   │   │
                                       │ Эскроу-холд      │   │
                                       │ budget            │   │
                                       ▼                   │   │
                           ┌───────────────────────┐       │   │
                           │   IN_PROGRESS         │       │   │
                           │   (в работе)          │       │   │
                           │                       │       │   │
                           │ • Чат активен         │       │   │
                           │ • Средства заморожены │       │   │
                           └───────┬───────────────┘       │   │
                                   │                       │   │
                   ┌───────────────┼───────────────┐       │   │
                   │               │               │       │   │
              завершение       отмена          спор        │   │
              заказчиком     заказчиком     любой стороной │   │
                   │               │               │       │   │
                   ▼               ▼               ▼       │   │
        ┌──────────────────┐ ┌──────────┐  ┌─────────────┐│   │
        │   COMPLETED      │ │CANCELLED │  │  DISPUTED   ││   │
        │ (выполнен)       │ │(отменён) │  │  (спор)     ││   │
        │                  │ │          │  │             ││   │
        │ • Выплата        │ │ • Возврат│  │ • Арбитраж  ││   │
        │   специалисту    │ │   эскроу │  │ • Заморожен ││   │
        │ • Комиссия 5%/0% │ │   назад  │  │   эскроу    ││   │
        │ • Взаимные       │ └──────────┘  └──────┬──────┘│   │
        │   отзывы         │                      │       │   │
        └──────────────────┘                      │       │   │
                                                  │       │   │
                                           решение│       │   │
                                           арбитра│       │   │
                                                  │       │   │
                                    ┌─────────────┴───────┴───┘
                                    │
                      ┌─────────────┴─────────────┐
                      │                           │
               refund_customer             pay_specialist
                      │                           │
                      ▼                           ▼
              ┌──────────────┐          ┌──────────────────┐
              │  CANCELLED   │          │    COMPLETED     │
              │ (через спор) │          │  (через спор)    │
              │              │          │                  │
              │ • Возврат    │          │  • Выплата       │
              │   заказчику  │          │    специалисту   │
              └──────────────┘          │  • Комиссия 5%/0%│
                                        └──────────────────┘
```

---

## Детальное описание состояний

### 1. 🟢 OPEN (опубликован)

**Описание**: Заказ создан заказчиком и ожидает откликов от специалистов.

**Переходы**:
- ✅ → `IN_PROGRESS`: при назначении исполнителя (`PUT /tasks/{id}/assign`)
- ✅ → `CANCELLED`: при отмене заказчиком без откликов (`POST /tasks/{id}/cancel`)

**Ограничения**:
- Только заказчик может редактировать задание
- Любой специалист может откликнуться (при наличии кредитов/PRO)

**Финансы**:
- Бюджет указан, но не заморожен
- Средства остаются на балансе заказчика

**Уведомления**:
- Telegram подписчикам при создании
- Заказчику при новом отклике

---

### 2. 🔵 IN_PROGRESS (в работе)

**Описание**: Исполнитель назначен, бюджет заморожен в эскроу, работа началась.

**Переходы**:
- ✅ → `COMPLETED`: заказчик подтверждает выполнение (`PUT /tasks/{id}/complete`)
- ✅ → `CANCELLED`: заказчик отменяет с возвратом эскроу (`POST /tasks/{id}/cancel`)
- ✅ → `DISPUTED`: любая сторона открывает спор (`POST /tasks/{id}/dispute`)

**Ограничения**:
- Только участники (заказчик + исполнитель) видят чат
- Нельзя изменить бюджет или исполнителя
- Нельзя удалить задание

**Финансы**:
- Бюджет заморожен (эскроу-холд)
- `customer.balance -= budget`
- Средства НЕ на балансе заказчика и НЕ у исполнителя

**Действия**:
- Чат активен (REST + WebSocket)
- Быстрые шаблоны ответов
- Можно прикреплять файлы

---

### 3. ✅ COMPLETED (выполнен)

**Описание**: Заказ успешно завершён, исполнитель получил оплату.

**Переходы**:
- ❌ Финальное состояние (нельзя изменить)

**Ограничения**:
- Повторный вызов `/complete` → 400 error
- Нельзя открыть спор после завершения

**Финансы**:
```python
fee = budget * 0.05 if not specialist.is_pro else 0
payout = budget - fee

specialist.balance += payout
# Комиссия платформе (не возвращается в систему, просто учёт)
```

**Пример**:
- Бюджет: 10 000 ₽
- Комиссия (обычный): 500 ₽ (5%)
- Комиссия (PRO): 0 ₽ (0%)
- Выплата специалисту: 9 500 ₽ (или 10 000 ₽ для PRO)

**Транзакции в БД**:
1. `task_completed` (payout для исполнителя, fee указан)
2. `platform_fee` (fee, recipient=null)

**Уведомления**:
- Исполнителю: "Заказ завершён, получено X ₽"
- Заказчику: "Заказ завершён, оставьте отзыв"

**Дополнительно**:
- Обе стороны могут оставить взаимные отзывы
- Чат остаётся доступен (read-only)

---

### 4. ❌ CANCELLED (отменён)

**Описание**: Заказ отменён заказчиком, эскроу возвращён (если был).

**Переходы**:
- ❌ Финальное состояние

**Сценарии отмены**:

#### 4.1. Отмена из `OPEN` (без откликов)
```python
# Просто меняем статус, средства не трогаем
task.status = "cancelled"
```

#### 4.2. Отмена из `IN_PROGRESS` (возврат эскроу)
```python
# Возвращаем заморожённые средства
customer.balance += task.budget
transaction(type="escrow_refund", amount=budget)
task.status = "cancelled"
```

#### 4.3. Отмена через спор (решение арбитра)
```python
# Арбитр выносит решение refund_customer
customer.balance += task.budget
transaction(type="escrow_refund", amount=budget)
dispute.status = "resolved"
task.status = "cancelled"
```

**Ограничения**:
- При открытом споре отменить может только **инициатор спора** (автоматически отзывает спор)
- Нельзя отменить заказ в статусе `COMPLETED` или `DISPUTED` (кроме инициатора)

**Финансы**:
- Полный возврат бюджета заказчику (без комиссии)

---

### 5. ⚠️ DISPUTED (спор)

**Описание**: Открыт спор, средства заморожены до решения арбитра.

**Переходы**:
- ✅ → `COMPLETED`: арбитр решает `pay_specialist`
- ✅ → `CANCELLED`: арбитр решает `refund_customer`
- ✅ → `CANCELLED`: инициатор спора отзывает его (`POST /tasks/{id}/cancel`)

**Кто может открыть**:
- Заказчик (если исполнитель не работает или работа плохая)
- Исполнитель (если заказчик не отвечает или требования меняются)

**Ограничения**:
- Только 1 спор на заказ
- Нельзя завершить заказ через `/complete` (сначала решить спор)
- Чат остаётся активен

**Процесс**:
1. Любая сторона: `POST /tasks/{id}/dispute {reason, description}`
2. Уведомление админам (email из `ADMIN_EMAILS`)
3. Админы видят спор в `/admin/disputes`
4. Админ принимает решение: `POST /admin/disputes/{id}/resolve {decision}`
5. Исполнение решения + уведомления

**Решения арбитра**:

#### 5.1. `refund_customer` (возврат заказчику)
```python
customer.balance += task.budget
transaction(type="escrow_refund", amount=budget)
task.status = "cancelled"
dispute.status = "resolved"
```

#### 5.2. `pay_specialist` (выплата исполнителю)
```python
fee = budget * 0.05 if not specialist.is_pro else 0
payout = budget - fee
specialist.balance += payout
transaction(type="task_completed", amount=payout, fee=fee)
task.status = "completed"
dispute.status = "resolved"
```

**Финансы**:
- Эскроу остаётся заморожен до решения
- Средства НЕ возвращаются автоматически

---

## Права доступа по состояниям

| Действие | OPEN | IN_PROGRESS | COMPLETED | CANCELLED | DISPUTED |
|----------|------|-------------|-----------|-----------|----------|
| **Просмотр** | Все | Участники | Участники | Участники | Участники + Админы |
| **Редактировать** | Заказчик | ❌ | ❌ | ❌ | ❌ |
| **Откликнуться** | Специалисты | ❌ | ❌ | ❌ | ❌ |
| **Назначить** | Заказчик | ❌ | ❌ | ❌ | ❌ |
| **Чат** | ❌ | Участники | Участники (read) | Участники (read) | Участники |
| **Завершить** | ❌ | Заказчик | ❌ | ❌ | ❌ |
| **Отменить** | Заказчик | Заказчик | ❌ | ❌ | Инициатор спора |
| **Открыть спор** | ❌ | Участники | ❌ | ❌ | ❌ (1 спор) |
| **Решить спор** | ❌ | ❌ | ❌ | ❌ | Админы |
| **Отзыв** | ❌ | ❌ | Участники | ❌ | ❌ |

---

## Транзакции по состояниям

### Назначение исполнителя (OPEN → IN_PROGRESS)
```sql
BEGIN TRANSACTION;
  UPDATE users SET balance = balance - 10000 WHERE id = customer_id;
  UPDATE tasks SET status = 'in_progress', assigned_to = specialist_id WHERE id = task_id;
  INSERT INTO transactions (type, user_id, task_id, amount) 
    VALUES ('escrow_hold', customer_id, task_id, -10000);
COMMIT;
```

### Завершение (IN_PROGRESS → COMPLETED)
```sql
BEGIN TRANSACTION;
  -- SELECT * FROM tasks WHERE id = task_id FOR UPDATE; (lock)
  UPDATE users SET balance = balance + 9500 WHERE id = specialist_id; -- fee: 500
  UPDATE tasks SET status = 'completed' WHERE id = task_id;
  INSERT INTO transactions (type, user_id, task_id, amount, fee) 
    VALUES ('task_completed', specialist_id, task_id, 9500, 500);
  INSERT INTO transactions (type, user_id, task_id, amount) 
    VALUES ('platform_fee', NULL, task_id, 500);
COMMIT;
```

### Отмена (IN_PROGRESS → CANCELLED)
```sql
BEGIN TRANSACTION;
  UPDATE users SET balance = balance + 10000 WHERE id = customer_id;
  UPDATE tasks SET status = 'cancelled' WHERE id = task_id;
  INSERT INTO transactions (type, user_id, task_id, amount) 
    VALUES ('escrow_refund', customer_id, task_id, 10000);
COMMIT;
```

### Открытие спора (IN_PROGRESS → DISPUTED)
```sql
BEGIN TRANSACTION;
  UPDATE tasks SET status = 'disputed' WHERE id = task_id;
  INSERT INTO disputes (task_id, initiator_id, reason, description, status) 
    VALUES (task_id, user_id, 'quality', 'Работа не соответствует ТЗ', 'open');
COMMIT;
```

### Решение спора (DISPUTED → COMPLETED/CANCELLED)
```sql
-- Если refund_customer:
BEGIN TRANSACTION;
  UPDATE users SET balance = balance + 10000 WHERE id = customer_id;
  UPDATE tasks SET status = 'cancelled' WHERE id = task_id;
  UPDATE disputes SET status = 'resolved', resolution = 'refund_customer' WHERE task_id = task_id;
  INSERT INTO transactions (type, user_id, task_id, amount) 
    VALUES ('escrow_refund', customer_id, task_id, 10000);
COMMIT;

-- Если pay_specialist:
BEGIN TRANSACTION;
  UPDATE users SET balance = balance + 9500 WHERE id = specialist_id;
  UPDATE tasks SET status = 'completed' WHERE id = task_id;
  UPDATE disputes SET status = 'resolved', resolution = 'pay_specialist' WHERE task_id = task_id;
  INSERT INTO transactions (type, user_id, task_id, amount, fee) 
    VALUES ('task_completed', specialist_id, task_id, 9500, 500);
  INSERT INTO transactions (type, user_id, task_id, amount) 
    VALUES ('platform_fee', NULL, task_id, 500);
COMMIT;
```

---

## Типичные сценарии

### ✅ Успешная сделка (happy path)
```
1. Заказчик создаёт задание → OPEN
2. Специалист откликается (списание 1 кредита)
3. Заказчик назначает исполнителя → IN_PROGRESS (эскроу-холд)
4. Общение в чате
5. Заказчик подтверждает выполнение → COMPLETED (выплата - 5%)
6. Обе стороны оставляют отзывы
```

### ⚠️ Сделка со спором
```
1. OPEN → IN_PROGRESS (назначение)
2. Исполнитель не выходит на связь
3. Заказчик открывает спор → DISPUTED
4. Арбитр связывается с обеими сторонами
5. Решение: refund_customer → CANCELLED (возврат)
```

### 🔄 Отмена без начала работы
```
1. Заказчик создаёт задание → OPEN
2. Нет подходящих откликов
3. Заказчик отменяет → CANCELLED (без финансовых операций)
```

### 🔄 Отмена после начала работы
```
1. OPEN → IN_PROGRESS (назначение, эскроу-холд)
2. Заказчик передумал (изменились обстоятельства)
3. Обе стороны договорились об отмене в чате
4. Заказчик отменяет → CANCELLED (возврат эскроу)
```

---

## Защита от состояния гонки (race conditions)

### Проблема: двойная выплата
```python
# БЕЗ блокировки (плохо):
task = db.query(Task).filter(Task.id == task_id).first()
if task.status == "in_progress":  # Два запроса могут пройти эту проверку!
    # выплата...
    task.status = "completed"
```

### Решение: pessimistic locking
```python
# С блокировкой (правильно):
task = db.query(Task).filter(Task.id == task_id).with_for_update().first()
if task.status == "in_progress":
    # выплата... (только один запрос пройдёт)
    task.status = "completed"
db.commit()
```

### Дополнительная защита: idempotency check
```python
if task.status != "in_progress":
    raise HTTPException(status_code=400, detail="Заказ уже завершён или отменён")
```

---

## Мониторинг состояний

### Аналитика по состояниям
```sql
-- Распределение заказов по статусам
SELECT status, COUNT(*) as count 
FROM tasks 
GROUP BY status;

-- Средняя длительность в каждом состоянии
SELECT 
  status,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 3600 as avg_hours
FROM tasks
GROUP BY status;

-- Конверсия: OPEN → IN_PROGRESS → COMPLETED
SELECT 
  (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') * 100.0 / 
  (SELECT COUNT(*) FROM tasks WHERE status = 'open') as conversion_assign,
  
  (SELECT COUNT(*) FROM tasks WHERE status = 'completed') * 100.0 / 
  (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') as conversion_complete;
```

---

**Дата**: 2026-09-12  
**Версия**: 2.2.0  
**Статус**: Production-ready
