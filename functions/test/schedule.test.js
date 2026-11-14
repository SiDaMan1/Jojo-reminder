import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { nextOccurrence, formatWhen } from '../schedule.js';

const tz = 'America/New_York';
const at = (iso) => DateTime.fromISO(iso, { zone: tz }).toMillis();
const iso = (ms) => DateTime.fromMillis(ms, { zone: tz }).toFormat("yyyy-LL-dd'T'HH:mm");

test('one-time reminders have no next occurrence', () => {
  assert.equal(nextOccurrence(at('2026-11-14T09:00'), 'none', tz, at('2026-11-14T09:00')), null);
});

test('daily advances one day', () => {
  const due = at('2026-11-14T09:00');
  assert.equal(iso(nextOccurrence(due, 'daily', tz, due)), '2026-11-15T09:00');
});

test('daily keeps local time across daylight saving change', () => {
  const due = at('2026-03-07T09:00'); // DST starts Mar 8 2026 in US
  assert.equal(iso(nextOccurrence(due, 'daily', tz, due)), '2026-03-08T09:00');
});

test('weekly skips forward past now when far behind', () => {
  const due = at('2025-01-06T08:30');
  const next = nextOccurrence(due, 'weekly', tz, at('2026-11-14T12:00'));
  assert.equal(iso(next), '2026-11-16T08:30');
  assert.equal(DateTime.fromMillis(next, { zone: tz }).weekday, 1);
});

test('monthly keeps original day of month when possible', () => {
  const due = at('2026-01-31T10:00');
  const feb = nextOccurrence(due, 'monthly', tz, due);
  assert.equal(iso(feb), '2026-02-28T10:00');
  const mar = nextOccurrence(due, 'monthly', tz, feb);
  assert.equal(iso(mar), '2026-03-31T10:00');
});

test('yearly', () => {
  const due = at('2026-11-14T07:00');
  assert.equal(iso(nextOccurrence(due, 'yearly', tz, due)), '2027-11-14T07:00');
});

test('formatWhen is friendly', () => {
  assert.equal(formatWhen(at('2026-11-17T15:05'), tz), 'Tue, Nov 17 at 3:05 PM');
});
