import { Component, signal, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  username = signal<string>('');
  password = signal<string>('');
  errorMsg = signal<string | null>(null);
  isLoading = signal<boolean>(false);

  constructor() {
    if (this.authService.isAuthenticated()) {
      this.router.navigate([this.authService.isAdmin() ? '/admin/dashboard' : '/staff']);
    }
  }

  onSubmit(): void {
    if (!this.username().trim() || !this.password()) {
      this.errorMsg.set('Vui lòng nhập đầy đủ Username và Mật khẩu.');
      return;
    }

    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.authService.login(this.username().trim(), this.password()).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.router.navigate([res.user.role === 'admin' ? '/admin/dashboard' : '/staff']);
      },
      error: (err) => {
        this.isLoading.set(false);
        if (err.error && err.error.error) {
          this.errorMsg.set(err.error.error);
        } else {
          this.errorMsg.set('Lỗi kết nối máy chủ. Vui lòng kiểm tra lại thông tin.');
        }
      },
    });
  }
}
