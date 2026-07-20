# Internal Messages ("Tin nhắn nội bộ") — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation planning

## Goal

Any employee (Admin or Staff — the two are peers for this feature) can write a message to any other employee. The original ask was specifically "cấp dưới viết báo cáo daily/weekly cho cấp trên" (subordinates writing daily/weekly reports for superiors), but the approved direction generalizes this into a reusable internal-messaging primitive: "report" types (daily/weekly/monthly/other) are just one message `category` among possibly others added later, with no schema change required to add a new category.

Key decisions locked in during brainstorming:
- **Recipient choice is free-form**: the sender picks any employee as recipient via a search/autocomplete, not a fixed manager relationship. There is no "manager_id"/org-hierarchy concept anywhere in this feature.
- **Symmetric permissions**: Admin and Staff can both send and receive on equal footing. The only asymmetry is that managing message *templates* (create/edit/delete) is Admin-only — everyone can still view and use templates when composing.
- **Categories are a fixed code-level enum** (`daily_report`, `weekly_report`, `monthly_report`, `other`), not an admin-managed CRUD list — the user confirmed these are "just classification labels," not a scheduling/reminder system.
- **Read-only**: no reply/comment/approval thread. Recipients just read. An unread-count badge is required so recipients notice new messages.
- **Dedicated pages, not modals**: composing and viewing a message are both full routed pages, not modals — the user's explicit preference, to keep components smaller and self-contained.
- **Shared shell for both roles**: Admin and Staff use the same shell component (sidebar nav), with nav items conditionally shown per role, rather than two separate shell components — avoids duplicating the shell chrome (header/logo/sidebar CSS).
- **New component naming**: new component classes in this feature drop the `Component` suffix (`MessagesPage`, not `MessagesPageComponent`) per the newer Angular convention the user asked to adopt going forward. This does **not** apply retroactively to existing classes elsewhere in the codebase.

## Data model (`db.py`)

Two new tables, added the same way every other table in `init_db()` is (a `CREATE TABLE IF NOT EXISTS` block plus any follow-up `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations if the shape needs to change later):

```sql
CREATE TABLE employee_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,   -- 'daily_report' | 'weekly_report' | 'monthly_report' | 'other'
  subject VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE message_templates (
  id SERIAL PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Notes:
- `category` is a plain `VARCHAR`, validated against the fixed enum in `server.py` (not a DB-level `CHECK` or separate lookup table) — matches how e.g. `employees.role` is handled today (`VARCHAR(20) DEFAULT 'staff'`, validated in application code).
- `ON DELETE CASCADE` on both `sender_id` and `recipient_id` matches the existing pattern (`employee_positions`, `attendance_logs`, etc.) — deleting an employee deletes their messages, sent or received, with no special-case cleanup needed.
- `message_templates` has no `employee_id` — templates are global (any employee can use any template), only Admin can mutate the list.

## Backend API (`server.py`)

New endpoints, following the existing `db.py`-function-per-query + `handle_*` dispatch pattern already used for `/api/leave-requests`, `/api/documents`, etc.:

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/messages` | any logged-in employee | body: `{recipient_id, category, subject, content}`; `sender_id` comes from the session, never the client |
| `GET` | `/api/messages/received` | any logged-in employee | messages where `recipient_id = current user` |
| `GET` | `/api/messages/sent` | any logged-in employee | messages where `sender_id = current user` |
| `PUT` | `/api/messages/{id}/read` | recipient only | sets `is_read = true`; 401/403 if the caller isn't the message's recipient |
| `GET` | `/api/message-templates` | any logged-in employee | full list, for the template picker |
| `POST` | `/api/message-templates` | Admin only | create |
| `PUT` | `/api/message-templates/{id}` | Admin only | edit |
| `DELETE` | `/api/message-templates/{id}` | Admin only | delete |

`category` is validated server-side against the fixed set on every write (`POST /api/messages`, template create/edit) — reject with 400 on an unrecognized value, same style as the existing password-complexity / username-uniqueness checks in `handle_create_employee`.

## Frontend

### Routes

Both roles share the same routed components; each component's own data-fetching filters by "the currently logged-in employee" (via `AuthService.currentUser()`), so there's no role-specific variant to maintain.

```
/admin/messages            → MessagesPage   (tabs: Đã nhận / Đã gửi)
/admin/messages/new        → ComposeMessagePage
/admin/messages/:id        → MessageDetailPage
/admin/message-templates   → MessageTemplatesPage   (Admin-only route, guarded)

/staff/messages            → MessagesPage   (same component as above)
/staff/messages/new        → ComposeMessagePage   (same component as above)
/staff/messages/:id        → MessageDetailPage   (same component as above)
```

`/staff` itself (the existing single profile page) is unchanged — no restructuring of its existing content (profile header, leave requests, documents, attendance summary). Staff goes from having one flat route to having two sibling routes under a shared shell; `/staff/messages/*` is strictly additive.

### Shell

The existing `admin-shell` becomes the shell for both roles (renamed if it reads oddly as "admin-shell" once Staff uses it too — a naming detail for implementation, not a design concern). Nav items are wrapped in `@if (authService.isAdmin())` / `@if (authService.isStaff())` as needed:
- "Tin nhắn" (messages list) — both roles, shows an unread-count badge (reusing the existing `.pending-badge` CSS class already used for pending leave requests)
- "Mẫu tin nhắn" (template management) — Admin only
- All existing nav items unchanged

### Components

- **`MessagesPage`** — list view, two tabs ("Đã nhận" / "Đã gửi"), table styled like the existing `leave-requests`/`documents` list pages (sender/recipient name, category label, subject, date, read/unread indicator). Clicking a row navigates to `MessageDetailPage` (`/messages/:id`), not a modal.
- **`ComposeMessagePage`** — full page: recipient picker (autocomplete search over all employees, excluding self — reuses the same search-box pattern already built for the dashboard's employee-name autocomplete), category dropdown (fixed enum), template dropdown (optional; populated from `GET /api/message-templates`, filtered client-side by the selected category), subject input, content textarea. Selecting a template overwrites subject/content with the template's text — the user can still edit freely afterward.
- **`MessageDetailPage`** — read-only display of one message's full content. If the current user is the recipient and the message is unread, fires `PUT /api/messages/{id}/read` on load.
- **`MessageTemplatesPage`** — Admin-only CRUD list (table + add/edit form), same shape as other simple admin CRUD screens in this app.

### Services

- **`MessageService`** (`providedIn: 'root'`) — thin wrapper over the `/api/messages...` and `/api/message-templates...` endpoints, mirroring `EmployeeService`'s role as "single source of truth for one resource family."
- **`RealtimeService`** extended (or a new sibling service, decided during implementation) to poll `GET /api/messages/received` for *any* logged-in employee (today it only polls leave-requests, and only for Admins) and expose an `unreadMessageCount` computed signal, consumed by both the shell's nav badge and the "TIN NHẮN" section badge.

## Data flow / workflow

1. **Compose**: user navigates to `.../messages/new` → fills recipient/category/(optional template)/subject/content → submits → `POST /api/messages` → on success, navigate to `.../messages` (Đã gửi tab).
2. **Notify**: `RealtimeService`'s poll picks up the new row for the recipient on its next 3s tick → `unreadMessageCount` badge appears/increments wherever it's rendered for that recipient.
3. **Read**: recipient opens `MessageDetailPage` for that message → `PUT /api/messages/{id}/read` fires automatically → next poll tick reflects the decremented count.
4. **Templates**: Admin visits `/admin/message-templates` → standard CRUD; everyone else only ever *reads* this list, via the dropdown in `ComposeMessagePage`.

## Error handling

- Failed send (network/server error): show `DialogService.alert(...)` (already used throughout the app for this purpose) and keep the compose page's form values intact so the user doesn't lose what they typed.
- Failed template mutation: same `DialogService` alert/confirm pattern already used for skills/projects/positions CRUD elsewhere.
- Recipient deleted after a message was sent: `ON DELETE CASCADE` removes the message rows too, consistent with how the rest of the schema handles employee deletion — no orphaned-message edge case to handle specially.
- Viewing `/messages/:id` for a message that doesn't belong to the current user (not sender or recipient): 401/403 from the backend, frontend shows the same error-state pattern already used in `employee-detail.ts` (`errorMsg` signal + retry button).

## Testing

- Unit tests: `MessageService` needs no dedicated spec (it's thin HTTP wiring, same as `EmployeeService` today, which has none). `RealtimeService` has no spec file today either — add `realtime.service.spec.ts` covering both `pendingLeaveCount` (currently untested) and the new `unreadMessageCount`.
- Cypress e2e (new spec file, e.g. `admin-messages.cy.ts` / mirrored assertions for the staff side): 
  - Compose and send a message to another employee, confirm it shows up in "Đã gửi."
  - Log in as the recipient, confirm the unread badge appears, open the message, confirm it's marked read and the badge clears.
  - Admin creates/edits/deletes a template, confirms it appears in the `ComposeMessagePage` template dropdown.

## Out of scope (explicitly excluded during brainstorming)

- Manager/org-hierarchy assignment (`manager_id` or similar) — recipient choice is always a free pick from all employees.
- Scheduling/reminders for recurring reports — categories are just classification labels, no due-date or notification-of-missing-report logic.
- Replies/comments/approval workflow on a message — strictly one-way, read-only.
- Admin-managed category list — categories are a fixed code-level enum, not a CRUD entity (only templates are CRUD).
