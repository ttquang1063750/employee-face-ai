import { Component, ChangeDetectionStrategy, effect, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { translateMood } from '../../../../../core/utils/mood.util';
import { AttendanceLogEntry } from '../../../../../core/models/attendance-log.model';
import { AuditPhotoButtonComponent } from '../../../../../core/components/audit-photo-button/audit-photo-button';
import { IconComponent } from '../../../../../core/components/icon/icon';

@Component({
  selector: 'app-logs-table',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, AuditPhotoButtonComponent, IconComponent, TranslatePipe],
  templateUrl: './logs-table.html',
  styleUrl: './logs-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsTableComponent {
  private translate = inject(TranslateService);

  logs = input.required<AttendanceLogEntry[]>();
  totalCount = input.required<number>();
  currentPage = input.required<number>();
  totalPages = input.required<number>();
  pageSize = input.required<number>();
  loading = input<boolean>(false);

  prevPage = output<void>();
  nextPage = output<void>();
  pageSizeChange = output<number>();
  exportCsv = output<void>();
  deleteLog = output<number>();

  readonly skeletonRows = [1, 2, 3, 4, 5];

  moodLabel(mood: string): string {
    return translateMood(mood, this.translate.currentLang() === 'en' ? 'en' : 'vi');
  }

  // Bridges the pageSize input()/output() pair to a real FormControl for
  // this component's own <select> — see attendance-summary.ts for the same
  // pattern with the rationale spelled out.
  pageSizeControl = new FormControl(10, { nonNullable: true });

  constructor() {
    effect(() => this.pageSizeControl.setValue(this.pageSize(), { emitEvent: false }));
    this.pageSizeControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.pageSizeChange.emit(value));
  }
}
