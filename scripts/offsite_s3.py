#!/usr/bin/env python3
"""Небольшой клиент S3 для копий вне сервера (его вызывает scripts/offsite.sh).

Только стандартная библиотека Python — на сервере ничего ставить не нужно.
Подпись — AWS Signature Version 4: её понимают Yandex Object Storage,
Selectel, VK Cloud, Timeweb Cloud, MinIO и Amazon S3. Адреса — в виде
https://АДРЕС/БАКЕТ/КЛЮЧ (path-style), его поддерживают все они.

Команды:
  put ФАЙЛ КЛЮЧ    загрузить; файлы больше S3_PART_MB — частями
  get КЛЮЧ ФАЙЛ    скачать
  head КЛЮЧ        размер объекта в байтах
  list ПРЕФИКС     «ключ<TAB>размер<TAB>дата» — строка на объект
  delete КЛЮЧ      удалить

Настройки — только из окружения, не из аргументов: аргументы команд видны
всем пользователям сервера (ps), а здесь секретный ключ.
  S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY
  S3_PART_MB — размер части при загрузке частями, МБ (по умолчанию 64;
               меньше 5 хранилища не принимают — меньшее число заменим на 5)

Код выхода: 0 — успех; 1 — ошибка (причина — в stderr); 3 — объекта нет.
"""
import datetime
import hashlib
import hmac
import http.client
import os
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
RETRIES = 4
MIN_PART_MB = 5  # меньше части (кроме последней) S3 не принимает

HINTS = {
    "SignatureDoesNotMatch": "секретный ключ (BACKUP_S3_SECRET_KEY) или регион (BACKUP_S3_REGION) не подходят",
    "InvalidAccessKeyId": "идентификатор ключа (BACKUP_S3_ACCESS_KEY) хранилищу неизвестен",
    "AccessDenied": "у ключа нет прав на это действие с бакетом — проверьте роль сервисного аккаунта",
    "NoSuchBucket": "такого бакета нет — создайте его или проверьте BACKUP_S3_BUCKET",
    "AuthorizationHeaderMalformed": "регион (BACKUP_S3_REGION) не подходит к этому хранилищу",
    "RequestTimeTooSkewed": "часы сервера сбились — синхронизируйте время (timedatectl set-ntp true)",
}


class S3Error(Exception):
    """status — HTTP-код ответа; None — ответа не было (сеть) или он непонятен."""

    def __init__(self, status, code="", message=""):
        self.status = status
        self.code = code
        if status is None:
            super().__init__(message)
            return
        text = f"хранилище ответило {status}"
        if code:
            text += f" {code}"
        if message:
            text += f": {message}"
        if code in HINTS:
            text += f" ({HINTS[code]})"
        super().__init__(text)


def _quote(value, safe="-_.~"):
    return urllib.parse.quote(value, safe=safe)


def _parse_error(status, body):
    code = message = ""
    try:
        root = ET.fromstring(body)
        for el in root.iter():
            tag = el.tag.rsplit("}", 1)[-1]
            if tag == "Code" and not code:
                code = (el.text or "").strip()
            elif tag == "Message" and not message:
                message = (el.text or "").strip()
    except ET.ParseError:
        message = body[:200].decode("utf-8", "replace").strip() if body else ""
    return S3Error(status, code, message)


class Client:
    def __init__(self, endpoint, region, bucket, access_key, secret_key, timeout=120):
        parts = urllib.parse.urlsplit(endpoint if "://" in endpoint else "https://" + endpoint)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError(f"адрес хранилища должен быть вида https://storage.example.ru, получено: {endpoint!r}")
        self.scheme = parts.scheme
        self.host = parts.netloc
        self.base = parts.path.rstrip("/")
        self.region = region
        self.bucket = bucket
        self.access_key = access_key
        self.secret_key = secret_key
        self.timeout = timeout

    # --- подпись -----------------------------------------------------------

    def path_for(self, key):
        path = f"{self.base}/{self.bucket}"
        if key:
            path += "/" + key
        return path

    def sign(self, method, path, query, headers, payload_hash, now=None):
        """Заголовки запроса с подписью AWS Signature Version 4."""
        now = now or datetime.datetime.now(datetime.timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        day = now.strftime("%Y%m%d")
        signed_headers = {k.lower(): " ".join(str(v).split()) for k, v in headers.items()}
        signed_headers["host"] = self.host
        signed_headers["x-amz-date"] = amz_date
        signed_headers["x-amz-content-sha256"] = payload_hash
        names = sorted(signed_headers)
        canonical_query = "&".join(
            f"{_quote(k)}={_quote(v)}" for k, v in sorted((str(k), str(v)) for k, v in query.items())
        )
        canonical_request = "\n".join([
            method,
            _quote(path, safe="/-_.~"),
            canonical_query,
            "".join(f"{n}:{signed_headers[n]}\n" for n in names),
            ";".join(names),
            payload_hash,
        ])
        scope = f"{day}/{self.region}/s3/aws4_request"
        string_to_sign = "\n".join([
            "AWS4-HMAC-SHA256", amz_date, scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ])
        key = ("AWS4" + self.secret_key).encode("utf-8")
        for part in (day, self.region, "s3", "aws4_request"):
            key = hmac.new(key, part.encode("utf-8"), hashlib.sha256).digest()
        signature = hmac.new(key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        signed_headers["authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{scope}, "
            f"SignedHeaders={';'.join(names)}, Signature={signature}"
        )
        return signed_headers

    # --- запрос ------------------------------------------------------------

    def _connection(self):
        cls = http.client.HTTPSConnection if self.scheme == "https" else http.client.HTTPConnection
        return cls(self.host, timeout=self.timeout)

    def request(self, method, key="", query=None, body=b"", payload_hash=None, headers=None,
                expect=(200,), stream_to=None):
        """Запрос с повторами при сбоях сети и ответах 5xx/429.

        body — bytes или открытый файл (его перематываем перед повтором).
        stream_to — открытый файл, куда писать тело ответа.
        Возвращает (статус, заголовки, тело).
        """
        query = query or {}
        path = self.path_for(key)
        url = _quote(path, safe="/-_.~")
        if query:
            url += "?" + "&".join(f"{_quote(str(k))}={_quote(str(v))}" for k, v in sorted(query.items()))
        if payload_hash is None:
            payload_hash = EMPTY_SHA256 if not body else hashlib.sha256(body).hexdigest()
        delay = 2
        for attempt in range(1, RETRIES + 1):
            conn = self._connection()
            try:
                if stream_to is not None:
                    # Повтор после обрыва: начинаем файл заново, а не дописываем.
                    stream_to.seek(0)
                    stream_to.truncate()
                hdrs = self.sign(method, path, query, dict(headers or {}), payload_hash)
                if hasattr(body, "seek"):
                    body.seek(0)
                    hdrs["content-length"] = str(os.fstat(body.fileno()).st_size)
                elif body or method in ("PUT", "POST"):
                    hdrs["content-length"] = str(len(body))
                conn.request(method, url, body=body if body else None, headers=hdrs)
                resp = conn.getresponse()
                status = resp.status
                if status in expect and stream_to is not None:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        stream_to.write(chunk)
                    data = b""
                else:
                    data = resp.read()
                resp_headers = {k.lower(): v for k, v in resp.getheaders()}
            except (OSError, http.client.HTTPException) as exc:
                if attempt == RETRIES:
                    raise S3Error(None, "", f"нет связи с хранилищем {self.host}: {exc}") from exc
                time.sleep(delay)
                delay *= 2
                continue
            finally:
                conn.close()
            if status in expect:
                return status, resp_headers, data
            if (status >= 500 or status == 429) and attempt < RETRIES:
                time.sleep(delay)
                delay *= 2
                continue
            raise _parse_error(status, data)
        raise S3Error(None, "", f"нет связи с хранилищем {self.host}")

    # --- операции ----------------------------------------------------------

    def put_file(self, filename, key, part_size):
        size = os.path.getsize(filename)
        if size <= part_size:
            digest = hashlib.sha256()
            with open(filename, "rb") as fh:
                for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                    digest.update(chunk)
                self.request("PUT", key, body=fh, payload_hash=digest.hexdigest())
            return
        _, _, data = self.request("POST", key, query={"uploads": ""})
        upload_id = _find_text(data, "UploadId")
        if not upload_id:
            raise S3Error(None, "", "хранилище не начало загрузку частями: в ответе нет UploadId")
        parts = []
        try:
            with open(filename, "rb") as fh:
                number = 1
                while True:
                    chunk = fh.read(part_size)
                    if not chunk:
                        break
                    _, hdrs, _ = self.request(
                        "PUT", key, query={"partNumber": number, "uploadId": upload_id}, body=chunk,
                    )
                    parts.append((number, hdrs.get("etag", "")))
                    number += 1
            xml = "<CompleteMultipartUpload>" + "".join(
                f"<Part><PartNumber>{n}</PartNumber><ETag>{etag}</ETag></Part>" for n, etag in parts
            ) + "</CompleteMultipartUpload>"
            _, _, data = self.request("POST", key, query={"uploadId": upload_id}, body=xml.encode("utf-8"))
            # Amazon (и не только) может ответить 200, а ошибку положить в тело.
            if b"<Error>" in data:
                raise _parse_error(200, data)
        except BaseException:
            try:
                self.request("DELETE", key, query={"uploadId": upload_id}, expect=(200, 204))
            except S3Error:
                pass
            raise

    def get_file(self, key, filename):
        tmp = filename + ".part"
        try:
            with open(tmp, "wb") as fh:
                self.request("GET", key, stream_to=fh)
            os.replace(tmp, filename)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def head(self, key):
        _, hdrs, _ = self.request("HEAD", key)
        return int(hdrs.get("content-length", "0"))

    def list(self, prefix):
        token = None
        while True:
            query = {"list-type": "2", "prefix": prefix}
            if token:
                query["continuation-token"] = token
            _, _, data = self.request("GET", "", query=query)
            root = ET.fromstring(data)
            for item in root:
                if item.tag.rsplit("}", 1)[-1] != "Contents":
                    continue
                fields = {child.tag.rsplit("}", 1)[-1]: (child.text or "") for child in item}
                yield fields.get("Key", ""), int(fields.get("Size", "0") or 0), fields.get("LastModified", "")
            truncated = _find_text(data, "IsTruncated") == "true"
            token = _find_text(data, "NextContinuationToken")
            if not truncated or not token:
                return

    def delete(self, key):
        self.request("DELETE", key, expect=(200, 204))


def _find_text(data, name):
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return ""
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] == name:
            return (el.text or "").strip()
    return ""


def client_from_env():
    missing = [n for n in ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY") if not os.environ.get(n)]
    if missing:
        raise ValueError("не заданы: " + ", ".join(missing))
    return Client(
        os.environ["S3_ENDPOINT"],
        os.environ.get("S3_REGION") or "us-east-1",
        os.environ["S3_BUCKET"],
        os.environ["S3_ACCESS_KEY"],
        os.environ["S3_SECRET_KEY"],
    )


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1
    cmd, args = argv[1], argv[2:]
    try:
        client = client_from_env()
        if cmd == "put" and len(args) == 2:
            part_mb = max(MIN_PART_MB, int(os.environ.get("S3_PART_MB") or 64))
            client.put_file(args[0], args[1], part_mb * 1024 * 1024)
        elif cmd == "get" and len(args) == 2:
            client.get_file(args[0], args[1])
        elif cmd == "head" and len(args) == 1:
            print(client.head(args[0]))
        elif cmd == "list" and len(args) == 1:
            for key, size, modified in client.list(args[0]):
                print(f"{key}\t{size}\t{modified}")
        elif cmd == "delete" and len(args) == 1:
            client.delete(args[0])
        else:
            print(__doc__, file=sys.stderr)
            return 1
    except S3Error as exc:
        if exc.status == 404 and exc.code in ("NoSuchKey", "") and cmd in ("get", "head"):
            print("объекта нет в хранилище", file=sys.stderr)
            return 3
        print(str(exc), file=sys.stderr)
        return 1
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
