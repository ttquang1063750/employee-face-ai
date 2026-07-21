import {
  Component,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  ChangeDetectionStrategy,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { ShapeDrawingModal } from '../shape-drawing-modal/shape-drawing-modal';
import { MessageService } from '../../services/message.service';
import { DialogService } from '../../services/dialog.service';
import { environment } from '../../../../environments/environment';

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  bulletList: boolean;
  orderedList: boolean;
}

const EMPTY_TOOLBAR_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  bulletList: false,
  orderedList: false,
};

@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  imports: [ShapeDrawingModal],
  templateUrl: './rich-text-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditor),
      multi: true,
    },
  ],
})
export class RichTextEditor implements ControlValueAccessor, AfterViewInit, OnDestroy {
  private messageService = inject(MessageService);
  private dialogService = inject(DialogService);

  // Applied to the actual contenteditable host, not this component's own
  // element — same "explicit id input" pattern as HudSelectComponent's
  // selectId, since a <label for> needs it on the focusable element itself.
  editorId = input<string | null>(null);

  editorHost = viewChild.required<ElementRef<HTMLDivElement>>('editorHost');
  imageFileInput = viewChild.required<ElementRef<HTMLInputElement>>('imageFileInput');

  private editor: Editor | null = null;
  private pendingContent = '';
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  isDisabled = signal(false);
  showDrawingModal = signal(false);
  isUploadingImage = signal(false);
  toolbarState = signal<ToolbarState>(EMPTY_TOOLBAR_STATE);

  ngAfterViewInit(): void {
    this.editor = new Editor({
      element: this.editorHost().nativeElement,
      // Underline is already bundled into StarterKit as of Tiptap v3 —
      // registering @tiptap/extension-underline separately here caused a
      // "Duplicate extension names found: ['underline']" warning.
      extensions: [StarterKit, Image],
      content: this.pendingContent,
      editable: !this.isDisabled(),
      onUpdate: ({ editor }) => {
        this.onChange(editor.getHTML());
        this.refreshToolbarState();
      },
      onSelectionUpdate: () => this.refreshToolbarState(),
      onBlur: () => this.onTouched(),
      editorProps: {
        // Tab/Shift+Tab nest/un-nest the current list item — Tiptap doesn't
        // bind this by default, only exposes the sink/lift commands.
        handleKeyDown: (_view, event) => {
          if (event.key !== 'Tab' || !this.editor) return false;
          const ran = event.shiftKey
            ? this.editor.chain().focus().liftListItem('listItem').run()
            : this.editor.chain().focus().sinkListItem('listItem').run();
          if (ran) event.preventDefault();
          return ran;
        },
      },
    });
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }

  writeValue(value: string | null): void {
    this.pendingContent = value || '';
    if (this.editor && this.editor.getHTML() !== this.pendingContent) {
      this.editor.commands.setContent(this.pendingContent);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
    this.editor?.setEditable(!isDisabled);
  }

  private refreshToolbarState(): void {
    if (!this.editor) return;
    this.toolbarState.set({
      bold: this.editor.isActive('bold'),
      italic: this.editor.isActive('italic'),
      underline: this.editor.isActive('underline'),
      bulletList: this.editor.isActive('bulletList'),
      orderedList: this.editor.isActive('orderedList'),
    });
  }

  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleUnderline(): void {
    this.editor?.chain().focus().toggleUnderline().run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  indentListItem(): void {
    this.editor?.chain().focus().sinkListItem('listItem').run();
  }

  outdentListItem(): void {
    this.editor?.chain().focus().liftListItem('listItem').run();
  }

  openDrawingModal(): void {
    this.showDrawingModal.set(true);
  }

  closeDrawingModal(): void {
    this.showDrawingModal.set(false);
  }

  insertImage(url: string): void {
    this.editor?.chain().focus().setImage({ src: url }).run();
    this.showDrawingModal.set(false);
  }

  triggerImageUpload(): void {
    this.imageFileInput().nativeElement.click();
  }

  onImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.isUploadingImage.set(true);
      this.messageService.uploadImage(reader.result as string).subscribe({
        next: async (res) => {
          this.isUploadingImage.set(false);
          if (res.success && res.data?.url) {
            this.insertImage(`${environment.serverBaseUrl}${res.data.url}`);
          } else {
            await this.dialogService.alert('LỖI', res.error || 'Không thể tải ảnh lên.');
          }
        },
        error: async () => {
          this.isUploadingImage.set(false);
          await this.dialogService.alert('LỖI', 'Lỗi kết nối máy chủ.');
        },
      });
    };
    reader.readAsDataURL(file);
  }
}
