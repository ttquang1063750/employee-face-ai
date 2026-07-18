export interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  current_position: string | null;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  rejection_reason?: string | null;
}
