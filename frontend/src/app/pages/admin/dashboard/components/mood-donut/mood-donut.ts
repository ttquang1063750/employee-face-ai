import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
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
  private translate = inject(TranslateService);

  // Generic donut chart, not mood-specific despite the component name (kept
  // for history) — reused for the attendance-summary check-in/out ratio
  // chart too, hence the configurable title/emptyMessage.
  title = input<string | undefined>(undefined);
  emptyMessage = input<string | undefined>(undefined);
  displayTitle = computed(() => {
    this.translate.currentLang(); // recompute when the language changes
    return this.title() ?? this.translate.instant('mood.donutTitleOverview');
  });
  displayEmptyMessage = computed(() => {
    this.translate.currentLang(); // recompute when the language changes
    return this.emptyMessage() ?? this.translate.instant('mood.donutEmpty');
  });
  segments = input.required<DonutSegment[]>();
  hasData = input.required<boolean>();
  loading = input<boolean>(false);
}
