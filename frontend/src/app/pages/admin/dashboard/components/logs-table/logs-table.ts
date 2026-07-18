import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { translateMood } from '../../../../../core/utils/mood.util';
import { AttendanceLogEntry } from '../../../../../core/models/attendance-log.model';
import { AuditPhotoButtonComponent } from '../../../../../core/components/audit-photo-button/audit-photo-button';

@Component({
  selector: 'app-logs-table',
  standalone: true,
  imports: [FormsModule, AuditPhotoButtonComponent],
  templateUrl: './logs-table.html',
  styleUrl: './logs-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsTableComponent {
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

  readonly translateMood = translateMood;
  readonly skeletonRows = [1, 2, 3, 4, 5];
}
