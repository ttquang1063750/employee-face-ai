import { stubGetUserMedia } from '../support/commands';

describe('Kiosk check-in', () => {
  beforeEach(() => {
    cy.visit('/kiosk', { onBeforeLoad: stubGetUserMedia });
    // The fake canvas-sourced stream needs a moment to reach the <video> tag
    // and populate videoWidth/videoHeight before capture() can read a frame.
    cy.get('video.webcam-feed').should(($video) => {
      expect(($video[0] as HTMLVideoElement).videoWidth).to.be.greaterThan(0);
    });
  });

  it('defaults to CHECK_IN and lets the user switch to CHECK_OUT', () => {
    cy.contains('button', 'CHECK IN').should('have.class', 'active');
    cy.contains('button', 'CHECK OUT').click();
    cy.contains('button', 'CHECK OUT').should('have.class', 'active');
    cy.contains('button', 'CHECK IN').should('not.have.class', 'active');
  });

  it('lets the user pick a different face-detector backend', () => {
    cy.get('#backend-detector').select('mtcnn');
    cy.get('#backend-detector').should('have.value', 'mtcnn');
  });

  it('shows the success card with employee/mood details on a successful scan', () => {
    cy.intercept('POST', '**/api/attendance', {
      statusCode: 200,
      body: {
        success: true,
        data: {
          employee_name: 'Tăng Thanh Quang',
          action: 'CHECK_IN',
          mood: 'happy',
          time: '08:00:00',
        },
      },
    }).as('attendance');

    cy.contains('button', 'BẤT ĐẦU QUÉT KHUÔN MẶT').click();
    cy.wait('@attendance');

    cy.contains('GHI NHẬN THÀNH CÔNG').should('be.visible');
    cy.contains('Tăng Thanh Quang').should('be.visible');
    cy.contains('.val.mood', 'happy').should('be.visible');
  });

  it('shows the error card when the scan is rejected', () => {
    cy.intercept('POST', '**/api/attendance', {
      statusCode: 400,
      body: { success: false, error: 'Không nhận diện được khuôn mặt trong ảnh.' },
    }).as('attendance');

    cy.contains('button', 'BẤT ĐẦU QUÉT KHUÔN MẶT').click();
    cy.wait('@attendance');

    cy.contains('LỖI GHI NHẬN').should('be.visible');
    cy.contains('Không nhận diện được khuôn mặt trong ảnh.').should('be.visible');
  });
});
