from datetime import datetime, timezone
from pathlib import Path
import time

import pytest

from calendar_pie import ingest
from calendar_pie.ingest import FeedError, normalize_ics

FIXTURES = Path(__file__).parent / "fixtures"
START = datetime(2026, 3, 7, tzinfo=timezone.utc)
END = datetime(2026, 3, 15, tzinfo=timezone.utc)


def feed(event):
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{event}\r\nEND:VCALENDAR\r\n".encode()


def test_recurrence_dst_exclusion_override_cancel_all_day_and_floating():
    events = normalize_ics((FIXTURES / "recurrence.ics").read_bytes(), "home", "America/New_York", START, END)
    daily = [event for event in events if "meeting" in event["title"]]
    assert [event["start"] for event in daily] == [
        "2026-03-07T14:00:00+00:00", "2026-03-08T13:00:00+00:00",
        "2026-03-10T15:00:00+00:00", "2026-03-13T13:00:00+00:00"]
    assert len(events) == 6
    assert all(not event["allDay"] for event in events)
    floating = next(event for event in events if event["title"] == "Floating appointment")
    assert floating["start"] == "2026-03-08T19:00:00+00:00"
    assert floating["end"] == "2026-03-08T19:30:00+00:00"
    assert daily[0]["description"] == "First line\nSecond line"


def test_identity_preserves_original_occurrence_when_moved_and_separates_sources():
    data = (FIXTURES / "recurrence.ics").read_bytes()
    first = normalize_ics(data, "home", "America/New_York", START, END)
    moved = normalize_ics(data.replace(b"20260310T110000", b"20260310T120000").replace(
        b"DTEND;TZID=America/New_York:20260310T120000", b"DTEND;TZID=America/New_York:20260310T130000"),
        "home", "America/New_York", START, END)
    other = normalize_ics(data, "work", "America/New_York", START, END)
    assert {event["id"] for event in first} == {event["id"] for event in moved}
    assert not ({event["id"] for event in first} & {event["id"] for event in other})


@pytest.mark.parametrize("data", [b"<html>login</html>", b"BEGIN:VCALENDAR\nVERSION:2.0\n",
    feed("BEGIN:VEVENT\nUID:broken\nDTSTART:garbage\nEND:VEVENT"),
    feed("BEGIN:VEVENT\nDTSTART:20260308T150000Z\nEND:VEVENT")])
def test_invalid_feed_fails_as_a_whole(data):
    with pytest.raises(FeedError):
        normalize_ics(data, "home", "UTC", START, END)


def test_calendar_larger_than_five_mib_is_accepted_within_new_limit():
    description = 'x' * 50_000
    data = feed('\n'.join(
        f'BEGIN:VEVENT\nUID:large-{index}\nDTSTART:20260308T150000Z\n'
        f'DURATION:PT1H\nDESCRIPTION:{description}\nEND:VEVENT'
        for index in range(110)
    ))
    assert 5 * 1024 * 1024 < len(data) < ingest.MAX_ICS_BYTES
    events = normalize_ics(data, 'large-feed', 'UTC', START, END)
    assert len(events) == 110
    assert all(event['description'] == description for event in events)


def test_calendar_above_ten_mib_is_rejected_before_parsing():
    with pytest.raises(FeedError, match='10 MiB'):
        normalize_ics(b'x' * (ingest.MAX_ICS_BYTES + 1), 'oversized', 'UTC', START, END)


def test_unknown_tzid_is_not_silently_floating():
    with pytest.raises(FeedError, match="timezone"):
        normalize_ics(feed("BEGIN:VEVENT\nUID:bad-zone\nDTSTART;TZID=Unknown/Invalid:20260308T150000\nEND:VEVENT"),
                      "home", "UTC", START, END)


def test_embedded_vtimezone():
    data = feed("""BEGIN:VTIMEZONE
TZID:Custom/Five
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0500
TZOFFSETTO:+0500
TZNAME:CUSTOM
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:custom-zone
DTSTART;TZID=Custom/Five:20260308T150000
DTEND;TZID=Custom/Five:20260308T160000
END:VEVENT""")
    events = normalize_ics(data, "home", "America/New_York", START, END)
    assert events[0]["start"] == "2026-03-08T10:00:00+00:00"


def test_dense_recurrence_rejected_promptly():
    data = feed("BEGIN:VEVENT\nUID:dense\nDTSTART:19000101T000000Z\nDURATION:PT1S\nRRULE:FREQ=SECONDLY\nEND:VEVENT")
    began = time.monotonic()
    with pytest.raises(FeedError, match="limit"):
        normalize_ics(data, "home", "UTC", START, END)
    assert time.monotonic() - began < 5


def _never_returns():
    while True:
        pass


def test_worker_deadline_terminates_pathological_work():
    began = time.monotonic()
    with pytest.raises(FeedError, match="timed out"):
        ingest._run_bounded(_never_returns, (), 0.3)
    assert time.monotonic() - began < 3


def test_overlap_window_excludes_events_at_end_and_keeps_overnight():
    data = feed("""BEGIN:VEVENT
UID:overnight
DTSTART:20260306T230000Z
DTEND:20260307T010000Z
END:VEVENT
BEGIN:VEVENT
UID:boundary
DTSTART:20260315T000000Z
DTEND:20260315T010000Z
END:VEVENT""")
    events = normalize_ics(data, "home", "UTC", START, END)
    assert len(events) == 1
    assert events[0]["start"] == "2026-03-06T23:00:00+00:00"


def test_cancelled_master_cancels_overrides_too():
    data = feed("""BEGIN:VEVENT
UID:cancelled
DTSTART:20260307T100000Z
DURATION:PT1H
RRULE:FREQ=DAILY;COUNT=3
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:cancelled
RECURRENCE-ID:20260308T100000Z
DTSTART:20260308T110000Z
DURATION:PT1H
END:VEVENT""")
    assert normalize_ics(data, "home", "UTC", START, END) == []


@pytest.mark.parametrize("properties", ["DTEND:20260308T140000Z", "DURATION:-PT1H",
    "DTEND:20260308T160000Z\nDURATION:PT1H"])
def test_invalid_event_duration_is_rejected(properties):
    with pytest.raises(FeedError):
        normalize_ics(feed(f"BEGIN:VEVENT\nUID:bad-duration\nDTSTART:20260308T150000Z\n{properties}\nEND:VEVENT"),
                      "home", "UTC", START, END)


def test_occurrence_cap_rejects_expansion_instead_of_truncating():
    data = feed("BEGIN:VEVENT\nUID:dense\nDTSTART:20260307T000000Z\nDURATION:PT1S\nRRULE:FREQ=HOURLY;BYMINUTE=0,5,10,15,20,25,30,35,40,45,50,55\nEND:VEVENT")
    with pytest.raises(FeedError, match="limit|timed out"):
        normalize_ics(data, "home", "UTC", START, datetime(2026, 5, 1, tzinfo=timezone.utc))


def test_floating_until_and_exdate_keep_device_local_time_across_dst():
    data = feed("""X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
UID:floating-recurring
DTSTART:20260307T090000
DURATION:PT1H
RRULE:FREQ=DAILY;UNTIL=20260310T090000
EXDATE:20260309T090000
END:VEVENT""")
    events = normalize_ics(data, "home", "America/New_York", START, END)
    assert [event["start"] for event in events] == [
        "2026-03-07T14:00:00+00:00", "2026-03-08T13:00:00+00:00", "2026-03-10T13:00:00+00:00"]
