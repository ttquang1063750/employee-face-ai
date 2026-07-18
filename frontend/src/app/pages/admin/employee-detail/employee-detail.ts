import {
  Component,
  OnInit,
  signal,
  computed,
  ElementRef,
  viewChild,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';
import { CommonModule } from '@angular/common';
import { UsernameCheckService } from '../../../core/services/username-check.service';
import {
  isPasswordValid,
  PASSWORD_HINT,
  generateRandomPassword,
} from '../../../core/services/credentials.util';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import { ApiResponse } from '../../../core/models/api-response.model';
import { DetailedEmployee, AttendanceLog, Skill, Project } from '../../../core/models/employee.model';
import { WebcamCaptureService, readFileAsBase64 } from '../../../core/services/webcam-capture.service';
import { todayLocalDateString, startOfMonthLocalDateString } from '../../../core/utils/date.util';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [RouterLink, FormsModule, CommonModule, DatePickerComponent],
  templateUrl: './employee-detail.html',
  styleUrl: './employee-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WebcamCaptureService],
})
export class EmployeeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private usernameCheckService = inject(UsernameCheckService);
  private webcam = inject(WebcamCaptureService);

  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');

  employee = signal<DetailedEmployee | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Sub-modal Visibility Signals
  showBaseModal = signal<boolean>(false);
  showPositionModal = signal<boolean>(false);
  showIncomeModal = signal<boolean>(false);
  showSkillsModal = signal<boolean>(false);
  showProjectsModal = signal<boolean>(false);

  isSaving = signal<boolean>(false);

  // 1. Base Profile Edit Fields
  editName = signal<string>('');
  editAge = signal<number>(30);
  editRole = signal<'staff' | 'admin'>('staff');
  editUsername = signal<string>('');
  usernameStatus = signal<'idle' | 'checking' | 'available' | 'taken'>('idle');
  private usernameCheckTimer: ReturnType<typeof setTimeout> | undefined;
  editPassword = signal<string>('');
  showEditPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;

  // 1a. Avatar update fields (webcam capture / file upload)
  imgBase64 = signal<string>('');
  showWebcam = signal<boolean>(false);

  // 2. Promotion (Positions) Edit Fields
  newPosTitle = signal<string>('');
  newPosStartDate = signal<string>('');

  // 3. Compensation Adjust Fields
  newIncAmount = signal<number>(0);
  newIncEffectiveDate = signal<string>('');
  newIncReason = signal<string>('');

  // 4. Skills Set Edit Fields
  skillsListToEdit = signal<Skill[]>([]);
  newSkillName = signal<string>('');
  newSkillDesc = signal<string>('');

  // 5. Projects Log Edit Fields
  projectsListToEdit = signal<Project[]>([]);
  newProjName = signal<string>('');
  newProjRole = signal<string>('');
  newProjDesc = signal<string>('');
  newProjStartDate = signal<string>('');
  newProjEndDate = signal<string>('');

  // 6. Attendance Filters (applied values used by the computed logs below;
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

  // Computed: Password strength check for the edit form (blank = keep existing password)
  passwordValid = computed(() => !this.editPassword() || isPasswordValid(this.editPassword()));

  // Computed: Whether the base profile form can be saved
  canSaveBaseProfile = computed(
    () =>
      !!this.editUsername().trim() && this.usernameStatus() === 'available' && this.passwordValid(),
  );

  private employeeId: number | null = null;
  private readonly apiUrl = 'http://localhost:8000/api';

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.employeeId = parseInt(idParam);
      this.loadEmployeeDetails();
    }
  }

  loadEmployeeDetails(): void {
    if (!this.employeeId) return;

    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<ApiResponse<DetailedEmployee>>(`${this.apiUrl}/employees/${this.employeeId}`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.employee.set(res.data);
          this.initializeSubFormData(res.data);
        } else {
          this.errorMsg.set(res.error || 'Không thể lấy thông tin chi tiết nhân sự.');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      },
    });
  }

  initializeSubFormData(data: DetailedEmployee): void {
    // Populate base fields
    this.editName.set(data.name);
    this.editAge.set(data.age);
    this.editRole.set(data.role);
    this.editUsername.set(data.username || '');
    this.usernameStatus.set(data.username ? 'available' : 'idle');
    this.editPassword.set('');

    // Pre-populate today's date for adjustments
    const today = todayLocalDateString();
    this.newPosStartDate.set(today);
    this.newIncEffectiveDate.set(today);
    this.newProjStartDate.set(today);

    // Initialize attendance date range filters:
    // filterStartDate: first day of current month
    // filterEndDate: today
    const startStr = startOfMonthLocalDateString();

    this.filterStartDate.set(startStr);
    this.filterEndDate.set(today);
    this.filterStartDateInput.set(startStr);
    this.filterEndDateInput.set(today);

    // Populate skills array copy
    this.skillsListToEdit.set(data.skills ? JSON.parse(JSON.stringify(data.skills)) : []);

    // Populate projects array copy
    this.projectsListToEdit.set(data.projects ? JSON.parse(JSON.stringify(data.projects)) : []);
  }

  // --- 1. Save Base Profile ---
  openBaseModal(): void {
    this.imgBase64.set('');
    this.showWebcam.set(false);
    this.showBaseModal.set(true);
  }

  closeBaseModal(): void {
    this.stopWebcam();
    clearTimeout(this.usernameCheckTimer);
    this.showBaseModal.set(false);
  }

  async startWebcam(): Promise<void> {
    this.showWebcam.set(true);
    try {
      const stream = await this.webcam.start();
      setTimeout(() => {
        if (this.videoElement()) {
          this.videoElement()!.nativeElement.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.dialogService.alert('LỖI CAMERA', 'Không thể khởi chạy camera: ' + message);
      this.showWebcam.set(false);
    }
  }

  stopWebcam(): void {
    this.webcam.stop();
    this.showWebcam.set(false);
  }

  capturePhoto(): void {
    const video = this.videoElement()!.nativeElement;
    const canvas = this.canvasElement()!.nativeElement;
    const dataUrl = this.webcam.capture(video, canvas, { width: 400, height: 300, quality: 0.95 });
    if (dataUrl) {
      this.imgBase64.set(dataUrl);
      this.stopWebcam();
    }
  }

  triggerFileInput(): void {
    const fileInput = document.getElementById('employee-detail-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  async handleFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.imgBase64.set(await readFileAsBase64(input.files[0]));
    }
  }

  onUsernameInput(value: string): void {
    this.editUsername.set(value);
    this.usernameStatus.set('idle');
    clearTimeout(this.usernameCheckTimer);

    const username = value.trim();
    if (!username || !this.employeeId) return;

    this.usernameCheckTimer = setTimeout(() => {
      this.usernameStatus.set('checking');
      this.usernameCheckService.check(username, this.employeeId!).subscribe({
        next: (res) => this.usernameStatus.set(res.exists ? 'taken' : 'available'),
        error: () => this.usernameStatus.set('idle'),
      });
    }, 450);
  }

  generatePassword(): void {
    this.editPassword.set(generateRandomPassword());
    this.showEditPassword.set(true);
  }

  saveBaseProfile(): void {
    if (!this.employeeId) return;
    this.isSaving.set(true);

    const payload: {
      name: string;
      age: number;
      role: string;
      username: string;
      password: string | null;
      skills: Skill[];
      projects: Project[];
      img?: string;
    } = {
      name: this.editName(),
      age: this.editAge(),
      role: this.editRole(),
      username: this.editUsername().trim(),
      password: this.editPassword() || null,
      // The backend fully replaces skills/projects with whatever is sent here,
      // so the current lists must always be included to avoid wiping them.
      skills: this.employee()?.skills || [],
      projects: this.employee()?.projects || [],
    };
    if (this.imgBase64()) {
      payload.img = this.imgBase64();
    }

    this.http.put<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId}`, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật thông tin cơ bản thành công.');
          this.closeBaseModal();
          this.loadEmployeeDetails();
        }
      },
      error: async (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        await this.dialogService.alert(
          'LỖI CẬP NHẬT',
          'Lỗi lưu thông tin cơ bản: ' + (err.error?.error || err.message),
        );
      },
    });
  }

  // --- 2. Add Position Promotion ---
  openPositionModal(): void {
    this.newPosTitle.set('');
    this.newPosStartDate.set(todayLocalDateString());
    this.showPositionModal.set(true);
  }

  closePositionModal(): void {
    this.showPositionModal.set(false);
  }

  savePromotion(): void {
    if (!this.employeeId || !this.newPosTitle().trim()) return;
    this.isSaving.set(true);

    const payload = {
      title: this.newPosTitle().trim(),
      start_date: this.newPosStartDate(),
    };

    this.http
      .post<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId}/positions`, payload)
      .subscribe({
        next: async (res) => {
          this.isSaving.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Bổ nhiệm chức vụ mới thành công.');
            this.closePositionModal();
            this.loadEmployeeDetails();
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSaving.set(false);
          await this.dialogService.alert(
            'LỖI BỔ NHIỆM',
            'Lỗi ghi nhận bổ nhiệm: ' + (err.error?.error || err.message),
          );
        },
      });
  }

  // --- 3. Adjust Compensation (Raises) ---
  openIncomeModal(): void {
    this.newIncAmount.set(0);
    this.newIncReason.set('');
    this.newIncEffectiveDate.set(todayLocalDateString());
    this.showIncomeModal.set(true);
  }

  closeIncomeModal(): void {
    this.showIncomeModal.set(false);
  }

  saveIncomeAdjustment(): void {
    if (!this.employeeId || this.newIncAmount() <= 0) return;
    this.isSaving.set(true);

    const payload = {
      amount: this.newIncAmount(),
      effective_date: this.newIncEffectiveDate(),
      change_reason: this.newIncReason().trim() || 'HR Compensation Adjustment',
    };

    this.http.post<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId}/income`, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật điều chỉnh mức lương thành công.');
          this.closeIncomeModal();
          this.loadEmployeeDetails();
        }
      },
      error: async (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        await this.dialogService.alert(
          'LỖI ĐIỀU CHỈNH',
          'Lỗi cập nhật lương: ' + (err.error?.error || err.message),
        );
      },
    });
  }

  // --- 4. Manage Skills ---
  openSkillsModal(): void {
    // Reload local list copy from signal
    this.skillsListToEdit.set(
      this.employee()?.skills ? JSON.parse(JSON.stringify(this.employee()?.skills)) : [],
    );
    this.newSkillName.set('');
    this.newSkillDesc.set('');
    this.showSkillsModal.set(true);
  }

  closeSkillsModal(): void {
    this.showSkillsModal.set(false);
  }

  async addSkillToList(): Promise<void> {
    const name = this.newSkillName().trim();
    const desc = this.newSkillDesc().trim() || 'No description provided';
    if (!name) return;

    // Check duplicate
    if (this.skillsListToEdit().some((s) => s.skill_name.toLowerCase() === name.toLowerCase())) {
      await this.dialogService.alert('KỸ NĂNG TỒN TẠI', 'Kỹ năng này đã tồn tại trong danh sách.');
      return;
    }

    this.skillsListToEdit.update((list) => [...list, { skill_name: name, description: desc }]);
    this.newSkillName.set('');
    this.newSkillDesc.set('');
  }

  removeSkillFromList(index: number): void {
    this.skillsListToEdit.update((list) => list.filter((_, i) => i !== index));
  }

  saveSkills(): void {
    if (!this.employeeId) return;
    this.isSaving.set(true);

    this.http
      .put<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId}/skills`, this.skillsListToEdit())
      .subscribe({
        next: async (res) => {
          this.isSaving.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật danh sách kỹ năng thành công.');
            this.closeSkillsModal();
            this.loadEmployeeDetails();
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSaving.set(false);
          await this.dialogService.alert(
            'LỖI CẬP NHẬT',
            'Lỗi cập nhật kỹ năng: ' + (err.error?.error || err.message),
          );
        },
      });
  }

  // --- 5. Manage Projects ---
  openProjectsModal(): void {
    this.projectsListToEdit.set(
      this.employee()?.projects ? JSON.parse(JSON.stringify(this.employee()?.projects)) : [],
    );
    this.newProjName.set('');
    this.newProjRole.set('');
    this.newProjDesc.set('');
    this.newProjStartDate.set(todayLocalDateString());
    this.newProjEndDate.set('');
    this.showProjectsModal.set(true);
  }

  closeProjectsModal(): void {
    this.showProjectsModal.set(false);
  }

  addProjectToList(): void {
    const name = this.newProjName().trim();
    const role = this.newProjRole().trim() || 'Contributor';
    const desc = this.newProjDesc().trim() || 'No description provided';
    const start = this.newProjStartDate();
    const end = this.newProjEndDate() ? this.newProjEndDate() : null;

    if (!name) return;

    this.projectsListToEdit.update((list) => [
      ...list,
      {
        project_name: name,
        role: role,
        description: desc,
        start_date: start,
        end_date: end,
      },
    ]);

    this.newProjName.set('');
    this.newProjRole.set('');
    this.newProjDesc.set('');
    this.newProjEndDate.set('');
  }

  removeProjectFromList(index: number): void {
    this.projectsListToEdit.update((list) => list.filter((_, i) => i !== index));
  }

  saveProjects(): void {
    if (!this.employeeId) return;
    this.isSaving.set(true);

    this.http
      .put<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId}/projects`, this.projectsListToEdit())
      .subscribe({
        next: async (res) => {
          this.isSaving.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật lịch sử dự án thành công.');
            this.closeProjectsModal();
            this.loadEmployeeDetails();
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSaving.set(false);
          await this.dialogService.alert(
            'LỖI CẬP NHẬT',
            'Lỗi cập nhật lịch sử dự án: ' + (err.error?.error || err.message),
          );
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

  async deletePosition(id: number): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA CHỨC VỤ',
      'Bạn có chắc chắn muốn xóa chức vụ này khỏi lịch sử công tác?',
    );
    if (!confirmed) return;

    this.http.delete<ApiResponse>(`${this.apiUrl}/positions/${id}`).subscribe({
      next: async (res) => {
        if (res.success) {
          await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa chức vụ thành công.');
          this.loadEmployeeDetails();
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert(
          'LỖI XÓA CHỨC VỤ',
          'Lỗi khi xóa: ' + (err.error?.error || err.message),
        );
      },
    });
  }

  async deleteIncome(id: number): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA MỨC LƯƠNG',
      'Bạn có chắc chắn muốn xóa lịch sử điều chỉnh lương này?',
    );
    if (!confirmed) return;

    this.http.delete<ApiResponse>(`${this.apiUrl}/income/${id}`).subscribe({
      next: async (res) => {
        if (res.success) {
          await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa lịch sử thu nhập thành công.');
          this.loadEmployeeDetails();
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert(
          'LỖI XÓA LƯƠNG',
          'Lỗi khi xóa: ' + (err.error?.error || err.message),
        );
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
}
