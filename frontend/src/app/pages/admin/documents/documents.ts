import {
  Component,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { merge } from 'rxjs';
import { DialogService } from '../../../core/services/dialog.service';
import { openEmployeeDocument } from '../../../core/utils/document-action.util';
import {
  HudSelectComponent,
  HudSelectOption,
} from '../../../core/components/hud-select/hud-select';
import { ApiResponse } from '../../../core/models/api-response.model';
import { DocumentVisibility, EmployeeDocument } from '../../../core/models/document.model';
import { environment } from '../../../../environments/environment';

type VisibilityFilter = 'all' | DocumentVisibility;

@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe, RouterLink, HudSelectComponent],
  templateUrl: './documents.html',
  styleUrl: './documents.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsComponent implements OnInit {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private readonly apiUrl = environment.apiBaseUrl;

  documents = signal<EmployeeDocument[]>([]);
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
        (d) =>
          d.title.toLowerCase().includes(q) || (d.employee_name || '').toLowerCase().includes(q),
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

  ngOnInit(): void {
    this.loadDocuments();
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
    openEmployeeDocument(this.http, this.apiUrl, doc, async () => {
      await this.dialogService.alert('LỖI', 'Không thể tải xuống tài liệu.');
    });
  }
}
