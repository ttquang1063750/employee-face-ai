import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent {
  id = signal<number | null>(null);
  password = signal<string>('');
  errorMsg = signal<string | null>(null);
  isLoading = signal<boolean>(false);

  constructor(private authService: AuthService, private router: Router) {
    if (this.authService.isAuthenticated() && this.authService.isAdmin()) {
      this.router.navigate(['/admin/dashboard']);
    }
  }

  onSubmit(): void {
    if (!this.id() || !this.password()) {
      this.errorMsg.set('Vui lòng nhập đầy đủ Mã nhân viên và Mật khẩu.');
      return;
    }

    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.authService.login(this.id()!, this.password()).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.router.navigate(['/admin/dashboard']);
      },
      error: (err) => {
        this.isLoading.set(false);
        if (err.error && err.error.error) {
          this.errorMsg.set(err.error.error);
        } else {
          this.errorMsg.set('Lỗi kết nối máy chủ. Vui lòng kiểm tra lại thông tin.');
        }
      }
    });
  }
}
