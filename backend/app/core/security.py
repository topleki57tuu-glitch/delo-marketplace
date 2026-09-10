import bcrypt
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from jose import JWTError, jwt
from fastapi import HTTPException, Request, Depends, status
from fastapi.security import OAuth2PasswordBearer
from app.core.config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=7)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или просроченный токен авторизации",
            headers={"WWW-Authenticate": "Bearer"},
        )

# In-memory Rate Limiter
_rate_buckets: Dict[str, List[float]] = {}

def rate_limit(request: Request, bucket: str, limit: int = 60, window_sec: int = 60):
    # Retrieve real client IP from headers or client
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
    
    key = f"{bucket}:{ip}"
    now = time.time()
    hits = [t for t in _rate_buckets.get(key, []) if now - t < window_sec]
    if len(hits) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много запросов, пожалуйста, повторите попытку через минуту"
        )
    hits.append(now)
    _rate_buckets[key] = hits
