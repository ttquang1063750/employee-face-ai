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
import { FormsModule } from '@angular/forms';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import { ApiResponse } from '../../../core/models/api-response.model';
import { EmployeeBase } from '../../../core/models/employee.model';
import { AttendanceLogEntry } from '../../../core/models/attendance-log.model';
import { translateMood } from '../../../core/utils/mood.util';
import { todayLocalDateString, startOfMonthLocalDateString } from '../../../core/utils/date.util';
import { StatWidgetComponent } from './components/stat-widget/stat-widget';
import { HourlyChartComponent } from './components/hourly-chart/hourly-chart';
import { MoodDonutComponent } from './components/mood-donut/mood-donut';
import { LogsTableComponent } from './components/logs-table/logs-table';
import { DialogService } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    FormsModule,
    DatePickerComponent,
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

  employees = signal<EmployeeBase[]>([]);
  logs = signal<AttendanceLogEntry[]>([]);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Filters for logs list (applied values used by filteredLogs below;
  // the *Input signals are the draft date-range values bound to the date
  // pickers and only take effect once ÁP DỤNG is clicked)
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');
  filterStartDateInput = signal<string>('');
  filterEndDateInput = signal<string>('');
  filterEmployeeName = signal<string>('');

  // Autocomplete dropdown state
  showSuggestions = signal<boolean>(false);

  // Pagination for logs list
  currentPage = signal<number>(1);
  pageSize = signal<number>(8);

  // Computed stats widgets (using overall logs)
  totalEmployees = computed(() => this.employees().length);

  // Computed: Filtered attendance logs in selected time range / employee search scope
  filteredLogs = computed(() => {
    const start = this.filterStartDate();
    const end = this.filterEndDate();
    const nameQuery = this.filterEmployeeName().toLowerCase().trim();
    const raw = this.logs() || [];

    return raw.filter((log) => {
      // timestamp format: "YYYY-MM-DD HH:mm:ss"
      const logDate = log.timestamp.split(' ')[0];
      const dateInRange = !start || !end ? true : logDate >= start && logDate <= end;
      const nameMatches = !nameQuery ? true : log.employee_name.toLowerCase().includes(nameQuery);
      return dateInRange && nameMatches;
    });
  });

  totalLogsInRange = computed(() => this.filteredLogs().length);

  // Computed: Unique employee name suggestions filtered by current input
  employeeSuggestions = computed(() => {
    const q = this.filterEmployeeName().toLowerCase().trim();
    const allNames = Array.from(
      new Set(this.logs().map((l) => l.employee_name)),
    ).sort();
    if (!q) return allNames.slice(0, 8);
    return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
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
  moodStats = computed(() => {
    const stats: Record<string, number> = {
      happy: 0,
      neutral: 0,
      sad: 0,
      stressed: 0,
    };

    const logsList = this.filteredLogs();
    if (logsList.length === 0) return { happy: 0, neutral: 0, sad: 0, stressed: 0 };

    logsList.forEach((log) => {
      const m = log.mood.toLowerCase();
      if (m.includes('happy') || m.includes('vui')) stats['happy']++;
      else if (m.includes('neutral') || m.includes('bình')) stats['neutral']++;
      else if (m.includes('sad') || m.includes('buồn')) stats['sad']++;
      else stats['stressed']++;
    });

    const total = logsList.length;
    return {
      happy: Math.round((stats['happy'] / total) * 100),
      neutral: Math.round((stats['neutral'] / total) * 100),
      sad: Math.round((stats['sad'] / total) * 100),
      stressed: Math.round((stats['stressed'] / total) * 100),
    };
  });

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
    const segments = [
      { key: 'happy', label: 'Vui vẻ 😊', value: m.happy, color: 'var(--color-cyan)' },
      { key: 'neutral', label: 'Bình thường 😐', value: m.neutral, color: 'var(--color-info)' },
      { key: 'sad', label: 'Buồn bã 😢', value: m.sad, color: 'var(--color-red)' },
      {
        key: 'stressed',
        label: 'Căng thẳng / Lo lắng 😰',
        value: m.stressed,
        color: 'var(--color-orange)',
      },
    ];
    let acc = 0;
    return segments.map((seg) => {
      const offset = -acc;
      acc += seg.value;
      return { ...seg, offset };
    });
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

  private readonly apiUrl = 'http://localhost:8000/api';
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Set default dates
    const startStr = startOfMonthLocalDateString();
    const endStr = todayLocalDateString();
    this.filterStartDate.set(startStr);
    this.filterEndDate.set(endStr);
    this.filterStartDateInput.set(startStr);
    this.filterEndDateInput.set(endStr);

    this.loadDashboardData();
    this.startPolling();
  }

  startPolling(): void {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(() => {
      // Quiet reload: we load dashboard data directly
      this.http.get<ApiResponse<EmployeeBase[]>>(`${this.apiUrl}/employees`).subscribe({
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
    this.http.get<ApiResponse<EmployeeBase[]>>(`${this.apiUrl}/employees`).subscribe({
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

  selectSuggestion(name: string): void {
    this.filterEmployeeName.set(name);
    this.showSuggestions.set(false);
    this.currentPage.set(1);
  }

  onSearchInput(value: string): void {
    this.filterEmployeeName.set(value);
    this.showSuggestions.set(true);
    this.currentPage.set(1);
  }

  closeSuggestions(): void {
    setTimeout(() => this.showSuggestions.set(false), 150);
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
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `bao_cao_tong_hop_${this.filterStartDate()}_to_${this.filterEndDate()}.csv`,
    );
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  onDeleteLog(id: number): void {
    this.dialogService.confirm('XÁC NHẬN XÓA', 'Bạn có chắc chắn muốn xóa lượt chấm công này? Thao tác này không thể hoàn tác.').then((confirmed) => {
      if (confirmed) {
        this.http.delete<ApiResponse<any>>(`${this.apiUrl}/logs/${id}`).subscribe({
          next: (res) => {
            if (res.success) {
              this.http.get<ApiResponse<AttendanceLogEntry[]>>(`${this.apiUrl}/logs`).subscribe({
                next: (logRes) => {
                  if (logRes.success && logRes.data) {
                    this.logs.set(logRes.data);
                  }
                }
              });
            } else {
              this.dialogService.alert('LỖI', res.error || 'Không thể xóa lượt chấm công.');
            }
          },
          error: () => {
            this.dialogService.alert('LỖI', 'Lỗi kết nối máy chủ.');
          }
        });
      }
    });
  }
}
