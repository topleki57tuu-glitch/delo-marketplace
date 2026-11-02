#!/bin/bash
# Скрипт для проверки VPS и установки необходимого ПО

echo "=== Проверка VPS для delomaster.online ==="
echo ""

# Проверка операционной системы
echo "1. Операционная система:"
cat /etc/os-release | grep PRETTY_NAME
echo ""

# Проверка Python
echo "2. Python:"
python3 --version 2>/dev/null || echo "Python не установлен"
echo ""

# Проверка Node.js
echo "3. Node.js:"
node --version 2>/dev/null || echo "Node.js не установлен"
echo ""

# Проверка Nginx
echo "4. Nginx:"
nginx -v 2>&1 || echo "Nginx не установлен"
echo ""

# Проверка PostgreSQL/SQLite
echo "5. База данных:"
psql --version 2>/dev/null || echo "PostgreSQL не установлен"
sqlite3 --version 2>/dev/null || echo "SQLite не установлен"
echo ""

# Проверка certbot
echo "6. Certbot (для SSL):"
certbot --version 2>/dev/null || echo "Certbot не установлен"
echo ""

# Проверка свободного места
echo "7. Свободное место на диске:"
df -h / | tail -1
echo ""

# Проверка памяти
echo "8. Оперативная память:"
free -h | grep Mem
echo ""

# Проверка запущенных сервисов
echo "9. Запущенные веб-сервисы:"
ss -tulpn | grep -E ":(80|443|8000|3000)" || echo "Нет активных веб-сервисов"
echo ""

echo "=== Конец проверки ==="
