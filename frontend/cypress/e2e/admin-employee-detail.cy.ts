describe('Admin employee detail', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/employees/1', { fixture: 'employee-detail-admin.json' }).as(
      'getDetail',
    );
    cy.loginAsAdmin('/admin/employees/1');
    cy.wait('@getDetail');
  });

  it('renders the profile header and attendance summary', () => {
    cy.contains('.profile-header-card', 'HR Admin').should('be.visible');
    cy.contains('.profile-header-card', 'HR Director').should('be.visible');
    cy.get('.monthly-table tbody tr').should('have.length', 2);
  });

  describe('base profile modal', () => {
    beforeEach(() => {
      // Must be registered before the modal opens — ngOnInit attaches the
      // async validator and reset()s the form in the same tick the modal is
      // created, so the request fires immediately on click.
      cy.intercept('GET', '**/api/employees/check-username*', {
        statusCode: 200,
        body: { success: true, exists: false },
      }).as('checkUsername');
      cy.contains('button', 'SỬA THÔNG TIN BẢN THÂN').click();
    });

    it('re-validates the existing username as available (excluding itself)', () => {
      cy.wait('@checkUsername');
      cy.contains('Username hợp lệ.').should('be.visible');
    });

    it('saves the updated name/age', () => {
      cy.wait('@checkUsername');
      cy.intercept('PUT', '**/api/employees/1', (req) => {
        expect(req.body).to.include({ name: 'HR Admin Updated', age: 40 });
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('saveProfile');

      cy.get('#edit-emp-name').clear().type('HR Admin Updated');
      cy.get('#edit-emp-age').clear().type('40');
      cy.contains('button', 'LƯU THAY ĐỔI').should('not.be.disabled').click();

      cy.wait('@saveProfile');
    });
  });

  it('adds a new skill through the skills panel', () => {
    cy.intercept('PUT', '**/api/employees/1/skills', (req) => {
      expect(req.body).to.deep.include({ skill_name: 'Docker', description: 'Container hóa dịch vụ' });
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('saveSkills');

    cy.get('[data-tooltip="CẬP NHẬT KỸ NĂNG"]').click();
    cy.get('#new-skill-name').type('Docker');
    cy.get('#new-skill-desc').type('Container hóa dịch vụ');
    cy.contains('button', 'THÊM VÀO DANH SÁCH').click();
    cy.contains('.editor-badge-item', 'Docker').should('be.visible');

    cy.contains('button', 'LƯU HỒ SƠ KỸ NĂNG').click();
    cy.wait('@saveSkills');
  });

  it('adds a new project through the projects panel', () => {
    cy.intercept('PUT', '**/api/employees/1/projects', { statusCode: 200, body: { success: true } }).as(
      'saveProjects',
    );

    cy.get('[data-tooltip="QUẢN LÝ DỰ ÁN"]').click();
    cy.get('#new-proj-name').type('Internal HR Bot');
    cy.get('#new-proj-role').type('Sponsor');
    cy.contains('button', 'THÊM DỰ ÁN VÀO DANH SÁCH').click();
    cy.contains('.editor-project-card', 'Internal HR Bot').should('be.visible');

    cy.contains('button', 'LƯU LỊCH SỬ DỰ ÁN').click();
    cy.wait('@saveProjects');
  });

  it('records a new compensation adjustment', () => {
    cy.intercept('POST', '**/api/employees/1/income', (req) => {
      expect(req.body.amount).to.eq(8000);
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('saveIncome');

    cy.get('[data-tooltip="ĐIỀU CHỈNH LƯƠNG"]').click();
    cy.get('#new-inc-amount').clear().type('8000');
    cy.get('#new-inc-reason').type('Annual Review');
    cy.contains('button', 'CẬP NHẬT LƯƠNG').should('not.be.disabled').click();

    cy.wait('@saveIncome');
  });

  it('records a new position appointment', () => {
    cy.intercept('POST', '**/api/employees/1/positions', (req) => {
      expect(req.body.title).to.eq('VP of People');
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('savePosition');

    cy.get('[data-tooltip="BỔ NHIỆM"]').click();
    cy.get('#new-pos-title').type('VP of People');
    cy.contains('button', 'GHI NHẬN BỔ NHIỆM').should('not.be.disabled').click();

    cy.wait('@savePosition');
  });
});
