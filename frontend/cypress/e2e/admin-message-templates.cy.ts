describe('Admin message templates', () => {
  it('creates a template that shows up in the compose page template dropdown and prefills subject/content', () => {
    cy.intercept('GET', '**/api/message-templates', {
      statusCode: 200,
      body: { success: true, data: [] },
    }).as('getTemplatesEmpty');
    cy.loginAsAdmin('/admin/message-templates');
    cy.wait('@getTemplatesEmpty');
    cy.contains('.no-data', 'Chưa có mẫu tin nhắn nào.').should('be.visible');

    cy.contains('a', 'THÊM MẪU MỚI').click();
    cy.url().should('match', /\/admin\/message-templates\/new$/);

    cy.get('#template-name').type('Mẫu test E2E');
    // The content field is a Tiptap rich text editor — #template-content is
    // on its wrapper (for the <label for>), the actual contenteditable
    // surface is the .ProseMirror element inside it.
    cy.get('#template-content .ProseMirror').type('Nội dung mẫu test E2E.');

    cy.intercept('POST', '**/api/message-templates', (req) => {
      expect(req.body).to.deep.equal({
        category: 'daily_report',
        name: 'Mẫu test E2E',
        content: '<p>Nội dung mẫu test E2E.</p>',
      });
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('createTemplate');
    cy.intercept('GET', '**/api/message-templates', {
      statusCode: 200,
      body: {
        success: true,
        data: [
          {
            id: 1,
            category: 'daily_report',
            name: 'Mẫu test E2E',
            content: '<p>Nội dung mẫu test E2E.</p>',
            created_at: '2026-07-21T08:00:00',
          },
        ],
      },
    }).as('getTemplatesAfterCreate');

    cy.contains('button', 'LƯU MẪU TIN NHẮN').click();
    cy.wait(['@createTemplate', '@getTemplatesAfterCreate']);

    cy.url().should('match', /\/admin\/message-templates$/);
    cy.contains('.logs-table', 'Mẫu test E2E').should('be.visible');

    // ── Confirm it's usable from the compose page ──────────────────
    cy.intercept('GET', '**/api/employees/directory', { fixture: 'employees-directory.json' }).as(
      'getDirectory',
    );
    cy.visit('/admin/messages/new');
    cy.wait(['@getDirectory', '@getTemplatesAfterCreate']);

    cy.selectHudOption('#compose-template', 'Mẫu test E2E');
    cy.get('#compose-subject').should('have.value', 'Mẫu test E2E');
    cy.get('#compose-content .ProseMirror').should('have.text', 'Nội dung mẫu test E2E.');
  });

  it('edits and deletes an existing template', () => {
    cy.intercept('GET', '**/api/message-templates', {
      statusCode: 200,
      body: {
        success: true,
        data: [
          {
            id: 1,
            category: 'daily_report',
            name: 'Mẫu báo cáo ngày chuẩn',
            content: 'Nội dung chuẩn.',
            created_at: '2026-07-21T08:00:00',
          },
        ],
      },
    }).as('getTemplates');
    cy.loginAsAdmin('/admin/message-templates');
    cy.wait('@getTemplates');

    cy.contains('a', 'Sửa').click();
    cy.url().should('match', /\/admin\/message-templates\/1$/);
    cy.wait('@getTemplates');
    cy.get('#template-name').should('have.value', 'Mẫu báo cáo ngày chuẩn');

    cy.get('#template-name').clear().type('Mẫu báo cáo ngày chuẩn (đã sửa)');

    cy.intercept('PUT', '**/api/message-templates/1', (req) => {
      // The content FormControl's value only ever changes via the rich text
      // editor's own onChange (real user edits) — since this test never
      // touches the content field, it's resubmitted exactly as loaded.
      expect(req.body).to.deep.equal({
        category: 'daily_report',
        name: 'Mẫu báo cáo ngày chuẩn (đã sửa)',
        content: 'Nội dung chuẩn.',
      });
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('updateTemplate');
    cy.intercept('GET', '**/api/message-templates', {
      statusCode: 200,
      body: {
        success: true,
        data: [
          {
            id: 1,
            category: 'daily_report',
            name: 'Mẫu báo cáo ngày chuẩn (đã sửa)',
            content: 'Nội dung chuẩn.',
            created_at: '2026-07-21T08:00:00',
          },
        ],
      },
    }).as('getTemplatesAfterUpdate');

    cy.contains('button', 'LƯU MẪU TIN NHẮN').click();
    cy.wait(['@updateTemplate', '@getTemplatesAfterUpdate']);
    cy.contains('.logs-table', 'Mẫu báo cáo ngày chuẩn (đã sửa)').should('be.visible');

    cy.intercept('DELETE', '**/api/message-templates/1', {
      statusCode: 200,
      body: { success: true },
    }).as('deleteTemplate');
    cy.intercept('GET', '**/api/message-templates', {
      statusCode: 200,
      body: { success: true, data: [] },
    }).as('getTemplatesAfterDelete');

    cy.contains('button', 'Xóa').click();
    cy.contains('.hud-dialog-card', 'XÓA MẪU TIN NHẮN').should('be.visible');
    cy.get('.hud-btn-confirm').click();
    cy.wait(['@deleteTemplate', '@getTemplatesAfterDelete']);

    cy.contains('.no-data', 'Chưa có mẫu tin nhắn nào.').should('be.visible');
  });
});
