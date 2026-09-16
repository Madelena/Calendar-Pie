from pathlib import Path
import os
import sqlite3

import pytest

from calendar_pie.storage import Store, ValidationError


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "private" / "calendar.sqlite3")


def add(store, **changes):
    return store.create_calendar({"name": "Work", "url": "http://localhost:5232/work.ics", **changes})


def snapshot(store, calendar, **changes):
    internal = store.get_calendar(calendar["id"], include_secrets=True)
    event = {"id": "event1", "title": "Meeting", "start": "2026-09-16T12:00:00+00:00",
             "end": "2026-09-16T13:00:00+00:00", "allDay": False, "location": "", "description": ""}
    args = dict(ics=b"calendar body", events=[event], window_start="2026-09-15T00:00:00+00:00",
                window_end="2026-09-23T00:00:00+00:00", at="2026-09-16T10:00:00+00:00",
                etag='"version1"', last_modified="today")
    args.update(changes)
    return store.replace_snapshot(calendar["id"], internal["revision"], **args)


def test_persistence_password_and_schema(store):
    calendar = add(store, password="private password")
    assert calendar["hasPassword"] is True
    assert "password" not in calendar and "ics" not in calendar
    restored = Store(store.db_path)
    assert restored.list_calendars() == [calendar]
    assert restored.get_calendar(calendar["id"], True)["password"] == "private password"
    with restored.connection() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    restored.update_calendar(calendar["id"], {"name": "New name"})
    assert restored.get_calendar(calendar["id"], True)["password"] == "private password"
    assert restored.update_calendar(calendar["id"], {"password": ""})["hasPassword"] is False


@pytest.mark.skipif(os.name == "nt", reason="POSIX filesystem permissions")
def test_private_files(store):
    assert Path(store.db_path).stat().st_mode & 0o777 == 0o600
    assert Path(store.db_path).parent.stat().st_mode & 0o777 == 0o700


@pytest.mark.parametrize("patch", [
    {"url": "file:///etc/passwd"}, {"url": "https://user:secret@example.com/feed"},
    {"url": "http://example.com:bad/feed"}, {"url": "https://example.com/#fragment"},
    {"url": "https://example.com/feed\nsecret"}, {"name": " "}, {"name": "x" * 201},
    {"enabled": "false"}, {"color": "red"}, {"refreshMinutes": 0},
    {"refreshMinutes": 1441}, {"refreshMinutes": True}, {"password": None}, {"unexpected": True},
])
def test_validates_config(store, patch):
    with pytest.raises(ValidationError):
        add(store, **patch)


def test_last_good_cache_survives_failure_and_name_change(store):
    calendar = add(store)
    assert snapshot(store, calendar)
    revision = store.get_calendar(calendar["id"], True)["revision"]
    assert store.record_failure(calendar["id"], revision, "2026-09-16T11:00:00+00:00", "Feed unavailable.")
    assert store.get_calendar(calendar["id"])["lastSuccess"] == "2026-09-16T10:00:00+00:00"
    assert store.get_calendar(calendar["id"])["lastError"] == "Feed unavailable."
    store.update_calendar(calendar["id"], {"name": "Renamed", "color": "#ffffff"})
    assert len(store.read_events("2026-09-16T00:00:00+00:00", "2026-09-17T00:00:00+00:00")) == 1


@pytest.mark.parametrize("patch", [{"url": "https://example.com/new"}, {"username": "new"}, {"password": "new"}])
def test_source_changes_clear_cache_and_block_stale_sync(store, patch):
    calendar = add(store)
    snapshot(store, calendar)
    old = store.get_calendar(calendar["id"], True)
    store.update_calendar(calendar["id"], patch)
    new = store.get_calendar(calendar["id"], True)
    assert all(new[field] is None for field in ("ics", "etag", "lastModified", "lastSuccess", "lastError"))
    assert store.read_events("2026-09-16T00:00:00+00:00", "2026-09-17T00:00:00+00:00") == []
    assert store.cache_range() is None
    assert not store.record_attempt(calendar["id"], old["revision"], "now")
    assert not store.record_failure(calendar["id"], old["revision"], "now", "Stale failure")
    assert not store.replace_snapshot(calendar["id"], old["revision"], b"stale", [], "a", "b", "now")


def test_event_range_enabled_sources_and_empty_replacement(store):
    calendar = add(store)
    snapshot(store, calendar)
    assert store.cache_range() == {"start": "2026-09-15T00:00:00+00:00", "end": "2026-09-23T00:00:00+00:00"}
    assert store.read_events("2026-09-16T13:00:00+00:00", "2026-09-17T00:00:00+00:00") == []
    store.update_calendar(calendar["id"], {"enabled": False})
    assert store.read_events("2026-09-16T00:00:00+00:00", "2026-09-17T00:00:00+00:00") == []
    assert store.cache_range() is None
    store.update_calendar(calendar["id"], {"enabled": True})
    snapshot(store, calendar, events=[])
    assert store.read_events("2026-09-16T00:00:00+00:00", "2026-09-17T00:00:00+00:00") == []


def test_delete_prevents_sync_resurrection(store):
    calendar = add(store)
    snapshot(store, calendar)
    revision = store.get_calendar(calendar["id"], True)["revision"]
    assert store.delete_calendar(calendar["id"])
    assert not store.replace_snapshot(calendar["id"], revision, b"stale", [], "a", "b", "now")
    assert store.list_calendars() == []
    with store.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


def test_failed_snapshot_rolls_back_cache_and_status_atomically(store):
    calendar = add(store)
    snapshot(store, calendar)
    before = store.get_calendar(calendar["id"], True)
    before_events = store.read_events("2026-09-16T00:00:00+00:00", "2026-09-17T00:00:00+00:00")
    bad_event = {"id": "duplicate", "start": "2026-09-16T12:00:00+00:00", "end": "2026-09-16T13:00:00+00:00"}
    with pytest.raises(sqlite3.IntegrityError):
        snapshot(store, calendar, ics=b"replacement", events=[bad_event, bad_event], at="later")
    assert store.get_calendar(calendar["id"], True) == before
    assert store.read_events("2026-09-16T00:00:00+00:00", "2026-09-17T00:00:00+00:00") == before_events


def test_all_day_events_excluded_and_cache_range_intersected(store):
    first = add(store)
    second = add(store, name="Personal")
    snapshot(store, first)
    assert store.cache_range() is None
    snapshot(store, second, window_start="2026-09-16T00:00:00+00:00", events=[{
        "id": "day", "title": "Birthday", "start": "2026-09-16T00:00:00+00:00",
        "end": "2026-09-17T00:00:00+00:00", "allDay": True}])
    assert store.cache_range()["start"] == "2026-09-16T00:00:00+00:00"
    assert len(store.read_events("2026-09-16T00:00:00+00:00", "2026-09-17T00:00:00+00:00")) == 1
