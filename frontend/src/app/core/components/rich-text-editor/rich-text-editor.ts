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
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';
import { ShapeDrawingModal } from '../shape-drawing-modal/shape-drawing-modal';
import { HudSelectComponent, HudSelectOption } from '../hud-select/hud-select';
import { MessageService } from '../../services/message.service';
import { DialogService } from '../../services/dialog.service';
import { environment } from '../../../../environments/environment';

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  bulletList: boolean;
  orderedList: boolean;
  code: boolean;
  codeBlock: boolean;
  headingLevel: 1 | 2 | 3 | null;
}

const EMPTY_TOOLBAR_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  bulletList: false,
  orderedList: false,
  code: false,
  codeBlock: false,
  headingLevel: null,
};

const DEFAULT_COLOR = '#39d353';

// Font size isn't a mark of its own — it's a `textStyle` attribute (see
// FontSize from @tiptap/extension-text-style), so "no size set" and "reset
// to default" are both represented as null, not a real px value.
const FONT_SIZE_OPTIONS: HudSelectOption<string | null>[] = [
  { value: null, label: 'Mặc định' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '24px', label: '24' },
  { value: '32px', label: '32' },
];

@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  imports: [ShapeDrawingModal, HudSelectComponent, ReactiveFormsModule],
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
  colorPickerInput = viewChild.required<ElementRef<HTMLInputElement>>('colorPickerInput');

  private editor: Editor | null = null;
  private pendingContent = '';
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  readonly fontSizeOptions = FONT_SIZE_OPTIONS;
  fontSizeControl = new FormControl<string | null>(null);

  isDisabled = signal(false);
  showDrawingModal = signal(false);
  isUploadingImage = signal(false);
  toolbarState = signal<ToolbarState>(EMPTY_TOOLBAR_STATE);
  currentColor = signal(DEFAULT_COLOR);

  ngAfterViewInit(): void {
    this.editor = new Editor({
      element: this.editorHost().nativeElement,
      // Underline is already bundled into StarterKit as of Tiptap v3 —
      // registering @tiptap/extension-underline separately here caused a
      // "Duplicate extension names found: ['underline']" warning.
      extensions: [StarterKit, Image, TextStyle, Color, FontSize],
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

    // The select emits on every pick, including one that just mirrors what
    // refreshToolbarState() already set from the cursor position — guard so
    // that re-application doesn't get pushed onto the undo stack pointlessly.
    this.fontSizeControl.valueChanges.subscribe((size) => {
      if (
        !this.editor ||
        this.editor.getAttributes('textStyle')['fontSize'] === (size ?? undefined)
      ) {
        return;
      }
      if (size) {
        this.editor.chain().focus().setFontSize(size).run();
      } else {
        this.editor.chain().focus().unsetFontSize().run();
      }
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
    const headingLevel = ([1, 2, 3] as const).find((level) =>
      this.editor?.isActive('heading', { level }),
    );
    this.toolbarState.set({
      bold: this.editor.isActive('bold'),
      italic: this.editor.isActive('italic'),
      underline: this.editor.isActive('underline'),
      bulletList: this.editor.isActive('bulletList'),
      orderedList: this.editor.isActive('orderedList'),
      code: this.editor.isActive('code'),
      codeBlock: this.editor.isActive('codeBlock'),
      headingLevel: headingLevel ?? null,
    });

    const attrs = this.editor.getAttributes('textStyle');
    this.fontSizeControl.setValue((attrs['fontSize'] as string | undefined) ?? null, {
      emitEvent: false,
    });
    this.currentColor.set((attrs['color'] as string | undefined) ?? DEFAULT_COLOR);
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

  setHeading(level: 1 | 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
  }

  toggleCode(): void {
    this.editor?.chain().focus().toggleCode().run();
  }

  toggleCodeBlock(): void {
    this.editor?.chain().focus().toggleCodeBlock().run();
  }

  triggerColorPicker(): void {
    this.colorPickerInput().nativeElement.click();
  }

  onColorPicked(event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.currentColor.set(color);
    this.editor?.chain().focus().setColor(color).run();
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
