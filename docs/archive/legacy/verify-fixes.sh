#!/bin/bash
# Скрипт проверки всех исправлений

echo "=================================="
echo "🔍 ПРОВЕРКА ИСПРАВЛЕНИЙ"
echo "=================================="
echo ""

# 1. Проверка типов данных last_seen
echo "✅ 1. Проверка типов данных last_seen..."
grep -n "last_seen.*isoformat" backend/main.py && echo "❌ ОШИБКА: Найден isoformat()" || echo "✅ OK: Используется datetime объект"
echo ""

# 2. Проверка datetime.now(timezone.utc)
echo "✅ 2. Проверка datetime.now(timezone.utc)..."
DATETIME_COUNT=$(grep -r "datetime.now(timezone.utc)" backend/app --include="*.py" | wc -l)
echo "✅ Найдено $DATETIME_COUNT использований datetime.now(timezone.utc)"
echo ""

# 3. Проверка миграции индексов
echo "✅ 3. Проверка миграции индексов..."
ls -la backend/migrations/versions/af27b7191ef4_add_performance_indexes.py && echo "✅ OK: Миграция создана" || echo "❌ ОШИБКА: Миграция не найдена"
echo ""

# 4. Проверка vite.config.js
echo "✅ 4. Проверка настроек production build..."
grep -n "drop.*console" frontend/vite.config.js && echo "✅ OK: console.log будет удален в production" || echo "⚠️ Предупреждение: настройка не найдена"
echo ""

# 5. Проверка rate limiting
echo "✅ 5. Проверка rate limiting..."
grep -n "rate_limit.*create_task" backend/app/api/tasks.py && echo "✅ OK: Rate limiting добавлен" || echo "❌ ОШИБКА: Rate limiting не найден"
echo ""

# 6. Проверка Python cache
echo "✅ 6. Проверка Python cache..."
PYCACHE_COUNT=$(find . -type d -name "__pycache__" 2>/dev/null | wc -l)
echo "📁 Найдено $PYCACHE_COUNT директорий __pycache__"
echo ""

# 7. Проверка .env в git
echo "✅ 7. Проверка .env в git..."
git ls-files .env 2>/dev/null | grep -q ".env" && echo "⚠️ Предупреждение: .env tracked в git" || echo "✅ OK: .env не в git"
echo ""

# 8. Проверка базы данных
echo "✅ 8. Проверка расположения базы данных..."
ls backend/*.db 2>/dev/null && echo "✅ OK: База данных в backend/" || echo "⚠️ База данных не найдена"
echo ""

echo "=================================="
echo "📊 СВОДКА"
echo "=================================="
echo "Все основные проверки выполнены!"
echo ""
echo "Следующие шаги:"
echo "1. cd backend && alembic upgrade head"
echo "2. cd frontend && npm run build"
echo "3. Перезапустить приложение"
echo ""
