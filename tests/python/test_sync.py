import base64
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
from unittest.mock import MagicMock

import pytest
import requests
from urllib3.exceptions import ReadTimeoutError

from calendar_pie import sync
from calendar_pie.ingest import FeedError, MAX_ICS_BYTES
from calendar_pie.storage import Store
from calendar_pie.sync import SyncService, download

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:daily
DTSTART:20260301T120000Z
DURATION:PT1H
RRULE:FREQ=DAILY
SUMMARY:Daily event
END:VEVENT
END:VCALENDAR
"""


@pytest.fixture
def server():
    state = {"requests": [], "body": ICS, "status": 200, "conditional": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            state["requests"].append((self.path, dict(self.headers)))
            if self.path.startswith("/auth") and self.headers.get("Authorization") != "Basic " + base64.b64encode(b"user:secret").decode():
                self.send_response(401)
                self.end_headers()
                return
            if self.path.startswith("/redirect"):
                self.send_response(302)
                self.send_header("Location", "/auth")
                self.end_headers()
                return
            if self.path.startswith("/large"):
                self.send_response(200)
                self.send_header("Content-Length", str(MAX_ICS_BYTES + 1))
                self.end_headers()
                return
            if state["conditional"] and self.headers.get("If-None-Match") == '"v1"':
                self.send_response(304)
                self.end_headers()
                return
            self.send_response(state["status"])
            self.send_header("ETag", '"v1"')
            self.send_header("Last-Modified", "Sun, 01 Mar 2026 12:00:00 GMT")
            self.end_headers()
            if self.path.startswith("/slow"):
                try:
                    for _ in range(100):
                        self.wfile.write(b"x")
                        self.wfile.flush()
                        time.sleep(0.05)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self.wfile.write(state["body"])

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}", state
    httpd.shutdown()
    httpd.server_close()
    thread.join()


def source(store, url, **extra):
    created = store.create_calendar({"name": "Test", "url": url, **extra})
    return store.get_calendar(created["id"], include_secrets=True)


def events(store):
    return store.read_events("2026-01-01T00:00:00+00:00", "2027-01-01T00:00:00+00:00")


def test_http_200_auth_and_304_reexpand_rolling_window(server, tmp_path):
    url, state = server
    store = Store(tmp_path / "calendar.sqlite")
    item = source(store, url + "/auth", username="user", password="secret")
    now = [datetime(2026, 3, 7, 12, tzinfo=timezone.utc)]
    service = SyncService(store, "America/New_York", clock=lambda: now[0])
    service._sync(item)
    first = events(store)
    assert len(first) == 9
    good = store.get_calendar(item["id"], include_secrets=True)
    assert good["lastError"] is None
    assert good["etag"] == '"v1"'
    assert good["windowStart"] == "2026-03-06T05:00:00+00:00"
    state["conditional"] = True
    now[0] += timedelta(days=2)
    service._sync(good)
    second = events(store)
    assert len(second) == 9
    assert first[0]["id"] != second[0]["id"]
    assert first[-1]["id"] in {event["id"] for event in second}
    assert state["requests"][-1][1]["If-None-Match"] == '"v1"'
    assert state["requests"][-1][1]["If-Modified-Since"] == good["lastModified"]


def test_same_200_body_is_reexpanded_and_bad_feed_preserves_snapshot(server, tmp_path):
    url, state = server
    store = Store(tmp_path / "calendar.sqlite")
    item = source(store, url)
    now = [datetime(2026, 3, 7, 12, tzinfo=timezone.utc)]
    service = SyncService(store, "UTC", clock=lambda: now[0])
    service._sync(item)
    first = events(store)
    now[0] += timedelta(days=1)
    service._sync(store.get_calendar(item["id"], include_secrets=True))
    second = events(store)
    assert first[0]["id"] != second[0]["id"]
    good = store.get_calendar(item["id"], include_secrets=True)
    state["body"] = b"<html>Sign in with secret</html>"
    service._sync(good)
    failed = store.get_calendar(item["id"], include_secrets=True)
    assert failed["lastSuccess"] == good["lastSuccess"]
    assert failed["ics"] == ICS
    assert failed["lastError"]
    assert "secret" not in failed["lastError"]
    assert events(store) == second
    state["status"] = 500
    service._sync(failed)
    assert events(store) == second


@pytest.mark.parametrize("path,message", [("/auth", "authentication"), ("/redirect", "redirects"), ("/large", "10 MiB")])
def test_http_errors_and_size_limit_do_not_leak_credentials(server, path, message):
    url, state = server
    with pytest.raises(FeedError, match=message) as error:
        download({"url": url + path + "?token=private", "username": "wrong", "password": "secret"})
    assert "private" not in str(error.value)
    assert "secret" not in str(error.value)
    assert len(state["requests"]) == 1


def test_streamed_body_size_limit(server):
    url, state = server
    state["body"] = b"x" * (MAX_ICS_BYTES + 1)
    with pytest.raises(FeedError, match="10 MiB"):
        download({"url": url})


def mock_session(monkeypatch):
    session = MagicMock()
    session.__enter__.return_value = session
    monkeypatch.setattr(requests, "Session", lambda: session)
    return session


def test_download_allows_slower_response_headers(monkeypatch):
    session = mock_session(monkeypatch)
    response = session.get.return_value.__enter__.return_value
    response.status_code = 200
    response.headers = {}

    def get_response(*args, **kwargs):
        # A feed taking nine seconds to generate exceeds the old read timeout.
        if kwargs["timeout"][1] < 9:
            raise requests.ReadTimeout("slow feed")
        return session.get.return_value

    session.get.side_effect = get_response
    response.iter_content.return_value = [ICS]
    assert sync._download({"url": "https://calendar.example/feed"}) == (200, ICS, None, None)
    assert session.get.call_args.kwargs["timeout"] == (5, 15)
    assert session.trust_env is False
    assert session.get.call_args.kwargs["verify"] is True
    assert session.get.call_args.kwargs["allow_redirects"] is False


@pytest.mark.parametrize("exception_type,message", [
    (requests.ConnectTimeout, "timed out"),
    (requests.ReadTimeout, "timed out"),
    (requests.exceptions.SSLError, "TLS connection failed"),
    (requests.ConnectionError, "could not be reached"),
    (requests.exceptions.ChunkedEncodingError, "interrupted"),
    (requests.exceptions.ContentDecodingError, "response was invalid"),
    (requests.RequestException, "could not be downloaded"),
])
def test_download_transport_errors_are_specific_and_redacted(monkeypatch, exception_type, message):
    session = mock_session(monkeypatch)
    private_url = "https://calendar.example/feed?token=private"
    session.get.side_effect = exception_type(f"{private_url} username=user password=secret")
    with pytest.raises(FeedError, match=message) as error:
        sync._download({"url": private_url, "username": "user", "password": "secret"})
    assert "private" not in str(error.value)
    assert "secret" not in str(error.value)
    assert "calendar.example" not in str(error.value)


def test_stream_read_timeout_is_reported_safely_and_preserves_snapshot(monkeypatch, tmp_path):
    store = Store(tmp_path / "calendar.sqlite")
    item = source(store, "https://calendar.example/feed?token=private", password="secret")
    now = [datetime(2026, 3, 7, 12, tzinfo=timezone.utc)]
    service = SyncService(store, "UTC", fetch=lambda _: (200, ICS, '"v1"', None), clock=lambda: now[0])
    service._sync(item)
    good = store.get_calendar(item["id"], include_secrets=True)
    previous_events = events(store)
    session = mock_session(monkeypatch)
    response = session.get.return_value.__enter__.return_value
    response.status_code = 200
    response.headers = {}

    def interrupted_body(**kwargs):
        yield ICS[:10]
        raise requests.ConnectionError(ReadTimeoutError(None, item["url"], "password=secret"))

    response.iter_content.side_effect = interrupted_body
    service._fetch = sync._download
    now[0] += timedelta(minutes=5)
    service._sync(good)
    failed = store.get_calendar(item["id"], include_secrets=True)
    assert failed["lastError"] == "Calendar download timed out. Try refreshing again."
    assert failed["lastSuccess"] == good["lastSuccess"]
    assert failed["ics"] == good["ics"]
    assert failed["etag"] == good["etag"]
    assert failed["lastAttempt"] != good["lastAttempt"]
    assert events(store) == previous_events


def test_slow_stream_has_absolute_deadline(server, monkeypatch):
    url, _ = server
    monkeypatch.setattr(sync, "FETCH_TIMEOUT", 0.8)
    began = time.monotonic()
    with pytest.raises(FeedError, match="timed out"):
        download({"url": url + "/slow"})
    assert time.monotonic() - began < 3


def test_background_refresh_skips_disabled_and_manual_wakes(server, tmp_path):
    url, state = server
    store = Store(tmp_path / "calendar.sqlite")
    item = source(store, url)
    source(store, url + "/disabled", enabled=False)
    service = SyncService(store, "UTC", clock=lambda: datetime(2026, 3, 7, tzinfo=timezone.utc))
    service.start()
    try:
        deadline = time.monotonic() + 10
        while store.get_calendar(item["id"])["lastSuccess"] is None and time.monotonic() < deadline:
            time.sleep(0.05)
        assert len(events(store)) == 9
        service.request_refresh(item["id"])
        deadline = time.monotonic() + 10
        while len(state["requests"]) < 2 and time.monotonic() < deadline:
            time.sleep(0.05)
        assert len(state["requests"]) == 2
        assert all("disabled" not in path for path, _ in state["requests"])
    finally:
        service.stop()


def test_inflight_edit_rejects_old_snapshot(tmp_path):
    store = Store(tmp_path / "calendar.sqlite")
    item = source(store, "http://127.0.0.1/feed")

    def fetch(_):
        store.update_calendar(item["id"], {"enabled": False})
        return 200, ICS, None, None

    service = SyncService(store, "UTC", fetch=fetch, clock=lambda: datetime(2026, 3, 7, tzinfo=timezone.utc))
    service._sync(item)
    assert store.get_calendar(item["id"], include_secrets=True)["ics"] is None
