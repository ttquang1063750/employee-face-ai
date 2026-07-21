import { Component, ChangeDetectionStrategy, signal, input, output, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DatePickerComponent } from '../../../../../core/components/date-picker/date-picker';
import { DialogService } from '../../../../../core/services/dialog.service';
import { EmployeeService } from '../../../../../core/services/employee.service';
import { ApiResponse } from '../../../../../core/models/api-response.model';
import { IncomeEntry } from '../../../../../core/models/employee.model';
import { todayLocalDateString } from '../../../../../core/utils/date.util';
import { environment } from '../../../../../../environments/environment';

@Component({
  selector: 'app-income-history',
  standalone: true,
  imports: [ReactiveFormsModule, DatePickerComponent, TranslatePipe],
  templateUrl: './income-history.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncomeHistoryComponent {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private translate = inject(TranslateService);
  private readonly apiUrl = environment.apiBaseUrl;

  incomeHistory = input.required<IncomeEntry[]>();
  employeeId = input.required<number>();

  changed = output<void>();

  showModal = signal<boolean>(false);
  newIncomeForm = this.fb.nonNullable.group({
    amount: [0],
    effectiveDate: [''],
    reason: [''],
  });
  isSaving = signal<boolean>(false);

  openModal(): void {
    this.newIncomeForm.reset({
      amount: 0,
      effectiveDate: todayLocalDateString(),
      reason: '',
    });
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  save(): void {
    const { amount, effectiveDate, reason } = this.newIncomeForm.getRawValue();
    if (amount <= 0) return;
    this.isSaving.set(true);

    const payload = {
      amount,
      effective_date: effectiveDate,
      change_reason: reason.trim() || 'HR Compensation Adjustment',
    };

    this.employeeService.addIncome(this.employeeId(), payload).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert(
            this.translate.instant('incomeHistory.successTitle'),
            this.translate.instant('incomeHistory.successMessage'),
          );
          this.closeModal();
          this.changed.emit();
        }
      },
      error: async (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        await this.dialogService.alert(
          this.translate.instant('incomeHistory.errorTitle'),
          this.translate.instant('incomeHistory.errorPrefix') + (err.error?.error || err.message),
        );
      },
    });
  }

  async deleteIncome(id: number): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      this.translate.instant('incomeHistory.deleteConfirmTitle'),
      this.translate.instant('incomeHistory.deleteConfirmMessage'),
    );
    if (!confirmed) return;

    this.http.delete<ApiResponse>(`${this.apiUrl}/income/${id}`).subscribe({
      next: async (res) => {
        if (res.success) {
          await this.dialogService.alert(
            this.translate.instant('incomeHistory.deleteSuccessTitle'),
            this.translate.instant('incomeHistory.deleteSuccessMessage'),
          );
          this.changed.emit();
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert(
          this.translate.instant('incomeHistory.deleteErrorTitle'),
          this.translate.instant('incomeHistory.deleteErrorPrefix') + (err.error?.error || err.message),
        );
      },
    });
  }
}
