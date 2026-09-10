from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import Response as FastResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.models import StoredFile
from file_utils import validate_image

router = APIRouter(tags=["Files"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

@router.post("/upload/image")
def upload_image(file: UploadFile = File(...), token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    decode_token_or_401(token)
    safe_ctype = validate_image(file)
    data = file.file.read()
    stored = StoredFile(
        filename=file.filename or "image.jpg",
        content_type=safe_ctype,
        data=data
    )
    db.add(stored)
    db.commit()
    db.refresh(stored)
    return {
        "file_id": stored.id,
        "url": f"/files/{stored.id}",
        "filename": stored.filename
    }

@router.get("/files/{file_id}")
def get_file(file_id: int, db: Session = Depends(get_db)):
    stored = db.query(StoredFile).filter(StoredFile.id == file_id).first()
    if not stored:
        raise HTTPException(404, "Файл не найден")
    return FastResponse(
        content=stored.data,
        media_type=stored.content_type or "image/jpeg",
        headers={
            "Cache-Control": "public, max-age=31536000",
            "X-Content-Type-Options": "nosniff"
        }
    )
