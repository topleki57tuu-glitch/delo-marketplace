# Настройка домена delomaster.online

## Шаг 1: Обновляем .env файлы

### Backend (.env):
```bash
# Frontend URL
FRONTEND_URL=https://delomaster.online
CORS_ORIGINS=https://delomaster.online

# YooMoney настройки
YOOMONEY_REDIRECT_URI=https://delomaster.online/api/payments/oauth/yoomoney
```

### Frontend (.env или vite config):
```bash
VITE_API_URL=https://delomaster.online/api
```

---

## Шаг 2: Nginx конфигурация

Создайте файл `/etc/nginx/sites-available/delomaster.online`:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name delomaster.online www.delomaster.online;
    
    # Certbot will add this location for SSL verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name delomaster.online www.delomaster.online;

    # SSL certificates (will be added by certbot)
    # ssl_certificate /etc/letsencrypt/live/delomaster.online/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/delomaster.online/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    
    # Brotli compression
    brotli on;
    brotli_static on;
    brotli_types text/css application/javascript application/json image/svg+xml;
    brotli_comp_level 6;
    
    # Gzip compression (fallback)
    gzip on;
    gzip_static on;
    gzip_vary on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_comp_level 6;
    
    # Frontend (React SPA)
    root /var/www/delomaster.online/frontend/dist;
    index index.html;
    
    # Static assets with long cache
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        
        # Try .br first, then .gz, then original
        location ~ \.(js|css)$ {
            try_files $uri.br $uri.gz $uri =404;
        }
    }
    
    # API proxy to backend
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    # WebSocket for chat
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
    
    # SPA fallback - all other routes go to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Шаг 3: Установка SSL сертификата (Let's Encrypt)

```bash
# Установите certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Получите SSL сертификат
sudo certbot --nginx -d delomaster.online -d www.delomaster.online

# Следуйте инструкциям certbot:
# - Введите email для уведомлений
# - Согласитесь с условиями
# - Выберите redirect HTTP -> HTTPS (рекомендуется)

# Certbot автоматически:
# 1. Создаст SSL сертификат
# 2. Обновит nginx конфигурацию
# 3. Настроит автообновление сертификата
```

---

## Шаг 4: Деплой приложения на сервер

```bash
# 1. Подключитесь к серверу по SSH
ssh root@92.53.96.169

# 2. Создайте директорию для приложения
mkdir -p /var/www/delomaster.online
cd /var/www/delomaster.online

# 3. Клонируйте репозиторий или загрузите файлы
# Вариант A: через git
git clone https://ваш-репозиторий.git .

# Вариант B: загрузка с локального ПК через scp
# (выполнить на локальном ПК)
cd C:\Users\armen\delo-marketplace
scp -r frontend/dist root@92.53.96.169:/var/www/delomaster.online/frontend/
scp -r backend root@92.53.96.169:/var/www/delomaster.online/

# 4. Установите зависимости Python
cd /var/www/delomaster.online/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 5. Создайте .env файл
nano .env
# (скопируйте настройки из локального .env и обновите домен)

# 6. Запустите backend как systemd service
sudo nano /etc/systemd/system/delomaster-api.service
```

Содержимое `delomaster-api.service`:
```ini
[Unit]
Description=DELO Marketplace API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/delomaster.online/backend
Environment="PATH=/var/www/delomaster.online/backend/venv/bin"
ExecStart=/var/www/delomaster.online/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
# Запустите сервис
sudo systemctl daemon-reload
sudo systemctl enable delomaster-api
sudo systemctl start delomaster-api
sudo systemctl status delomaster-api

# 7. Активируйте nginx конфигурацию
sudo ln -s /etc/nginx/sites-available/delomaster.online /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Шаг 5: Обновите настройки ЮMoney

1. Зайдите на https://yoomoney.ru/myservices/online
2. Найдите ваше приложение
3. В настройках обновите:
   - **Redirect URI**: `https://delomaster.online/api/payments/oauth/yoomoney`
   - **Webhook URL**: `https://delomaster.online/api/payments/webhook/yoomoney`

---

## Шаг 6: Тестирование

После настройки:

1. Откройте https://delomaster.online
2. Проверьте что сайт работает по HTTPS (замочек в браузере)
3. Войдите в профиль
4. Попробуйте пополнить баланс через ЮMoney
5. Форма должна открыться без ошибок
6. После оплаты деньги автоматически зачислятся (через вебхук)

---

## Команды для проверки на сервере:

```bash
# Проверить статус backend
sudo systemctl status delomaster-api
curl http://localhost:8000/payments/status

# Проверить логи backend
sudo journalctl -u delomaster-api -f

# Проверить логи nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Проверить SSL сертификат
sudo certbot certificates

# Перезапустить сервисы
sudo systemctl restart delomaster-api
sudo systemctl reload nginx
```

---

## Файлы для обновления локально:

Перед деплоем обновите на вашем ПК:

### backend/.env:
```bash
FRONTEND_URL=https://delomaster.online
CORS_ORIGINS=https://delomaster.online
YOOMONEY_REDIRECT_URI=https://delomaster.online/api/payments/oauth/yoomoney
```

### frontend - пересоберите:
```bash
cd frontend
npm run build
```

Затем загрузите `dist` на сервер.

---

**Нужна помощь с каким-то конкретным шагом?**
