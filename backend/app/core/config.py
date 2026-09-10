import os
from typing import List

class Settings:
    ENV: str = os.environ.get("ENV", "development").lower()
    IS_PRODUCTION: bool = ENV == "production"
    
    ALGORITHM: str = "HS256"
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "marketplace_super_secret" if not IS_PRODUCTION else "")
    
    DB_URL: str = os.environ.get("DATABASE_URL", "sqlite:///./marketplace_v3.db")
    
    # Process DB_URL for SQLAlchemy 2.0
    if DB_URL.startswith("postgres://"):
        DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)
    elif DB_URL.startswith("postgresql://"):
        DB_URL = DB_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
        
    if not SECRET_KEY and (IS_PRODUCTION or "postgres" in DB_URL):
        SECRET_KEY = os.environ.get("SECRET_KEY", "marketplace_super_secret_jwt_key_here")
    if not SECRET_KEY:
        SECRET_KEY = "marketplace_super_secret"
        
    CORS_ORIGINS: List[str] = [
        "*"
    ]
    FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "")

settings = Settings()
