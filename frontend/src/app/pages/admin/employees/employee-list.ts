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
import { RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';
import { UsernameCheckService } from '../../../core/services/username-check.service';
import {
  isPasswordValid,
  PASSWORD_HINT,
  generateRandomPassword,
} from '../../../core/services/credentials.util';
import { ApiResponse } from '../../../core/models/api-response.model';
import { EmployeeBase } from '../../../core/models/employee.model';
import { WebcamCaptureService } from '../../../core/services/webcam-capture.service';
import { PhotoCaptureStateService } from '../../../core/services/photo-capture-state.service';

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WebcamCaptureService, PhotoCaptureStateService],
})
export class EmployeeListComponent implements OnInit {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private usernameCheckService = inject(UsernameCheckService);

  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');
  fileInputElement = viewChild<ElementRef<HTMLInputElement>>('fileInputElement');

  readonly photoCapture = inject(PhotoCaptureStateService);

  constructor() {
    this.photoCapture.configure({
      videoElement: this.videoElement,
      canvasElement: this.canvasElement,
      fileInputElement: this.fileInputElement,
    });
  }

  employees = signal<EmployeeBase[]>([]);
  searchQuery = signal<string>('');
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Modal and Form States
  showAddModal = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);

  // New Employee Form Signals
  newName = signal<string>('');
  newAge = signal<number>(28);
  newRole = signal<'staff' | 'admin'>('staff');
  newUsername = signal<string>('');
  usernameStatus = signal<'idle' | 'checking' | 'available' | 'taken'>('idle');
  private usernameCheckTimer: ReturnType<typeof setTimeout> | undefined;
  newPassword = signal<string>('');
  showNewPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;
  newPosition = signal<string>('');
  newIncome = signal<number>(3000);
  newSkills = signal<string>(''); // formatted as "Skill: Desc, Skill2: Desc"
  newProjects = signal<string>(''); // formatted as "Name: Role: Desc"

  // Pagination for employee list
  currentPage = signal<number>(1);
  pageSize = signal<number>(8);

  // Filtered employees list
  filteredEmployees = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.employees();
    return this.employees().filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.current_position.toLowerCase().includes(q) ||
        e.id.toString() === q,
    );
  });

  // Computed: Pagination properties
  totalPages = computed(() => {
    const len = this.filteredEmployees().length;
    return Math.ceil(len / this.pageSize()) || 1;
  });

  paginatedEmployees = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSize();
    return this.filteredEmployees().slice(start, start + this.pageSize());
  });

  // Computed: Password strength check for the create form
  passwordValid = computed(() => isPasswordValid(this.newPassword()));

  // Computed: Whether the registration form can be submitted
  canSubmit = computed(
    () =>
      !!this.newName() &&
      !!this.photoCapture.imgBase64() &&
      !!this.newUsername().trim() &&
      this.usernameStatus() === 'available' &&
      this.passwordValid(),
  );

  private readonly apiUrl = 'http://localhost:8000/api';

  ngOnInit(): void {
    this.loadEmployees();
  }

  loadEmployees(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<ApiResponse<EmployeeBase[]>>(`${this.apiUrl}/employees`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.employees.set(res.data);
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Không thể kết nối đến máy chủ để lấy danh sách nhân sự.');
      },
    });
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

  openAddModal(): void {
    this.resetForm();
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.photoCapture.stopWebcam();
    this.showAddModal.set(false);
  }

  resetForm(): void {
    this.newName.set('');
    this.newAge.set(28);
    this.newRole.set('staff');
    this.newUsername.set('');
    this.usernameStatus.set('idle');
    clearTimeout(this.usernameCheckTimer);
    this.newPassword.set('');
    this.newPosition.set('');
    this.newIncome.set(3000);
    this.newSkills.set('');
    this.newProjects.set('');
    this.photoCapture.reset();
  }

  onUsernameInput(value: string): void {
    this.newUsername.set(value);
    this.usernameStatus.set('idle');
    clearTimeout(this.usernameCheckTimer);

    const username = value.trim();
    if (!username) return;

    this.usernameCheckTimer = setTimeout(() => {
      this.usernameStatus.set('checking');
      this.usernameCheckService.check(username).subscribe({
        next: (res) => this.usernameStatus.set(res.exists ? 'taken' : 'available'),
        error: () => this.usernameStatus.set('idle'),
      });
    }, 450);
  }

  generatePassword(): void {
    this.newPassword.set(generateRandomPassword());
    this.showNewPassword.set(true);
  }

  async submitEmployee(): Promise<void> {
    if (!this.newName() || !this.photoCapture.imgBase64()) {
      await this.dialogService.alert(
        'THIẾU THÔNG TIN',
        'Vui lòng điền tên và chụp/tải lên ảnh chân dung mẫu.',
      );
      return;
    }

    if (!this.newUsername().trim() || this.usernameStatus() !== 'available') {
      await this.dialogService.alert(
        'USERNAME KHÔNG HỢP LỆ',
        'Vui lòng nhập một username hợp lệ và chưa được sử dụng.',
      );
      return;
    }

    if (!this.passwordValid()) {
      await this.dialogService.alert('MẬT KHẨU KHÔNG HỢP LỆ', this.passwordHint);
      return;
    }

    this.isSubmitting.set(true);

    // Parse skills: e.g. "Angular: Expert state management, ROS: Robotics control"
    const parsedSkills = this.newSkills()
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const parts = s.split(':');
        return {
          skill_name: parts[0]?.trim() || '',
          description: parts[1]?.trim() || 'No description provided',
        };
      })
      .filter((sk) => sk.skill_name.length > 0);

    // Parse projects: e.g. "Project Name: Role in project: Project description details"
    const parsedProjects = this.newProjects()
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => {
        const parts = p.split(':');
        return {
          project_name: parts[0]?.trim() || '',
          role: parts[1]?.trim() || 'Contributor',
          description: parts[2]?.trim() || 'No description provided',
        };
      })
      .filter((pr) => pr.project_name.length > 0);

    const payload = {
      name: this.newName(),
      age: this.newAge(),
      role: this.newRole(),
      username: this.newUsername().trim(),
      password: this.newPassword() || null,
      img: this.photoCapture.imgBase64(),
      position: this.newPosition() || 'Developer',
      income: this.newIncome(),
      skills: parsedSkills,
      projects: parsedProjects,
    };

    this.http.post<ApiResponse>(`${this.apiUrl}/employees`, payload).subscribe({
      next: async (res) => {
        this.isSubmitting.set(false);
        if (res.success) {
          await this.dialogService.alert(
            'ĐĂNG KÝ THÀNH CÔNG',
            'Đăng ký tài khoản nhân sự mới thành công.',
          );
          this.closeAddModal();
          this.loadEmployees();
        }
      },
      error: async (err: HttpErrorResponse) => {
        this.isSubmitting.set(false);
        await this.dialogService.alert(
          'LỖI ĐĂNG KÝ',
          'Lỗi đăng ký: ' + (err.error?.error || err.message),
        );
      },
    });
  }

  async deleteEmployee(id: number, name: string): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA NHÂN SỰ',
      `Bạn có chắc chắn muốn xóa hồ sơ nhân sự của "${name}" (Mã: #${id})? Hành động này sẽ xóa vĩnh viễn dữ liệu chấm công liên quan.`,
    );
    if (confirmed) {
      this.http.delete<ApiResponse>(`${this.apiUrl}/employees/${id}`).subscribe({
        next: async (res) => {
          if (res.success) {
            await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa hồ sơ nhân sự thành công.');
            this.loadEmployees();
          }
        },
        error: async (err: HttpErrorResponse) => {
          await this.dialogService.alert(
            'LỖI XÓA HỒ SƠ',
            'Lỗi xóa nhân viên: ' + (err.error?.error || err.message),
          );
        },
      });
    }
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.src =
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
    }
  }
}
