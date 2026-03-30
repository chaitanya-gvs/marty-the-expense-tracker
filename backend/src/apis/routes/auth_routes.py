import bcrypt
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from src.utils.jwt_utils import create_access_token, verify_access_token
from src.utils.settings import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)

COOKIE_NAME = "access_token"


class LoginRequest(BaseModel):
    username: str
    password: str


def _verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, response: Response):
    settings = get_settings()
    username_match = body.username == settings.AUTH_USERNAME
    password_match = bool(settings.AUTH_PASSWORD_HASH) and _verify_password(
        body.password, settings.AUTH_PASSWORD_HASH
    )
    if not (username_match and password_match):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token()
    is_secure = settings.APP_ENV != "dev"
    samesite = "none" if settings.COOKIE_SAMESITE_NONE else "lax"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_secure or settings.COOKIE_SAMESITE_NONE,
        samesite=samesite,
        max_age=60 * 60 * 24 * 7,
        path="/",
    )
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    settings = get_settings()
    is_secure = settings.APP_ENV != "dev"
    samesite = "none" if settings.COOKIE_SAMESITE_NONE else "lax"
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=is_secure or settings.COOKIE_SAMESITE_NONE,
        samesite=samesite,
    )
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    username = verify_access_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Token invalid or expired")
    return {"username": username}
