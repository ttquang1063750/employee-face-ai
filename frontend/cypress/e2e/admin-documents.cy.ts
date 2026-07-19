const TINY_PDF_BASE64 = 'JVBERi0xLjQKJeLjz9MKJSVFT0Y=';

describe('Admin documents', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/documents', { fixture: 'documents.json' }).as('getDocuments');
    cy.intercept('GET', '**/api/employees', { fixture: 'employees.json' }).as('getEmployees');
    cy.loginAsAdmin('/admin/documents');
    cy.wait(['@getDocuments', '@getEmployees']);
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

  describe('upload modal', () => {
    beforeEach(() => {
      cy.contains('button', 'TẢI LÊN TÀI LIỆU MỚI').click();
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
      cy.get('.modal-footer').contains('button', 'TẢI LÊN').should('be.disabled');

      cy.selectHudOption('#doc-employee', 'HR Admin (#1)');
      cy.get('.modal-footer').contains('button', 'TẢI LÊN').should('not.be.disabled');

      cy.selectHudOption('#doc-visibility', 'Chung (toàn bộ nhân viên nhận được)');
      cy.get('#doc-employee').should('not.exist');
      cy.get('.modal-footer').contains('button', 'TẢI LÊN').should('not.be.disabled');
    });

    it('submits a "rieng" document with the selected employee', () => {
      cy.intercept('POST', '**/api/documents', (req) => {
        expect(req.body).to.include({
          title: 'Hợp đồng lao động mới',
          visibility: 'rieng',
          employee_id: 1,
          file_name: 'hop-dong.pdf',
        });
        req.reply({ statusCode: 200, body: { success: true, id: 3 } });
      }).as('uploadDoc');
      cy.intercept('GET', '**/api/documents', { fixture: 'documents.json' }).as('reload');

      cy.get('#doc-title').type('Hợp đồng lao động mới');
      cy.selectHudOption('#doc-employee', 'HR Admin (#1)');
      cy.get('input[type=file]').selectFile(
        {
          contents: Cypress.Buffer.from(TINY_PDF_BASE64, 'base64'),
          fileName: 'hop-dong.pdf',
          mimeType: 'application/pdf',
        },
        { force: true },
      );
      cy.get('.modal-footer').contains('button', 'TẢI LÊN').click();

      cy.wait('@uploadDoc');
    });

    it('submits a "chung" document with a null employee_id', () => {
      cy.intercept('POST', '**/api/documents', (req) => {
        expect(req.body).to.include({ title: 'Thông báo chung mới', visibility: 'chung' });
        expect(req.body.employee_id).to.be.null;
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
      cy.get('.modal-footer').contains('button', 'TẢI LÊN').click();

      cy.wait('@uploadBroadcast');
    });
  });
});
