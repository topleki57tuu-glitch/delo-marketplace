# Подключение домена `дело.online` к приложению «ДЕЛО»

Короткая версия: домен зарегистрирован, DNS настроен, сервер пустой. Нужно
развернуть стек. Всё остальное уже готово.

Проверено 18.09.2026.

---

## 1. Что уже есть (проверять не нужно)

| Что | Состояние |
|---|---|
| Домен | `дело.online`, punycode `xn--d1acsm.online` |
| Регистратор | REG.RU, IANA 1606 |
| Создан / истекает | 11.09.2026 / 11.09.2027 |
| Статус реестра | `clientTransferProhibited` — нормальный «замок от переноса» |
| NS | `ns1.reg.ru`, `ns2.reg.ru` |
| A-запись `@` | `213.21.229.145` |
| A-запись `www` | `213.21.229.145` |

DNS отдаётся публично, TTL 21600. Ждать пропагацию нечего.

**Сервер `213.21.229.145`:** SSH открыт, но порты 80/443/3000/8000 закрыты —
приложение не развёрнуто. Это и есть вся оставшаяся работа.

---

## 2. Кириллица и punycode — читать до правок

Домен кириллический, и это ломает три вещи сразу, если писать его юникодом.
**Везде, где домен попадает в конфиг, нужен punycode** — `xn--d1acsm.online`.

Почему:

1. **Caddy не принимает юникод в адресе сайта.** Документация требует, чтобы
   хост состоял «only of alphanumerics, hyphens, dots, and wildcard». PR
   «Support IDN in Caddyfile» (caddyserver/caddy#1665) закрыт как abandoned —
   поддержки юникода так и не появилось. Смежные issue: #3017, #6404, #7729.
2. **Let's Encrypt выдаёт сертификаты только на ASCII-имя** (`xn--...`).
3. **Backend сравнивает Origin буквально.** `_parse_origins`
   (`backend/app/core/config.py:27`) делает только `strip().rstrip("/")` — без
   IDN-нормализации. Браузер всегда шлёт в `Origin` punycode, поэтому юникод в
   `CORS_ORIGINS` не совпадёт и все запросы упадут по CORS.

В `vps_deploy.sh` добавлена функция `to_punycode()`: если ввести кириллицу,
скрипт сам превратит её в punycode и напечатает это. Но в готовом `.env` лучше
держать уже готовую форму.

**Что где писать:**

```
DOMAIN=xn--d1acsm.online            # punycode, иначе нет HTTPS
FRONTEND_URL=https://xn--d1acsm.online
CORS_ORIGINS=https://xn--d1acsm.online
```

В письмах и ссылках для людей — юникод `https://дело.online`, браузер сам
сделает преобразование. В ЮMoney тоже можно юникод, но надёжнее punycode.

---

## 3. Развёртывание

```bash
ssh root@213.21.229.145

apt-get update && apt-get install -y git
git clone https://github.com/topleki57tuu-glitch/delo-marketplace.git /opt/delo-marketplace
cd /opt/delo-marketplace
bash scripts/vps_deploy.sh
```

Скрипт спросит домен — вводи `дело.online` (он сам сделает punycode) или сразу
`xn--d1acsm.online`.

Что скрипт делает по порядку (после правок):

1. Ставит Docker, `python3`, `openssl`.
2. Генерирует `.env` со случайными `SECRET_KEY` и `POSTGRES_PASSWORD`.
   Если `.env` уже есть — **дописывает** `DOMAIN`/`FRONTEND_URL`/`CORS_ORIGINS`,
   если их не было, и не трогает секреты.
3. Проверяет, что `CORS_ORIGINS`/`FRONTEND_URL` не пусты (иначе backend не
   стартует — fail-closed в `config.py:117`).
4. Генерирует `deploy/Caddyfile` из `Caddyfile.domain` (или `.http`, если домена
   нет). Файла `deploy/Caddyfile` в репозитории нет — он создаётся здесь, а
   `docker-compose.prod.yml:18` монтирует именно его.
5. Собирает образы.
6. **Поднимает `postgres` и ждёт готовности** — миграции идут отдельным
   контейнером и должны видеть хост `postgres` в сети compose.
7. **Накатывает миграции**: `alembic upgrade head`. В production `main.py:69`
   не создаёт таблицы (`Base.metadata.create_all` только при
   `ENV=development`) — схему накатывает только Alembic.
8. Поднимает остальной стек, ждёт `/health` от backend.
9. Предлагает насыпать демо-данные (по умолчанию — нет).

### www

Caddy в шаблоне слушает только голый хост: `{$DOMAIN}` матчит `xn--d1acsm.online`,
но не `www.xn--d1acsm.online`. Если `www` нужен:

```bash
INCLUDE_WWW=1 bash scripts/vps_deploy.sh
```

Тогда скрипт подставит `{$DOMAIN}, www.{$DOMAIN}` через sed и Caddy выпустит
сертификат на оба имени. Убедись, что A-запись `www` уже есть — она есть.

---

## 4. После деплоя

Проверка:

```bash
curl -I https://xn--d1acsm.online/          # ждём 200, не 302 на парковку
curl -I https://xn--d1acsm.online/health    # ждём 200 от backend
```

Сертификат Caddy выпускает сам, обычно 10–60 секунд. Если HTTPS не поднялся:

```bash
docker compose -f docker-compose.prod.yml logs caddy | tail -50
```

Частые причины: юникод в `DOMAIN`, A-запись ещё не разошлась, порт 443 занят
(старый nginx).

### ЮMoney

В кабинете ЮMoney сменить оба адреса на новый домен:

- **вебхук (уведомления):** `https://xn--d1acsm.online/payments/webhook/yoomoney`
- **redirect_uri (возврат):** `https://xn--d1acsm.online/payments/oauth/yoomoney`

и в `.env`:

```
YOOMONEY_REDIRECT_URI=https://xn--d1acsm.online/payments/oauth/yoomoney
YOOMONEY_RETURN_PATH=/profile
```

`YOOMONEY_RETURN_PATH` добавлен в `docker-compose.prod.yml` — раньше его там не
было, и на VPS возврат после оплаты не подтверждался автоматически.

### Пароли, которые надо сменить

`vps_deploy.sh` пишет `ADMIN_EMAILS=admin@delo.ru` в `.env`. При регистрации
почта не подтверждается, поэтому **любой, кто первым займёт этот адрес,
получит права модератора**. Сразу после деплоя:

1. зарегистрировать `admin@delo.ru` самому (или вписать в `.env` свой реальный
   адрес и перезапустить backend), либо
2. выставить `ADMIN_EMAILS` в свой email и `docker compose -f
   docker-compose.prod.yml up -d backend`.

---

## 5. Чего делать не нужно

- **Не трогать `DOMAIN_SETUP_delomaster_online.md`, `nginx-delomaster.conf`,
  `deploy-manual.txt`.** Это старая дорога (nginx + systemd) под другой домен и
  другой IP (`92.53.96.169` — сейчас парковка Timeweb). Она конфликтует с
  Docker/Caddy: оба претендуют на один `server_name` и порты 80/443.
- **Не вписывать `VITE_API_URL`.** Фронтенд ходит относительными путями
  (`fetch('/payments/create')`), `frontend/nginx.conf` проксирует API и `/ws/`
  на backend. Для Docker-пути переменная не нужна.
- **Не менять `deloz-backend.onrender.com`** в Render-деплое на новый домен без
  передеплоя backend: он не отдаёт CORS для `дело.online`, и API отвалится.

---

## 6. Если HTTPS не выпустился, а очень надо — что смотреть

```bash
# Caddy вообще запустился?
docker compose -f docker-compose.prod.yml ps

# Что в логах по ACME
docker compose -f docker-compose.prod.yml logs caddy | grep -iE "acme|certificate|error"

# Резолвится ли домен с сервера
getent hosts xn--d1acsm.online

# Свободен ли 443
ss -tulpn | grep -E ':(80|443)\b'
```

Если на 80/443 висит старый nginx — остановить и отключить:
`systemctl stop nginx && systemctl disable nginx`.
