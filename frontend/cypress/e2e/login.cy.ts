describe('Login', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/employees', { fixture: 'employees.json' }).as('getEmployees');
    cy.intercept('GET', '**/api/logs', { fixture: 'logs.json' }).as('getLogs');
  });

  it('redirects an admin to /admin/dashboard on valid credentials', () => {
    cy.intercept('POST', '**/api/login', {
      statusCode: 200,
      body: {
        success: true,
        tokens: {
          access_token: 'fake-access',
          refresh_token: 'fake-refresh',
          access_expires_at: '2099-01-01T00:00:00',
          refresh_expires_at: '2099-01-01T00:00:00',
        },
        user: { id: 1, name: 'HR Admin', role: 'admin' },
      },
    }).as('login');

    cy.visit('/login');
    cy.get('#emp-username').type('admin');
    cy.get('#emp-password').type('admin');
    cy.get('button[type=submit]').click();

    cy.wait('@login');
    cy.location('pathname').should('eq', '/admin/dashboard');
  });

  it('redirects a staff member to /staff on valid credentials', () => {
    cy.intercept('POST', '**/api/login', {
      statusCode: 200,
      body: {
        success: true,
        tokens: {
          access_token: 'fake-access',
          refresh_token: 'fake-refresh',
          access_expires_at: '2099-01-01T00:00:00',
          refresh_expires_at: '2099-01-01T00:00:00',
        },
        user: { id: 11, name: 'Tăng Thanh Quang', role: 'staff' },
      },
    }).as('login');
    cy.intercept('GET', '**/api/employees/11', { fixture: 'employee-detail-staff.json' });
    cy.intercept('GET', '**/api/employees/11/leave-requests', { fixture: 'leave-requests.json' });

    cy.visit('/login');
    cy.get('#emp-username').type('quang.tt');
    cy.get('#emp-password').type('Password123!');
    cy.get('button[type=submit]').click();

    cy.wait('@login');
    cy.location('pathname').should('eq', '/staff');
  });

  it('shows an inline error on invalid credentials and stays on /login', () => {
    cy.intercept('POST', '**/api/login', {
      statusCode: 401,
      body: { success: false, error: 'Username hoặc mật khẩu không đúng.' },
    }).as('login');

    cy.visit('/login');
    cy.get('#emp-username').type('admin');
    cy.get('#emp-password').type('wrong-password');
    cy.get('button[type=submit]').click();

    cy.wait('@login');
    cy.contains('Username hoặc mật khẩu không đúng.').should('be.visible');
    cy.location('pathname').should('eq', '/login');
  });

  it('shows a validation message when submitting with empty fields', () => {
    cy.visit('/login');
    cy.get('button[type=submit]').click();
    cy.contains('Vui lòng nhập đầy đủ Username và Mật khẩu.').should('be.visible');
  });

  it('redirects an already-authenticated admin straight to /admin/dashboard', () => {
    cy.loginAsAdmin('/login');
    cy.location('pathname').should('eq', '/admin/dashboard');
  });
});
