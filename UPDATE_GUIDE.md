# Обновление приложения на сервере

Актуально на 18.09.2026. Сервер `213.21.229.145`, сайт `https://дело.online`
(punycode `xn--d1acsm.online`), каталог `/opt/delo-marketplace`.

---

## Коротко: как выпустить обновление

Два шага. Первый — у себя на Windows, второй — на сервере.

**1. У себя: закоммитить и запушить**

```bash
cd "C:\Users\armen\WorkBuddy AI\2026-09-18-11-44-56\delo-marketplace"
git add .
git commit -m "что изменил"
git push origin main
```

**2. На сервере: применить**

Заходишь по SSH (или двойным кликом `server-shell.bat`) и выполняешь:

```bash
cd /opt/delo-marketplace
bash scripts/vps_update.sh
```

Всё. Скрипт сам подтянет код, прогонит миграции, пересоберёт образы и
перезапустит стек.

### То же самое, но мышкой

Двойной клик по `deploy.bat` в папке проекта на Windows. Он делает ровно
шаг 2 по SSH: проверяет, что путь на сервере существует, запускает
`vps_update.sh`, потом проверяет `https://xn--d1acsm.online/health`.

> `deploy.bat` **не делает** `git push`. Если ты не запушил изменения,
> на сервере обновится старая версия, и скрипт честно напишет
> `код не изменился (XXXXXXX)`.

---

## Как понять, что ты в SSH, а не в Windows

Это главная ловушка. Если путать — команды выполняются на твоём компьютере,
а не на сервере, и ничего не работает.

| | Windows cmd | SSH на сервере |
|---|---|---|
| Приглашение | `C:\Users\armen>` | `root@noisy-amethyst:~#` |
| Каталог | `C:\opt\delo-marketplace` | `/opt/delo-marketplace` |
| `apt-get` | «не является внутренней командой» | работает |
| `bash` | просит WSL | работает |

**Правило: если приглашение начинается с `C:\` — ты в Windows.**

Зашёл по ошибке — выйди: набери `exit`.

---

## Что именно делает `vps_update.sh`

Восемь шагов, по порядку:

| Шаг | Что происходит |
|---|---|
| 1 | `git fetch` + `git reset --hard origin/main` — жёстко встаёт на серверную версию |
| 2 | Проверка `.env` — дописывает только **отсутствующие** переменные |
| 3 | `docker compose build` — собирает образы backend/frontend |
| 4 | `up -d postgres` + ожидание `pg_isready` (до 2 минут) |
| 5 | `alembic upgrade head` — накатывает миграции БД |
| 6 | `up -d` — поднимает весь стек |
| 7 | Ждёт ответа `/health` (до 2 минут) |
| 8 | `docker image prune` — чистит старые слои образов |

**Существующий `.env` не перезаписывается.** Токены, пароли и домен остаются
на месте. Это отличие от `vps_deploy.sh` — тот для первой установки и `.env`
создаёт.

### Зачем отдельный скрипт, а не `git pull && up -d --build`

Потому что при новой миграции такая связка **ломается молча**: код
пересобирается, а схема БД остаётся старой. Приложение падает на отсутствующей
колонке. `vps_update.sh` вызывает alembic всегда — даже если миграций нет,
это ничего не стоит.

---

## Сколько ждать

Сборка фронтенда на этом сервере — 5–15 минут. Не пугайся, что «висит»:
`docker compose build` долго не печатает ничего осмысленного.

Хочешь прогресс — во втором окне SSH:

```bash
cd /opt/delo-marketplace
docker compose -f docker-compose.prod.yml ps
```

---

## Проверка после обновления

В конце скрипт печатает что-то вроде:

```
==========================================
 Готово: https://xn--d1acsm.online
 Версия: 769a261
 Логи:   docker compose -f docker-compose.prod.yml logs -f backend
==========================================
```

Убедись, что `Версия` — это тот коммит, который ты запушил. Если там старый
хеш, значит `reset --hard` не нашёл изменений (не запушил).

Дополнительно, из Windows — двойной клик по `status-server.bat`. Он покажет
коды ответов `/`, `/health`, `/tasks/`, `/products/`, состояние контейнеров
и занятое место на диске.

Или вручную:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://xn--d1acsm.online/
curl -s https://xn--d1acsm.online/health
```

Ожидаемо: `200` и `{"status":"ok"}`.

---

## Если что-то пошло не так

### `backend не поднялся`

Скрипт сам покажет последние 50 строк логов. Смотри их, но сначала ответь
на два вопроса:

1. Не забыл ли `git push`? Ведь на сервер приезжает только то, что в GitHub.
2. Не добавил ли новые переменные в `.env.example`, но не в `.env`?

Переменная, которой нет в окружении, читается как пустая строка и **не роняет
старт** — она просто молча отключает функцию. Так было с ЮMoney и `REDIRECT_URI`.

### `postgres не поднялся`

Обычно кончилось место на диске (его 9.76 ГБ):

```bash
df -h /
docker system prune -af
```

`prune -af` удалит **все** неиспользуемые образы. Если стек уже собран и
работает — это безопасно, но следующая сборка будет дольше.

### Скрипт упал на середине

Он идемпотентный — просто запусти его ещё раз. Повторный `build` переиспользует
слои, `alembic upgrade head` на актуальной схеме ничего не делает.

Крайний случай — откат на предыдущий коммит:

```bash
cd /opt/delo-marketplace
git log --oneline -5
git reset --hard <старый-хеш>
bash scripts/vps_update.sh
```

Приложение вернётся к прежней версии, но БД останется на новой схеме.
Миграции «назад» автоматически не откатываются — это нормально, если изменение
было аддитивным.

### `_domain: unbound variable` или похожее

Старая версия скрипта (исправлено в `3dde4d0`). Лечится обновлением самого
скрипта:

```bash
cd /opt/delo-marketplace
git fetch origin main && git reset --hard origin/main
```

---

## Полезные команды

Все — **на сервере**, после `cd /opt/delo-marketplace`.

Сокращение для длины команд:

```bash
alias dc='docker compose -f docker-compose.prod.yml'
```

| Задача | Команда |
|---|---|
| Что запущено | `dc ps` |
| Логи backend | `dc logs -f --tail 100 backend` |
| Логи фронтенда | `dc logs -f --tail 100 frontend` |
| Логи Caddy (HTTPS) | `dc logs -f --tail 100 caddy` |
| Перезапуск backend | `dc up -d backend` |
| Проверить переменную | `dc exec backend env \| grep YOOMONEY` |
| Занятое место | `df -h /` |
| Версия кода | `git log --oneline -1` |

Из Windows: `logs.bat` (логи backend), `status-server.bat` (статус),
`server-shell.bat` (просто вход).

---

## Что НЕ надо делать

- **Не запускать `vps_deploy.sh`** на работающем сервере. Он для первой
  установки: перезапишет `.env` и сменит пароль БД.
- **Не использовать `deploy-manual.txt`, `nginx-delomaster.conf`,
  `DOMAIN_SETUP_delomaster_online.md`.** Это старая дорога под домен
  `delomaster.online` и IP `92.53.96.169`. Конфликтует с Caddy за порты 80/443.
- **Не править `.env` без бэкапа.** `cp .env .env.bak.$(date +%s)` перед любой
  правкой — секунда работы.
- **Не писать домен кириллицей** в `DOMAIN`, `FRONTEND_URL`, `CORS_ORIGINS`.
  Только punycode `xn--d1acsm.online`: Caddy не принимает юникод в адресе
  сайта, Let's Encrypt выдаёт сертификаты только на ASCII, а браузер шлёт
  punycode в `Origin`, из-за чего CORS не совпадёт.

---

## Как добавить переменную окружения

1. Дописать в `.env.example` **пустой плейсхолдер** — реальные значения туда
   не попадают никогда, файл лежит в git.
2. Дописать в `docker-compose.prod.yml` в блок `backend.environment`.
   Без этого переменная в контейнер не пробросится.
3. На сервере — в `/opt/delo-marketplace/.env`:

```bash
cp .env .env.bak.$(date +%s)
cat >> .env <<'EOF'
НОВАЯ_ПЕРЕМЕННАЯ=значение
EOF
docker compose -f docker-compose.prod.yml up -d backend
```

Проверить, что долетело:

```bash
docker compose -f docker-compose.prod.yml exec backend env | grep НОВАЯ
```

---

## Текущее состояние (18.09.2026)

**Работает:** домен, HTTPS (Let's Encrypt), SPA, backend, postgres, Redis,
Caddy, бот (контейнер поднят).

**Не настроено, требуется вручную:**

- **ЮMoney** — токены не вписаны, `/payments/status` отдаёт
  `"yoomoney":{"configured":false}`. Нужны `YOOMONEY_ACCESS_TOKEN`,
  `YOOMONEY_CLIENT_ID`, `YOOMONEY_NOTIFICATION_SECRET`. Коду `client_secret`
  **не нужен** — он нигде не читается.
- **Вебхук ЮMoney** в кабинете — перевести на
  `https://xn--d1acsm.online/payments/webhook/yoomoney`. Там до сих пор
  старый домен.
- **`TELEGRAM_BOT_TOKEN`** — пустой, бот не функционирует.
- **`ADMIN_EMAILS=admin@delo.ru`** — почта при регистрации не подтверждается,
  поэтому первый, кто займёт этот адрес, станет модератором. Либо займи
  адрес сам, либо смени на свой.
- **`www.`** — не обслуживается. Нужен:
  `sed -i 's/^{\$DOMAIN}/{$DOMAIN}, www.{$DOMAIN}/' deploy/Caddyfile && docker compose -f docker-compose.prod.yml restart caddy`

**Про обновления:** автодеплоя нет. CI/CD, webhook, watchtower не настроены.
Каждое обновление — руками по этому документу.
