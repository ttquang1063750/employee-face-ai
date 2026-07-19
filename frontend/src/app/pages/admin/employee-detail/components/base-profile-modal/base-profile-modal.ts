import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  signal,
  computed,
  input,
  output,
  inject,
  ElementRef,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DialogService } from '../../../../../core/services/dialog.service';
import { UsernameCheckService } from '../../../../../core/services/username-check.service';
import { WebcamCaptureService, readFileAsBase64 } from '../../../../../core/services/webcam-capture.service';
import {
  isPasswordValid,
  PASSWORD_HINT,
  generateRandomPassword,
} from '../../../../../core/services/credentials.util';
import { onImageError } from '../../../../../core/utils/image.util';
import { ApiResponse } from '../../../../../core/models/api-response.model';
import { DetailedEmployee, Skill, Project } from '../../../../../core/models/employee.model';

@Component({
  selector: 'app-base-profile-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './base-profile-modal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WebcamCaptureService],
})
export class BaseProfileModalComponent implements OnInit {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private usernameCheckService = inject(UsernameCheckService);
  private webcam = inject(WebcamCaptureService);
  private readonly apiUrl = 'http://localhost:8000/api';

  employee = input.required<DetailedEmployee>();

  // `closed`: user cancelled, no changes were saved.
  // `saved`: the update succeeded — parent should reload the employee record.
  closed = output<void>();
  saved = output<void>();

  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');
  fileInputElement = viewChild<ElementRef<HTMLInputElement>>('fileInputElement');

  editName = signal<string>('');
  editAge = signal<number>(30);
  editRole = signal<'staff' | 'admin'>('staff');
  editUsername = signal<string>('');
  usernameStatus = signal<'idle' | 'checking' | 'available' | 'taken'>('idle');
  private usernameCheckTimer: ReturnType<typeof setTimeout> | undefined;
  editPassword = signal<string>('');
  showEditPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;

  imgBase64 = signal<string>('');
  showWebcam = signal<boolean>(false);

  isSaving = signal<boolean>(false);

  protected readonly onImageError = onImageError;

  passwordValid = computed(() => !this.editPassword() || isPasswordValid(this.editPassword()));
  canSave = computed(
    () => !!this.editUsername().trim() && this.usernameStatus() === 'available' && this.passwordValid(),
  );

  ngOnInit(): void {
    const data = this.employee();
    this.editName.set(data.name);
    this.editAge.set(data.age);
    this.editRole.set(data.role);
    this.editUsername.set(data.username || '');
    this.usernameStatus.set(data.username ? 'available' : 'idle');
    this.editPassword.set('');
  }

  close(): void {
    this.stopWebcam();
    clearTimeout(this.usernameCheckTimer);
    this.closed.emit();
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
    this.fileInputElement()?.nativeElement.click();
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
    if (!username) return;

    const employeeId = this.employee().id;
    this.usernameCheckTimer = setTimeout(() => {
      this.usernameStatus.set('checking');
      this.usernameCheckService.check(username, employeeId).subscribe({
        next: (res) => this.usernameStatus.set(res.exists ? 'taken' : 'available'),
        error: () => this.usernameStatus.set('idle'),
      });
    }, 450);
  }

  generatePassword(): void {
    this.editPassword.set(generateRandomPassword());
    this.showEditPassword.set(true);
  }

  save(): void {
    this.isSaving.set(true);
    const employeeId = this.employee().id;

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
      skills: this.employee().skills || [],
      projects: this.employee().projects || [],
    };
    if (this.imgBase64()) {
      payload.img = this.imgBase64();
    }

    this.http.put<ApiResponse>(`${this.apiUrl}/employees/${employeeId}`, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật thông tin cơ bản thành công.');
          this.stopWebcam();
          clearTimeout(this.usernameCheckTimer);
          this.saved.emit();
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
}
