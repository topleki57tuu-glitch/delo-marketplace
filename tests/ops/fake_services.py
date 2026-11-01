"""Поддельный Telegram Bot API и /health/db для tests/ops/run_ops_tests.sh.

Каждый запрос к боту дописывается строкой JSON в DIR/telegram.jsonl.
Код ответа /health/db берётся из DIR/health_code (по умолчанию 200).
Токен «bad» — как настоящий неверный токен: 401 и ok=false.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

PORT = int(sys.argv[1])
DIR = Path(sys.argv[2])
DIR.mkdir(parents=True, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = {k: v[0] for k, v in parse_qs(self.rfile.read(length).decode()).items()}
        if self.path == "/health/db":
            code_file = DIR / "health_code"
            code = int(code_file.read_text().strip()) if code_file.exists() else 200
            return self._send(code, {"status": "ok" if code == 200 else "error"})
        parts = self.path.strip("/").split("/")
        if len(parts) != 2 or not parts[0].startswith("bot"):
            return self._send(404, {"ok": False})
        token, method = parts[0][3:], parts[1]
        with (DIR / "telegram.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"token": token, "method": method, **form}, ensure_ascii=False) + "\n")
        if token == "bad":
            return self._send(401, {"ok": False, "error_code": 401, "description": "Unauthorized"})
        if method == "getMe":
            return self._send(200, {"ok": True, "result": {"id": 1, "is_bot": True, "username": "delo_alerts_bot"}})
        if method == "getUpdates":
            return self._send(200, {"ok": True, "result": [
                {"update_id": 1, "message": {"message_id": 1, "chat": {"id": 987654321, "type": "private"}, "text": "/start"}},
            ]})
        if method == "sendMessage":
            return self._send(200, {"ok": True, "result": {"message_id": 2}})
        return self._send(404, {"ok": False, "description": "Not Found"})

    do_GET = _handle
    do_POST = _handle


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
