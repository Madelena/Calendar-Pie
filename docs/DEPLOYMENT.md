# Deployment and operation

Calendar Pie currently runs as a local Python service with a browser display. The service serves the built interface, synchronizes ICS sources, and stores calendars in SQLite. Wi-Fi provisioning, a captive portal, LAN login, and automatic startup are not implemented yet.

## Requirements

- Python 3.11 or newer, with pip and virtual-environment support.
- Node.js 22.18 or newer and npm on the computer used to build the interface.
- A browser to display the clock.

The intended appliance uses a Raspberry Pi Zero 2 W and a Waveshare 4-inch, 720 × 720 round HDMI display with USB touch. Start with **Raspberry Pi OS Lite (64-bit)** and add only the graphical session and browser needed for kiosk mode. It needs HDMI output, USB touch, networking, and a graphical session for the browser. Hardware feasibility remains unmeasured; use the [hardware test guide](HARDWARE-TEST.md) before treating it as a finished appliance.

## Run on Linux or macOS

Run commands from the repository root:

```sh
npm ci
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m calendar_pie
```

## Run on Windows

In PowerShell, from the repository root:

```powershell
npm.cmd ci
npm.cmd run build
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m calendar_pie
```

Open <http://127.0.0.1:8765>. Leave the process running; Ctrl+C stops it. Use **Settings → Manage calendar sources** to add feeds. Authentication and synchronization behavior are covered in [the calendar service guide](BACKEND.md#add-calendars).

## Deploy to a Raspberry Pi

Build on another computer:

```sh
npm ci
npm run build
```

Copy these files and directories into one directory on the Pi, preserving this structure:

```text
calendar-pie/
  calendar_pie/
  dist/
  requirements.txt
```

Do not copy `node_modules` or a virtual environment. From the deployment directory on the Pi:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m calendar_pie
```

Open <http://127.0.0.1:8765> in the Pi's browser to configure sources and appearance. Then open <http://127.0.0.1:8765/?kiosk=1> in fullscreen mode. If the installed browser executable is `chromium`, launch it from the graphical session with:

```sh
chromium --kiosk 'http://127.0.0.1:8765/?kiosk=1'
```

Use the same browser profile and URL host for configuration and kiosk mode so browser preferences carry over. This is a manual deployment; boot-to-clock and automatic service recovery still need an appliance startup configuration.

## Timezone and storage

The service defaults to the operating system's timezone. Override it with an IANA timezone:

```sh
.venv/bin/python -m calendar_pie --timezone America/New_York
```

The browser uses its own system timezone. Set the display computer's timezone to match; the server option does not change the browser or operating system.

The default database is `.data/calendar-pie.sqlite3`, relative to the directory where the service starts. Use `--data-dir /path/to/data` for an explicit location and `--port 8765` to select the port. Preserve the data directory during upgrades. It contains calendar credentials and cached events, so stop the service before backing it up and store backups privately.

Appearance settings are stored in the browser. Imported fonts stay in that browser's IndexedDB. Clearing site data removes those preferences and fonts, while calendar sources remain in SQLite.

## Configure a Pi remotely

The service binds only to loopback addresses and has no LAN login. If SSH is enabled on the Pi, forward its local service to another computer:

```sh
ssh -N -L 8765:127.0.0.1:8765 username@pi-hostname
```

Replace the username and hostname, then open <http://127.0.0.1:8765> on the other computer. Keep the SSH connection open. Calendar-source changes update the Pi's service. Appearance changes apply to the browser in which they are made, so configure kiosk appearance in the Pi's browser.

## Update an installation

Stop the service, rebuild the interface, and replace `dist/`, `calendar_pie/`, and `requirements.txt` from the same project version. Preserve `.data/` or the configured data directory. Install the updated requirements in the Pi's virtual environment, restart the service, and reload the browser.

See [development](DEVELOPMENT.md) for contributor workflows and tests.
