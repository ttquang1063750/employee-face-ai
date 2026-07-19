import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DashboardComponent } from './dashboard';
import { AttendanceLogEntry } from '../../../core/models/attendance-log.model';

function makeLog(overrides: Partial<AttendanceLogEntry>): AttendanceLogEntry {
  return {
    id: 1,
    employee_id: 1,
    employee_name: 'Alice',
    timestamp: '2026-01-05 08:15:00',
    action: 'CHECK_IN',
    mood: 'happy',
    captured_image_path: '',
    ...overrides,
  };
}

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    // Intentionally do NOT call fixture.detectChanges() here — that would
    // fire ngOnInit (HTTP calls + a 3s polling interval) which these tests
    // don't need; the computed signals under test only depend on the
    // public signals set directly below.
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('filteredLogs', () => {
    beforeEach(() => {
      component.logs.set([
        makeLog({ id: 1, employee_name: 'Alice', timestamp: '2026-01-05 08:00:00' }),
        makeLog({ id: 2, employee_name: 'Alice', timestamp: '2026-01-10 17:00:00' }),
        makeLog({ id: 3, employee_name: 'Bob', timestamp: '2026-01-20 09:00:00' }),
      ]);
    });

    it('returns every log when no date range is applied', () => {
      expect(component.filteredLogs()).toHaveLength(3);
    });

    it('filters out logs outside the applied date range', () => {
      component.filterStartDate.set('2026-01-01');
      component.filterEndDate.set('2026-01-10');

      const ids = component.filteredLogs().map((l) => l.id);
      expect(ids).toEqual([1, 2]);
    });

    it('filters by employee name, case-insensitively', () => {
      component.nameControl.setValue('bob');

      const ids = component.filteredLogs().map((l) => l.id);
      expect(ids).toEqual([3]);
    });

    it('combines the date range and name filters', () => {
      component.filterStartDate.set('2026-01-01');
      component.filterEndDate.set('2026-01-10');
      component.nameControl.setValue('bob');

      expect(component.filteredLogs()).toHaveLength(0);
    });

    it('does not react to the draft *Input controls before ÁP DỤNG is applied', () => {
      component.filterStartDateInput.setValue('2026-01-01');
      component.filterEndDateInput.setValue('2026-01-01');

      expect(component.filteredLogs()).toHaveLength(3);
    });
  });

  describe('moodStats / hasMoodData', () => {
    it('returns all zeros with no logs', () => {
      component.logs.set([]);
      expect(component.moodStats()).toEqual({ happy: 0, neutral: 0, sad: 0, stressed: 0 });
      expect(component.hasMoodData()).toBe(false);
    });

    it('buckets moods into percentages, with unmatched moods falling into stressed', () => {
      component.logs.set([
        makeLog({ id: 1, mood: 'happy' }),
        makeLog({ id: 2, mood: 'neutral' }),
        makeLog({ id: 3, mood: 'sad' }),
        makeLog({ id: 4, mood: 'angry' }), // no bucket matches -> falls into "stressed"
      ]);

      expect(component.moodStats()).toEqual({ happy: 25, neutral: 25, sad: 25, stressed: 25 });
      expect(component.hasMoodData()).toBe(true);
    });

    it('matches Vietnamese mood substrings too', () => {
      component.logs.set([makeLog({ id: 1, mood: 'Vui vẻ' }), makeLog({ id: 2, mood: 'Buồn bã' })]);

      expect(component.moodStats()).toEqual({ happy: 50, neutral: 0, sad: 50, stressed: 0 });
    });
  });

  describe('happinessLevel / happinessStatusLabel', () => {
    it('is "none" when there is no mood data', () => {
      component.logs.set([]);
      expect(component.happinessLevel()).toBe('none');
      expect(component.happinessStatusLabel()).toBe('Chưa có dữ liệu');
    });

    it('is "success" at or above 60% happy', () => {
      component.logs.set([
        makeLog({ id: 1, mood: 'happy' }),
        makeLog({ id: 2, mood: 'happy' }),
        makeLog({ id: 3, mood: 'happy' }),
        makeLog({ id: 4, mood: 'sad' }),
      ]);
      expect(component.happinessLevel()).toBe('success');
      expect(component.happinessStatusLabel()).toBe('Đạt mục tiêu');
    });

    it('is "warning" between 20% and 60% happy', () => {
      component.logs.set([
        makeLog({ id: 1, mood: 'happy' }),
        makeLog({ id: 2, mood: 'sad' }),
        makeLog({ id: 3, mood: 'sad' }),
      ]);
      expect(component.happinessLevel()).toBe('warning');
      expect(component.happinessStatusLabel()).toBe('Thấp');
    });

    it('is "danger" below 20% happy', () => {
      component.logs.set([makeLog({ id: 1, mood: 'sad' }), makeLog({ id: 2, mood: 'sad' })]);
      expect(component.happinessLevel()).toBe('danger');
      expect(component.happinessStatusLabel()).toBe('Rất thấp');
    });
  });

  describe('moodDonut', () => {
    it('produces cumulative offsets in segment order', () => {
      component.logs.set([
        makeLog({ id: 1, mood: 'happy' }),
        makeLog({ id: 2, mood: 'neutral' }),
        makeLog({ id: 3, mood: 'sad' }),
        makeLog({ id: 4, mood: 'angry' }),
      ]);

      const offsets = component.moodDonut().map((seg) => seg.offset);
      // The first offset is `-0` (negating the initial accumulator of 0) —
      // a real, correct JS value here, not a bug in the component.
      expect(offsets).toEqual([-0, -25, -50, -75]);
    });
  });

  describe('hourlyTimeline / hasHourlyData', () => {
    it('buckets logs by hour of day within the 8h-18h window', () => {
      component.logs.set([
        makeLog({ id: 1, timestamp: '2026-01-05 08:10:00' }),
        makeLog({ id: 2, timestamp: '2026-01-05 08:45:00' }),
        makeLog({ id: 3, timestamp: '2026-01-05 14:00:00' }),
      ]);

      const points = component.hourlyTimeline().points;
      expect(points.find((p) => p.hour === '8h')?.count).toBe(2);
      expect(points.find((p) => p.hour === '14h')?.count).toBe(1);
      expect(points.find((p) => p.hour === '9h')?.count).toBe(0);
      expect(component.hasHourlyData()).toBe(true);
    });

    it('ignores hours outside the 8h-18h window', () => {
      component.logs.set([makeLog({ id: 1, timestamp: '2026-01-05 20:00:00' })]);

      expect(component.hasHourlyData()).toBe(false);
    });

    it('reports no data when there are no logs', () => {
      component.logs.set([]);
      expect(component.hasHourlyData()).toBe(false);
    });
  });

  describe('pagination', () => {
    beforeEach(() => {
      component.logs.set(Array.from({ length: 20 }, (_, i) => makeLog({ id: i + 1 })));
      component.pageSize.set(8);
    });

    it('computes total pages from the page size', () => {
      expect(component.totalPages()).toBe(3);
    });

    it('slices the current page from filteredLogs', () => {
      component.currentPage.set(2);
      const page2 = component.paginatedLogs();
      expect(page2).toHaveLength(8);
      expect(page2[0].id).toBe(9);
    });

    it('clamps to the last page when currentPage overshoots after a filter narrows the results', () => {
      component.currentPage.set(3);
      component.nameControl.setValue('nonexistent-name');
      expect(component.filteredLogs()).toHaveLength(0);
      expect(component.totalPages()).toBe(1);
      expect(component.paginatedLogs()).toHaveLength(0);
    });

    it('nextPage/prevPage stop at the boundaries', () => {
      component.currentPage.set(1);
      component.prevPage();
      expect(component.currentPage()).toBe(1);

      component.currentPage.set(3);
      component.nextPage();
      expect(component.currentPage()).toBe(3);

      component.currentPage.set(1);
      component.nextPage();
      expect(component.currentPage()).toBe(2);
    });

    it('onPageSizeChange updates the page size and resets to page 1', () => {
      component.currentPage.set(3);
      component.onPageSizeChange(16);
      expect(component.pageSize()).toBe(16);
      expect(component.currentPage()).toBe(1);
    });
  });

  describe('employeeSuggestions', () => {
    beforeEach(() => {
      component.logs.set([
        makeLog({ id: 1, employee_name: 'Bob' }),
        makeLog({ id: 2, employee_name: 'Alice' }),
        makeLog({ id: 3, employee_name: 'Alice' }),
      ]);
    });

    it('returns unique, sorted names when there is no query', () => {
      expect(component.employeeSuggestions()).toEqual(['Alice', 'Bob']);
    });

    it('filters case-insensitively by the current query', () => {
      component.nameControl.setValue('bo');
      expect(component.employeeSuggestions()).toEqual(['Bob']);
    });
  });

  describe('filter/search actions', () => {
    it('applyDateFilter copies the draft inputs into the applied signals and resets to page 1', () => {
      component.currentPage.set(3);
      component.filterStartDateInput.setValue('2026-02-01');
      component.filterEndDateInput.setValue('2026-02-28');

      component.applyDateFilter();

      expect(component.filterStartDate()).toBe('2026-02-01');
      expect(component.filterEndDate()).toBe('2026-02-28');
      expect(component.currentPage()).toBe(1);
    });

    it('selectSuggestion sets the name filter, closes the dropdown, and resets to page 1', () => {
      component.currentPage.set(2);
      component.showSuggestions.set(true);

      component.selectSuggestion('Alice');

      expect(component.filterEmployeeName()).toBe('Alice');
      expect(component.showSuggestions()).toBe(false);
      expect(component.currentPage()).toBe(1);
    });

    it('typing into nameControl opens the dropdown and resets to page 1', () => {
      component.currentPage.set(2);

      component.nameControl.setValue('ali');

      expect(component.filterEmployeeName()).toBe('ali');
      expect(component.showSuggestions()).toBe(true);
      expect(component.currentPage()).toBe(1);
    });
  });

  describe('loadDashboardData', () => {
    it('loads employees and logs, then clears the loading state', () => {
      component.loadDashboardData();

      httpMock
        .expectOne('http://localhost:8000/api/employees')
        .flush({ success: true, data: [{ id: 1, name: 'Alice', age: 30, image_path: '', role: 'staff', current_position: '' }] });
      httpMock.expectOne('http://localhost:8000/api/logs').flush({ success: true, data: [] });

      expect(component.isLoading()).toBe(false);
      expect(component.errorMsg()).toBeNull();
      expect(component.employees()).toHaveLength(1);
    });

    it('sets an error message when the employees request fails', () => {
      component.loadDashboardData();

      httpMock.expectOne('http://localhost:8000/api/employees').flush(
        { success: false },
        { status: 500, statusText: 'Server Error' },
      );

      expect(component.isLoading()).toBe(false);
      expect(component.errorMsg()).toBe('Không thể kết nối đến máy chủ API.');
    });
  });
});
