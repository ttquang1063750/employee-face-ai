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
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogService } from '../../../../core/services/dialog.service';
import {
  HudSelectComponent,
  HudSelectOption,
} from '../../../../core/components/hud-select/hud-select';
import { HudAutocompleteComponent } from '../../../../core/components/hud-autocomplete/hud-autocomplete';
import { ApiResponse } from '../../../../core/models/api-response.model';
import { EmployeeBase } from '../../../../core/models/employee.model';
import {
  employeeSuggestionLabel as formatEmployeeSuggestionLabel,
  employeeSuggestionMeta as formatEmployeeSuggestionMeta,
} from '../../../../core/utils/employee-suggestion.util';
import { DocumentSourceType, DocumentVisibility } from '../../../../core/models/document.model';
import { environment } from '../../../../../environments/environment';
import { EmployeeService } from '../../../../core/services/employee.service';
import { IconComponent } from '../../../../core/components/icon/icon';

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.jpg',
  '.jpeg',
  '.png',
  '.mp4',
  '.webm',
  '.mov',
];
// Client-side check is just early UX feedback — the real cap is enforced
// server-side during the streaming multipart parse (MAX_DOCUMENT_BYTES in
// server.py). Kept in sync with that constant.
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const EXTERNAL_URL_PATTERN = /^https?:\/\//i;

@Component({
  selector: 'app-upload-document-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    HudSelectComponent,
    HudAutocompleteComponent,
    IconComponent,
    TranslatePipe,
  ],
  templateUrl: './upload-document-page.html',
  styleUrl: './upload-document-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadDocumentPage implements OnInit {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  private readonly apiUrl = environment.apiBaseUrl;

  employees = signal<EmployeeBase[]>([]);
  isUploading = signal<boolean>(false);
  uploadProgress = signal<number>(0);
  selectedFileName = signal<string | null>(null);
  private selectedFile = signal<File | null>(null);
  fileInputElement = viewChild<ElementRef<HTMLInputElement>>('fileInputElement');

  uploadForm = this.fb.group({
    title: this.fb.nonNullable.control('', Validators.required),
    visibility: this.fb.nonNullable.control<DocumentVisibility>('rieng'),
    employeeId: this.fb.control<number | null>(null, Validators.required),
    sourceType: this.fb.nonNullable.control<DocumentSourceType>('file'),
    externalUrl: this.fb.nonNullable.control(''),
  });
  uploadVisibilityOptions = computed<HudSelectOption<DocumentVisibility>[]>(() => {
    this.translate.currentLang(); // recompute labels when the language changes
    return [
      { value: 'rieng', label: this.translate.instant('uploadDocument.visibilityPrivate') },
      { value: 'chung', label: this.translate.instant('uploadDocument.visibilityBroadcast') },
    ];
  });
  sourceTypeOptions = computed<HudSelectOption<DocumentSourceType>[]>(() => {
    this.translate.currentLang(); // recompute labels when the language changes
    return [
      { value: 'file', label: this.translate.instant('uploadDocument.sourceFile') },
      { value: 'link', label: this.translate.instant('uploadDocument.sourceLink') },
    ];
  });

  // <app-hud-autocomplete> recipient picker — same shared shape as the
  // dashboard/compose employee pickers (see employee-suggestion.util.ts).
  // Its own text query is independent of uploadForm; selecting a suggestion
  // is what actually writes the chosen id into uploadForm.controls.employeeId.
  employeeQueryControl = new FormControl('', { nonNullable: true });
  private employeeQuery = toSignal(this.employeeQueryControl.valueChanges, {
    initialValue: this.employeeQueryControl.value,
  });
  employeeSuggestions = computed(() => {
    const q = this.employeeQuery().toLowerCase().trim();
    const sorted = [...this.employees()].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted.slice(0, 8);
    return sorted.filter((emp) => emp.name.toLowerCase().includes(q)).slice(0, 8);
  });
  employeeSuggestionLabel = formatEmployeeSuggestionLabel;
  employeeSuggestionMeta = (e: EmployeeBase) =>
    formatEmployeeSuggestionMeta(e, this.translate.currentLang() === 'en' ? 'en' : 'vi');

  constructor() {
    // A "chung" (broadcast) doc has no single owner, so the target-employee
    // field is only required while visibility is "rieng" — mirrors the
    // employee_id/visibility CHECK constraint enforced server-side.
    this.uploadForm.controls.visibility.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((visibility) => {
        const employeeIdControl = this.uploadForm.controls.employeeId;
        if (visibility === 'chung') {
          employeeIdControl.clearValidators();
          employeeIdControl.setValue(null);
          this.employeeQueryControl.setValue('');
        } else {
          employeeIdControl.setValidators(Validators.required);
        }
        employeeIdControl.updateValueAndValidity();
      });

    // Only one of "pick a file" / "paste a link" applies at a time —
    // externalUrl is required (and must look like a URL) only in link mode;
    // switching away from a mode clears that mode's own selection so a
    // stale file/link can't linger into a submit under the other mode.
    this.uploadForm.controls.sourceType.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((sourceType) => {
        const externalUrlControl = this.uploadForm.controls.externalUrl;
        if (sourceType === 'link') {
          externalUrlControl.setValidators([
            Validators.required,
            Validators.pattern(EXTERNAL_URL_PATTERN),
          ]);
          this.selectedFileName.set(null);
          this.selectedFile.set(null);
        } else {
          externalUrlControl.clearValidators();
          externalUrlControl.setValue('');
        }
        externalUrlControl.updateValueAndValidity();
      });
  }

  ngOnInit(): void {
    this.employeeService.getAll().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.employees.set(res.data);
        }
      },
      error: () => undefined,
    });
  }

  onEmployeeSelected(emp: EmployeeBase): void {
    this.uploadForm.controls.employeeId.setValue(emp.id);
  }

  triggerFileInput(): void {
    this.fileInputElement()?.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      await this.dialogService.alert(
        this.translate.instant('uploadDocument.unsupportedFormatTitle'),
        this.translate.instant('uploadDocument.unsupportedFormatMessage'),
      );
      input.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      await this.dialogService.alert(
        this.translate.instant('uploadDocument.fileTooLargeTitle'),
        this.translate.instant('uploadDocument.fileTooLargeMessage'),
      );
      input.value = '';
      return;
    }

    this.selectedFileName.set(file.name);
    this.selectedFile.set(file);
  }

  canSubmit(): boolean {
    if (this.uploadForm.invalid) return false;
    return this.uploadForm.controls.sourceType.value === 'link'
      ? true
      : this.selectedFile() !== null;
  }

  submitUpload(): void {
    if (!this.canSubmit()) return;
    const { title, visibility, employeeId, sourceType, externalUrl } =
      this.uploadForm.getRawValue();

    const formData = new FormData();
    formData.append('title', title);
    formData.append('visibility', visibility);
    formData.append('source_type', sourceType);
    if (visibility === 'rieng' && employeeId != null) {
      formData.append('employee_id', String(employeeId));
    }
    if (sourceType === 'link') {
      formData.append('external_url', externalUrl.trim());
    } else {
      const file = this.selectedFile();
      if (!file) return;
      formData.append('file', file);
    }

    this.isUploading.set(true);
    this.uploadProgress.set(0);
    this.http
      .post<ApiResponse>(`${this.apiUrl}/documents`, formData, {
        reportProgress: true,
        observe: 'events',
      })
      .subscribe({
        next: async (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.uploadProgress.set(Math.round((100 * event.loaded) / event.total));
          } else if (event.type === HttpEventType.Response) {
            const res = event.body;
            this.isUploading.set(false);
            if (res?.success) {
              await this.dialogService.alert(
                this.translate.instant('uploadDocument.successTitle'),
                this.translate.instant('uploadDocument.successMessage'),
              );
              this.router.navigate(['../'], { relativeTo: this.route });
            } else {
              await this.dialogService.alert(
                this.translate.instant('common.error'),
                res?.error || this.translate.instant('uploadDocument.uploadErrorMessage'),
              );
            }
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isUploading.set(false);
          await this.dialogService.alert(
            this.translate.instant('common.error'),
            err.error?.error || this.translate.instant('uploadDocument.genericServerError'),
          );
        },
      });
  }

  cancel(): void {
    this.router.navigate(['../'], { relativeTo: this.route });
  }
}
