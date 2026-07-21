import { Component, ChangeDetectionStrategy, computed, inject, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RealtimeService } from '../../services/realtime.service';
import { IconComponent } from '../icon/icon';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent],
  templateUrl: './admin-shell.html',
  styleUrl: './admin-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminShellComponent implements OnInit {
  authService = inject(AuthService);
  private router = inject(Router);
  realtimeService = inject(RealtimeService);

  pendingCount = computed(() => this.realtimeService.pendingLeaveCount());
  unreadMessageCount = computed(() => this.realtimeService.unreadMessageCount());

  ngOnInit(): void {
    this.realtimeService.refreshLeaveRequests();
    this.realtimeService.refreshReceivedMessages();
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }
}
