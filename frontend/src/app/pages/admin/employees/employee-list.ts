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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { map } from 'rxjs';
import { DialogService } from '../../../core/services/dialog.service';
import {
  UsernameCheckService,
  usernameStatusSignal,
} from '../../../core/services/username-check.service';
import {
  PASSWORD_HINT,
  generateRandomPassword,
  passwordComplexityValidator,
} from '../../../core/services/credentials.util';
import { EmployeeBase, EmployeeRole } from '../../../core/models/employee.model';
import { WebcamCaptureService } from '../../../core/services/webcam-capture.service';
import { PhotoCaptureStateService } from '../../../core/services/photo-capture-state.service';
import { EmployeeService } from '../../../core/services/employee.service';
import { avatarUrl } from '../../../core/utils/image.util';
import { calculateAge } from '../../../core/utils/birthday.util';
import {
  HudSelectComponent,
  HudSelectOption,
} from '../../../core/components/hud-select/hud-select';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import { IconComponent } from '../../../core/components/icon/icon';

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    HudSelectComponent,
    DatePickerComponent,
    IconComponent,
  ],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WebcamCaptureService, PhotoCaptureStateService],
})
export class EmployeeListComponent implements OnInit {
  private dialogService = inject(DialogService);
  private usernameCheckService = inject(UsernameCheckService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);

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
    this.searchQuery.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.currentPage.set(1));
    this.pageSize.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.currentPage.set(1));
  }

  employees = signal<EmployeeBase[]>([]);
  searchQuery = new FormControl('', { nonNullable: true });
  private searchQueryValue = toSignal(this.searchQuery.valueChanges, {
    initialValue: this.searchQuery.value,
  });
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Modal and Form States
  showAddModal = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);

  // New Employee Registration Form
  newEmployeeForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    date_of_birth: [''],
    position: [''],
    income: [3000],
    role: this.fb.nonNullable.control<EmployeeRole>('staff'),
    username: this.fb.nonNullable.control('', {
      validators: Validators.required,
      asyncValidators: this.usernameCheckService.usernameTakenValidator(),
    }),
    password: this.fb.nonNullable.control('', passwordComplexityValidator()),
    skills: [''], // formatted as "Skill: Desc, Skill2: Desc"
    projects: [''], // formatted as "Name: Role: Desc"
  });
  private newEmployeeFormValue = toSignal(
    this.newEmployeeForm.valueChanges.pipe(map(() => this.newEmployeeForm.getRawValue())),
    { initialValue: this.newEmployeeForm.getRawValue() },
  );
  usernameStatus = usernameStatusSignal(this.newEmployeeForm.controls.username);
  showNewPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;
  readonly roleOptions: HudSelectOption<EmployeeRole>[] = [
    { value: 'staff', label: 'Nhân viên (Staff)' },
    { value: 'admin', label: 'Quản lý (Admin)' },
  ];

  // Pagination for employee list
  currentPage = signal<number>(1);
  pageSize = new FormControl(10, { nonNullable: true });
  private pageSizeValue = toSignal(this.pageSize.valueChanges, {
    initialValue: this.pageSize.value,
  });

  // Filtered employees list
  filteredEmployees = computed(() => {
    const q = this.searchQueryValue().toLowerCase().trim();
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
    return Math.ceil(len / this.pageSizeValue()) || 1;
  });

  paginatedEmployees = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSizeValue();
    return this.filteredEmployees().slice(start, start + this.pageSizeValue());
  });

  // Computed: Whether the registration form can be submitted
  canSubmit = computed(() => {
    const { name, username } = this.newEmployeeFormValue();
    return (
      !!name &&
      !!this.photoCapture.imgBase64() &&
      !!username.trim() &&
      this.usernameStatus() === 'available' &&
      !this.newEmployeeForm.controls.password.hasError('passwordComplexity')
    );
  });

  protected readonly avatarUrl = avatarUrl;
  protected readonly calculateAge = calculateAge;

  ngOnInit(): void {
    this.loadEmployees();
  }

  loadEmployees(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.employeeService.getAll().subscribe({
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
    this.newEmployeeForm.reset({
      name: '',
      date_of_birth: '',
      position: '',
      income: 3000,
      role: 'staff',
      username: '',
      password: '',
      skills: '',
      projects: '',
    });
    this.showNewPassword.set(false);
    this.photoCapture.reset();
  }

  generatePassword(): void {
    this.newEmployeeForm.controls.password.setValue(generateRandomPassword());
    this.showNewPassword.set(true);
  }

  async submitEmployee(): Promise<void> {
    const { name, date_of_birth, position, income, role, username, password, skills, projects } =
      this.newEmployeeForm.getRawValue();

    if (!name || !this.photoCapture.imgBase64()) {
      await this.dialogService.alert(
        'THIẾU THÔNG TIN',
        'Vui lòng điền tên và chụp/tải lên ảnh chân dung mẫu.',
      );
      return;
    }

    if (!username.trim() || this.usernameStatus() !== 'available') {
      await this.dialogService.alert(
        'USERNAME KHÔNG HỢP LỆ',
        'Vui lòng nhập một username hợp lệ và chưa được sử dụng.',
      );
      return;
    }

    if (this.newEmployeeForm.controls.password.hasError('passwordComplexity')) {
      await this.dialogService.alert('MẬT KHẨU KHÔNG HỢP LỆ', this.passwordHint);
      return;
    }

    this.isSubmitting.set(true);

    // Parse skills: e.g. "Angular: Expert state management, ROS: Robotics control"
    const parsedSkills = skills
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
    const parsedProjects = projects
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
      name,
      date_of_birth: date_of_birth || null,
      role,
      username: username.trim(),
      password: password || null,
      img: this.photoCapture.imgBase64(),
      position: position || 'Developer',
      income,
      skills: parsedSkills,
      projects: parsedProjects,
    };

    this.employeeService.create(payload).subscribe({
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
      this.employeeService.delete(id).subscribe({
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
