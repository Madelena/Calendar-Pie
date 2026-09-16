# Calendar Pie

Calendar Pie is a round calendar clock that displays scheduled events as slices of time. It is designed to make busy schedules easier to understand at a glance, especially for people with ADHD.

The intended hardware is a **Raspberry Pi Zero 2 W** with a **Waveshare 4-inch, 720 × 720 round HDMI display and USB touch**. The clock also works in a desktop browser. Its schedule visualization is inspired by [Sectograph](https://play.google.com/store/apps/details?id=prox.lab.calclock).

## Features

- Multiple read-only ICS calendars, including Radicale collection URLs, with an individual color for each calendar.
- Rolling 12- or 24-hour dials and separate 12/24-hour text formatting.
- Fading history, clear future boundaries, and a countdown to the current event's end or the next event's start.
- Separate radial lanes for overlapping events, duration labels, and touch-accessible event details.
- Light and true-black dark themes, configurable accent color, bundled fonts, and custom font import.
- A persistent local calendar cache for temporary network or calendar-server outages.

## Install and run

Use Python 3.11 or newer and Node.js 22.18 or newer. From a downloaded or cloned copy of this repository, run:

```sh
npm ci
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m calendar_pie
```

Open <http://127.0.0.1:8765>. Keep the service running while using the clock; Ctrl+C stops it. The server uses the operating system's timezone by default.

Windows and Raspberry Pi instructions are in the [deployment guide](docs/DEPLOYMENT.md). Build the interface on another computer when deploying to a Pi; Node.js is not required on the Pi itself.

## Add calendars

1. Open **Settings → Manage calendar sources → Add calendar source**.
2. Enter a name, ICS URL, and color. Add a username and password if the feed requires HTTP Basic authentication. For Radicale, use the calendar collection URL.
3. Save the source, then use **Check sync status** to confirm that it loaded.
4. Repeat for additional calendars.

Tap an event slice to see its details. The countdown shows the time until an active event ends; during overlaps it uses the earliest ending event. When no event is active, it counts down to the next event's start.

Swipe the clock or use the previous and next buttons to browse time. Select the displayed time range to return to the current window. The center always shows the current time and date.

Settings control the dial span, time format, theme, accent color, fonts, and fading history. Choose **Sample preview** to explore the clock without adding a calendar. Appearance preferences belong to each browser; calendar sources are stored by the local service.

For the round display, open <http://127.0.0.1:8765/?kiosk=1> in a fullscreen browser. Settings are available only from the regular browser view without `?kiosk=1`.

## Project status

Calendar Pie is a working local prototype. Raspberry Pi performance and long-running reliability have not yet been measured. Wi-Fi setup, the captive portal, authenticated LAN configuration, and automatic appliance startup are planned; the current service accepts local connections only.

All-day events are hidden. Windows that cross a daylight-saving clock change use the desktop agenda because repeated or skipped hours cannot yet be represented reliably on the dial. Calendar navigation is limited to the service's cached date range.

## Documentation

- [Deployment and operation](docs/DEPLOYMENT.md)
- [Design decisions](docs/DESIGN.md)
- [Development and testing](docs/DEVELOPMENT.md)
- [Calendar service and API](docs/BACKEND.md)
- [Raspberry Pi hardware testing](docs/HARDWARE-TEST.md)
- [Project plan and remaining work](docs/PLAN.md)
- [Font credits and licenses](public/licenses/README.md)
