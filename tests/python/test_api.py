import pytest

from calendar_pie.app import create_app


@pytest.fixture
def app(tmp_path):
    app = create_app(tmp_path / "calendar.sqlite3", timezone="America/New_York", static_dir=tmp_path / "dist")
    app.testing = True
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def create(client, **fields):
    return client.post("/api/calendars", json={"name": "Work", "url": "http://localhost:5232/work.ics", **fields})


def test_health_crud_and_secret_omission(client, app):
    assert client.get("/api/health").json == {"status": "ok", "timezone": "America/New_York"}
    response = create(client, username="user", password="secret-value")
    assert response.status_code == 201
    calendar = response.json["calendar"]
    assert calendar["hasPassword"] is True
    assert b"secret-value" not in response.data
    assert "password" not in calendar
    calendar_id = calendar["id"]
    assert client.get("/api/calendars").json == {"calendars": [calendar]}
    changed = client.patch(f"/api/calendars/{calendar_id}", json={"color": "#ABCDEF"})
    assert changed.json["calendar"]["hasPassword"] is True
    assert client.post(f"/api/calendars/{calendar_id}/refresh", json={}).status_code == 202
    assert client.post("/api/refresh", json={}).json == {"queued": True}
    assert client.delete(f"/api/calendars/{calendar_id}").status_code == 204
    assert client.get("/api/calendars").json == {"calendars": []}
    assert client.patch(f"/api/calendars/{calendar_id}", json={"name": "gone"}).status_code == 404
    assert client.post(f"/api/calendars/{calendar_id}/refresh", json={}).status_code == 404


def test_display_settings_persist_and_validate(client):
    defaults = {"span": 12, "format": "12", "historyHours": 3, "theme": "light",
                "font": "inter", "accentColor": "#C30052"}
    assert client.get("/api/settings").json == {"settings": defaults, "revision": 0}
    changed = client.patch("/api/settings", json={"theme": "dark", "accentColor": "#abcdef"})
    assert changed.status_code == 200
    assert changed.json == {"settings": {**defaults, "theme": "dark", "accentColor": "#ABCDEF"},
                            "revision": 1}
    assert client.get("/api/settings").json == changed.json
    assert client.patch("/api/settings", json={"span": 12, "historyHours": 12}).status_code == 400
    assert client.patch("/api/settings", json={"font": "custom"}).status_code == 400
    assert client.patch("/api/settings", json={"unexpected": True}).status_code == 400


@pytest.mark.parametrize("host", ["evil.example", "localhost.evil.example", "192.168.1.2", "127.0.0.2"])
def test_rejects_non_loopback_hosts(client, host):
    assert client.get("/api/calendars", headers={"Host": host}).status_code == 403


@pytest.mark.parametrize("host", ["localhost:8765", "127.0.0.1:8765", "[::1]:8765"])
def test_accepts_loopback_hosts(client, host):
    assert client.get("/api/health", headers={"Host": host}).status_code == 200


@pytest.mark.parametrize("host", ["192.168.56.89:8765", "10.0.0.2", "[fd00::1234]:8765"])
def test_lan_mode_accepts_literal_ip_hosts(tmp_path, host):
    app = create_app(tmp_path / "lan.sqlite3", allow_lan=True)
    app.testing = True
    assert app.test_client().get("/api/health", headers={"Host": host}).status_code == 200


@pytest.mark.parametrize("host", ["evil.example", "calendar-pie.local", "192.168.1.2.evil.example"])
def test_lan_mode_rejects_named_hosts(tmp_path, host):
    app = create_app(tmp_path / "lan.sqlite3", allow_lan=True)
    app.testing = True
    assert app.test_client().get("/api/health", headers={"Host": host}).status_code == 403


def test_csrf_and_json_guard(client):
    assert client.post("/api/refresh", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/refresh", json={}, headers={"Origin": "null"}).status_code == 403
    assert client.post("/api/refresh", json={}, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.post("/api/refresh", json={}, headers={"Origin": "http://localhost"}).status_code == 202
    assert client.post("/api/refresh", data="{}", content_type="text/plain").status_code == 415
    assert client.post("/api/refresh", data="{bad", content_type="application/json").status_code == 400
    assert client.post("/api/refresh", json=[]).status_code == 400


def test_safe_validation_errors(client):
    response = create(client, url="https://private-user:private-password@example.com/feed")
    assert response.status_code == 400
    assert b"private-user" not in response.data and b"private-password" not in response.data
    assert create(client, password="x" * 20000).status_code == 413
    assert client.get("/api/not-found").status_code == 404


@pytest.mark.parametrize("query", [
    "start=invalid&end=invalid", "start=2026-09-16&end=2026-09-17",
    "start=2026-09-16T00:00:00Z", "start=2026-09-17T00:00:00Z&end=2026-09-16T00:00:00Z",
    "start=2026-09-01T00:00:00Z&end=2026-11-01T00:00:00Z",
])
def test_bad_event_ranges(client, query):
    assert client.get("/api/events?" + query).status_code == 400


def test_events_return_cache_timezone_and_canonical_range(client, app):
    calendar_id = create(client, password="top-secret").json["calendar"]["id"]
    store = app.extensions["calendar_store"]
    revision = store.get_calendar(calendar_id, True)["revision"]
    store.replace_snapshot(calendar_id, revision, b"secret ics", [{"id": "1", "title": "Meeting",
        "start": "2026-09-16T12:00:00+00:00", "end": "2026-09-16T13:00:00+00:00", "allDay": False}],
        "2026-09-15T00:00:00+00:00", "2026-09-23T00:00:00+00:00", "2026-09-16T10:00:00+00:00")
    response = client.get("/api/events", query_string={"start": "2026-09-16T06:00:00-04:00", "end": "2026-09-17T06:00:00-04:00"})
    assert response.status_code == 200
    assert response.json["range"]["start"] == "2026-09-16T10:00:00+00:00"
    assert response.json["events"][0]["calendarId"] == calendar_id
    assert response.json["timezone"] == "America/New_York"
    assert response.json["cacheRange"]["end"] == "2026-09-23T00:00:00+00:00"
    assert b"top-secret" not in response.data and b"secret ics" not in response.data
    assert "url" not in response.json["calendars"][0]
    assert client.get("/api/events").status_code == 200


def test_mutations_queue_worker(client, app):
    class Worker:
        def __init__(self):
            self.calls = []

        def request_refresh(self, calendar_id=None):
            self.calls.append(calendar_id)

    worker = Worker()
    app.extensions["calendar_sync"] = worker
    calendar_id = create(client).json["calendar"]["id"]
    client.patch(f"/api/calendars/{calendar_id}", json={"name": "Renamed"})
    client.post("/api/refresh", json={})
    assert worker.calls == [calendar_id, calendar_id, None]
