"""Проверка, что ослабление проверки расширения не открыло загрузку мусора.

После правки validate_image решение принимается только по magic bytes.
Надо убедиться, что всё, что не является настоящим изображением, отбивается —
включая случаи, где атакующий подставляет красивое имя файла.

Отдельно проверяется `/upload/file` — эндпоинт для вложений-документов.
Он появился вместе с переездом вложений чата с base64 на ссылки: раньше
файл уходил в поле сообщения целиком, и серверная проверка содержимого
не участвовала вообще. Теперь документы проходят через ту же строгую
проверку, что и картинки, и отдаются только как `attachment`.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1 и боевой
# DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
isolate_env("repro_reject")

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

# Документы: то же правило — решает содержимое, а не расширение.
PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
DOCX = b"PK\x03\x04\x14\x00\x06\x00" + b"\x00" * 40
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 40

DOC_REJECT = [
    (b"<html><script>alert(1)</script></html>", "invoice.pdf",  "HTML под именем .pdf"),
    (b"<?php system($_GET['c']); ?>",           "dogovor.docx", "PHP под именем .docx"),
    (b"MZ\x90\x00\x03\x00\x00\x00",             "smeta.xlsx",   "Windows PE под именем .xlsx"),
    (b"",                                       "file.pdf",     "пустой файл"),
]

DOC_ACCEPT = [
    (PDF,  "invoice.pdf",  "настоящий PDF"),
    (DOCX, "dogovor.docx", "docx (ZIP-контейнер)"),
    (OLE,  "old.doc",      "старый doc (OLE2)"),
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

    print("--- документы: ДОЛЖНЫ быть отклонены ---")
    bad3 = 0
    for data, name, note in DOC_REJECT:
        r = client.post("/upload/file", files={"file": (name, data, "application/pdf")}, headers=hdr)
        ok = r.status_code == 400
        if not ok:
            bad3 += 1
        print(f"  {'OK  ' if ok else 'ДЫРА'} {r.status_code:<4} {note}")

    print("--- документы: ДОЛЖНЫ пройти ---")
    bad4 = 0
    for data, name, note in DOC_ACCEPT:
        r = client.post("/upload/file", files={"file": (name, data, "application/pdf")}, headers=hdr)
        ok = r.status_code == 200
        if not ok:
            bad4 += 1
        print(f"  {'OK  ' if ok else 'FAIL'} {r.status_code:<4} {note}")

    print("--- документы: приватны по умолчанию ---")
    bad5 = 0
    for data, name, note in DOC_ACCEPT:
        r = client.post("/upload/file", files={"file": (name, data, "application/pdf")}, headers=hdr)
        file_id = r.json()["file_id"]
        # Без подписи файл не отдаётся даже владельцу: подпись выдаётся в ответе
        # на сообщение чата, а не по факту загрузки. Так право на файл остаётся
        # у того, до кого дошёл ответ с сообщением.
        anon = client.get(f"/files/{file_id}")
        ok = anon.status_code == 403
        if not ok:
            bad5 += 1
        print(f"  {'OK  ' if ok else 'ДЫРА'} {anon.status_code:<4} {name} без подписи")

    print()
    total_bad = bad + bad2 + bad3 + bad4 + bad5
    print(f"пропущено мусора: {bad + bad3}, отклонено валидного: {bad2 + bad4}, "
          f"открыто без подписи: {bad5}")
    return 0 if total_bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
