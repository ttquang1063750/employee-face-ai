import {
  Component,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogService } from '../../../core/services/dialog.service';
import { DatePickerComponent } from '../../../core/components/date-picker/date-picker';
import {
  HudSelectComponent,
  HudSelectOption,
} from '../../../core/components/hud-select/hud-select';
import { RealtimeService } from '../../../core/services/realtime.service';
import { ApiResponse } from '../../../core/models/api-response.model';
import { LeaveRequest } from '../../../core/models/leave-request.model';
import { environment } from '../../../../environments/environment';
import { IconComponent } from '../../../core/components/icon/icon';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

@Component({
  selector: 'app-leave-requests',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePickerComponent,
    HudSelectComponent,
    IconComponent,
    TranslatePipe,
  ],
  templateUrl: './leave-requests.html',
  styleUrl: './leave-requests.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeaveRequestsComponent implements OnInit {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private realtimeService = inject(RealtimeService);
  private translate = inject(TranslateService);

  // The full list is shared app-wide via RealtimeService (single poller for
  // /api/leave-requests, also driving admin-shell's sidebar badge) rather
  // than this page running its own second interval against the same endpoint.
  requests = this.realtimeService.leaveRequests;
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);
  statusFilterControl = new FormControl<StatusFilter>('pending', { nonNullable: true });
  private statusFilter = toSignal(this.statusFilterControl.valueChanges, {
    initialValue: this.statusFilterControl.value,
  });
  // computed(), not a plain array — the "Chờ duyệt" label embeds the live
  // pendingCount and must re-render as it changes.
  statusOptions = computed<HudSelectOption<StatusFilter>[]>(() => {
    this.translate.currentLang(); // recompute labels when the language changes
    return [
      {
        value: 'pending',
        label: this.translate.instant('leaveRequests.statusPendingWithCount', {
          count: this.pendingCount(),
        }),
      },
      { value: 'approved', label: this.translate.instant('leaveRequests.statusApproved') },
      { value: 'rejected', label: this.translate.instant('leaveRequests.statusRejected') },
      { value: 'all', label: this.translate.instant('leaveRequests.statusAll') },
    ];
  });
  // Free-text search is exempt from the explicit-Apply rule (rule 10) — it
  // live-filters, so its value is bridged into a signal for filteredRequests.
  searchQuery = new FormControl('', { nonNullable: true });
  private searchQueryValue = toSignal(this.searchQuery.valueChanges, {
    initialValue: this.searchQuery.value,
  });

  // Date filters
  filterStartDateInput = new FormControl('', { nonNullable: true });
  filterEndDateInput = new FormControl('', { nonNullable: true });
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');

  currentPage = signal<number>(1);
  pageSizeControl = new FormControl(10, { nonNullable: true });
  private pageSize = toSignal(this.pageSizeControl.valueChanges, {
    initialValue: this.pageSizeControl.value,
  });

  pendingCount = this.realtimeService.pendingLeaveCount;

  constructor() {
    this.statusFilterControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.currentPage.set(1));
    this.searchQuery.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.currentPage.set(1));
    this.pageSizeControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.currentPage.set(1));
  }

  filteredRequests = computed(() => {
    const filter = this.statusFilter();
    const q = this.searchQueryValue().toLowerCase().trim();
    const start = this.filterStartDate();
    const end = this.filterEndDate();
    let list = this.requests();

    if (filter !== 'all') {
      list = list.filter((r) => r.status === filter);
    }
    if (q) {
      list = list.filter(
        (r) =>
          r.employee_name.toLowerCase().includes(q) ||
          (r.current_position || '').toLowerCase().includes(q),
      );
    }
    if (start) {
      list = list.filter((r) => r.end_date >= start);
    }
    if (end) {
      list = list.filter((r) => r.start_date <= end);
    }
    return list;
  });

  totalPages = computed(() => Math.ceil(this.filteredRequests().length / this.pageSize()) || 1);

  paginatedRequests = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSize();
    return this.filteredRequests().slice(start, start + this.pageSize());
  });

  private readonly apiUrl = environment.apiBaseUrl;

  ngOnInit(): void {
    this.loadRequests();
  }

  loadRequests(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<ApiResponse<LeaveRequest[]>>(`${this.apiUrl}/leave-requests`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.realtimeService.leaveRequests.set(res.data);
        } else {
          this.errorMsg.set(res.error || this.translate.instant('leaveRequests.loadListError'));
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set(this.translate.instant('leaveRequests.connectionError'));
      },
    });
  }

  applyDateFilter(): void {
    this.filterStartDate.set(this.filterStartDateInput.value);
    this.filterEndDate.set(this.filterEndDateInput.value);
    this.currentPage.set(1);
  }

  clearDateFilter(): void {
    this.filterStartDateInput.setValue('');
    this.filterEndDateInput.setValue('');
    this.filterStartDate.set('');
    this.filterEndDate.set('');
    this.currentPage.set(1);
  }

  async approve(req: LeaveRequest): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      this.translate.instant('leaveRequests.approveDialogTitle'),
      this.translate.instant('leaveRequests.approveDialogMessage', {
        name: req.employee_name,
        start: req.start_date,
        end: req.end_date,
      }),
      this.translate.instant('leaveRequests.approveConfirmButton'),
    );
    if (confirmed) {
      this.updateStatus(req, 'approved');
    }
  }

  async reject(req: LeaveRequest): Promise<void> {
    const reason = await this.dialogService.prompt(
      this.translate.instant('leaveRequests.rejectDialogTitle'),
      this.translate.instant('leaveRequests.rejectDialogMessage', { name: req.employee_name }),
      this.translate.instant('leaveRequests.rejectDialogPlaceholder'),
    );
    if (reason !== null) {
      this.updateStatus(req, 'rejected', reason.trim());
    }
  }

  private updateStatus(
    req: LeaveRequest,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
  ): void {
    this.http
      .put<ApiResponse>(`${this.apiUrl}/leave-requests/${req.id}`, {
        status,
        rejection_reason: rejectionReason,
      })
      .subscribe({
        next: async (res) => {
          if (res.success) {
            this.loadRequests();
          } else {
            await this.dialogService.alert(
              this.translate.instant('common.error'),
              res.error || this.translate.instant('leaveRequests.updateError'),
            );
          }
        },
        error: async (err: HttpErrorResponse) => {
          await this.dialogService.alert(
            this.translate.instant('common.error'),
            err.error?.error || this.translate.instant('leaveRequests.genericServerError'),
          );
        },
      });
  }

  leaveStatusLabel(status: string): string {
    switch (status) {
      case 'approved':
        return this.translate.instant('leaveRequests.statusApproved');
      case 'rejected':
        return this.translate.instant('leaveRequests.statusRejected');
      default:
        return this.translate.instant('leaveRequests.statusPending');
    }
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
}
