const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Admin employee list', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/employees', { fixture: 'employees.json' }).as('getEmployees');
    cy.loginAsAdmin('/admin/employees');
    cy.wait('@getEmployees');
  });

  it('renders both seeded employees', () => {
    cy.get('.employees-table tbody tr').should('have.length', 2);
    cy.contains('.employees-table', 'HR Admin').should('be.visible');
    cy.contains('.employees-table', 'Tăng Thanh Quang').should('be.visible');
  });

  it('filters the table by the search box', () => {
    cy.get('#emp-search-input').type('Quang');
    cy.get('.employees-table tbody tr').should('have.length', 1);
    cy.contains('.employees-table', 'Tăng Thanh Quang').should('be.visible');
  });

  describe('registration modal', () => {
    beforeEach(() => {
      cy.contains('button', 'ĐĂNG KÝ NHÂN VIÊN MỚI').click();
    });

    it('flags an already-taken username and accepts an available one', () => {
      cy.intercept('GET', '**/api/employees/check-username*username=admin*', {
        statusCode: 200,
        body: { success: true, exists: true },
      }).as('checkTaken');
      cy.intercept('GET', '**/api/employees/check-username*username=newperson*', {
        statusCode: 200,
        body: { success: true, exists: false },
      }).as('checkAvailable');

      cy.get('#new-emp-username').type('admin');
      cy.wait('@checkTaken');
      cy.contains('Username đã tồn tại.').should('be.visible');

      cy.get('#new-emp-username').clear().type('newperson');
      cy.wait('@checkAvailable');
      cy.contains('Username hợp lệ.').should('be.visible');
    });

    it('flags a password that fails the complexity rule', () => {
      cy.get('#new-emp-password').type('weak');
      cy.contains('Tối thiểu 8 ký tự').should('be.visible');
      cy.get('#new-emp-password').clear().type('StrongPass1!');
      cy.contains('Tối thiểu 8 ký tự').should('not.exist');
    });

    it('submits the registration form with the parsed skills/projects payload', () => {
      cy.intercept('GET', '**/api/employees/check-username*', {
        statusCode: 200,
        body: { success: true, exists: false },
      });
      cy.intercept('POST', '**/api/employees', (req) => {
        expect(req.body).to.include({ name: 'Người Mới', username: 'nguoimoi' });
        expect(req.body.skills).to.deep.equal([
          { skill_name: 'Angular', description: 'Thành thạo core' },
        ]);
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('createEmployee');

      cy.get('#new-emp-name').type('Người Mới');
      cy.get('#new-emp-username').type('nguoimoi');
      cy.wait(500); // let the username async validator settle before continuing
      cy.get('#new-emp-password').type('StrongPass1!');
      cy.get('#new-emp-skills').type('Angular: Thành thạo core');

      cy.get('input[type=file]').selectFile(
        {
          contents: Cypress.Buffer.from(TINY_PNG_BASE64, 'base64'),
          fileName: 'avatar.png',
          mimeType: 'image/png',
        },
        { force: true },
      );

      cy.contains('button', 'ĐĂNG KÝ HỒ SƠ').should('not.be.disabled').click();
      cy.wait('@createEmployee');
    });
  });

  it('confirms before deleting an employee', () => {
    cy.intercept('DELETE', '**/api/employees/11', { statusCode: 200, body: { success: true } }).as(
      'deleteEmployee',
    );

    cy.contains('.employees-table tr', 'Tăng Thanh Quang').find('.delete-btn').click();
    cy.contains('.hud-dialog-card', 'XÁC NHẬN XÓA NHÂN SỰ').should('be.visible');
    cy.get('.hud-btn-confirm').click();

    cy.wait('@deleteEmployee');
  });
});
