import { Component, OnInit, signal, ChangeDetectionStrategy, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { MessageService } from '../../../core/services/message.service';
import { MessageTemplate } from '../../../core/models/message.model';
import { translateMessageCategory } from '../../../core/utils/message-category.util';
import { stripRichContentPreview } from '../../../core/utils/rich-content.util';
import { IconComponent } from '../../../core/components/icon/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-message-templates-page',
  standalone: true,
  imports: [RouterLink, IconComponent, TranslatePipe],
  templateUrl: './message-templates-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageTemplatesPage implements OnInit {
  private dialogService = inject(DialogService);
  private messageService = inject(MessageService);
  private translate = inject(TranslateService);

  contentPreview(html: string | null | undefined): string {
    return stripRichContentPreview(html, this.translate.currentLang() === 'en' ? 'en' : 'vi');
  }

  categoryLabel(category: Parameters<typeof translateMessageCategory>[0]): string {
    return translateMessageCategory(category, this.translate.currentLang() === 'en' ? 'en' : 'vi');
  }

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
          this.errorMsg.set(res.error || this.translate.instant('templates.loadListError'));
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMsg.set(this.translate.instant('templates.connectionError'));
      },
    });
  }

  async deleteTemplate(template: MessageTemplate): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      this.translate.instant('templates.deleteConfirmTitle'),
      this.translate.instant('templates.deleteConfirmMessage', { name: template.name }),
    );
    if (!confirmed) return;

    this.messageService.deleteTemplate(template.id).subscribe({
      next: async (res) => {
        if (res.success) {
          this.loadTemplates();
        } else {
          await this.dialogService.alert(
            this.translate.instant('common.error'),
            res.error || this.translate.instant('templates.deleteError'),
          );
        }
      },
      error: async (err: HttpErrorResponse) => {
        await this.dialogService.alert(
          this.translate.instant('common.error'),
          err.error?.error || this.translate.instant('templates.genericServerError'),
        );
      },
    });
  }
}
