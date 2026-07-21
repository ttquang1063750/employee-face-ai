import { Component, ChangeDetectionStrategy, effect, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DatePickerComponent } from '../../../../../core/components/date-picker/date-picker';
import { AttendanceLog } from '../../../../../core/models/employee.model';
import { AuditPhotoButtonComponent } from '../../../../../core/components/audit-photo-button/audit-photo-button';
import { MoodDonutComponent } from '../../../dashboard/components/mood-donut/mood-donut';
import { DonutSegment } from '../../../../../core/utils/donut-chart.util';
import { translateMood } from '../../../../../core/utils/mood.util';

@Component({
  selector: 'app-attendance-summary',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePickerComponent,
    DatePipe,
    AuditPhotoButtonComponent,
    MoodDonutComponent,
    TranslatePipe,
  ],
  templateUrl: './attendance-summary.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttendanceSummaryComponent {
  private translate = inject(TranslateService);
  paginatedLogs = input.required<AttendanceLog[]>();
  totalCount = input.required<number>();
  workingDays = input.required<number>();
  workingHours = input.required<number>();
  hasIncompleteAttendance = input.required<boolean>();
  currentPage = input.required<number>();
  totalPages = input.required<number>();
  filterStartDateInput = input.required<string>();
  filterEndDateInput = input.required<string>();
  pageSize = input.required<number>();
  showDeleteButton = input<boolean>(true);
  moodSegments = input.required<DonutSegment[]>();
  hasMoodData = input.required<boolean>();

  filterStartDateInputChange = output<string>();
  filterEndDateInputChange = output<string>();
  applyFilter = output<void>();
  prevPage = output<void>();
  nextPage = output<void>();
  deleteLog = output<number>();
  pageSizeChange = output<number>();

  // Bridges the input()/output() contract above to real FormControls for this
  // component's own template — keeps the parent-facing API untouched (still
  // plain string/number in, emitted out) while the two-way binding inside
  // this template goes through Reactive Forms instead of ngModel.
  startDateControl = new FormControl('', { nonNullable: true });
  endDateControl = new FormControl('', { nonNullable: true });
  pageSizeControl = new FormControl(5, { nonNullable: true });

  constructor() {
    effect(() => this.startDateControl.setValue(this.filterStartDateInput(), { emitEvent: false }));
    effect(() => this.endDateControl.setValue(this.filterEndDateInput(), { emitEvent: false }));
    effect(() => this.pageSizeControl.setValue(this.pageSize(), { emitEvent: false }));

    this.startDateControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.filterStartDateInputChange.emit(value));
    this.endDateControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.filterEndDateInputChange.emit(value));
    this.pageSizeControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.pageSizeChange.emit(value));
  }

  moodLabel(mood: string): string {
    return translateMood(mood, this.translate.currentLang() === 'en' ? 'en' : 'vi');
  }

  // Prints the page as-is; the host page and this component mark whatever
  // shouldn't appear on paper (nav sidebar, back button, side panels,
  // filters/pagination/delete buttons here) with .no-print — no PDF library
  // needed, the browser's own print-to-PDF handles that.
  exportPdf(): void {
    window.print();
  }
}
