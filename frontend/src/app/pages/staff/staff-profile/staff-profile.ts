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
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import {
  PASSWORD_HINT,
  passwordComplexityValidator,
} from '../../../core/services/credentials.util';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import { DetailedEmployee } from '../../../core/models/employee.model';
import { LeaveRequest } from '../../../core/models/leave-request.model';
import { EmployeeDocument } from '../../../core/models/document.model';
import { WebcamCaptureService } from '../../../core/services/webcam-capture.service';
import { PhotoCaptureStateService } from '../../../core/services/photo-capture-state.service';
import { AttendanceSummaryStateService } from '../../../core/services/attendance-summary-state.service';
import { EmployeeService } from '../../../core/services/employee.service';
import { AttendanceSummaryComponent } from '../../admin/employee-detail/components/attendance-summary/attendance-summary';
import { avatarUrl } from '../../../core/utils/image.util';
import { calculateAge } from '../../../core/utils/birthday.util';
import { triggerBlobDownload } from '../../../core/utils/download.util';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-staff-profile',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, DatePickerComponent, AttendanceSummaryComponent],
  templateUrl: './staff-profile.html',
  styleUrl: './staff-profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WebcamCaptureService, PhotoCaptureStateService, AttendanceSummaryStateService],
})
export class StaffProfileComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private router = inject(Router);
  private dialogService = inject(DialogService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);

  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');
  fileInputElement = viewChild<ElementRef<HTMLInputElement>>('fileInputElement');

  readonly photoCapture = inject(PhotoCaptureStateService);

  employee = signal<DetailedEmployee | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // --- Change password ---
  showPasswordModal = signal<boolean>(false);
  passwordForm = this.fb.nonNullable.group({
    current: [''],
    newPassword: ['', passwordComplexityValidator()],
    confirm: [''],
  });
  showCurrentPassword = signal<boolean>(false);
  showNewStaffPassword = signal<boolean>(false);
  isSavingPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;

  // --- Change avatar ---
  showAvatarModal = signal<boolean>(false);
  isSavingAvatar = signal<boolean>(false);

  // --- Leave requests ---
  showLeaveModal = signal<boolean>(false);
  leaveForm = this.fb.nonNullable.group({
    startDate: [''],
    endDate: [''],
    reason: [''],
  });
  isSavingLeave = signal<boolean>(false);
  leaveRequests = signal<LeaveRequest[]>([]);

  // --- My documents ---
  documents = signal<EmployeeDocument[]>([]);

  readonly attendance = inject(AttendanceSummaryStateService);
  private readonly rawLogs = computed(() => this.employee()?.raw_logs || []);

  private readonly apiUrl = environment.apiBaseUrl;
  protected readonly avatarUrl = avatarUrl;
  protected readonly calculateAge = calculateAge;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.attendance.configure(this.rawLogs);
    this.photoCapture.configure({
      videoElement: this.videoElement,
      canvasElement: this.canvasElement,
      fileInputElement: this.fileInputElement,
    });
  }

  ngOnInit(): void {
    this.loadOwnProfile();
    this.loadLeaveRequests();
    this.loadDocuments();
    this.startPolling();
  }

  startPolling(): void {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(() => {
      const employeeId = this.authService.currentUser()?.id;
      if (!employeeId) return;

      // Quiet reload profile details — silently ignored on failure (a
      // transient network blip shouldn't surface an error for a background
      // poll), matching RealtimeService.refreshLeaveRequests()'s convention.
      this.employeeService.getById(employeeId).subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.employee.set(res.data);
          }
        },
        error: () => undefined,
      });

      // Quiet reload leave requests
      this.employeeService.getLeaveRequests(employeeId).subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.leaveRequests.set(res.data);
          }
        },
        error: () => undefined,
      });

      // Quiet reload documents
      this.employeeService.getDocuments(employeeId).subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.documents.set(res.data);
          }
        },
        error: () => undefined,
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

    this.employeeService.getById(employeeId).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.employee.set(res.data);
          this.attendance.initializeDateRangeDefaults();
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
    this.passwordForm.reset({ current: '', newPassword: '', confirm: '' });
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

    const { current, newPassword, confirm } = this.passwordForm.getRawValue();

    if (!current) {
      await this.dialogService.alert('THIẾU THÔNG TIN', 'Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (this.passwordForm.controls.newPassword.hasError('passwordComplexity')) {
      await this.dialogService.alert('MẬT KHẨU KHÔNG HỢP LỆ', this.passwordHint);
      return;
    }
    if (newPassword !== confirm) {
      await this.dialogService.alert(
        'MẬT KHẨU KHÔNG KHỚP',
        'Mật khẩu mới và xác nhận mật khẩu không giống nhau.',
      );
      return;
    }

    this.isSavingPassword.set(true);
    this.employeeService.changePassword(employeeId, current, newPassword).subscribe({
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
    this.photoCapture.reset();
    this.showAvatarModal.set(true);
  }

  closeAvatarModal(): void {
    this.photoCapture.stopWebcam();
    this.showAvatarModal.set(false);
  }

  saveAvatar(): void {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId || !this.photoCapture.imgBase64()) return;

    this.isSavingAvatar.set(true);
    this.employeeService.changeAvatar(employeeId, this.photoCapture.imgBase64()).subscribe({
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
    this.leaveForm.reset({ startDate: '', endDate: '', reason: '' });
    this.showLeaveModal.set(true);
  }

  closeLeaveModal(): void {
    this.showLeaveModal.set(false);
  }

  loadLeaveRequests(): void {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    this.employeeService.getLeaveRequests(employeeId).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.leaveRequests.set(res.data);
        }
      },
      error: () => undefined,
    });
  }

  async submitLeaveRequest(): Promise<void> {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    const { startDate, endDate, reason } = this.leaveForm.getRawValue();

    if (!startDate || !endDate || !reason.trim()) {
      await this.dialogService.alert('THIẾU THÔNG TIN', 'Vui lòng nhập đầy đủ ngày nghỉ và lý do.');
      return;
    }
    if (endDate < startDate) {
      await this.dialogService.alert('NGÀY KHÔNG HỢP LỆ', 'Ngày kết thúc phải sau ngày bắt đầu.');
      return;
    }

    this.isSavingLeave.set(true);
    this.employeeService
      .submitLeaveRequest(employeeId, {
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim(),
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

  // ===================== My Documents =====================
  loadDocuments(): void {
    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    this.employeeService.getDocuments(employeeId).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.documents.set(res.data);
        }
      },
      error: () => undefined,
    });
  }

  downloadDocument(doc: EmployeeDocument): void {
    this.http
      .get(`${this.apiUrl}/documents/${doc.id}/download`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => triggerBlobDownload(blob, doc.file_name),
        error: async () => {
          await this.dialogService.alert('LỖI', 'Không thể tải xuống tài liệu.');
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
