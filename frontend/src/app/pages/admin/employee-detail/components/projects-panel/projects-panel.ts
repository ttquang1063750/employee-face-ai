import { Component, ChangeDetectionStrategy, signal, input, output, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DatePickerComponent } from '../../../../../core/components/date-picker/date-picker';
import { DialogService } from '../../../../../core/services/dialog.service';
import { EmployeeService } from '../../../../../core/services/employee.service';
import { Project } from '../../../../../core/models/employee.model';
import { todayLocalDateString } from '../../../../../core/utils/date.util';

@Component({
  selector: 'app-projects-panel',
  standalone: true,
  imports: [ReactiveFormsModule, DatePickerComponent, TranslatePipe],
  templateUrl: './projects-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPanelComponent {
  private dialogService = inject(DialogService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private translate = inject(TranslateService);

  projects = input.required<Project[]>();
  employeeId = input.required<number>();

  changed = output<void>();

  showModal = signal<boolean>(false);
  projectsListToEdit = signal<Project[]>([]);
  newProjectForm = this.fb.nonNullable.group({
    name: [''],
    role: [''],
    desc: [''],
    startDate: [''],
    endDate: [''],
  });
  isSaving = signal<boolean>(false);

  openModal(): void {
    this.projectsListToEdit.set(JSON.parse(JSON.stringify(this.projects())));
    this.newProjectForm.reset({
      name: '',
      role: '',
      desc: '',
      startDate: todayLocalDateString(),
      endDate: '',
    });
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  addProjectToList(): void {
    const raw = this.newProjectForm.getRawValue();
    const name = raw.name.trim();
    const role = raw.role.trim() || 'Contributor';
    const desc = raw.desc.trim() || 'No description provided';
    const start = raw.startDate;
    const end = raw.endDate ? raw.endDate : null;

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

    this.newProjectForm.patchValue({ name: '', role: '', desc: '', endDate: '' });
  }

  removeProjectFromList(index: number): void {
    this.projectsListToEdit.update((list) => list.filter((_, i) => i !== index));
  }

  save(): void {
    this.isSaving.set(true);

    this.employeeService.updateProjects(this.employeeId(), this.projectsListToEdit()).subscribe({
      next: async (res) => {
        this.isSaving.set(false);
        if (res.success) {
          await this.dialogService.alert(
            this.translate.instant('projectsPanel.successTitle'),
            this.translate.instant('projectsPanel.successMessage'),
          );
          this.closeModal();
          this.changed.emit();
        }
      },
      error: async (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        await this.dialogService.alert(
          this.translate.instant('projectsPanel.errorTitle'),
          this.translate.instant('projectsPanel.errorPrefix') + (err.error?.error || err.message),
        );
      },
    });
  }
}
