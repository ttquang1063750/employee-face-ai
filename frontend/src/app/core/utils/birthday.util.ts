function parseMonthDay(dateOfBirth: string): { month: number; day: number } {
  const [, month, day] = dateOfBirth.split('-').map(Number);
  return { month, day };
}

/** Current age in whole years from a `date_of_birth` (`YYYY-MM-DD`), or null if not set. */
export function calculateAge(
  dateOfBirth: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!dateOfBirth) return null;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  let age = today.getFullYear() - year;
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!hadBirthdayThisYear) age--;
  return age;
}

/** True when today is this employee's birthday (year-independent, month+day only). */
export function isBirthdayToday(
  dateOfBirth: string | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!dateOfBirth) return false;
  const { month, day } = parseMonthDay(dateOfBirth);
  return today.getMonth() + 1 === month && today.getDate() === day;
}

/** Days remaining until the next occurrence of this birthday (0 = today), or null if not set. */
export function daysUntilNextBirthday(
  dateOfBirth: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!dateOfBirth) return null;
  const { month, day } = parseMonthDay(dateOfBirth);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < todayMidnight) {
    next = new Date(today.getFullYear() + 1, month - 1, day);
  }
  return Math.round((next.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
}
