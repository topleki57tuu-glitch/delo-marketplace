import sys
import logging
import json
from datetime import datetime
from typing import Any, Dict
from app.core.config import settings


class JSONFormatter(logging.Formatter):
    """Форматтер для структурированного JSON логирования.

    Каждая запись — одна JSON-строка, удобная для сбора в ELK/Loki/CloudWatch.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_data: Dict[str, Any] = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Добавляем контекст исключения, если есть
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        # Дополнительные поля из extra
        if hasattr(record, "user_id"):
            log_data["user_id"] = record.user_id
        if hasattr(record, "task_id"):
            log_data["task_id"] = record.task_id
        if hasattr(record, "request_id"):
            log_data["request_id"] = record.request_id
        if hasattr(record, "ip"):
            log_data["ip"] = record.ip
        if hasattr(record, "duration_ms"):
            log_data["duration_ms"] = record.duration_ms

        return json.dumps(log_data, ensure_ascii=False)


def setup_logging():
    """Настраивает логирование для приложения.

    В production: JSON логи в stdout для сбора внешней системой.
    В development: читаемые текстовые логи в консоль.
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Убираем стандартные handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Создаём новый handler
    handler = logging.StreamHandler(sys.stdout)

    if settings.IS_PRODUCTION:
        # Production: JSON формат для машинного парсинга
        handler.setFormatter(JSONFormatter())
    else:
        # Development: читаемый формат
        handler.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        ))

    root_logger.addHandler(handler)

    # Снижаем уровень шумных библиотек
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    return root_logger


# Инициализируем при импорте
logger = setup_logging()


def log_request(method: str, path: str, status: int, duration_ms: float, user_id: int = None, ip: str = None):
    """Логирует HTTP запрос со структурированными данными."""
    logger.info(
        f"{method} {path} -> {status} ({duration_ms:.2f}ms)",
        extra={
            "user_id": user_id,
            "ip": ip,
            "duration_ms": duration_ms,
        }
    )


def log_escrow_operation(operation: str, task_id: int, user_id: int, amount: int, **kwargs):
    """Логирует критичные операции с эскроу для аудита."""
    logger.info(
        f"Escrow operation: {operation}",
        extra={
            "operation": operation,
            "task_id": task_id,
            "user_id": user_id,
            "amount": amount,
            **kwargs
        }
    )


def log_security_event(event_type: str, user_id: int = None, ip: str = None, details: str = ""):
    """Логирует события безопасности (неудачные входы, rate limit, CSRF)."""
    logger.warning(
        f"Security event: {event_type} | {details}",
        extra={
            "event_type": event_type,
            "user_id": user_id,
            "ip": ip,
        }
    )
