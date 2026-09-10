import json
from typing import Dict, List
from fastapi import WebSocket

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

    async def broadcast(self, message: dict, task_id: int):
        if task_id in self.active_connections:
            for connection in self.active_connections[task_id]:
                try:
                    await connection.send_text(json.dumps(message))
                except Exception:
                    pass

manager = ConnectionManager()
