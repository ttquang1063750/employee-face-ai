export type DocumentVisibility = 'chung' | 'rieng';
export type DocumentSourceType = 'file' | 'link';

export interface EmployeeDocument {
  id: number;
  employee_id: number | null;
  employee_name: string | null;
  title: string;
  file_name: string | null;
  source_type: DocumentSourceType;
  external_url: string | null;
  visibility: DocumentVisibility;
  uploaded_at: string;
}
