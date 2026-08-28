from fastapi.testclient import TestClient

from app.main import app


def test_health_check_returns_service_status() -> None:
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "MountainLore API"
    assert payload["timestamp"].endswith("Z") or "+00:00" in payload["timestamp"]
