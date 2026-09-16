#!/bin/sh

set -eu

service_name="calendar-pie.service"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_dir=$(dirname -- "$script_dir")
config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
unit_dir="$config_home/systemd/user"
unit_path="$unit_dir/$service_name"
data_dir="$data_home/calendar-pie"
database_path="$data_dir/calendar-pie.sqlite3"
legacy_database_path="$repository_dir/.data/calendar-pie.sqlite3"
staging_dir=""

cleanup() {
    if [ -n "$staging_dir" ] && [ -d "$staging_dir" ]; then
        rm -rf -- "$staging_dir"
    fi
}

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

escape_systemd_value() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g'
}

trap cleanup EXIT HUP INT TERM

[ "$(uname -s)" = "Linux" ] || fail "This deployment script only supports Linux."
[ "$(id -u)" -ne 0 ] || fail "Run this script as the account that displays the clock, not with sudo."

require_command curl
require_command git
require_command node
require_command npm
require_command python3
require_command sed
require_command systemctl

cd "$repository_dir"
[ -f package-lock.json ] || fail "Run this script from a Calendar Pie checkout."
[ -f requirements.txt ] || fail "requirements.txt is missing."
git diff --quiet && git diff --cached --quiet \
    || fail "Commit or discard tracked changes before deploying."
if [ -f "$legacy_database_path" ] && [ ! -f "$database_path" ]; then
    fail "An existing .data database needs to be migrated; see docs/DEPLOYMENT.md."
fi
if ! systemctl --user is-active --quiet "$service_name" \
    && curl --fail --silent http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
    fail "Port 8765 is already served outside the managed service; stop the old process first."
fi

staging_dir=$(mktemp -d "$repository_dir/.deploy.XXXXXX")

printf '%s\n' "Installing frontend dependencies..."
npm ci

printf '%s\n' "Building the frontend..."
npm run build -- --outDir "$staging_dir/dist"

if [ ! -x .venv/bin/python ]; then
    printf '%s\n' "Creating the Python virtual environment..."
    python3 -m venv .venv
fi

printf '%s\n' "Installing service dependencies..."
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt

mkdir -p "$data_dir" "$unit_dir"
chmod 700 "$data_dir"

repository_unit_value=$(escape_systemd_value "$repository_dir")
python_unit_value=$(escape_systemd_value "$repository_dir/.venv/bin/python")
data_unit_value=$(escape_systemd_value "$data_dir")

cat > "$unit_path" <<EOF
[Unit]
Description=Calendar Pie local calendar service

[Service]
Type=simple
WorkingDirectory="$repository_unit_value"
ExecStart="$python_unit_value" -m calendar_pie --data-dir "$data_unit_value"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

# Keep the live assets intact until the replacement build has completed.
if [ -d dist ]; then
    mv dist "$staging_dir/previous-dist"
fi
if ! mv "$staging_dir/dist" dist; then
    if [ -d "$staging_dir/previous-dist" ]; then
        mv "$staging_dir/previous-dist" dist
    fi
    fail "Could not activate the frontend build."
fi

printf '%s\n' "Restarting the service..."
systemctl --user daemon-reload
systemctl --user enable "$service_name" >/dev/null
if ! systemctl --user restart "$service_name"; then
    systemctl --user --no-pager --full status "$service_name" >&2 || true
    fail "The service could not be restarted."
fi

if ! curl --fail --silent --show-error --retry 10 --retry-delay 1 \
    --retry-connrefused http://127.0.0.1:8765/api/health >/dev/null; then
    systemctl --user --no-pager --full status "$service_name" >&2 || true
    fail "The service did not pass its health check."
fi
if ! systemctl --user is-active --quiet "$service_name"; then
    systemctl --user --no-pager --full status "$service_name" >&2 || true
    fail "The service stopped after its health check."
fi

printf '%s\n' "Calendar Pie is running at http://127.0.0.1:8765."
