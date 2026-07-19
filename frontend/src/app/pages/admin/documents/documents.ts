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
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { merge } from 'rxjs';
import { DialogService } from '../../../core/services/dialog.service';
import { readFileAsBase64 } from '../../../core/services/webcam-capture.service';
import { triggerBlobDownload } from '../../../core/utils/download.util';
import { HudSelectComponent, HudSelectOption } from '../../../core/components/hud-select/hud-select';
import { ApiResponse } from '../../../core/models/api-response.model';
import { EmployeeBase } from '../../../core/models/employee.model';
import { DocumentVisibility, EmployeeDocument } from '../../../core/models/document.model';
import { environment } from '../../../../environments/environment';
import { EmployeeService } from '../../../core/services/employee.service';

type VisibilityFilter = 'all' | DocumentVisibility;

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];
const MAX_FILE_BYTES = 15 * 1024 * 1024;

@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe, HudSelectComponent],
  templateUrl: './documents.html',
  styleUrl: './documents.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsComponent implements OnInit {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private readonly apiUrl = environment.apiBaseUrl;

  documents = signal<EmployeeDocument[]>([]);
  employees = signal<EmployeeBase[]>([]);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Free-text search + visibility select both live-filter (rule 10 only
  // gates date-range filters behind an explicit Apply action).
  searchQuery = new FormControl('', { nonNullable: true });
  private searchQueryValue = toSignal(this.searchQuery.valueChanges, {
    initialValue: this.searchQuery.value,
  });
  visibilityFilterControl = new FormControl<VisibilityFilter>('all', { nonNullable: true });
  readonly visibilityFilterOptions: HudSelectOption<VisibilityFilter>[] = [
    { value: 'all', label: 'Tất cả' },
    { value: 'chung', label: 'Chung (Toàn bộ nhân viên)' },
    { value: 'rieng', label: 'Riêng (Theo nhân viên)' },
  ];
  private visibilityFilter = toSignal(this.visibilityFilterControl.valueChanges, {
    initialValue: this.visibilityFilterControl.value,
  });

  currentPage = signal<number>(1);
  pageSizeControl = new FormControl(10, { nonNullable: true });
  private pageSize = toSignal(this.pageSizeControl.valueChanges, {
    initialValue: this.pageSizeControl.value,
  });

  constructor() {
    merge(
      this.searchQuery.valueChanges,
      this.visibilityFilterControl.valueChanges,
      this.pageSizeControl.valueChanges,
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.currentPage.set(1));

    // A "chung" (broadcast) doc has no single owner, so the target-employee
    // field is only required while visibility is "rieng" — mirrors the
    // employee_id/visibility CHECK constraint enforced server-side.
    this.uploadForm.controls.visibility.valueChanges.pipe(takeUntilDestroyed()).subscribe((visibility) => {
      const employeeIdControl = this.uploadForm.controls.employeeId;
      if (visibility === 'chung') {
        employeeIdControl.clearValidators();
        employeeIdControl.setValue(null);
      } else {
        employeeIdControl.setValidators(Validators.required);
      }
      employeeIdControl.updateValueAndValidity();
    });
  }

  filteredDocuments = computed(() => {
    const q = this.searchQueryValue().toLowerCase().trim();
    const visibility = this.visibilityFilter();
    let list = this.documents();

    if (visibility !== 'all') {
      list = list.filter((d) => d.visibility === visibility);
    }
    if (q) {
      list = list.filter(
        (d) => d.title.toLowerCase().includes(q) || (d.employee_name || '').toLowerCase().includes(q),
      );
    }
    return list;
  });

  totalPages = computed(() => Math.ceil(this.filteredDocuments().length / this.pageSize()) || 1);

  paginatedDocuments = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSize();
    return this.filteredDocuments().slice(start, start + this.pageSize());
  });

  // ===================== Upload modal =====================
  showUploadModal = signal<boolean>(false);
  isUploading = signal<boolean>(false);
  selectedFileName = signal<string | null>(null);
  private selectedFileBase64 = signal<string | null>(null);
  fileInputElement = viewChild<ElementRef<HTMLInputElement>>('fileInputElement');

  uploadForm = this.fb.group({
    title: this.fb.nonNullable.control('', Validators.required),
    visibility: this.fb.nonNullable.control<DocumentVisibility>('rieng'),
    employeeId: this.fb.control<number | null>(null, Validators.required),
  });
  readonly uploadVisibilityOptions: HudSelectOption<DocumentVisibility>[] = [
    { value: 'rieng', label: 'Riêng (chỉ 1 nhân viên nhận được)' },
    { value: 'chung', label: 'Chung (toàn bộ nhân viên nhận được)' },
  ];
  // computed(), not a plain array — options must re-derive as employees() loads.
  employeeOptions = computed<HudSelectOption<number | null>[]>(() => [
    { value: null, label: '-- Chọn nhân viên --' },
    ...this.employees().map((emp) => ({ value: emp.id, label: `${emp.name} (#${emp.id})` })),
  ]);

  ngOnInit(): void {
    this.loadDocuments();
    this.loadEmployees();
  }

  loadDocuments(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<ApiResponse<EmployeeDocument[]>>(`${this.apiUrl}/documents`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.documents.set(res.data);
        } else {
          this.errorMsg.set(res.error || 'Không thể tải danh sách tài liệu.');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      },
    });
  }

  loadEmployees(): void {
    this.employeeService.getAll().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.employees.set(res.data);
        }
      },
      error: () => undefined,
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

  openUploadModal(): void {
    this.uploadForm.reset({ title: '', visibility: 'rieng', employeeId: null });
    this.uploadForm.controls.employeeId.setValidators(Validators.required);
    this.uploadForm.controls.employeeId.updateValueAndValidity();
    this.selectedFileName.set(null);
    this.selectedFileBase64.set(null);
    this.showUploadModal.set(true);
  }

  closeUploadModal(): void {
    this.showUploadModal.set(false);
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
        'ĐỊNH DẠNG KHÔNG HỖ TRỢ',
        'Chỉ chấp nhận file PDF, Word, Excel hoặc ảnh (JPG/PNG).',
      );
      input.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      await this.dialogService.alert('FILE QUÁ LỚN', 'Dung lượng file tối đa cho phép là 15MB.');
      input.value = '';
      return;
    }

    this.selectedFileName.set(file.name);
    this.selectedFileBase64.set(await readFileAsBase64(file));
  }

  async submitUpload(): Promise<void> {
    if (this.uploadForm.invalid || !this.selectedFileBase64()) return;
    const { title, visibility, employeeId } = this.uploadForm.getRawValue();

    this.isUploading.set(true);
    this.http
      .post<ApiResponse>(`${this.apiUrl}/documents`, {
        title,
        visibility,
        employee_id: visibility === 'chung' ? null : employeeId,
        file_name: this.selectedFileName(),
        file: this.selectedFileBase64(),
      })
      .subscribe({
        next: async (res) => {
          this.isUploading.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Tải lên tài liệu thành công.');
            this.closeUploadModal();
            this.loadDocuments();
          } else {
            await this.dialogService.alert('LỖI', res.error || 'Không thể tải lên tài liệu.');
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isUploading.set(false);
          await this.dialogService.alert('LỖI', err.error?.error || 'Lỗi kết nối máy chủ.');
        },
      });
  }

  async deleteDocument(doc: EmployeeDocument): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA TÀI LIỆU',
      `Bạn có chắc chắn muốn xóa tài liệu "${doc.title}"? Thao tác này không thể hoàn tác.`,
    );
    if (!confirmed) return;

    this.http.delete<ApiResponse>(`${this.apiUrl}/documents/${doc.id}`).subscribe({
      next: (res) => {
        if (res.success) {
          this.loadDocuments();
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert('LỖI', err.error?.error || 'Lỗi kết nối máy chủ.');
      },
    });
  }

  downloadDocument(doc: EmployeeDocument): void {
    this.http.get(`${this.apiUrl}/documents/${doc.id}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => triggerBlobDownload(blob, doc.file_name),
      error: async () => {
        await this.dialogService.alert('LỖI', 'Không thể tải xuống tài liệu.');
      },
    });
  }
}
