/* DingoGo push-only service worker: shows Web Push notifications and opens the app when one is tapped.
   It has no fetch handler, so it never caches or changes how the app loads. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'DingoGo', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, data: d.data || {}, icon: 'icon-192.png', badge: 'icon-192.png', lang: 'en-AU',
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const scope = self.registration.scope;
  const trip = e.notification.data && e.notification.data.trip_id;
  const url = trip && APP === 'rider' ? `${scope}trip/${trip}` : scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(scope) && 'focus' in c) { if (url !== scope && 'navigate' in c) c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
const APP = 'driver';
