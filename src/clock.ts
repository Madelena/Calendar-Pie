export type Span = 12 | 24;
export interface Calendar { id: string; name: string; color: string }
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  location?: string;
  description?: string;
}
export interface ClockWindow { start: Date; end: Date; span: Span }
export interface Segment {
  event: CalendarEvent;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function clockWindow(now: Date, span: Span, offset = 0): ClockWindow {
  const start = new Date(now);
  start.setHours(span === 24 ? 0 : Math.floor(now.getHours() / 12) * 12, 0, 0, 0);
  start.setHours(start.getHours() + offset * span);
  const end = new Date(start);
  end.setHours(end.getHours() + span);
  return { start, end, span };
}

export function rollingWindow(now: Date, span: Span, historyHours = 3, offset = 0): ClockWindow {
  const start = new Date(now);
  start.setHours(start.getHours() - historyHours + offset * span);
  const end = new Date(start);
  end.setHours(end.getHours() + span);
  return { start, end, span };
}

export function validTimed(event: CalendarEvent): boolean {
  return !event.allDay && Number.isFinite(+event.start) && Number.isFinite(+event.end) && +event.end > +event.start;
}

export function nextEvent(events: CalendarEvent[], now: Date): CalendarEvent | undefined {
  return events.filter(event => validTimed(event) && +event.start > +now)
    .sort((a, b) => +a.start - +b.start || a.id.localeCompare(b.id))[0];
}

export function hasClockChange(window: ClockWindow): boolean {
  return window.start.getTimezoneOffset() !== new Date(+window.end - 1).getTimezoneOffset();
}

export function angleAt(date: Date, span: Span): number {
  return ((date.getHours() % span) * 60 + date.getMinutes() + date.getSeconds() / 60) / (span * 60) * 360;
}

// Keep angles continuous when a rolling window crosses twelve or midnight.
export function angleInWindow(date: Date, window: ClockWindow): number {
  return angleAt(window.start, window.span) + (+date - +window.start) / (window.span * 3_600_000) * 360;
}

// Assign lanes within each connected overlap group. Adjacent events can share a lane.
export function layoutEvents(events: CalendarEvent[], window: ClockWindow): Segment[] {
  const segments: Segment[] = events.filter(event => validTimed(event) && +event.start < +window.end && +event.end > +window.start)
    .map(event => ({
      event,
      start: angleInWindow(new Date(Math.max(+event.start, +window.start)), window),
      end: angleInWindow(new Date(Math.min(+event.end, +window.end)), window),
      lane: 0, lanes: 1,
      continuesBefore: +event.start < +window.start,
      continuesAfter: +event.end > +window.end,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));

  let group: Segment[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const finish = () => group.forEach(segment => { segment.lanes = laneEnds.length; });
  for (const segment of segments) {
    if (segment.start >= groupEnd) {
      finish();
      group = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex(end => end <= segment.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = segment.end;
    segment.lane = lane;
    group.push(segment);
    groupEnd = Math.max(...laneEnds);
  }
  finish();
  return segments;
}

export function point(angle: number, radius: number): [number, number] {
  const radians = (angle - 90) * Math.PI / 180;
  return [360 + Math.cos(radians) * radius, 360 + Math.sin(radians) * radius];
}

export function arcPath(start: number, end: number, radius: number, reverse = false): string {
  // Two arcs also handle a complete revolution, which one SVG arc cannot represent.
  const from = reverse ? end : start;
  const to = reverse ? start : end;
  const middle = (from + to) / 2;
  const sweep = reverse ? 0 : 1;
  return `M ${point(from, radius)} A ${radius} ${radius} 0 0 ${sweep} ${point(middle, radius)} A ${radius} ${radius} 0 0 ${sweep} ${point(to, radius)}`;
}

export function sectorPath(start: number, end: number, inner: number, outer: number): string {
  return `${arcPath(start, end, outer)} L ${point(end, inner)} ${arcPath(start, end, inner, true).replace(/^M [^A]+/, '')} Z`;
}

export function remainingArc(events: CalendarEvent[], now: Date, window: ClockWindow): { start: number; end: number; event: CalendarEvent; target: Date } | undefined {
  // With overlapping current events, count down to the first one that finishes.
  const current = events.filter(event => validTimed(event) && +event.start <= +now && +event.end > +now)
    .sort((a, b) => +a.end - +b.end || a.id.localeCompare(b.id))[0];
  const event = current ?? nextEvent(events, now);
  const target = current ? current.end : event?.start;
  // Only show countdowns within this window and without a clock-change ambiguity.
  if (!event || !target || hasClockChange(window) || +now < +window.start || +now >= +window.end || +target > +window.end || (!current && +target === +window.end)) return;
  return { start: angleInWindow(now, window), end: angleInWindow(target, window), event, target };
}
