# Raspberry Pi feasibility check

No hardware results exist yet. This procedure is for the actual Zero 2 W and 720 × 720 round USB-touch display after assembly. Desktop browser checks do not establish Pi performance.

## Prepare and record

Record the date, commit (`git rev-parse HEAD` on the build machine), Pi model, power supply, display/cabling, storage, OS image and architecture, desktop/compositor, browser version and launch flags, screen resolution/scaling, timezone, and any swap/zram configuration. Use an OS/browser combination supported by the installed image; a minimal graphical session is the intended baseline.

Verify the screen is 720 × 720, touch aligns across the circle, power is stable, and the clock is legible at its physical four-inch size. Keep all controls visible inside the circle. Record `uname -a`, `cat /etc/os-release`, `free -k`, and `cat /proc/swaps`. Check power/throttling status using the tools available on the installed Pi image, before and after load.

## Serve the production build

Build on the development machine with `npm install` and `npm run build`. Copy `dist/` and `scripts/sample-pi.py` to the Pi, retaining those directory names. From their parent directory on the Pi:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8080/?kiosk=1&diagnostics=1` in the installed browser's fullscreen/kiosk mode. For example, if its executable is `chromium`:

```sh
chromium --kiosk 'http://127.0.0.1:8080/?kiosk=1&diagnostics=1'
```

Run as an ordinary user in the graphical session. This temporary server is for the local prototype; no Node.js installation or development server is needed on the Pi. The final appliance service/startup configuration remains a later milestone.

## Measure memory and swap

Start the sampler before launching the browser, from a separate terminal:

```sh
python3 scripts/sample-pi.py --interval 5 --duration 86400 --output pi-memory.csv
```

Without `--duration`, Ctrl+C stops sampling cleanly. The CSV includes UTC timestamps, monotonic elapsed time, system `MemAvailable`, total/used swap, kernel cumulative swap-in/out page counters, and per-sample page deltas. Memory columns are KiB; `page_bytes` gives the byte size of each swapped page. The first deltas are blank because there is no preceding sample. Divide a delta by `sample_seconds` for pages per second. These are whole-system values, including the graphical session and browser, not JavaScript heap or per-process memory.

Record five minutes of idle baseline before the browser, then exercise every scenario, both dial spans and text formats, window navigation, event details, and repeated open/close interactions for at least ten minutes. Capture another idle period, then run live mode overnight for 24 hours. Note the UTC times of workload changes so they can be matched to the CSV. Watch minimum `MemAvailable`, sustained swap deltas, crashes, and an upward memory trend after the workload settles. Allocated swap alone does not prove active swapping; inspect the deltas. A zram swap device also appears in the swap counters, so record its configuration.

## Measure responsiveness and stability

Use diagnostics to record browser rendering measurements for idle and busy scenarios. Record how each reported measurement is defined in the current build. JavaScript/render timing is **not** physical touch-to-visible-response latency: it excludes some input dispatch, compositor, and display delay.

To inspect Rendering diagnostics, open the desktop preview at `http://127.0.0.1:8080/?diagnostics=1`, open Settings, and scroll to Rendering diagnostics. Kiosk mode has no settings entry point; center taps, holds, and keyboard input should leave the clock visible. `meanRenderMs` and `maxRenderMs` measure synchronous JavaScript work in a render. `maxInteractionFrameMs` runs from the delegated click handler to the next animation-frame callback, before paint; it is not a display-latency measurement. Metrics and uptime refresh on interactions/renders, not on a separate timer. Swipe to browse rolling clock windows. The desktop sidebar shows the selected day's agenda; click the clock window label to return to the current window. Settings and calendar source screens have a top-left Back button: source forms return to the source list, the source list returns to Settings, and Settings returns to the browsed clock window. Use the desktop preview to change preferences and select sample scenarios.

For the proposed 200 ms touch target, film the finger and display together at a known high frame rate (ideally 120 fps or more). Count frames from contact to the first visible response for at least 20 event opens and closes, including overlaps and short events. Report the frame-rate resolution and median/worst observed delay; retain the clips. An on-device timer alone cannot establish this end-to-end measurement.

Measure cold startup from power-on to a usable face separately from warm page reload. Test touch alignment, small event selection, long text scrolling, noon/midnight navigation, date changes in live mode, and recovery after a browser restart. Check the curved multiline titles and hours:minutes countdown at the actual display size. Verify that three hours of fading history is the default, changing the history survives a reload, and zero history removes the fade. Verify that center holds, short taps, and keyboard input cannot open settings, and that swipes and event details still work. Disconnect Wi-Fi after loading the local static face and verify that local interactions continue. This static-preview check tests local assets only. Repeat outage and recovery checks with the Python service running and real calendar sources configured to measure synchronization and SQLite cache recovery on the Pi.

## Decision record

The proposed targets from [PLAN.md](PLAN.md) are visible touch response within 200 ms, at least 80 MB `MemAvailable` during normal peak work, no sustained swapping, and a 24-hour run without crashes or increasing memory consumption. State whether MB is decimal when reporting results: 80,000,000 bytes is approximately 78,125 KiB; using 81,920 KiB as the threshold is a slightly stricter 80 MiB test.

Save the environment details, commit, CSV, timing samples, clips, and failure notes together. Report each target as pass/fail/not measured. The static prototype can justify continuing with the browser renderer, but final feasibility must be repeated with the calendar service running and the phone setup page exercised. If actual hardware misses the targets after bounded tuning, revisit the native renderer fallback in the plan.
