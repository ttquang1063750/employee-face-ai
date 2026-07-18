export type EmployeeRole = 'admin' | 'staff';

export interface EmployeeBase {
  id: number;
  name: string;
  age: number;
  image_path: string;
  role: string;
  current_position: string;
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
  timestamp: string;
  action: 'CHECK_IN' | 'CHECK_OUT';
  mood: string;
}

export interface MonthlyLogSummary {
  month: string;
  check_ins: number;
  check_outs: number;
}

export interface DetailedEmployee {
  id: number;
  name: string;
  age: number;
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
