import { Injectable, Signal, signal, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AttendanceLog } from '../models/employee.model';
import { todayLocalDateString, startOfMonthLocalDateString } from '../utils/date.util';
import { bucketMoodPercentages } from '../utils/mood.util';
import { buildDonutSegments } from '../utils/donut-chart.util';

/**
 * Owns the attendance date-range filter, pagination, and working-hours
 * aggregation state consumed by `<app-attendance-summary>` — shared by
 * `employee-detail` (admin) and `staff-profile` (self-service) since both
 * pages render the exact same summary over an employee's `raw_logs`.
 * Provide this per-component (`providers: [...]` in `@Component`), never
 * `providedIn: 'root'` — each page's filter/pagination state is its own,
 * not shared across every page that renders an attendance summary.
 *
 * Call `configure()` once (typically in the constructor) with the signal
 * that exposes the employee's `raw_logs` for this page.
 */
@Injectable()
export class AttendanceSummaryStateService {
  private translate = inject(TranslateService);
  private rawLogs: Signal<AttendanceLog[]> = signal([]);

  configure(rawLogs: Signal<AttendanceLog[]>): void {
    this.rawLogs = rawLogs;
  }

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
    const raw = this.rawLogs();
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

  // Donut chart: mood breakdown across the filtered range, same categories
  // and colors as the dashboard's own org-wide mood donut.
  hasMoodData = computed(() => this.filteredRawLogs().length > 0);
  moodDonutSegments = computed(() => {
    this.translate.currentLang(); // recompute labels when the language changes
    const m = bucketMoodPercentages(this.filteredRawLogs().map((log) => log.mood));
    return buildDonutSegments([
      {
        key: 'happy',
        label: this.translate.instant('mood.happy'),
        value: m.happy,
        color: 'var(--color-cyan)',
      },
      {
        key: 'neutral',
        label: this.translate.instant('mood.neutral'),
        value: m.neutral,
        color: 'var(--color-info)',
      },
      {
        key: 'sad',
        label: this.translate.instant('mood.sad'),
        value: m.sad,
        color: 'var(--color-red)',
      },
      {
        key: 'stressed',
        label: this.translate.instant('mood.stressed'),
        value: m.stressed,
        color: 'var(--color-orange)',
      },
    ]);
  });

  // Default attendance date range: first day of current month -> today
  initializeDateRangeDefaults(): void {
    const startStr = startOfMonthLocalDateString();
    const today = todayLocalDateString();

    this.filterStartDate.set(startStr);
    this.filterEndDate.set(today);
    this.filterStartDateInput.set(startStr);
    this.filterEndDateInput.set(today);
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

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }
}
