import { Component, signal, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { LanguageSwitcherComponent } from '../../core/components/language-switcher/language-switcher';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, LanguageSwitcherComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private translate = inject(TranslateService);

  form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  errorMsg = signal<string | null>(null);
  isLoading = signal<boolean>(false);

  constructor() {
    if (this.authService.isAuthenticated()) {
      this.router.navigate([this.authService.isAdmin() ? '/admin/dashboard' : '/staff']);
    }
  }

  onSubmit(): void {
    const { username, password } = this.form.getRawValue();
    if (!username.trim() || !password) {
      this.errorMsg.set(this.translate.instant('login.missingFields'));
      return;
    }

    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.authService.login(username.trim(), password).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.router.navigate([res.user.role === 'admin' ? '/admin/dashboard' : '/staff']);
      },
      error: (err) => {
        this.isLoading.set(false);
        if (err.error && err.error.error) {
          this.errorMsg.set(err.error.error);
        } else {
          this.errorMsg.set(this.translate.instant('login.serverError'));
        }
      },
    });
  }
}
