import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

export type StatWidgetKind = 'info' | 'success' | 'warning' | 'danger' | 'none';

export interface StatWidgetFilterOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-stat-widget',
  standalone: true,
  imports: [],
  templateUrl: './stat-widget.html',
  styleUrl: './stat-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatWidgetComponent {
  icon = input.required<string>();
  label = input.required<string>();
  value = input.required<string | number>();
  footer = input.required<string>();
  statusLabel = input<string>('info');
  kind = input<StatWidgetKind>('info');
  loading = input<boolean>(false);

  // Optional replacement for the statusLabel badge: a small select the
  // widget's own consumer can use to scope its `value` (e.g. attendance
  // count by CHECK_IN/CHECK_OUT). Absent for widgets that don't need one.
  filterOptions = input<StatWidgetFilterOption[]>([]);
  filterValue = input<string>('');
  filterChange = output<string>();

  onFilterChange(event: Event): void {
    this.filterChange.emit((event.target as HTMLSelectElement).value);
  }
}
