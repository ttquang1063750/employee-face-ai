import { Component, OnInit, signal, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { MessageService } from '../../../core/services/message.service';
import { MessageDetail } from '../../../core/models/message.model';
import { translateMessageCategory } from '../../../core/utils/message-category.util';
import { IconComponent } from '../../../core/components/icon/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-message-detail-page',
  standalone: true,
  imports: [DatePipe, IconComponent, TranslatePipe],
  templateUrl: './message-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);
  private messageService = inject(MessageService);
  private translate = inject(TranslateService);

  message = signal<MessageDetail | null>(null);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  categoryLabel(category: Parameters<typeof translateMessageCategory>[0]): string {
    return translateMessageCategory(category, this.translate.currentLang() === 'en' ? 'en' : 'vi');
  }

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
          this.errorMsg.set(res.error || this.translate.instant('messageDetail.loadError'));
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set(this.translate.instant('messageDetail.connectionError'));
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
