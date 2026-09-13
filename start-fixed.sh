#!/bin/bash
# 🚀 Быстрый запуск после исправлений

echo "=================================="
echo "🚀 ДЕЛО Marketplace - Запуск"
echo "=================================="
echo ""

# Проверка миграций
echo "📊 Проверка миграций..."
cd backend
CURRENT_MIGRATION=$(alembic current 2>/dev/null | grep -o "af27b7191ef4")
if [ "$CURRENT_MIGRATION" = "af27b7191ef4" ]; then
    echo "✅ Миграция af27b7191ef4 применена (индексы БД)"
else
    echo "⚠️  Миграция не применена, применяю..."
    alembic upgrade head
fi
cd ..
echo ""

# Запуск backend
echo "🔧 Запуск Backend (FastAPI)..."
cd backend
echo "Backend будет доступен на http://localhost:8000"
echo "API документация: http://localhost:8000/docs"
echo ""
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Ждем запуска backend
sleep 3

# Запуск frontend
echo ""
echo "🎨 Запуск Frontend (Vite)..."
cd frontend
echo "Frontend будет доступен на http://localhost:3000"
echo ""
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "=================================="
echo "✅ Приложение запущено!"
echo "=================================="
echo ""
echo "📍 URLs:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "🛑 Для остановки нажмите Ctrl+C"
echo ""

# Ждем сигнал завершения
trap "echo 'Останавливаю сервисы...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

wait
