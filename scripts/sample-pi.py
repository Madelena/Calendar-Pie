#!/usr/bin/env python3
"""Sample Linux system memory and swap counters as CSV; standard library only."""

import argparse
import csv
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import time


def read_counters(path):
    values = {}
    for line in Path(path).read_text(encoding="ascii").splitlines():
        fields = line.split()
        if len(fields) >= 2:
            values[fields[0].rstrip(":")] = int(fields[1])
    return values


def sample():
    memory = read_counters("/proc/meminfo")
    swaps = read_counters("/proc/vmstat")
    return {
        "mem_total_kib": memory["MemTotal"],
        "mem_available_kib": memory["MemAvailable"],
        "swap_total_kib": memory["SwapTotal"],
        "swap_used_kib": memory["SwapTotal"] - memory["SwapFree"],
        "swap_in_pages_total": swaps["pswpin"],
        "swap_out_pages_total": swaps["pswpout"],
    }


def positive(value):
    number = float(value)
    if not 0 < number < float("inf"):
        raise argparse.ArgumentTypeError("must be a finite positive number")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=positive, default=5, help="seconds between samples (default: 5)")
    parser.add_argument("--duration", type=positive, help="run for this many seconds; default: until Ctrl+C")
    parser.add_argument("--output", default="-", help="CSV filename, or - for stdout (default)")
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        parser.error("this sampler requires Linux /proc; run it on the Raspberry Pi")

    stream = sys.stdout if args.output == "-" else open(args.output, "w", newline="", encoding="utf-8")
    started = time.monotonic()
    previous = None
    fields = ["utc", "elapsed_seconds", "sample_seconds", "mem_total_kib", "mem_available_kib",
              "swap_total_kib", "swap_used_kib", "page_bytes", "swap_in_pages_total", "swap_out_pages_total",
              "swap_in_pages_delta", "swap_out_pages_delta"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    try:
        while True:
            tick = time.monotonic()
            values = sample()
            row = {"utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "elapsed_seconds": round(tick - started, 3),
                   "sample_seconds": round(tick - previous[0], 3) if previous else "",
                   "page_bytes": os.sysconf("SC_PAGE_SIZE"), **values}
            for direction in ("in", "out"):
                key = f"swap_{direction}_pages_total"
                row[f"swap_{direction}_pages_delta"] = values[key] - previous[1][key] if previous else ""
            writer.writerow(row)
            stream.flush()
            previous = (tick, values)
            elapsed = time.monotonic() - started
            if args.duration is not None and elapsed >= args.duration:
                break
            delay = max(0, args.interval - (time.monotonic() - tick))
            if args.duration is not None:
                delay = min(delay, max(0, args.duration - elapsed))
            time.sleep(delay)
    except KeyboardInterrupt:
        pass
    except (OSError, KeyError, ValueError) as error:
        print(f"Unable to sample Linux counters: {error}", file=sys.stderr)
        return 1
    finally:
        if stream is not sys.stdout:
            stream.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
