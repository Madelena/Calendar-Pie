# Deployment and operation

Calendar Pie runs as a local Python service with a browser display. The service serves the built interface, synchronizes ICS sources, and stores calendars in SQLite. The Pi deployment script installs a user-level systemd service for startup and recovery. Wi-Fi provisioning, a captive portal, LAN login, and automatic kiosk-browser startup are not implemented yet.

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

Install Git, curl, Python 3.11 or newer with virtual-environment support, and Node.js 22.18 or newer on the Pi. Clone the repository as the account that will display the clock, then run the deployment script without `sudo`:

```sh
git clone https://github.com/Madelena/Calendar-Pie.git calendar-pie
cd calendar-pie
./scripts/deploy-pi.sh
```

The script performs a reproducible frontend build, creates or updates `.venv`, installs the locked Python requirements, and enables and restarts `calendar-pie.service` as a systemd user service. It builds the frontend in a staging directory, so a failed build does not replace the assets used by the running service. It also checks <http://127.0.0.1:8765/api/health> before reporting success.

The service data is stored outside the checkout at:

```text
~/.local/share/calendar-pie/calendar-pie.sqlite3
```

This keeps calendar configuration, credentials, and cached events separate from Git updates. The generated user unit is at `~/.config/systemd/user/calendar-pie.service`. To start the service during boot without waiting for an interactive login, enable lingering once:

```sh
sudo loginctl enable-linger "$USER"
```

The deploy script deliberately does not run `git pull`. Keeping source control and deployment as separate steps means a merge conflict or local edit cannot be mistaken for a successful deployment.

If this checkout was previously run manually and already has `.data/calendar-pie.sqlite3`, stop the old service and copy its database before the first scripted deployment:

```sh
install -d -m 700 "$HOME/.local/share/calendar-pie"
install -m 600 .data/calendar-pie.sqlite3 "$HOME/.local/share/calendar-pie/"
```

The script refuses to start with an unmigrated legacy database rather than silently displaying an empty calendar list. Keep the old `.data` directory as a backup until the migrated service has been verified.

Open <http://127.0.0.1:8765> in the Pi's browser to configure sources and appearance. Then open <http://127.0.0.1:8765/?kiosk=1> in fullscreen mode. If the installed browser executable is `chromium`, launch it from the graphical session with:

```sh
chromium --kiosk 'http://127.0.0.1:8765/?kiosk=1'
```

Use the same browser profile and URL host for configuration and kiosk mode so browser preferences carry over. The service starts with the user's systemd manager and restarts after a failure. Starting Chromium in kiosk mode after graphical login still needs desktop-session configuration.

## Timezone and storage

The service defaults to the operating system's timezone. Override it with an IANA timezone:

```sh
.venv/bin/python -m calendar_pie --timezone America/New_York
```

The browser uses its own system timezone. Set the display computer's timezone to match; the server option does not change the browser or operating system.

When the service is run manually, the default database is `.data/calendar-pie.sqlite3`, relative to the directory where the service starts. Use `--data-dir /path/to/data` for an explicit location and `--port 8765` to select the port. The Pi deployment script instead uses `~/.local/share/calendar-pie`. Preserve the applicable data directory during upgrades. It contains calendar credentials and cached events, so stop the service before backing it up and store backups privately.

Appearance settings are stored in the browser. Imported fonts stay in that browser's IndexedDB. Clearing site data removes those preferences and fonts, while calendar sources remain in SQLite.

## Configure a Pi remotely

The service binds only to loopback addresses and has no LAN login. If SSH is enabled on the Pi, forward its local service to another computer:

```sh
ssh -N -L 8765:127.0.0.1:8765 username@pi-hostname
```

Replace the username and hostname, then open <http://127.0.0.1:8765> on the other computer. Keep the SSH connection open. Calendar-source changes update the Pi's service. Appearance changes apply to the browser in which they are made, so configure kiosk appearance in the Pi's browser.

## Update an installation

From the repository on the Pi:

```sh
git status --short
git pull --ff-only
./scripts/deploy-pi.sh
```

Review or commit intentional local changes before pulling. `--ff-only` prevents Git from creating an unexpected merge commit on the appliance. The deploy script preserves the external data directory, updates dependencies and built assets, restarts the service, and verifies its health. The kiosk browser normally loads hashed frontend assets on its next page reload; reload it after deployment if it remains open on the previous version.

If deployment fails, inspect the service with:

```sh
systemctl --user status calendar-pie.service
journalctl --user -u calendar-pie.service -n 100 --no-pager
```

See [development](DEVELOPMENT.md) for contributor workflows and tests.
