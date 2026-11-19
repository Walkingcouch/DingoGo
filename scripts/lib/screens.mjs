/**
 * Round 25: every screen of every app, in one list, for scripts/ui-tour.mjs (screenshots and checks) and scripts/a11y-check.mjs
 * (axe-core). A screen is { app, path, tabs?, only?, allow? }: `app` is web, rider, driver, admin or partner (with `-signed-out` for
 * the sign-in screen), `path` is inside the app, `tabs` clicks through every tab on the page, `only` limits it to 'phone' or
 * 'desktop', `open` clicks something (a table row) for one more view, `name` names screenshots of paths with placeholders
 * (`:trip` = the demo rider's latest trip), and `allow` lists API paths whose 4xx answers are expected on that screen (e.g. a shared link that has expired).
 * When an app gets a new screen, add it here.
 */
export const PHONES = { rider: '+61400000100', driver: '+61400000011', admin: '+61400000001', partner: '+61400000300' };

export const SCREENS = [
  // Website
  ...['/', '/rides', '/parcels', '/tours', '/business', '/drive', '/rewards', '/help', '/safety', '/about', '/fares', '/airport', '/hospital',
    '/advertise', '/delete-account', '/legal/privacy', '/legal/terms', '/legal/cancellations', '/legal/prohibited-items'].map((path) => ({ app: 'web', path })),
  { app: 'web', path: '/track/not-a-real-token', allow: ['/public/track/'] },
  { app: 'web', path: '/no-such-page' },
  // Rider
  { app: 'rider-signed-out', path: '/' },
  { app: 'rider', path: '/trips/:trip', name: 'rider-trip-detail' },
  { app: 'rider', path: '/business-account', tabs: '.seg[aria-label="Business account"] button' },
  { app: 'rider', path: '/business', tabs: '.seg[aria-label="Business deliveries"] button' },
  ...['/', '/trips', '/rewards', '/clients', '/community', '/account', '/account/profile', '/account/payment',
    '/account/notifications', '/account/notifications/settings', '/account/help', '/account/safety', '/account/safety/report', '/account/privacy',
    '/account/organisations'].map((path) => ({ app: 'rider', path })),
  // Driver
  { app: 'driver-signed-out', path: '/' },
  ...['/', '/earnings', '/trips', '/profile', '/charging', '/help', '/setup'].map((path) => ({ app: 'driver', path })),
  // Admin (desktop console; the live map and dashboard are also checked on a phone)
  { app: 'admin-signed-out', path: '/' },
  { app: 'admin', path: '/live' },
  { app: 'admin', path: '/dashboard' },
  { app: 'admin', path: '/trips', open: 'tbody tr.click' },
  ...['/safety', '/support', '/drivers', '/fleet', '/pricing', '/loyalty', '/tours', '/regional', '/ads', '/business', '/insights', '/reports', '/tax', '/settings']
    .map((path) => ({ app: 'admin', path, tabs: true })),
  // Partner portal
  { app: 'partner-signed-out', path: '/' },
  { app: 'partner', path: '/', tabs: '.p-tabs button' },
];
