import { Component, ChangeDetectionStrategy, signal, input, output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DatePickerComponent } from '../../../../../core/components/date-picker/date-picker';
import { DialogService } from '../../../../../core/services/dialog.service';
import { ApiResponse } from '../../../../../core/models/api-response.model';
import { Position } from '../../../../../core/models/employee.model';
import { todayLocalDateString } from '../../../../../core/utils/date.util';

@Component({
  selector: 'app-positions-timeline',
  standalone: true,
  imports: [FormsModule, DatePickerComponent],
  templateUrl: './positions-timeline.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositionsTimelineComponent {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private readonly apiUrl = 'http://localhost:8000/api';

  positions = input.required<Position[]>();
  employeeId = input.required<number>();

  // Emitted after a successful add/delete so the parent can reload the
  // employee record (positions affect current_position too).
  changed = output<void>();

  showModal = signal<boolean>(false);
  newTitle = signal<string>('');
  newStartDate = signal<string>('');
  isSaving = signal<boolean>(false);

  openModal(): void {
    this.newTitle.set('');
    this.newStartDate.set(todayLocalDateString());
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  save(): void {
    if (!this.newTitle().trim()) return;
    this.isSaving.set(true);

    const payload = {
      title: this.newTitle().trim(),
      start_date: this.newStartDate(),
    };

    this.http
      .post<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId()}/positions`, payload)
      .subscribe({
        next: async (res) => {
          this.isSaving.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Bổ nhiệm chức vụ mới thành công.');
            this.closeModal();
            this.changed.emit();
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSaving.set(false);
          await this.dialogService.alert(
            'LỖI BỔ NHIỆM',
            'Lỗi ghi nhận bổ nhiệm: ' + (err.error?.error || err.message),
          );
        },
      });
  }

  async deletePosition(id: number): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA CHỨC VỤ',
      'Bạn có chắc chắn muốn xóa chức vụ này khỏi lịch sử công tác?',
    );
    if (!confirmed) return;

    this.http.delete<ApiResponse>(`${this.apiUrl}/positions/${id}`).subscribe({
      next: async (res) => {
        if (res.success) {
          await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa chức vụ thành công.');
          this.changed.emit();
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert(
          'LỖI XÓA CHỨC VỤ',
          'Lỗi khi xóa: ' + (err.error?.error || err.message),
        );
      },
    });
  }
}
