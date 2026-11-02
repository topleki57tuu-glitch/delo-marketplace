#!/bin/bash

# Тестовый скрипт для проверки сохранения аватара

echo "=== Тест сохранения аватара ==="
echo ""

# Шаг 1: Попросить пользователя войти и получить токен
echo "Шаг 1: Получите токен авторизации"
echo "-----------------------------------"
echo "1. Откройте http://localhost:3001 в браузере"
echo "2. Войдите в свой аккаунт"
echo "3. Откройте DevTools (F12) → Console"
echo "4. Выполните команду:"
echo "   JSON.parse(localStorage.getItem('auth-storage')).state.token"
echo "5. Скопируйте токен (строка начинается с 'eyJ...')"
echo ""
read -p "Вставьте токен сюда: " TOKEN
echo ""

if [ -z "$TOKEN" ]; then
    echo "❌ Токен не введён. Выход."
    exit 1
fi

# Шаг 2: Проверяем текущий профиль
echo "Шаг 2: Проверка текущего профиля"
echo "-----------------------------------"
PROFILE=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/users/me)
echo "Текущий профиль:"
echo "$PROFILE" | python -m json.tool 2>/dev/null || echo "$PROFILE"
echo ""

# Шаг 3: Тестовое изображение (маленький 1x1 красный пиксель)
TEST_IMAGE="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="

echo "Шаг 3: Загрузка тестового аватара"
echo "-----------------------------------"
RESPONSE=$(curl -s -X PUT http://localhost:8000/users/me \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"avatar\": \"$TEST_IMAGE\"}")

echo "Ответ сервера:"
echo "$RESPONSE" | python -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# Шаг 4: Проверяем обновлённый профиль
echo "Шаг 4: Проверка обновлённого профиля"
echo "-----------------------------------"
sleep 1
UPDATED_PROFILE=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/users/me)
HAS_AVATAR=$(echo "$UPDATED_PROFILE" | grep -o '"avatar"' | wc -l)

if [ $HAS_AVATAR -gt 0 ]; then
    echo "✅ Аватар успешно сохранён!"
    echo ""
    echo "Обновлённый профиль:"
    echo "$UPDATED_PROFILE" | python -m json.tool 2>/dev/null || echo "$UPDATED_PROFILE"
else
    echo "❌ Аватар НЕ сохранён"
    echo ""
    echo "Ответ:"
    echo "$UPDATED_PROFILE"
fi

echo ""
echo "=== Тест завершён ==="
