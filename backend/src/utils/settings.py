from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_PATH = Path(__file__).resolve().parents[2] / "configs/.env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH), env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    # App
    APP_ENV: str = "dev"
    APP_NAME: str = "expense-tracker"
    LOG_LEVEL: str = "INFO"

    # OpenAI
    OPENAI_API_KEY: str | None = None

    # Database
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "expense_db"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "postgres"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Gmail API
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REFRESH_TOKEN: str | None = None
    GOOGLE_PROJECT_ID: str | None = None
    GOOGLE_REDIRECT_URI: str | None = None

    # Sentry
    SENTRY_DSN: str | None = None

    @computed_field
    @property
    def DATABASE_URL(self) -> str:  # noqa: N802 (FastAPI convention)
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


