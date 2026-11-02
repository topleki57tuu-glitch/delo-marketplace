# 🚀 Инструкция по запуску (Windows)

## Проблема: Docker не установлен

Вы видите ошибку:
```
"docker-compose" не является внутренней или внешней командой
```

У вас есть **2 варианта**:

---

## ✅ Вариант 1: Быстрый старт БЕЗ Docker (РЕКОМЕНДУЕТСЯ для тестирования)

Используйте SQLite вместо PostgreSQL. Все работает, но без Redis (rate limiting будет в памяти).

### Шаг 1: Запустите скрипт
```batch
cd C:\Users\armen\delo-marketplace
start-dev.bat
```

### Что произойдет:
1. ✅ Установка Python зависимостей
2. ✅ Создание SQLite базы данных
3. ✅ Засев демо-данных
4. ✅ Запуск сервера на http://localhost:8000

### Проверка:
Откройте браузер:
- **Приложение**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

**Демо-аккаунты** — пароль общий, не захардкожен. `seed_demo.py` берёт его из
`DEMO_PASSWORD` или генерирует случайный и пишет в `backend\demo_password.txt`:

```cmd
type backend\demo_password.txt
```

- `anna@delo.ru` - заказчик
- `igor@delo.ru` - специалист
- `admin@delo.ru` - арбитр

---

## 🐳 Вариант 2: Полный запуск С Docker (для production-like тестирования)

### Шаг 1: Установите Docker Desktop

**Скачайте**: https://www.docker.com/products/docker-desktop

**Или через winget**:
```powershell
winget install Docker.DockerDesktop
```

### Шаг 2: Запустите Docker Desktop
- Найдите Docker Desktop в меню Пуск
- Дождитесь запуска (иконка кита в трее должна быть зеленой)

### Шаг 3: Проверьте Docker
```batch
docker --version
docker compose version
```

Должно вывести версии (например: Docker version 24.0.x)

### Шаг 4: Запустите приложение
```batch
cd C:\Users\armen\delo-marketplace
start.bat
```

---

## 🔧 Если видите ошибки кодировки в консоли

Это нормально для Windows, скрипты работают. Если хотите исправить:

```batch
chcp 65001
start-dev.bat
```

---

## 📋 Сравнение вариантов

| Функция | start-dev.bat (БЕЗ Docker) | start.bat (С Docker) |
|---------|---------------------------|---------------------|
| База данных | SQLite (файл) | PostgreSQL |
| Кеш | В памяти | Redis |
| Rate Limiting | Локально | Распределенный |
| Скорость запуска | ⚡ Быстро (30 сек) | 🐌 Медленно (2-3 мин) |
| Для тестирования | ✅ Отлично | ✅ Отлично |
| Для production | ⚠️ Не рекомендуется | ✅ Рекомендуется |

---

## 🎯 Рекомендация

**Для быстрого тестирования прямо сейчас**:
```batch
start-dev.bat
```

**Для полноценного production-like окружения**:
- Установите Docker Desktop
- Перезапустите компьютер (после установки Docker)
- Запустите `start.bat`

---

## ❓ Частые проблемы

### "pip не является внутренней командой"
**Решение**: Установите Python
```
https://www.python.org/downloads/
```
При установке отметьте "Add Python to PATH"

### "uvicorn не найден"
**Решение**: 
```batch
pip install uvicorn
```

### "Не удалось засеять демо-данные"
**Решение**: Это нормально, база пустая. Зарегистрируйте пользователя через UI

### Frontend не загружается
**Решение**: Backend раздает статику из `backend/dist/`. Если её нет:
```batch
cd frontend
npm install
npm run build
xcopy /E /I dist ..\backend\dist
```

---

## ✅ Что дальше после запуска?

1. **Откройте**: http://localhost:8000
2. **Войдите**: `anna@delo.ru` + пароль из `backend\demo_password.txt`
3. **Протестируйте**:
   - Создание заказа
   - Отклики специалистов
   - Чат
   - Эскроу сделку
   - Арбитраж

---

**Дата**: 2026-09-12  
**Автор**: Claude Opus 4.8
