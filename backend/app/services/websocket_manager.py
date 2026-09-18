import json
import logging
from datetime import date, datetime
from typing import Dict, List

from fastapi import WebSocket

logger = logging.getLogger(__name__)


def _json_default(obj):
    """Сериализация типов, которые не умеет стандартный json.dumps.

    В broadcast попадает `created_at` (datetime) из модели Message —
    без этого json.dumps падал с TypeError, а исключение глоталось
    в `except Exception: pass`, из-за чего broadcast молча не доходил
    до клиентов вообще.
    """
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return str(obj)


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, task_id: int):
        await websocket.accept()
        if task_id not in self.active_connections:
            self.active_connections[task_id] = []
        self.active_connections[task_id].append(websocket)

    def disconnect(self, websocket: WebSocket, task_id: int):
        if task_id in self.active_connections:
            try:
                self.active_connections[task_id].remove(websocket)
            except ValueError:
                pass
            if not self.active_connections[task_id]:
                del self.active_connections[task_id]

    async def _send(self, connection: WebSocket, payload: str, task_id: int):
        """Отправка с логированием реальной причины сбоя."""
        try:
            await connection.send_text(payload)
        except Exception as exc:  # noqa: BLE001
            # Раньше ошибка молча проглатывалась — из-за этого «пропавший»
            # broadcast было невозможно диагностировать.
            logger.warning(
                "WS send failed (task_id=%s): %s: %s",
                task_id,
                type(exc).__name__,
                exc,
            )
            self.disconnect(connection, task_id)

    async def broadcast(self, message: dict, task_id: int):
        """Broadcast message to all connections in task room."""
        if task_id in self.active_connections:
            try:
                payload = json.dumps(message, default=_json_default)
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "WS broadcast: cannot serialize message for task_id=%s: %s",
                    task_id,
                    exc,
                )
                return
            for connection in list(self.active_connections.get(task_id, [])):
                await self._send(connection, payload, task_id)

    async def broadcast_typing(self, task_id: int, user_id: int, user_name: str, is_typing: bool):
        """Broadcast typing indicator to all except sender."""
        if task_id in self.active_connections:
            message = {
                "type": "typing",
                "user_id": user_id,
                "user_name": user_name,
                "is_typing": is_typing,
            }
            payload = json.dumps(message, default=_json_default)
            for connection in list(self.active_connections.get(task_id, [])):
                await self._send(connection, payload, task_id)


manager = ConnectionManager()
