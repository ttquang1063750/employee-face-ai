export interface MockUser {
  id: number;
  name: string;
  role: 'admin' | 'staff';
}

export const MOCK_ADMIN: MockUser = { id: 1, name: 'HR Admin', role: 'admin' };
export const MOCK_STAFF: MockUser = { id: 11, name: 'Tăng Thanh Quang', role: 'staff' };

// AuthService reads access_token/refresh_token/user_session straight out of
// localStorage in its field initializers (frontend/src/app/core/services/
// auth.service.ts), so the session must exist before Angular bootstraps —
// hence seeding it in cy.visit's onBeforeLoad rather than after the page loads.
function seedSession(win: Cypress.AUTWindow, user: MockUser): void {
  win.localStorage.setItem('access_token', 'test-access-token');
  win.localStorage.setItem('refresh_token', 'test-refresh-token');
  win.localStorage.setItem('user_session', JSON.stringify(user));
}

// WebcamCaptureService.start() (webcam-capture.service.ts) calls
// navigator.mediaDevices.getUserMedia directly — headless Cypress has no real
// camera, so every webcam-capture flow needs this stubbed before it runs.
// A canvas-sourced captureStream() gives a real, playable MediaStream.
export function stubGetUserMedia(win: Cypress.AUTWindow): void {
  const canvas = win.document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#39d353';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const fakeStream = (
    canvas as unknown as { captureStream: (fps?: number) => MediaStream }
  ).captureStream(15);

  cy.stub(win.navigator.mediaDevices, 'getUserMedia').resolves(fakeStream);
}

Cypress.Commands.add('loginAsAdmin', (path = '/admin/dashboard') => {
  cy.visit(path, { onBeforeLoad: (win) => seedSession(win, MOCK_ADMIN) });
});

Cypress.Commands.add('loginAsStaff', (path = '/staff') => {
  cy.visit(path, { onBeforeLoad: (win) => seedSession(win, MOCK_STAFF) });
});

Cypress.Commands.add('mockGetUserMedia', () => {
  cy.window().then((win) => stubGetUserMedia(win));
});

// HudSelectComponent (frontend/src/app/core/components/hud-select) replaces
// every `<select class="hud-select">` with a custom button + portal-ed
// dropdown (its panel is moved to <body> in ngAfterViewInit — see the
// component for why: `backdrop-filter` ancestors like `.action-card`/modal
// cards break `position: fixed` panels rendered in place). Its panel is
// always in the DOM (hidden via [hidden], not @if — see the component), so
// with several hud-selects on one page (e.g. documents.html has 3) more than
// one `.hud-select-option` with matching text can exist at once; `:visible`
// scopes to the one panel currently open.
Cypress.Commands.add('selectHudOption', (triggerSelector: string, optionText: string) => {
  cy.get(triggerSelector).click();
  cy.get('.hud-select-panel:visible').contains('.hud-select-option', optionText).click();
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Seeds an admin session into localStorage and visits `path` (default `/admin/dashboard`). */
      loginAsAdmin(path?: string): Chainable<void>;
      /** Seeds a staff session into localStorage and visits `path` (default `/staff`). */
      loginAsStaff(path?: string): Chainable<void>;
      /** Stubs navigator.mediaDevices.getUserMedia with a canvas-sourced fake stream. */
      mockGetUserMedia(): Chainable<void>;
      /** Opens a HudSelectComponent by its trigger selector and clicks the option matching `optionText`. */
      selectHudOption(triggerSelector: string, optionText: string): Chainable<void>;
    }
  }
}
