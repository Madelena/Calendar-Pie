import assert from 'node:assert/strict';
import test from 'node:test';
import { clockWindow, rollingWindow } from '../src/clock.ts';
import type { CalendarEvent } from '../src/clock.ts';
import { durationSegments } from '../src/durations.ts';

const at = (hour: number, minute = 0) => new Date(2026, 0, 15, hour, minute);
const event = (id: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id, calendarId: 'test', title: id, start, end, ...extra });

test('partially overlapping events split into 30, 15, and 45 minute segments', () => {
  const events = [event('A', at(9), at(9, 45)), event('B', at(9, 30), at(10, 30))];
  const segments = durationSegments(events, clockWindow(at(10), 12));
  assert.deepEqual(segments.map(segment => [(+segment.end - +segment.start) / 60_000, segment.eventIds]), [
    [30, ['A']], [15, ['A', 'B']], [45, ['B']],
  ]);
  assert.deepEqual(segments.map(segment => [segment.startAngle, segment.endAngle]), [[270, 285], [285, 292.5], [292.5, 315]]);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end]), [
    [at(9), at(9, 30)], [at(9, 30), at(9, 45)], [at(9, 45), at(10, 30)],
  ]);
});

test('adjacent events retain their shared boundary without a zero interval', () => {
  const segments = durationSegments([event('A', at(9), at(10)), event('B', at(10), at(11))], clockWindow(at(10), 12));
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.eventIds]), [
    [at(9), at(10), ['A']], [at(10), at(11), ['B']],
  ]);
});

test('nested events and tied boundaries produce stable sorted membership', () => {
  const events = [event('Z', at(8), at(12)), event('B', at(9), at(11)), event('A', at(9), at(10)), event('C', at(10), at(11))];
  const window = clockWindow(at(10), 12);
  const segments = durationSegments(events, window);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.eventIds]), [
    [at(8), at(9), ['Z']], [at(9), at(10), ['A', 'B', 'Z']],
    [at(10), at(11), ['B', 'C', 'Z']], [at(11), at(12), ['Z']],
  ]);
  assert.deepEqual(durationSegments([...events].reverse(), window), segments);
});

test('gaps are retained while all-day events and invalid durations are excluded', () => {
  const segments = durationSegments([
    event('early', at(8), at(9)), event('late', at(10), at(11)),
    event('all-day', at(0), at(24), { allDay: true }),
    event('bad-start', new Date(NaN), at(11)), event('bad-end', at(9), new Date(NaN)),
    event('zero', at(9), at(9)), event('reversed', at(10), at(9)),
  ], clockWindow(at(10), 12));
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.eventIds]), [
    [at(8), at(9), ['early']], [at(9), at(10), []], [at(10), at(11), ['late']],
  ]);
  assert.deepEqual(durationSegments([], clockWindow(at(10), 12)), []);
});

test('a nested overlap is followed by a gap only after the outer event ends', () => {
  const segments = durationSegments([
    event('outer', at(8), at(10)), event('inner', at(8, 30), at(9)),
    event('later', at(11), at(11, 30)),
  ], clockWindow(at(10), 12));
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.eventIds]), [
    [at(8), at(8, 30), ['outer']], [at(8, 30), at(9), ['inner', 'outer']],
    [at(9), at(10), ['outer']], [at(10), at(11), []], [at(11), at(11, 30), ['later']],
  ]);
});

test('an empty visible day and a lone event do not manufacture edge gaps', () => {
  const window = clockWindow(at(10), 12);
  assert.deepEqual(durationSegments([
    event('before', at(-2), at(0)), event('after', at(12), at(14)),
    event('all-day', at(0), at(24), { allDay: true }),
    event('zero', at(9), at(9)),
  ], window), []);
  const segments = durationSegments([event('only', at(9), at(10))], window);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.eventIds]), [
    [at(9), at(10), ['only']],
  ]);
});

test('clipping excludes outside events and boundary-only contact', () => {
  const segments = durationSegments([
    event('full', at(-1), at(13)), event('before', at(-2), at(0)), event('after', at(12), at(14)),
  ], clockWindow(at(10), 12));
  assert.deepEqual(segments, [{ start: at(0), end: at(12), startAngle: 0, endAngle: 360, eventIds: ['full'] }]);
});

test('rolling overnight windows clip segments and preserve continuous angles past midnight', () => {
  const window = rollingWindow(at(23), 12);
  const segments = durationSegments([
    event('A', at(19), at(24, 30)), event('B', at(24), at(33)),
  ], window);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.startAngle, segment.endAngle, segment.eventIds]), [
    [at(20), at(24), 240, 360, ['A']],
    [at(24), at(24, 30), 360, 375, ['A', 'B']],
    [at(24, 30), at(32), 375, 600, ['B']],
  ]);
});

test('gaps across midnight keep continuous angles between clipped events', () => {
  const segments = durationSegments([
    event('early', at(19), at(23)), event('late', at(25), at(33)),
    event('outside', at(34), at(35)),
  ], rollingWindow(at(23), 12));
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.startAngle, segment.endAngle, segment.eventIds]), [
    [at(20), at(23), 240, 330, ['early']],
    [at(23), at(25), 330, 390, []],
    [at(25), at(32), 390, 600, ['late']],
  ]);
});
