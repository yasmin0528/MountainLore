from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    app_name: str = "MountainLore API"
    environment: str = "development"
    debug: bool = False
    api_v1_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000", "http://172.24.192.1:3000"]
    database_path: str = "data/mountainlore.db"
    media_directory: str = "data/media"
    visitor_cookie_name: str = "visitor_token"
    visitor_ttl_days: int = 7
    max_upload_bytes: int = 10 * 1024 * 1024

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        enable_decoding=False,
        extra="ignore",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value: bool | str) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on", "development", "debug"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
