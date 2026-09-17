# Design

Calendar Pie turns scheduled time into a clock face. It is intended for people who need to understand a busy day quickly, including people with ADHD. The interface should reduce interpretation work without claiming a medical benefit.

The visual reference is [Sectograph](https://play.google.com/store/apps/details?id=prox.lab.calclock), adapted for an always-visible, round touch display.

## Product shape

- Target display: a 4-inch, 720 × 720 round screen on a Raspberry Pi Zero 2 W.
- Primary kiosk view: clock and event details only.
- Configuration view: a regular desktop or phone browser, outside the round kiosk constraint.
- Input: touch for event details and swiping; mouse and keyboard remain supported in the desktop view.
- Data: multiple read-only ICS calendars. Each calendar has a distinct configurable color.
- All-day events are hidden in the current design.

Every visible kiosk element must fit within the circular screen. Corners of the square viewport are unavailable.

## Clock face

The center shows the current time and date. In 12-hour format, AM or PM appears as a smaller superscript immediately after the time. In 24-hour format, hours are not zero-padded: use `0:05` and `9:30`, not `00:05` or `09:30`.

Dial span and text format are independent settings:

| Dial span | Numerals in 12-hour format | Numerals in 24-hour format |
| --- | --- | --- |
| 12 hours | Conventional 1–12 positions | The actual 12 consecutive hours shown |
| 24 hours | Twelve numerals, two hours apart | `0, 2, 4 … 22` |

In 12-hour format, the numeral at noon and midnight includes AM or PM. The oldest and newest chronological numerals around the rolling-window seam also include AM or PM. These suffixes use the same size as the numeral and the complete label must remain visible.

Light radial lines mark each hour and lighter lines mark half hours. Hour lines have short stubs beside their numerals. Tick marks and circular ring outlines describe the clock structure. A thin radial line, using the hourly-line color, marks the end of the visible future window.

The window navigation control has a fixed width so its previous and next buttons do not move when the date or time-range label changes.

## Events

Events occupy pie slices whose angles match their start and end times. The event area extends through the space traditionally reserved for clock numerals, giving titles as much room as possible.

Each calendar uses its configured slice color. Sample calendar colors are deliberately saturated enough to remain distinguishable. A darker outer edge carries white start and end times when the slice is wide enough. Exact times remain available in event details when they do not fit.

Event titles may use multiple lines. Wider slices place text along curved paths. Short events may rotate their titles radially when that fits more readable text, even though mixed orientations are less visually uniform. Readability takes priority.

Overlapping events use separate radial lanes. The clock preserves the identity and duration of every event rather than combining overlaps into one block.

## History and future

The default rolling window includes three hours of history. The user can configure the number of past hours, including zero.

Past event slices fade gradually toward the oldest visible time. The same fade applies to hour and half-hour lines, hour stubs, tick marks, ring outlines, and clock numerals. Numeral opacity is applied to each complete label so the fade boundary never cuts through a number or AM/PM suffix. Future labels remain fully visible. The end of the future window has its own thin boundary line.

Browsing another clock window shows that window without the current-history fade. Setting history to zero also removes the fade.

## Countdown and duration ring

The hour hand marks the current time. A thin accent-colored arc begins at the hand:

- During an event, it ends at that event's end and shows the remaining time.
- During overlapping active events, it targets the event that ends first.
- When no event is active, it ends at the next event's start.
- It is hidden when the target falls outside the displayed window.

The label uses hours and minutes, such as `0:30`, and sits directly on the arc.

The outer duration ring splits time at every event boundary. Overlaps therefore preserve each interval; events from 9:00–9:45 and 9:30–10:30 produce `0:30`, `0:15`, and `0:45`. Gaps between bounded events also show durations with dotted arcs. Do not show the gap containing the current time. Do not show duration segments containing a currently active event, because the countdown already describes that time.

Short intervals may use a dot when a readable duration label cannot fit. Every segment retains a practical touch target and opens either event details, an overlap chooser, or free-time details.

## Event details

Touching an event opens its title, calendar, date, start and end times, duration, location, and description. Text is centered horizontally and vertically and center-aligned. Event details retain the circular presentation and use the top close control. They do not include a redundant “Back to the Clock” button.

## Settings and navigation

Kiosk mode has no path to Settings. Center taps, holds, and keyboard input must leave Settings closed.

The regular browser view uses rectangular configuration dialogs that can use the available screen. The root title is simply **Settings**. A consistent **Back** control appears at the upper left:

- Settings → close the dialog and preserve the browsed clock window.
- Calendar sources → Settings.
- Add, edit, or delete a source → Calendar sources without applying unsaved changes.

The close control may dismiss the entire dialog stack. Settings do not duplicate the desktop agenda or include a return-to-current-window action; window navigation belongs to the clock toolbar.

## Color and typography

Light mode uses `#FFFFFF` backgrounds and `#000000` primary text. Dark mode uses true OLED black (`#000000`) backgrounds and `#FFFFFF` primary text. Secondary text, borders, grids, and inactive controls use neutral grays without an accent tint.

The default accent is Madelena pink, `#C30052`. The chosen accent hue applies consistently to the hand, countdown, active controls, focus indicators, and branding. It does not tint neutral UI text or surfaces. Calendar colors remain independent.

Inter is the default typeface. Open Sans, the system font, and an imported TTF, OTF, WOFF, or WOFF2 font are available. Bundled fonts work offline. Custom fonts stay in the current browser.

## Copy

Use functional screen names, labels, status messages, instructions, and errors. Do not add marketing slogans, decorative headings, motivational filler, or conversational empty-state copy unless specifically requested. Say `Settings`, `No events.`, or `No upcoming events.` directly.

This rule also appears in the repository's `AGENTS.md` so future interface work follows it.

## Planned appliance experience

The intended product will provide a phone-accessible setup portal for Wi-Fi credentials, timezone, ICS URLs, calendar colors, and other configuration. First boot should offer a protected setup network and a direct address when captive-portal detection fails. A failed home-network connection should restore setup mode.

These provisioning flows, LAN authentication, and enclosure behavior are design goals rather than implemented features. The Pi deployment script configures application and kiosk-browser startup and recovery with Cage, Chromium, and systemd user services. Current operation and limitations are documented in [DEPLOYMENT.md](DEPLOYMENT.md), while longer-term work remains in [PLAN.md](PLAN.md).
