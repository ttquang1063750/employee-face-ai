export interface AlertDialogState {
  type: 'alert';
  title: string;
  message: string;
  confirmText: string;
  resolve: () => void;
}

export interface ConfirmDialogState {
  type: 'confirm';
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  resolve: (result: boolean) => void;
}

export interface PromptDialogState {
  type: 'prompt';
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  placeholder: string;
  resolve: (result: string | null) => void;
}

export type DialogState = AlertDialogState | ConfirmDialogState | PromptDialogState;
