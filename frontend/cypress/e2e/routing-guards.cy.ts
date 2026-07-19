describe('Route guards', () => {
  it('redirects unauthenticated visits to /admin/* to /login', () => {
    cy.visit('/admin/dashboard');
    cy.location('pathname').should('eq', '/login');
  });

  it('redirects unauthenticated visits to /staff to /login', () => {
    cy.visit('/staff');
    cy.location('pathname').should('eq', '/login');
  });

  it('redirects a staff session hitting /admin/* back to /login', () => {
    cy.visit('/admin/dashboard', {
      onBeforeLoad(win) {
        win.localStorage.setItem('access_token', 'fake-access');
        win.localStorage.setItem('refresh_token', 'fake-refresh');
        win.localStorage.setItem(
          'user_session',
          JSON.stringify({ id: 11, name: 'Tăng Thanh Quang', role: 'staff' }),
        );
      },
    });
    cy.location('pathname').should('eq', '/login');
  });

  it('redirects an admin session hitting /staff back to /login', () => {
    cy.visit('/staff', {
      onBeforeLoad(win) {
        win.localStorage.setItem('access_token', 'fake-access');
        win.localStorage.setItem('refresh_token', 'fake-refresh');
        win.localStorage.setItem('user_session', JSON.stringify({ id: 1, name: 'HR Admin', role: 'admin' }));
      },
    });
    cy.location('pathname').should('eq', '/login');
  });

  it('redirects an admin session hitting / to /admin/dashboard', () => {
    cy.intercept('GET', '**/api/employees', { fixture: 'employees.json' });
    cy.intercept('GET', '**/api/logs', { fixture: 'logs.json' });
    cy.loginAsAdmin('/admin');
    cy.location('pathname').should('eq', '/admin/dashboard');
  });

  it('redirects an unknown path to /not-found', () => {
    cy.visit('/this-route-does-not-exist');
    cy.location('pathname').should('eq', '/not-found');
    cy.contains('404 ERROR').should('be.visible');
  });
});
