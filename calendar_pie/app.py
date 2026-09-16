"""Loopback-only JSON API and built frontend hosting."""

from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .storage import Store, ValidationError


def create_app(db_path, timezone="UTC", start_worker=False, static_dir=None):
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise ValueError("Use a valid IANA timezone.") from None
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
    store = Store(db_path)
    app.extensions["calendar_store"] = store
    app.extensions["calendar_sync"] = None
    frontend = Path(static_dir) if static_dir is not None else Path(__file__).resolve().parent.parent / "dist"

    if start_worker:
        from .sync import SyncService
        service = SyncService(store, timezone)
        app.extensions["calendar_sync"] = service
        service.start()

    def refresh(calendar_id=None):
        service = app.extensions["calendar_sync"]
        if service is not None:
            service.request_refresh(calendar_id)

    @app.before_request
    def guard_local_requests():
        try:
            host = urlsplit("http://" + request.host)
            if (host.hostname not in ("localhost", "127.0.0.1", "::1")
                    or host.username is not None or host.password is not None
                    or host.path or host.query or host.fragment):
                return jsonify(error="Only localhost requests are allowed."), 403
            host.port
        except ValueError:
            return jsonify(error="Invalid request host."), 403
        if request.method in ("POST", "PATCH", "PUT", "DELETE"):
            origin = request.headers.get("Origin")
            if origin is not None and origin != request.host_url.rstrip("/"):
                return jsonify(error="Cross-origin changes are not allowed."), 403
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                return jsonify(error="Cross-origin changes are not allowed."), 403
            if request.method in ("POST", "PATCH") and request.mimetype != "application/json":
                return jsonify(error="Send an application/json request body."), 415

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(ValidationError)
    def validation_error(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(HTTPException)
    def http_error(error):
        messages = {400: "Invalid request.", 404: "Not found.", 405: "Method not allowed.",
                    413: "Request body is too large.", 415: "Send an application/json request body."}
        return jsonify(error=messages.get(error.code, "Request failed.")), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        # Exception strings can contain feed URLs or credentials. Never emit them.
        app.logger.error("A calendar service operation failed.")
        return jsonify(error="The calendar service could not complete this request."), 500

    def body():
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValidationError("Expected a JSON object.")
        return data

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", timezone=timezone)

    @app.get("/api/calendars")
    def calendars():
        return jsonify(calendars=store.list_calendars())

    @app.post("/api/calendars")
    def create_calendar():
        calendar = store.create_calendar(body())
        refresh(calendar["id"])
        return jsonify(calendar=calendar), 201

    @app.patch("/api/calendars/<calendar_id>")
    def update_calendar(calendar_id):
        calendar = store.update_calendar(calendar_id, body())
        if calendar is None:
            return jsonify(error="Calendar not found."), 404
        refresh(calendar_id)
        return jsonify(calendar=calendar)

    @app.delete("/api/calendars/<calendar_id>")
    def delete_calendar(calendar_id):
        if not store.delete_calendar(calendar_id):
            return jsonify(error="Calendar not found."), 404
        return "", 204

    @app.post("/api/calendars/<calendar_id>/refresh")
    def refresh_calendar(calendar_id):
        body()
        if store.get_calendar(calendar_id) is None:
            return jsonify(error="Calendar not found."), 404
        refresh(calendar_id)
        return jsonify(queued=True), 202

    @app.post("/api/refresh")
    def refresh_all():
        body()
        refresh()
        return jsonify(queued=True), 202

    @app.get("/api/events")
    def events():
        now = datetime.now(dt_timezone.utc)
        start_raw, end_raw = request.args.get("start"), request.args.get("end")
        if start_raw is None and end_raw is None:
            start, end = now - timedelta(days=1), now + timedelta(days=7)
        else:
            try:
                start = datetime.fromisoformat(start_raw)
                end = datetime.fromisoformat(end_raw)
                if start.tzinfo is None or end.tzinfo is None:
                    raise ValueError
                start, end = start.astimezone(dt_timezone.utc), end.astimezone(dt_timezone.utc)
            except (ValueError, TypeError, OverflowError):
                raise ValidationError("Start and end must be ISO timestamps with UTC offsets.") from None
        if not timedelta(0) < end - start <= timedelta(days=32):
            raise ValidationError("Choose a positive date range of at most 32 days.")
        start_iso, end_iso = start.isoformat(), end.isoformat()
        fields = ("id", "name", "color", "enabled", "lastSuccess", "lastError")
        return jsonify(calendars=[{field: c[field] for field in fields} for c in store.list_calendars()],
                       events=store.read_events(start_iso, end_iso),
                       range={"start": start_iso, "end": end_iso}, timezone=timezone,
                       cacheRange=store.cache_range())

    @app.get("/")
    def index():
        if not (frontend / "index.html").is_file():
            return jsonify(error="Build the frontend with npm run build first."), 503
        return send_from_directory(frontend, "index.html")

    @app.get("/<path:filename>")
    def static_file(filename):
        if filename.startswith("api/"):
            return jsonify(error="Not found."), 404
        return send_from_directory(frontend, filename)

    return app
