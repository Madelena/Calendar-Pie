import assert from 'node:assert/strict';
import test from 'node:test';
import { countdownText, wrapTitle } from '../src/labels.ts';

test('titles wrap on word boundaries and normalize whitespace', () => {
  assert.deepEqual(wrapTitle('  Weekly\n design   review  ', 13, 3), ['Weekly design', 'review']);
  assert.deepEqual(wrapTitle('Team meeting', 12, 1), ['Team meeting']);
  assert.deepEqual(wrapTitle('Alpha beta gamma', 5, 3), ['Alpha', 'beta', 'gamma']);
});

test('overlong words split across lines without breaking surrogate pairs', () => {
  assert.deepEqual(wrapTitle('abcdefghij', 4, 3), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapTitle('😀😀😀😀😀', 2, 3), ['😀😀', '😀😀', '😀']);
});

test('only the last available title line is ellipsized when text remains', () => {
  assert.deepEqual(wrapTitle('Alpha beta gamma delta', 10, 2), ['Alpha beta', 'gamma del…']);
  assert.deepEqual(wrapTitle('abcdefghijk', 4, 2), ['abcd', 'efg…']);
  assert.deepEqual(wrapTitle('ab', 1, 1), ['…']);
  assert.deepEqual(wrapTitle('a', 1, 1), ['a']);
});

test('empty titles or unavailable space produce no title lines', () => {
  assert.deepEqual(wrapTitle(' \t ', 10, 2), []);
  assert.deepEqual(wrapTitle('Meeting', 0, 2), []);
  assert.deepEqual(wrapTitle('Meeting', 10, 0), []);
});

test('countdown rounds positive time up to the minute and clamps elapsed time', () => {
  assert.equal(countdownText(-1), '0:00');
  assert.equal(countdownText(0), '0:00');
  assert.equal(countdownText(1), '0:01');
  assert.equal(countdownText(60_000), '0:01');
  assert.equal(countdownText(60_001), '0:02');
  assert.equal(countdownText(20 * 60_000), '0:20');
});

test('countdown carries minutes into hours and preserves durations over a day', () => {
  assert.equal(countdownText(59 * 60_000), '0:59');
  assert.equal(countdownText(59 * 60_000 + 1), '1:00');
  assert.equal(countdownText(60 * 60_000 + 1), '1:01');
  assert.equal(countdownText(25 * 60 * 60_000), '25:00');
});
