import { Component, OnInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-staff-profile',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './staff-profile.html',
  styleUrls: ['./staff-profile.scss', '../../admin/employee-detail/employee-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StaffProfileComponent implements OnInit {
  employee = signal<any | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Attendance Filters (applied values used by the computed logs below;
  // the *Input signals are the draft values bound to the date pickers and
  // only take effect once ÁP DỤNG is clicked)
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');
  filterStartDateInput = signal<string>('');
  filterEndDateInput = signal<string>('');

  // Pagination for logs list
  currentPage = signal<number>(1);
  pageSize = signal<number>(5);

  // Computed: Filtered attendance logs in selected time range
  filteredRawLogs = computed(() => {
    const start = this.filterStartDate();
    const end = this.filterEndDate();
    const raw = this.employee()?.raw_logs || [];
    if (!start || !end) return raw;
    return raw.filter((log: any) => {
      const logDate = log.timestamp.split('T')[0];
      return logDate >= start && logDate <= end;
    });
  });

  // Computed: Pagination properties
  totalPages = computed(() => {
    const len = this.filteredRawLogs().length;
    return Math.ceil(len / this.pageSize()) || 1;
  });

  paginatedRawLogs = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSize();
    return this.filteredRawLogs().slice(start, start + this.pageSize());
  });

  // Computed: Calculate total unique calendar working days
  workingDays = computed(() => {
    const logs = this.filteredRawLogs();
    const uniqueDates = new Set<string>();
    logs.forEach((log: any) => {
      uniqueDates.add(log.timestamp.split('T')[0]);
    });
    return uniqueDates.size;
  });

  // Computed: Aggregate working hours via pairing algorithm
  workingHours = computed(() => {
    const logs = this.filteredRawLogs();
    const logsByDate: { [key: string]: any[] } = {};

    logs.forEach((log: any) => {
      const date = log.timestamp.split('T')[0];
      if (!logsByDate[date]) {
        logsByDate[date] = [];
      }
      logsByDate[date].push(log);
    });

    let totalHours = 0;
    Object.keys(logsByDate).forEach((date) => {
      // Sort day logs chronologically (oldest first)
      const dayLogs = logsByDate[date].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      let lastCheckInTime: number | null = null;
      dayLogs.forEach((log) => {
        if (log.action === 'CHECK_IN') {
          lastCheckInTime = new Date(log.timestamp).getTime();
        } else if (log.action === 'CHECK_OUT' && lastCheckInTime !== null) {
          const checkOutTime = new Date(log.timestamp).getTime();
          const diffMs = checkOutTime - lastCheckInTime;
          const diffHrs = diffMs / (1000 * 60 * 60);
          totalHours += diffHrs;
          lastCheckInTime = null; // Reset pairing
        }
      });
    });
    return parseFloat(totalHours.toFixed(1));
  });

  private readonly apiUrl = 'http://localhost:8000/api';

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadOwnProfile();
  }

  loadOwnProfile(): void {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<any>(`${this.apiUrl}/employees/${employeeId}`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success) {
          this.employee.set(res.data);
          this.initializeDateFilters();
        } else {
          this.errorMsg.set(res.error || 'Không thể lấy thông tin hồ sơ.');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      }
    });
  }

  private initializeDateFilters(): void {
    // Default attendance date range: first day of current month -> today
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const pad = (num: number) => num.toString().padStart(2, '0');
    const startStr = `${startOfMonth.getFullYear()}-${pad(startOfMonth.getMonth() + 1)}-01`;
    const endStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    this.filterStartDate.set(startStr);
    this.filterEndDate.set(endStr);
    this.filterStartDateInput.set(startStr);
    this.filterEndDateInput.set(endStr);
  }

  applyDateFilter(): void {
    this.filterStartDate.set(this.filterStartDateInput());
    this.filterEndDate.set(this.filterEndDateInput());
    this.currentPage.set(1);
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
    }
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
    }
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }
}
