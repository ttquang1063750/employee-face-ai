import { Injectable, signal } from '@angular/core';

export interface DialogOptions {
  title: string;
  message: string;
  type: 'alert' | 'confirm';
  confirmText?: string;
  cancelText?: string;
}

@Injectable({
  providedIn: 'root'
})
export class DialogService {
  dialogState = signal<any | null>(null);

  alert(title: string, message: string, confirmText: string = 'OK'): Promise<void> {
    return new Promise<void>((resolve) => {
      this.dialogState.set({
        title,
        message,
        type: 'alert',
        confirmText,
        resolve: () => {
          this.dialogState.set(null);
          resolve();
        }
      });
    });
  }

  confirm(title: string, message: string, confirmText: string = 'XÁC NHẬN', cancelText: string = 'HỦY'): Promise<boolean> {
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
        }
      });
    });
  }
}
