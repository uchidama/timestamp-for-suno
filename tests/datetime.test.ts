import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTimestamp, parseTimestamp } from '../src/shared/datetime.js';

describe('datetime — parseTimestamp & formatTimestamp', () => {
  it('converts UTC ISO 8601 string to Asia/Tokyo (JST) YYYY/MM/DD HH:mm:ss accurately', () => {
    const formatted = formatTimestamp('2026-11-06T12:34:56Z', {
      timeZone: 'Asia/Tokyo',
    });

    assert.ok(formatted);
    assert.equal(formatted.dateTimeText, '2026/11/06 21:34:56');
    assert.equal(formatted.timeZoneShort, 'JST');
    assert.equal(formatted.inlineText, '🕒 2026/11/06 21:34:56 JST');
    assert.equal(formatted.utcIso, '2026-11-06T12:34:56.000Z');
    assert.ok(formatted.tooltipText.includes('2026-11-06T12:34:56.000Z'));
    assert.ok(formatted.tooltipText.includes('Asia/Tokyo'));
  });

  it('handles fractional milliseconds and explicit timezone offsets in ISO 8601', () => {
    const parsedZ = parseTimestamp('2024-05-10T16:21:37.624Z');
    assert.ok(parsedZ);
    assert.equal(parsedZ.utcIso, '2024-05-10T16:21:37.624Z');

    const parsedOffset = parseTimestamp('2026-11-06T21:34:56+09:00');
    assert.ok(parsedOffset);
    assert.equal(parsedOffset.utcIso, '2026-11-06T12:34:56.000Z');
  });

  it('parses valid 10-digit Unix seconds and 13-digit Unix milliseconds', () => {
    // 2026-11-06T12:34:56Z in Unix seconds = 1793968496
    const unixSec = 1793968496;
    const fromSec = formatTimestamp(unixSec, { timeZone: 'Asia/Tokyo' });
    assert.ok(fromSec);
    assert.equal(fromSec.dateTimeText, '2026/11/06 21:34:56');

    // Unix milliseconds = 1793968496789
    const unixMs = 1793968496789;
    const fromMs = parseTimestamp(unixMs);
    assert.ok(fromMs);
    assert.equal(fromMs.utcIso, '2026-11-06T12:34:56.789Z');
  });

  it('rejects ambiguous numeric units (11-12 digits, microseconds, 0, negative, NaN)', () => {
    assert.equal(parseTimestamp(0), null);
    assert.equal(parseTimestamp(-1793968496), null);
    assert.equal(parseTimestamp(NaN), null);
    assert.equal(parseTimestamp(Infinity), null);
    // 11 digits (uncertain whether seconds in distant future or ms in 1973)
    assert.equal(parseTimestamp(17939684960), null);
    // 12 digits (uncertain unit)
    assert.equal(parseTimestamp(179396849600), null);
    // 16 digits microseconds (uncertain unit)
    assert.equal(parseTimestamp(1793968496000000), null);
  });

  it('rejects strings without timezone designator or invalid calendar dates', () => {
    // Missing timezone offset -> uncertain whether UTC or local
    assert.equal(parseTimestamp('2026-11-06T12:34:56'), null);
    // Date only -> missing time
    assert.equal(parseTimestamp('2026-11-06'), null);
    // Non-existent calendar day (Feb 30) -> must not roll over to March
    assert.equal(parseTimestamp('2026-02-30T12:00:00Z'), null);
    // Non-leap year Feb 29
    assert.equal(parseTimestamp('2026-02-29T12:00:00Z'), null);
    // Valid leap year Feb 29 (2024)
    const leap = parseTimestamp('2024-02-29T12:00:00Z');
    assert.ok(leap);
    assert.equal(leap.utcIso, '2024-02-29T12:00:00.000Z');
  });

  it('handles midnight rollover across timezones with 00:mm:ss (never 24:mm:ss)', () => {
    // 2026-11-06T15:00:05Z -> 2026/11/07 00:00:05 in Asia/Tokyo
    const formatted = formatTimestamp('2026-11-06T15:00:05Z', {
      timeZone: 'Asia/Tokyo',
    });
    assert.ok(formatted);
    assert.equal(formatted.dateTimeText, '2026/11/07 00:00:05');
  });
});
