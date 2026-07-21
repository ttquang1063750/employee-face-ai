import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DocumentsComponent } from './documents';
import { EmployeeDocument } from '../../../core/models/document.model';

function makeDoc(overrides: Partial<EmployeeDocument>): EmployeeDocument {
  return {
    id: 1,
    employee_id: 11,
    employee_name: 'Tăng Thanh Quang',
    title: 'Bảng lương Tháng 7',
    file_name: 'bang-luong-t7.pdf',
    source_type: 'file',
    external_url: null,
    visibility: 'rieng',
    uploaded_at: '2026-07-15T08:00:00',
    ...overrides,
  };
}

describe('DocumentsComponent', () => {
  let component: DocumentsComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(DocumentsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    // Intentionally do NOT call fixture.detectChanges() — that would fire
    // ngOnInit's HTTP calls, which these tests don't need since the computed
    // signals under test only depend on the public signals set directly below.
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('filteredDocuments', () => {
    beforeEach(() => {
      component.documents.set([
        makeDoc({
          id: 1,
          title: 'Bảng lương Tháng 7',
          employee_name: 'Tăng Thanh Quang',
          visibility: 'rieng',
        }),
        makeDoc({
          id: 2,
          title: 'Thông báo nghỉ lễ',
          employee_id: null,
          employee_name: null,
          visibility: 'chung',
        }),
        makeDoc({
          id: 3,
          title: 'Hợp đồng lao động',
          employee_name: 'HR Admin',
          visibility: 'rieng',
        }),
      ]);
    });

    it('returns every document when no filter is applied', () => {
      expect(component.filteredDocuments()).toHaveLength(3);
    });

    it('filters by visibility', () => {
      component.visibilityFilterControl.setValue('chung');
      const ids = component.filteredDocuments().map((d) => d.id);
      expect(ids).toEqual([2]);
    });

    it('filters by title, case-insensitively', () => {
      component.searchQuery.setValue('bảng lương');
      const ids = component.filteredDocuments().map((d) => d.id);
      expect(ids).toEqual([1]);
    });

    it('filters by employee name', () => {
      component.searchQuery.setValue('hr admin');
      const ids = component.filteredDocuments().map((d) => d.id);
      expect(ids).toEqual([3]);
    });

    it('combines the visibility and search filters', () => {
      component.visibilityFilterControl.setValue('rieng');
      component.searchQuery.setValue('hợp đồng');
      const ids = component.filteredDocuments().map((d) => d.id);
      expect(ids).toEqual([3]);
    });
  });

  describe('pagination', () => {
    beforeEach(() => {
      component.documents.set(Array.from({ length: 20 }, (_, i) => makeDoc({ id: i + 1 })));
      component.pageSizeControl.setValue(8);
    });

    it('computes total pages from the page size', () => {
      expect(component.totalPages()).toBe(3);
    });

    it('slices the current page from filteredDocuments', () => {
      component.currentPage.set(2);
      const page2 = component.paginatedDocuments();
      expect(page2).toHaveLength(8);
      expect(page2[0].id).toBe(9);
    });

    it('clamps to the last page when currentPage overshoots after a filter narrows the results', () => {
      component.currentPage.set(3);
      component.searchQuery.setValue('nonexistent-title');
      expect(component.filteredDocuments()).toHaveLength(0);
      expect(component.totalPages()).toBe(1);
      expect(component.paginatedDocuments()).toHaveLength(0);
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
  });

  describe('loadDocuments', () => {
    it('loads documents then clears the loading state', () => {
      component.loadDocuments();

      httpMock
        .expectOne((req) => req.url.endsWith('/documents') && req.method === 'GET')
        .flush({ success: true, data: [makeDoc({ id: 1 })] });

      expect(component.isLoading()).toBe(false);
      expect(component.errorMsg()).toBeNull();
      expect(component.documents()).toHaveLength(1);
    });

    it('sets an error message when the request fails', () => {
      component.loadDocuments();

      httpMock
        .expectOne((req) => req.url.endsWith('/documents') && req.method === 'GET')
        .flush({ success: false }, { status: 500, statusText: 'Server Error' });

      expect(component.isLoading()).toBe(false);
      expect(component.errorMsg()).toBe('Lỗi kết nối máy chủ API.');
    });
  });
});
