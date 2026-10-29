// Vercel Routing Middleware — the password gate for the whole site.
//
// Why this exists: Vercel serves the built PWA (dist/) as STATIC files, which
// never pass through the Express function, so the function's own auth can't
// protect the app shell. And a 401 from a fetch() call never pops the browser's
// Basic Auth dialog. Middleware runs in front of EVERY request (static +
// /api/*), so a first page load triggers the browser login prompt; after that
// the browser attaches the credentials to every same-origin request, including
// the app's fetch() calls to /api/*.
//
// Set APP_USER (default "admin") and APP_PASSWORD in the Vercel project env.
// With APP_PASSWORD unset the site is open (useful only for a quick test).
// /api/health is always open so uptime checks and diagnostics work.

import { next } from '@vercel/functions';

export const config = {
  // Run on everything; we special-case /api/health in code below.
  matcher: '/:path*',
};

export default function middleware(request) {
  try {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health') return next();

    const pass = process.env.APP_PASSWORD;
    if (!pass) return next(); // gate not configured → open

    const user = process.env.APP_USER || 'admin';
    const mgrPass = process.env.MANAGER_PASSWORD;
    const header = request.headers.get('authorization') || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      // Either the admin or the manager credentials pass the gate; the API
      // (api/index.js) enforces what the manager role may actually do.
      if ((u === user && p === pass) || (mgrPass && u === 'manager' && p === mgrPass)) return next();
    }
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Free GST Billing"' },
    });
  } catch {
    // A middleware throw would 500 the whole site. Fail open instead — the
    // Express function still enforces auth on /api/*, so data stays protected.
    return next();
  }
}
