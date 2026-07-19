import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiBaseUrl;

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: AuthService;
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('attaches the Authorization header to a protected request when a token exists', () => {
    authService.saveTokens('access-1', 'refresh-1');

    http.get(`${API}/employees`).subscribe();

    const req = httpMock.expectOne(`${API}/employees`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    req.flush({ success: true, data: [] });
  });

  it('does not attach a header for /api/login even when a token exists', () => {
    authService.saveTokens('access-1', 'refresh-1');

    http.post(`${API}/login`, { username: 'admin', password: 'x' }).subscribe();

    const req = httpMock.expectOne(`${API}/login`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ success: true });
  });

  it('does not attach a header for a POST /api/attendance check-in', () => {
    authService.saveTokens('access-1', 'refresh-1');

    http.post(`${API}/attendance`, { img: 'x', action: 'CHECK_IN' }).subscribe();

    const req = httpMock.expectOne(`${API}/attendance`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ success: true });
  });

  it('refreshes the token on a 401 and retries the original request with the new token', () => {
    authService.saveTokens('expired-token', 'refresh-1');

    let result: unknown;
    http.get(`${API}/employees`).subscribe((res) => (result = res));

    const firstReq = httpMock.expectOne(`${API}/employees`);
    expect(firstReq.request.headers.get('Authorization')).toBe('Bearer expired-token');
    firstReq.flush({ success: false }, { status: 401, statusText: 'Unauthorized' });

    const refreshReq = httpMock.expectOne(`${API}/refresh`);
    expect(refreshReq.request.headers.has('Authorization')).toBe(false);
    refreshReq.flush({
      success: true,
      tokens: {
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        access_expires_at: '',
        refresh_expires_at: '',
      },
      user: { id: 1, name: 'Admin', role: 'admin' },
    });

    const retriedReq = httpMock.expectOne(`${API}/employees`);
    expect(retriedReq.request.headers.get('Authorization')).toBe('Bearer new-token');
    retriedReq.flush({ success: true, data: [] });

    expect(result).toEqual({ success: true, data: [] });
    expect(authService.getAccessToken()).toBe('new-token');
  });

  it('clears the session and redirects to /login when the refresh call itself fails', () => {
    authService.saveTokens('expired-token', 'bad-refresh');

    let errored = false;
    http.get(`${API}/employees`).subscribe({ error: () => (errored = true) });

    httpMock.expectOne(`${API}/employees`).flush({ success: false }, { status: 401, statusText: 'Unauthorized' });
    httpMock
      .expectOne(`${API}/refresh`)
      .flush({ success: false }, { status: 401, statusText: 'Unauthorized' });

    expect(errored).toBe(true);
    expect(authService.getAccessToken()).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('queues a second 401 behind an in-flight refresh instead of calling refresh twice', () => {
    authService.saveTokens('expired-token', 'refresh-1');

    let resultA: unknown;
    let resultB: unknown;
    http.get(`${API}/employees`).subscribe((res) => (resultA = res));
    http.get(`${API}/logs`).subscribe((res) => (resultB = res));

    httpMock.expectOne(`${API}/employees`).flush({ success: false }, { status: 401, statusText: 'Unauthorized' });
    httpMock.expectOne(`${API}/logs`).flush({ success: false }, { status: 401, statusText: 'Unauthorized' });

    // Only one refresh call should have been made despite two concurrent 401s.
    const refreshReq = httpMock.expectOne(`${API}/refresh`);
    refreshReq.flush({
      success: true,
      tokens: {
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        access_expires_at: '',
        refresh_expires_at: '',
      },
      user: { id: 1, name: 'Admin', role: 'admin' },
    });

    httpMock.expectOne(`${API}/employees`).flush({ success: true, data: ['a'] });
    httpMock.expectOne(`${API}/logs`).flush({ success: true, data: ['b'] });

    expect(resultA).toEqual({ success: true, data: ['a'] });
    expect(resultB).toEqual({ success: true, data: ['b'] });
  });
});
