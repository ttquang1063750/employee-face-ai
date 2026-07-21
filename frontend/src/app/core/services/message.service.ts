import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  MessageDetail,
  MessageTemplate,
  NewMessagePayload,
  NewMessageTemplatePayload,
  ReceivedMessage,
  SentMessage,
} from '../models/message.model';

/**
 * Single source of truth for `/messages...` and `/message-templates...` —
 * same role as EmployeeService for its own resource family. providedIn:
 * 'root' since this is stateless request plumbing, not per-page UI state.
 */
@Injectable({ providedIn: 'root' })
export class MessageService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiBaseUrl;

  getReceived(): Observable<ApiResponse<ReceivedMessage[]>> {
    return this.http.get<ApiResponse<ReceivedMessage[]>>(`${this.apiUrl}/messages/received`);
  }

  getSent(): Observable<ApiResponse<SentMessage[]>> {
    return this.http.get<ApiResponse<SentMessage[]>>(`${this.apiUrl}/messages/sent`);
  }

  getMessage(id: number): Observable<ApiResponse<MessageDetail>> {
    return this.http.get<ApiResponse<MessageDetail>>(`${this.apiUrl}/messages/${id}`);
  }

  send(payload: NewMessagePayload): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.apiUrl}/messages`, payload);
  }

  markRead(id: number): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.apiUrl}/messages/${id}/read`, {});
  }

  // Hides the message from the caller's own side only — see
  // db.delete_message_for_employee for the per-side soft-delete semantics.
  deleteMessage(id: number): Observable<ApiResponse> {
    return this.http.delete<ApiResponse>(`${this.apiUrl}/messages/${id}`);
  }

  getTemplates(): Observable<ApiResponse<MessageTemplate[]>> {
    return this.http.get<ApiResponse<MessageTemplate[]>>(`${this.apiUrl}/message-templates`);
  }

  createTemplate(payload: NewMessageTemplatePayload): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.apiUrl}/message-templates`, payload);
  }

  updateTemplate(id: number, payload: NewMessageTemplatePayload): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.apiUrl}/message-templates/${id}`, payload);
  }

  deleteTemplate(id: number): Observable<ApiResponse> {
    return this.http.delete<ApiResponse>(`${this.apiUrl}/message-templates/${id}`);
  }
}
