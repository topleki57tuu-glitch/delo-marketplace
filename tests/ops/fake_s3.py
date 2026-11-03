"""Поддельное S3-хранилище для tests/ops/run_ops_tests.sh (scripts/offsite.sh).

Адреса path-style: /БАКЕТ/КЛЮЧ, бакет — delo-backups. Подпись AWS Signature
Version 4 проверяется по-настоящему: ключ ops-access, секрет ops-secret,
сумма тела — по x-amz-content-sha256. Объекты — файлы DIR/objects/КЛЮЧ.
Список (ListObjectsV2) — страницами по два ключа, чтобы проверялось
продолжение по continuation-token. Загрузка частями — как в S3: каждая часть,
кроме последней, не меньше 5 МБ.

Управление из теста — файлы в DIR:
  deny_all     на любой запрос — 403 AccessDenied (ключ отозван);
  deny_delete  на удаление — 403 AccessDenied (ключ без права удалять);
  flaky        число N: столько следующих запросов получат 503 SlowDown.
Каждый запрос — строка в DIR/requests.log: «МЕТОД путь код».
"""

import datetime
import hashlib
import hmac
import re
import shutil
import sys
import uuid
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urlsplit
from xml.sax.saxutils import escape

PORT = int(sys.argv[1])
DIR = Path(sys.argv[2])
OBJECTS = DIR / "objects"
UPLOADS = DIR / "multipart"
BUCKET = "delo-backups"
ACCESS_KEY = "ops-access"
SECRET_KEY = "ops-secret"
MIN_PART = 5 * 1024 * 1024
PAGE = 2
for d in (OBJECTS, UPLOADS):
    d.mkdir(parents=True, exist_ok=True)

AUTH_RE = re.compile(
    r"AWS4-HMAC-SHA256 Credential=([^/]+)/(\d{8})/([^/]+)/s3/aws4_request, "
    r"SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$"
)


def _quote(value, safe="-_.~"):
    return quote(value, safe=safe)


def _xml(root, inner):
    return (f'<?xml version="1.0" encoding="UTF-8"?><{root} xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"{inner}</{root}>").encode()


def _upload_dir(upload_id):
    return UPLOADS / hashlib.sha1(upload_id.encode()).hexdigest()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _reply(self, code, body=b"", headers=None):
        headers = dict(headers or {})
        headers.setdefault("Content-Length", str(len(body)))
        self.send_response(code)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)
        with (DIR / "requests.log").open("a", encoding="utf-8") as f:
            f.write(f"{self.command} {self.path} {code}\n")

    def _error(self, code, s3_code, message=""):
        if self.command == "HEAD":
            return self._reply(code)
        body = (f'<?xml version="1.0" encoding="UTF-8"?><Error><Code>{s3_code}</Code>'
                f"<Message>{escape(message)}</Message></Error>").encode()
        return self._reply(code, body, {"Content-Type": "application/xml"})

    def _auth_error(self, body):
        m = AUTH_RE.match(self.headers.get("Authorization", ""))
        if not m:
            return "AccessDenied", "подписи нет или она не AWS4-HMAC-SHA256"
        access, day, region, signed, signature = m.groups()
        if access != ACCESS_KEY:
            return "InvalidAccessKeyId", "The AWS Access Key Id you provided does not exist in our records."
        names = signed.split(";")
        if "host" not in names or "x-amz-date" not in names or "x-amz-content-sha256" not in names:
            return "AccessDenied", "host, x-amz-date и x-amz-content-sha256 должны быть подписаны"
        amz_date = self.headers.get("x-amz-date", "")
        if not amz_date.startswith(day):
            return "AuthorizationHeaderMalformed", "дата в Credential не совпадает с x-amz-date"
        payload_hash = self.headers.get("x-amz-content-sha256", "")
        if payload_hash != hashlib.sha256(body).hexdigest():
            return "XAmzContentSHA256Mismatch", "The provided 'x-amz-content-sha256' header does not match what was computed."
        parts = urlsplit(self.path)
        query = sorted(parse_qsl(parts.query, keep_blank_values=True))
        canonical = "\n".join([
            self.command,
            _quote(unquote(parts.path), safe="/-_.~"),
            "&".join(f"{_quote(k)}={_quote(v)}" for k, v in query),
            "".join(f"{n}:{' '.join((self.headers.get(n) or '').split())}\n" for n in names),
            signed,
            payload_hash,
        ])
        scope = f"{day}/{region}/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope,
                             hashlib.sha256(canonical.encode()).hexdigest()])
        key = ("AWS4" + SECRET_KEY).encode()
        for part in (day, region, "s3", "aws4_request"):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        expected = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return ("SignatureDoesNotMatch",
                    "The request signature we calculated does not match the signature you provided.")
        return None

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        flaky = DIR / "flaky"
        if flaky.exists():
            left = int(flaky.read_text().strip() or 0)
            if left > 0:
                flaky.write_text(str(left - 1))
                return self._error(503, "SlowDown", "Please reduce your request rate.")
        err = self._auth_error(body)
        if err:
            return self._error(403, *err)
        if (DIR / "deny_all").exists():
            return self._error(403, "AccessDenied", "Access Denied")
        parts = urlsplit(self.path)
        bucket, _, key = unquote(parts.path).lstrip("/").partition("/")
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        if bucket != BUCKET:
            return self._error(404, "NoSuchBucket", "The specified bucket does not exist")
        method = self.command
        if method == "GET" and not key:
            return self._list(query)
        if not key or ".." in key.split("/"):
            return self._error(400, "InvalidRequest", "")
        if method == "DELETE" and (DIR / "deny_delete").exists():
            return self._error(403, "AccessDenied", "Access Denied")
        if method == "POST" and "uploads" in query:
            return self._multipart_start(key)
        if "uploadId" in query:
            upload = _upload_dir(query["uploadId"])
            if not upload.is_dir():
                return self._error(404, "NoSuchUpload", "The specified upload does not exist.")
            if method == "PUT":
                etag = hashlib.md5(body).hexdigest()
                (upload / f"{int(query['partNumber']):05d}").write_bytes(body)
                return self._reply(200, b"", {"ETag": f'"{etag}"'})
            if method == "POST":
                return self._multipart_complete(key, upload, body)
            if method == "DELETE":
                shutil.rmtree(upload)
                return self._reply(204)
        path = OBJECTS / key
        if method == "PUT":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return self._reply(200, b"", {"ETag": f'"{hashlib.md5(body).hexdigest()}"'})
        if method in ("GET", "HEAD"):
            if not path.is_file():
                return self._error(404, "NoSuchKey", "The specified key does not exist.")
            data = path.read_bytes()
            if method == "HEAD":
                return self._reply(200, b"", {"Content-Length": str(len(data))})
            return self._reply(200, data, {"Content-Type": "application/octet-stream"})
        if method == "DELETE":
            if path.is_file():
                path.unlink()
            return self._reply(204)
        return self._error(405, "MethodNotAllowed", "")

    def _list(self, query):
        prefix = query.get("prefix", "")
        keys = sorted(str(p.relative_to(OBJECTS)) for p in OBJECTS.rglob("*") if p.is_file())
        keys = [k for k in keys if k.startswith(prefix)]
        token = query.get("continuation-token", "")
        start = int(token[len("tok/"):-len("+=")]) if token else 0
        page = keys[start:start + PAGE]
        truncated = start + PAGE < len(keys)
        items = ""
        for k in page:
            stat = (OBJECTS / k).stat()
            modified = datetime.datetime.fromtimestamp(stat.st_mtime, datetime.timezone.utc)
            items += (f"<Contents><Key>{escape(k)}</Key>"
                      f"<LastModified>{modified.strftime('%Y-%m-%dT%H:%M:%S.000Z')}</LastModified>"
                      f"<Size>{stat.st_size}</Size><StorageClass>STANDARD</StorageClass></Contents>")
        # Токен со знаками, которые нужно кодировать в адресе: «/», «+», «=».
        nxt = f"<NextContinuationToken>tok/{start + PAGE}+=</NextContinuationToken>" if truncated else ""
        inner = (f"<Name>{BUCKET}</Name><Prefix>{escape(prefix)}</Prefix><KeyCount>{len(page)}</KeyCount>"
                 f"<MaxKeys>{PAGE}</MaxKeys><IsTruncated>{'true' if truncated else 'false'}</IsTruncated>"
                 f"{items}{nxt}")
        return self._reply(200, _xml("ListBucketResult", inner), {"Content-Type": "application/xml"})

    def _multipart_start(self, key):
        upload_id = f"up/{uuid.uuid4().hex}+="
        _upload_dir(upload_id).mkdir(parents=True)
        inner = f"<Bucket>{BUCKET}</Bucket><Key>{escape(key)}</Key><UploadId>{escape(upload_id)}</UploadId>"
        return self._reply(200, _xml("InitiateMultipartUploadResult", inner), {"Content-Type": "application/xml"})

    def _multipart_complete(self, key, upload, body):
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            return self._error(400, "MalformedXML", "")
        wanted = []
        for part in root.iter():
            if part.tag.rsplit("}", 1)[-1] != "Part":
                continue
            fields = {c.tag.rsplit("}", 1)[-1]: (c.text or "").strip() for c in part}
            wanted.append((int(fields.get("PartNumber", "0")), fields.get("ETag", "").strip('"')))
        if not wanted or [n for n, _ in wanted] != sorted(n for n, _ in wanted):
            return self._error(400, "InvalidPartOrder", "")
        chunks = []
        for i, (number, etag) in enumerate(wanted):
            f = upload / f"{number:05d}"
            if not f.is_file() or hashlib.md5(f.read_bytes()).hexdigest() != etag:
                return self._error(400, "InvalidPart", f"часть {number} не загружена или ETag не тот")
            data = f.read_bytes()
            if i < len(wanted) - 1 and len(data) < MIN_PART:
                return self._error(400, "EntityTooSmall", "Your proposed upload is smaller than the minimum allowed object size.")
            chunks.append(data)
        path = OBJECTS / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"".join(chunks))
        shutil.rmtree(upload)
        inner = f"<Bucket>{BUCKET}</Bucket><Key>{escape(key)}</Key><ETag>\"multipart-{len(chunks)}\"</ETag>"
        return self._reply(200, _xml("CompleteMultipartUploadResult", inner), {"Content-Type": "application/xml"})

    do_GET = _handle
    do_PUT = _handle
    do_POST = _handle
    do_HEAD = _handle
    do_DELETE = _handle


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
