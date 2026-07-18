import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  ElementRef,
  viewChild,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { RealtimeService } from '../../../core/services/realtime.service';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { isPasswordValid, PASSWORD_HINT } from '../../../core/services/credentials.util';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import { ApiResponse } from '../../../core/models/api-response.model';
import { DetailedEmployee, AttendanceLog } from '../../../core/models/employee.model';
import { LeaveRequest } from '../../../core/models/leave-request.model';

@Component({
  selector: 'app-staff-profile',
  standalone: true,
  imports: [FormsModule, CommonModule, DatePickerComponent],
  templateUrl: './staff-profile.html',
  styleUrls: ['./staff-profile.scss', '../../admin/employee-detail/employee-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffProfileComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private router = inject(Router);
  private dialogService = inject(DialogService);

  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');

  employee = signal<DetailedEmployee | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // --- Change password ---
  showPasswordModal = signal<boolean>(false);
  currentPassword = signal<string>('');
  newStaffPassword = signal<string>('');
  confirmStaffPassword = signal<string>('');
  showCurrentPassword = signal<boolean>(false);
  showNewStaffPassword = signal<boolean>(false);
  isSavingPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;
  passwordValid = computed(() => isPasswordValid(this.newStaffPassword()));
  passwordsMatch = computed(() => this.newStaffPassword() === this.confirmStaffPassword());

  // --- Change avatar ---
  showAvatarModal = signal<boolean>(false);
  imgBase64 = signal<string>('');
  showWebcam = signal<boolean>(false);
  isSavingAvatar = signal<boolean>(false);
  private webcamStream: MediaStream | null = null;

  // --- Leave requests ---
  showLeaveModal = signal<boolean>(false);
  leaveStartDate = signal<string>('');
  leaveEndDate = signal<string>('');
  leaveReason = signal<string>('');
  isSavingLeave = signal<boolean>(false);
  leaveRequests = signal<LeaveRequest[]>([]);

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

  // Computed: Aggregate working hours via pairing algorithm
  workingHours = computed(() => {
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
    Object.keys(logsByDate).forEach((date) => {
      // Sort day logs chronologically (oldest first)
      const dayLogs = logsByDate[date].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

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
  private realtimeService = inject(RealtimeService);
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadOwnProfile();
    this.loadLeaveRequests();
    this.startPolling();
  }

  startPolling(): void {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(() => {
      const employeeId = this.authService.currentUser()?.id;
      if (!employeeId) return;

      // Quiet reload profile details
      this.http.get<ApiResponse<DetailedEmployee>>(`${this.apiUrl}/employees/${employeeId}`).subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.employee.set(res.data);
          }
        },
      });

      // Quiet reload leave requests
      this.http
        .get<ApiResponse<LeaveRequest[]>>(`${this.apiUrl}/employees/${employeeId}/leave-requests`)
        .subscribe({
          next: (res) => {
            if (res.success && res.data) {
              this.leaveRequests.set(res.data);
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

  loadOwnProfile(): void {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<ApiResponse<DetailedEmployee>>(`${this.apiUrl}/employees/${employeeId}`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.employee.set(res.data);
          this.initializeDateFilters();
        } else {
          this.errorMsg.set(res.error || 'Không thể lấy thông tin hồ sơ.');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      },
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
      this.currentPage.update((p) => p - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
    }
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.src =
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
    }
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    });
  }

  // ===================== Change Password =====================
  openPasswordModal(): void {
    this.currentPassword.set('');
    this.newStaffPassword.set('');
    this.confirmStaffPassword.set('');
    this.showCurrentPassword.set(false);
    this.showNewStaffPassword.set(false);
    this.showPasswordModal.set(true);
  }

  closePasswordModal(): void {
    this.showPasswordModal.set(false);
  }

  async savePassword(): Promise<void> {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    if (!this.currentPassword()) {
      await this.dialogService.alert('THIẾU THÔNG TIN', 'Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (!this.passwordValid()) {
      await this.dialogService.alert('MẬT KHẨU KHÔNG HỢP LỆ', this.passwordHint);
      return;
    }
    if (!this.passwordsMatch()) {
      await this.dialogService.alert(
        'MẬT KHẨU KHÔNG KHỚP',
        'Mật khẩu mới và xác nhận mật khẩu không giống nhau.',
      );
      return;
    }

    this.isSavingPassword.set(true);
    this.http
      .put<ApiResponse>(`${this.apiUrl}/employees/${employeeId}/password`, {
        current_password: this.currentPassword(),
        new_password: this.newStaffPassword(),
      })
      .subscribe({
        next: async (res) => {
          this.isSavingPassword.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Đổi mật khẩu thành công.');
            this.closePasswordModal();
          } else {
            await this.dialogService.alert('LỖI', res.error || 'Không thể đổi mật khẩu.');
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSavingPassword.set(false);
          await this.dialogService.alert('LỖI', err.error?.error || 'Lỗi kết nối máy chủ.');
        },
      });
  }

  // ===================== Change Avatar =====================
  openAvatarModal(): void {
    this.imgBase64.set('');
    this.showWebcam.set(false);
    this.showAvatarModal.set(true);
  }

  closeAvatarModal(): void {
    this.stopWebcam();
    this.showAvatarModal.set(false);
  }

  async startWebcam(): Promise<void> {
    this.showWebcam.set(true);
    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 300, facingMode: 'user' },
      });
      setTimeout(() => {
        if (this.videoElement()) {
          this.videoElement()!.nativeElement.srcObject = this.webcamStream;
        }
      }, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.dialogService.alert('LỖI CAMERA', 'Không thể khởi chạy camera: ' + message);
      this.showWebcam.set(false);
    }
  }

  stopWebcam(): void {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((track) => track.stop());
      this.webcamStream = null;
    }
    this.showWebcam.set(false);
  }

  capturePhoto(): void {
    if (!this.webcamStream) return;
    const video = this.videoElement()!.nativeElement;
    const canvas = this.canvasElement()!.nativeElement;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      canvas.width = 400;
      canvas.height = 300;

      // Mirror the webcam frame during snapshot
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Reset transform
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      this.imgBase64.set(canvas.toDataURL('image/jpeg', 0.95));
      this.stopWebcam();
    }
  }

  triggerFileInput(): void {
    const fileInput = document.getElementById('staff-avatar-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  handleFileUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        this.imgBase64.set(e.target?.result as string);
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  saveAvatar(): void {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId || !this.imgBase64()) return;

    this.isSavingAvatar.set(true);
    this.http
      .put<ApiResponse>(`${this.apiUrl}/employees/${employeeId}/avatar`, { img: this.imgBase64() })
      .subscribe({
        next: async (res) => {
          this.isSavingAvatar.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật ảnh đại diện thành công.');
            this.closeAvatarModal();
            this.loadOwnProfile();
          } else {
            await this.dialogService.alert('LỖI', res.error || 'Không thể cập nhật ảnh đại diện.');
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSavingAvatar.set(false);
          await this.dialogService.alert('LỖI', err.error?.error || 'Lỗi kết nối máy chủ.');
        },
      });
  }

  // ===================== Leave Requests =====================
  openLeaveModal(): void {
    this.leaveStartDate.set('');
    this.leaveEndDate.set('');
    this.leaveReason.set('');
    this.showLeaveModal.set(true);
  }

  closeLeaveModal(): void {
    this.showLeaveModal.set(false);
  }

  loadLeaveRequests(): void {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    this.http.get<ApiResponse<LeaveRequest[]>>(`${this.apiUrl}/employees/${employeeId}/leave-requests`).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.leaveRequests.set(res.data);
        }
      },
    });
  }

  async submitLeaveRequest(): Promise<void> {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    if (!this.leaveStartDate() || !this.leaveEndDate() || !this.leaveReason().trim()) {
      await this.dialogService.alert('THIẾU THÔNG TIN', 'Vui lòng nhập đầy đủ ngày nghỉ và lý do.');
      return;
    }
    if (this.leaveEndDate() < this.leaveStartDate()) {
      await this.dialogService.alert('NGÀY KHÔNG HỢP LỆ', 'Ngày kết thúc phải sau ngày bắt đầu.');
      return;
    }

    this.isSavingLeave.set(true);
    this.http
      .post<ApiResponse>(`${this.apiUrl}/employees/${employeeId}/leave-requests`, {
        start_date: this.leaveStartDate(),
        end_date: this.leaveEndDate(),
        reason: this.leaveReason().trim(),
      })
      .subscribe({
        next: async (res) => {
          this.isSavingLeave.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Gửi đơn xin nghỉ thành công.');
            this.closeLeaveModal();
            this.loadLeaveRequests();
          } else {
            await this.dialogService.alert('LỖI', res.error || 'Không thể gửi đơn xin nghỉ.');
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSavingLeave.set(false);
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
}
