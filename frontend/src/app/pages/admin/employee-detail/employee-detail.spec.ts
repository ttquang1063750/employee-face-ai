import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { EmployeeDetailComponent } from './employee-detail';
import { AttendanceLog, DetailedEmployee } from '../../../core/models/employee.model';

function makeEmployee(rawLogs: AttendanceLog[]): DetailedEmployee {
  return {
    id: 1,
    name: 'Test Employee',
    age: 30,
    image_path: '',
    role: 'staff',
    current_position: 'Staff',
    positions: [],
    skills: [],
    projects: [],
    income_history: [],
    raw_logs: rawLogs,
    monthly_logs_summary: [],
  };
}

function log(action: 'CHECK_IN' | 'CHECK_OUT', timestamp: string): AttendanceLog {
  return { id: 1, action, timestamp, mood: 'neutral' };
}

describe('EmployeeDetailComponent', () => {
  let component: EmployeeDetailComponent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '1' } } } },
      ],
    });
    const fixture = TestBed.createComponent(EmployeeDetailComponent);
    component = fixture.componentInstance;
    // Not calling fixture.detectChanges() — that would fire ngOnInit (an
    // HTTP load). These tests only exercise computed signals driven by the
    // public `employee` signal, set directly below.
  });

  describe('workingHours', () => {
    it('sums paired CHECK_IN/CHECK_OUT intervals across days', () => {
      component.employee.set(
        makeEmployee([
          log('CHECK_IN', '2026-01-05T08:00:00'),
          log('CHECK_OUT', '2026-01-05T12:00:00'),
          log('CHECK_IN', '2026-01-06T09:00:00'),
          log('CHECK_OUT', '2026-01-06T17:00:00'),
        ]),
      );

      expect(component.attendance.workingHours()).toBe(12);
      expect(component.attendance.workingDays()).toBe(2);
      expect(component.attendance.hasIncompleteAttendance()).toBe(false);
    });

    it('keeps the first CHECK_IN when a duplicate CHECK_IN arrives before any CHECK_OUT', () => {
      component.employee.set(
        makeEmployee([
          log('CHECK_IN', '2026-01-05T08:00:00'),
          log('CHECK_IN', '2026-01-05T08:05:00'), // camera-retry duplicate
          log('CHECK_OUT', '2026-01-05T12:00:00'),
        ]),
      );

      // Should count from the *first* check-in (08:00), i.e. 4 hours —
      // not silently overwritten by the duplicate at 08:05.
      expect(component.attendance.workingHours()).toBe(4);
      expect(component.attendance.hasIncompleteAttendance()).toBe(false);
    });

    it('flags an unpaired trailing CHECK_IN as incomplete instead of silently dropping it', () => {
      component.employee.set(
        makeEmployee([
          log('CHECK_IN', '2026-01-05T08:00:00'),
          log('CHECK_OUT', '2026-01-05T12:00:00'),
          log('CHECK_IN', '2026-01-06T09:00:00'), // never checked out
        ]),
      );

      expect(component.attendance.workingHours()).toBe(4); // only the completed pair counts
      expect(component.attendance.hasIncompleteAttendance()).toBe(true);
    });

    it('does not count a negative interval when CHECK_OUT precedes CHECK_IN (bad/skewed data)', () => {
      component.employee.set(
        makeEmployee([
          log('CHECK_IN', '2026-01-05T12:00:00'),
          log('CHECK_OUT', '2026-01-05T08:00:00'), // earlier than the check-in
        ]),
      );

      expect(component.attendance.workingHours()).toBe(0);
    });

    it('returns 0 hours / 0 days with no logs, and no incomplete-attendance flag', () => {
      component.employee.set(makeEmployee([]));

      expect(component.attendance.workingHours()).toBe(0);
      expect(component.attendance.workingDays()).toBe(0);
      expect(component.attendance.hasIncompleteAttendance()).toBe(false);
    });
  });

  describe('filteredRawLogs / date range', () => {
    it('returns every log when no date range is applied', () => {
      component.employee.set(
        makeEmployee([
          log('CHECK_IN', '2026-01-05T08:00:00'),
          log('CHECK_IN', '2026-02-10T08:00:00'),
        ]),
      );

      expect(component.attendance.filteredRawLogs()).toHaveLength(2);
    });

    it('filters logs outside the applied date range', () => {
      component.employee.set(
        makeEmployee([
          log('CHECK_IN', '2026-01-05T08:00:00'),
          log('CHECK_IN', '2026-02-10T08:00:00'),
        ]),
      );
      component.attendance.filterStartDate.set('2026-01-01');
      component.attendance.filterEndDate.set('2026-01-31');

      expect(component.attendance.filteredRawLogs()).toHaveLength(1);
    });
  });
});
