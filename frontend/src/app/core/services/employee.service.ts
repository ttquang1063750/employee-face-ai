import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { DetailedEmployee, EmployeeBase, Skill, Project } from '../models/employee.model';
import { LeaveRequest } from '../models/leave-request.model';
import { EmployeeDocument } from '../models/document.model';

// Registration accepts a bare {project_name, role, description} — unlike the
// full Project shape used everywhere else, a brand-new employee has no
// start_date/end_date yet (see server.py's `handle_register_employee`).
export interface NewEmployeeProjectEntry {
  project_name: string;
  role: string;
  description: string;
}

export interface NewEmployeePayload {
  name: string;
  age: number;
  role: string;
  username: string;
  password: string | null;
  img: string;
  position: string;
  income: number;
  skills: Skill[];
  projects: NewEmployeeProjectEntry[];
}

export interface UpdateEmployeePayload {
  name: string;
  age: number;
  role: string;
  username: string;
  password: string | null;
  skills: Skill[];
  projects: Project[];
  img?: string;
}

export interface NewPositionPayload {
  title: string;
  start_date: string;
}

export interface NewIncomePayload {
  amount: number;
  effective_date: string;
  change_reason: string;
}

export interface NewLeaveRequestPayload {
  start_date: string;
  end_date: string;
  reason: string;
}

/**
 * Single source of truth for every `/employees...`-prefixed endpoint —
 * before this existed, `${this.apiUrl}/employees...` was hand-built at 15+
 * call sites across `employee-list`, `employee-detail`, `staff-profile`,
 * `dashboard`, `documents`, and the `employee-detail` sub-panels
 * (`base-profile-modal`, `skills-panel`, `positions-timeline`,
 * `income-history`, `projects-panel`), several of them the exact same
 * `GET /employees` or `GET /employees/:id` call repeated verbatim.
 *
 * `providedIn: 'root'` (unlike `WebcamCaptureService`/`PhotoCaptureStateService`/
 * `AttendanceSummaryStateService`) — this is stateless request plumbing, not
 * per-page UI state, so one shared instance is correct.
 *
 * Endpoints that don't live under `/employees` (e.g. `/logs/:id`,
 * `/positions/:id`, `/income/:id`, `/documents/:id`, top-level
 * `/leave-requests`) stay as direct `HttpClient` calls in their own
 * components — they're a different resource, not this duplication.
 */
@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/employees`;

  getAll(): Observable<ApiResponse<EmployeeBase[]>> {
    return this.http.get<ApiResponse<EmployeeBase[]>>(this.baseUrl);
  }

  getById(id: number): Observable<ApiResponse<DetailedEmployee>> {
    return this.http.get<ApiResponse<DetailedEmployee>>(`${this.baseUrl}/${id}`);
  }

  create(payload: NewEmployeePayload): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(this.baseUrl, payload);
  }

  update(id: number, payload: UpdateEmployeePayload): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.baseUrl}/${id}`, payload);
  }

  delete(id: number): Observable<ApiResponse> {
    return this.http.delete<ApiResponse>(`${this.baseUrl}/${id}`);
  }

  changePassword(id: number, currentPassword: string, newPassword: string): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.baseUrl}/${id}/password`, {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  changeAvatar(id: number, img: string): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.baseUrl}/${id}/avatar`, { img });
  }

  updateSkills(id: number, skills: Skill[]): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.baseUrl}/${id}/skills`, skills);
  }

  addPosition(id: number, payload: NewPositionPayload): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.baseUrl}/${id}/positions`, payload);
  }

  addIncome(id: number, payload: NewIncomePayload): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.baseUrl}/${id}/income`, payload);
  }

  updateProjects(id: number, projects: Project[]): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.baseUrl}/${id}/projects`, projects);
  }

  getLeaveRequests(id: number): Observable<ApiResponse<LeaveRequest[]>> {
    return this.http.get<ApiResponse<LeaveRequest[]>>(`${this.baseUrl}/${id}/leave-requests`);
  }

  submitLeaveRequest(id: number, payload: NewLeaveRequestPayload): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.baseUrl}/${id}/leave-requests`, payload);
  }

  getDocuments(id: number): Observable<ApiResponse<EmployeeDocument[]>> {
    return this.http.get<ApiResponse<EmployeeDocument[]>>(`${this.baseUrl}/${id}/documents`);
  }
}
