# Local calendar service

The Python service serves the built clock, manages calendar sources in SQLite, and refreshes read-only ICS feeds in the background. It runs on localhost. The Pi deployment installs application and kiosk-browser startup and recovery; LAN authentication, phone setup, and Wi-Fi provisioning are separate, unfinished milestones.

Installation, Windows commands, timezone options, and Raspberry Pi operation are covered in [the deployment guide](DEPLOYMENT.md). Contributor setup and test commands are in [the development guide](DEVELOPMENT.md).

The command uses [Waitress](https://flask.palletsprojects.com/en/stable/deploying/waitress/) and starts one background synchronization thread. Stop it with Ctrl+C. Options include `--port`, `--timezone`, and `--data-dir`; `--host` accepts only loopback addresses. Do not expose this version through a public reverse proxy: device login and LAN configuration are not implemented.

## Add calendars

Open the desktop preview at the URL without `kiosk=1`, then choose **Settings → Manage calendar sources → Add calendar source**. Settings and source forms use rectangular dialogs and are unavailable from kiosk mode.

Each source has a name, ICS collection URL, optional HTTP Basic username/password, color, enabled switch, and refresh interval. The default interval is five minutes. A Radicale calendar collection URL can be used directly; use its final URL, since redirects are rejected. TLS certificate validation is enabled. Private certificate-authority configuration is not yet exposed.

Saving queues a refresh. Use **Check sync status** to inspect the last successful sync or an error, or **Refresh** to request another download. The clock polls the local API every 30 seconds; reload to see completed synchronization immediately. Leaving an existing password blank retains it; the explicit checkbox removes it. Passwords are never sent back in API responses or saved in browser preferences.

The service automatically activates **My calendars**. **Sample preview** remains available in Settings; an unavailable service does not replace an explicitly selected real calendar view with sample events.

## Persistence and offline behavior

`.data/calendar-pie.sqlite3` contains sources, credentials, cached ICS bodies, normalized events, and sync status. `.data/` is ignored by Git. On POSIX, newly created data directories use mode 0700 and the database uses 0600; on Windows, storage inherits the user's directory permissions. Credentials are stored locally, not encrypted by the application. Treat backups of this directory as private.

A successful sync replaces a source's events and cached feed in one transaction, so removed and cancelled events disappear. Failed downloads or parsing preserve the last successful snapshot and expose a sync error. Changes to the source URL or credentials clear the old source cache; edits made while a fetch is running prevent that older fetch from committing. Disabled sources retain their cache but do not contribute events or refresh. Deleting a source removes its cache.

After a restart, SQLite supplies the last snapshot while refreshing. ETag and Last-Modified validators avoid downloading unchanged feeds. Cached ICS is expanded again after a 304 response to advance the occurrence window. A clock already loaded in the browser retains its displayed events if the local API becomes unavailable, with an offline indicator; the browser itself is not an offline web-app cache.

## Calendar behavior and limits

- Uses [icalendar](https://icalendar.readthedocs.io/en/stable/) and [recurring-ical-events](https://recurring-ical-events.readthedocs.io/en/latest/) for timed events, recurrence rules, added/excluded occurrences, edited occurrences, and cancellations.
- UTC, TZID, embedded timezone definitions, and floating times are handled during normalization. Floating times use the configured server timezone. All-day and zero-duration events are excluded from the visible feed.
- Each source caches occurrences from yesterday's local midnight through midnight eight days after today. Navigation outside cache coverage displays a warning; the API does not trigger arbitrary historical expansion.
- Limits: 10 MiB per decoded feed, 10,000 components/occurrences, 30 seconds for fetching and 10 seconds for parsing. HTTP connections have a five-second connect timeout and a fifteen-second read timeout. Fetching and parsing use short-lived subprocesses so the absolute timeouts also cover slow responses and expensive recurrence expansion. On Linux these workers also have a 256 MiB address-space cap; Windows uses the byte/count/time limits.
- Event text fields are limited to 64 Ki characters each and expanded text to 10 Mi characters in total.
- Dense unbounded secondly/minutely rules are rejected. A feed that exceeds limits fails as a whole, retaining good cached data.
- The renderer's DST-transition limitations still apply: normalized timestamps are accurate, but ambiguous transition windows use the agenda instead of event arcs.
- Actual Pi memory, performance, and 24-hour reliability have not yet been measured with the service running.

## API

All endpoints return JSON except successful deletion (204). Errors use `{ "error": "message" }`. Mutations reject cross-origin browser requests; POST/PATCH require `Content-Type: application/json`. The server validates localhost Host headers and does not enable CORS.

| Method and path | Behavior |
| --- | --- |
| `GET /api/health` | Service status and configured timezone |
| `GET /api/calendars` | Source settings and sync status, with `hasPassword` instead of credentials |
| `POST /api/calendars` | Add a source and queue refresh |
| `PATCH /api/calendars/{id}` | Edit supplied source fields and queue refresh |
| `DELETE /api/calendars/{id}` | Remove source and cached events |
| `POST /api/calendars/{id}/refresh` | Queue a source refresh; body `{}` |
| `POST /api/refresh` | Queue all enabled sources; body `{}` |
| `GET /api/events?start=...&end=...` | Enabled timed events, calendar colors/status, and common cache coverage |

Source bodies accept `name`, `url`, `username`, `password`, `color`, `enabled`, and `refreshMinutes`. Date queries require ISO timestamps with offsets, a positive interval, and at most 32 days. SQLite has a versioned schema (`PRAGMA user_version=1`); unknown newer versions are rejected.

## Verification

The service has Python fixtures for API, storage, ingestion, recurrence, and synchronization behavior, plus an integrated browser test using an isolated ICS server and temporary database. See [development and testing](DEVELOPMENT.md#checks) for commands. Tests do not require personal calendar credentials.
