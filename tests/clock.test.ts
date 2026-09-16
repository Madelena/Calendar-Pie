import assert from 'node:assert/strict';
import test from 'node:test';
import { angleAt, angleInWindow, arcPath, clockWindow, layoutEvents, nextEvent, remainingArc, rollingWindow, sectorPath, validTimed } from '../src/clock.ts';
import type { CalendarEvent } from '../src/clock.ts';

// Local dates keep wall-clock geometry independent of the machine's timezone.
const at = (hour: number, minute = 0) => new Date(2026, 0, 15, hour, minute);
const event = (id: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id, calendarId: 'test', title: id, start, end, ...extra });

test('12-hour windows select the local half-day, including noon and navigation across midnight', () => {
  const morning = clockWindow(at(10), 12);
  assert.equal(+morning.start, +at(0));
  assert.equal(+morning.end, +at(12));
  const afternoon = clockWindow(at(12), 12);
  assert.equal(+afternoon.start, +at(12));
  assert.equal(+afternoon.end, +at(24));
  assert.equal(+clockWindow(at(23), 12, 1).start, +at(24));
  assert.equal(+clockWindow(at(1), 12, -1).start, +at(-12));
});

test('24-hour window and angles follow local clock positions', () => {
  const window = clockWindow(at(19), 24);
  assert.equal(+window.start, +at(0));
  assert.equal(+window.end, +at(24));
  assert.equal(angleAt(at(3), 12), 90);
  assert.equal(angleAt(at(12), 24), 180);
  assert.equal(angleAt(at(10, 30), 12), 315);
  assert.equal(angleAt(at(10, 30), 24), 157.5);
});

test('events clip at noon, flag continuation, and exclude boundary-only contact', () => {
  const events = [event('across-noon', at(11), at(13)), event('ended', at(-1), at(0)), event('later', at(12), at(14))];
  const morning = layoutEvents(events, clockWindow(at(10), 12));
  assert.equal(morning.length, 1);
  assert.deepEqual([morning[0].start, morning[0].end, morning[0].continuesBefore, morning[0].continuesAfter], [330, 360, false, true]);
  const afternoon = layoutEvents([events[0]], clockWindow(at(12), 12))[0];
  assert.deepEqual([afternoon.start, afternoon.end, afternoon.continuesBefore, afternoon.continuesAfter], [0, 30, true, false]);
});

test('overnight events occupy the correct ends of consecutive local days', () => {
  const overnight = event('overnight', at(23, 30), at(24, 30));
  const today = layoutEvents([overnight], clockWindow(at(23), 24))[0];
  const tomorrow = layoutEvents([overnight], clockWindow(at(24), 24))[0];
  assert.deepEqual([today.start, today.end, today.continuesBefore, today.continuesAfter], [352.5, 360, false, true]);
  assert.deepEqual([tomorrow.start, tomorrow.end, tomorrow.continuesBefore, tomorrow.continuesAfter], [0, 7.5, true, false]);
});

test('an event covering the window produces a full revolution', () => {
  const segment = layoutEvents([event('long', at(-1), at(25))], clockWindow(at(10), 24))[0];
  assert.deepEqual([segment.start, segment.end, segment.continuesBefore, segment.continuesAfter], [0, 360, true, true]);
  const exact = layoutEvents([event('exact', at(0), at(24))], clockWindow(at(10), 24))[0];
  assert.equal(exact.continuesBefore, false);
  assert.equal(exact.continuesAfter, false);
});

test('full-circle SVG paths traverse both halves and close the annular sector', () => {
  const path = arcPath(0, 360, 100);
  const numbers = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  assert.equal((path.match(/ A /g) ?? []).length, 2);
  // Start at twelve, pass six, and return to twelve: a single arc would disappear.
  assert.deepEqual(numbers.slice(0, 2), [360, 260]);
  assert.deepEqual(numbers.slice(7, 9), [360, 460]);
  assert.ok(Math.abs(numbers[14] - 360) < 1e-9);
  assert.equal(numbers[15], 260);
  const sector = sectorPath(0, 360, 80, 100);
  assert.equal((sector.match(/ A /g) ?? []).length, 4);
  assert.match(sector, /A 80 80 0 0 0/);
  assert.ok(sector.endsWith(' Z'));
  assert.doesNotMatch(sector, /NaN|Infinity/);
});

test('connected overlaps share group width, reuse available lanes, and reset after a gap', () => {
  const events = [event('a', at(8), at(10)), event('b', at(9), at(11)), event('c', at(10), at(12)), event('d', at(13), at(14))];
  const segments = layoutEvents(events, clockWindow(at(10), 24));
  assert.deepEqual(segments.map(s => [s.event.id, s.lane, s.lanes]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1]]);
});

test('simultaneous events get separate lanes and results do not depend on input order', () => {
  const events = [event('b', at(9), at(10)), event('long', at(9), at(11)), event('a', at(9), at(10))];
  const window = clockWindow(at(10), 12);
  const result = layoutEvents(events, window);
  assert.deepEqual(result.map(s => [s.event.id, s.lane, s.lanes]), [['long', 0, 3], ['a', 1, 3], ['b', 2, 3]]);
  assert.deepEqual(layoutEvents([...events].reverse(), window), result);
});

test('all-day, invalid, zero-length, and reversed events are excluded throughout', () => {
  const invalid = [
    event('all-day', at(0), at(24), { allDay: true }),
    event('bad-start', new Date(NaN), at(11)),
    event('bad-end', at(11), new Date(NaN)),
    event('zero', at(11), at(11)),
    event('reversed', at(11), at(10)),
  ];
  assert.ok(invalid.every(e => !validTimed(e)));
  assert.deepEqual(layoutEvents(invalid, clockWindow(at(10), 12)), []);
  assert.equal(nextEvent(invalid, at(10)), undefined);
  assert.equal(remainingArc(invalid, at(10), clockWindow(at(10), 12)), undefined);
});

test('next event ignores ongoing events, resolves ties consistently, and crosses day boundaries', () => {
  const events = [event('ongoing', at(9), at(12)), event('starting-now', at(10), at(11)), event('b', at(11), at(12)), event('a', at(11), at(13))];
  const original = [...events];
  assert.equal(nextEvent(events, at(10))?.id, 'a');
  assert.deepEqual(events, original);
  assert.equal(nextEvent([event('tomorrow', at(25), at(26))], at(23))?.id, 'tomorrow');
  assert.equal(nextEvent(events, at(14)), undefined);
});

test('remaining arc connects now to an upcoming event inside the selected window', () => {
  const upcoming = event('next', at(10, 30), at(11));
  const result = remainingArc([upcoming], at(10), clockWindow(at(10), 12));
  assert.deepEqual(result, { start: 300, end: 315, event: upcoming, target: upcoming.start });
  assert.deepEqual(remainingArc([event('first', at(1), at(2))], at(0), clockWindow(at(0), 12))?.start, 0);
});

test('remaining arc hides at window boundaries, for another window, and without a future event', () => {
  const window = clockWindow(at(10), 12);
  const boundary = event('noon', at(12), at(13));
  assert.equal(nextEvent([boundary], at(10)), boundary);
  assert.equal(remainingArc([boundary], at(10), window), undefined);
  assert.equal(remainingArc([event('later', at(13), at(14))], at(12), window), undefined);
  assert.equal(remainingArc([event('early', at(1), at(2))], at(-1), window), undefined);
  assert.equal(remainingArc([], at(10), window), undefined);
});

test('remaining arc counts down to the active event end even when another event starts sooner', () => {
  const current = event('current', at(9), at(11));
  const upcoming = event('upcoming', at(10, 15), at(11, 30));
  const result = remainingArc([upcoming, current], at(10), clockWindow(at(10), 12));
  assert.deepEqual(result, { start: 300, end: 330, event: current, target: current.end });
});

test('overlapping active events count down to the earliest end with stable tie breaking', () => {
  const events = [event('long', at(9), at(12)), event('b', at(10), at(11)), event('a', at(9, 30), at(11))];
  const window = clockWindow(at(10), 12);
  assert.equal(remainingArc(events, at(10), window)?.event.id, 'a');
  assert.deepEqual(remainingArc([...events].reverse(), at(10), window), remainingArc(events, at(10), window));
  assert.deepEqual(events.map(item => item.id), ['long', 'b', 'a']);
});

test('countdown switches at event start and end, including back-to-back events', () => {
  const first = event('first', at(9), at(10));
  const second = event('second', at(10), at(11));
  const later = event('later', at(11, 30), at(12));
  const events = [first, second, later];
  const window = clockWindow(at(10), 12);
  assert.equal(remainingArc(events, at(9), window)?.target, first.end);
  assert.equal(remainingArc(events, at(10), window)?.target, second.end);
  assert.equal(remainingArc(events, at(11), window)?.target, later.start);
  assert.equal(remainingArc(events, at(12), rollingWindow(at(12), 12)), undefined);
});

test('active countdown crosses midnight and reaches the visible window end', () => {
  const overnight = event('overnight', at(23), at(25));
  const result = remainingArc([overnight], at(23, 30), rollingWindow(at(23, 30), 12));
  assert.deepEqual(result, { start: 345, end: 390, event: overnight, target: overnight.end });
  const noon = event('until-noon', at(11), at(12));
  assert.equal(remainingArc([noon], at(11, 30), clockWindow(at(11, 30), 12))?.end, 360);
});

test('rolling windows preserve clock precision and cross noon with three hours of history', () => {
  const now = new Date(2026, 0, 15, 10, 10, 25, 500);
  const original = +now;
  const window = rollingWindow(now, 12);
  assert.equal(+window.start, +new Date(2026, 0, 15, 7, 10, 25, 500));
  assert.equal(+window.end, +new Date(2026, 0, 15, 19, 10, 25, 500));
  assert.equal(+now, original);
  assert.equal(+rollingWindow(now, 12, 3, 1).start, +window.end);
});

test('rolling windows cross midnight and support zero history and previous periods', () => {
  const window = rollingWindow(at(1, 15), 24);
  assert.equal(+window.start, +at(-2, 15));
  assert.equal(+window.end, +at(22, 15));
  const future = rollingWindow(at(23, 30), 12, 0);
  assert.equal(+future.start, +at(23, 30));
  assert.equal(+future.end, +at(35, 30));
  assert.equal(+rollingWindow(at(23, 30), 12, 0, -1).end, +future.start);
});

test('rolling event geometry clips to continuous angles across twelve', () => {
  const window = rollingWindow(at(10, 10), 12);
  assert.equal(angleInWindow(window.start, window), 215);
  assert.equal(angleInWindow(at(12), window), 360);
  assert.equal(angleInWindow(window.end, window), 575);
  const segments = layoutEvents([
    event('cover', at(6), at(20)),
    event('noon', at(11), at(13)),
    event('at-end', at(19, 10), at(20)),
  ], window);
  assert.deepEqual(segments.map(s => [s.event.id, s.start, s.end]), [['cover', 215, 575], ['noon', 330, 390]]);
  assert.equal(segments[0].continuesBefore, true);
  assert.equal(segments[0].continuesAfter, true);
});

test('rolling countdown reaches upcoming events across noon and midnight', () => {
  const noonEvent = event('afternoon', at(13), at(14));
  assert.deepEqual(remainingArc([noonEvent], at(11), rollingWindow(at(11), 12)), {
    start: 330, end: 390, event: noonEvent, target: noonEvent.start,
  });
  const midnightEvent = event('tomorrow', at(25), at(26));
  assert.deepEqual(remainingArc([midnightEvent], at(23), rollingWindow(at(23), 24)), {
    start: 345, end: 375, event: midnightEvent, target: midnightEvent.start,
  });
});
