import { HudSelectOption } from '../components/hud-select/hud-select';
import { MessageCategory } from '../models/message.model';

const LABELS: Record<'vi' | 'en', Record<MessageCategory, string>> = {
  vi: {
    daily_report: 'Báo cáo ngày',
    weekly_report: 'Báo cáo tuần',
    monthly_report: 'Báo cáo tháng',
    other: 'Khác',
  },
  en: {
    daily_report: 'Daily report',
    weekly_report: 'Weekly report',
    monthly_report: 'Monthly report',
    other: 'Other',
  },
};

/** Localized label for a MessageCategory, for table cells and detail views. */
export function translateMessageCategory(category: MessageCategory, lang: 'vi' | 'en' = 'vi'): string {
  return LABELS[lang][category] ?? LABELS[lang].other;
}

/** Options for the category <app-hud-select> in compose/template forms. */
export function messageCategoryOptions(lang: 'vi' | 'en' = 'vi'): HudSelectOption<MessageCategory>[] {
  return (Object.keys(LABELS[lang]) as MessageCategory[]).map((value) => ({
    value,
    label: LABELS[lang][value],
  }));
}
