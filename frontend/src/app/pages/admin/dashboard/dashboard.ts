import { Component, OnInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';

export interface EmployeeBase {
  id: number;
  name: string;
  age: number;
  image_path: string;
  role: string;
  current_position: string;
}

export interface AttendanceLog {
  id: number;
  employee_id: number;
  employee_name: string;
  timestamp: string;
  action: string;
  mood: string;
  captured_image_path: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
  employees = signal<EmployeeBase[]>([]);
  logs = signal<AttendanceLog[]>([]);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Filters for logs list
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');
  filterEmployeeName = signal<string>('');

  // Autocomplete dropdown state
  showSuggestions = signal<boolean>(false);

  // Pagination for logs list
  currentPage = signal<number>(1);
  pageSize = signal<number>(8);

  // Computed stats widgets (using overall logs)
  totalEmployees = computed(() => this.employees().length);
  totalLogsToday = computed(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return this.logs().filter(log => log.timestamp.startsWith(todayStr)).length;
  });

  // Computed: Filtered attendance logs in selected time range / employee search scope
  filteredLogs = computed(() => {
    const start = this.filterStartDate();
    const end = this.filterEndDate();
    const nameQuery = this.filterEmployeeName().toLowerCase().trim();
    const raw = this.logs() || [];

    return raw.filter((log: any) => {
      // timestamp format: "YYYY-MM-DD HH:mm:ss"
      const logDate = log.timestamp.split(' ')[0];
      const dateInRange = (!start || !end) ? true : (logDate >= start && logDate <= end);
      const nameMatches = !nameQuery ? true : log.employee_name.toLowerCase().includes(nameQuery);
      return dateInRange && nameMatches;
    });
  });

  // Computed: Unique employee name suggestions filtered by current input
  employeeSuggestions = computed(() => {
    const q = this.filterEmployeeName().toLowerCase().trim();
    const allNames = Array.from(new Set(this.logs().map((l: any) => l.employee_name as string))).sort();
    if (!q) return allNames.slice(0, 8);
    return allNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
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
      stressed: 0
    };
    
    const logsList = this.filteredLogs();
    if (logsList.length === 0) return { happy: 25, neutral: 25, sad: 25, stressed: 25 };

    logsList.forEach(log => {
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
      stressed: Math.round((stats['stressed'] / total) * 100)
    };
  });

  // Dynamic SVG Chart Coordinates for Hourly Peaks (08:00 - 18:00) using filtered logs
  hourlyTimeline = computed(() => {
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const counts = hours.map(() => 0);

    this.filteredLogs().forEach(log => {
      try {
        const timePart = log.timestamp.split(' ')[1];
        if (timePart) {
          const hour = parseInt(timePart.split(':')[0]);
          const idx = hours.indexOf(hour);
          if (idx !== -1) {
            counts[idx]++;
          }
        }
      } catch (e) {
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

    let d = '';
    points.forEach((pt, i) => {
      d += i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`;
    });

    return {
      points,
      dPath: d,
      hours: hours.map(h => `${h}h`)
    };
  });

  private readonly apiUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient, private authService: AuthService, private router: Router) {}

  ngOnInit(): void {
    // Set default dates
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    this.filterStartDate.set(`${startOfMonth.getFullYear()}-${pad(startOfMonth.getMonth() + 1)}-01`);
    this.filterEndDate.set(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);

    this.loadDashboardData();
  }

  loadDashboardData(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    // Call APIs in parallel
    this.http.get<any>(`${this.apiUrl}/employees`).subscribe({
      next: (empRes) => {
        if (empRes.success) {
          this.employees.set(empRes.data);
          
          this.http.get<any>(`${this.apiUrl}/logs`).subscribe({
            next: (logRes) => {
              this.isLoading.set(false);
              if (logRes.success) {
                this.logs.set(logRes.data);
              }
            },
            error: (err) => {
              this.isLoading.set(false);
              this.errorMsg.set('Không thể tải nhật ký chấm công.');
            }
          });
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMsg.set('Không thể kết nối đến máy chủ API.');
      }
    });
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
    const rows = data.map(log => [
      log.timestamp,
      `${log.employee_name} (#${log.employee_id})`,
      log.action === 'CHECK_IN' ? 'CHECK-IN' : 'CHECK-OUT',
      this.translateMood(log.mood)
    ]);

    // CSV UTF-8 BOM so Excel decodes Vietnamese characters correctly
    const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `bao_cao_tong_hop_${this.filterStartDate()}_to_${this.filterEndDate()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  translateMood(mood: string): string {
    const map: Record<string, string> = {
      "happy": "Vui vẻ 😊",
      "sad": "Buồn bã 😢",
      "angry": "Tức giận 😠",
      "surprise": "Ngạc nhiên 😲",
      "fear": "Lo sợ 😨",
      "disgust": "Khó chịu 😣",
      "neutral": "Bình thường 😐"
    };
    return map[mood.toLowerCase()] || mood;
  }
}
