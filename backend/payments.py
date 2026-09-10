"""
Payment integration using YooKassa (ЮKassa)
Supports test mode without real money.

Setup:
1. Register at https://yookassa.ru/
2. Get test Shop ID and Secret Key from the dashboard
3. Set environment variables:
   YOOKASSA_SHOP_ID=your_shop_id
   YOOKASSA_SECRET_KEY=your_secret_key

Test cards (in test mode):
  Success: 5555 5555 5555 4444
  Any future expiry, any CVC
"""

import os
import uuid
import base64
import json as json_lib
import requests
from typing import Optional

YOOKASSA_SHOP_ID = os.environ.get("YOOKASSA_SHOP_ID", "")
YOOKASSA_SECRET_KEY = os.environ.get("YOOKASSA_SECRET_KEY", "")
YOOKASSA_API_URL = "https://api.yookassa.ru/v3"

# Where to redirect after payment
RETURN_URL = os.environ.get("PAYMENT_RETURN_URL", "http://localhost:5173/profile")

# Where YooKassa should send us webhooks about payment status
# In production this must be a public HTTPS URL
WEBHOOK_ENABLED = os.environ.get("YOOKASSA_WEBHOOK_ENABLED", "false").lower() == "true"


def is_configured() -> bool:
    """Check if YooKassa credentials are set"""
    return bool(YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY)


def _auth_header() -> dict:
    """Build Basic Auth header for YooKassa API"""
    credentials = f"{YOOKASSA_SHOP_ID}:{YOOKASSA_SECRET_KEY}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return {"Authorization": f"Basic {encoded}"}


def create_payment(amount: int, description: str, metadata: dict) -> dict:
    """
    Create a payment in YooKassa.

    Args:
        amount: amount in rubles (integer)
        description: payment description shown to user
        metadata: dict with our own data (e.g. user_id) returned in webhook

    Returns:
        dict with 'payment_id' and 'confirmation_url' (where to redirect user)
        or dict with 'error' if failed
    """
    if not is_configured():
        return {"error": "not_configured"}

    idempotence_key = str(uuid.uuid4())
    headers = {
        **_auth_header(),
        "Idempotence-Key": idempotence_key,
        "Content-Type": "application/json",
    }

    payload = {
        "amount": {
            "value": f"{amount:.2f}",
            "currency": "RUB"
        },
        "confirmation": {
            "type": "redirect",
            "return_url": RETURN_URL
        },
        "capture": True,  # auto-capture: charge immediately
        "description": description,
        "metadata": metadata
    }

    try:
        response = requests.post(
            f"{YOOKASSA_API_URL}/payments",
            headers=headers,
            data=json_lib.dumps(payload),
            timeout=10
        )
        response.raise_for_status()
        data = response.json()

        return {
            "payment_id": data["id"],
            "status": data["status"],
            "confirmation_url": data["confirmation"]["confirmation_url"]
        }
    except Exception as e:
        return {"error": str(e)}


def get_payment_status(payment_id: str) -> dict:
    """
    Check the status of a payment.

    Returns:
        dict with 'status' ('pending'|'waiting_for_capture'|'succeeded'|'canceled')
        and 'paid' (bool), 'amount', 'metadata'
    """
    if not is_configured():
        return {"error": "not_configured"}

    try:
        response = requests.get(
            f"{YOOKASSA_API_URL}/payments/{payment_id}",
            headers=_auth_header(),
            timeout=10
        )
        response.raise_for_status()
        data = response.json()

        return {
            "status": data["status"],
            "paid": data.get("paid", False),
            "amount": int(float(data["amount"]["value"])),
            "metadata": data.get("metadata", {})
        }
    except Exception as e:
        return {"error": str(e)}
