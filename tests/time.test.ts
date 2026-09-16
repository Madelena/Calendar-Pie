import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeParts } from '../src/time.ts';

test('24-hour times use H:mm, including midnight and single-digit hours', () => {
  for (const [hour, expected] of [[0, '0:05'], [9, '9:05'], [13, '13:05'], [23, '23:05']] as const) {
    assert.equal(timeParts(new Date(2026, 0, 15, hour, 5), '24').map(part => part.value).join(''), expected);
  }
});

test('12-hour times retain the day period and optional timezone annotation', () => {
  const parts = timeParts(new Date(2026, 0, 15, 13, 5), '12', 'shortOffset');
  assert.equal(parts.find(part => part.type === 'hour')?.value, '1');
  assert.equal(parts.find(part => part.type === 'minute')?.value, '05');
  assert.ok(parts.find(part => part.type === 'dayPeriod'));
  assert.ok(parts.find(part => part.type === 'timeZoneName'));
});
