const TINY_PDF_BASE64 = 'JVBERi0xLjQKJeLjz9MKJSVFT0Y=';

describe('Admin documents', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/documents', { fixture: 'documents.json' }).as('getDocuments');
    // The list page itself no longer fetches employees (that moved to the
    // upload page, see the nested describe below) — only registered here so
    // it's ready before the 'upload page' tests navigate there.
    cy.intercept('GET', '**/api/employees', { fixture: 'employees.json' }).as('getEmployees');
    cy.loginAsAdmin('/admin/documents');
    cy.wait('@getDocuments');
  });

  it('renders every seeded document', () => {
    cy.get('.logs-table tbody tr').should('have.length', 2);
    cy.contains('.logs-table', 'Bảng lương Tháng 7/2026').should('be.visible');
    cy.contains('.logs-table', 'Thông báo nghỉ lễ Quốc khánh').should('be.visible');
    cy.contains('.logs-table', 'Toàn bộ nhân viên').should('be.visible');
  });

  it('filters by visibility', () => {
    cy.selectHudOption('#doc-visibility-filter', 'Chung (Toàn bộ nhân viên)');
    cy.get('.logs-table tbody tr').should('have.length', 1);
    cy.contains('.logs-table', 'Thông báo nghỉ lễ Quốc khánh').should('be.visible');
  });

  it('live-filters by title/employee search', () => {
    cy.get('#doc-search-input').type('Quang');
    cy.get('.logs-table tbody tr').should('have.length', 1);
    cy.contains('.logs-table', 'Bảng lương Tháng 7/2026').should('be.visible');
  });

  it('downloads a document', () => {
    cy.intercept('GET', '**/api/documents/1/download', {
      statusCode: 200,
      headers: { 'content-type': 'application/pdf' },
      body: 'fake-pdf-bytes',
    }).as('download');

    cy.contains('.logs-table tr', 'Bảng lương Tháng 7/2026')
      .find('button[data-tooltip="Tải xuống"]')
      .click();
    cy.wait('@download');
  });

  it('confirms before deleting a document', () => {
    cy.intercept('DELETE', '**/api/documents/1', { statusCode: 200, body: { success: true } }).as(
      'deleteDoc',
    );

    cy.contains('.logs-table tr', 'Bảng lương Tháng 7/2026')
      .find('button[data-tooltip="Xóa tài liệu"]')
      .click();
    cy.contains('.hud-dialog-card', 'XÁC NHẬN XÓA TÀI LIỆU').should('be.visible');
    cy.get('.hud-btn-confirm').click();

    cy.wait('@deleteDoc');
  });

  describe('upload page', () => {
    beforeEach(() => {
      cy.contains('a', 'TẢI LÊN TÀI LIỆU MỚI').click();
      cy.url().should('include', '/admin/documents/new');
      cy.wait('@getEmployees');
    });

    it('requires an employee when visibility is "Riêng" (the default), and clears that requirement for "Chung"', () => {
      cy.get('#doc-title').type('Hợp đồng lao động mới');
      cy.get('input[type=file]').selectFile(
        {
          contents: Cypress.Buffer.from(TINY_PDF_BASE64, 'base64'),
          fileName: 'hop-dong.pdf',
          mimeType: 'application/pdf',
        },
        { force: true },
      );
      cy.contains('button', 'TẢI LÊN').should('be.disabled');

      cy.get('#doc-employee').type('HR Admin');
      cy.contains('.hud-autocomplete-item', 'HR Admin').click();
      cy.contains('button', 'TẢI LÊN').should('not.be.disabled');

      cy.selectHudOption('#doc-visibility', 'Chung (toàn bộ nhân viên nhận được)');
      cy.get('#doc-employee').should('not.exist');
      cy.contains('button', 'TẢI LÊN').should('not.be.disabled');
    });

    it('submits a "rieng" document with the selected employee', () => {
      // Body is real multipart/form-data now (streamed, not JSON) — Cypress
      // doesn't parse multipart bodies into an object, so assert on the raw
      // text instead of req.body's shape.
      cy.intercept('POST', '**/api/documents', (req) => {
        expect(req.body).to.include('name="title"').and.include('Hợp đồng lao động mới');
        expect(req.body).to.include('name="visibility"').and.include('rieng');
        expect(req.body).to.include('name="employee_id"').and.include('1');
        expect(req.body).to.include('name="source_type"').and.include('file');
        expect(req.body).to.include('filename="hop-dong.pdf"');
        req.reply({ statusCode: 200, body: { success: true, id: 3 } });
      }).as('uploadDoc');
      cy.intercept('GET', '**/api/documents', { fixture: 'documents.json' }).as('reload');

      cy.get('#doc-title').type('Hợp đồng lao động mới');
      cy.get('#doc-employee').type('HR Admin');
      cy.contains('.hud-autocomplete-item', 'HR Admin').click();
      cy.get('input[type=file]').selectFile(
        {
          contents: Cypress.Buffer.from(TINY_PDF_BASE64, 'base64'),
          fileName: 'hop-dong.pdf',
          mimeType: 'application/pdf',
        },
        { force: true },
      );
      cy.contains('button', 'TẢI LÊN').click();

      cy.wait('@uploadDoc');
      cy.contains('.hud-dialog-card', 'THÀNH CÔNG').should('be.visible');
      cy.get('.hud-btn-confirm').click();
      cy.url().should('include', '/admin/documents');
      cy.url().should('not.include', '/new');
    });

    it('submits a "chung" document without an employee_id field', () => {
      cy.intercept('POST', '**/api/documents', (req) => {
        expect(req.body).to.include('name="title"').and.include('Thông báo chung mới');
        expect(req.body).to.include('name="visibility"').and.include('chung');
        expect(req.body).not.to.include('name="employee_id"');
        req.reply({ statusCode: 200, body: { success: true, id: 4 } });
      }).as('uploadBroadcast');
      cy.intercept('GET', '**/api/documents', { fixture: 'documents.json' }).as('reload');

      cy.get('#doc-title').type('Thông báo chung mới');
      cy.selectHudOption('#doc-visibility', 'Chung (toàn bộ nhân viên nhận được)');
      cy.get('input[type=file]').selectFile(
        {
          contents: Cypress.Buffer.from(TINY_PDF_BASE64, 'base64'),
          fileName: 'thong-bao.pdf',
          mimeType: 'application/pdf',
        },
        { force: true },
      );
      cy.contains('button', 'TẢI LÊN').click();

      cy.wait('@uploadBroadcast');
    });

    it('submits a "link" source document with an external_url, not a file', () => {
      cy.intercept('POST', '**/api/documents', (req) => {
        expect(req.body).to.include('name="source_type"').and.include('link');
        expect(req.body)
          .to.include('name="external_url"')
          .and.include('https://example.com/video.mp4');
        expect(req.body).not.to.include('name="file"');
        req.reply({ statusCode: 200, body: { success: true, id: 5 } });
      }).as('uploadLink');
      cy.intercept('GET', '**/api/documents', { fixture: 'documents.json' }).as('reload');

      cy.get('#doc-title').type('Video huong dan onboarding');
      cy.selectHudOption('#doc-visibility', 'Chung (toàn bộ nhân viên nhận được)');
      cy.selectHudOption('#doc-source-type', 'Liên kết ngoài');
      cy.get('#doc-external-url').type('https://example.com/video.mp4');
      cy.contains('button', 'TẢI LÊN').should('not.be.disabled').click();

      cy.wait('@uploadLink');
    });

    it('rejects a non-http(s) external link before submitting', () => {
      cy.selectHudOption('#doc-source-type', 'Liên kết ngoài');
      cy.get('#doc-external-url').type('javascript:alert(1)');
      cy.contains('button', 'TẢI LÊN').should('be.disabled');
    });

    it('HỦY navigates back to the documents list without submitting', () => {
      cy.get('#doc-title').type('Sẽ không được lưu');
      cy.contains('button', 'HỦY').click();

      cy.url().should('include', '/admin/documents');
      cy.url().should('not.include', '/new');
    });
  });

  describe('opening a link-source document from the list', () => {
    it('opens the external URL in a new tab, bypassing the download endpoint', () => {
      cy.window().then((win) => cy.stub(win, 'open').as('windowOpen'));

      cy.contains('.logs-table tr', 'Thông báo nghỉ lễ Quốc khánh')
        .find('button[data-tooltip="Mở liên kết"]')
        .click();

      cy.get('@windowOpen').should(
        'have.been.calledWith',
        'https://example.com/video-huong-dan.mp4',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });
});
