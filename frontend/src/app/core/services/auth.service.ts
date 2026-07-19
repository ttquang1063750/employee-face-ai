import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface TokenResponse {
  success: boolean;
  tokens: {
    access_token: string;
    refresh_token: string;
    access_expires_at: string;
    refresh_expires_at: string;
  };
  user: UserSession;
}

export interface UserSession {
  id: number;
  name: string;
  role: 'admin' | 'staff';
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);

  private readonly apiUrl = environment.apiBaseUrl;

  // Reactive state signals
  readonly accessToken = signal<string | null>(localStorage.getItem('access_token'));
  readonly refreshToken = signal<string | null>(localStorage.getItem('refresh_token'));
  readonly currentUser = signal<UserSession | null>(this.getDecodedUserFromStorage());

  readonly isAuthenticated = computed(() => this.accessToken() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.role === 'admin');
  readonly isStaff = computed(() => this.currentUser()?.role === 'staff');

  login(username: string, password: string): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(`${this.apiUrl}/login`, { username, password }).pipe(
      tap((res) => {
        if (res.success && res.tokens && res.user) {
          this.saveTokens(res.tokens.access_token, res.tokens.refresh_token);
          this.saveUser(res.user);
        }
      }),
    );
  }

  refreshTokenCall(): Observable<TokenResponse> {
    const rToken = this.getRefreshToken();
    return this.http.post<TokenResponse>(`${this.apiUrl}/refresh`, { refresh_token: rToken }).pipe(
      tap((res) => {
        if (res.success && res.tokens) {
          this.saveTokens(res.tokens.access_token, res.tokens.refresh_token);
        }
      }),
    );
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/logout`, {}).pipe(
      tap({
        finalize: () => this.clearSession(),
      }),
    );
  }

  getAccessToken(): string | null {
    return this.accessToken();
  }

  getRefreshToken(): string | null {
    return this.refreshToken();
  }

  saveTokens(access: string, refresh: string): void {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    this.accessToken.set(access);
    this.refreshToken.set(refresh);
  }

  saveUser(user: UserSession): void {
    localStorage.setItem('user_session', JSON.stringify(user));
    this.currentUser.set(user);
  }

  clearSession(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_session');
    this.accessToken.set(null);
    this.refreshToken.set(null);
    this.currentUser.set(null);
  }

  private getDecodedUserFromStorage(): UserSession | null {
    const raw = localStorage.getItem('user_session');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserSession;
    } catch {
      return null;
    }
  }
}
