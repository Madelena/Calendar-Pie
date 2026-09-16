"""Run Calendar Pie locally: python -m calendar_pie."""

import argparse
from pathlib import Path
import signal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def main():
    from tzlocal import get_localzone_name
    from waitress import create_server
    from .app import create_app

    parser = argparse.ArgumentParser(description="Calendar Pie local calendar service")
    parser.add_argument("--host", default="127.0.0.1", choices=("127.0.0.1", "localhost", "::1"))
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--data-dir", default=".data", type=Path)
    parser.add_argument("--timezone", default=get_localzone_name())
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535.")
    try:
        ZoneInfo(args.timezone)
    except (ValueError, ZoneInfoNotFoundError):
        parser.error("Use a valid IANA timezone.")
    app = create_app(args.data_dir / "calendar-pie.sqlite3", timezone=args.timezone, start_worker=True)
    service = app.extensions["calendar_sync"]
    server = None

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        server = create_server(app, host=args.host, port=args.port, threads=4,
                               clear_untrusted_proxy_headers=True)
        print(f"Calendar Pie is available at http://{'[' + args.host + ']' if ':' in args.host else args.host}:{args.port}")
        server.run()
    except KeyboardInterrupt:
        pass
    finally:
        service.stop()
        if server is not None:
            server.close()


if __name__ == "__main__":
    main()
