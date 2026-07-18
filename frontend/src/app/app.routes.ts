import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'kiosk',
    pathMatch: 'full'
  },
  {
    path: 'kiosk',
    loadComponent: () => import('./pages/kiosk/kiosk').then(m => m.KioskComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then(m => m.LoginComponent)
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/admin/dashboard/dashboard').then(m => m.DashboardComponent)
      },
      {
        path: 'employees',
        loadComponent: () => import('./pages/admin/employees/employee-list').then(m => m.EmployeeListComponent)
      },
      {
        path: 'employees/:id',
        loadComponent: () => import('./pages/admin/employee-detail/employee-detail').then(m => m.EmployeeDetailComponent)
      }
    ]
  },
  {
    path: 'not-found',
    loadComponent: () => import('./pages/not-found/not-found').then(m => m.NotFoundComponent)
  },
  {
    path: '**',
    redirectTo: 'not-found'
  }
];
