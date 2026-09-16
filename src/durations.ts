import { angleInWindow, validTimed } from './clock.ts';
import type { CalendarEvent, ClockWindow } from './clock.ts';

export interface DurationSegment {
  start: Date;
  end: Date;
  startAngle: number;
  endAngle: number;
  eventIds: string[];
}

// Every visible event boundary splits the interval, retaining gaps between events.
export function durationSegments(events: CalendarEvent[], window: ClockWindow): DurationSegment[] {
  const clipped = events.filter(validTimed).map(event => ({
    id: event.id,
    start: Math.max(+event.start, +window.start),
    end: Math.min(+event.end, +window.end),
  })).filter(event => event.start < event.end);
  const boundaries = [...new Set(clipped.flatMap(event => [event.start, event.end]))].sort((a, b) => a - b);
  const segments: DurationSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const from = boundaries[index];
    const to = boundaries[index + 1];
    const eventIds = [...new Set(clipped.filter(event => event.start < to && event.end > from).map(event => event.id))].sort();
    const start = new Date(from);
    const end = new Date(to);
    segments.push({ start, end, startAngle: angleInWindow(start, window), endAngle: angleInWindow(end, window), eventIds });
  }
  return segments;
}
