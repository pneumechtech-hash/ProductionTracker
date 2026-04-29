const CACHE = 'po-tracker-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isHTML = e.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/';

  if (isHTML) {
    // Network-first for HTML: always try to get the latest, fall back to cache if offline
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('./index.html')))
    );
  } else {
    // Cache-first for all other assets (images, scripts, etc.)
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (!res || res.status !== 200 || res.type === 'opaque') return res;
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        }).catch(() => caches.match('./index.html'));
      })
    );
  }
});

// ── TIMER NOTIFICATIONS ────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'TIMER_UPDATE') {
    showTimerNotif(e.data);
  } else if (e.data.type === 'TIMER_STOP') {
    self.registration.getNotifications({ tag: 'po-timer-live' })
      .then(ns => ns.forEach(n => n.close()));
  }
});

function showTimerNotif(data) {
  const elapsed = fmtElapsed(Date.now() - data.startTime);
  const lines = [elapsed];
  if (data.tags && data.tags.length) lines.push(data.tags.join(' · '));
  if (data.notes) lines.push(data.notes);
  self.registration.showNotification('⏱ ' + data.po, {
    body: lines.join('\n'),
    icon: 'icons/icon-192.png',
    tag: 'po-timer-live',
    silent: true,
    data: { url: self.registration.scope }
  });
}

function fmtElapsed(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return [h, m, sc].map(n => String(n).padStart(2, '0')).join(':');
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(target);
    })
  );
});
