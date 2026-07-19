import { Component, ChangeDetectionStrategy, signal, input, output, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DialogService } from '../../../../../core/services/dialog.service';
import { ApiResponse } from '../../../../../core/models/api-response.model';
import { Skill } from '../../../../../core/models/employee.model';

@Component({
  selector: 'app-skills-panel',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './skills-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPanelComponent {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private fb = inject(FormBuilder);
  private readonly apiUrl = 'http://localhost:8000/api';

  skills = input.required<Skill[]>();
  employeeId = input.required<number>();

  changed = output<void>();

  showModal = signal<boolean>(false);
  skillsListToEdit = signal<Skill[]>([]);
  newSkillForm = this.fb.nonNullable.group({
    name: [''],
    desc: [''],
  });
  isSaving = signal<boolean>(false);

  openModal(): void {
    this.skillsListToEdit.set(JSON.parse(JSON.stringify(this.skills())));
    this.newSkillForm.reset({ name: '', desc: '' });
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  async addSkillToList(): Promise<void> {
    const { name: rawName, desc: rawDesc } = this.newSkillForm.getRawValue();
    const name = rawName.trim();
    const desc = rawDesc.trim() || 'No description provided';
    if (!name) return;

    if (this.skillsListToEdit().some((s) => s.skill_name.toLowerCase() === name.toLowerCase())) {
      await this.dialogService.alert('KỸ NĂNG TỒN TẠI', 'Kỹ năng này đã tồn tại trong danh sách.');
      return;
    }

    this.skillsListToEdit.update((list) => [...list, { skill_name: name, description: desc }]);
    this.newSkillForm.reset({ name: '', desc: '' });
  }

  removeSkillFromList(index: number): void {
    this.skillsListToEdit.update((list) => list.filter((_, i) => i !== index));
  }

  save(): void {
    this.isSaving.set(true);

    this.http
      .put<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId()}/skills`, this.skillsListToEdit())
      .subscribe({
        next: async (res) => {
          this.isSaving.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật danh sách kỹ năng thành công.');
            this.closeModal();
            this.changed.emit();
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSaving.set(false);
          await this.dialogService.alert(
            'LỖI CẬP NHẬT',
            'Lỗi cập nhật kỹ năng: ' + (err.error?.error || err.message),
          );
        },
      });
  }
}
