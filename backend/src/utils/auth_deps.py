from fastapi import HTTPException, Request

from src.utils.jwt_utils import verify_access_token


async def get_current_user(request: Request) -> str:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    username = verify_access_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Token invalid or expired")
    return username
