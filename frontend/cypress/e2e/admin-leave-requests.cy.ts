describe('Admin leave requests', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/leave-requests', { fixture: 'leave-requests.json' }).as(
      'getLeaveRequests',
    );
    cy.loginAsAdmin('/admin/leave-requests');
    cy.wait('@getLeaveRequests');
  });

  it('defaults to showing only pending requests', () => {
    cy.get('.logs-table tbody tr').should('have.length', 1);
    cy.contains('.logs-table', 'Việc gia đình').should('be.visible');
  });

  it('switches to another status filter', () => {
    cy.selectHudOption('#leave-status-filter', 'Từ chối');
    cy.get('.logs-table tbody tr').should('have.length', 1);
    cy.contains('.logs-table', 'Nghỉ phép cá nhân').should('be.visible');
    cy.contains('.logs-table', 'Lý do từ chối: Dự án đang gấp').should('be.visible');
  });

  it('live-filters by the search box', () => {
    cy.selectHudOption('#leave-status-filter', 'Tất cả');
    cy.get('.logs-table tbody tr').should('have.length', 3);
    cy.get('#leave-search-input').type('Quang');
    cy.get('.logs-table tbody tr').should('have.length', 3);
  });

  it('approves a pending request after confirming', () => {
    cy.intercept('PUT', '**/api/leave-requests/1', (req) => {
      expect(req.body.status).to.eq('approved');
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('approve');
    cy.intercept('GET', '**/api/leave-requests', { fixture: 'leave-requests.json' }).as('reload');

    cy.contains('button', '✔ Duyệt').click();
    cy.contains('.hud-dialog-card', 'DUYỆT ĐƠN NGHỈ').should('be.visible');
    cy.get('.hud-btn-confirm').click();

    cy.wait('@approve');
  });

  it('rejects a pending request with a reason via the prompt dialog', () => {
    cy.intercept('PUT', '**/api/leave-requests/1', (req) => {
      expect(req.body).to.deep.equal({ status: 'rejected', rejection_reason: 'Chưa sắp xếp được người thay' });
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('reject');
    cy.intercept('GET', '**/api/leave-requests', { fixture: 'leave-requests.json' }).as('reload');

    cy.contains('button', '✖ Từ chối').click();
    cy.contains('.hud-dialog-card', 'TỪ CHỐI ĐƠN NGHỈ').should('be.visible');
    cy.get('.hud-dialog-card input').type('Chưa sắp xếp được người thay');
    cy.get('.hud-btn-confirm').click();

    cy.wait('@reject');
  });
});
