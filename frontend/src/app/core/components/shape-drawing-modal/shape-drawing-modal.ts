import {
  Component,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  ChangeDetectionStrategy,
  HostListener,
  inject,
  signal,
  output,
  viewChild,
} from '@angular/core';
import { Canvas, Rect, Ellipse, Line, Triangle, Textbox, Group } from 'fabric';
import { MessageService } from '../../services/message.service';
import { DialogService } from '../../services/dialog.service';
import { environment } from '../../../../environments/environment';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

type ShapeTool = 'select' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'crop';

interface HistorySnapshot {
  json: Record<string, unknown>;
  width: number;
  height: number;
}

const MIN_CANVAS_WIDTH = 480;
const MAX_CANVAS_WIDTH = 1100;
const CANVAS_HEIGHT = 480;
const MAX_HISTORY = 50;

@Component({
  selector: 'app-shape-drawing-modal',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './shape-drawing-modal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShapeDrawingModal implements AfterViewInit, OnDestroy {
  private messageService = inject(MessageService);
  private dialogService = inject(DialogService);
  private translate = inject(TranslateService);

  insert = output<string>();
  cancelled = output<void>();

  canvasWrapper = viewChild.required<ElementRef<HTMLDivElement>>('canvasWrapper');
  canvasHost = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasHost');
  colorPickerInput = viewChild.required<ElementRef<HTMLInputElement>>('colorPickerInput');

  private canvas: Canvas | null = null;
  private canvasWidth = MIN_CANVAS_WIDTH;
  private canvasHeight = CANVAS_HEIGHT;
  private drawingShape: Rect | Ellipse | Line | null = null;
  private startPoint: { x: number; y: number } | null = null;
  // The crop selection is a plain Rect, tracked separately (by identity, not
  // a custom data tag) so it can be excluded from "is the canvas empty?"
  // checks and stripped out of the exported image.
  private cropRect: Rect | null = null;

  // Snapshot-based undo/redo (whole-canvas JSON, not per-mutation diffing) —
  // robust against the very different kinds of state changes here (adding a
  // shape, deleting one, dragging/resizing via Fabric's own controls,
  // clearing everything, and applyCrop() which resizes the canvas itself and
  // shifts every object). The crop-selection rect is deliberately excluded
  // from every snapshot (same detach-serialize-reattach dance as
  // insertIntoContent()'s export) — it's a transient tool draft, not
  // canvas content, so drawing/clearing it never touches history.
  private historyStack: HistorySnapshot[] = [];
  private historyIndex = -1;
  private isRestoringHistory = false;
  canUndo = signal(false);
  canRedo = signal(false);

  readonly colors = ['#39d353', '#f43f5e', '#38bdf8', '#fb923c', '#1e2724', '#ffffff'];

  activeTool = signal<ShapeTool>('select');
  strokeColor = signal('#39d353');
  hasCrop = signal(false);
  isUploading = signal(false);

  ngAfterViewInit(): void {
    const wrapperWidth = this.canvasWrapper().nativeElement.clientWidth;
    this.canvasWidth = Math.min(Math.max(wrapperWidth, MIN_CANVAS_WIDTH), MAX_CANVAS_WIDTH);

    this.canvas = new Canvas(this.canvasHost().nativeElement, {
      width: this.canvasWidth,
      height: this.canvasHeight,
      // Left transparent (no backgroundColor) so the exported PNG has no
      // opaque fill behind the drawn shapes — the checkerboard the user
      // sees is a CSS background on the <canvas> element itself, not part
      // of the Fabric canvas content.
    });

    this.canvas.on('mouse:down', (opt) => this.onMouseDown(opt.e));
    this.canvas.on('mouse:move', (opt) => this.onMouseMove(opt.e));
    this.canvas.on('mouse:up', () => this.onMouseUp());
    // Dragging/resizing an object via Fabric's own selection handles doesn't
    // go through any of our onMouseDown/Move/Up drawing logic above, so it
    // needs its own history hook — fires once per gesture, on release.
    this.canvas.on('object:modified', () => this.captureHistory());

    this.captureHistory(); // seed history with the empty canvas so undo can return to it
  }

  ngOnDestroy(): void {
    this.canvas?.dispose();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const isUndoRedoKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z';
    if (!isUndoRedoKey) return;

    // Let Fabric's own text editing handle Ctrl/Cmd+Z while a Textbox is
    // being edited (it manages its own contenteditable-like undo via the
    // browser) rather than jumping to a whole-canvas snapshot mid-edit.
    const active = this.canvas?.getActiveObject();
    if (active instanceof Textbox && active.isEditing) return;

    event.preventDefault();
    if (event.shiftKey) {
      this.redo();
    } else {
      this.undo();
    }
  }

  selectTool(tool: ShapeTool): void {
    if (!this.canvas) return;

    if (tool === 'text') {
      const text = new Textbox('Nhập chữ...', {
        left: 60,
        top: 60,
        originX: 'left',
        originY: 'top',
        fill: this.strokeColor(),
        fontSize: 20,
        fontFamily: 'Inter, sans-serif',
      });
      this.canvas.add(text);
      this.canvas.setActiveObject(text);
      this.canvas.requestRenderAll();
      tool = 'select';
      this.captureHistory();
    }

    this.activeTool.set(tool);
    this.applySelectableForTool(tool);
  }

  private applySelectableForTool(tool: ShapeTool): void {
    if (!this.canvas) return;
    this.canvas.selection = tool === 'select';
    this.canvas.forEachObject((obj) => (obj.selectable = tool === 'select'));
  }

  setColor(color: string): void {
    this.strokeColor.set(color);
    const active = this.canvas?.getActiveObject();
    if (!active || !this.canvas) return;
    if (active instanceof Textbox) {
      active.set('fill', color);
    } else {
      active.set('stroke', color);
    }
    this.canvas.requestRenderAll();
  }

  // Swatch buttons are one discrete click each — commit history immediately.
  chooseSwatch(color: string): void {
    this.setColor(color);
    this.captureHistory();
  }

  // The native color picker's `input` event fires continuously while the
  // user drags inside it, so pushing history on every tick here would flood
  // the stack with dozens of near-identical entries — only live-preview the
  // color, and commit a single history entry once the picker closes/commits
  // (its `change` event, see onColorCommitted).
  onColorPicked(event: Event): void {
    this.setColor((event.target as HTMLInputElement).value);
  }

  onColorCommitted(): void {
    this.captureHistory();
  }

  triggerColorPicker(): void {
    this.colorPickerInput().nativeElement.click();
  }

  private onMouseDown(e: MouseEvent | TouchEvent | PointerEvent): void {
    const tool = this.activeTool();
    if (!this.canvas || tool === 'select' || tool === 'text') return;

    const pointer = this.canvas.getScenePoint(e);
    this.startPoint = { x: pointer.x, y: pointer.y };

    if (tool === 'crop') {
      if (this.cropRect) {
        this.canvas.remove(this.cropRect);
      }
      this.cropRect = new Rect({
        left: pointer.x,
        top: pointer.y,
        originX: 'left',
        originY: 'top',
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: 'rgba(57, 211, 83, 0.9)',
        strokeWidth: 2,
        strokeDashArray: [8, 6],
        selectable: false,
      });
      this.canvas.add(this.cropRect);
      this.drawingShape = null;
      return;
    }

    const common = {
      left: pointer.x,
      top: pointer.y,
      originX: 'left' as const,
      originY: 'top' as const,
      stroke: this.strokeColor(),
      strokeWidth: 3,
      fill: 'transparent',
      selectable: false,
    };

    if (tool === 'rectangle') {
      this.drawingShape = new Rect({ ...common, width: 0, height: 0 });
    } else if (tool === 'ellipse') {
      this.drawingShape = new Ellipse({ ...common, rx: 0, ry: 0 });
    } else if (tool === 'line' || tool === 'arrow') {
      this.drawingShape = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: this.strokeColor(),
        strokeWidth: 3,
        selectable: false,
      });
    }
    if (this.drawingShape) this.canvas.add(this.drawingShape);
  }

  private onMouseMove(e: MouseEvent | TouchEvent | PointerEvent): void {
    if (!this.canvas || !this.startPoint) return;
    const pointer = this.canvas.getScenePoint(e);
    const start = this.startPoint;

    if (this.activeTool() === 'crop' && this.cropRect) {
      this.cropRect.set({
        width: Math.abs(pointer.x - start.x),
        height: Math.abs(pointer.y - start.y),
        left: Math.min(pointer.x, start.x),
        top: Math.min(pointer.y, start.y),
      });
      this.canvas.requestRenderAll();
      return;
    }

    if (!this.drawingShape) return;

    if (this.drawingShape instanceof Rect) {
      this.drawingShape.set({
        width: Math.abs(pointer.x - start.x),
        height: Math.abs(pointer.y - start.y),
        left: Math.min(pointer.x, start.x),
        top: Math.min(pointer.y, start.y),
      });
    } else if (this.drawingShape instanceof Ellipse) {
      this.drawingShape.set({
        rx: Math.abs(pointer.x - start.x) / 2,
        ry: Math.abs(pointer.y - start.y) / 2,
        left: Math.min(pointer.x, start.x),
        top: Math.min(pointer.y, start.y),
      });
    } else if (this.drawingShape instanceof Line) {
      this.drawingShape.set({ x2: pointer.x, y2: pointer.y });
    }
    this.canvas.requestRenderAll();
  }

  private onMouseUp(): void {
    if (this.activeTool() === 'crop' && this.cropRect) {
      this.cropRect.set({ selectable: true });
      this.hasCrop.set(true);
      // Switching to 'select' also flips every object's `selectable` flag
      // on (see selectTool), which is what lets the user drag/resize the
      // crop rect's handles right after drawing it. Making it the active
      // object immediately shows those handles without an extra click, so
      // it's obvious right away that it can be adjusted.
      this.selectTool('select');
      this.canvas?.setActiveObject(this.cropRect);
      this.canvas?.requestRenderAll();
      // No captureHistory() here — the crop rect is a transient draft
      // excluded from every snapshot (see the field comment above); only
      // applyCrop() actually changes canvas content.
    } else if (this.activeTool() === 'arrow' && this.drawingShape instanceof Line) {
      this.finalizeArrow(this.drawingShape);
    } else if (this.drawingShape) {
      this.captureHistory();
    }
    this.drawingShape = null;
    this.startPoint = null;
  }

  // Fabric has no built-in arrow shape — the accepted recipe is a Line plus
  // a Triangle rotated to match the line's angle, grouped into one object.
  private finalizeArrow(line: Line): void {
    if (!this.canvas) return;
    const { x1, y1, x2, y2 } = line;
    const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI) + 90;
    const arrowHead = new Triangle({
      left: x2,
      top: y2,
      originX: 'center',
      originY: 'center',
      width: 14,
      height: 16,
      fill: this.strokeColor(),
      angle,
    });

    this.canvas.remove(line);
    const group = new Group(
      [new Line([x1, y1, x2, y2], { stroke: this.strokeColor(), strokeWidth: 3 }), arrowHead],
      { selectable: false },
    );
    this.canvas.add(group);
    this.canvas.requestRenderAll();
    this.captureHistory();
  }

  deleteSelected(): void {
    if (!this.canvas) return;
    let deletedContent = false;
    for (const obj of this.canvas.getActiveObjects()) {
      if (obj === this.cropRect) {
        this.cropRect = null;
        this.hasCrop.set(false);
      } else {
        deletedContent = true;
      }
      this.canvas.remove(obj);
    }
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    if (deletedContent) this.captureHistory();
  }

  clearCrop(): void {
    if (!this.canvas || !this.cropRect) return;
    this.canvas.remove(this.cropRect);
    this.cropRect = null;
    this.hasCrop.set(false);
    this.canvas.requestRenderAll();
  }

  // Actually commits the crop: shrinks the canvas itself to the selection
  // and shifts every remaining object so it lines up with the new (0,0).
  // Explicit and immediate (rather than only affecting the final export) so
  // it's unambiguous when the crop has taken effect.
  applyCrop(): void {
    if (!this.canvas || !this.cropRect) return;

    const box = {
      left: this.cropRect.left,
      top: this.cropRect.top,
      width: Math.max(Math.round(this.cropRect.width * (this.cropRect.scaleX ?? 1)), 1),
      height: Math.max(Math.round(this.cropRect.height * (this.cropRect.scaleY ?? 1)), 1),
    };

    this.canvas.remove(this.cropRect);
    this.cropRect = null;
    this.hasCrop.set(false);

    for (const obj of this.canvas.getObjects()) {
      obj.set({ left: (obj.left ?? 0) - box.left, top: (obj.top ?? 0) - box.top });
      obj.setCoords();
    }

    this.canvasWidth = box.width;
    this.canvasHeight = box.height;
    this.canvas.setDimensions({ width: this.canvasWidth, height: this.canvasHeight });
    this.canvas.requestRenderAll();
    this.selectTool('select');
    this.captureHistory();
  }

  clearCanvas(): void {
    if (!this.canvas) return;
    this.canvas.clear();
    this.cropRect = null;
    this.hasCrop.set(false);
    this.canvas.requestRenderAll();
    this.captureHistory();
  }

  // ===================== Undo / Redo =====================

  private captureHistory(): void {
    if (!this.canvas || this.isRestoringHistory) return;

    // Exclude the crop-selection draft from the snapshot (see the
    // historyStack field comment) — same detach/serialize/reattach dance
    // insertIntoContent() already uses for the exported PNG.
    const crop = this.cropRect;
    if (crop) this.canvas.remove(crop);
    const snapshot: HistorySnapshot = {
      json: this.canvas.toJSON(),
      width: this.canvasWidth,
      height: this.canvasHeight,
    };
    if (crop) this.canvas.add(crop);

    this.historyStack.splice(this.historyIndex + 1); // drop any redo branch
    this.historyStack.push(snapshot);
    if (this.historyStack.length > MAX_HISTORY) {
      this.historyStack.shift();
    }
    this.historyIndex = this.historyStack.length - 1;
    this.refreshHistoryFlags();
  }

  private refreshHistoryFlags(): void {
    this.canUndo.set(this.historyIndex > 0);
    this.canRedo.set(this.historyIndex < this.historyStack.length - 1);
  }

  undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.restoreHistory(this.historyStack[this.historyIndex]);
  }

  redo(): void {
    if (this.historyIndex >= this.historyStack.length - 1) return;
    this.historyIndex++;
    this.restoreHistory(this.historyStack[this.historyIndex]);
  }

  private restoreHistory(snapshot: HistorySnapshot): void {
    if (!this.canvas) return;
    this.isRestoringHistory = true;

    // Undo/redo never restores a mid-draw crop draft (see field comment) —
    // always clear it so `hasCrop`/the Apply/Discard-crop buttons don't
    // point at a rect that no longer exists post-restore.
    this.cropRect = null;
    this.hasCrop.set(false);

    this.canvasWidth = snapshot.width;
    this.canvasHeight = snapshot.height;
    this.canvas.setDimensions({ width: snapshot.width, height: snapshot.height });

    this.canvas.loadFromJSON(snapshot.json).then(() => {
      if (!this.canvas) return;
      this.applySelectableForTool(this.activeTool());
      this.canvas.requestRenderAll();
      this.isRestoringHistory = false;
      this.refreshHistoryFlags();
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }

  async insertIntoContent(): Promise<void> {
    if (!this.canvas) return;
    const contentObjects = this.canvas.getObjects().filter((obj) => obj !== this.cropRect);
    if (contentObjects.length === 0) {
      await this.dialogService.alert(
        this.translate.instant('shapeDrawing.noShapeTitle'),
        this.translate.instant('shapeDrawing.noShapeMessage'),
      );
      return;
    }

    this.isUploading.set(true);

    // A crop selection that was drawn but never applied (see applyCrop) is
    // just a marker at this point — insert exports the full canvas as-is.
    if (this.cropRect) this.canvas.remove(this.cropRect);
    const dataUrl = this.canvas.toDataURL({
      format: 'png',
      multiplier: 1,
      left: 0,
      top: 0,
      width: this.canvasWidth,
      height: this.canvasHeight,
    });
    if (this.cropRect) this.canvas.add(this.cropRect);

    this.messageService.uploadImage(dataUrl).subscribe({
      next: async (res) => {
        this.isUploading.set(false);
        if (res.success && res.data?.url) {
          this.insert.emit(`${environment.serverBaseUrl}${res.data.url}`);
        } else {
          await this.dialogService.alert(
            this.translate.instant('common.error'),
            res.error || this.translate.instant('shapeDrawing.uploadError'),
          );
        }
      },
      error: async () => {
        this.isUploading.set(false);
        await this.dialogService.alert(
          this.translate.instant('common.error'),
          this.translate.instant('shapeDrawing.genericServerError'),
        );
      },
    });
  }
}
