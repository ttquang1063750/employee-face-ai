import { Injectable, signal } from '@angular/core';
import { DialogState } from '../models/dialog-state.model';

export interface DialogOptions {
  title: string;
  message: string;
  type: 'alert' | 'confirm';
  confirmText?: string;
  cancelText?: string;
}

@Injectable({
  providedIn: 'root',
})
export class DialogService {
  dialogState = signal<DialogState | null>(null);

  alert(title: string, message: string, confirmText = 'OK'): Promise<void> {
    return new Promise<void>((resolve) => {
      this.dialogState.set({
        title,
        message,
        type: 'alert',
        confirmText,
        resolve: () => {
          this.dialogState.set(null);
          resolve();
        },
      });
    });
  }

  confirm(
    title: string,
    message: string,
    confirmText = 'XÁC NHẬN',
    cancelText = 'HỦY',
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.dialogState.set({
        title,
        message,
        type: 'confirm',
        confirmText,
        cancelText,
        resolve: (result: boolean) => {
          this.dialogState.set(null);
          resolve(result);
        },
      });
    });
  }

  prompt(
    title: string,
    message: string,
    placeholder = '',
    confirmText = 'XÁC NHẬN',
    cancelText = 'HỦY',
  ): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.dialogState.set({
        title,
        message,
        type: 'prompt',
        confirmText,
        cancelText,
        placeholder,
        resolve: (result: string | null) => {
          this.dialogState.set(null);
          resolve(result);
        },
      });
    });
  }
}
