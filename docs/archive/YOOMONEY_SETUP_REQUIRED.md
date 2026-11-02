# ⚠️ ВАЖНО: Настройка ЮMoney

Файл `.env` создан с базовой конфигурацией.

## 🔧 Чтобы ЮMoney заработал, нужно заменить плейсхолдеры:

### 1. Откройте `backend/.env` и замените:

```bash
YOOMONEY_CLIENT_ID=YOUR_CLIENT_ID_HERE          # → ваш идентификатор приложения
YOOMONEY_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE  # → ваш OAuth2 client_secret
YOOMONEY_ACCESS_TOKEN=YOUR_ACCESS_TOKEN_HERE    # → ваш токен
```

### 2. Настройте вебхук в ЮMoney:

**URL для вебхука**:
- Development: `http://localhost:8000/api/payments/webhook/yoomoney`
- Production: `https://yourdomain.com/api/payments/webhook/yoomoney`

**Секретный ключ (уже сгенерирован)**:
```
5129fd1ba5fb3bf42c68625023a791e3b5930ddc76dbc4e1703d6a3bd9938bec
```

**Где настроить**:
1. Откройте https://yoomoney.ru/myservices/online
2. Найдите ваше приложение
3. Раздел "HTTP-уведомления"
4. Вставьте URL и секретный ключ
5. Включите уведомления

### 3. Перезапустите backend:

```bash
pm2 restart backend
```

### 4. Проверьте подключение:

```bash
curl http://localhost:8000/payments/status
```

Должно вернуть:
```json
{
  "yookassa": {"configured": false},
  "yoomoney": {"configured": true}  ← должно быть true
}
```

---

## 📝 Где взять данные от ЮMoney:

У вас уже есть:
- ✅ Идентификатор приложения (client_id)
- ✅ OAuth2 client_secret
- ✅ ТОКЕН

Просто скопируйте их в `.env` файл вместо `YOUR_..._HERE`.

---

## 🚀 После настройки:

Frontend сможет создавать платежи через ЮMoney:

```javascript
const response = await fetch('/api/payments/create?provider=yoomoney', {
  method: 'POST',
  body: JSON.stringify({ amount: 1000 }),
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const { confirmation_url } = await response.json();
window.location.href = confirmation_url; // Редирект на оплату
```

Платежи будут зачисляться автоматически через вебхуки.
