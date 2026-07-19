import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { staffGuard } from './core/guards/staff.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'kiosk',
    pathMatch: 'full',
  },
  {
    path: 'kiosk',
    title: 'Kiosk Chấm Công - Employee Face AI',
    loadComponent: () => import('./pages/kiosk/kiosk').then((m) => m.KioskComponent),
  },
  {
    path: 'login',
    title: 'Xác Thực Hệ Thống - Employee Face AI',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/components/admin-shell/admin-shell').then((m) => m.AdminShellComponent),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        title: 'Bảng Thống Kê - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/dashboard/dashboard').then((m) => m.DashboardComponent),
      },
      {
        path: 'employees',
        title: 'Quản Lý Nhân Viên - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/employees/employee-list').then((m) => m.EmployeeListComponent),
      },
      {
        path: 'employees/:id',
        title: 'Hồ Sơ Nhân Viên - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/employee-detail/employee-detail').then(
            (m) => m.EmployeeDetailComponent,
          ),
      },
      {
        path: 'leave-requests',
        title: 'Duyệt Đơn Xin Nghỉ - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/leave-requests/leave-requests').then(
            (m) => m.LeaveRequestsComponent,
          ),
      },
      {
        path: 'documents',
        title: 'Quản Lý Tài Liệu - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/documents/documents').then((m) => m.DocumentsComponent),
      },
    ],
  },
  {
    path: 'staff',
    title: 'Cổng Thông Tin Nhân Sự - Employee Face AI',
    canActivate: [staffGuard],
    loadComponent: () =>
      import('./pages/staff/staff-profile/staff-profile').then((m) => m.StaffProfileComponent),
  },
  {
    path: 'not-found',
    title: 'Trang Không Tìm Thấy - Employee Face AI',
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundComponent),
  },
  {
    path: '**',
    redirectTo: 'not-found',
  },
];
