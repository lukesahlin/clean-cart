// Clean Cart service worker
// Caches the app shell so the UI loads instantly and works offline.
// Network-first for API calls, cache-first for static assets.

const CACHE_NAME = 'cleancart-v2'

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
]

// Install: cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: network-first for /api/* so we always get fresh data,
// cache-first for everything else (JS, CSS, fonts, images)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  // Always go to network for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request))
    return
  }

  // For everything else: try cache, fall back to network and update cache
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached
      return fetch(event.request).then(response => {
        // only cache successful same-origin responses
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response
        }
        const toCache = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache))
        return response
      }).catch(() => cached)
    })
  )
})
