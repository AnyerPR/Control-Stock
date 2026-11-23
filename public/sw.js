const CACHE_NAME = 'farmacia-stock-v5';
const APP_SHELL_RELATIVE = [
  './',
  './index.html',
  './manifest.json',
  './manifest.webmanifest',
  './favicon.png',
  './apple-touch-icon.png',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
  './assets/aistudio/Logo_nuevo_b3fa17de.png'
];

function getScopeUrl(relPath) {
  try {
    const base = (self.registration && self.registration.scope) || self.location.href;
    return new URL(relPath, base).href;
  } catch {
    return relPath;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        APP_SHELL_RELATIVE.map((relUrl) =>
          cache.add(new Request(getScopeUrl(relUrl), { cache: 'reload' })).catch(() => null)
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
            return Promise.resolve(false);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
    );
  }
});

function isExternalOrDynamicRequest(url) {
  return (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('gstatic.com') ||
    url.pathname.includes('/@vite') ||
    url.pathname.includes('/@react-refresh') ||
    url.pathname.includes('/@fs') ||
    url.pathname.includes('/node_modules') ||
    url.pathname.includes('/src/') ||
    url.pathname.includes('/api/')
  );
}

function isAssetExpectingNonHtml(request, url) {
  const dest = request.destination || '';
  if (dest === 'script' || dest === 'style' || dest === 'image' || dest === 'font' || dest === 'manifest') {
    return true;
  }
  return /\.(js|mjs|ts|tsx|css|png|jpg|jpeg|svg|webp|ico|woff|woff2|json|webmanifest)$/i.test(url.pathname);
}

function isValidResponseForCaching(request, url, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return false;
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  // Never cache an HTML fallback page as if it were a JS/CSS/image asset
  if (isAssetExpectingNonHtml(request, url) && contentType.includes('text/html')) {
    return false;
  }
  return true;
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SW_FETCH_TIMEOUT')), timeoutMs);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin || isExternalOrDynamicRequest(url)) {
    return;
  }

  const acceptHeader = request.headers.get('accept') || '';
  const indexScopeUrl = getScopeUrl('./index.html');
  const rootScopeUrl = getScopeUrl('./');

  // 1. Navigation / HTML requests: Network-First with 4.5s timeout, fallback to scope-relative index.html
  if (request.mode === 'navigate' || acceptHeader.includes('text/html')) {
    event.respondWith(
      fetchWithTimeout(new Request(request, { cache: 'no-cache' }), 4500)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(indexScopeUrl, responseClone);
            });
            return response;
          }
          // If GitHub Pages returns 404 on a SPA sub-route navigation, fall back to the app index.html
          if (response && response.status === 404) {
            return fetch(indexScopeUrl).catch(() =>
              caches.match(indexScopeUrl).then((c) => c || caches.match(rootScopeUrl))
            );
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match(indexScopeUrl) || caches.match(rootScopeUrl))
        )
    );
    return;
  }

  // 2. JS & CSS bundles: Network-First so updates never mismatch with index.html, with MIME-type verification
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    /\.(js|mjs|css)$/i.test(url.pathname)
  ) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (isValidResponseForCaching(request, url, networkResponse)) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            const ct = (cached.headers.get('content-type') || '').toLowerCase();
            if (!ct.includes('text/html')) {
              return cached;
            }
            const cache = await caches.open(CACHE_NAME);
            await cache.delete(request);
          }
          throw new Error('Asset unavailable offline');
        })
    );
    return;
  }

  // 3. Static images, icons, fonts, manifest: Stale-While-Revalidate with MIME check
  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      let validCached = cachedResponse;
      if (validCached) {
        const ct = (validCached.headers.get('content-type') || '').toLowerCase();
        if (isAssetExpectingNonHtml(request, url) && ct.includes('text/html')) {
          validCached = null;
        }
      }

      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (isValidResponseForCaching(request, url, networkResponse)) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => validCached);

      return validCached || fetchPromise;
    })
  );
});
