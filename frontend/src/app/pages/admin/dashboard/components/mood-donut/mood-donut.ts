import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DonutSegment } from '../../../../../core/utils/donut-chart.util';

// Re-exported under its historical name so existing imports keep working —
// it's the same shape as the shared DonutSegment now that the offset-stacking
// logic moved to donut-chart.util.ts.
export type MoodDonutSegment = DonutSegment;

@Component({
  selector: 'app-mood-donut',
  standalone: true,
  imports: [],
  templateUrl: './mood-donut.html',
  styleUrl: './mood-donut.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoodDonutComponent {
  // Generic donut chart, not mood-specific despite the component name (kept
  // for history) — reused for the attendance-summary check-in/out ratio
  // chart too, hence the configurable title/emptyMessage.
  title = input<string>('🧠 ĐÁNH GIÁ CHỈ SỐ CẢM XÚC');
  emptyMessage = input<string>('Chưa có dữ liệu chấm công trong khoảng thời gian này');
  segments = input.required<DonutSegment[]>();
  hasData = input.required<boolean>();
  loading = input<boolean>(false);
}
