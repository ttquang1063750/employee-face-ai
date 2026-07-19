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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { map } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { DialogService } from '../../../../../core/services/dialog.service';
import {
  UsernameCheckService,
  usernameStatusSignal,
} from '../../../../../core/services/username-check.service';
import { WebcamCaptureService } from '../../../../../core/services/webcam-capture.service';
import { PhotoCaptureStateService } from '../../../../../core/services/photo-capture-state.service';
import { EmployeeService, UpdateEmployeePayload } from '../../../../../core/services/employee.service';
import {
  PASSWORD_HINT,
  generateRandomPassword,
  passwordComplexityValidator,
} from '../../../../../core/services/credentials.util';
import { avatarUrl, onImageError } from '../../../../../core/utils/image.util';
import { DetailedEmployee } from '../../../../../core/models/employee.model';

@Component({
  selector: 'app-base-profile-modal',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './base-profile-modal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WebcamCaptureService, PhotoCaptureStateService],
})
export class BaseProfileModalComponent implements OnInit {
  private dialogService = inject(DialogService);
  private usernameCheckService = inject(UsernameCheckService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);

  employee = input.required<DetailedEmployee>();

  // `closed`: user cancelled, no changes were saved.
  // `saved`: the update succeeded — parent should reload the employee record.
  closed = output<void>();
  saved = output<void>();

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

  editForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    age: [30],
    role: this.fb.nonNullable.control<'staff' | 'admin'>('staff'),
    username: ['', Validators.required],
    password: ['', passwordComplexityValidator()],
  });
  private editFormValue = toSignal(
    this.editForm.valueChanges.pipe(map(() => this.editForm.getRawValue())),
    { initialValue: this.editForm.getRawValue() },
  );
  usernameStatus = usernameStatusSignal(this.editForm.controls.username);
  showEditPassword = signal<boolean>(false);
  readonly passwordHint = PASSWORD_HINT;

  isSaving = signal<boolean>(false);

  protected readonly onImageError = onImageError;
  protected readonly avatarUrl = avatarUrl;

  canSave = computed(() => {
    const { username } = this.editFormValue();
    return (
      !!username.trim() &&
      this.usernameStatus() === 'available' &&
      !this.editForm.controls.password.hasError('passwordComplexity')
    );
  });

  ngOnInit(): void {
    const data = this.employee();
    this.editForm.reset({
      name: data.name,
      age: data.age,
      role: data.role,
      username: data.username || '',
      password: '',
    });
    // Attached *after* the reset above, and deliberately not followed by an
    // explicit updateValueAndValidity() call: addAsyncValidators() alone does
    // not retroactively validate, so the employee's own current username
    // (obviously already valid) is never re-checked against itself on open —
    // the check only actually runs the next time the user edits this field.
    // (Attaching it before reset() and letting reset() trigger the first run
    // was tried and reliably left the control's very first validation stuck
    // PENDING forever — a reproduced bug, not a hunch.)
    this.editForm.controls.username.addAsyncValidators(
      this.usernameCheckService.usernameTakenValidator(data.id),
    );
  }

  close(): void {
    this.photoCapture.stopWebcam();
    this.closed.emit();
  }

  generatePassword(): void {
    this.editForm.controls.password.setValue(generateRandomPassword());
    this.showEditPassword.set(true);
  }

  save(): void {
    this.isSaving.set(true);
    const employeeId = this.employee().id;
    const { name, age, role, username, password } = this.editForm.getRawValue();

    const payload: UpdateEmployeePayload = {
      name,
      age,
      role,
      username: username.trim(),
      password: password || null,
      // The backend fully replaces skills/projects with whatever is sent here,
      // so the current lists must always be included to avoid wiping them.
      skills: this.employee().skills || [],
      projects: this.employee().projects || [],
    };
    if (this.photoCapture.imgBase64()) {
      payload.img = this.photoCapture.imgBase64();
    }

    this.employeeService.update(employeeId, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật thông tin cơ bản thành công.');
          this.photoCapture.stopWebcam();
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
