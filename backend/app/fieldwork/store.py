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
        _retire_incompatible_tables(connection)
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
            CREATE TABLE IF NOT EXISTS source_records (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, field_note_id TEXT,
              media_asset_id TEXT, source_type TEXT NOT NULL, source_ref TEXT NOT NULL,
              content TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS claims (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, field_note_id TEXT,
              statement TEXT NOT NULL, claim_type TEXT NOT NULL, status TEXT NOT NULL,
              risk TEXT NOT NULL, public_allowed INTEGER NOT NULL DEFAULT 0,
              source_record_ids_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS archive_card_claims (
              archive_card_id TEXT NOT NULL, claim_id TEXT NOT NULL,
              PRIMARY KEY (archive_card_id, claim_id)
            );
            CREATE TABLE IF NOT EXISTS brand_directions (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version INTEGER NOT NULL,
              route_no INTEGER NOT NULL, state TEXT NOT NULL, title TEXT NOT NULL,
              content_json TEXT NOT NULL, input_snapshot_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS brand_manuals (
              id TEXT PRIMARY KEY, project_id TEXT UNIQUE NOT NULL, direction_id TEXT NOT NULL,
              content_json TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS manual_versions (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, direction_id TEXT NOT NULL,
              version INTEGER NOT NULL, generated_snapshot_json TEXT NOT NULL,
              content_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL, UNIQUE(project_id, version)
            );
            CREATE TABLE IF NOT EXISTS manual_assets (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, manual_version_id TEXT NOT NULL,
              kind TEXT NOT NULL, media_asset_id TEXT, metadata_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS exports (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, manual_version_id TEXT NOT NULL,
              format TEXT NOT NULL, storage_key TEXT, status TEXT NOT NULL,
              error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS share_snapshots (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, manual_version_id TEXT NOT NULL,
              token_hash TEXT UNIQUE NOT NULL, snapshot_json TEXT NOT NULL,
              revoked_at TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tide_searches (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
              query_text TEXT NOT NULL, error_code TEXT, created_at TEXT NOT NULL, completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS inspiration_cards (
              id TEXT PRIMARY KEY, tide_search_id TEXT NOT NULL, theme TEXT NOT NULL,
              content_motif TEXT NOT NULL, source_url TEXT NOT NULL, source_title TEXT NOT NULL,
              published_at TEXT, fit_reason TEXT NOT NULL, risk_note TEXT NOT NULL,
              verified_at TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS generation_jobs (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, root_job_id TEXT,
              regenerate_of_job_id TEXT, template_type TEXT NOT NULL, status TEXT NOT NULL,
              input_snapshot_json TEXT NOT NULL, result_json TEXT NOT NULL, error_code TEXT,
              regeneration_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS generation_previews (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, template_type TEXT NOT NULL,
              inspiration_text TEXT NOT NULL, input_snapshot_json TEXT NOT NULL,
              result_json TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tide_editions (
              id TEXT PRIMARY KEY, week_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL,
              error_code TEXT, created_at TEXT NOT NULL, completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS tide_report_sources (
              id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, channel TEXT NOT NULL,
              publisher TEXT NOT NULL, source_url TEXT NOT NULL, source_title TEXT NOT NULL,
              published_at TEXT, source_excerpt TEXT NOT NULL DEFAULT '', captured_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tide_report_ideas (
              id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, theme TEXT NOT NULL,
              content_motif TEXT NOT NULL, applicable_scene TEXT NOT NULL,
              festival_context TEXT NOT NULL, risk_note TEXT NOT NULL,
              source_ids_json TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_tide_idea_preferences (
              project_id TEXT NOT NULL, idea_id TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
              used_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, idea_id)
            );
            CREATE TABLE IF NOT EXISTS tide_refresh_locks (
              week_key TEXT PRIMARY KEY, status TEXT NOT NULL, acquired_at TEXT NOT NULL,
              completed_at TEXT, error_code TEXT
            );
            """
        )
        # ``CREATE TABLE IF NOT EXISTS`` does not evolve an existing SQLite
        # table.  Early demo databases predate visitor-owned projects, which
        # otherwise makes POST /projects fail with a raw sqlite 500.
        # Keep the new column nullable so those historical, unowned rows stay
        # readable for inspection; every newly created project receives the
        # current visitor id.
        _ensure_column(connection, "projects", "visitor_id", "TEXT")
        # The earliest local demo database also predates the optional product
        # category field.  Creating a new project must migrate that database
        # before inserting the submitted category, instead of leaking SQLite's
        # raw "no column named category" error as a 500 to the browser.
        _ensure_column(connection, "projects", "category", "TEXT")
        _ensure_column(connection, "projects", "consent_at", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(connection, "projects", "status", "TEXT NOT NULL DEFAULT 'draft'")
        _ensure_column(connection, "projects", "current_stage", "TEXT NOT NULL DEFAULT 'fieldwork'")
        _ensure_column(connection, "projects", "current_direction_id", "TEXT")
        _ensure_column(connection, "projects", "tide_search_used", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "projects", "launch_used", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "archive_cards", "updated_at", "TEXT")
        _ensure_column(connection, "archive_cards", "content_version", "INTEGER NOT NULL DEFAULT 1")
        _ensure_column(connection, "archive_cards", "source_summary", "TEXT")
        _ensure_column(connection, "tide_report_sources", "source_excerpt", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(connection, "media_assets", "kind", "TEXT NOT NULL DEFAULT 'upload'")
        _ensure_column(connection, "media_assets", "metadata_json", "TEXT NOT NULL DEFAULT '{}'")
        _ensure_column(connection, "tasks", "input_snapshot_json", "TEXT NOT NULL DEFAULT '{}'")
        _ensure_column(connection, "tasks", "progress", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "tasks", "attempt", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "tasks", "retriable", "INTEGER NOT NULL DEFAULT 1")
        _ensure_column(connection, "tasks", "parent_task_id", "TEXT")
        _ensure_column(connection, "brand_manuals", "current_version_id", "TEXT")
        _ensure_column(connection, "brand_manuals", "generated_snapshot_json", "TEXT NOT NULL DEFAULT '{}'")
        _migrate_legacy_archive_claims(connection)


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _retire_incompatible_tables(connection: sqlite3.Connection) -> None:
    """Preserve pre-MVP prototype tables whose names collide with current tables.

    The project was previously backed by a different SQLAlchemy schema. SQLite
    keeps an old table when ``CREATE TABLE IF NOT EXISTS`` is used, even when
    its columns no longer match the fieldwork store. Moving those tables aside
    is safer than dropping them and lets the current API create its own schema.
    """
    required_columns: dict[str, set[str]] = {
        "projects": {"id", "visitor_id", "brand_name", "industry", "core_product", "origin", "category", "consent_at", "status", "created_at", "updated_at"},
        "sessions": {"id", "project_id", "sequence", "status", "started_at", "ended_at"},
        "messages": {"id", "session_id", "role", "content", "sequence", "created_at"},
        "media_assets": {"id", "project_id", "storage_key", "original_name", "mime_type", "size_bytes", "created_at"},
        "field_notes": {"id", "session_id", "type", "title", "summary", "media_asset_ids_json", "sequence", "created_at"},
        "candidates": {"id", "project_id", "field_note_ids_json", "type", "title", "content", "status", "created_at"},
        "archive_cards": {"id", "project_id", "candidate_id", "type", "title", "content", "status", "created_at"},
        "tasks": {"id", "project_id", "kind", "status", "result_json", "created_at", "updated_at"},
        "source_records": {"id", "project_id", "field_note_id", "media_asset_id", "source_type", "source_ref", "content", "created_at"},
        "claims": {"id", "project_id", "field_note_id", "statement", "claim_type", "status", "risk", "public_allowed", "source_record_ids_json", "created_at", "updated_at"},
        "archive_card_claims": {"archive_card_id", "claim_id"},
        "brand_directions": {"id", "project_id", "version", "route_no", "state", "title", "content_json", "input_snapshot_json", "created_at"},
        "brand_manuals": {"id", "project_id", "direction_id", "content_json", "updated_at"},
        "manual_versions": {"id", "project_id", "direction_id", "version", "generated_snapshot_json", "content_json", "status", "created_at", "updated_at"},
        "manual_assets": {"id", "project_id", "manual_version_id", "kind", "media_asset_id", "metadata_json", "created_at"},
        "exports": {"id", "project_id", "manual_version_id", "format", "storage_key", "status", "created_at", "updated_at"},
        "share_snapshots": {"id", "project_id", "manual_version_id", "token_hash", "snapshot_json", "created_at"},
        "tide_searches": {"id", "project_id", "status", "query_text", "created_at"},
        "inspiration_cards": {"id", "tide_search_id", "theme", "content_motif", "source_url", "source_title", "fit_reason", "risk_note", "verified_at", "favorite"},
        "generation_jobs": {"id", "project_id", "template_type", "status", "input_snapshot_json", "result_json", "created_at", "updated_at"},
        "generation_previews": {"id", "project_id", "template_type", "inspiration_text", "input_snapshot_json", "result_json", "status", "created_at", "updated_at"},
        "tide_editions": {"id", "week_key", "status", "created_at"},
        "tide_report_sources": {"id", "edition_id", "channel", "publisher", "source_url", "source_title", "captured_at"},
        "tide_report_ideas": {"id", "edition_id", "theme", "content_motif", "applicable_scene", "festival_context", "risk_note", "source_ids_json", "created_at"},
        "project_tide_idea_preferences": {"project_id", "idea_id", "favorite", "updated_at"},
        "tide_refresh_locks": {"week_key", "status", "acquired_at"},
    }
    existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    for table, required in required_columns.items():
        if table not in existing:
            continue
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        if required.issubset(columns):
            continue
        legacy_name = f"legacy_{table}_{uuid4().hex[:8]}"
        connection.execute(f'ALTER TABLE "{table}" RENAME TO "{legacy_name}"')


def _migrate_legacy_archive_claims(connection: sqlite3.Connection) -> None:
    """Make old archive prose traceable without silently approving it for publication."""
    cards = connection.execute(
        """SELECT archive_cards.* FROM archive_cards
           LEFT JOIN archive_card_claims ON archive_card_claims.archive_card_id = archive_cards.id
           WHERE archive_card_claims.archive_card_id IS NULL"""
    ).fetchall()
    for card in cards:
        source_id = f"legacy-source-{card['id']}"
        claim_id = f"legacy-claim-{card['id']}"
        timestamp = card["created_at"] or now()
        connection.execute(
            """INSERT OR IGNORE INTO source_records
               (id, project_id, field_note_id, media_asset_id, source_type, source_ref, content, created_at)
               VALUES (?, ?, NULL, NULL, 'legacy_import', ?, ?, ?)""",
            (source_id, card["project_id"], card["id"], card["content"], timestamp),
        )
        connection.execute(
            """INSERT OR IGNORE INTO claims
               (id, project_id, field_note_id, statement, claim_type, status, risk,
                public_allowed, source_record_ids_json, created_at, updated_at)
               VALUES (?, ?, NULL, ?, 'legacy', 'pending', 'unknown', 0, ?, ?, ?)""",
            (claim_id, card["project_id"], card["content"], json_value([source_id]), timestamp, timestamp),
        )
        connection.execute(
            "INSERT OR IGNORE INTO archive_card_claims (archive_card_id, claim_id) VALUES (?, ?)",
            (card["id"], claim_id),
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
    for key in (
        "media_asset_ids_json", "field_note_ids_json", "source_record_ids_json",
        "result_json", "content_json", "input_snapshot_json", "generated_snapshot_json",
        "metadata_json", "snapshot_json",
        "source_ids_json",
    ):
        if key in record:
            raw = record.pop(key)
            try:
                record[key.removesuffix("_json")] = json.loads(raw or "{}")
            except (TypeError, json.JSONDecodeError):
                record[key.removesuffix("_json")] = {}
    return record


def visitor_expiry() -> str:
    return (datetime.now(UTC) + timedelta(days=settings.visitor_ttl_days)).isoformat()
