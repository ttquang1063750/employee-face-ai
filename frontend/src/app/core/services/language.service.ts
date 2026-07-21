import { Injectable, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export type AppLanguage = 'vi' | 'en';
const STORAGE_KEY = 'app_language';
const DEFAULT_LANGUAGE: AppLanguage = 'vi';

export interface LanguageOption {
  code: AppLanguage;
  label: string;
}

// Wraps TranslateService with the one thing it doesn't do itself: picking
// the initial language (localStorage, falling back to the app's original
// Vietnamese default — never the browser's locale, since this is an
// internal HR tool rolled out by IT, not a public site) and persisting a
// user's choice across sessions.
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);

  readonly options: LanguageOption[] = [
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'en', label: 'English' },
  ];

  readonly currentLang = computed<AppLanguage>(
    () => (this.translate.currentLang() as AppLanguage | null) ?? DEFAULT_LANGUAGE,
  );

  constructor() {
    this.translate.addLangs(['vi', 'en']);
    const stored = localStorage.getItem(STORAGE_KEY) as AppLanguage | null;
    this.translate.use(stored === 'en' ? 'en' : DEFAULT_LANGUAGE);
  }

  setLanguage(lang: AppLanguage): void {
    localStorage.setItem(STORAGE_KEY, lang);
    this.translate.use(lang);
  }
}
