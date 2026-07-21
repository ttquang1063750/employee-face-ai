import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export interface HourlyPoint {
  x: number;
  y: number;
  hour: string;
  count: number;
}

@Component({
  selector: 'app-hourly-chart',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './hourly-chart.html',
  styleUrl: './hourly-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HourlyChartComponent {
  points = input.required<HourlyPoint[]>();
  hasData = input.required<boolean>();
  loading = input<boolean>(false);
}
