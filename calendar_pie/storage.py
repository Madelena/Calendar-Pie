"""Small SQLite repository with no shared cross-thread connections."""

from contextlib import contextmanager
from pathlib import Path
import os
import json
import re
import sqlite3
from urllib.parse import urlsplit
import uuid


class ValidationError(ValueError):
    """A safe, user-facing input error."""


PUBLIC_FIELDS = (
    "id", "name", "url", "username", "color", "enabled", "refreshMinutes",
    "lastAttempt", "lastSuccess", "lastError",
)
EDITABLE_FIELDS = {"name", "url", "username", "password", "color", "enabled", "refreshMinutes"}
DEFAULT_DISPLAY_SETTINGS = {
    "span": 12,
    "format": "12",
    "historyHours": 3,
    "theme": "light",
    "font": "inter",
    "accentColor": "#C30052",
}


def validate_display_settings(data, current=None):
    if not isinstance(data, dict):
        raise ValidationError("Expected a JSON object.")
    if set(data) - set(DEFAULT_DISPLAY_SETTINGS):
        raise ValidationError("Unknown display setting.")
    values = {**DEFAULT_DISPLAY_SETTINGS, **(current or {}), **data}
    if values["span"] not in (12, 24) or type(values["span"]) is not int:
        raise ValidationError("Dial span must be 12 or 24 hours.")
    if values["format"] not in ("12", "24"):
        raise ValidationError("Time format must be 12 or 24 hour.")
    if values["theme"] not in ("light", "dark"):
        raise ValidationError("Theme must be light or dark.")
    if values["font"] not in ("inter", "open-sans", "system"):
        raise ValidationError("Choose a bundled or system font.")
    if (type(values["historyHours"]) is not int
            or not 0 <= values["historyHours"] < values["span"]):
        raise ValidationError("History hours must fit within the dial span.")
    if (not isinstance(values["accentColor"], str)
            or re.fullmatch(r"#[0-9a-fA-F]{6}", values["accentColor"]) is None):
        raise ValidationError("Accent color must be a six-digit hex color.")
    values["accentColor"] = values["accentColor"].upper()
    return values


def validate_calendar(data, *, partial=False):
    if not isinstance(data, dict):
        raise ValidationError("Expected a JSON object.")
    if set(data) - EDITABLE_FIELDS:
        raise ValidationError("Unknown calendar field.")
    values = dict(data)
    if not partial:
        values = {"username": "", "password": "", "color": "#7c8cff", "enabled": True,
                  "refreshMinutes": 5, **values}
        if "name" not in values or "url" not in values:
            raise ValidationError("A calendar name and URL are required.")
    for field, limit in (("name", 200), ("url", 4096), ("username", 512), ("password", 4096)):
        if field not in values:
            continue
        value = values[field]
        if not isinstance(value, str) or len(value) > limit or "\x00" in value:
            raise ValidationError(f"Invalid {field}.")
        if field in ("name", "url"):
            value = value.strip()
            if not value:
                raise ValidationError(f"A calendar {field} is required.")
            values[field] = value
    if "url" in values:
        try:
            parts = urlsplit(values["url"])
            if (parts.scheme not in ("http", "https") or not parts.hostname
                    or parts.username is not None or parts.password is not None
                    or parts.fragment or any(c.isspace() or ord(c) < 32 for c in values["url"])):
                raise ValueError
            parts.port
        except ValueError:
            raise ValidationError("Use an HTTP or HTTPS URL without embedded credentials or a fragment.") from None
    if "color" in values and (not isinstance(values["color"], str)
                              or re.fullmatch(r"#[0-9a-fA-F]{6}", values["color"]) is None):
        raise ValidationError("Color must be a six-digit hex color.")
    if "enabled" in values and not isinstance(values["enabled"], bool):
        raise ValidationError("Enabled must be true or false.")
    if "refreshMinutes" in values and (type(values["refreshMinutes"]) is not int
                                      or not 1 <= values["refreshMinutes"] <= 1440):
        raise ValidationError("Refresh interval must be between 1 and 1440 minutes.")
    return values


class Store:
    def __init__(self, db_path):
        self.db_path = str(Path(db_path).resolve())
        directory = Path(self.db_path).parent
        directory_created = not directory.exists()
        directory.mkdir(parents=True, exist_ok=True)
        if os.name != "nt" and directory_created:
            directory.chmod(0o700)
        # Set permissions before SQLite writes any credentials.
        fd = os.open(self.db_path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        if os.name != "nt":
            os.chmod(self.db_path, 0o600)
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2):
                raise RuntimeError("Unsupported calendar database version.")
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS calendars (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
                username TEXT NOT NULL DEFAULT '', password TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
                refreshMinutes INTEGER NOT NULL DEFAULT 5,
                lastAttempt TEXT, lastSuccess TEXT, lastError TEXT,
                etag TEXT, lastModified TEXT, ics BLOB, revision INTEGER NOT NULL DEFAULT 1,
                windowStart TEXT, windowEnd TEXT
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS events (
                calendarId TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
                id TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
                allDay INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
                PRIMARY KEY(calendarId, id)
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS events_range ON events(start, end)")
            db.execute("""CREATE TABLE IF NOT EXISTS display_settings (
                id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1
            )""")
            db.execute("PRAGMA user_version=2")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _calendar(row, include_secrets=False):
        if row is None:
            return None
        result = dict(row) if include_secrets else {field: row[field] for field in PUBLIC_FIELDS}
        result["enabled"] = bool(row["enabled"])
        result["hasPassword"] = bool(row["password"]) if include_secrets else bool(row["hasPassword"])
        return result

    def list_calendars(self, include_secrets=False):
        with self.connection() as db:
            columns = "*" if include_secrets else ",".join(PUBLIC_FIELDS) + ",(password != '') AS hasPassword"
            return [self._calendar(row, include_secrets) for row in
                    db.execute(f"SELECT {columns} FROM calendars ORDER BY rowid")]

    def get_calendar(self, calendar_id, include_secrets=False):
        with self.connection() as db:
            columns = "*" if include_secrets else ",".join(PUBLIC_FIELDS) + ",(password != '') AS hasPassword"
            return self._calendar(db.execute(f"SELECT {columns} FROM calendars WHERE id=?", (calendar_id,)).fetchone(),
                                  include_secrets)

    def create_calendar(self, data):
        values = validate_calendar(data)
        values["id"] = uuid.uuid4().hex
        fields = list(values)
        with self.connection() as db:
            db.execute(f"INSERT INTO calendars ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})",
                       [values[field] for field in fields])
        return self.get_calendar(values["id"])

    def update_calendar(self, calendar_id, data):
        values = validate_calendar(data, partial=True)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM calendars WHERE id=?", (calendar_id,)).fetchone()
            if old is None:
                return None
            if any(field in values and values[field] != old[field] for field in ("url", "username", "password")):
                values.update(etag=None, lastModified=None, ics=None, lastSuccess=None, lastAttempt=None,
                              lastError=None, windowStart=None, windowEnd=None)
                db.execute("DELETE FROM events WHERE calendarId=?", (calendar_id,))
            if values:
                fields = list(values)
                db.execute(f"UPDATE calendars SET {','.join(field + '=?' for field in fields)}, revision=revision+1 WHERE id=?",
                           [values[field] for field in fields] + [calendar_id])
        return self.get_calendar(calendar_id)

    def delete_calendar(self, calendar_id):
        with self.connection() as db:
            return db.execute("DELETE FROM calendars WHERE id=?", (calendar_id,)).rowcount > 0

    def get_display_settings(self):
        with self.connection() as db:
            row = db.execute("SELECT payload, revision FROM display_settings WHERE id=1").fetchone()
            if row is None:
                return {"settings": dict(DEFAULT_DISPLAY_SETTINGS), "revision": 0}
            return {"settings": validate_display_settings(json.loads(row["payload"])),
                    "revision": row["revision"]}

    def update_display_settings(self, data):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload, revision FROM display_settings WHERE id=1").fetchone()
            current = json.loads(row["payload"]) if row is not None else DEFAULT_DISPLAY_SETTINGS
            settings = validate_display_settings(data, current)
            revision = row["revision"] + 1 if row is not None else 1
            db.execute("""INSERT INTO display_settings(id, payload, revision) VALUES(1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, revision=excluded.revision""",
                       (json.dumps(settings, separators=(",", ":")), revision))
            return {"settings": settings, "revision": revision}

    def record_attempt(self, calendar_id, revision, at):
        with self.connection() as db:
            return db.execute("UPDATE calendars SET lastAttempt=? WHERE id=? AND revision=?",
                              (at, calendar_id, revision)).rowcount > 0

    def record_failure(self, calendar_id, revision, at, safe_message):
        with self.connection() as db:
            return db.execute("UPDATE calendars SET lastAttempt=?, lastError=? WHERE id=? AND revision=?",
                              (at, safe_message, calendar_id, revision)).rowcount > 0

    def replace_snapshot(self, calendar_id, revision, ics, events, window_start, window_end,
                         at, etag=None, last_modified=None):
        with self.connection() as db:
            changed = db.execute("""UPDATE calendars SET ics=?, windowStart=?, windowEnd=?,
                lastSuccess=?, lastAttempt=?, lastError=NULL, etag=?, lastModified=?
                WHERE id=? AND revision=?""",
                (ics, window_start, window_end, at, at, etag, last_modified, calendar_id, revision)).rowcount
            if not changed:
                return False
            db.execute("DELETE FROM events WHERE calendarId=?", (calendar_id,))
            for event in events:
                payload = {field: event.get(field, "") for field in
                           ("id", "title", "start", "end", "location", "description")}
                payload.update(calendarId=calendar_id, allDay=bool(event.get("allDay", False)))
                db.execute("INSERT INTO events(calendarId,id,start,end,allDay,payload) VALUES(?,?,?,?,?,?)",
                           (calendar_id, payload["id"], payload["start"], payload["end"],
                            payload["allDay"], json.dumps(payload)))
            return True

    def read_events(self, start, end):
        with self.connection() as db:
            rows = db.execute("""SELECT e.payload FROM events e JOIN calendars c ON c.id=e.calendarId
                WHERE c.enabled=1 AND e.allDay=0 AND e.start < ? AND e.end > ?
                ORDER BY e.start, e.end, e.id""", (end, start))
            return [json.loads(row["payload"]) for row in rows]

    def cache_range(self):
        with self.connection() as db:
            rows = db.execute("SELECT windowStart, windowEnd FROM calendars WHERE enabled=1").fetchall()
            if not rows or any(row["windowStart"] is None or row["windowEnd"] is None for row in rows):
                return None
            start = max(row["windowStart"] for row in rows)
            end = min(row["windowEnd"] for row in rows)
            return {"start": start, "end": end} if start < end else None
