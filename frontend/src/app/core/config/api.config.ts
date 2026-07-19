// Backend origin (the Python http.server from the repo root) — the single
// place every HttpClient call and every avatar/audit-photo URL builds from.
// Update here to point the whole app at a different backend host.
export const SERVER_BASE_URL = 'http://localhost:8000';
export const API_BASE_URL = `${SERVER_BASE_URL}/api`;
