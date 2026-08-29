from functools import lru_cache
from pathlib import Path

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
    ai_runtime_mode: str = "demo"
    openai_next_base_url: str = "https://api.openai-next.com/v1"
    openai_next_api_key: str = ""
    openai_next_text_model: str = "gpt-5.5"
    openai_next_tide_model: str = "sonar"
    tide_api_base_url: str = "https://api.openai-next.com/v1"
    tide_api_key: str = ""
    tide_search_model: str = "sonar-medium-online"
    tide_synthesis_model: str = "kimi-k3"
    tide_search_provider: str = "tavily"
    tavily_api_key: str = ""
    tavily_search_depth: str = "basic"
    tavily_max_results_per_query: int = 3
    tavily_country: str = "china"
    tide_search_lookback_days: int = 30
    openai_next_image_base_url: str = "https://draw.openai-next.com/v1"
    openai_next_image_api_key: str = ""
    openai_next_image_model: str = "gpt-image-2"
    provider_timeout_seconds: int = 120
    # Brand-direction and brand-visual jobs are persisted and run in the
    # background, so they can safely wait for slower model gateways.  `None`
    # (or a configured value of 0) deliberately disables the client deadline.
    brand_generation_timeout_seconds: int | None = None
    tide_refresh_interval_seconds: int = 60
    tide_source_verify_timeout_seconds: int = 12
    tide_source_max_results: int = 30

    model_config = SettingsConfigDict(
        # Resolve from the backend package instead of the process working
        # directory.  Uvicorn is commonly started from the repository root,
        # where a relative `.env` would otherwise be missed silently.
        env_file=Path(__file__).resolve().parents[2] / ".env",
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

    @field_validator("brand_generation_timeout_seconds", mode="before")
    @classmethod
    def normalize_brand_generation_timeout(cls, value: int | str | None) -> int | None:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        seconds = int(value)
        return seconds if seconds > 0 else None

    @property
    def resolved_image_api_key(self) -> str:
        return self.openai_next_image_api_key or self.openai_next_api_key

    @property
    def tide_configured(self) -> bool:
        return bool(self.tide_api_key and self.tavily_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
