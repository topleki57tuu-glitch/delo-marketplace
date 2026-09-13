# 🧪 Тестирование Admin Dashboard

## Дата: 2026-09-13

### 1. Backend API тесты

#### ✅ Health Check
```bash
curl http://localhost:8000/health
```
**Результат**: ✅ OK

#### ✅ Admin Login
```bash
curl -X POST http://localhost:8000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@delo.ru&password=demo123"
```
**Результат**: ✅ Токен получен

#### ✅ Admin Stats
```bash
TOKEN="<admin_token>"
curl http://localhost:8000/admin/stats \
  -H "Authorization: Bearer $TOKEN"
```
**Результат**: ✅ Статистика загружена (users, tasks, money, queues, charts)

#### ✅ Recent Activity
```bash
curl http://localhost:8000/admin/recent-activity \
  -H "Authorization: Bearer $TOKEN"
```
**Результат**: ✅ Активность загружена (users, tasks, transactions)

#### ✅ Users List
```bash
curl "http://localhost:8000/admin/users?page=1&per_page=5" \
  -H "Authorization: Bearer $TOKEN"
```
**Результат**: ✅ Список пользователей с пагинацией

### 2. Frontend тесты

#### ✅ Страница доступна
URL: http://localhost:3000/admin/dashboard
**Результат**: ✅ Страница открывается

#### ✅ Защита от неавторизованных
- Попытка доступа без токена → редирект на вход
- Попытка доступа с токеном не-админа → "Доступ запрещён"

#### ✅ UI компоненты
- Карточки метрик отображаются
- Графики отрисовываются (SVG)
- Очереди показывают правильные числа
- Вкладки переключаются
- Таблица пользователей загружается
- Пагинация работает

### 3. Функциональные тесты

#### ✅ Загрузка данных
- Первичная загрузка при открытии страницы
- Кнопка "Обновить" перезагружает данные
- Loading состояния работают корректно

#### ✅ Фильтрация пользователей
- Фильтр по роли (customer/specialist)
- Фильтр по верификации
- Поиск по email/имени
- Пагинация (вперед/назад)

#### ✅ Темная тема
- Auto-switch по системным настройкам
- Все компоненты поддерживают dark mode

#### ✅ Responsive
- Desktop (>1024px) - все колонки видны
- Tablet (768-1024px) - сетка адаптируется
- Mobile (<768px) - одна колонка

### Итог

**Все тесты пройдены успешно! ✅**

Дашборд готов к использованию.
