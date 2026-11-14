import { DateTime } from 'luxon';

export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

const STEP = {
  daily: { days: 1 },
  weekly: { weeks: 1 },
  monthly: { months: 1 },
  yearly: { years: 1 },
};

/**
 * Next time a repeating reminder should fire, strictly after `afterMs`.
 * Math happens in the reminder's own time zone so "every day at 9am"
 * stays at 9am across daylight-saving changes. Monthly reminders keep
 * their original day of month (Jan 31 -> Feb 28 -> Mar 31).
 * Returns null for one-time reminders.
 */
export function nextOccurrence(dueAtMs, repeat, timeZone, afterMs) {
  const step = STEP[repeat];
  if (!step) return null;
  const zone = timeZone || 'America/New_York';
  let start = DateTime.fromMillis(dueAtMs, { zone });
  if (!start.isValid) start = DateTime.fromMillis(dueAtMs, { zone: 'UTC' });

  let n = 1;
  let next = start.plus(scale(step, n));
  // Jump close first so very old reminders don't loop thousands of times.
  if (next.toMillis() <= afterMs) {
    const unit = Object.keys(step)[0];
    const gap = DateTime.fromMillis(afterMs, { zone }).diff(start, unit)[unit];
    n = Math.max(1, Math.floor(gap / step[unit]));
    next = start.plus(scale(step, n));
  }
  while (next.toMillis() <= afterMs) {
    n += 1;
    next = start.plus(scale(step, n));
  }
  return next.toMillis();
}

function scale(step, n) {
  const [unit, amount] = Object.entries(step)[0];
  return { [unit]: amount * n };
}

export function formatWhen(ms, timeZone) {
  return DateTime.fromMillis(ms, { zone: timeZone || 'America/New_York' })
    .toFormat("ccc, LLL d 'at' h:mm a");
}
