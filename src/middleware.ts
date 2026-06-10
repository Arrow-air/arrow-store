import { defineMiddleware } from 'astro:middleware';
import { getSessionUser, SESSION_COOKIE } from './server/auth.ts';

// Session guard for the admin area. Everything under /admin except the login
// page requires a valid session; the resolved user lands in locals.adminUser.
// Public storefront routes pass straight through (including at prerender
// time, when no database is available).
export const onRequest = defineMiddleware((context, next) => {
  const { pathname } = context.url;
  if (!pathname.startsWith('/admin') || pathname === '/admin/login') {
    return next();
  }

  const token = context.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) {
    return context.redirect('/admin/login');
  }

  context.locals.adminUser = user;
  return next();
});
