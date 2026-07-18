import { Component, OnInit, signal, computed, ElementRef, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';
import { CommonModule } from '@angular/common';
import { UsernameCheckService } from '../../../core/services/username-check.service';
import { isPasswordValid, PASSWORD_HINT, generateRandomPassword } from '../../../core/services/credentials.util';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [RouterLink, FormsModule, CommonModule, DatePickerComponent],
  templateUrl: './employee-detail.html',
  styleUrl: './employee-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmployeeDetailComponent implements OnInit {
  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');

  employee = signal<any | null>(null);
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
  private usernameCheckTimer: any;
  editPassword = signal<string>('');
  showEditPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;

  // 1a. Avatar update fields (webcam capture / file upload)
  imgBase64 = signal<string>('');
  showWebcam = signal<boolean>(false);
  private webcamStream: MediaStream | null = null;

  // 2. Promotion (Positions) Edit Fields
  newPosTitle = signal<string>('');
  newPosStartDate = signal<string>('');

  // 3. Compensation Adjust Fields
  newIncAmount = signal<number>(0);
  newIncEffectiveDate = signal<string>('');
  newIncReason = signal<string>('');

  // 4. Skills Set Edit Fields
  skillsListToEdit = signal<any[]>([]);
  newSkillName = signal<string>('');
  newSkillDesc = signal<string>('');

  // 5. Projects Log Edit Fields
  projectsListToEdit = signal<any[]>([]);
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

  // Computed: Password strength check for the edit form (blank = keep existing password)
  passwordValid = computed(() => !this.editPassword() || isPasswordValid(this.editPassword()));

  // Computed: Whether the base profile form can be saved
  canSaveBaseProfile = computed(() =>
    !!this.editUsername().trim() &&
    this.usernameStatus() === 'available' &&
    this.passwordValid()
  );

  private employeeId: number | null = null;
  private readonly apiUrl = 'http://localhost:8000/api';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private dialogService: DialogService,
    private usernameCheckService: UsernameCheckService
  ) {}

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

    this.http.get<any>(`${this.apiUrl}/employees/${this.employeeId}`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success) {
          this.employee.set(res.data);
          this.initializeSubFormData(res.data);
        } else {
          this.errorMsg.set(res.error || 'Không thể lấy thông tin chi tiết nhân sự.');
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      }
    });
  }

  initializeSubFormData(data: any): void {
    // Populate base fields
    this.editName.set(data.name);
    this.editAge.set(data.age);
    this.editRole.set(data.role);
    this.editUsername.set(data.username || '');
    this.usernameStatus.set(data.username ? 'available' : 'idle');
    this.editPassword.set('');

    // Pre-populate today's date for adjustments
    const today = new Date().toISOString().split('T')[0];
    this.newPosStartDate.set(today);
    this.newIncEffectiveDate.set(today);
    this.newProjStartDate.set(today);

    // Initialize attendance date range filters:
    // filterStartDate: first day of current month
    // filterEndDate: today
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Format YYYY-MM-DD manually keeping local timezone offset safe
    const pad = (num: number) => num.toString().padStart(2, '0');
    const startStr = `${startOfMonth.getFullYear()}-${pad(startOfMonth.getMonth() + 1)}-01`;
    const endStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    
    this.filterStartDate.set(startStr);
    this.filterEndDate.set(endStr);
    this.filterStartDateInput.set(startStr);
    this.filterEndDateInput.set(endStr);

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
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 300, facingMode: 'user' }
      });
      setTimeout(() => {
        if (this.videoElement()) {
          this.videoElement()!.nativeElement.srcObject = this.webcamStream;
        }
      }, 100);
    } catch (err: any) {
      await this.dialogService.alert('LỖI CAMERA', 'Không thể khởi chạy camera: ' + err.message);
      this.showWebcam.set(false);
    }
  }

  stopWebcam(): void {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(track => track.stop());
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
    const fileInput = document.getElementById('employee-detail-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  handleFileUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.imgBase64.set(e.target.result);
      };
      reader.readAsDataURL(input.files[0]);
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
        error: () => this.usernameStatus.set('idle')
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

    const payload: any = {
      name: this.editName(),
      age: this.editAge(),
      role: this.editRole(),
      username: this.editUsername().trim(),
      password: this.editPassword() || null,
      // The backend fully replaces skills/projects with whatever is sent here,
      // so the current lists must always be included to avoid wiping them.
      skills: this.employee()?.skills || [],
      projects: this.employee()?.projects || []
    };
    if (this.imgBase64()) {
      payload.img = this.imgBase64();
    }

    this.http.put<any>(`${this.apiUrl}/employees/${this.employeeId}`, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật thông tin cơ bản thành công.');
          this.closeBaseModal();
          this.loadEmployeeDetails();
        }
      },
      error: async (err) => {
        this.isSaving.set(false);
        await this.dialogService.alert('LỖI CẬP NHẬT', 'Lỗi lưu thông tin cơ bản: ' + (err.error?.error || err.message));
      }
    });
  }

  // --- 2. Add Position Promotion ---
  openPositionModal(): void {
    this.newPosTitle.set('');
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
      start_date: this.newPosStartDate()
    };

    this.http.post<any>(`${this.apiUrl}/employees/${this.employeeId}/positions`, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Bổ nhiệm chức vụ mới thành công.');
          this.closePositionModal();
          this.loadEmployeeDetails();
        }
      },
      error: async (err) => {
        this.isSaving.set(false);
        await this.dialogService.alert('LỖI BỔ NHIỆM', 'Lỗi ghi nhận bổ nhiệm: ' + (err.error?.error || err.message));
      }
    });
  }

  // --- 3. Adjust Compensation (Raises) ---
  openIncomeModal(): void {
    this.newIncAmount.set(0);
    this.newIncReason.set('');
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
      change_reason: this.newIncReason().trim() || 'HR Compensation Adjustment'
    };

    this.http.post<any>(`${this.apiUrl}/employees/${this.employeeId}/income`, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật điều chỉnh mức lương thành công.');
          this.closeIncomeModal();
          this.loadEmployeeDetails();
        }
      },
      error: async (err) => {
        this.isSaving.set(false);
        await this.dialogService.alert('LỖI ĐIỀU CHỈNH', 'Lỗi cập nhật lương: ' + (err.error?.error || err.message));
      }
    });
  }

  // --- 4. Manage Skills ---
  openSkillsModal(): void {
    // Reload local list copy from signal
    this.skillsListToEdit.set(this.employee()?.skills ? JSON.parse(JSON.stringify(this.employee()?.skills)) : []);
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
    if (this.skillsListToEdit().some(s => s.skill_name.toLowerCase() === name.toLowerCase())) {
      await this.dialogService.alert('KỸ NĂNG TỒN TẠI', 'Kỹ năng này đã tồn tại trong danh sách.');
      return;
    }

    this.skillsListToEdit.update(list => [...list, { skill_name: name, description: desc }]);
    this.newSkillName.set('');
    this.newSkillDesc.set('');
  }

  removeSkillFromList(index: number): void {
    this.skillsListToEdit.update(list => list.filter((_, i) => i !== index));
  }

  saveSkills(): void {
    if (!this.employeeId) return;
    this.isSaving.set(true);

    this.http.put<any>(`${this.apiUrl}/employees/${this.employeeId}/skills`, this.skillsListToEdit()).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật danh sách kỹ năng thành công.');
          this.closeSkillsModal();
          this.loadEmployeeDetails();
        }
      },
      error: async (err) => {
        this.isSaving.set(false);
        await this.dialogService.alert('LỖI CẬP NHẬT', 'Lỗi cập nhật kỹ năng: ' + (err.error?.error || err.message));
      }
    });
  }

  // --- 5. Manage Projects ---
  openProjectsModal(): void {
    this.projectsListToEdit.set(this.employee()?.projects ? JSON.parse(JSON.stringify(this.employee()?.projects)) : []);
    this.newProjName.set('');
    this.newProjRole.set('');
    this.newProjDesc.set('');
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

    this.projectsListToEdit.update(list => [...list, {
      project_name: name,
      role: role,
      description: desc,
      start_date: start,
      end_date: end
    }]);

    this.newProjName.set('');
    this.newProjRole.set('');
    this.newProjDesc.set('');
    this.newProjEndDate.set('');
  }

  removeProjectFromList(index: number): void {
    this.projectsListToEdit.update(list => list.filter((_, i) => i !== index));
  }

  saveProjects(): void {
    if (!this.employeeId) return;
    this.isSaving.set(true);

    this.http.put<any>(`${this.apiUrl}/employees/${this.employeeId}/projects`, this.projectsListToEdit()).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật lịch sử dự án thành công.');
          this.closeProjectsModal();
          this.loadEmployeeDetails();
        }
      },
      error: async (err) => {
        this.isSaving.set(false);
        await this.dialogService.alert('LỖI CẬP NHẬT', 'Lỗi cập nhật lịch sử dự án: ' + (err.error?.error || err.message));
      }
    });
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

  async deletePosition(id: number): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA CHỨC VỤ',
      'Bạn có chắc chắn muốn xóa chức vụ này khỏi lịch sử công tác?'
    );
    if (!confirmed) return;
    
    this.http.delete<any>(`${this.apiUrl}/positions/${id}`).subscribe({
      next: async (res) => {
        if (res.success) {
          await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa chức vụ thành công.');
          this.loadEmployeeDetails();
        }
      },
      error: async (err) => {
        await this.dialogService.alert('LỖI XÓA CHỨC VỤ', 'Lỗi khi xóa: ' + (err.error?.error || err.message));
      }
    });
  }

  async deleteIncome(id: number): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA MỨC LƯƠNG',
      'Bạn có chắc chắn muốn xóa lịch sử điều chỉnh lương này?'
    );
    if (!confirmed) return;
    
    this.http.delete<any>(`${this.apiUrl}/income/${id}`).subscribe({
      next: async (res) => {
        if (res.success) {
          await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa lịch sử thu nhập thành công.');
          this.loadEmployeeDetails();
        }
      },
      error: async (err) => {
        await this.dialogService.alert('LỖI XÓA LƯƠNG', 'Lỗi khi xóa: ' + (err.error?.error || err.message));
      }
    });
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
    }
  }
}
