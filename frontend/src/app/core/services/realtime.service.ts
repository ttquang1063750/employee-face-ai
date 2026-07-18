import { Injectable, signal, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class RealtimeService implements OnDestroy {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  
  // Realtime signals
  pendingLeaveCount = signal<number>(0);
  private pollIntervalId: any = null;

  constructor() {
    this.refreshPendingCount();
    this.startPolling();
  }

  startPolling(): void {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(() => {
      this.refreshPendingCount();
    }, 3000);
  }

  stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  refreshPendingCount(): void {
    if (!this.authService.isAdmin()) {
      this.pendingLeaveCount.set(0);
      return;
    }

    this.http.get<any>('http://localhost:8000/api/leave-requests').subscribe({
      next: (res) => {
        if (res.success) {
          const pending = res.data.filter((r: any) => r.status === 'pending').length;
          this.pendingLeaveCount.set(pending);
        }
      },
      error: () => {
        // Silent ignore if unauthorized or server offline
      }
    });
  }

  updatePendingCount(count: number): void {
    this.pendingLeaveCount.set(count);
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }
}
