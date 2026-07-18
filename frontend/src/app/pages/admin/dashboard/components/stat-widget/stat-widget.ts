import { Component, ChangeDetectionStrategy, input } from '@angular/core';

export type StatWidgetKind = 'info' | 'success' | 'warning' | 'danger' | 'none';

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
}
