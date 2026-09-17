#!/bin/sh

set -eu

kiosk_service_name="calendar-pie-kiosk.service"
data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
profile_dir="$data_home/calendar-pie/chromium"

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

restore_kiosk() {
    trap - EXIT HUP INT TERM
    printf '%s\n' "Restoring the kiosk..."
    systemctl --user start "$kiosk_service_name"
}

[ "$(uname -s)" = "Linux" ] || fail "This configuration launcher only supports Linux."
[ "$(id -u)" -ne 0 ] || fail "Run this script as the account that displays the clock, not with sudo."

require_command cage
require_command chromium
require_command systemctl

systemctl --user cat "$kiosk_service_name" >/dev/null 2>&1 \
    || fail "Deploy Calendar Pie before opening kiosk configuration."

printf '%s\n' "Stopping the kiosk..."
systemctl --user stop "$kiosk_service_name"
trap restore_kiosk EXIT HUP INT TERM

printf '%s\n' "Settings are open on the attached display. Press Ctrl+C here when finished."
LIBSEAT_BACKEND=seatd cage -d -- chromium \
    --user-data-dir="$profile_dir" \
    --no-first-run \
    --no-default-browser-check \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --password-store=basic \
    --ozone-platform=wayland \
    http://127.0.0.1:8765/
