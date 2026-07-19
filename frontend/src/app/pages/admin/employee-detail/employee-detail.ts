import { Component, OnInit, signal, computed, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiResponse } from '../../../core/models/api-response.model';
import { DetailedEmployee } from '../../../core/models/employee.model';
import { avatarUrl, onImageError } from '../../../core/utils/image.util';
import { environment } from '../../../../environments/environment';
import { EmployeeService } from '../../../core/services/employee.service';
import { AttendanceSummaryStateService } from '../../../core/services/attendance-summary-state.service';
import { AttendanceSummaryComponent } from './components/attendance-summary/attendance-summary';
import { PositionsTimelineComponent } from './components/positions-timeline/positions-timeline';
import { IncomeHistoryComponent } from './components/income-history/income-history';
import { SkillsPanelComponent } from './components/skills-panel/skills-panel';
import { ProjectsPanelComponent } from './components/projects-panel/projects-panel';
import { BaseProfileModalComponent } from './components/base-profile-modal/base-profile-modal';
import { DialogService } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    RouterLink,
    AttendanceSummaryComponent,
    PositionsTimelineComponent,
    IncomeHistoryComponent,
    SkillsPanelComponent,
    ProjectsPanelComponent,
    BaseProfileModalComponent,
  ],
  templateUrl: './employee-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AttendanceSummaryStateService],
})
export class EmployeeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private employeeService = inject(EmployeeService);

  employee = signal<DetailedEmployee | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  showBaseModal = signal<boolean>(false);

  protected readonly onImageError = onImageError;
  protected readonly avatarUrl = avatarUrl;

  readonly attendance = inject(AttendanceSummaryStateService);
  private readonly rawLogs = computed(() => this.employee()?.raw_logs || []);

  private employeeId: number | null = null;
  private readonly apiUrl = environment.apiBaseUrl;

  constructor() {
    this.attendance.configure(this.rawLogs);
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.employeeId = parseInt(idParam);
      this.loadEmployeeDetails();
    }
  }

  // `silent`: used when refreshing after a save/delete inside a child panel —
  // the page content is already on screen and correct except for the
  // just-saved change, so it skips the full-page loading skeleton (which
  // would blank out the whole profile for a moment), leaves the
  // admin-chosen attendance filter range alone instead of resetting it back
  // to the default, and swallows a refresh failure instead of replacing the
  // page with an error state, since the save/delete itself already reported
  // its own result to the user.
  loadEmployeeDetails(silent = false): void {
    if (!this.employeeId) return;

    if (!silent) {
      this.isLoading.set(true);
      this.errorMsg.set(null);
    }

    this.employeeService.getById(this.employeeId).subscribe({
      next: (res) => {
        if (!silent) {
          this.isLoading.set(false);
        }
        if (res.success && res.data) {
          this.employee.set(res.data);
          if (!silent) {
            this.attendance.initializeDateRangeDefaults();
          }
        } else if (!silent) {
          this.errorMsg.set(res.error || 'Không thể lấy thông tin chi tiết nhân sự.');
        }
      },
      error: () => {
        if (!silent) {
          this.isLoading.set(false);
          this.errorMsg.set('Lỗi kết nối máy chủ API.');
        }
      },
    });
  }

  openBaseModal(): void {
    this.showBaseModal.set(true);
  }

  onBaseProfileSaved(): void {
    this.showBaseModal.set(false);
    this.loadEmployeeDetails(true);
  }

  onBaseProfileClosed(): void {
    this.showBaseModal.set(false);
  }

  onDeleteLog(id: number): void {
    this.dialogService.confirm('XÁC NHẬN XÓA', 'Bạn có chắc chắn muốn xóa lượt chấm công này? Thao tác này không thể hoàn tác.').then((confirmed) => {
      if (confirmed) {
        this.http.delete<ApiResponse>(`${this.apiUrl}/logs/${id}`).subscribe({
          next: (res) => {
            if (res.success) {
              this.loadEmployeeDetails(true);
            } else {
              this.dialogService.alert('LỖI', res.error || 'Không thể xóa lượt chấm công.');
            }
          },
          error: () => {
            this.dialogService.alert('LỖI', 'Lỗi kết nối máy chủ.');
          }
        });
      }
    });
  }
}
