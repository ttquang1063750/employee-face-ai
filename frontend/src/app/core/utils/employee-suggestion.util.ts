// Shared <app-hud-autocomplete> row formatting for employee-picker
// autocompletes (dashboard's name search, compose's recipient picker) — see
// AGENTS.md rule 22. Disambiguates same-named employees via `id`, not
// `username` — username is half a login credential, and this formatter is
// also used against EmployeeDirectoryEntry, which is fetchable by any
// authenticated employee (not just Admin), so it must never expose it.
export interface EmployeeSuggestionLike {
  id: number;
  name: string;
  current_position: string | null;
}

export function employeeSuggestionLabel(e: EmployeeSuggestionLike): string {
  return e.name;
}

export function employeeSuggestionMeta(e: EmployeeSuggestionLike): string {
  const position = e.current_position || 'Chưa có chức vụ';
  return `${position} · #${e.id}`;
}
