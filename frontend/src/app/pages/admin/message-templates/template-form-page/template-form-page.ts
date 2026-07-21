import {
  Component,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HudSelectComponent } from '../../../../core/components/hud-select/hud-select';
import { RichTextEditor } from '../../../../core/components/rich-text-editor/rich-text-editor';
import { DialogService } from '../../../../core/services/dialog.service';
import { MessageService } from '../../../../core/services/message.service';
import { MessageCategory } from '../../../../core/models/message.model';
import { MESSAGE_CATEGORY_OPTIONS } from '../../../../core/utils/message-category.util';
import { richContentRequiredValidator } from '../../../../core/utils/rich-content.util';
import { IconComponent } from '../../../../core/components/icon/icon';

@Component({
  selector: 'app-template-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, HudSelectComponent, RichTextEditor, IconComponent],
  templateUrl: './template-form-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateFormPage implements OnInit {
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private messageService = inject(MessageService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly categoryOptions = MESSAGE_CATEGORY_OPTIONS;

  // null on 'message-templates/new', the id being edited on 'message-templates/:id'.
  private templateId = signal<number | null>(null);
  isEditMode = computed(() => this.templateId() !== null);
  // Only relevant in edit mode, while the full template list is fetched to
  // find this one — no dedicated GET /api/message-templates/{id} endpoint
  // exists, and the admin-managed list is small enough that reusing the
  // list endpoint avoids adding one.
  isLoading = signal<boolean>(false);
  isSaving = signal<boolean>(false);

  form = this.fb.nonNullable.group({
    category: this.fb.nonNullable.control<MessageCategory>('daily_report'),
    name: ['', Validators.required],
    content: ['', richContentRequiredValidator],
  });

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (!idParam) return;

    const id = Number(idParam);
    this.templateId.set(id);
    this.isLoading.set(true);

    this.messageService.getTemplates().subscribe({
      next: async (res) => {
        this.isLoading.set(false);
        const template = res.data?.find((t) => t.id === id);
        if (!res.success || !template) {
          await this.dialogService.alert('LỖI', 'Không tìm thấy mẫu tin nhắn.');
          this.router.navigate(['../'], { relativeTo: this.route });
          return;
        }
        this.form.reset({
          category: template.category,
          name: template.name,
          content: template.content,
        });
      },
      error: async () => {
        this.isLoading.set(false);
        await this.dialogService.alert('LỖI', 'Lỗi kết nối máy chủ API.');
        this.router.navigate(['../'], { relativeTo: this.route });
      },
    });
  }

  save(): void {
    if (this.form.invalid) return;
    this.isSaving.set(true);
    const payload = this.form.getRawValue();
    const id = this.templateId();

    const request = id
      ? this.messageService.updateTemplate(id, payload)
      : this.messageService.createTemplate(payload);

    request.subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          this.router.navigate(['../'], { relativeTo: this.route });
        } else {
          await this.dialogService.alert('LỖI', res.error || 'Không thể lưu mẫu tin nhắn.');
        }
      },
      error: async (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        await this.dialogService.alert('LỖI', err.error?.error || 'Lỗi kết nối máy chủ.');
      },
    });
  }

  cancel(): void {
    this.router.navigate(['../'], { relativeTo: this.route });
  }
}
