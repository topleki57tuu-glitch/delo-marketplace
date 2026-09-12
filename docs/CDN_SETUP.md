# CDN Configuration Guide

## Оптимизация доставки статических файлов

Для production рекомендуется использовать CDN (Content Delivery Network) для доставки статических файлов frontend'а и загруженных пользователями файлов.

---

## 🎯 Преимущества CDN

- **Скорость**: Файлы отдаются с ближайшего к пользователю сервера (edge location)
- **Снижение нагрузки**: Backend освобождается от раздачи статики
- **Кеширование**: Статика кешируется на edge серверах
- **DDoS защита**: CDN помогает защититься от атак
- **HTTPS**: Автоматические SSL сертификаты

**Ожидаемое улучшение**: 2-5x быстрее загрузка статики, -70% нагрузка на сервер

---

## 📦 Рекомендуемые решения

### 1. Cloudflare (Рекомендовано для старта)

**Плюсы**: Бесплатный тариф, простая настройка, защита от DDoS
**Минусы**: Меньше контроля над кешированием

#### Настройка Cloudflare

1. Зарегистрируйтесь на [cloudflare.com](https://cloudflare.com)
2. Добавьте ваш домен
3. Измените NS записи у регистратора на Cloudflare NS
4. В Cloudflare Dashboard:
   - **SSL/TLS**: Выберите "Full (strict)"
   - **Speed > Optimization**: 
     - Auto Minify: включите CSS, JavaScript, HTML
     - Brotli: включите
   - **Caching > Configuration**:
     - Browser Cache TTL: 4 hours
     - Caching Level: Standard
   - **Page Rules** (создайте правила):

```
delo.ru/assets/*
- Cache Level: Cache Everything
- Edge Cache TTL: 1 month
- Browser Cache TTL: 1 month

delo.ru/uploads/*
- Cache Level: Cache Everything
- Edge Cache TTL: 1 week
- Browser Cache TTL: 1 week

delo.ru/api/*
- Cache Level: Bypass
```

5. В `.env` frontend укажите:
```bash
VITE_API_BASE_URL=https://delo.ru/api
VITE_CDN_URL=https://delo.ru
```

6. При сборке frontend:
```bash
npm run build
# Загрузите dist/ на ваш сервер или S3
```

---

### 2. AWS CloudFront + S3

**Плюсы**: Полный контроль, интеграция с AWS, высокая производительность
**Минусы**: Платный, сложнее настройка

#### Настройка CloudFront + S3

1. **Создайте S3 Bucket для статики**:
```bash
aws s3 mb s3://delo-marketplace-static --region eu-west-1
```

2. **Загрузите статику**:
```bash
cd frontend
npm run build
aws s3 sync dist/ s3://delo-marketplace-static/frontend/ \
  --acl public-read \
  --cache-control "max-age=31536000, public"
```

3. **Создайте CloudFront Distribution**:
   - Origin Domain: `delo-marketplace-static.s3.eu-west-1.amazonaws.com`
   - Origin Path: `/frontend`
   - Viewer Protocol Policy: Redirect HTTP to HTTPS
   - Allowed HTTP Methods: GET, HEAD, OPTIONS
   - Cache Policy: `CachingOptimized`
   - Compress Objects: Yes

4. **Создайте отдельный Origin для uploads**:
   - Origin Domain: `your-backend-domain.com`
   - Origin Path: `/uploads`
   - Cache Policy: Custom (TTL 1 week)

5. **CloudFront Cache Behaviors**:
```
/assets/* -> S3 origin, cache 1 year
/uploads/* -> Backend origin, cache 1 week
/api/* -> Backend origin, no cache
/* -> S3 origin (frontend), cache 1 day
```

6. **Invalidate cache при деплое**:
```bash
aws cloudfront create-invalidation \
  --distribution-id EXAMPLEID \
  --paths "/*"
```

7. **В `.env` укажите**:
```bash
VITE_CDN_URL=https://d1234567890.cloudfront.net
VITE_API_BASE_URL=https://api.delo.ru
```

---

### 3. Nginx + кеширование (Бесплатная альтернатива)

Если CDN пока не нужен, настройте агрессивное кеширование в Nginx.

#### /etc/nginx/sites-available/delo

```nginx
# Frontend статика
location /assets/ {
    alias /var/www/delo-marketplace/frontend/dist/assets/;
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
}

# Загруженные файлы
location /uploads/ {
    alias /var/www/delo-marketplace/backend/uploads/;
    expires 7d;
    add_header Cache-Control "public";
    access_log off;
}

# API - без кеша
location /api/ {
    proxy_pass http://localhost:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Отключаем кеш для API
    add_header Cache-Control "no-store, no-cache, must-revalidate";
    expires off;
}

# Frontend HTML
location / {
    root /var/www/delo-marketplace/frontend/dist;
    try_files $uri $uri/ /index.html;
    expires 1h;
    add_header Cache-Control "public, must-revalidate";
}

# Gzip сжатие
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript 
           application/json application/javascript application/xml+rss;
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔄 Инвалидация кеша

### При обновлении frontend

**Cloudflare**:
```bash
# Через API
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

**CloudFront**:
```bash
aws cloudfront create-invalidation \
  --distribution-id ${DISTRIBUTION_ID} \
  --paths "/*"
```

**Nginx**: Не требуется, файлы с новыми хешами в именах

### При загрузке файлов пользователями

Файлы загружаются с уникальными именами, поэтому инвалидация не нужна.

---

## 📊 Мониторинг производительности

### Cloudflare Analytics
- Dashboard > Analytics > Performance
- Проверяйте Cache Hit Rate (должен быть >80% для статики)

### CloudFront Metrics (CloudWatch)
```bash
# Средний Cache Hit Rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=${DIST_ID} \
  --start-time 2026-09-11T00:00:00Z \
  --end-time 2026-09-12T00:00:00Z \
  --period 3600 \
  --statistics Average
```

### Проверка headers
```bash
# Проверка кеша
curl -I https://delo.ru/assets/index.js
# Должны быть headers:
# Cache-Control: public, max-age=31536000, immutable
# CF-Cache-Status: HIT (для Cloudflare)
# X-Cache: Hit from cloudfront (для CloudFront)
```

---

## 💰 Стоимость (примерно)

| Решение | Бесплатный тариф | Paid |
|---------|-----------------|------|
| Cloudflare | Неограниченно | $20+/мес (Pro) |
| CloudFront | 50GB/мес | $0.085/GB после |
| Nginx | Полностью бесплатно | - |

**Рекомендация**: Начните с Cloudflare Free, перейдите на CloudFront при >100GB/мес трафика.

---

## ✅ Checklist перед запуском

- [ ] Настроен CDN (Cloudflare или CloudFront)
- [ ] Статика frontend раздаётся через CDN
- [ ] Cache-Control headers настроены правильно
- [ ] API проксируется без кеша
- [ ] HTTPS работает
- [ ] Gzip/Brotli включен
- [ ] Cache Hit Rate > 80% для статики
- [ ] Протестирована скорость загрузки (PageSpeed Insights)

---

## 🚀 Результат

После настройки CDN:
- ✅ Frontend загружается за ~200ms вместо ~800ms
- ✅ Статика кешируется на 1 год
- ✅ Backend разгружен от раздачи статики
- ✅ Улучшен Google PageSpeed Score
- ✅ Меньше затрат на сервер
