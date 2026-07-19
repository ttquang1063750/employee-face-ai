import { Injectable, Signal, inject, signal } from '@angular/core';
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
  const deriveStatus = (): UsernameStatus => {
    const value = ((usernameControl.value as string) ?? '').trim();
    if (!value) return 'idle';
    if (usernameControl.pending) return 'checking';
    if (usernameControl.valid) return 'available';
    if (usernameControl.hasError('usernameTaken')) return 'taken';
    return 'idle';
  };

  const status = signal<UsernameStatus>(deriveStatus());
  // A plain subscription rather than toSignal()+computed(): the control's
  // status can flip PENDING -> VALID well after this control is constructed
  // (a real 450ms-debounced HTTP round trip), and this must keep receiving
  // every emission for the lifetime of the control, not just the first one.
  merge(usernameControl.valueChanges, usernameControl.statusChanges).subscribe(() =>
    status.set(deriveStatus()),
  );

  return status.asReadonly();
}
