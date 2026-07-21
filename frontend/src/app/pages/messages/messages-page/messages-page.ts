import { Component, OnInit, signal, ChangeDetectionStrategy, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MessageService } from '../../../core/services/message.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogService } from '../../../core/services/dialog.service';
import { ReceivedMessage, SentMessage } from '../../../core/models/message.model';
import { translateMessageCategory } from '../../../core/utils/message-category.util';
import { IconComponent } from '../../../core/components/icon/icon';

type MessagesTab = 'received' | 'sent';

@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [RouterLink, DatePipe, IconComponent, TranslatePipe],
  templateUrl: './messages-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessagesPage implements OnInit {
  private messageService = inject(MessageService);
  private realtimeService = inject(RealtimeService);
  private dialogService = inject(DialogService);
  private translate = inject(TranslateService);

  activeTab = signal<MessagesTab>('received');

  // "Đã nhận" is written into the app-wide shared signal (same one driving
  // the sidebar unread badge) rather than a page-local one — same
  // "own initial fetch, shared signal" pattern as leave-requests.ts.
  receivedMessages = this.realtimeService.receivedMessages;
  sentMessages = signal<SentMessage[]>([]);

  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  categoryLabel(category: Parameters<typeof translateMessageCategory>[0]): string {
    return translateMessageCategory(category, this.translate.currentLang() === 'en' ? 'en' : 'vi');
  }

  ngOnInit(): void {
    this.loadMessages();
  }

  selectTab(tab: MessagesTab): void {
    this.activeTab.set(tab);
  }

  loadMessages(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.messageService.getReceived().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.realtimeService.receivedMessages.set(res.data);
        }
      },
    });

    this.messageService.getSent().subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.sentMessages.set(res.data);
        } else {
          this.errorMsg.set(res.error || this.translate.instant('messages.loadListError'));
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set(this.translate.instant('messages.connectionError'));
      },
    });
  }

  // Only hides the message on this side (see MessageService.deleteMessage) —
  // stopPropagation keeps the click from also firing the row's routerLink.
  async deleteMessage(msg: ReceivedMessage | SentMessage, event: Event): Promise<void> {
    event.stopPropagation();

    const confirmed = await this.dialogService.confirm(
      this.translate.instant('messages.deleteConfirmTitle'),
      this.translate.instant('messages.deleteConfirmMessage', { subject: msg.subject }),
    );
    if (!confirmed) return;

    this.messageService.deleteMessage(msg.id).subscribe({
      next: async (res) => {
        if (res.success) {
          this.realtimeService.receivedMessages.update((list) =>
            list.filter((m) => m.id !== msg.id),
          );
          this.sentMessages.update((list) => list.filter((m) => m.id !== msg.id));
        } else {
          await this.dialogService.alert(
            this.translate.instant('common.error'),
            res.error || this.translate.instant('messages.deleteError'),
          );
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert(
          this.translate.instant('common.error'),
          err.error?.error || this.translate.instant('messages.genericServerError'),
        );
      },
    });
  }
}
