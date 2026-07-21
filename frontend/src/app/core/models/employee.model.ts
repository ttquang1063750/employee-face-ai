export type EmployeeRole = 'admin' | 'staff';

export interface EmployeeBase {
  id: number;
  name: string;
  date_of_birth: string | null;
  image_path: string;
  role: string;
  username: string | null;
  current_position: string;
}

// Minimal, non-admin-gated shape from GET /api/employees/directory — just
// enough to pick a message recipient by name, not the full admin employee
// list (which also requires role=admin server-side and includes
// username/role/photo that a recipient picker doesn't need).
export interface EmployeeDirectoryEntry {
  id: number;
  name: string;
  current_position: string | null;
}

export interface Position {
  id: number;
  title: string;
  start_date: string;
  end_date: string | null;
}

export interface Skill {
  skill_name: string;
  description: string;
}

export interface Project {
  project_name: string;
  role: string;
  description: string;
  start_date: string;
  end_date: string | null;
}

export interface IncomeEntry {
  id: number;
  amount: number;
  effective_date: string;
  change_reason: string;
}

export interface AttendanceLog {
  id: number;
  timestamp: string;
  action: 'CHECK_IN' | 'CHECK_OUT';
  mood: string;
  captured_image_path?: string;
}

export interface MonthlyLogSummary {
  month: string;
  check_ins: number;
  check_outs: number;
}

export interface DetailedEmployee {
  id: number;
  name: string;
  date_of_birth: string | null;
  image_path: string;
  role: EmployeeRole;
  username?: string | null;
  current_position: string;
  positions: Position[];
  skills: Skill[];
  projects: Project[];
  income_history: IncomeEntry[];
  raw_logs: AttendanceLog[];
  monthly_logs_summary: MonthlyLogSummary[];
}
