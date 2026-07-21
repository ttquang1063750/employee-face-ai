// Production environment (the default file — replaced by
// environment.development.ts for the "development" build configuration via
// angular.json's fileReplacements, which `ng serve`/`npm start` use).
//
// Relative (not absolute) on purpose: the production Nginx config
// (deploy/nginx.conf.example) reverse-proxies /api and /uploads to the
// backend on the same origin the frontend is served from, so one build
// works behind any domain/IP without rebuilding per-customer.
export const environment = {
  production: true,
  apiBaseUrl: '/api',
  serverBaseUrl: '',
};
