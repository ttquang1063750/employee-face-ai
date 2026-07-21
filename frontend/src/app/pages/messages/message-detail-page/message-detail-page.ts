import { Component, OnInit, signal, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { MessageService } from '../../../core/services/message.service';
import { MessageDetail } from '../../../core/models/message.model';
import { translateMessageCategory } from '../../../core/utils/message-category.util';

@Component({
  selector: 'app-message-detail-page',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './message-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);
  private messageService = inject(MessageService);

  message = signal<MessageDetail | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  protected readonly translateMessageCategory = translateMessageCategory;

  private messageId: number | null = null;

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.messageId = parseInt(idParam, 10);
      this.loadMessage();
    }
  }

  loadMessage(): void {
    if (this.messageId === null) return;
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.messageService.getMessage(this.messageId).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.message.set(res.data);
          this.markReadIfNeeded(res.data);
        } else {
          this.errorMsg.set(res.error || 'Không thể tải tin nhắn.');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      },
    });
  }

  private markReadIfNeeded(message: MessageDetail): void {
    const selfId = this.authService.currentUser()?.id;
    if (message.recipient_id !== selfId || message.is_read) return;

    this.messageService.markRead(message.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.message.set({ ...message, is_read: true });
        }
      },
    });
  }

  back(): void {
    this.router.navigate(['../'], { relativeTo: this.route });
  }
}
