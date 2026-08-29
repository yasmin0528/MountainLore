import httpx

from app.core.config import Settings, settings
from app.services.providers import provider


def test_brand_generation_timeout_is_unbounded_by_default() -> None:
    assert Settings().brand_generation_timeout_seconds is None


def test_brand_generation_timeout_accepts_zero_as_unbounded(monkeypatch) -> None:
    monkeypatch.setattr(settings, "brand_generation_timeout_seconds", 0)
    assert provider.brand_generation_timeout is None


def test_brand_generation_timeout_can_be_capped_by_deployment(monkeypatch) -> None:
    monkeypatch.setattr(settings, "brand_generation_timeout_seconds", 360)
    timeout = provider.brand_generation_timeout
    assert isinstance(timeout, httpx.Timeout)
    assert timeout.connect == 360
    assert timeout.read == 360
