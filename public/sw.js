// Authenticated pages stay network-only. Clear the old navigation cache.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('futbot-')).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data?.json() || {} } catch { /* Show a safe fallback. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'fulbot', {
    body: payload.body || '',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: payload.tag || 'fulbot-update', data: { url: safeUrl(payload.url) },
  }))
})

function safeUrl(value) {
  try {
    const url = new URL(value || '/notifications', self.location.origin)
    if (url.origin === self.location.origin) return url.href
  } catch { /* Use the notification inbox. */ }
  return new URL('/notifications', self.location.origin).href
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = safeUrl(event.notification.data?.url)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const windowClient of windows) {
      if (new URL(windowClient.url).origin !== self.location.origin) continue
      // navigate() throws on windows this worker doesn't control; fall back
      // to focusing + opening instead of failing the whole click.
      try {
        const client = await windowClient.navigate(url)
        if (client) return client.focus()
      } catch { /* try the next window */ }
    }
    return self.clients.openWindow(url)
  })())
})

// Browsers may rotate a subscription; re-register it so alerts keep arriving.
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription?.options
  if (!options?.applicationServerKey) return
  event.waitUntil(self.registration.pushManager.subscribe(options).then((subscription) =>
    fetch('/api/push/subscription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription),
    })
  ).catch(() => undefined))
})
