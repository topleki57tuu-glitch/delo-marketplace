# ЮMoney Integration Guide

## Интеграция платежной системы ЮMoney (бывший Яндекс.Деньги)

ЮMoney — российская платежная система для приема платежей от физических лиц.

---

## 🎯 Зачем нужен ЮMoney?

### Преимущества:
- ✅ Российская платежная система (работает всегда)
- ✅ Низкие комиссии (от 2%)
- ✅ Прием платежей с карт без эквайринга
- ✅ Простая интеграция через API
- ✅ Вебхуки для автоматического зачисления
- ✅ Без НДС для ИП/самозанятых

### Сравнение с ЮKassa:
| Критерий | ЮMoney | ЮKassa |
|----------|---------|---------|
| Комиссия | 2-3% | 2.8-3.5% |
| Для юрлиц | ❌ | ✅ |
| Для ИП/физлиц | ✅ | ❌ |
| Эквайринг | Не нужен | Нужен |
| Международные карты | ❌ | ✅ |

**Выбор**: ЮMoney подходит для ИП и самозанятых, ЮKassa — для ООО.

---

## 📦 Регистрация и настройка

### 1. Создание кошелька ЮMoney

1. Зарегистрируйтесь на [yoomoney.ru](https://yoomoney.ru/)
2. Пройдите идентификацию (загрузите паспорт)
3. Подтвердите email и телефон
4. Получите свой номер кошелька (410011234567890)

### 2. Создание приложения

1. Перейдите в [Мои приложения](https://yoomoney.ru/myservices/online/create)
2. Нажмите **"Зарегистрировать приложение"**
3. Заполните форму:
   - **Название**: ДЕЛО Marketplace
   - **Описание**: Маркетплейс для поиска специалистов
   - **Redirect URI**: `https://yourdomain.com/api/payments/oauth/yoomoney`
   - **Права доступа** (scope):
     - `account-info` — информация о счете
     - `operation-history` — история операций
     - `payment-p2p` — переводы между счетами (опционально)

4. Получите **Client ID**

### 3. Получение Access Token

**Вариант A: Через OAuth (рекомендуется)**

```bash
# 1. Откройте в браузере (замените YOUR_CLIENT_ID):
https://yoomoney.ru/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=https://yourdomain.com/api/payments/oauth/yoomoney&scope=account-info%20operation-history

# 2. Разрешите доступ → получите code в redirect URL

# 3. Обменяйте code на token:
curl -X POST https://yoomoney.ru/oauth/token \
  -d "code=YOUR_CODE" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=https://yourdomain.com/api/payments/oauth/yoomoney"

# Ответ:
{
  "access_token": "410011234567890.ABCDEF1234567890ABCDEF1234567890",
  "token_type": "bearer"
}
```

**Вариант B: Через настройки (быстрый способ для тестирования)**

1. Перейдите в [Настройки приложения](https://yoomoney.ru/myservices/online)
2. Найдите свое приложение
3. Нажмите **"Получить токен для отладки"**
4. Скопируйте access_token

### 4. Настройка environment variables

```bash
# .env
YOOMONEY_CLIENT_ID=your_client_id_here
YOOMONEY_ACCESS_TOKEN=410011234567890.ABCDEF1234567890ABCDEF1234567890
YOOMONEY_REDIRECT_URI=https://yourdomain.com/api/payments/oauth/yoomoney
YOOMONEY_NOTIFICATION_SECRET=your_secret_for_webhooks
```

**ВАЖНО**: Access token привязан к вашему кошельку и дает доступ к операциям. Храните его в секрете!

---

## 🚀 Использование API

### Проверка подключения

```bash
curl -X GET http://localhost:8000/payments/status
```

Ответ:
```json
{
  "yookassa": {"configured": false},
  "yoomoney": {"configured": true}
}
```

### Создание платежа

**Frontend:**
```javascript
// Пользователь вводит сумму пополнения
const amount = 1000; // 1000 рублей

const response = await fetch('/api/payments/create?provider=yoomoney', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify({ amount })
});

const data = await response.json();
// {
//   "provider": "yoomoney",
//   "payment_id": "delo_123_a4f3d8e1",
//   "confirmation_url": "https://yoomoney.ru/quickpay/confirm?..."
// }

// Редирект пользователя на страницу оплаты
window.location.href = data.confirmation_url;
```

### Проверка и зачисление платежа

После оплаты пользователь возвращается на ваш сайт.

**Вариант 1: Ручная проверка (polling)**

```javascript
// После возврата с формы оплаты
const response = await fetch(`/api/payments/confirm?payment_id=${paymentId}&provider=yoomoney`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': csrfToken
  }
});

const result = await response.json();
// {
//   "status": "success",
//   "credited": true,
//   "new_balance": 11000
// }
```

**Вариант 2: Вебхук (автоматически)**

Настроен endpoint `/api/payments/webhook/yoomoney` — ЮMoney автоматически отправит уведомление о платеже.

---

## 🔔 Настройка вебхуков

Вебхуки позволяют автоматически зачислять платежи без проверки со стороны клиента.

### 1. Генерация secret для проверки подписи

```bash
# Сгенерируйте случайную строку
openssl rand -hex 32
# Сохраните в .env:
YOOMONEY_NOTIFICATION_SECRET=your_generated_secret_here
```

### 2. Настройка в ЮMoney

1. Перейдите в [Настройки приложения](https://yoomoney.ru/myservices/online)
2. Найдите раздел **"HTTP-уведомления"**
3. Укажите URL: `https://yourdomain.com/api/payments/webhook/yoomoney`
4. Включите уведомления
5. Укажите ваш **notification_secret**

### 3. Тестирование вебхука

ЮMoney отправляет POST запрос с параметрами:
- `notification_type=p2p-incoming`
- `operation_id=123456789`
- `amount=1000.00`
- `currency=643`
- `datetime=2024-01-15T12:30:00Z`
- `sender=410011987654321`
- `codepro=false`
- `label=delo_123_a4f3d8e1`
- `sha1_hash=...` (подпись)

Backend проверяет подпись и автоматически зачисляет средства.

---

## 💻 Пример использования

### Полный flow пополнения баланса

**1. Frontend: Форма пополнения**

```jsx
function DepositForm() {
  const [amount, setAmount] = useState(1000);
  const [loading, setLoading] = useState(false);

  const handleDeposit = async () => {
    setLoading(true);
    
    try {
      const response = await fetch('/api/payments/create?provider=yoomoney', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ amount })
      });
      
      const data = await response.json();
      
      // Сохраняем payment_id для последующей проверки
      localStorage.setItem('pending_payment_id', data.payment_id);
      
      // Редирект на форму оплаты ЮMoney
      window.location.href = data.confirmation_url;
      
    } catch (error) {
      alert('Ошибка создания платежа');
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Пополнение баланса</h2>
      <input 
        type="number" 
        value={amount} 
        onChange={e => setAmount(Number(e.target.value))}
        min="100"
        step="100"
      />
      <button onClick={handleDeposit} disabled={loading}>
        {loading ? 'Создание платежа...' : `Пополнить на ${amount} ₽`}
      </button>
      <p className="text-sm text-gray-600">
        Оплата через ЮMoney (комиссия 0%)
      </p>
    </div>
  );
}
```

**2. Frontend: Страница возврата после оплаты**

```jsx
function PaymentReturnPage() {
  const [status, setStatus] = useState('checking');
  
  useEffect(() => {
    const paymentId = localStorage.getItem('pending_payment_id');
    
    if (!paymentId) {
      setStatus('error');
      return;
    }
    
    // Проверяем статус платежа
    const checkPayment = async () => {
      const response = await fetch(
        `/api/payments/confirm?payment_id=${paymentId}&provider=yoomoney`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-CSRF-Token': csrfToken
          }
        }
      );
      
      const result = await response.json();
      
      if (result.credited) {
        setStatus('success');
        localStorage.removeItem('pending_payment_id');
        // Обновляем баланс в UI
        updateBalance(result.new_balance);
      } else if (result.status === 'pending') {
        setStatus('pending');
      } else {
        setStatus('error');
      }
    };
    
    checkPayment();
  }, []);
  
  return (
    <div>
      {status === 'checking' && <p>Проверка платежа...</p>}
      {status === 'success' && (
        <div className="success">
          <h2>✅ Платеж успешно завершен!</h2>
          <p>Средства зачислены на ваш баланс</p>
          <button onClick={() => navigate('/profile')}>
            Перейти в профиль
          </button>
        </div>
      )}
      {status === 'pending' && (
        <div className="warning">
          <h2>⏳ Платеж в обработке</h2>
          <p>Средства будут зачислены в течение нескольких минут</p>
        </div>
      )}
      {status === 'error' && (
        <div className="error">
          <h2>❌ Ошибка платежа</h2>
          <p>Платеж не был завершен. Попробуйте снова.</p>
        </div>
      )}
    </div>
  );
}
```

---

## 🔧 Troubleshooting

### Ошибка: "ЮMoney not configured"

**Проблема**: `YOOMONEY_ACCESS_TOKEN` не установлен

**Решение**:
```bash
# Проверьте .env файл
cat .env | grep YOOMONEY

# Должно быть:
YOOMONEY_ACCESS_TOKEN=410011234567890.ABC...

# Перезапустите backend
```

### Ошибка: "Invalid signature" в вебхуке

**Проблема**: Неверный `YOOMONEY_NOTIFICATION_SECRET`

**Решение**:
1. Проверьте что secret в `.env` совпадает с настройками в ЮMoney
2. Убедитесь что secret передается в правильном формате (без пробелов)
3. Проверьте логи backend: `tail -f logs/app.log`

### Платеж не находится (check_payment возвращает not_found)

**Причины**:
1. Пользователь не завершил оплату
2. Платеж еще обрабатывается (подождите 1-2 минуты)
3. Неверный `label` (должен быть уникальным)

**Решение**:
- Проверьте историю операций в личном кабинете ЮMoney
- Используйте вебхуки для надежного зачисления

### Тестирование без реального платежа

**ЮMoney не предоставляет sandbox**. Для тестирования:
1. Используйте демо-пополнение (`/wallet/deposit`) в dev окружении
2. Создайте тестовый кошелек с минимальной суммой
3. Делайте реальные переводы на копейки (10-50 руб)

---

## 📊 Мониторинг платежей

### Получение информации о счете

```python
from app.integrations.yoomoney import yoomoney_client

info = yoomoney_client.get_account_info()
print(f"Баланс: {info['balance']} RUB")
print(f"Статус: {info['account_status']}")
```

### Логи платежей

Все операции логируются в `logs/app.log`:
```
[INFO] ЮMoney payment delo_123_a4f3d8e1 credited: 1000.00 RUB to user 123
[WARNING] Invalid ЮMoney webhook signature
[ERROR] ЮMoney account-info failed: HTTP 401
```

### Dashboard для мониторинга

Используйте личный кабинет ЮMoney:
- История операций
- Статистика платежей
- Выгрузка в Excel

---

## 🎯 Production Checklist

**Infrastructure:**
- [ ] YOOMONEY_ACCESS_TOKEN настроен в production .env
- [ ] YOOMONEY_NOTIFICATION_SECRET сгенерирован и настроен
- [ ] Вебхук URL добавлен в настройки ЮMoney приложения
- [ ] HTTPS настроен (обязательно для вебхуков)

**Security:**
- [ ] Access token хранится в секретах (не в коде)
- [ ] Проверка подписи вебхуков включена
- [ ] Rate limiting на endpoints платежей

**Monitoring:**
- [ ] Логирование всех платежных операций
- [ ] Alerting на failed webhooks
- [ ] Daily reconciliation (сверка с ЮMoney)

**Testing:**
- [ ] Проверен полный flow пополнения
- [ ] Протестированы вебхуки
- [ ] Проверена идемпотентность (повторные зачисления)

---

## 🚀 Результат

После настройки ЮMoney:
- ✅ Прием платежей от физлиц с карт Visa/Mastercard/МИР
- ✅ Автоматическое зачисление через вебхуки
- ✅ Комиссия 2-3% (дешевле чем эквайринг)
- ✅ Работает для ИП и самозанятых
- ✅ Российская платежная система (надежность)

**API Endpoints:**
- `GET /payments/status` — проверка подключения
- `POST /payments/create?provider=yoomoney` — создать платеж
- `POST /payments/confirm?provider=yoomoney` — проверить и зачислить
- `POST /payments/webhook/yoomoney` — вебхук от ЮMoney
