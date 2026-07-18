function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Formats a Date as a local (not UTC) `YYYY-MM-DD` string. */
export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's date as a local `YYYY-MM-DD` string. */
export function todayLocalDateString(): string {
  return toLocalDateString(new Date());
}

/** First day of the given month (defaults to the current month) as a local `YYYY-MM-DD` string. */
export function startOfMonthLocalDateString(date: Date = new Date()): string {
  return toLocalDateString(new Date(date.getFullYear(), date.getMonth(), 1));
}
