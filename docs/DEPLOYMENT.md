# Deployment and operation

Calendar Pie runs as a local Python service with a browser display. The service serves the built interface, synchronizes ICS sources, and stores calendars in SQLite. The Pi deployment script installs user-level systemd services for the application and kiosk browser and makes the configuration interface available to devices on the same trusted network. Wi-Fi provisioning, a captive portal, and LAN login are not implemented yet.

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

Install Git, curl, Python 3.11 or newer with virtual-environment support, Node.js 22.18 or newer, Chromium, Cage, and seatd on the Pi. On Raspberry Pi OS Lite, install the OS packages with:

```sh
sudo apt update
sudo apt install --no-install-recommends git chromium chromium-sandbox rpi-chromium-mods cage seatd
```

Cage is a single-application Wayland compositor; it does not install a desktop environment. The seatd service gives the unprivileged compositor access to the display and input devices. Install Node.js 22 for ARM64 using a trusted distribution method; Raspberry Pi OS Trixie's `nodejs` package is version 20 and does not meet this project's requirement.

Clone the repository as the account that will display the clock, then run the deployment script without `sudo`:

```sh
git clone https://github.com/Madelena/Calendar-Pie.git calendar-pie
cd calendar-pie
./scripts/deploy-pi.sh
```

The script performs a reproducible frontend build, creates or updates `.venv`, installs the locked Python requirements, and enables and restarts two systemd user services:

- `calendar-pie.service` runs the application and calendar synchronization service on port 8765. The Pi deployment listens on all IPv4 interfaces so another device can configure calendars.
- `calendar-pie-kiosk.service` runs Chromium inside Cage at <http://127.0.0.1:8765/?kiosk=1>.

It builds the frontend in a staging directory, so a failed build does not replace the assets used by the running service. It checks <http://127.0.0.1:8765/api/health> before starting the kiosk.

The service data is stored outside the checkout at:

```text
~/.local/share/calendar-pie/calendar-pie.sqlite3
```

This keeps calendar configuration, credentials, cached events, and the kiosk's Chromium profile separate from Git updates. The generated user units are under `~/.config/systemd/user/`. To start them during boot without waiting for an interactive login, enable lingering once:

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

Run `hostname -I` on the Pi to find its address, then open `http://<pi-address>:8765` in another browser on the same network to configure calendar sources. For example, an address of `192.168.1.40` uses <http://192.168.1.40:8765>. The managed kiosk starts automatically on the attached display. To restart it or inspect its status:

```sh
systemctl --user restart calendar-pie-kiosk.service
systemctl --user status calendar-pie-kiosk.service
```

Appearance preferences belong to the kiosk's persistent Chromium profile. To open the full interface with that profile, run this over SSH:

```sh
./scripts/configure-pi.sh
```

Settings open on the attached touch display. Press Ctrl+C in the SSH terminal when finished; the script restores the kiosk automatically. Both managed services start with the user's systemd manager and restart after a failure. Kiosk mode hides the pointer over the clock; the regular configuration interface retains it.

## Timezone and storage

The service defaults to the operating system's timezone. Override it with an IANA timezone:

```sh
.venv/bin/python -m calendar_pie --timezone America/New_York
```

The browser uses its own system timezone. Set the display computer's timezone to match; the server option does not change the browser or operating system.

When the service is run manually, the default database is `.data/calendar-pie.sqlite3`, relative to the directory where the service starts. Use `--data-dir /path/to/data` for an explicit location and `--port 8765` to select the port. The Pi deployment script instead uses `~/.local/share/calendar-pie`. Preserve the applicable data directory during upgrades. It contains calendar credentials and cached events, so stop the service before backing it up and store backups privately.

Appearance settings are stored in the browser. Imported fonts stay in that browser's IndexedDB. Clearing site data removes those preferences and fonts, while calendar sources remain in SQLite.

## Configure a Pi remotely

The Pi deployment accepts direct connections addressed to a literal IP address, such as `http://192.168.1.40:8765`. Arbitrary `Host` names remain rejected. Calendar-source changes update the Pi's service. Appearance changes apply to the browser in which they are made, so use `scripts/configure-pi.sh` when changing the kiosk's appearance.

There is currently no login for the LAN interface. Use it only on a trusted private network, do not forward port 8765 from a router, and do not expose it through a public reverse proxy. The browser and API reject cross-origin mutations, but any device that can directly open the Pi's address can view events and change calendar-source settings. Use an SSH tunnel instead if the network is not trusted; start the tunnel with `ssh -N -L 8765:127.0.0.1:8765 username@pi-address`, then open <http://127.0.0.1:8765>.

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
systemctl --user status calendar-pie-kiosk.service
journalctl --user -u calendar-pie-kiosk.service -n 100 --no-pager
```

See [development](DEVELOPMENT.md) for contributor workflows and tests.
