import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatePickerComponent } from '../../../../../core/components/date-picker/date-picker';
import { AttendanceLog } from '../../../../../core/models/employee.model';

@Component({
  selector: 'app-attendance-summary',
  standalone: true,
  imports: [FormsModule, DatePickerComponent, DatePipe],
  templateUrl: './attendance-summary.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttendanceSummaryComponent {
  paginatedLogs = input.required<AttendanceLog[]>();
  totalCount = input.required<number>();
  workingDays = input.required<number>();
  workingHours = input.required<number>();
  hasIncompleteAttendance = input.required<boolean>();
  currentPage = input.required<number>();
  totalPages = input.required<number>();
  filterStartDateInput = input.required<string>();
  filterEndDateInput = input.required<string>();

  filterStartDateInputChange = output<string>();
  filterEndDateInputChange = output<string>();
  applyFilter = output<void>();
  prevPage = output<void>();
  nextPage = output<void>();
}
