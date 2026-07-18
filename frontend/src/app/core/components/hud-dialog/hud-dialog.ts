import { Component, ChangeDetectionStrategy } from '@angular/core';
import { DialogService } from '../../services/dialog.service';

@Component({
  selector: 'app-hud-dialog',
  standalone: true,
  templateUrl: './hud-dialog.html',
  styleUrl: './hud-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HudDialogComponent {
  constructor(public dialogService: DialogService) {}

  onConfirm(): void {
    const state = this.dialogService.dialogState();
    if (state && state.resolve) {
      if (state.type === 'confirm') {
        state.resolve(true);
      } else {
        state.resolve();
      }
    }
  }

  onCancel(): void {
    const state = this.dialogService.dialogState();
    if (state && state.resolve && state.type === 'confirm') {
      state.resolve(false);
    }
  }
}
