import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { VI } from './vi';
import { EN } from './en';

// Translations are bundled TS objects (VI/EN), not JSON fetched over HTTP —
// the whole app is small enough that this avoids both an extra HTTP
// round-trip per language switch and an extra @ngx-translate/http-loader
// dependency. `getTranslation` is still async (an Observable) only because
// TranslateLoader's contract requires it, not because loading is ever slow.
const DICTIONARIES: Record<string, TranslationObject> = { vi: VI, en: EN };

@Injectable()
export class StaticTranslateLoader extends TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    return of(DICTIONARIES[lang] ?? VI);
  }
}
