import { Component, OnInit, signal, computed, ChangeDetectionStrategy, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import { RealtimeService } from '../../../core/services/realtime.service';
import { ApiResponse } from '../../../core/models/api-response.model';
import { LeaveRequest } from '../../../core/models/leave-request.model';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

@Component({
  selector: 'app-leave-requests',
  standalone: true,
  imports: [FormsModule, DatePickerComponent],
  templateUrl: './leave-requests.html',
  styleUrls: [
    './leave-requests.scss',
    '../dashboard/dashboard.scss',
    '../employees/employee-list.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeaveRequestsComponent implements OnInit {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private realtimeService = inject(RealtimeService);

  // The full list is shared app-wide via RealtimeService (single poller for
  // /api/leave-requests, also driving admin-shell's sidebar badge) rather
  // than this page running its own second interval against the same endpoint.
  requests = this.realtimeService.leaveRequests;
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);
  statusFilter = signal<StatusFilter>('pending');
  searchQuery = signal<string>('');

  // Date filters
  filterStartDateInput = signal<string>('');
  filterEndDateInput = signal<string>('');
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');

  currentPage = signal<number>(1);
  pageSize = signal<number>(8);

  pendingCount = this.realtimeService.pendingLeaveCount;

  filteredRequests = computed(() => {
    const filter = this.statusFilter();
    const q = this.searchQuery().toLowerCase().trim();
    const start = this.filterStartDate();
    const end = this.filterEndDate();
    let list = this.requests();

    if (filter !== 'all') {
      list = list.filter((r) => r.status === filter);
    }
    if (q) {
      list = list.filter(
        (r) =>
          r.employee_name.toLowerCase().includes(q) ||
          (r.current_position || '').toLowerCase().includes(q),
      );
    }
    if (start) {
      list = list.filter((r) => r.end_date >= start);
    }
    if (end) {
      list = list.filter((r) => r.start_date <= end);
    }
    return list;
  });

  totalPages = computed(() => Math.ceil(this.filteredRequests().length / this.pageSize()) || 1);

  paginatedRequests = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSize();
    return this.filteredRequests().slice(start, start + this.pageSize());
  });

  private readonly apiUrl = 'http://localhost:8000/api';

  ngOnInit(): void {
    this.loadRequests();
  }

  loadRequests(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<ApiResponse<LeaveRequest[]>>(`${this.apiUrl}/leave-requests`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.realtimeService.leaveRequests.set(res.data);
        } else {
          this.errorMsg.set(res.error || 'Không thể tải danh sách đơn xin nghỉ.');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      },
    });
  }

  applyDateFilter(): void {
    this.filterStartDate.set(this.filterStartDateInput());
    this.filterEndDate.set(this.filterEndDateInput());
    this.currentPage.set(1);
  }

  clearDateFilter(): void {
    this.filterStartDateInput.set('');
    this.filterEndDateInput.set('');
    this.filterStartDate.set('');
    this.filterEndDate.set('');
    this.currentPage.set(1);
  }

  setStatusFilter(filter: StatusFilter): void {
    this.statusFilter.set(filter);
    this.currentPage.set(1);
  }

  async approve(req: LeaveRequest): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'DUYỆT ĐƠN NGHỈ',
      `Duyệt đơn xin nghỉ của ${req.employee_name} (${req.start_date} → ${req.end_date})?`,
      'DUYỆT',
    );
    if (confirmed) {
      this.updateStatus(req, 'approved');
    }
  }

  async reject(req: LeaveRequest): Promise<void> {
    const reason = await this.dialogService.prompt(
      'TỪ CHỐI ĐƠN NGHỈ',
      `Nhập lý do từ chối đơn xin nghỉ của ${req.employee_name}:`,
      'VD: Dự án đang gấp, chưa sắp xếp được nhân sự thay thế...',
    );
    if (reason !== null) {
      this.updateStatus(req, 'rejected', reason.trim());
    }
  }

  private updateStatus(
    req: LeaveRequest,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
  ): void {
    this.http
      .put<ApiResponse>(`${this.apiUrl}/leave-requests/${req.id}`, {
        status,
        rejection_reason: rejectionReason,
      })
      .subscribe({
        next: async (res) => {
          if (res.success) {
            this.loadRequests();
          } else {
            await this.dialogService.alert(
              'LỖI',
              res.error || 'Không thể cập nhật trạng thái đơn nghỉ.',
            );
          }
        },
        error: async (err: HttpErrorResponse) => {
          await this.dialogService.alert('LỖI', err.error?.error || 'Lỗi kết nối máy chủ.');
        },
      });
  }

  leaveStatusLabel(status: string): string {
    switch (status) {
      case 'approved':
        return 'Đã duyệt';
      case 'rejected':
        return 'Từ chối';
      default:
        return 'Chờ duyệt';
    }
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
