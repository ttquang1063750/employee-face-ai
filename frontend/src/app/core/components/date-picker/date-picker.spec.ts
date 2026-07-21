import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DatePickerComponent } from './date-picker';
import { StaticTranslateLoader } from '../../i18n/translate-loader';

describe('DatePickerComponent', () => {
  let component: DatePickerComponent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ loader: StaticTranslateLoader, lang: 'vi', fallbackLang: 'vi' }),
      ],
    });
    const fixture = TestBed.createComponent(DatePickerComponent);
    component = fixture.componentInstance;
  });

  describe('calendarWeeks', () => {
    beforeEach(() => {
      // January 2026: 1st is a Thursday, so the grid needs 3 leading
      // December days and 8 trailing February days to fill 6 full weeks.
      component.viewYear.set(2026);
      component.viewMonth.set(0);
    });

    it('always produces exactly 6 weeks of 7 days (42 cells)', () => {
      const weeks = component.calendarWeeks();
      expect(weeks).toHaveLength(6);
      weeks.forEach((week) => expect(week).toHaveLength(7));
    });

    it('leads with the trailing days of the previous month', () => {
      const firstWeek = component.calendarWeeks()[0];
      expect(firstWeek[0]).toMatchObject({ day: 29, iso: '2025-12-29', inCurrentMonth: false });
      expect(firstWeek[1]).toMatchObject({ day: 30, iso: '2025-12-30', inCurrentMonth: false });
      expect(firstWeek[2]).toMatchObject({ day: 31, iso: '2025-12-31', inCurrentMonth: false });
      expect(firstWeek[3]).toMatchObject({ day: 1, iso: '2026-01-01', inCurrentMonth: true });
    });

    it('trails with the leading days of the next month', () => {
      const weeks = component.calendarWeeks();
      const lastWeek = weeks[weeks.length - 1];
      expect(lastWeek.every((cell) => !cell.inCurrentMonth)).toBe(true);
      expect(lastWeek[lastWeek.length - 1]).toMatchObject({ day: 8, iso: '2026-02-08' });
    });

    it('includes every day of the current month exactly once', () => {
      const allDays = component
        .calendarWeeks()
        .flat()
        .filter((cell) => cell.inCurrentMonth);
      expect(allDays).toHaveLength(31);
      expect(allDays.map((c) => c.iso)).toContain('2026-01-15');
    });
  });

  describe('prevMonth / nextMonth', () => {
    it('rolls over from January to December of the previous year', () => {
      component.viewYear.set(2026);
      component.viewMonth.set(0);

      component.prevMonth();

      expect(component.viewMonth()).toBe(11);
      expect(component.viewYear()).toBe(2025);
    });

    it('rolls over from December to January of the next year', () => {
      component.viewYear.set(2025);
      component.viewMonth.set(11);

      component.nextMonth();

      expect(component.viewMonth()).toBe(0);
      expect(component.viewYear()).toBe(2026);
    });

    it('does not roll the year over for a mid-year month change', () => {
      component.viewYear.set(2026);
      component.viewMonth.set(5);

      component.nextMonth();
      expect(component.viewMonth()).toBe(6);
      expect(component.viewYear()).toBe(2026);

      component.prevMonth();
      component.prevMonth();
      expect(component.viewMonth()).toBe(4);
      expect(component.viewYear()).toBe(2026);
    });
  });

  describe('month/year FormControl bridge (feeds app-hud-select)', () => {
    it('setting monthControl jumps directly to that month without touching the year', () => {
      component.viewYear.set(2026);
      component.viewMonth.set(0);

      component.monthControl.setValue(6);

      expect(component.viewMonth()).toBe(6);
      expect(component.viewYear()).toBe(2026);
    });

    it('setting yearControl jumps directly to that year without touching the month, in one step', () => {
      component.viewYear.set(2026);
      component.viewMonth.set(4);

      component.yearControl.setValue(1986);

      expect(component.viewYear()).toBe(1986);
      expect(component.viewMonth()).toBe(4);
    });
  });

  describe('ControlValueAccessor', () => {
    it('writeValue sets the value and navigates the calendar to that month', () => {
      component.writeValue('2026-03-15');

      expect(component.value()).toBe('2026-03-15');
      expect(component.viewYear()).toBe(2026);
      expect(component.viewMonth()).toBe(2);
      expect(component.displayValue()).toBe('15/03/2026');
    });

    it('writeValue with an empty string clears the value', () => {
      component.writeValue('2026-03-15');
      component.writeValue('');

      expect(component.value()).toBe('');
      expect(component.displayValue()).toBe('');
    });

    it('selectDay updates the value and notifies the registered onChange callback', () => {
      const onChange = vi.fn();
      component.registerOnChange(onChange);
      component.viewYear.set(2026);
      component.viewMonth.set(0);

      const targetCell = component
        .calendarWeeks()
        .flat()
        .find((cell) => cell.iso === '2026-01-15')!;
      component.selectDay(targetCell);

      expect(component.value()).toBe('2026-01-15');
      expect(onChange).toHaveBeenCalledWith('2026-01-15');
      expect(component.isOpen()).toBe(false);
    });

    it('clear() resets the value and notifies onChange with an empty string', () => {
      const onChange = vi.fn();
      component.registerOnChange(onChange);
      component.writeValue('2026-03-15');

      component.clear();

      expect(component.value()).toBe('');
      expect(onChange).toHaveBeenCalledWith('');
    });

    it('setDisabledState toggles the disabled signal', () => {
      component.setDisabledState(true);
      expect(component.disabled()).toBe(true);

      component.setDisabledState(false);
      expect(component.disabled()).toBe(false);
    });
  });

  describe('cell flags', () => {
    it('marks the selected cell matching the current value', () => {
      component.viewYear.set(2026);
      component.viewMonth.set(0);
      component.writeValue('2026-01-15');

      const cell = component
        .calendarWeeks()
        .flat()
        .find((c) => c.iso === '2026-01-15')!;
      expect(cell.isSelected).toBe(true);

      const otherCell = component
        .calendarWeeks()
        .flat()
        .find((c) => c.iso === '2026-01-16')!;
      expect(otherCell.isSelected).toBe(false);
    });
  });
});
