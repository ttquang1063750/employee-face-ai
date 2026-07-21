import { Component, OnInit, signal, ChangeDetectionStrategy, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { MessageService } from '../../../core/services/message.service';
import { MessageTemplate } from '../../../core/models/message.model';
import { translateMessageCategory } from '../../../core/utils/message-category.util';
import { stripRichContentPreview } from '../../../core/utils/rich-content.util';

@Component({
  selector: 'app-message-templates-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './message-templates-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageTemplatesPage implements OnInit {
  private dialogService = inject(DialogService);
  private messageService = inject(MessageService);

  protected readonly translateMessageCategory = translateMessageCategory;
  protected readonly stripRichContentPreview = stripRichContentPreview;

  templates = signal<MessageTemplate[]>([]);
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  ngOnInit(): void {
    this.loadTemplates();
  }

  loadTemplates(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.messageService.getTemplates().subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.templates.set(res.data);
        } else {
          this.errorMsg.set(res.error || 'Không thể tải danh sách mẫu tin nhắn.');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set('Lỗi kết nối máy chủ API.');
      },
    });
  }

  async deleteTemplate(template: MessageTemplate): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÓA MẪU TIN NHẮN',
      `Xóa mẫu "${template.name}"? Thao tác này không thể hoàn tác.`,
    );
    if (!confirmed) return;

    this.messageService.deleteTemplate(template.id).subscribe({
      next: async (res) => {
        if (res.success) {
          this.loadTemplates();
        } else {
          await this.dialogService.alert('LỖI', res.error || 'Không thể xóa mẫu tin nhắn.');
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert('LỖI', err.error?.error || 'Lỗi kết nối máy chủ.');
      },
    });
  }
}
