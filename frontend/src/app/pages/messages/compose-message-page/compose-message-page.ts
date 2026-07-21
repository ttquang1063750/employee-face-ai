import { Component, OnInit, signal, computed, ChangeDetectionStrategy, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HudSelectComponent, HudSelectOption } from '../../../core/components/hud-select/hud-select';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/services/auth.service';
import { EmployeeService } from '../../../core/services/employee.service';
import { MessageService } from '../../../core/services/message.service';
import { EmployeeDirectoryEntry } from '../../../core/models/employee.model';
import { MessageCategory, MessageTemplate } from '../../../core/models/message.model';
import { MESSAGE_CATEGORY_OPTIONS } from '../../../core/utils/message-category.util';

@Component({
  selector: 'app-compose-message-page',
  standalone: true,
  imports: [ReactiveFormsModule, HudSelectComponent],
  templateUrl: './compose-message-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComposeMessagePage implements OnInit {
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private authService = inject(AuthService);
  private employeeService = inject(EmployeeService);
  private messageService = inject(MessageService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly categoryOptions = MESSAGE_CATEGORY_OPTIONS;

  employees = signal<EmployeeDirectoryEntry[]>([]);
  templates = signal<MessageTemplate[]>([]);
  isSubmitting = signal<boolean>(false);

  // Recipient search — same autocomplete shape as the dashboard's employee
  // name search (FormControl + live-filtered dropdown, not gated behind Apply).
  recipientQueryControl = new FormControl('', { nonNullable: true });
  private recipientQuery = toSignal(this.recipientQueryControl.valueChanges, {
    initialValue: this.recipientQueryControl.value,
  });
  showRecipientSuggestions = signal<boolean>(false);
  selectedRecipient = signal<EmployeeDirectoryEntry | null>(null);

  form = this.fb.nonNullable.group({
    category: this.fb.nonNullable.control<MessageCategory>('daily_report'),
    templateId: this.fb.control<number | null>(null),
    subject: ['', Validators.required],
    content: ['', Validators.required],
  });
  private formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  recipientSuggestions = computed(() => {
    const q = this.recipientQuery().toLowerCase().trim();
    const selfId = this.authService.currentUser()?.id;
    const candidates = this.employees().filter((e) => e.id !== selfId);
    if (!q) return candidates.slice(0, 8);
    return candidates.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 8);
  });

  templateSelectOptions = computed<HudSelectOption<number>[]>(() =>
    this.templates()
      .filter((t) => t.category === this.formValue().category)
      .map((t) => ({ value: t.id, label: t.name })),
  );

  canSubmit = computed(() => {
    const { subject = '', content = '' } = this.formValue();
    return !!this.selectedRecipient() && !!subject.trim() && !!content.trim();
  });

  constructor() {
    // Selecting a template prefills subject/content — done as a side effect
    // of the control's own valueChanges (not a template (change) handler),
    // since app-hud-select only exposes its selection via a bound FormControl.
    this.form.controls.templateId.valueChanges.pipe(takeUntilDestroyed()).subscribe((templateId) => {
      if (templateId === null) return;
      const template = this.templates().find((t) => t.id === templateId);
      if (template) {
        this.form.patchValue({ subject: template.name, content: template.content });
      }
    });
  }

  ngOnInit(): void {
    this.employeeService.getDirectory().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.employees.set(res.data);
        }
      },
    });
    this.messageService.getTemplates().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.templates.set(res.data);
        }
      },
    });
  }

  selectRecipient(emp: EmployeeDirectoryEntry): void {
    this.selectedRecipient.set(emp);
    this.recipientQueryControl.setValue(emp.name);
    this.showRecipientSuggestions.set(false);
  }

  clearRecipient(): void {
    this.selectedRecipient.set(null);
    this.recipientQueryControl.setValue('');
  }

  closeSuggestions(): void {
    setTimeout(() => this.showRecipientSuggestions.set(false), 150);
  }

  async submit(): Promise<void> {
    const recipient = this.selectedRecipient();
    if (!recipient) return;

    this.isSubmitting.set(true);
    const { category, subject, content } = this.form.getRawValue();

    this.messageService
      .send({ recipient_id: recipient.id, category, subject: subject.trim(), content: content.trim() })
      .subscribe({
        next: async (res) => {
          this.isSubmitting.set(false);
          if (res.success) {
            this.router.navigate(['../'], { relativeTo: this.route });
          } else {
            await this.dialogService.alert('LỖI', res.error || 'Không thể gửi tin nhắn.');
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSubmitting.set(false);
          await this.dialogService.alert(
            'LỖI GỬI TIN NHẮN',
            err.error?.error || 'Lỗi kết nối máy chủ.',
          );
        },
      });
  }

  cancel(): void {
    this.router.navigate(['../'], { relativeTo: this.route });
  }
}
