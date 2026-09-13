# ⚠️ Исправление ошибки "На этом сайте переводы недоступны"

## Причина ошибки:

ЮMoney блокирует платежи потому что:
- В .env указан: `YOOMONEY_REDIRECT_URI=http://localhost:8000/api/payments/oauth/yoomoney`
- Но вы открываете с телефона через другой адрес (например, IP адрес сервера)
- ЮMoney проверяет домен и блокирует несовпадающие

## Решение 1: Добавить ваш реальный домен в ЮMoney

### Шаг 1: Узнайте ваш текущий URL

С телефона откройте приложение и посмотрите адресную строку браузера. Например:
- `http://192.168.1.100:3000` (локальная сеть)
- `https://ваш-домен.ru` (production)

### Шаг 2: Зайдите в настройки ЮMoney

1. Откройте https://yoomoney.ru/myservices/online
2. Найдите ваше приложение
3. Нажмите "Редактировать"
4. В поле **"Redirect URI"** добавьте ваш реальный адрес:
   ```
   http://ваш-реальный-домен/api/payments/oauth/yoomoney
   ```
   Например:
   - `http://192.168.1.100:8000/api/payments/oauth/yoomoney` (для локальной сети)
   - `https://delo.example.com/api/payments/oauth/yoomoney` (для production)

5. Сохраните изменения

### Шаг 3: Обновите .env

```bash
cd backend
nano .env
```

Измените:
```bash
YOOMONEY_REDIRECT_URI=http://ваш-реальный-домен/api/payments/oauth/yoomoney
```

### Шаг 4: Перезапустите backend

```bash
# Остановите текущий процесс (Ctrl+C)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## Решение 2: Тестирование с ПК (временное)

Если нужно быстро протестировать:

1. Откройте приложение на **ПК** (не на телефоне)
2. Перейдите на http://localhost:3000
3. Попробуйте пополнить баланс
4. Форма ЮMoney откроется с правильным redirect_uri

---

## Решение 3: Использовать ngrok для тестов с телефона

Если хотите тестировать с телефона без изменения настроек ЮMoney:

### Установите ngrok:
```bash
# Скачайте с https://ngrok.com/download
# Или через chocolatey:
choco install ngrok
```

### Запустите туннель:
```bash
ngrok http 3000
```

Вы получите публичный URL, например:
```
https://abc123.ngrok.io
```

### Обновите настройки:

1. В ЮMoney админке добавьте:
   ```
   https://abc123.ngrok.io/api/payments/oauth/yoomoney
   ```

2. В .env:
   ```bash
   YOOMONEY_REDIRECT_URI=https://abc123.ngrok.io/api/payments/oauth/yoomoney
   ```

3. Откройте с телефона `https://abc123.ngrok.io`

---

## Решение 4: Упрощенная форма (без проверки домена)

Если ничего не помогает, используйте **упрощенную Quickpay форму** без OAuth:

### Измените yoomoney.py:

```python
# В request_payment метод (строка 112-138)
def request_payment(self, amount: float, label: str, comment: Optional[str] = None) -> Dict:
    if not self.enabled:
        return {"error": "ЮMoney not configured"}

    # Получаем номер кошелька из account-info
    account_info = self.get_account_info()
    receiver = account_info.get("account")
    
    if not receiver:
        return {"error": "Failed to get receiver account"}

    # УБИРАЕМ проверку домена - используем публичную форму
    quickpay_form_url = "https://yoomoney.ru/transfer/quickpay"
    
    params = {
        "to": receiver,
        "quickpay-form": "shop",
        "targets": comment or f"Пополнение баланса на {amount} руб.",
        "paymentType": "AC",
        "sum": amount,
        "label": label,
        "successURL": "https://yoomoney.ru"  # Не перенаправляем обратно
    }

    from urllib.parse import urlencode
    payment_url = f"{quickpay_form_url}?{urlencode(params)}"

    return {
        "request_id": label,
        "status": "success",
        "payment_url": payment_url,
        "amount": amount
    }
```

После этого:
- Пользователь оплачивает через форму
- Возвращается в приложение вручную
- Нажимает "Проверить статус платежа"
- Деньги зачисляются

---

## Рекомендуемое решение для production:

1. **Купите домен** (например, на reg.ru или nic.ru)
2. **Настройте DNS** на ваш сервер
3. **Настройте HTTPS** (Let's Encrypt бесплатный)
4. **Добавьте домен** в ЮMoney настройки
5. **Обновите .env**:
   ```bash
   YOOMONEY_REDIRECT_URI=https://ваш-домен.ru/api/payments/oauth/yoomoney
   FRONTEND_URL=https://ваш-домен.ru
   ```

---

## Проверка после исправления:

1. Перезапустите backend
2. Обновите страницу (Ctrl+F5)
3. Попробуйте пополнить баланс
4. Форма ЮMoney должна открыться без ошибки

---

Какое решение вы хотите использовать?
- **Решение 1**: Добавить IP адрес в ЮMoney (для локальной сети)
- **Решение 3**: Использовать ngrok (для быстрого теста с телефона)
- **Решение 4**: Упрощенная форма без redirect (работает сразу)
