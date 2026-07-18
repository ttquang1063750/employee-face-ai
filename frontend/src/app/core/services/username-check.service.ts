import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface UsernameCheckResponse {
  success: boolean;
  exists: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UsernameCheckService {
  private http = inject(HttpClient);

  private readonly apiUrl = 'http://localhost:8000/api';

  check(username: string, excludeId?: number): Observable<UsernameCheckResponse> {
    const params: Record<string, string> = { username };
    if (excludeId) {
      params['exclude_id'] = String(excludeId);
    }
    return this.http.get<UsernameCheckResponse>(`${this.apiUrl}/employees/check-username`, {
      params,
    });
  }
}
