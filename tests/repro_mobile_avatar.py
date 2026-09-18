"""Репро: загрузка аватара с мобильного.

Мобильный Safari/Chrome часто отдаёт файл из камеры или галереи с именем
без расширения ("image", "blob", "photo") либо вообще без имени.
Проверяем, что говорит /upload/image в каждом случае.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1 и боевой
# DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
isolate_env("repro_mobile_avatar")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "backend"))
os.chdir(os.path.join(_ROOT, "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

# Минимальный валидный JPEG (SOI + APP0 + EOI) — сигнатура 0xFFD8FF проходит sniff
JPEG_BYTES = bytes([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
])

CASES = [
    ("photo.jpg",        "image/jpeg", "обычный случай, десктоп"),
    ("image",            "image/jpeg", "камера iOS: имя без расширения"),
    ("blob",             "image/jpeg", "некоторые Android WebView"),
    ("photo",            "image/jpeg", "галерея Android, имя без расширения"),
    ("IMG_1234.HEIC",    "image/heic", "iPhone, формат HEIC"),
    ("photo.JPG",        "image/jpeg", "верхний регистр расширения"),
    ("photo.jpeg",       "image/jpeg", "нормальный jpeg"),
    ("photo.png",        "image/png",  "png"),
    # Случай с пустым именем не проверяем: httpx при filename="" отправляет
    # поле как строку, а не файл, и 422 приходит от FastAPI до нашего кода.
    # Реальный браузер всегда шлёт multipart-часть с именем файла.
]


def main():
    client = TestClient(app)

    # Регистрируемся и логинимся, чтобы получить токен.
    # Логин — OAuth2PasswordRequestForm (form-data, поле username), не JSON.
    email = "mobile-repro@delo.ru"
    reg = client.post("/register/", json={
        "email": email, "password": "TestPass123!", "name": "Mobile Test",
    })
    if reg.status_code not in (200, 201, 400):
        print(f"register -> {reg.status_code} {reg.text[:200]}")
    login = client.post("/login", data={"username": email, "password": "TestPass123!"})
    if login.status_code != 200:
        print(f"НЕ УДАЛОСЬ ЗАЛОГИНИТЬСЯ: {login.status_code} {login.text[:300]}")
        return 1
    token = login.json().get("access_token")
    hdr = {"Authorization": f"Bearer {token}"}

    print(f"{'имя файла':<18} {'HTTP':<6} {'результат'}")
    print("-" * 78)
    failures = []
    for filename, ctype, note in CASES:
        files = {"file": (filename, JPEG_BYTES, ctype)}
        r = client.post("/upload/image", files=files, headers=hdr)
        if r.status_code == 200:
            res = f"OK  url={r.json().get('url')}"
        else:
            detail = ""
            try:
                detail = r.json().get("detail", "")
            except Exception:
                detail = r.text[:60]
            res = f"ОТКАЗ: {detail}"
            failures.append((filename or "<пусто>", note, r.status_code, detail))
        print(f"{filename or '<пусто>':<18} {r.status_code:<6} {res}   [{note}]")

    print()
    if failures:
        print(f"ПРОВАЛОВ: {len(failures)}")
        for fn, note, code, detail in failures:
            print(f"  - '{fn}' -> {code}: {detail}   ({note})")
    else:
        print("Все случаи прошли.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
