import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import {
  HudSelectComponent,
  HudSelectOption,
} from '../../../core/components/hud-select/hud-select';
import { HudAutocompleteComponent } from '../../../core/components/hud-autocomplete/hud-autocomplete';
import { ApiResponse } from '../../../core/models/api-response.model';
import { EmployeeBase } from '../../../core/models/employee.model';
import { AttendanceLogEntry } from '../../../core/models/attendance-log.model';
import { translateMood, bucketMoodPercentages } from '../../../core/utils/mood.util';
import { isBirthdayToday, daysUntilNextBirthday } from '../../../core/utils/birthday.util';
import { buildDonutSegments } from '../../../core/utils/donut-chart.util';
import { todayLocalDateString, startOfMonthLocalDateString } from '../../../core/utils/date.util';
import { triggerBlobDownload } from '../../../core/utils/download.util';
import { environment } from '../../../../environments/environment';
import { EmployeeService } from '../../../core/services/employee.service';
import {
  employeeSuggestionLabel as formatEmployeeSuggestionLabel,
  employeeSuggestionMeta as formatEmployeeSuggestionMeta,
} from '../../../core/utils/employee-suggestion.util';
import { StatWidgetComponent } from './components/stat-widget/stat-widget';
import { HourlyChartComponent } from './components/hourly-chart/hourly-chart';
import { MoodDonutComponent } from './components/mood-donut/mood-donut';
import { LogsTableComponent } from './components/logs-table/logs-table';
import { DialogService } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePickerComponent,
    HudSelectComponent,
    HudAutocompleteComponent,
    StatWidgetComponent,
    HourlyChartComponent,
    MoodDonutComponent,
    LogsTableComponent,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private employeeService = inject(EmployeeService);

  constructor() {
    this.nameControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.onSearchInput());
  }

  employees = signal<EmployeeBase[]>([]);
  logs = signal<AttendanceLogEntry[]>([]);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Filters for logs list (applied values used by filteredLogs below;
  // the *Input controls are the draft date-range values bound to the date
  // pickers and only take effect once ÁP DỤNG is clicked)
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');
  filterStartDateInput = new FormControl('', { nonNullable: true });
  filterEndDateInput = new FormControl('', { nonNullable: true });
  // Free-text autocomplete search is exempt from the explicit-Apply rule
  // (rule 10) — it live-filters, so its value is bridged into a signal for
  // the filteredLogs()/employeeSuggestions() computeds below.
  nameControl = new FormControl('', { nonNullable: true });
  filterEmployeeName = toSignal(this.nameControl.valueChanges, {
    initialValue: this.nameControl.value,
  });

  // Label/meta accessors for <app-hud-autocomplete>, shared with the compose
  // page's recipient picker (see employee-suggestion.util.ts).
  employeeSuggestionLabel = formatEmployeeSuggestionLabel;
  employeeSuggestionMeta = formatEmployeeSuggestionMeta;

  // Status filter (all/CHECK_IN/CHECK_OUT) — global, folded into
  // filteredLogs() below like the date range and name search, so every
  // consumer (stat widgets, charts, logs table, CSV export) reflects it
  // consistently rather than each widget filtering it separately. Applies
  // instantly like the name search, not gated behind ÁP DỤNG (rule 10
  // exempts non-date-range filters).
  statusControl = new FormControl<'all' | 'CHECK_IN' | 'CHECK_OUT'>('all', { nonNullable: true });
  readonly statusOptions: HudSelectOption<'all' | 'CHECK_IN' | 'CHECK_OUT'>[] = [
    { value: 'all', label: 'Tất cả' },
    { value: 'CHECK_IN', label: 'Vào ca' },
    { value: 'CHECK_OUT', label: 'Ra ca' },
  ];
  private filterStatus = toSignal(this.statusControl.valueChanges, {
    initialValue: this.statusControl.value,
  });

  // Pagination for logs list
  currentPage = signal<number>(1);
  pageSize = signal<number>(10);

  // Computed stats widgets (using overall logs)
  totalEmployees = computed(() => this.employees().length);

  // Birthday alerts — sourced from the full employee directory (not the
  // filtered logs), since a birthday isn't tied to any attendance activity.
  todaysBirthdays = computed(() =>
    this.employees().filter((e) => isBirthdayToday(e.date_of_birth)),
  );
  todaysBirthdayNames = computed(() =>
    this.todaysBirthdays()
      .map((e) => e.name)
      .join(', '),
  );

  upcomingBirthdays = computed(() => {
    const withinDays = 7;
    return this.employees()
      .map((e) => ({ employee: e, daysUntil: daysUntilNextBirthday(e.date_of_birth) }))
      .filter(
        (entry): entry is { employee: EmployeeBase; daysUntil: number } =>
          entry.daysUntil !== null && entry.daysUntil > 0 && entry.daysUntil <= withinDays,
      )
      .sort((a, b) => a.daysUntil - b.daysUntil);
  });

  // Computed: Filtered attendance logs in selected time range / employee search / status scope
  filteredLogs = computed(() => {
    const start = this.filterStartDate();
    const end = this.filterEndDate();
    const nameQuery = this.filterEmployeeName().toLowerCase().trim();
    const status = this.filterStatus();
    const raw = this.logs() || [];

    return raw.filter((log) => {
      // timestamp format: "YYYY-MM-DD HH:mm:ss"
      const logDate = log.timestamp.split(' ')[0];
      const dateInRange = !start || !end ? true : logDate >= start && logDate <= end;
      const nameMatches = !nameQuery ? true : log.employee_name.toLowerCase().includes(nameQuery);
      const statusMatches = status === 'all' ? true : log.action === status;
      return dateInRange && nameMatches && statusMatches;
    });
  });

  totalLogsInRange = computed(() => this.filteredLogs().length);

  // Computed: Employee suggestions filtered by current input — sourced from
  // the full employee directory (not just names seen in logs) so the
  // dropdown can show current_position/username alongside a name, since
  // names alone aren't unique enough to tell two employees apart.
  employeeSuggestions = computed(() => {
    const q = this.filterEmployeeName().toLowerCase().trim();
    const sorted = [...this.employees()].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted.slice(0, 8);
    return sorted.filter((emp) => emp.name.toLowerCase().includes(q)).slice(0, 8);
  });

  // Computed: Pagination variables
  totalPages = computed(() => {
    const len = this.filteredLogs().length;
    return Math.ceil(len / this.pageSize()) || 1;
  });

  paginatedLogs = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSize();
    return this.filteredLogs().slice(start, start + this.pageSize());
  });

  // Calculate mood distribution based on filtered logs
  moodStats = computed(() => bucketMoodPercentages(this.filteredLogs().map((log) => log.mood)));

  // Donut chart segments for the mood breakdown (cumulative offsets around
  // a circle whose circumference is normalized to 100 units).
  hasMoodData = computed(() => {
    const m = this.moodStats();
    return m.happy + m.neutral + m.sad + m.stressed > 0;
  });

  // Happiness widget tone: reflects the actual value against a target,
  // rather than a fixed color regardless of how good or bad the number is.
  // Falls back to a neutral "no data" state instead of implying a bad score
  // when there simply aren't any attendance logs in the selected range.
  happinessLevel = computed<'success' | 'warning' | 'danger' | 'none'>(() => {
    if (!this.hasMoodData()) return 'none';
    const happy = this.moodStats().happy;
    if (happy >= 60) return 'success';
    if (happy >= 20) return 'warning';
    return 'danger';
  });

  happinessStatusLabel = computed(() => {
    switch (this.happinessLevel()) {
      case 'success':
        return 'Đạt mục tiêu';
      case 'warning':
        return 'Thấp';
      case 'danger':
        return 'Rất thấp';
      default:
        return 'Chưa có dữ liệu';
    }
  });

  moodDonut = computed(() => {
    const m = this.moodStats();
    return buildDonutSegments([
      { key: 'happy', label: 'Vui vẻ 😊', value: m.happy, color: 'var(--color-cyan)' },
      { key: 'neutral', label: 'Bình thường 😐', value: m.neutral, color: 'var(--color-info)' },
      { key: 'sad', label: 'Buồn bã 😢', value: m.sad, color: 'var(--color-red)' },
      {
        key: 'stressed',
        label: 'Căng thẳng / Lo lắng 😰',
        value: m.stressed,
        color: 'var(--color-orange)',
      },
    ]);
  });

  // Dynamic SVG Chart Coordinates for Hourly Peaks (08:00 - 18:00) using filtered logs
  hourlyTimeline = computed(() => {
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const counts = hours.map(() => 0);

    this.filteredLogs().forEach((log) => {
      try {
        const timePart = log.timestamp.split(' ')[1];
        if (timePart) {
          const hour = parseInt(timePart.split(':')[0]);
          const idx = hours.indexOf(hour);
          if (idx !== -1) {
            counts[idx]++;
          }
        }
      } catch {
        // Ignore
      }
    });

    const maxCount = Math.max(...counts, 1);
    const width = 500;
    const height = 180;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = hours.map((h, i) => {
      const x = padding + (i / (hours.length - 1)) * chartWidth;
      const y = height - padding - (counts[i] / maxCount) * chartHeight;
      return { x, y, hour: `${h}h`, count: counts[i] };
    });

    return { points };
  });

  hasHourlyData = computed(() => this.hourlyTimeline().points.some((pt) => pt.count > 0));

  private readonly apiUrl = environment.apiBaseUrl;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Set default dates
    const startStr = startOfMonthLocalDateString();
    const endStr = todayLocalDateString();
    this.filterStartDate.set(startStr);
    this.filterEndDate.set(endStr);
    this.filterStartDateInput.setValue(startStr);
    this.filterEndDateInput.setValue(endStr);

    this.loadDashboardData();
    this.startPolling();
  }

  startPolling(): void {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(() => {
      // Quiet reload: we load dashboard data directly
      this.employeeService.getAll().subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.employees.set(res.data);
          }
        },
      });
      this.http.get<ApiResponse<AttendanceLogEntry[]>>(`${this.apiUrl}/logs`).subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.logs.set(res.data);
          }
        },
      });
    }, 3000);
  }

  stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  loadDashboardData(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    // Call APIs in parallel
    this.employeeService.getAll().subscribe({
      next: (empRes) => {
        if (empRes.success && empRes.data) {
          this.employees.set(empRes.data);

          this.http.get<ApiResponse<AttendanceLogEntry[]>>(`${this.apiUrl}/logs`).subscribe({
            next: (logRes) => {
              this.isLoading.set(false);
              if (logRes.success && logRes.data) {
                this.logs.set(logRes.data);
              }
            },
            error: () => {
              this.isLoading.set(false);
              this.errorMsg.set('Không thể tải nhật ký chấm công.');
            },
          });
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Không thể kết nối đến máy chủ API.');
      },
    });
  }

  applyDateFilter(): void {
    this.filterStartDate.set(this.filterStartDateInput.value);
    this.filterEndDate.set(this.filterEndDateInput.value);
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

  selectSuggestion(): void {
    this.currentPage.set(1);
  }

  onSearchInput(): void {
    this.currentPage.set(1);
  }

  exportCSV(): void {
    const data = this.filteredLogs();
    if (data.length === 0) return;

    // CSV headers matching HUD grid layout
    const headers = ['Thời gian chấm công', 'Nhân viên (ID)', 'Trạng thái', 'Cảm xúc (Mood)'];
    const rows = data.map((log) => [
      log.timestamp,
      `${log.employee_name} (#${log.employee_id})`,
      log.action === 'CHECK_IN' ? 'CHECK-IN' : 'CHECK-OUT',
      translateMood(log.mood),
    ]);

    // CSV UTF-8 BOM so Excel decodes Vietnamese characters correctly
    const csvContent =
      '\uFEFF' +
      [
        headers.join(','),
        ...rows.map((e) => e.map((val) => `"${val.replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerBlobDownload(
      blob,
      `bao_cao_tong_hop_${this.filterStartDate()}_to_${this.filterEndDate()}.csv`,
    );
  }

  onDeleteLog(id: number): void {
    this.dialogService
      .confirm(
        'XÁC NHẬN XÓA',
        'Bạn có chắc chắn muốn xóa lượt chấm công này? Thao tác này không thể hoàn tác.',
      )
      .then((confirmed) => {
        if (confirmed) {
          this.http.delete<ApiResponse>(`${this.apiUrl}/logs/${id}`).subscribe({
            next: (res) => {
              if (res.success) {
                this.http.get<ApiResponse<AttendanceLogEntry[]>>(`${this.apiUrl}/logs`).subscribe({
                  next: (logRes) => {
                    if (logRes.success && logRes.data) {
                      this.logs.set(logRes.data);
                    }
                  },
                });
              } else {
                this.dialogService.alert('LỖI', res.error || 'Không thể xóa lượt chấm công.');
              }
            },
            error: () => {
              this.dialogService.alert('LỖI', 'Lỗi kết nối máy chủ.');
            },
          });
        }
      });
  }
}
