import { Component, ElementRef, HostListener, input, viewChild, AfterViewInit, OnDestroy, ChangeDetectionStrategy, forwardRef, signal, computed, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { fromEvent, merge, Subscription } from 'rxjs';

export interface HudSelectOption<T> {
  value: T;
  label: string;
}

// Custom dropdown standing in for a native <select> — the native popup is
// OS/browser-painted and CSS can't restyle it (see the `.hud-select`
// history in styles/hud-form/_inputs.scss), so a fully "đẹp" themed list
// needs its own markup, mirroring `.hud-autocomplete`'s panel look and
// `DatePickerComponent`'s CVA + fixed-position-panel pattern.
@Component({
  selector: 'app-hud-select',
  standalone: true,
  imports: [],
  templateUrl: './hud-select.html',
  styleUrl: './hud-select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => HudSelectComponent),
    multi: true
  }]
})
export class HudSelectComponent<T = string> implements ControlValueAccessor, AfterViewInit, OnDestroy {
  options = input<HudSelectOption<T>[]>([]);
  placeholder = input<string>('-- Chọn --');
  selectId = input<string>('');

  private elementRef = inject(ElementRef);

  // The panel is moved to <body> in ngAfterViewInit (see below) rather than
  // conditionally rendered in place, so it stays permanently outside this
  // component's own DOM subtree — needed because a `position: fixed` panel
  // is only positioned relative to the viewport as long as NO ancestor sets
  // `transform`/`filter`/`backdrop-filter`/`perspective`/`will-change`; any
  // of those establishes a new containing block instead (CSS spec), which
  // silently breaks the panel's coordinates. Several modal cards and
  // `.action-card` in this app use `backdrop-filter`, so this isn't a
  // theoretical edge case. `[hidden]` (not `@if`) toggles visibility so
  // Angular never tries to attach/detach a node we've relocated ourselves.
  panelRef = viewChild.required<ElementRef<HTMLUListElement>>('panelRef');

  value = signal<T | null>(null);
  isOpen = signal<boolean>(false);
  disabled = signal<boolean>(false);

  panelTop = signal<number>(0);
  panelLeft = signal<number>(0);
  panelWidth = signal<number>(0);
  private scrollOrResizeSub: Subscription | null = null;

  selectedLabel = computed(() => {
    const current = this.value();
    return this.options().find((opt) => opt.value === current)?.label ?? null;
  });

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- overwritten by registerOnChange/registerOnTouched
  private onChange: (value: T) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- overwritten by registerOnChange/registerOnTouched
  private onTouched: () => void = () => {};

  writeValue(value: T): void {
    this.value.set(value ?? null);
  }

  registerOnChange(fn: (value: T) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  ngAfterViewInit(): void {
    document.body.appendChild(this.panelRef().nativeElement);
  }

  toggleOpen(): void {
    if (this.disabled()) return;
    if (this.isOpen()) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  private openPanel(): void {
    const trigger = this.elementRef.nativeElement.querySelector('.hud-select-trigger') as HTMLElement;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      this.panelTop.set(rect.bottom + 6);
      this.panelLeft.set(rect.left);
      this.panelWidth.set(rect.width);
    }
    this.isOpen.set(true);
    // Scroll (of any ancestor, capture phase) or resize invalidates the
    // computed position, so just close rather than tracking it live.
    this.scrollOrResizeSub = merge(
      fromEvent(window, 'scroll', { capture: true }),
      fromEvent(window, 'resize'),
    ).subscribe(() => this.closePanel());
  }

  private closePanel(): void {
    this.isOpen.set(false);
    this.onTouched();
    this.scrollOrResizeSub?.unsubscribe();
    this.scrollOrResizeSub = null;
  }

  selectOption(option: HudSelectOption<T>): void {
    this.value.set(option.value);
    this.onChange(option.value);
    this.closePanel();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    // The panel lives under <body>, not under this.elementRef, since it was
    // relocated there — both containers must be checked for "was this click
    // actually outside the control".
    const insideHost = this.elementRef.nativeElement.contains(target);
    const insidePanel = this.panelRef().nativeElement.contains(target);
    if (!insideHost && !insidePanel) {
      this.closePanel();
    }
  }

  ngOnDestroy(): void {
    this.scrollOrResizeSub?.unsubscribe();
    this.panelRef()?.nativeElement.remove();
  }
}
