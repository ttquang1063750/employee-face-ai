import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { UploadDocumentPage } from './upload-document-page';

describe('UploadDocumentPage', () => {
  let component: UploadDocumentPage;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(UploadDocumentPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    // Intentionally do NOT call fixture.detectChanges() — that would fire
    // ngOnInit's HTTP call, which these tests don't need.
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('upload form visibility/employeeId validator toggle', () => {
    it('requires employeeId when visibility is "rieng" (the default)', () => {
      expect(component.uploadForm.controls.employeeId.hasError('required')).toBe(true);
    });

    it('clears the employeeId requirement and value when visibility switches to "chung"', () => {
      component.uploadForm.controls.employeeId.setValue(11);
      component.uploadForm.controls.visibility.setValue('chung');

      expect(component.uploadForm.controls.employeeId.value).toBeNull();
      expect(component.uploadForm.controls.employeeId.valid).toBe(true);
    });

    it('re-requires employeeId when visibility switches back to "rieng"', () => {
      component.uploadForm.controls.visibility.setValue('chung');
      component.uploadForm.controls.visibility.setValue('rieng');

      expect(component.uploadForm.controls.employeeId.hasError('required')).toBe(true);
    });
  });

  describe('sourceType/externalUrl validator toggle', () => {
    it('externalUrl is not required by default (sourceType "file")', () => {
      expect(component.uploadForm.controls.externalUrl.hasError('required')).toBe(false);
    });

    it('requires externalUrl and validates its scheme when sourceType switches to "link"', () => {
      component.uploadForm.controls.sourceType.setValue('link');
      expect(component.uploadForm.controls.externalUrl.hasError('required')).toBe(true);

      component.uploadForm.controls.externalUrl.setValue('javascript:alert(1)');
      expect(component.uploadForm.controls.externalUrl.hasError('pattern')).toBe(true);

      component.uploadForm.controls.externalUrl.setValue('https://example.com/video.mp4');
      expect(component.uploadForm.controls.externalUrl.valid).toBe(true);
    });

    it('clears externalUrl and its requirement when switching back to "file"', () => {
      component.uploadForm.controls.sourceType.setValue('link');
      component.uploadForm.controls.externalUrl.setValue('https://example.com');
      component.uploadForm.controls.sourceType.setValue('file');

      expect(component.uploadForm.controls.externalUrl.value).toBe('');
      expect(component.uploadForm.controls.externalUrl.hasError('required')).toBe(false);
    });
  });

  describe('submitUpload', () => {
    it('posts a FormData body with the picked File for a file-source document', async () => {
      const file = new File(['fake video bytes'], 'clip.mp4', { type: 'video/mp4' });
      const fakeEvent = { target: { files: [file] } } as unknown as Event;
      await component.onFileSelected(fakeEvent);

      component.uploadForm.setValue({
        title: 'Video huong dan',
        visibility: 'chung',
        employeeId: null,
        sourceType: 'file',
        externalUrl: '',
      });

      component.submitUpload();

      const req = httpMock.expectOne((r) => r.url.endsWith('/documents') && r.method === 'POST');
      expect(req.request.body instanceof FormData).toBe(true);
      const body = req.request.body as FormData;
      expect(body.get('title')).toBe('Video huong dan');
      expect(body.get('visibility')).toBe('chung');
      expect(body.get('source_type')).toBe('file');
      expect(body.get('file')).toBe(file);

      req.flush({ success: true, id: 5 });
    });

    it('posts external_url (not a file) for a link-source document', () => {
      component.uploadForm.setValue({
        title: 'Video ngoai',
        visibility: 'chung',
        employeeId: null,
        sourceType: 'link',
        externalUrl: 'https://example.com/video.mp4',
      });

      component.submitUpload();

      const req = httpMock.expectOne((r) => r.url.endsWith('/documents') && r.method === 'POST');
      const body = req.request.body as FormData;
      expect(body.get('source_type')).toBe('link');
      expect(body.get('external_url')).toBe('https://example.com/video.mp4');
      expect(body.get('file')).toBeNull();

      req.flush({ success: true, id: 6 });
    });
  });
});
