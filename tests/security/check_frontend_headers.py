"""
Регресс: заголовки безопасности и сжатие у страниц сайта.

Запуск — против nginx фронтенда с собранной статикой (так делает джоба
frontend в CI, см. .github/workflows/ci.yml):

    python3 tests/security/check_frontend_headers.py http://127.0.0.1:8088

Только стандартная библиотека: в CI скрипт идёт в джобе фронтенда, где
нет окружения бэкенда. Код возврата: 0 — всё на месте, 1 — расхождение.

Почему этот файл существует
---------------------------
Заголовки безопасности ставил только backend — на ответы API. Страницы
сайта отдаёт nginx фронтенда, и у них не было ни CSP, ни X-Frame-Options,
ни HSTS: сайт можно было встроить в чужую страницу, а любой внедрённый
скрипт выполнялся без ограничений. Сжатие было включено, но не работало:
перед nginx стоит Caddy, его заголовок Via для nginx означает
«проксированный запрос», а такие по умолчанию не сжимаются, — главная
страница тянула 433 КБ скриптов вместо ~115 КБ.

Что проверяется
---------------
1. Страницы (/, SPA-адреса, совпадающие с API, /index.html) — CSP без
   'unsafe-inline' в script-src и с хэшами всех встроенных скриптов
   страницы, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy,
   HSTS; версия nginx не видна;
2. скрипты, стили и шрифты — те же заголовки и прежнее кэширование;
3. сжатие работает и для запроса через Caddy (с заголовком Via);
   распакованный ответ совпадает с исходным файлом;
4. отсутствующий файл в /assets — честный 404, а не страница.
"""
import base64
import gzip
import hashlib
import re
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8088").rstrip("/")

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {name}" + (f" | {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


class Resp:
    def __init__(self, status: int, headers, body: bytes):
        self.status = status
        self.headers = headers
        self.body = body

    def h(self, name: str) -> str:
        return self.headers.get(name) or ""


def get(path: str, **headers) -> Resp:
    req = urllib.request.Request(BASE + path, headers={k.replace("_", "-"): v for k, v in headers.items()})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return Resp(r.status, r.headers, r.read())
    except urllib.error.HTTPError as e:
        return Resp(e.code, e.headers, e.read())


def csp_directives(value: str) -> dict:
    out = {}
    for part in value.split(";"):
        tokens = part.split()
        if tokens:
            out[tokens[0].lower()] = tokens[1:]
    return out


def inline_script_hashes(html: str) -> list:
    """sha256 каждого встроенного <script> — ровно так считает браузер."""
    hashes = []
    for m in re.finditer(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", html, re.S | re.I):
        if re.search(r"\bsrc\s*=", m.group("attrs"), re.I):
            continue
        digest = hashlib.sha256(m.group("body").encode("utf-8")).digest()
        hashes.append("'sha256-" + base64.b64encode(digest).decode() + "'")
    return hashes


SECURITY_HEADERS = {
    "X-Frame-Options": lambda v: v.upper() == "DENY",
    "X-Content-Type-Options": lambda v: v.lower() == "nosniff",
    "Referrer-Policy": lambda v: v == "strict-origin-when-cross-origin",
    "Permissions-Policy": lambda v: "camera=()" in v and "microphone=()" in v and "geolocation=(self)" in v,
    "Strict-Transport-Security": lambda v: int((re.search(r"max-age=(\d+)", v) or [0, 0])[1]) >= 31536000,
}


def check_security_headers(label: str, r: Resp) -> None:
    for name, ok in SECURITY_HEADERS.items():
        value = r.h(name)
        check(f"{label}: {name}", bool(value) and ok(value), value or "нет заголовка")
    check(f"{label}: Content-Security-Policy есть", bool(r.h("Content-Security-Policy")))
    server = r.h("Server")
    check(f"{label}: версия nginx не видна", not re.search(r"\d", server), f"Server: {server or '-'}")


print(f"РЕГРЕСС: заголовки безопасности и сжатие ({BASE})")

print("\n1. Страницы")
home = get("/", Accept="text/html")
check("/ отвечает 200 и это HTML", home.status == 200 and "text/html" in home.h("Content-Type"),
      f"http={home.status} {home.h('Content-Type')}")
html = home.body.decode("utf-8", "replace")
hashes = inline_script_hashes(html)
check("на странице есть встроенный скрипт темы (иначе хэш проверять не на чем)", len(hashes) >= 1, str(len(hashes)))

for path in ("/", "/tasks", "/tasks/1", "/admin/dashboard", "/profile", "/index.html"):
    r = home if path == "/" else get(path, Accept="text/html")
    label = path
    check(f"{label}: 200, HTML", r.status == 200 and "text/html" in r.h("Content-Type"), f"http={r.status}")
    check_security_headers(label, r)
    check(f"{label}: index.html перепроверяется (no-cache)", "no-cache" in r.h("Cache-Control"), r.h("Cache-Control"))

csp = csp_directives(home.h("Content-Security-Policy"))
script_src = csp.get("script-src", [])
check("CSP: default-src 'self'", csp.get("default-src") == ["'self'"], str(csp.get("default-src")))
check("CSP: в script-src нет 'unsafe-inline'", "'unsafe-inline'" not in script_src, " ".join(script_src))
for h in hashes:
    check("CSP: встроенный скрипт страницы разрешён по хэшу", h in script_src,
          f"нужен {h} в frontend/nginx-security-headers.conf (script-src)" if h not in script_src else h)
stale = [t for t in script_src if t.startswith("'sha256-") and t not in hashes]
check("CSP: нет устаревших хэшей", not stale, " ".join(stale))
check("CSP: Яндекс.Карты разрешены (script-src)", "https://api-maps.yandex.ru" in script_src)
# Основной модуль API Карт загрузчик берёт с yastatic.net. Без этого адреса
# браузер блокирует модуль, и карта заданий бесконечно показывает загрузку.
check("CSP: модули Яндекс.Карт с yastatic.net разрешены (script-src)", "https://yastatic.net" in script_src,
      " ".join(script_src))
check("CSP: object-src 'none'", csp.get("object-src") == ["'none'"], str(csp.get("object-src")))
check("CSP: frame-ancestors 'none'", csp.get("frame-ancestors") == ["'none'"], str(csp.get("frame-ancestors")))
check("CSP: base-uri 'self'", csp.get("base-uri") == ["'self'"], str(csp.get("base-uri")))
check("CSP: form-action 'self'", csp.get("form-action") == ["'self'"], str(csp.get("form-action")))
check("CSP: чат по WebSocket разрешён (connect-src)",
      any(t.startswith("wss://") for t in csp.get("connect-src", [])), " ".join(csp.get("connect-src", [])))

print("\n2. Скрипты, стили, шрифты")
scripts = re.findall(r'<script[^>]+src="(/assets/[^"]+\.js)"', html)
styles = re.findall(r'<link[^>]+href="(/assets/[^"]+\.css)"', html)
fonts = re.findall(r'<link[^>]+href="(/fonts/[^"]+\.woff2)"', html)
check("в index.html найдены скрипт, стиль и шрифт", bool(scripts and styles and fonts),
      f"js={len(scripts)} css={len(styles)} fonts={len(fonts)}")

total_plain = 0
total_gzip = 0
for path in (scripts[:1] + styles[:1]):
    plain = get(path)
    via_caddy = get(path, Accept_Encoding="gzip", Via="1.1 Caddy")
    direct = get(path, Accept_Encoding="gzip")
    check(f"{path}: 200", plain.status == 200, f"http={plain.status}")
    check(f"{path}: кэш навсегда (immutable)", "immutable" in plain.h("Cache-Control"), plain.h("Cache-Control"))
    check(f"{path}: nosniff", plain.h("X-Content-Type-Options").lower() == "nosniff")
    check(f"{path}: без Accept-Encoding — не сжат", plain.h("Content-Encoding") == "", plain.h("Content-Encoding"))
    check(f"{path}: через Caddy (Via) — gzip", via_caddy.h("Content-Encoding") == "gzip",
          via_caddy.h("Content-Encoding") or "не сжат — проверьте gzip_proxied")
    check(f"{path}: напрямую — gzip", direct.h("Content-Encoding") == "gzip", direct.h("Content-Encoding") or "не сжат")
    check(f"{path}: Vary: Accept-Encoding", "accept-encoding" in via_caddy.h("Vary").lower(), via_caddy.h("Vary"))
    try:
        same = gzip.decompress(via_caddy.body) == plain.body
    except OSError:
        same = False
    check(f"{path}: распакованный ответ совпадает с файлом", same,
          f"{len(plain.body)} Б -> {len(via_caddy.body)} Б")
    total_plain += len(plain.body)
    total_gzip += len(via_caddy.body)

for path in fonts[:1]:
    r = get(path)
    check(f"{path}: 200", r.status == 200, f"http={r.status}")
    check(f"{path}: кэш на 30 дней", "max-age=2592000" in r.h("Cache-Control"), r.h("Cache-Control"))
    check(f"{path}: nosniff", r.h("X-Content-Type-Options").lower() == "nosniff")

page_gz = get("/", Accept="text/html", Accept_Encoding="gzip", Via="1.1 Caddy")
check("/ через Caddy — gzip", page_gz.h("Content-Encoding") == "gzip", page_gz.h("Content-Encoding") or "не сжат")
check("/ через Caddy — заголовки безопасности на месте", bool(page_gz.h("Content-Security-Policy")))

print("\n3. Отсутствующий файл")
missing = get("/assets/missing-0000.js", Accept_Encoding="gzip", Via="1.1 Caddy")
check("/assets/missing — 404, а не страница", missing.status == 404, f"http={missing.status}")
check("/assets/missing — nosniff и на ошибке", missing.h("X-Content-Type-Options").lower() == "nosniff")
body = missing.body
if missing.h("Content-Encoding") == "gzip":
    try:
        body = gzip.decompress(body)
    except OSError:
        pass
check("страница ошибки без версии nginx", not re.search(rb"nginx/\d", body),
      re.sub(r"\s+", " ", body[:120].decode("latin-1", "replace")))

if total_plain:
    print(f"\nОсновной скрипт и стили: {total_plain // 1024} КБ -> {total_gzip // 1024} КБ по сети")
print()
print(f"Проверок: {passed + failed}, провалено: {failed}")
sys.exit(1 if failed else 0)
