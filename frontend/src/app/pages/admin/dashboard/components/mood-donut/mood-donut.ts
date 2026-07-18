import { Component, ChangeDetectionStrategy, input } from '@angular/core';

export interface MoodDonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  offset: number;
}

@Component({
  selector: 'app-mood-donut',
  standalone: true,
  imports: [],
  templateUrl: './mood-donut.html',
  styleUrl: './mood-donut.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoodDonutComponent {
  segments = input.required<MoodDonutSegment[]>();
  hasData = input.required<boolean>();
  loading = input<boolean>(false);
}
