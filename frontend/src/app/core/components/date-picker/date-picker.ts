import { Component, ElementRef, HostListener, input, OnDestroy, ChangeDetectionStrategy, forwardRef, signal, computed, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

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
  imports: [],
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => DatePickerComponent),
    multi: true
  }]
})
export class DatePickerComponent implements ControlValueAccessor, OnDestroy {
  placeholder = input<string>('Chọn ngày');

  private elementRef = inject(ElementRef);

  value = signal<string>('');
  isOpen = signal<boolean>(false);
  disabled = signal<boolean>(false);
  viewYear = signal<number>(new Date().getFullYear());
  viewMonth = signal<number>(new Date().getMonth());

  // Panel is rendered position:fixed (viewport coordinates) so it can never
  // be clipped by a scrollable ancestor (e.g. a modal body with overflow-y:auto).
  panelTop = signal<number>(0);
  panelLeft = signal<number>(0);
  private readonly onScrollOrResize = () => this.isOpen.set(false);

  readonly weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  readonly monthLabel = computed(() => `Tháng ${this.viewMonth() + 1} / ${this.viewYear()}`);

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

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

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
    // computed position, so just close rather than tracking it live.
    window.addEventListener('scroll', this.onScrollOrResize, true);
    window.addEventListener('resize', this.onScrollOrResize);
  }

  private closePanel(): void {
    this.isOpen.set(false);
    window.removeEventListener('scroll', this.onScrollOrResize, true);
    window.removeEventListener('resize', this.onScrollOrResize);
  }

  prevMonth(): void {
    let m = this.viewMonth() - 1;
    let y = this.viewYear();
    if (m < 0) { m = 11; y--; }
    this.viewMonth.set(m);
    this.viewYear.set(y);
  }

  nextMonth(): void {
    let m = this.viewMonth() + 1;
    let y = this.viewYear();
    if (m > 11) { m = 0; y++; }
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
    const iso = this.toIso(today);
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

  private buildCell(year: number, month: number, day: number, inCurrentMonth: boolean): CalendarCell {
    const date = new Date(year, month, day);
    const iso = this.toIso(date);
    const today = new Date();
    const isToday = date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    return { day: date.getDate(), iso, inCurrentMonth, isToday, isSelected: iso === this.value() };
  }

  private toIso(date: Date): string {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isOpen() && !this.elementRef.nativeElement.contains(event.target)) {
      this.closePanel();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScrollOrResize, true);
    window.removeEventListener('resize', this.onScrollOrResize);
  }
}
