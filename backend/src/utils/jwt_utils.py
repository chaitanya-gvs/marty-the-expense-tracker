from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from src.utils.settings import get_settings


def create_access_token() -> str:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(days=s.JWT_EXPIRY_DAYS)
    return jwt.encode({"sub": s.AUTH_USERNAME, "exp": exp}, s.JWT_SECRET_KEY, algorithm=s.JWT_ALGORITHM)


def verify_access_token(token: str) -> str | None:
    """Returns username on success, None on any failure."""
    s = get_settings()
    try:
        payload = jwt.decode(token, s.JWT_SECRET_KEY, algorithms=[s.JWT_ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None
