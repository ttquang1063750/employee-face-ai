import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { DialogService } from '../../services/dialog.service';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-hud-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: './hud-dialog.html',
  styleUrl: './hud-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HudDialogComponent {
  dialogService = inject(DialogService);

  promptValue = new FormControl('', { nonNullable: true });

  onConfirm(): void {
    const state = this.dialogService.dialogState();
    if (state) {
      if (state.type === 'confirm') {
        state.resolve(true);
      } else if (state.type === 'prompt') {
        state.resolve(this.promptValue.value);
        this.promptValue.reset('');
      } else {
        state.resolve();
      }
    }
  }

  onCancel(): void {
    const state = this.dialogService.dialogState();
    if (state) {
      if (state.type === 'confirm') {
        state.resolve(false);
      } else if (state.type === 'prompt') {
        state.resolve(null);
        this.promptValue.reset('');
      }
    }
  }
}
