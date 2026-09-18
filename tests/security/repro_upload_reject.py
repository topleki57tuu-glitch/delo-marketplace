"""Проверка, что ослабление проверки расширения не открыло загрузку мусора.

После правки validate_image решение принимается только по magic bytes.
Надо убедиться, что всё, что не является настоящим изображением, отбивается —
включая случаи, где атакующий подставляет красивое имя файла.
"""
import os
import sys

os.environ.setdefault("ENV", "development")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-repro")
os.environ.setdefault("DATABASE_URL", "sqlite:///C:/tmp/repro_reject.db")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("CSRF_ENABLED", "0")

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "backend"))
os.chdir(os.path.join(_ROOT, "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46,
              0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9])

# Всё это ДОЛЖНО быть отклонено, каким бы ни было имя файла
REJECT = [
    (b"<html><body><script>alert(1)</script></body></html>", "photo.jpg",   "HTML с XSS под именем .jpg"),
    (b"<?php system($_GET['c']); ?>",                        "photo.png",   "PHP-код под именем .png"),
    (b"MZ\x90\x00\x03\x00\x00\x00",                          "avatar.jpg",  "Windows PE под именем .jpg"),
    (b"",                                                    "photo.jpg",   "пустой файл"),
    (b"not an image at all, just text",                      "photo.jpeg",  "произвольный текст"),
    (b"RIFF\x00\x00\x00\x00AVI ",                            "video.jpg",   "AVI под именем .jpg"),
]

# А это должно пройти
ACCEPT = [
    (JPEG, "photo.jpg", "валидный JPEG"),
    (JPEG, "file",      "валидный JPEG без расширения"),
]


def main():
    client = TestClient(app)
    email = "reject-probe@delo.ru"
    client.post("/register/", json={"email": email, "password": "TestPass123!", "name": "Probe"})
    login = client.post("/login", data={"username": email, "password": "TestPass123!"})
    if login.status_code != 200:
        print(f"логин не удался: {login.status_code}")
        return 1
    hdr = {"Authorization": f"Bearer {login.json()['access_token']}"}

    print("--- ДОЛЖНЫ быть отклонены ---")
    bad = 0
    for data, name, note in REJECT:
        r = client.post("/upload/image", files={"file": (name, data, "image/jpeg")}, headers=hdr)
        ok = r.status_code == 400
        if not ok:
            bad += 1
        print(f"  {'OK  ' if ok else 'ДЫРА'} {r.status_code:<4} {note}")

    print("--- ДОЛЖНЫ пройти ---")
    bad2 = 0
    for data, name, note in ACCEPT:
        r = client.post("/upload/image", files={"file": (name, data, "image/jpeg")}, headers=hdr)
        ok = r.status_code == 200
        if not ok:
            bad2 += 1
        print(f"  {'OK  ' if ok else 'FAIL'} {r.status_code:<4} {note}")

    print()
    print(f"пропущено мусора: {bad}, отклонено валидного: {bad2}")
    return 0 if (bad == 0 and bad2 == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
