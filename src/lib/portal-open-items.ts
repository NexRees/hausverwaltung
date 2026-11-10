// nexrees: the tenant portal splits open charges into "due or overdue" and "due soon", so rent
// that is not due yet no longer looks like a debt. Days are compared as calendar days in Berlin.

const TIME_ZONE = "Europe/Berlin";

/** Calendar day "YYYY-MM-DD" of `d` in Germany. */
export function berlinDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Due dates are stored as midnight UTC of the due day; this is that day. */
function dueDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type SplitOpenItems<T> = {
  /** Due today or earlier, oldest first; `overdue` when the due day has passed. */
  due: (T & { overdue: boolean })[];
  /** Due after today, soonest first. */
  upcoming: T[];
  dueTotal: number;
  upcomingTotal: number;
  total: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function splitOpenItems<T extends { dueDate: Date; open: number }>(items: T[], now: Date): SplitOpenItems<T> {
  const today = berlinDay(now);
  const sorted = [...items].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const due = sorted.filter((i) => dueDay(i.dueDate) <= today).map((i) => ({ ...i, overdue: dueDay(i.dueDate) < today }));
  const upcoming = sorted.filter((i) => dueDay(i.dueDate) > today);
  const sum = (xs: { open: number }[]) => cents(xs.reduce((a, x) => a + x.open, 0));
  const dueTotal = sum(due);
  const upcomingTotal = sum(upcoming);
  return { due, upcoming, dueTotal, upcomingTotal, total: cents(dueTotal + upcomingTotal) };
}
