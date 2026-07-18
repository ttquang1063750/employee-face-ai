import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, filter, take } from 'rxjs/operators';
import { Router } from '@angular/router';

let isRefreshing = false;
const refreshTokenSubject = new BehaviorSubject<string | null>(null);

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const isPublicUrl = 
    req.url.includes('/api/login') || 
    req.url.includes('/api/refresh') || 
    (req.url.includes('/api/attendance') && req.method === 'POST');

  let authReq = req;
  const token = authService.getAccessToken();
  
  if (token && !isPublicUrl) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(authReq).pipe(
    catchError((error) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isPublicUrl) {
        return handle401Error(authReq, next, authService, router);
      }
      return throwError(() => error);
    })
  );
};

function handle401Error(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authService: AuthService,
  router: Router
): Observable<HttpEvent<unknown>> {
  if (!isRefreshing) {
    isRefreshing = true;
    refreshTokenSubject.next(null);

    return authService.refreshTokenCall().pipe(
      switchMap((res) => {
        isRefreshing = false;
        const newToken = res.tokens.access_token;
        refreshTokenSubject.next(newToken);
        
        return next(req.clone({
          setHeaders: {
            Authorization: `Bearer ${newToken}`
          }
        }));
      }),
      catchError((err) => {
        isRefreshing = false;
        authService.clearSession();
        router.navigate(['/login']);
        return throwError(() => err);
      })
    );
  } else {
    return refreshTokenSubject.pipe(
      filter(token => token !== null),
      take(1),
      switchMap((token) => {
        return next(req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`
          }
        }));
      })
    );
  }
}
