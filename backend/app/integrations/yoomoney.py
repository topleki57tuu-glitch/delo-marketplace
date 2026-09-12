"""
ЮMoney (бывший Яндекс.Деньги) payment integration.

API Documentation: https://yoomoney.ru/docs/wallet

Setup:
1. Зарегистрируйтесь на https://yoomoney.ru/
2. Создайте приложение в https://yoomoney.ru/myservices/online/create
3. Получите client_id и redirect_uri
4. Настройте environment variables:
   - YOOMONEY_CLIENT_ID
   - YOOMONEY_REDIRECT_URI
   - YOOMONEY_ACCESS_TOKEN (получить через OAuth)

Для получения ACCESS_TOKEN:
1. Авторизуйте приложение: https://yoomoney.ru/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=YOUR_REDIRECT_URI&scope=account-info operation-history payment-p2p
2. Обменяйте code на token через POST https://yoomoney.ru/oauth/token
"""

import os
import hmac
import hashlib
import requests
from typing import Dict, Optional
from app.core.logging import logger


class YooMoneyClient:
    """ЮMoney API client для приема платежей."""

    BASE_URL = "https://yoomoney.ru/api"

    def __init__(self):
        self.access_token = os.getenv("YOOMONEY_ACCESS_TOKEN")
        self.client_id = os.getenv("YOOMONEY_CLIENT_ID")
        self.redirect_uri = os.getenv("YOOMONEY_REDIRECT_URI")
        self.notification_secret = os.getenv("YOOMONEY_NOTIFICATION_SECRET")  # Для проверки вебхуков

        self.enabled = bool(self.access_token)

        if not self.enabled:
            logger.warning("ЮMoney not configured: YOOMONEY_ACCESS_TOKEN not set")

    def is_configured(self) -> bool:
        """Проверка что ЮMoney настроен."""
        return self.enabled

    def get_account_info(self) -> Dict:
        """
        Получить информацию о счете.

        Returns:
            {
                "account": "410011234567890",
                "balance": 250.00,
                "currency": "643",
                "account_status": "identified",
                "account_type": "personal"
            }
        """
        if not self.enabled:
            return {"error": "ЮMoney not configured"}

        try:
            response = requests.post(
                f"{self.BASE_URL}/account-info",
                headers={
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                timeout=10
            )

            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"ЮMoney account-info failed: {response.status_code} {response.text}")
                return {"error": f"HTTP {response.status_code}"}

        except Exception as e:
            logger.error(f"ЮMoney account-info exception: {e}")
            return {"error": str(e)}

    def request_payment(
        self,
        amount: float,
        label: str,
        comment: Optional[str] = None
    ) -> Dict:
        """
        Создать запрос платежа (для P2P переводов).

        Args:
            amount: Сумма в рублях
            label: Уникальный идентификатор платежа (используется для проверки)
            comment: Комментарий к платежу

        Returns:
            {
                "request_id": "payment_label_123",
                "status": "success",
                "payment_url": "https://yoomoney.ru/quickpay/confirm?requestId=..."
            }

        Примечание: Это упрощенный метод для генерации ссылки на форму оплаты.
        Для полноценной интеграции используйте Quickpay форму.
        """
        if not self.enabled:
            return {"error": "ЮMoney not configured"}

        # ЮMoney Quickpay form URL (редирект на форму оплаты)
        # Документация: https://yoomoney.ru/docs/payment-buttons/using-api/forms
        receiver = self.get_account_info().get("account")

        if not receiver:
            return {"error": "Failed to get receiver account"}

        quickpay_form_url = "https://yoomoney.ru/quickpay/confirm.xml"

        params = {
            "receiver": receiver,
            "quickpay-form": "shop",
            "targets": comment or f"Пополнение баланса на {amount} руб.",
            "paymentType": "AC",  # AC = банковская карта, PC = ЮMoney кошелек
            "sum": amount,
            "label": label,  # Уникальный ID для идентификации платежа
        }

        # Формируем URL с параметрами
        from urllib.parse import urlencode
        payment_url = f"{quickpay_form_url}?{urlencode(params)}"

        return {
            "request_id": label,
            "status": "success",
            "payment_url": payment_url,
            "amount": amount
        }

    def check_payment(self, label: str) -> Dict:
        """
        Проверить статус платежа по label.

        Args:
            label: Уникальный идентификатор платежа

        Returns:
            {
                "status": "success" | "pending" | "not_found",
                "paid": True | False,
                "amount": 1000.00,
                "datetime": "2024-01-15T12:30:00Z"
            }
        """
        if not self.enabled:
            return {"error": "ЮMoney not configured"}

        try:
            # Получаем историю операций и ищем платеж с этим label
            response = requests.post(
                f"{self.BASE_URL}/operation-history",
                headers={
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                data={
                    "type": "deposition",  # Только входящие платежи
                    "label": label,
                    "records": 10  # Проверяем последние 10 операций
                },
                timeout=10
            )

            if response.status_code != 200:
                logger.error(f"ЮMoney operation-history failed: {response.status_code}")
                return {"error": f"HTTP {response.status_code}"}

            data = response.json()
            operations = data.get("operations", [])

            # Ищем операцию с нашим label
            for op in operations:
                if op.get("label") == label and op.get("status") == "success":
                    return {
                        "status": "success",
                        "paid": True,
                        "amount": float(op.get("amount", 0)),
                        "datetime": op.get("datetime"),
                        "operation_id": op.get("operation_id"),
                        "sender": op.get("sender")
                    }

            # Платеж не найден или не завершен
            return {
                "status": "not_found",
                "paid": False
            }

        except Exception as e:
            logger.error(f"ЮMoney check_payment exception: {e}")
            return {"error": str(e)}

    def verify_notification(self, notification_data: Dict) -> bool:
        """
        Проверить подпись уведомления от ЮMoney (вебхук).

        Args:
            notification_data: Данные из POST запроса вебхука

        Returns:
            True если подпись валидна

        Примечание: Для использования вебхуков нужно настроить
        notification_secret и указать URL для уведомлений в настройках приложения.
        """
        if not self.notification_secret:
            logger.warning("YOOMONEY_NOTIFICATION_SECRET not set, cannot verify webhook")
            return False

        # ЮMoney отправляет параметры: notification_type, operation_id, amount,
        # currency, datetime, sender, codepro, label, sha1_hash

        sha1_hash = notification_data.get("sha1_hash")
        if not sha1_hash:
            return False

        # Формируем строку для проверки подписи
        check_string = (
            f"{notification_data.get('notification_type', '')}&"
            f"{notification_data.get('operation_id', '')}&"
            f"{notification_data.get('amount', '')}&"
            f"{notification_data.get('currency', '')}&"
            f"{notification_data.get('datetime', '')}&"
            f"{notification_data.get('sender', '')}&"
            f"{notification_data.get('codepro', '')}&"
            f"{self.notification_secret}&"
            f"{notification_data.get('label', '')}"
        )

        # Вычисляем SHA-1 хеш
        computed_hash = hashlib.sha1(check_string.encode()).hexdigest()

        # Сравниваем хеши
        return hmac.compare_digest(computed_hash, sha1_hash)


# Singleton instance
yoomoney_client = YooMoneyClient()


def is_configured() -> bool:
    """Проверка что ЮMoney настроен."""
    return yoomoney_client.is_configured()


def create_payment(amount: float, description: str, metadata: Dict) -> Dict:
    """
    Создать платеж через ЮMoney.

    Args:
        amount: Сумма в рублях
        description: Описание платежа
        metadata: Дополнительные данные (user_id, etc)

    Returns:
        {
            "payment_id": "label_123",
            "confirmation_url": "https://yoomoney.ru/quickpay/...",
            "amount": 1000.00
        }
    """
    # Генерируем уникальный label (используется как payment_id)
    import uuid
    label = f"delo_{metadata.get('user_id')}_{uuid.uuid4().hex[:8]}"

    result = yoomoney_client.request_payment(
        amount=amount,
        label=label,
        comment=description
    )

    if "error" in result:
        return result

    return {
        "payment_id": result["request_id"],
        "confirmation_url": result["payment_url"],
        "amount": amount
    }


def get_payment_status(payment_id: str) -> Dict:
    """
    Получить статус платежа.

    Args:
        payment_id: ID платежа (label)

    Returns:
        {
            "status": "success" | "pending" | "not_found",
            "paid": True | False,
            "amount": 1000.00,
            "metadata": {...}
        }
    """
    result = yoomoney_client.check_payment(label=payment_id)

    if "error" in result:
        return result

    # Извлекаем metadata из label (delo_USER_ID_RANDOM)
    metadata = {}
    if payment_id.startswith("delo_"):
        parts = payment_id.split("_")
        if len(parts) >= 2:
            metadata["user_id"] = parts[1]

    return {
        "status": result.get("status"),
        "paid": result.get("paid", False),
        "amount": result.get("amount", 0),
        "metadata": metadata
    }


def verify_webhook(notification_data: Dict) -> bool:
    """Проверить подпись вебхука от ЮMoney."""
    return yoomoney_client.verify_notification(notification_data)
