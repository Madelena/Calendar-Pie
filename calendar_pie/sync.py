"""Serial background refresh with conditional HTTP and atomic good snapshots."""
from __future__ import annotations

import threading
from datetime import datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from .ingest import FeedError, MAX_ICS_BYTES, _run_bounded, normalize_ics

CONNECT_TIMEOUT = 5.0
READ_TIMEOUT = 15.0
FETCH_TIMEOUT = 30.0


def _download(source):
    import requests
    from urllib3.exceptions import ReadTimeoutError

    headers = {"Accept": "text/calendar", "User-Agent": "Calendar-Pie/1.0"}
    if source.get("etag"):
        headers["If-None-Match"] = source["etag"]
    if source.get("lastModified"):
        headers["If-Modified-Since"] = source["lastModified"]
    auth = None
    if source.get("username") or source.get("password"):
        auth = (source.get("username") or "", source.get("password") or "")
    try:
        with requests.Session() as session:
            session.trust_env = False  # no environment proxies or implicit netrc credentials
            with session.get(source["url"], headers=headers, auth=auth, stream=True,
                             timeout=(CONNECT_TIMEOUT, READ_TIMEOUT), allow_redirects=False, verify=True) as response:
                if response.status_code == 304:
                    return (304, None, response.headers.get("ETag"), response.headers.get("Last-Modified"))
                if 300 <= response.status_code < 400:
                    raise FeedError("Calendar redirects are not supported; use the final feed URL.")
                if response.status_code in (401, 403):
                    raise FeedError("Calendar authentication failed.")
                if response.status_code != 200:
                    raise FeedError("Calendar server returned an unsuccessful response.")
                length = response.headers.get("Content-Length")
                if length and int(length) > MAX_ICS_BYTES:
                    raise FeedError("Calendar download exceeds the 10 MiB limit.")
                data = bytearray()
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    data.extend(chunk)
                    if len(data) > MAX_ICS_BYTES:
                        raise FeedError("Calendar download exceeds the 10 MiB limit.")
                return (200, bytes(data), response.headers.get("ETag"), response.headers.get("Last-Modified"))
    # Request exceptions often contain URLs, query tokens, and credentials.
    # Keep all public messages static rather than exposing exception text.
    except requests.exceptions.SSLError:
        raise FeedError("Calendar TLS connection failed. Check the server certificate.") from None
    except requests.Timeout:
        raise FeedError("Calendar download timed out. Try refreshing again.") from None
    except requests.ConnectionError as error:
        # Requests wraps streamed read timeouts in ConnectionError.
        if any(isinstance(cause, ReadTimeoutError) for cause in error.args):
            raise FeedError("Calendar download timed out. Try refreshing again.") from None
        raise FeedError("Calendar server could not be reached. Check the connection and feed settings.") from None
    except (requests.exceptions.ChunkedEncodingError, requests.exceptions.ContentDecodingError):
        raise FeedError("Calendar download was interrupted or the server response was invalid. Try refreshing again.") from None
    except requests.RequestException:
        raise FeedError("Calendar could not be downloaded. Check the connection and feed settings.") from None


def download(source):
    """Bound DNS, connect, headers, and slow streamed bodies by one deadline."""
    request = {key: source.get(key) for key in ("url", "username", "password", "etag", "lastModified")}
    return _run_bounded(_download, (request,), FETCH_TIMEOUT)


class SyncService:
    def __init__(self, store, timezone: str, *, fetch=None, normalizer=None, clock=None):
        self.store = store
        self.timezone = ZoneInfo(timezone)
        self._fetch = fetch or download
        self._normalize = normalizer or normalize_ics
        self._clock = clock or (lambda: datetime.now(dt_timezone.utc))
        self._condition = threading.Condition()
        self._pending = set()
        self._refresh_all = True
        self._stopping = False
        self._thread = None

    def start(self):
        with self._condition:
            if self._thread and self._thread.is_alive():
                return
            self._stopping = False
            self._refresh_all = True
            self._thread = threading.Thread(target=self._run, name="calendar-refresh", daemon=True)
            self._thread.start()

    def stop(self):
        with self._condition:
            self._stopping = True
            self._condition.notify_all()
        if self._thread:
            # A single source is bounded by the fetch and parse deadlines.
            self._thread.join(timeout=FETCH_TIMEOUT + 15)

    def request_refresh(self, id=None):
        with self._condition:
            if id is None:
                self._refresh_all = True
            else:
                self._pending.add(id)
            self._condition.notify_all()

    def _run(self):
        while True:
            with self._condition:
                if self._stopping:
                    return
                pending, refresh_all = self._pending, self._refresh_all
                self._pending, self._refresh_all = set(), False
            now = self._clock()
            for source in self.store.list_calendars():
                with self._condition:
                    if self._stopping:
                        return
                if not source["enabled"]:
                    continue
                last = source.get("lastAttempt")
                due = not last or (now - datetime.fromisoformat(last)).total_seconds() >= source.get("refreshMinutes", 5) * 60
                if refresh_all or source["id"] in pending or due:
                    current = self.store.get_calendar(source["id"], include_secrets=True)
                    if current and current["enabled"]:
                        self._sync(current)
            with self._condition:
                if not self._stopping and not self._pending and not self._refresh_all:
                    self._condition.wait(timeout=30)

    def _sync(self, source):
        calendar_id, revision = source["id"], source["revision"]
        at = self._clock().astimezone(dt_timezone.utc).isoformat()
        if not self.store.record_attempt(calendar_id, revision, at):
            return
        try:
            status, ics, etag, last_modified = self._fetch(source)
            if status == 304:
                ics = source.get("ics")
                if ics is None:
                    raise FeedError("Calendar server returned no data and no cached feed is available.")
                etag = etag or source.get("etag")
                last_modified = last_modified or source.get("lastModified")
            local_date = self._clock().astimezone(self.timezone).date()
            start = datetime.combine(local_date - timedelta(days=1), time.min, self.timezone)
            end = datetime.combine(local_date + timedelta(days=8), time.min, self.timezone)
            # Re-expand 304 and identical 200 bodies: the rolling window moves.
            events = self._normalize(ics, calendar_id, self.timezone.key, start, end)
            self.store.replace_snapshot(calendar_id, revision, ics, events,
                                        start.astimezone(dt_timezone.utc).isoformat(),
                                        end.astimezone(dt_timezone.utc).isoformat(), at, etag, last_modified)
        except FeedError as error:
            self.store.record_failure(calendar_id, revision, at, str(error))
        except Exception:
            self.store.record_failure(calendar_id, revision, at, "Calendar refresh failed.")
