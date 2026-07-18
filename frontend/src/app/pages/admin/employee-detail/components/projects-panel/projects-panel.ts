import { Component, ChangeDetectionStrategy, signal, input, output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DatePickerComponent } from '../../../../../core/components/date-picker/date-picker';
import { DialogService } from '../../../../../core/services/dialog.service';
import { ApiResponse } from '../../../../../core/models/api-response.model';
import { Project } from '../../../../../core/models/employee.model';
import { todayLocalDateString } from '../../../../../core/utils/date.util';

@Component({
  selector: 'app-projects-panel',
  standalone: true,
  imports: [FormsModule, DatePickerComponent],
  templateUrl: './projects-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPanelComponent {
  private http = inject(HttpClient);
  private dialogService = inject(DialogService);
  private readonly apiUrl = 'http://localhost:8000/api';

  projects = input.required<Project[]>();
  employeeId = input.required<number>();

  changed = output<void>();

  showModal = signal<boolean>(false);
  projectsListToEdit = signal<Project[]>([]);
  newProjName = signal<string>('');
  newProjRole = signal<string>('');
  newProjDesc = signal<string>('');
  newProjStartDate = signal<string>('');
  newProjEndDate = signal<string>('');
  isSaving = signal<boolean>(false);

  openModal(): void {
    this.projectsListToEdit.set(JSON.parse(JSON.stringify(this.projects())));
    this.newProjName.set('');
    this.newProjRole.set('');
    this.newProjDesc.set('');
    this.newProjStartDate.set(todayLocalDateString());
    this.newProjEndDate.set('');
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  addProjectToList(): void {
    const name = this.newProjName().trim();
    const role = this.newProjRole().trim() || 'Contributor';
    const desc = this.newProjDesc().trim() || 'No description provided';
    const start = this.newProjStartDate();
    const end = this.newProjEndDate() ? this.newProjEndDate() : null;

    if (!name) return;

    this.projectsListToEdit.update((list) => [
      ...list,
      {
        project_name: name,
        role: role,
        description: desc,
        start_date: start,
        end_date: end,
      },
    ]);

    this.newProjName.set('');
    this.newProjRole.set('');
    this.newProjDesc.set('');
    this.newProjEndDate.set('');
  }

  removeProjectFromList(index: number): void {
    this.projectsListToEdit.update((list) => list.filter((_, i) => i !== index));
  }

  save(): void {
    this.isSaving.set(true);

    this.http
      .put<ApiResponse>(`${this.apiUrl}/employees/${this.employeeId()}/projects`, this.projectsListToEdit())
      .subscribe({
        next: async (res) => {
          this.isSaving.set(false);
          if (res.success) {
            await this.dialogService.alert('THÀNH CÔNG', 'Cập nhật lịch sử dự án thành công.');
            this.closeModal();
            this.changed.emit();
          }
        },
        error: async (err: HttpErrorResponse) => {
          this.isSaving.set(false);
          await this.dialogService.alert(
            'LỖI CẬP NHẬT',
            'Lỗi cập nhật lịch sử dự án: ' + (err.error?.error || err.message),
          );
        },
      });
  }
}
