import httpx

from app.core.config import Settings, settings
from app.fieldwork.store import connect, initialize_database
from app.services.providers import provider
from app.services import workflow


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


def test_generation_limits_are_unbounded_in_the_test_default() -> None:
    configured = Settings(tide_search_limit=0, launch_generation_limit=0, launch_regeneration_limit=0)
    assert configured.tide_search_limit is None
    assert configured.launch_generation_limit is None
    assert configured.launch_regeneration_limit is None


def test_image_auth_failure_can_be_retried_after_configuration_is_fixed(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "retry.db"))
    initialize_database()
    task, _ = workflow.create_task("test-project", "logo_generation", {}, "retry-image-auth")
    with connect() as connection:
        connection.execute(
            "UPDATE tasks SET status = 'failed', retriable = 0, error_code = 'image_auth_failed' WHERE id = ?",
            (task["id"],),
        )
    submitted: list[str] = []
    monkeypatch.setattr(workflow, "submit_task", submitted.append)

    retried = workflow.retry_task(task["id"])

    assert retried is not None
    assert retried["status"] == "queued"
    assert retried["retriable"] == 1
    assert submitted == [task["id"]]
