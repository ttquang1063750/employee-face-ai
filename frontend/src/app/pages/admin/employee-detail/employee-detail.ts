import { Component, OnInit, signal, computed, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiResponse } from '../../../core/models/api-response.model';
import { DetailedEmployee, AttendanceLog } from '../../../core/models/employee.model';
import { onImageError } from '../../../core/utils/image.util';
import { todayLocalDateString, startOfMonthLocalDateString } from '../../../core/utils/date.util';
import { AttendanceSummaryComponent } from './components/attendance-summary/attendance-summary';
import { PositionsTimelineComponent } from './components/positions-timeline/positions-timeline';
import { IncomeHistoryComponent } from './components/income-history/income-history';
import { SkillsPanelComponent } from './components/skills-panel/skills-panel';
import { ProjectsPanelComponent } from './components/projects-panel/projects-panel';
import { BaseProfileModalComponent } from './components/base-profile-modal/base-profile-modal';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    RouterLink,
    AttendanceSummaryComponent,
    PositionsTimelineComponent,
    IncomeHistoryComponent,
    SkillsPanelComponent,
    ProjectsPanelComponent,
    BaseProfileModalComponent,
  ],
  templateUrl: './employee-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  employee = signal<DetailedEmployee | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  showBaseModal = signal<boolean>(false);

  protected readonly onImageError = onImageError;

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
    return raw.filter((log: AttendanceLog) => {
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
    logs.forEach((log: AttendanceLog) => {
      uniqueDates.add(log.timestamp.split('T')[0]);
    });
    return uniqueDates.size;
  });

  // Computed: Aggregate working hours via a CHECK_IN/CHECK_OUT pairing
  // algorithm, single-pass so workingHours and hasIncompleteAttendance never
  // disagree about which days had an open (unpaired) session.
  private dailyAttendanceSummary = computed(() => {
    const logs = this.filteredRawLogs();
    const logsByDate: Record<string, AttendanceLog[]> = {};

    logs.forEach((log: AttendanceLog) => {
      const date = log.timestamp.split('T')[0];
      if (!logsByDate[date]) {
        logsByDate[date] = [];
      }
      logsByDate[date].push(log);
    });

    let totalHours = 0;
    let hasIncomplete = false;

    Object.keys(logsByDate).forEach((date) => {
      // Sort day logs chronologically (oldest first)
      const dayLogs = logsByDate[date].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      let lastCheckInTime: number | null = null;
      dayLogs.forEach((log) => {
        if (log.action === 'CHECK_IN') {
          // A duplicate CHECK_IN before any CHECK_OUT (e.g. a camera retry)
          // keeps the *first* check-in time rather than overwriting it, so
          // the retry doesn't silently discard the session already open.
          if (lastCheckInTime === null) {
            lastCheckInTime = new Date(log.timestamp).getTime();
          }
        } else if (log.action === 'CHECK_OUT' && lastCheckInTime !== null) {
          const checkOutTime = new Date(log.timestamp).getTime();
          const diffHrs = (checkOutTime - lastCheckInTime) / (1000 * 60 * 60);
          // Guard against clock-skew/bad data producing a negative interval.
          if (diffHrs > 0) {
            totalHours += diffHrs;
          }
          lastCheckInTime = null; // Reset pairing
        }
      });

      // A CHECK_IN with no matching CHECK_OUT by end of day (still clocked
      // in, or forgot to check out) is left uncredited rather than guessed
      // at — but flagged so the UI can tell the admin the total is a
      // lower bound, not a confirmed complete figure.
      if (lastCheckInTime !== null) {
        hasIncomplete = true;
      }
    });

    return { totalHours: parseFloat(totalHours.toFixed(1)), hasIncomplete };
  });

  workingHours = computed(() => this.dailyAttendanceSummary().totalHours);

  // True when at least one day in the filtered range has an unpaired
  // CHECK_IN, meaning workingHours() under-counts that day.
  hasIncompleteAttendance = computed(() => this.dailyAttendanceSummary().hasIncomplete);

  private employeeId: number | null = null;
  private readonly apiUrl = 'http://localhost:8000/api';

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.employeeId = parseInt(idParam);
      this.loadEmployeeDetails();
    }
  }

  // `silent`: used when refreshing after a save/delete inside a child panel —
  // the page content is already on screen and correct except for the
  // just-saved change, so it skips the full-page loading skeleton (which
  // would blank out the whole profile for a moment), leaves the
  // admin-chosen attendance filter range alone instead of resetting it back
  // to the default, and swallows a refresh failure instead of replacing the
  // page with an error state, since the save/delete itself already reported
  // its own result to the user.
  loadEmployeeDetails(silent = false): void {
    if (!this.employeeId) return;

    if (!silent) {
      this.isLoading.set(true);
      this.errorMsg.set(null);
    }

    this.http.get<ApiResponse<DetailedEmployee>>(`${this.apiUrl}/employees/${this.employeeId}`).subscribe({
      next: (res) => {
        if (!silent) {
          this.isLoading.set(false);
        }
        if (res.success && res.data) {
          this.employee.set(res.data);
          if (!silent) {
            this.initializeAttendanceFilterDefaults();
          }
        } else if (!silent) {
          this.errorMsg.set(res.error || 'Không thể lấy thông tin chi tiết nhân sự.');
        }
      },
      error: () => {
        if (!silent) {
          this.isLoading.set(false);
          this.errorMsg.set('Lỗi kết nối máy chủ API.');
        }
      },
    });
  }

  private initializeAttendanceFilterDefaults(): void {
    // Default attendance date range: first day of current month -> today
    const startStr = startOfMonthLocalDateString();
    const today = todayLocalDateString();

    this.filterStartDate.set(startStr);
    this.filterEndDate.set(today);
    this.filterStartDateInput.set(startStr);
    this.filterEndDateInput.set(today);
  }

  openBaseModal(): void {
    this.showBaseModal.set(true);
  }

  onBaseProfileSaved(): void {
    this.showBaseModal.set(false);
    this.loadEmployeeDetails(true);
  }

  onBaseProfileClosed(): void {
    this.showBaseModal.set(false);
  }

  applyDateFilter(): void {
    this.filterStartDate.set(this.filterStartDateInput());
    this.filterEndDate.set(this.filterEndDateInput());
    this.currentPage.set(1);
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
    }
  }
}
