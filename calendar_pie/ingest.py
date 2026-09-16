"""ICS normalization in a disposable, resource-bounded worker process."""
from __future__ import annotations

import hashlib
import json
import multiprocessing
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo

MAX_ICS_BYTES = 10 * 1024 * 1024
MAX_OCCURRENCES = 10_000
MAX_TEXT_CHARS = 64 * 1024
MAX_OUTPUT_CHARS = 10 * 1024 * 1024
PARSE_TIMEOUT = 10.0
WORKER_MEMORY_BYTES = 256 * 1024 * 1024


class FeedError(ValueError):
    """An intentionally credential-free error suitable for the API."""


def _worker_entry(connection, function, args):
    try:
        # Linux (including Raspberry Pi): bound allocations as well as wall time.
        # Windows lacks resource; input/occurrence limits and the deadline still apply.
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (WORKER_MEMORY_BYTES, WORKER_MEMORY_BYTES))
        except ImportError:
            pass
        result = function(*args)
        connection.send((True, result))
    except FeedError as error:
        connection.send((False, str(error)))
    except BaseException:
        connection.send((False, "Calendar data could not be processed."))
    finally:
        connection.close()


def _run_bounded(function, args, timeout: float):
    # spawn avoids forking a multi-threaded web server and works on Linux/Windows.
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_worker_entry, args=(sender, function, args), daemon=True)
    process.start()
    sender.close()
    try:
        if not receiver.poll(timeout):
            raise FeedError("Calendar processing timed out.")
        try:
            success, result = receiver.recv()
        except (EOFError, OSError):
            raise FeedError("Calendar processing exceeded resource limits.") from None
        if not success:
            raise FeedError(result)
        return result
    finally:
        receiver.close()
        if process.is_alive():
            process.terminate()
        process.join(timeout=2)
        if process.is_alive():
            process.kill()
            process.join(timeout=2)
        process.close()


def normalize_ics(ics: bytes, calendar_id: str, timezone: str,
                  start: datetime, end: datetime) -> list[dict]:
    """Return timed occurrences overlapping [start, end), with stable identities.

    Floating values use the configured device timezone; date-only events are
    deliberately excluded. An invalid feed fails as a whole, preserving cache.
    """
    if not isinstance(ics, bytes) or len(ics) > MAX_ICS_BYTES:
        raise FeedError("Calendar download exceeds the 10 MiB limit.")
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ValueError("An increasing timezone-aware window is required.")
    ZoneInfo(timezone)
    return _run_bounded(_normalize, (ics, calendar_id, timezone, start, end), PARSE_TIMEOUT)


def _aware(value: datetime, zone: ZoneInfo) -> datetime:
    return value.replace(tzinfo=zone) if value.tzinfo is None else value


def _normalize(ics, calendar_id, timezone, start, end):
    import icalendar
    import recurring_ical_events

    raw = ics.strip()
    if not raw.startswith(b"BEGIN:VCALENDAR") or not raw.endswith(b"END:VCALENDAR"):
        raise FeedError("The response is not a valid iCalendar feed.")
    calendar = icalendar.Calendar.from_ical(raw)
    if calendar.name != "VCALENDAR" or str(calendar.get("VERSION", "")) != "2.0":
        raise FeedError("The response is not a valid iCalendar feed.")
    zone = ZoneInfo(timezone)
    calendar.pop("X-WR-TIMEZONE", None)  # floating means device-local, per our contract
    components = calendar.walk()
    if len(components) > MAX_OCCURRENCES:
        raise FeedError("Calendar contains too many components.")
    cancelled_series = {str(component.get("UID")) for component in components
                        if component.name == "VEVENT" and "RECURRENCE-ID" not in component
                        and str(component.get("STATUS", "")).upper() == "CANCELLED"}
    for component in components:
        if component.errors:
            raise FeedError("Calendar contains invalid properties.")
        if component.name != "VEVENT":
            continue
        if not component.get("UID"):
            raise FeedError("Calendar event is missing its UID.")
        if str(component["UID"]) in cancelled_series:
            continue
        if any(len(str(component.get(key, ""))) > MAX_TEXT_CHARS
               for key in ("UID", "SUMMARY", "DESCRIPTION", "LOCATION")):
            raise FeedError("Calendar event text exceeds resource limits.")
        if "DTSTART" not in component:
            if str(component.get("STATUS", "")).upper() == "CANCELLED" and "RECURRENCE-ID" in component:
                component.add("DTSTART", component.decoded("RECURRENCE-ID"))
            else:
                raise FeedError("Calendar event is missing its start time.")
        # Localize before recurrence expansion so daily floating recurrences keep
        # their local wall time across DST. Preserve embedded VTIMEZONE tzinfo.
        for key in ("DTSTART", "DTEND", "RECURRENCE-ID"):
            prop = component.get(key)
            if prop is not None and isinstance(prop.dt, datetime):
                if prop.dt.tzinfo is None and prop.params.get("TZID"):
                    raise FeedError("Calendar contains an unknown timezone.")
                prop.dt = _aware(prop.dt, zone)
        for key in ("RDATE", "EXDATE"):
            props = component.get(key, [])
            for prop in props if isinstance(props, list) else [props]:
                for date_value in prop.dts:
                    if isinstance(date_value.dt, datetime):
                        if date_value.dt.tzinfo is None and prop.params.get("TZID"):
                            raise FeedError("Calendar contains an unknown timezone.")
                        date_value.dt = _aware(date_value.dt, zone)
        if "DTEND" in component and "DURATION" in component:
            raise FeedError("Calendar event specifies both an end and duration.")
        if "DTEND" in component:
            begins, finishes = component.decoded("DTSTART"), component.decoded("DTEND")
            if type(begins) is not type(finishes) or finishes < begins:
                raise FeedError("Calendar event has an invalid end time.")
        if "DURATION" in component and component.decoded("DURATION").total_seconds() < 0:
            raise FeedError("Calendar event has a negative duration.")
        rule = component.get("RRULE")
        if rule:
            # Floating DTSTART was made aware above; its floating UNTIL must
            # describe the same local cutoff, in UTC for dateutil's aware rule.
            if "UNTIL" in rule:
                rule["UNTIL"] = [_aware(value, zone).astimezone(dt_timezone.utc)
                                 if isinstance(value, datetime) and value.tzinfo is None else value
                                 for value in rule["UNTIL"]]
            frequency = str(rule.get("FREQ", [""])[0]).upper()
            count = int(rule.get("COUNT", [MAX_OCCURRENCES + 1])[0])
            # Reject dense unbounded rules before a library can allocate a large
            # intermediate span. Other pathological rules hit the process cap.
            if frequency in ("SECONDLY", "MINUTELY") and count > MAX_OCCURRENCES:
                raise FeedError("Calendar recurrence exceeds the occurrence limit.")
    calendar.subcomponents = [component for component in calendar.subcomponents
                              if component.name != "VEVENT" or str(component.get("UID")) not in cancelled_series]
    query = recurring_ical_events.of(calendar, skip_bad_series=False)
    results = {}
    scanned = 0
    output_chars = 0
    # Pagination bounds our materialized output; the subprocess also bounds the
    # library's intermediate expansion and old, expensive recurrence searches.
    for page in query.paginate(128, earliest_end=start, latest_start=end):
        for event in page:
            scanned += 1
            if scanned > MAX_OCCURRENCES:
                raise FeedError("Calendar recurrence exceeds the occurrence limit.")
            if str(event.get("STATUS", "")).upper() == "CANCELLED":
                continue
            event_start = event.decoded("DTSTART")
            event_end = event.decoded("DTEND")
            if not isinstance(event_start, datetime):
                continue
            event_start = _aware(event_start, zone).astimezone(dt_timezone.utc)
            event_end = _aware(event_end, zone).astimezone(dt_timezone.utc)
            if event_end < event_start:
                raise FeedError("Calendar event ends before it starts.")
            if event_end == event_start or event_start >= end or event_end <= start:
                continue
            recurrence = event.get("RECURRENCE-ID")
            original = recurrence.dt if recurrence else event_start
            if isinstance(original, datetime):
                original = _aware(original, zone).astimezone(dt_timezone.utc)
            identity = json.dumps([calendar_id, str(event["UID"]), original.isoformat()])
            event_id = hashlib.sha256(identity.encode()).hexdigest()
            normalized = {
                "id": event_id, "calendarId": calendar_id,
                "title": str(event.get("SUMMARY", "Untitled event")),
                "start": event_start.isoformat(), "end": event_end.isoformat(),
                "allDay": False, "location": str(event.get("LOCATION", "")),
                "description": str(event.get("DESCRIPTION", "")),
            }
            output_chars += sum(len(value) for value in normalized.values() if isinstance(value, str))
            if output_chars > MAX_OUTPUT_CHARS:
                raise FeedError("Calendar expanded data exceeds resource limits.")
            results[event_id] = normalized
    return sorted(results.values(), key=lambda event: (event["start"], event["id"]))
