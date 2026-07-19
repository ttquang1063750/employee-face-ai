import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  provideRouter,
  Router,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { staffGuard } from './staff.guard';

function runGuard(url: string) {
  return TestBed.runInInjectionContext(() =>
    staffGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

describe('staffGuard', () => {
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

  it('allows an authenticated staff user through', () => {
    localStorage.setItem('access_token', 'tok');
    localStorage.setItem('user_session', JSON.stringify({ id: 2, name: 'Staff', role: 'staff' }));

    expect(runGuard('/staff')).toBe(true);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('rejects an authenticated admin and redirects to login', () => {
    localStorage.setItem('access_token', 'tok');
    localStorage.setItem('user_session', JSON.stringify({ id: 1, name: 'Admin', role: 'admin' }));

    expect(runGuard('/staff')).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/staff' } });
  });

  it('rejects when there is no access token at all', () => {
    expect(runGuard('/staff')).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/staff' } });
  });

  it('clears the session on rejection', () => {
    localStorage.setItem('access_token', 'tok');
    localStorage.setItem('user_session', JSON.stringify({ id: 1, name: 'Admin', role: 'admin' }));

    runGuard('/staff');

    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('user_session')).toBeNull();
  });
});
