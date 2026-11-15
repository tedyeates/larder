/**
 * Calendar dates are plain ISO strings (`YYYY-MM-DD`) in UTC. No Date objects
 * cross a module boundary, so timezone shifts can't move a best-before date.
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assertIsoDate(value: string): string {
  if (!isIsoDate(value)) throw new Error(`Not an ISO date: ${value}`);
  return value;
}

/** Today in the server's local timezone, as an ISO date. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${assertIsoDate(iso)}T00:00:00Z`);
  return new Date(date.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${assertIsoDate(from)}T00:00:00Z`).getTime();
  const b = new Date(`${assertIsoDate(to)}T00:00:00Z`).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

/** ISO dates sort lexicographically, which is the whole point of the format. */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string, weekStartsOn: 1 | 0 = 1): string {
  const date = new Date(`${assertIsoDate(iso)}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const offset = (weekday - weekStartsOn + 7) % 7;
  return addDays(iso, -offset);
}
