import { Component, ChangeDetectionStrategy, signal, input, output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DatePickerComponent } from '../../../../../core/components/date-picker/date-picker';
import { DialogService } from '../../../../../core/services/dialog.service';
import { ApiResponse } from '../../../../../core/models/api-response.model';
import { IncomeEntry } from '../../../../../core/models/employee.model';
import { todayLocalDateString } from '../../../../../core/utils/date.util';

@Component({
  selector: 'app-income-history',
  standalone: true,
  imports: [FormsModule, DatePickerComponent],
  templateUrl: './income-history.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncomeHistoryComponent {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private readonly apiUrl = 'http://localhost:8000/api';

  incomeHistory = input.required<IncomeEntry[]>();
  employeeId = input.required<number>();

  changed = output<void>();

  showModal = signal<boolean>(false);
  newAmount = signal<number>(0);
  newEffectiveDate = signal<string>('');
  newReason = signal<string>('');
  isSaving = signal<boolean>(false);

  openModal(): void {
    this.newAmount.set(0);
    this.newReason.set('');
    this.newEffectiveDate.set(todayLocalDateString());
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  save(): void {
    if (this.newAmount() <= 0) return;
    this.isSaving.set(true);

    const payload = {
      amount: this.newAmount(),
      effective_date: this.newEffectiveDate(),
      change_reason: this.newReason().trim() || 'HR Compensation Adjustment',
    };

    this.http.post<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId()}/income`, payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật điều chỉnh mức lương thành công.');
          this.closeModal();
          this.changed.emit();
        }
      },
      error: async (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        await this.dialogService.alert(
          'LỖI ĐIỀU CHỈNH',
          'Lỗi cập nhật lương: ' + (err.error?.error || err.message),
        );
      },
    });
  }

  async deleteIncome(id: number): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA MỨC LƯƠNG',
      'Bạn có chắc chắn muốn xóa lịch sử điều chỉnh lương này?',
    );
    if (!confirmed) return;

    this.http.delete<ApiResponse>(`${this.apiUrl}/income/${id}`).subscribe({
      next: async (res) => {
        if (res.success) {
          await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa lịch sử thu nhập thành công.');
          this.changed.emit();
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert(
          'LỖI XÓA LƯƠNG',
          'Lỗi khi xóa: ' + (err.error?.error || err.message),
        );
      },
    });
  }
}
