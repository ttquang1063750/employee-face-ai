import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { ApiResponse } from '../models/api-response.model';
import { LeaveRequest } from '../models/leave-request.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class RealtimeService implements OnDestroy {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  // Single shared poll of /api/leave-requests for the whole app — pages
  // (leave-requests list, admin-shell's sidebar badge) read from this
  // instead of each running their own interval against the same endpoint.
  leaveRequests = signal<LeaveRequest[]>([]);
  pendingLeaveCount = computed(
    () => this.leaveRequests().filter((r) => r.status === 'pending').length,
  );

  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.refreshLeaveRequests();
    this.startPolling();
  }

  startPolling(): void {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(() => {
      this.refreshLeaveRequests();
    }, 3000);
  }

  stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  refreshLeaveRequests(): void {
    if (!this.authService.isAdmin()) {
      this.leaveRequests.set([]);
      return;
    }

    this.http
      .get<ApiResponse<LeaveRequest[]>>(`${environment.apiBaseUrl}/leave-requests`)
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.leaveRequests.set(res.data);
          }
        },
        error: () => {
          // Silent ignore if unauthorized or server offline
        },
      });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }
}
