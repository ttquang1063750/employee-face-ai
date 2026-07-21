import {
  Component,
  ElementRef,
  HostListener,
  input,
  OnDestroy,
  ChangeDetectionStrategy,
  forwardRef,
  signal,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, fromEvent, merge, Subscription } from 'rxjs';
import { toLocalDateString } from '../../utils/date.util';
import { HudSelectComponent, HudSelectOption } from '../hud-select/hud-select';

interface CalendarCell {
  day: number;
  iso: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'app-date-picker',
  standalone: true,
  imports: [ReactiveFormsModule, HudSelectComponent],
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatePickerComponent),
      multi: true,
    },
  ],
})
export class DatePickerComponent implements ControlValueAccessor, OnDestroy {
  placeholder = input<string>('Chọn ngày');

  private elementRef = inject(ElementRef);

  // The month/year app-hud-select panels are portaled to <body> (see
  // HudSelectComponent), so they sit outside this.elementRef's own subtree —
  // onDocumentClick below must check these too, or picking a month/year
  // closes the whole calendar instead of just that dropdown's own panel.
  private monthSelectRef = viewChild<HudSelectComponent<number>>('monthSelectRef');
  private yearSelectRef = viewChild<HudSelectComponent<number>>('yearSelectRef');

  value = signal<string>('');
  isOpen = signal<boolean>(false);
  disabled = signal<boolean>(false);
  viewYear = signal<number>(new Date().getFullYear());
  viewMonth = signal<number>(new Date().getMonth());

  // Panel is rendered position:fixed (viewport coordinates) so it can never
  // be clipped by a scrollable ancestor (e.g. a modal body with overflow-y:auto).
  panelTop = signal<number>(0);
  panelLeft = signal<number>(0);
  private scrollOrResizeSub: Subscription | null = null;

  readonly weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  // Direct month/year jump — stepping via prevMonth()/nextMonth() alone took
  // ~480 clicks to reach a 40-year-old birth date, since it's one click per
  // month. Range covers a full working lifetime back and a few years forward
  // (for things like a projected leave/position date), not just birthdates —
  // this component is shared by every date field in the app, not just date
  // of birth. Uses app-hud-select (not a native <select>) for the same
  // themed-dropdown look as the rest of the app.
  readonly monthOptions: HudSelectOption<number>[] = Array.from({ length: 12 }, (_, i) => ({
    value: i,
    label: `Th${i + 1}`,
  }));
  private readonly currentYear = new Date().getFullYear();
  readonly yearOptions: HudSelectOption<number>[] = Array.from({ length: 111 }, (_, i) => {
    const year = this.currentYear + 10 - i;
    return { value: year, label: `${year}` };
  });

  // Bridges viewMonth()/viewYear() (the signals prevMonth()/nextMonth()/
  // writeValue()/selectToday() all read and write directly, and what the
  // tests below drive) to the FormControls app-hud-select needs, mirroring
  // the input()/output()-to-FormControl bridge already used in
  // attendance-summary.ts.
  monthControl = new FormControl<number>(0, { nonNullable: true });
  yearControl = new FormControl<number>(0, { nonNullable: true });

  constructor() {
    effect(() => this.monthControl.setValue(this.viewMonth(), { emitEvent: false }));
    effect(() => this.yearControl.setValue(this.viewYear(), { emitEvent: false }));

    this.monthControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((month) => this.viewMonth.set(month));
    this.yearControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((year) => this.viewYear.set(year));
  }

  displayValue = computed(() => {
    const v = this.value();
    if (!v) return '';
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  });

  calendarWeeks = computed(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const firstOfMonth = new Date(year, month, 1);
    // getDay(): 0=Sun..6=Sat -> shift so 0=Mon..6=Sun (Vietnamese week starts Monday)
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: CalendarCell[] = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      cells.push(this.buildCell(year, month - 1, daysInPrevMonth - i, false));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(this.buildCell(year, month, d, true));
    }
    let next = 1;
    while (cells.length < 42) {
      cells.push(this.buildCell(year, month + 1, next, false));
      next++;
    }

    const weeks: CalendarCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  });

  private onChange: (value: string) => void = () => null;
  private onTouched: () => void = () => null;

  writeValue(value: string): void {
    this.value.set(value || '');
    if (value) {
      const [y, m] = value.split('-').map(Number);
      this.viewYear.set(y);
      this.viewMonth.set(m - 1);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
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
    const trigger = this.elementRef.nativeElement.querySelector('.date-trigger') as HTMLElement;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      this.panelTop.set(rect.bottom + 6);
      this.panelLeft.set(rect.left);
    }
    this.isOpen.set(true);
    // Scroll (of any ancestor, capture phase) or resize invalidates the
    // computed position, so just close rather than tracking it live — except
    // scrolling *inside* the month/year app-hud-select's own (portaled)
    // option list, which fires a real 'scroll' event here too but doesn't
    // move this panel's trigger, so it shouldn't close the whole calendar.
    this.scrollOrResizeSub = merge(
      fromEvent(window, 'scroll', { capture: true }),
      fromEvent(window, 'resize'),
    )
      .pipe(filter((event) => !this.isInsideChildSelectPanel(event.target)))
      .subscribe(() => this.closePanel());
  }

  private isInsideChildSelectPanel(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    const monthPanel = this.monthSelectRef()?.panelRef().nativeElement;
    const yearPanel = this.yearSelectRef()?.panelRef().nativeElement;
    return !!(monthPanel?.contains(target) || yearPanel?.contains(target));
  }

  private closePanel(): void {
    this.isOpen.set(false);
    this.scrollOrResizeSub?.unsubscribe();
    this.scrollOrResizeSub = null;
  }

  prevMonth(): void {
    let m = this.viewMonth() - 1;
    let y = this.viewYear();
    if (m < 0) {
      m = 11;
      y--;
    }
    this.viewMonth.set(m);
    this.viewYear.set(y);
  }

  nextMonth(): void {
    let m = this.viewMonth() + 1;
    let y = this.viewYear();
    if (m > 11) {
      m = 0;
      y++;
    }
    this.viewMonth.set(m);
    this.viewYear.set(y);
  }

  selectDay(cell: CalendarCell): void {
    this.value.set(cell.iso);
    this.onChange(cell.iso);
    this.onTouched();
    this.closePanel();
  }

  selectToday(): void {
    const today = new Date();
    const iso = toLocalDateString(today);
    this.viewYear.set(today.getFullYear());
    this.viewMonth.set(today.getMonth());
    this.value.set(iso);
    this.onChange(iso);
    this.onTouched();
    this.closePanel();
  }

  clear(): void {
    this.value.set('');
    this.onChange('');
    this.onTouched();
    this.closePanel();
  }

  private buildCell(
    year: number,
    month: number,
    day: number,
    inCurrentMonth: boolean,
  ): CalendarCell {
    const date = new Date(year, month, day);
    const iso = toLocalDateString(date);
    const today = new Date();
    const isToday =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    return { day: date.getDate(), iso, inCurrentMonth, isToday, isSelected: iso === this.value() };
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    const insideHost = this.elementRef.nativeElement.contains(target);
    if (!insideHost && !this.isInsideChildSelectPanel(target)) {
      this.closePanel();
    }
  }

  ngOnDestroy(): void {
    this.scrollOrResizeSub?.unsubscribe();
  }
}
