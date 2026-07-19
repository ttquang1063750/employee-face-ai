describe('Admin dashboard', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/employees', { fixture: 'employees.json' }).as('getEmployees');
    cy.intercept('GET', '**/api/logs', { fixture: 'logs.json' }).as('getLogs');
    cy.loginAsAdmin('/admin/dashboard');
    cy.wait(['@getEmployees', '@getLogs']);
  });

  it('renders the stat widgets from the intercepted data', () => {
    cy.contains('TỔNG NHÂN SỰ').parent().contains('2');
    cy.contains('LƯỢT CHẤM CÔNG').parent().contains('4');
  });

  it('renders every seeded log row in the table', () => {
    cy.get('.logs-table tbody tr').should('have.length', 4);
    cy.contains('.logs-table', 'Tăng Thanh Quang').should('be.visible');
    cy.contains('.logs-table', 'HR Admin').should('be.visible');
  });

  it('navigates to the employee detail page when a log row name is clicked', () => {
    cy.intercept('GET', '**/api/employees/11', { fixture: 'employee-detail-staff.json' }).as(
      'getDetail',
    );
    cy.contains('.logs-table .log-name-link', 'Tăng Thanh Quang').click();
    cy.url().should('include', '/admin/employees/11');
    cy.wait('@getDetail');
  });

  it('does not refilter until ÁP DỤNG is clicked, and clicking it does not error', () => {
    cy.get('.logs-table tbody tr').should('have.length', 4);

    cy.contains('.hud-field', 'TỪ NGÀY').find('.date-trigger').click();
    cy.contains('button', 'Hôm nay').click();
    // Draft value changed but the table must still show every row — the
    // applied filter only updates once ÁP DỤNG is clicked (rule 10).
    cy.get('.logs-table tbody tr').should('have.length', 4);

    cy.contains('button', 'ÁP DỤNG').click();
    cy.get('.logs-table-wrapper').should('be.visible');
  });

  it('live-filters the logs table via the employee-name autocomplete', () => {
    cy.get('#dashboard-employee-search').type('Quang');
    cy.get('.hud-autocomplete-list').contains('Tăng Thanh Quang').click();

    cy.get('#dashboard-employee-search').should('have.value', 'Tăng Thanh Quang');
    cy.get('.logs-table tbody tr').should('have.length', 2);
    cy.contains('.logs-table', 'HR Admin').should('not.exist');
  });

  it('confirms before deleting a log entry', () => {
    cy.intercept('DELETE', '**/api/logs/101', { statusCode: 200, body: { success: true } }).as(
      'deleteLog',
    );
    cy.intercept('GET', '**/api/logs', { fixture: 'logs.json' }).as('getLogsAfterDelete');

    cy.get('.logs-table tbody tr')
      .first()
      .find('button[data-tooltip="Xóa lượt chấm công"]')
      .click();
    cy.contains('.hud-dialog-card', 'XÁC NHẬN XÓA').should('be.visible');
    cy.get('.hud-btn-confirm').click();

    cy.wait('@deleteLog');
  });

  it('disables the CSV export button when there is nothing to export', () => {
    cy.intercept('GET', '**/api/logs', { statusCode: 200, body: { success: true, data: [] } });
    cy.reload();
    cy.contains('button', 'XUẤT BÁO CÁO CSV').should('be.disabled');
  });
});
