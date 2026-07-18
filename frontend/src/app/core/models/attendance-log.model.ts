// Flat attendance-log record as returned by GET /api/logs (admin dashboard scope).
// Not to be confused with the narrower `AttendanceLog` in employee.model.ts,
// which is a per-employee raw log entry embedded in `DetailedEmployee`.
export interface AttendanceLogEntry {
  id: number;
  employee_id: number;
  employee_name: string;
  timestamp: string;
  action: string;
  mood: string;
  captured_image_path: string;
}
