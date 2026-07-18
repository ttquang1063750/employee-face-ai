import { Component, ChangeDetectionStrategy, input } from '@angular/core';

export interface HourlyPoint {
  x: number;
  y: number;
  hour: string;
  count: number;
}

@Component({
  selector: 'app-hourly-chart',
  standalone: true,
  imports: [],
  templateUrl: './hourly-chart.html',
  styleUrl: './hourly-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HourlyChartComponent {
  points = input.required<HourlyPoint[]>();
  hasData = input.required<boolean>();
  loading = input<boolean>(false);
}
