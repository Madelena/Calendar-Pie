import assert from 'node:assert/strict';
import test from 'node:test';
import { rollingWindow } from '../src/clock.ts';
import { dialLabels } from '../src/dial-labels.ts';

const now = (hour: number, minute = 30) => new Date(2026, 8, 16, hour, minute);

test('morning window labels the past and future sides of the seam and noon', () => {
  const labels = dialLabels(rollingWindow(now(10), 12), '12');
  assert.deepEqual(labels.filter(label => label.period).map(label => [label.hour, label.period]), [
    ['12', 'PM'], ['7', 'PM'], ['8', 'AM'],
  ]);
  assert.equal(labels[7].date.getHours(), 19);
  assert.equal(labels[8].date.getHours(), 8);
  assert.equal(labels[9].accessibleLabel, '9 AM');
});

test('afternoon window maps numerals to evening and the following morning', () => {
  const labels = dialLabels(rollingWindow(now(16), 12), '12');
  assert.deepEqual(labels.filter(label => label.period).map(label => [label.hour, label.period]), [
    ['12', 'AM'], ['1', 'AM'], ['2', 'PM'],
  ]);
  assert.equal(labels[0].date.getDate(), 17);
  assert.equal(labels[2].date.getHours(), 14);
});

test('midnight window preserves the date and period of each side', () => {
  const labels = dialLabels(rollingWindow(now(1), 12), '12');
  assert.equal(labels[11].date.getDate(), 15);
  assert.equal(labels[11].period, 'PM');
  assert.equal(labels[0].date.getDate(), 16);
  assert.equal(labels[0].period, 'AM');
  assert.equal(labels[10].period, 'AM');
});

test('an exact seam includes its starting numeral and excludes the ending occurrence', () => {
  const window = rollingWindow(now(10, 0), 12);
  const labels = dialLabels(window, '12');
  assert.equal(+labels[7].date, +window.start);
  assert.equal(labels[7].period, 'AM');
  assert.equal(labels[6].period, 'PM');
  assert.ok(labels.every(label => +label.date >= +window.start && +label.date < +window.end));
});

test('time format is independent of the twelve or twenty-four hour span', () => {
  for (const span of [12, 24] as const) {
    const window = rollingWindow(now(16), span);
    const twelve = dialLabels(window, '12');
    const twentyFour = dialLabels(window, '24');
    assert.equal(twelve.length, 12);
    assert.deepEqual(twelve.map(label => label.angle), Array.from({ length: 12 }, (_, i) => i * 30));
    assert.deepEqual(twelve.map(label => +label.date), twentyFour.map(label => +label.date));
    assert.ok(twentyFour.every(label => label.period === '' && label.hour === String(label.date.getHours())));
    assert.ok(twentyFour.every(label => label.accessibleLabel === `${label.date.getHours()}:00`));
    assert.ok(twelve.every(label => label.hour === String(label.date.getHours() % 12 || 12)));
    assert.ok(twelve.every(label => +label.date >= +window.start && +label.date < +window.end));
  }
  const labels = dialLabels(rollingWindow(now(16), 24), '12');
  assert.deepEqual(labels.filter(label => label.period).map(label => [label.hour, label.period]), [
    ['12', 'AM'], ['12', 'PM'], ['2', 'PM'],
  ]);
});

test('zero history and browsing retain period cues at the window seam', () => {
  for (const offset of [-1, 0, 1]) {
    const window = rollingWindow(now(16), 12, 0, offset);
    const labels = dialLabels(window, '12').sort((a, b) => +a.date - +b.date);
    assert.ok(labels[0].period);
    assert.ok(labels[11].period);
    assert.ok(labels.every(label => +label.date >= +window.start && +label.date < +window.end));
  }
});
