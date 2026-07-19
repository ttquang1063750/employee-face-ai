const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Staff profile', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/employees/11', { fixture: 'employee-detail-staff.json' }).as(
      'getDetail',
    );
    cy.intercept('GET', '**/api/employees/11/leave-requests', { fixture: 'leave-requests.json' }).as(
      'getLeaveRequests',
    );
    cy.intercept('GET', '**/api/employees/11/documents', { fixture: 'documents.json' }).as(
      'getDocuments',
    );
    cy.loginAsStaff('/staff');
    cy.wait(['@getDetail', '@getLeaveRequests', '@getDocuments']);
  });

  it('renders the read-only profile header and own leave requests', () => {
    cy.contains('.profile-header-card', 'Tăng Thanh Quang').should('be.visible');
    // Scoped to `.timeline-container` — the positions-history block below it
    // reuses the same `.timeline`/`.timeline-item` classes without that wrapper.
    cy.get('.timeline-container .timeline-item').should('have.length', 3);
  });

  it('renders own + broadcast documents and downloads one', () => {
    cy.intercept('GET', '**/api/documents/1/download', {
      statusCode: 200,
      headers: { 'content-type': 'application/pdf' },
      body: 'fake-pdf-bytes',
    }).as('download');

    cy.contains('.section-title', 'TÀI LIỆU CỦA TÔI')
      .parents('.lifecycle-card')
      .within(() => {
        cy.contains('Bảng lương Tháng 7/2026').should('be.visible');
        cy.contains('Thông báo nghỉ lễ Quốc khánh').should('be.visible');
        cy.contains('Toàn bộ nhân viên').should('be.visible');
        cy.contains('.comp-item', 'Bảng lương Tháng 7/2026').find('.remove-inline-btn').click();
      });

    cy.wait('@download');
  });

  describe('change password modal', () => {
    beforeEach(() => {
      cy.contains('button', 'Đổi mật khẩu').click();
    });

    it('requires the current password before saving', () => {
      cy.get('#staff-new-password').type('StrongPass1!');
      cy.get('#staff-confirm-password').type('StrongPass1!');
      cy.contains('button', 'LƯU MẬT KHẨU').click();
      cy.contains('.hud-dialog-card', 'Vui lòng nhập mật khẩu hiện tại.').should('be.visible');
    });

    it('flags a weak new password', () => {
      cy.get('#staff-new-password').type('weak');
      cy.contains('Tối thiểu 8 ký tự').should('be.visible');
    });

    it('flags a mismatched confirmation', () => {
      cy.get('#staff-new-password').type('StrongPass1!');
      cy.get('#staff-confirm-password').type('Different1!');
      cy.contains('Mật khẩu xác nhận không khớp.').should('be.visible');
    });

    it('saves a valid password change', () => {
      cy.intercept('PUT', '**/api/employees/11/password', (req) => {
        expect(req.body).to.deep.equal({ current_password: 'oldpass', new_password: 'StrongPass1!' });
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('savePassword');

      cy.get('#staff-current-password').type('oldpass');
      cy.get('#staff-new-password').type('StrongPass1!');
      cy.get('#staff-confirm-password').type('StrongPass1!');
      cy.contains('button', 'LƯU MẬT KHẨU').click();

      cy.wait('@savePassword');
    });
  });

  it('changes the avatar via file upload', () => {
    cy.intercept('PUT', '**/api/employees/11/avatar', { statusCode: 200, body: { success: true } }).as(
      'saveAvatar',
    );

    cy.contains('button', 'Đổi ảnh đại diện').click();
    cy.contains('button', 'TẢI LÊN FILE ẢNH').should('be.visible');
    cy.get('input[type=file]').selectFile(
      { contents: Cypress.Buffer.from(TINY_PNG_BASE64, 'base64'), fileName: 'avatar.png', mimeType: 'image/png' },
      { force: true },
    );
    cy.contains('button', 'LƯU ẢNH MỚI').should('not.be.disabled').click();

    cy.wait('@saveAvatar');
  });

  it('submits a new leave request', () => {
    cy.intercept('POST', '**/api/employees/11/leave-requests', (req) => {
      expect(req.body.reason).to.eq('Việc gia đình');
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('submitLeave');

    cy.contains('button', 'Xin nghỉ phép').click();
    cy.get('.modal-backdrop').contains('Xin nghỉ phép').should('be.visible');

    // Scope to the modal — the page's own attendance-summary date pickers
    // render outside it and would otherwise be matched instead. Each panel
    // is asserted closed before opening the next one, since clicking the
    // second trigger while the first panel is still closing/reopening can
    // otherwise grab a "Hôm nay" button mid-transition and detach under us.
    cy.get('.modal-backdrop .date-trigger').eq(0).click();
    cy.get('.modal-backdrop .date-panel').should('be.visible');
    cy.get('.modal-backdrop .date-panel').contains('button', 'Hôm nay').click();
    cy.get('.modal-backdrop .date-panel').should('not.exist');

    cy.get('.modal-backdrop .date-trigger').eq(1).click();
    cy.get('.modal-backdrop .date-panel').should('be.visible');
    cy.get('.modal-backdrop .date-panel').contains('button', 'Hôm nay').click();
    cy.get('.modal-backdrop .date-panel').should('not.exist');
    cy.get('#staff-leave-reason').type('Việc gia đình');
    cy.contains('button', 'GỬI ĐƠN').click();

    cy.wait('@submitLeave');
  });
});
