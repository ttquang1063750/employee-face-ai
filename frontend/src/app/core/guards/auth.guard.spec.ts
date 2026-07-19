import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  provideRouter,
  Router,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { authGuard } from './auth.guard';

function runGuard(url: string) {
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

describe('authGuard', () => {
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const router = TestBed.inject(Router);
    navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('allows an authenticated admin through', () => {
    localStorage.setItem('access_token', 'tok');
    localStorage.setItem('user_session', JSON.stringify({ id: 1, name: 'Admin', role: 'admin' }));

    expect(runGuard('/admin/dashboard')).toBe(true);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('rejects an authenticated staff user and redirects to login', () => {
    localStorage.setItem('access_token', 'tok');
    localStorage.setItem('user_session', JSON.stringify({ id: 2, name: 'Staff', role: 'staff' }));

    expect(runGuard('/admin/dashboard')).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/admin/dashboard' },
    });
  });

  it('rejects when there is no access token at all', () => {
    expect(runGuard('/admin/dashboard')).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/admin/dashboard' },
    });
  });

  it('clears the session on rejection', () => {
    localStorage.setItem('access_token', 'tok');
    localStorage.setItem('user_session', JSON.stringify({ id: 2, name: 'Staff', role: 'staff' }));

    runGuard('/admin/dashboard');

    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('user_session')).toBeNull();
  });
});
