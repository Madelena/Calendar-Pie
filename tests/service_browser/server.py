"""Isolated real API and ICS feed for the browser integration suite."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from waitress import serve
from calendar_pie.app import create_app


class Feed(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/sample.ics":
            self.send_error(404)
            return
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        start = (now + timedelta(minutes=30)).strftime("%Y%m%dT%H%M%SZ")
        end = (now + timedelta(minutes=90)).strftime("%Y%m%dT%H%M%SZ")
        body = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Calendar Pie//Tests//EN\r\n"
                "BEGIN:VEVENT\r\nUID:service-browser-test\r\n"
                f"DTSTART:{start}\r\nDTEND:{end}\r\n"
                "SUMMARY:Real ICS appointment\r\nLOCATION:Local fixture\r\n"
                "DESCRIPTION:Fetched by Python and stored in SQLite.\r\n"
                "END:VEVENT\r\nEND:VCALENDAR\r\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    feed = ThreadingHTTPServer(("127.0.0.1", 8767), Feed)
    threading.Thread(target=feed.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="calendar-pie-browser-") as data:
        app = create_app(Path(data) / "calendar.sqlite3", timezone="UTC", start_worker=True,
                         static_dir=Path(__file__).resolve().parents[2] / "dist")
        try:
            serve(app, host="127.0.0.1", port=8766, threads=2)
        finally:
            app.extensions["calendar_sync"].stop()
            feed.shutdown()
