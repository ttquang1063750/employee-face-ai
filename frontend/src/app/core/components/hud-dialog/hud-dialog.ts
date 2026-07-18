import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { DialogService } from '../../services/dialog.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-hud-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './hud-dialog.html',
  styleUrl: './hud-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HudDialogComponent {
  promptValue = signal<string>('');

  constructor(public dialogService: DialogService) {}

  onConfirm(): void {
    const state = this.dialogService.dialogState();
    if (state && state.resolve) {
      if (state.type === 'confirm') {
        state.resolve(true);
      } else if (state.type === 'prompt') {
        state.resolve(this.promptValue());
        this.promptValue.set('');
      } else {
        state.resolve();
      }
    }
  }

  onCancel(): void {
    const state = this.dialogService.dialogState();
    if (state && state.resolve) {
      if (state.type === 'confirm') {
        state.resolve(false);
      } else if (state.type === 'prompt') {
        state.resolve(null);
        this.promptValue.set('');
      }
    }
  }
}
