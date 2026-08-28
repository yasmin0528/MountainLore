import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.core.config import settings


def now() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return str(uuid4())


def initialize_database() -> None:
    database = Path(settings.database_path)
    database.parent.mkdir(parents=True, exist_ok=True)
    Path(settings.media_directory).mkdir(parents=True, exist_ok=True)
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS visitors (
              id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
              expires_at TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, brand_name TEXT NOT NULL,
              industry TEXT NOT NULL, core_product TEXT NOT NULL, origin TEXT NOT NULL,
              category TEXT, consent_at TEXT NOT NULL, status TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY, project_id TEXT UNIQUE NOT NULL, sequence INTEGER NOT NULL,
              status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
              content TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS media_assets (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, storage_key TEXT NOT NULL,
              original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS field_notes (
              id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
              summary TEXT NOT NULL, media_asset_ids_json TEXT NOT NULL, sequence INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS candidates (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, field_note_ids_json TEXT NOT NULL,
              type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS archive_cards (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT UNIQUE NOT NULL,
              type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
              result_json TEXT NOT NULL, error_code TEXT, idempotency_key TEXT UNIQUE,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            """
        )


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(settings.database_path)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def json_value(value: list[str] | dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False)


def decode_record(record: dict[str, Any]) -> dict[str, Any]:
    for key in ("media_asset_ids_json", "field_note_ids_json", "result_json"):
        if key in record:
            record[key.removesuffix("_json")] = json.loads(record.pop(key))
    return record


def visitor_expiry() -> str:
    return (datetime.now(UTC) + timedelta(days=settings.visitor_ttl_days)).isoformat()
