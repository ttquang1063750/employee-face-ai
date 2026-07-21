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
      {
        path: 'documents/new',
        title: 'Tải Lên Tài Liệu - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/documents/upload-document-page/upload-document-page').then(
            (m) => m.UploadDocumentPage,
          ),
      },
      {
        path: 'messages',
        title: 'Tin Nhắn - HR Control Panel',
        loadComponent: () =>
          import('./pages/messages/messages-page/messages-page').then((m) => m.MessagesPage),
      },
      {
        path: 'messages/new',
        title: 'Soạn Tin Nhắn - HR Control Panel',
        loadComponent: () =>
          import('./pages/messages/compose-message-page/compose-message-page').then(
            (m) => m.ComposeMessagePage,
          ),
      },
      {
        path: 'messages/:id',
        title: 'Chi Tiết Tin Nhắn - HR Control Panel',
        loadComponent: () =>
          import('./pages/messages/message-detail-page/message-detail-page').then(
            (m) => m.MessageDetailPage,
          ),
      },
      {
        path: 'message-templates',
        title: 'Mẫu Tin Nhắn - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/message-templates/message-templates-page').then(
            (m) => m.MessageTemplatesPage,
          ),
      },
      {
        path: 'message-templates/new',
        title: 'Thêm Mẫu Tin Nhắn - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/message-templates/template-form-page/template-form-page').then(
            (m) => m.TemplateFormPage,
          ),
      },
      {
        path: 'message-templates/:id',
        title: 'Sửa Mẫu Tin Nhắn - HR Control Panel',
        loadComponent: () =>
          import('./pages/admin/message-templates/template-form-page/template-form-page').then(
            (m) => m.TemplateFormPage,
          ),
      },
    ],
  },
  {
    path: 'staff',
    canActivate: [staffGuard],
    loadComponent: () =>
      import('./core/components/admin-shell/admin-shell').then((m) => m.AdminShellComponent),
    children: [
      {
        path: '',
        title: 'Cổng Thông Tin Nhân Sự - Employee Face AI',
        loadComponent: () =>
          import('./pages/staff/staff-profile/staff-profile').then((m) => m.StaffProfileComponent),
      },
      {
        path: 'messages',
        title: 'Tin Nhắn - Cổng Thông Tin Nhân Sự',
        loadComponent: () =>
          import('./pages/messages/messages-page/messages-page').then((m) => m.MessagesPage),
      },
      {
        path: 'messages/new',
        title: 'Soạn Tin Nhắn - Cổng Thông Tin Nhân Sự',
        loadComponent: () =>
          import('./pages/messages/compose-message-page/compose-message-page').then(
            (m) => m.ComposeMessagePage,
          ),
      },
      {
        path: 'messages/:id',
        title: 'Chi Tiết Tin Nhắn - Cổng Thông Tin Nhân Sự',
        loadComponent: () =>
          import('./pages/messages/message-detail-page/message-detail-page').then(
            (m) => m.MessageDetailPage,
          ),
      },
    ],
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
