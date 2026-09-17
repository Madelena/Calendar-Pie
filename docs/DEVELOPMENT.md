# Development and testing

This guide covers work on the Calendar Pie source code. For an ordinary installation, use the [deployment guide](DEPLOYMENT.md).

## Frontend development

Use Node.js 22.18 or newer:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The development server proxies `/api` to a calendar service on port 8765. If no service is running, the interface remains usable as a sample preview.

The sample preview starts paused at 10:10 in the browser's local timezone. Its scenarios cover everyday events, overlaps, duration segments, overnight events, and an empty day. **Use current time** changes it to a minute-updated live clock. `npm run preview` serves the production build as a static sample and intentionally has no API proxy.

The frontend is TypeScript, HTML, CSS, and SVG. Vite is build tooling only. Inter and Open Sans are bundled; no runtime font CDN is used. Display settings use localStorage as an offline fallback and synchronize through the calendar service when available. Custom font files use IndexedDB and remain browser-local.

## Calendar service development

Create a Python environment and install development dependencies:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

On Windows, replace `.venv/bin/python` with `.venv\Scripts\python.exe`. Build the frontend before running the integrated service:

```sh
npm run build
.venv/bin/python -m calendar_pie
```

The service serves `dist/`, exposes its JSON API under `/api`, stores state in SQLite, and runs calendar synchronization in a background thread. Its implementation, limits, persistence model, and endpoint reference are documented in [BACKEND.md](BACKEND.md).

Never use personal calendar feeds or credentials as fixtures. The service-browser suite creates a temporary database and local ICS server.

## Checks

Run frontend unit tests and the production build:

```sh
npm test
npm run build
```

Install a Playwright browser once, then run browser tests:

```sh
npx playwright install chromium
npm run test:browser
```

Run Python and integrated service-browser tests with:

```sh
.venv/bin/python -m pytest
npm run test:service-browser
```

On Windows, Chrome can be selected for browser tests with:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd run test:browser
npm.cmd run test:service-browser
```

The unit suite covers clock windows, event filtering, overlap layout, duration segmentation, countdowns, wrapping, label placement, and time formatting. Browser tests cover settings, source management, accessibility, themes, fading history, round-screen bounds, touch targets, and time updates. The service-browser test adds, synchronizes, displays, and removes an isolated ICS source.

## Diagnostics and hardware work

Add `?diagnostics=1` to the regular desktop URL to expose render and interaction measurements. Diagnostics measure browser JavaScript work; they do not measure physical touch-to-display latency. Kiosk mode deliberately has no Settings entry point.

Use [HARDWARE-TEST.md](HARDWARE-TEST.md) for the Pi memory sampler, touch-latency method, overnight run, and renderer acceptance targets. Store generated measurements and screenshots under ignored artifact paths rather than committing them.

## Architecture and boundaries

The Python service owns calendar fetching, recurrence expansion, SQLite, shared display preferences, and static/API serving. The browser owns rendering and browser-local custom font files. Manual launches listen only on localhost by default; the Pi deployment enables unauthenticated access by literal LAN IP for configuration. LAN authentication and the setup portal belong to later appliance work.

The interface redraws on meaningful changes and minute boundaries rather than animating continuously. All-day events are filtered before display. During daylight-saving transitions the renderer avoids ambiguous clock geometry and relies on the chronological desktop agenda.

See [DESIGN.md](DESIGN.md) for interface rules and [PLAN.md](PLAN.md) for future work and acceptance criteria.
