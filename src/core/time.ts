/**
 * Wall-clock time for scheduling. A "wall" Date stores the business's local date and time in the UTC fields, so
 * working hours (Mon-Fri 09:00-17:00) need no time-zone arithmetic. Real instants (payments) are separate.
 */
export const WORK_START = 9;
export const WORK_END = 17;
export const DAY_HOURS = WORK_END - WORK_START;
const MIN = 60_000;
const HOUR = 60 * MIN;

export const wall = (s: string) => {
  const d = new Date(`${s.length === 10 ? `${s}T00:00` : s.slice(0, 16)}:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad wall time ${s}`);
  return d;
};
export const wallIso = (d: Date) => d.toISOString().slice(0, 16);
export const dateKey = (d: Date) => d.toISOString().slice(0, 10);

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtWall(d: Date | string | null | undefined, withTime = true): string {
  if (!d) return "—";
  const x = typeof d === "string" ? wall(d) : d;
  const base = `${DOW[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`;
  return withTime ? `${base} ${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}` : base;
}

/** Current wall time in a time zone, from a real instant. */
export function wallNow(tz: string, instant: Date = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).map((p) => [p.type, p.value]));
  return wall(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`);
}

export const isWorkday = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
const atHour = (d: Date, h: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 0));
const nextDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, WORK_START, 0));

/** The first working instant at or after d. */
export function workInstant(d: Date): Date {
  let x = new Date(d);
  for (let i = 0; i < 14; i++) {
    if (!isWorkday(x)) {
      x = nextDay(x);
      continue;
    }
    const h = x.getUTCHours() + x.getUTCMinutes() / 60;
    if (h < WORK_START) return atHour(x, WORK_START);
    if (h >= WORK_END) {
      x = nextDay(x);
      continue;
    }
    return x;
  }
  return x;
}

/** start + hours of working time (start snapped to working time first). */
export function addWorkHours(start: Date, hours: number): Date {
  let t = workInstant(start);
  let left = Math.round(hours * 60);
  while (left > 0) {
    const endOfDay = atHour(t, WORK_END);
    const avail = Math.round((endOfDay.getTime() - t.getTime()) / MIN);
    if (left <= avail) return new Date(t.getTime() + left * MIN);
    left -= avail;
    t = workInstant(nextDay(t));
  }
  return t;
}

/** Working hours from a to b; negative when b is before a. */
export function workHoursBetween(a: Date, b: Date): number {
  if (b < a) return -workHoursBetween(b, a);
  let t = workInstant(a);
  let mins = 0;
  for (let i = 0; i < 400 && t < b; i++) {
    const endOfDay = atHour(t, WORK_END);
    const stop = b < endOfDay ? b : endOfDay;
    if (stop > t) mins += (stop.getTime() - t.getTime()) / MIN;
    t = workInstant(nextDay(t));
  }
  return Math.round((mins / 60) * 100) / 100;
}

/** Arrival for a supplier lead time: 09:00 on the n-th working day after the order day. */
export function addWorkDays(from: Date, n: number): Date {
  let x = atHour(from, WORK_START);
  let left = n;
  while (left > 0) {
    x = nextDay(x);
    if (isWorkday(x)) left--;
  }
  return workInstant(x);
}

export const hoursFrom = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);
export const daysFrom = (d: Date, n: number) => new Date(d.getTime() + n * 24 * HOUR);
