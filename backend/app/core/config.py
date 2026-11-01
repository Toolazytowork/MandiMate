"""Application settings, read from the environment and ``backend/.env``."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
"""The ``backend/`` directory (holds ``.env``, ``alembic.ini`` and ``media/``)."""

DEFAULT_JWT_SECRET = "mandimate-development-secret-change-me-before-production"
"""Development-only signing key. Startup is refused when it is used with APP_ENV=production."""

MIN_PRODUCTION_SECRET_LENGTH = 32

AppEnv = Literal["development", "test", "staging", "production"]
AiMode = Literal["auto", "live", "mock"]


class Settings(BaseSettings):
    """Typed configuration. Every field can be overridden by an environment variable."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_ENV: AppEnv = "development"
    APP_NAME: str = "MandiMate"
    APP_VERSION: str = "0.1.0"
    API_PREFIX: str = "/api/v1"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    DATABASE_URL: str = "postgresql+asyncpg://mandimate:mandimate@localhost:5432/mandimate"
    TEST_DATABASE_URL: str = "postgresql+asyncpg://mandimate:mandimate@localhost:5432/mandimate_test"
    DB_ECHO: bool = False

    JWT_SECRET: str = DEFAULT_JWT_SECRET
    JWT_ALGORITHM: Literal["HS256", "HS384", "HS512"] = "HS256"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 14
    COOKIE_SECURE: bool = False
    COOKIE_DOMAIN: str | None = None

    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:8080",
    ]

    MEDIA_DIR: Path = BACKEND_DIR / "media"
    MEDIA_URL: str = "/media"
    MAX_UPLOAD_MB: int = 8

    AI_MODE: AiMode = "auto"
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-flash"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    AI_TIMEOUT_SECONDS: float = 30.0

    SITE_URL: str = "http://localhost:5173"

    @field_validator("DATABASE_URL", "TEST_DATABASE_URL")
    @classmethod
    def _use_asyncpg_driver(cls, value: str) -> str:
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return "postgresql+asyncpg://" + value.removeprefix(prefix)
        return value

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_origins(cls, value: object) -> object:
        """Accept a JSON array or a comma-separated list of origins."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [origin.strip() for origin in text.split(",") if origin.strip()]
        return value

    @field_validator("CORS_ORIGINS")
    @classmethod
    def _strip_trailing_slashes(cls, value: list[str]) -> list[str]:
        return [origin.rstrip("/") for origin in value]

    @field_validator("COOKIE_DOMAIN", mode="before")
    @classmethod
    def _blank_domain_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("MEDIA_DIR")
    @classmethod
    def _media_dir_relative_to_backend(cls, value: Path) -> Path:
        return value if value.is_absolute() else BACKEND_DIR / value

    @model_validator(mode="after")
    def _refuse_insecure_production(self) -> Self:
        if self.is_production and (
            self.JWT_SECRET == DEFAULT_JWT_SECRET
            or len(self.JWT_SECRET) < MIN_PRODUCTION_SECRET_LENGTH
        ):
            raise ValueError(
                "JWT_SECRET must be set to a unique random value of at least "
                f"{MIN_PRODUCTION_SECRET_LENGTH} characters when APP_ENV=production"
            )
        return self

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def ai_effective_mode(self) -> Literal["live", "mock"]:
        """``live`` only when AI is not forced to mock and a DeepSeek key is configured."""
        if self.AI_MODE == "mock" or not self.DEEPSEEK_API_KEY.strip():
            return "mock"
        return "live"

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_MB * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings instance (cached)."""
    return Settings()


settings = get_settings()
