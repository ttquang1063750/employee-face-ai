export type DocumentVisibility = 'chung' | 'rieng';

export interface EmployeeDocument {
  id: number;
  employee_id: number | null;
  employee_name: string | null;
  title: string;
  file_name: string;
  visibility: DocumentVisibility;
  uploaded_at: string;
}
