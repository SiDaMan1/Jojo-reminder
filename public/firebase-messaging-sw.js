/* Service worker: shows JoJo's reminders even when the app is closed. */

// Clicks on notifications we show ourselves (when the app is open).
self.addEventListener('notificationclick', (event) => {
  if (event.notification.data && event.notification.data.FCM_MSG) return; // Firebase handles its own
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return clients.openWindow('/');
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

importScripts('/firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp(self.FIREBASE_CONFIG);
// Messages sent with a "notification" payload are displayed automatically.
firebase.messaging();
