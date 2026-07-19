import { Injectable, Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { AbstractControl, AsyncValidatorFn } from '@angular/forms';
import { Observable, map, merge, of, switchMap, timer } from 'rxjs';

export type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

export interface UsernameCheckResponse {
  success: boolean;
  exists: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UsernameCheckService {
  private http = inject(HttpClient);

  private readonly apiUrl = 'http://localhost:8000/api';

  check(username: string, excludeId?: number): Observable<UsernameCheckResponse> {
    const params: Record<string, string> = { username };
    if (excludeId) {
      params['exclude_id'] = String(excludeId);
    }
    return this.http.get<UsernameCheckResponse>(`${this.apiUrl}/employees/check-username`, {
      params,
    });
  }

  // Angular cancels the previous async-validator subscription every time the
  // control revalidates, so a fresh timer() per call reproduces a 450ms
  // debounce without a shared Subject.
  usernameTakenValidator(excludeId?: number): AsyncValidatorFn {
    return (control: AbstractControl) => {
      const username = ((control.value as string) ?? '').trim();
      if (!username) return of(null);

      return timer(450).pipe(
        switchMap(() => this.check(username, excludeId)),
        map((res) => (res.exists ? { usernameTaken: true } : null)),
      );
    };
  }
}

// Derives the 'idle'|'checking'|'available'|'taken' UI status from a control
// carrying `usernameTakenValidator()` — shared by employee-list's create form
// and base-profile-modal's edit form so neither hand-rolls its own status
// tracking on top of the async validator.
export function usernameStatusSignal(usernameControl: AbstractControl): Signal<UsernameStatus> {
  // Tracks both value AND status changes as one trigger — a computed() only
  // reruns when a signal dependency it actually read last time changes, so
  // a branch that returns before touching this signal (e.g. an early
  // "empty value" return) would otherwise permanently freeze the memo the
  // first time it runs on an empty control.
  const changes = toSignal(merge(usernameControl.valueChanges, usernameControl.statusChanges), {
    initialValue: null,
  });

  return computed<UsernameStatus>(() => {
    changes();
    const value = ((usernameControl.value as string) ?? '').trim();
    if (!value) return 'idle';
    if (usernameControl.pending) return 'checking';
    if (usernameControl.valid) return 'available';
    if (usernameControl.hasError('usernameTaken')) return 'taken';
    return 'idle';
  });
}
