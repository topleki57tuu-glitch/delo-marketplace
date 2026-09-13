# 🛡️ Admin Dashboard - Документация

**Дата создания**: 2026-09-13  
**Статус**: ✅ Готов к использованию

---

## 📋 Описание

Полноценный админ дашборд для управления и контроля платформы ДЕЛО Marketplace. Включает:

- 📊 **Статистику в реальном времени** - пользователи, задачи, финансы
- 📈 **Графики и аналитику** - рост пользователей, доход, категории задач
- 🔔 **Очереди требующие внимания** - споры, верификации, выводы
- 👥 **Управление пользователями** - фильтрация, поиск, пагинация
- ⚡ **Последняя активность** - новые пользователи, задачи, транзакции

---

## 🚀 Быстрый старт

### 1. Доступ к дашборду

**URL**: http://localhost:3000/admin/dashboard

**Учетные данные**:
- Email: `admin@delo.ru`
- Пароль: `demo123`

### 2. Вход в систему

1. Откройте главную страницу http://localhost:3000
2. Нажмите "Вход"
3. Введите `admin@delo.ru` / `demo123`
4. После входа в навигации появится кнопка **🛡️ Admin**
5. Нажмите на неё для перехода к дашборду

---

## 🎨 Структура дашборда

### Header (Шапка)
```
🛡️ Admin Dashboard              [🔄 Обновить]
Управление платформой ДЕЛО
```

### 1. Ключевые метрики (Карточки)

Четыре главные метрики платформы:

| Метрика | Описание | Цвет |
|---------|----------|------|
| **Пользователи** | Общее количество + изменение за неделю | Синий |
| **Задачи** | Общее количество + новые за неделю | Фиолетовый |
| **GMV** | Gross Merchandise Value (оборот) | Зеленый |
| **Онлайн** | Сколько пользователей сейчас активны | Изумрудный |

### 2. Графики

**Рост пользователей (7 дней)**
- Линейный график
- Показывает количество новых регистраций по дням
- Данные за последние 7 дней

**Доход - комиссия (7 дней)**
- Линейный график
- Показывает заработанную комиссию по дням
- Данные за последние 7 дней

**Задачи по категориям**
- Столбчатая диаграмма
- Распределение задач по категориям (дизайн, разработка, и т.д.)

### 3. Очереди - требуют внимания

Три карточки с алертами:

| Очередь | Иконка | Цвет | Действие |
|---------|--------|------|----------|
| **Споры** | ⚖️ | Красный | → /admin/disputes |
| **Верификация** | ✅ | Янтарный | → /verification |
| **Выводы средств** | 💸 | Зеленый | → /wallet |

При наличии ожидающих записей показывается красный badge с количеством.

### 4. Вкладки управления

**Обзор (Overview)**
- Детальная финансовая статистика
- Разбивка пользователей по ролям
- Статистика задач по статусам

**Пользователи (Users)**
- Таблица всех пользователей
- Фильтры: роль, верифицирован, PRO, поиск
- Пагинация (20 записей на страницу)
- Показывает: ID, email, имя, роль, баланс, статусы, дата

**Активность (Activity)**
- Новые пользователи (10 последних)
- Новые задачи (10 последних)
- Крупные транзакции ≥5000₽ (10 последних)

---

## 🔌 Backend API

### 1. GET `/admin/stats`

**Описание**: Основная статистика платформы

**Требует**: Admin токен в заголовке `Authorization: Bearer <token>`

**Ответ**:
```json
{
  "generated_at": "2026-09-13T17:42:18.694618",
  "users": {
    "total": 9,
    "customers": 4,
    "specialists": 5,
    "pro": 2,
    "verified": 3,
    "online": 2,
    "new_7d": 9
  },
  "tasks": {
    "total": 13,
    "new_7d": 13,
    "open": 9,
    "in_progress": 1,
    "completed": 2,
    "disputed": 1,
    "cancelled": 0
  },
  "money": {
    "gmv": 33000,
    "commission_earned": 400,
    "escrow_held": 170000,
    "user_balances": 153820,
    "total_liabilities": 333820,
    "withdrawals_pending_amount": 10000,
    "withdrawals_paid_total": 5000
  },
  "queues": {
    "disputes_open": 1,
    "verifications_pending": 0,
    "withdrawals_pending": 1
  },
  "monetization": {
    "responses_total": 5,
    "pro_subscriptions": 2,
    "credits_in_circulation": 55
  },
  "charts": {
    "users_growth_7d": [
      {"date": "2026-09-06", "count": 0},
      {"date": "2026-09-07", "count": 0},
      ...
    ],
    "tasks_by_category": {
      "design": 3,
      "development": 5,
      ...
    },
    "revenue_7d": [
      {"date": "2026-09-06", "revenue": 0},
      {"date": "2026-09-07", "revenue": 100},
      ...
    ]
  }
}
```

### 2. GET `/admin/recent-activity`

**Описание**: Последние события на платформе

**Требует**: Admin токен

**Ответ**:
```json
{
  "users": [
    {
      "id": 9,
      "email": "sergey@delo.ru",
      "name": "Сергей Лебедев",
      "role": "specialist",
      "created_at": "2026-09-13T17:41:47.920706"
    },
    ...
  ],
  "tasks": [
    {
      "id": 13,
      "title": "Дизайн логотипа",
      "budget": 15000,
      "status": "open",
      "category": "design",
      "customer_id": 1,
      "created_at": "2026-09-13T17:41:47.920800"
    },
    ...
  ],
  "transactions": [
    {
      "id": 7,
      "amount": 150000,
      "fee": 0,
      "type": "escrow_hold",
      "user_id": 2,
      "task_id": 4,
      "created_at": "2026-09-13T17:41:47.920845"
    },
    ...
  ]
}
```

### 3. GET `/admin/users`

**Описание**: Список пользователей с фильтрацией

**Параметры**:
- `role` (optional): `customer` | `specialist`
- `verified` (optional): `true` | `false`
- `is_pro` (optional): `true` | `false`
- `search` (optional): поиск по email и имени
- `page` (default: 1): номер страницы
- `per_page` (default: 20, max: 100): записей на страницу

**Пример**:
```bash
GET /admin/users?role=specialist&verified=true&page=1&per_page=20
```

**Ответ**:
```json
{
  "users": [
    {
      "id": 5,
      "email": "igor@delo.ru",
      "name": "Игорь Волков",
      "role": "specialist",
      "balance": 14410,
      "verified": true,
      "is_pro": true,
      "city": "Москва",
      "created_at": "2026-09-13T17:41:47.920702",
      "last_seen": "2026-09-13T17:41:45.748873"
    },
    ...
  ],
  "total": 9,
  "page": 1,
  "per_page": 20,
  "pages": 1
}
```

---

## 🛠️ Frontend компоненты

### Файлы

1. **`frontend/src/pages/AdminDashboardPage.jsx`** (~650 строк)
   - Главный компонент дашборда
   - Включает все UI элементы
   - Управление состоянием и загрузкой данных

2. **`frontend/src/store/adminStore.js`** (~87 строк)
   - Zustand store для админ данных
   - Функции загрузки: `fetchStats`, `fetchActivity`, `fetchUsers`

3. **`frontend/src/App.jsx`** (обновлен)
   - Добавлен роут `/admin/dashboard`
   - Добавлена ссылка "🛡️ Admin" в навигации для админов

### Inline компоненты

**StatCard** - карточка метрики:
```jsx
<StatCard 
  title="Пользователи" 
  value={1234} 
  icon="👥" 
  change={+15} 
  color="blue" 
/>
```

**SimpleLineChart** - SVG линейный график:
```jsx
<SimpleLineChart 
  data={[{date: "2026-09-01", count: 10}, ...]} 
  title="Рост пользователей" 
/>
```

**SimpleBarChart** - SVG столбчатая диаграмма:
```jsx
<SimpleBarChart 
  data={{design: 5, development: 10, ...}} 
  title="Задачи по категориям" 
/>
```

**QueueCard** - карточка очереди:
```jsx
<QueueCard 
  title="Споры" 
  count={5} 
  link="/disputes" 
  icon="⚖️" 
  color="red" 
/>
```

---

## 🔐 Безопасность

### Проверка прав доступа

**Backend** (`backend/app/core/security.py`):
```python
def is_admin(user: User) -> bool:
    """Проверка админских прав через ADMIN_EMAILS"""
    return user.email in settings.ADMIN_EMAILS
```

**Frontend** (`AdminDashboardPage.jsx`):
- При загрузке вызывается `/admin/stats`
- Если ответ `403 Forbidden` → показывается экран "Доступ запрещён"
- Если ответ `200 OK` → загружается дашборд

**Навигация**:
```jsx
{user && user.email && ['admin@delo.ru'].includes(user.email) && (
  <Link to="/admin/dashboard">🛡️ Admin</Link>
)}
```

### Добавление нового админа

1. **Через переменную окружения** (рекомендуется):
   ```bash
   # В .env добавить
   ADMIN_EMAILS=admin@delo.ru,another_admin@delo.ru
   ```

2. **Через код** (для dev):
   Отредактировать `backend/app/core/config.py`:
   ```python
   ADMIN_EMAILS: list = ["admin@delo.ru", "new_admin@delo.ru"]
   ```

---

## 🎨 Стилизация

### Tailwind CSS классы

**Основные цвета**:
- `indigo-600` - основной цвет кнопок и акцентов
- `slate-50/900` - фоны (светлая/темная тема)
- `red-500` - алерты и критичные элементы
- `green-600` - успешные статусы
- `amber-500` - предупреждения

**Темная тема**:
Все компоненты поддерживают темную тему через `dark:` классы:
```jsx
className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
```

**Адаптивность**:
- Mobile-first подход
- Breakpoints: `sm:`, `md:`, `lg:`
- Grid layouts с автоматической адаптацией

---

## 📊 Примеры использования

### Получить статистику

```javascript
const response = await fetch('/admin/stats', {
  headers: { Authorization: `Bearer ${token}` }
});
const stats = await response.json();
console.log(`Всего пользователей: ${stats.users.total}`);
console.log(`Онлайн: ${stats.users.online}`);
```

### Фильтровать пользователей

```javascript
const response = await fetch('/admin/users?role=specialist&verified=true&page=1', {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await response.json();
console.log(`Найдено ${data.total} верифицированных специалистов`);
```

### Обновить все данные

```javascript
import { useAdminStore } from './store/adminStore';

const { fetchStats, fetchActivity } = useAdminStore();

const refreshAll = async () => {
  await Promise.all([
    fetchStats(token),
    fetchActivity(token)
  ]);
};
```

---

## 🧪 Тестирование

### 1. Проверка доступа

**Тест 1**: Вход как обычный пользователь
```
1. Войти как igor@delo.ru
2. Проверить что кнопки "🛡️ Admin" нет в навигации
3. Попробовать открыть /admin/dashboard вручную
4. Ожидается: экран "Доступ запрещён"
```

**Тест 2**: Вход как админ
```
1. Войти как admin@delo.ru
2. Проверить что кнопка "🛡️ Admin" видна
3. Нажать на кнопку
4. Ожидается: дашборд загружается
```

### 2. Функциональность

**Тест 3**: Загрузка данных
```
1. Открыть дашборд
2. Проверить что все карточки показывают данные
3. Проверить что графики отрисованы
4. Проверить что очереди показывают корректные числа
```

**Тест 4**: Вкладки
```
1. Переключиться на вкладку "Пользователи"
2. Проверить что таблица загрузилась
3. Применить фильтр по роли
4. Проверить что результаты отфильтрованы
5. Перейти на страницу 2
6. Проверить пагинацию
```

**Тест 5**: Обновление
```
1. Нажать кнопку "🔄 Обновить"
2. Проверить что данные перезагрузились
3. Проверить что не было ошибок
```

### 3. Производительность

```bash
# Время загрузки /admin/stats
curl -w "@-" -o /dev/null -s http://localhost:8000/admin/stats \
  -H "Authorization: Bearer $TOKEN" <<'EOF'
    time_total:  %{time_total}\n
EOF

# Ожидается: < 500ms
```

---

## 🐛 Troubleshooting

### Проблема: "Доступ запрещён" для админа

**Решение**:
1. Проверить email в профиле: `/users/me`
2. Проверить `ADMIN_EMAILS` в `.env`
3. Перезапустить backend после изменения `.env`

### Проблема: Графики не отображаются

**Решение**:
1. Открыть DevTools Console
2. Проверить ошибки JavaScript
3. Проверить что `/admin/stats` возвращает `charts` секцию
4. Проверить что массивы не пустые

### Проблема: Данные не обновляются

**Решение**:
1. Проверить что backend запущен: `curl http://localhost:8000/health`
2. Проверить токен не истек
3. Открыть Network tab в DevTools
4. Проверить что запросы уходят и возвращаются с 200

### Проблема: Ошибка 500 на `/admin/stats`

**Решение**:
1. Проверить логи backend: `tail -f backend/backend.log`
2. Проверить подключение к БД
3. Проверить что миграции применены: `alembic current`
4. Пересоздать БД если нужно: `python seed_demo.py`

---

## 📝 Расширение функционала

### Добавить новую метрику

1. **Backend** (`backend/app/api/admin.py`):
```python
new_metric = db.query(SomeModel).count()

return {
  # ... existing
  "new_section": {
    "new_metric": new_metric
  }
}
```

2. **Frontend** (`AdminDashboardPage.jsx`):
```jsx
<StatCard
  title="Новая метрика"
  value={stats.new_section.new_metric}
  icon="📌"
  color="purple"
/>
```

### Добавить новую вкладку

1. В массив вкладок:
```jsx
{ id: 'new-tab', label: '📌 Новое', icon: '📌' }
```

2. В рендере:
```jsx
{activeTab === 'new-tab' && <NewTabContent />}
```

### Добавить фильтр в таблицу пользователей

1. **Backend**: добавить параметр в `/admin/users`
2. **Frontend**: добавить select/input для фильтра
3. Обновить `fetchUsers` для передачи нового параметра

---

## ✅ Checklist готовности

- [x] Backend API эндпоинты работают
- [x] Frontend компоненты созданы
- [x] Роутинг настроен
- [x] Навигация для админов добавлена
- [x] Проверка прав доступа работает
- [x] Графики отрисовываются
- [x] Таблицы с пагинацией работают
- [x] Фильтры применяются корректно
- [x] Темная тема поддерживается
- [x] Responsive design работает
- [x] Документация создана

---

## 🚀 Готово к использованию!

Админ дашборд полностью готов и протестирован.

**Откройте**: http://localhost:3000/admin/dashboard  
**Войдите как**: admin@delo.ru / demo123

---

**Создано**: Claude Code  
**Дата**: 2026-09-13  
**Версия**: 1.0.0
