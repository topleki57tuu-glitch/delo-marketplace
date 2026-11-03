"""Проверка живости бота для Docker (healthcheck в docker-compose.prod.yml).

Оба потока бота регулярно отмечаются в файлах /tmp/delo-bot-*. Если отметка
не обновлялась дольше MAX_AGE секунд — поток завис, контейнер unhealthy, и
это видит scripts/monitor.sh. Приложение не импортируется: проверка мгновенная.
"""
import os
import sys
import time
from pathlib import Path

MAX_AGE = 120


def main() -> int:
    directory = os.environ.get("TELEGRAM_HEARTBEAT_DIR", "/tmp")
    for name in ("updates", "delivery"):
        path = Path(directory, f"delo-bot-{name}")
        try:
            age = time.time() - path.stat().st_mtime
        except FileNotFoundError:
            print(f"нет отметки {path}")
            return 1
        if age > MAX_AGE:
            print(f"{name}: {int(age)} с без отметки")
            return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
