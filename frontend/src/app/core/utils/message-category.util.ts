import { HudSelectOption } from '../components/hud-select/hud-select';
import { MessageCategory } from '../models/message.model';

/** Vietnamese label for a MessageCategory, for table cells and detail views. */
export function translateMessageCategory(category: MessageCategory): string {
  switch (category) {
    case 'daily_report':
      return 'Báo cáo ngày';
    case 'weekly_report':
      return 'Báo cáo tuần';
    case 'monthly_report':
      return 'Báo cáo tháng';
    default:
      return 'Khác';
  }
}

/** Options for the category <app-hud-select> in compose/template forms. */
export const MESSAGE_CATEGORY_OPTIONS: HudSelectOption<MessageCategory>[] = [
  { value: 'daily_report', label: 'Báo cáo ngày' },
  { value: 'weekly_report', label: 'Báo cáo tuần' },
  { value: 'monthly_report', label: 'Báo cáo tháng' },
  { value: 'other', label: 'Khác' },
];
