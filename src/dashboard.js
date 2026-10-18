import { readFileSync } from 'node:fs';

// Fixed paths only; a browser request can never select a filesystem path.
export const dashboardAssets = new Map([
  ['/', ['dashboard.html', 'text/html; charset=utf-8']],
  ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  ['/dashboard.js', ['dashboard.js', 'text/javascript; charset=utf-8']],
  ['/icon.png', ['freegas-icon.png', 'image/png']],
].map(([path, [file, type]]) => [path, { type, body: readFileSync(new URL(`../assets/${file}`, import.meta.url)) }]));

export const dashboardHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
