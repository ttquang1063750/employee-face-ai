describe('Internal messages', () => {
  it('composing a message shows it in "Đã gửi", and the recipient gets an unread badge that clears after reading', () => {
    // ── Admin composes a message to Staff (id 11) ──────────────────
    cy.intercept('GET', '**/api/employees/directory', { fixture: 'employees-directory.json' }).as(
      'getDirectory',
    );
    cy.intercept('GET', '**/api/message-templates', { statusCode: 200, body: { success: true, data: [] } }).as(
      'getTemplates',
    );
    cy.loginAsAdmin('/admin/messages/new');
    cy.wait(['@getDirectory', '@getTemplates']);

    cy.get('#compose-recipient').type('Quang');
    cy.contains('.hud-autocomplete-item', 'Tăng Thanh Quang').click();
    cy.get('#compose-subject').type('Báo cáo công việc ngày 20/07/2026');
    // The content field is a Tiptap rich text editor — #compose-content is
    // on its wrapper (for the <label for>), the actual contenteditable
    // surface is the .ProseMirror element inside it.
    cy.get('#compose-content .ProseMirror').type('Đã hoàn thành các task được giao trong ngày.');

    cy.intercept('POST', '**/api/messages', (req) => {
      expect(req.body).to.deep.equal({
        recipient_id: 11,
        category: 'daily_report',
        subject: 'Báo cáo công việc ngày 20/07/2026',
        content: '<p>Đã hoàn thành các task được giao trong ngày.</p>',
      });
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('sendMessage');
    cy.intercept('GET', '**/api/messages/received', {
      statusCode: 200,
      body: { success: true, data: [] },
    }).as('getReceivedAdmin');
    cy.intercept('GET', '**/api/messages/sent', {
      statusCode: 200,
      body: {
        success: true,
        data: [
          {
            id: 50,
            recipient_id: 11,
            recipient_name: 'Tăng Thanh Quang',
            category: 'daily_report',
            subject: 'Báo cáo công việc ngày 20/07/2026',
            content: 'Đã hoàn thành các task được giao trong ngày.',
            is_read: false,
            created_at: '2026-07-20T08:00:00',
          },
        ],
      },
    }).as('getSentAdmin');

    cy.contains('button', 'GỬI TIN NHẮN').click();
    cy.wait(['@sendMessage', '@getSentAdmin']);

    cy.url().should('match', /\/admin\/messages$/);
    cy.contains('button', 'ĐÃ GỬI').click();
    cy.contains('.logs-table', 'Tăng Thanh Quang').should('be.visible');
    cy.contains('.logs-table', 'Báo cáo công việc ngày 20/07/2026').should('be.visible');

    // ── Staff logs in and sees the unread badge ────────────────────
    cy.intercept('GET', '**/api/messages/received', {
      statusCode: 200,
      body: {
        success: true,
        data: [
          {
            id: 50,
            sender_id: 1,
            sender_name: 'HR Admin',
            category: 'daily_report',
            subject: 'Báo cáo công việc ngày 20/07/2026',
            content: 'Đã hoàn thành các task được giao trong ngày.',
            is_read: false,
            created_at: '2026-07-20T08:00:00',
          },
        ],
      },
    }).as('getReceivedStaff');
    cy.intercept('GET', '**/api/messages/sent', {
      statusCode: 200,
      body: { success: true, data: [] },
    }).as('getSentStaff');
    cy.loginAsStaff('/staff/messages');
    cy.wait(['@getReceivedStaff', '@getSentStaff']);

    cy.contains('a', 'Tin nhắn').find('.pending-badge').should('contain', '1');
    cy.contains('.logs-table tr', 'Báo cáo công việc ngày 20/07/2026')
      .find('.unread-dot')
      .should('exist');

    // ── Opening the message marks it read, which clears the badge ──
    cy.intercept('GET', '**/api/messages/50', {
      statusCode: 200,
      body: {
        success: true,
        data: {
          id: 50,
          sender_id: 1,
          sender_name: 'HR Admin',
          recipient_id: 11,
          recipient_name: 'Tăng Thanh Quang',
          category: 'daily_report',
          subject: 'Báo cáo công việc ngày 20/07/2026',
          content: 'Đã hoàn thành các task được giao trong ngày.',
          is_read: false,
          created_at: '2026-07-20T08:00:00',
        },
      },
    }).as('getMessageDetail');
    cy.intercept('PUT', '**/api/messages/50/read', {
      statusCode: 200,
      body: { success: true },
    }).as('markRead');

    cy.contains('.logs-table tr', 'Báo cáo công việc ngày 20/07/2026').click();
    cy.wait(['@getMessageDetail', '@markRead']);
    cy.contains('.message-subject', 'Báo cáo công việc ngày 20/07/2026').should('be.visible');
    cy.contains('.message-content', 'Đã hoàn thành các task được giao trong ngày.').should(
      'be.visible',
    );

    cy.intercept('GET', '**/api/messages/received', {
      statusCode: 200,
      body: {
        success: true,
        data: [
          {
            id: 50,
            sender_id: 1,
            sender_name: 'HR Admin',
            category: 'daily_report',
            subject: 'Báo cáo công việc ngày 20/07/2026',
            content: 'Đã hoàn thành các task được giao trong ngày.',
            is_read: true,
            created_at: '2026-07-20T08:00:00',
          },
        ],
      },
    }).as('getReceivedStaffAfterRead');

    cy.contains('button', 'QUAY LẠI').click();
    cy.wait('@getReceivedStaffAfterRead');

    cy.contains('a', 'Tin nhắn').find('.pending-badge').should('not.exist');
    cy.contains('.logs-table tr', 'Báo cáo công việc ngày 20/07/2026')
      .find('.unread-dot')
      .should('not.exist');
  });
});
