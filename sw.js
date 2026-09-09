// Service Worker - App Inventaris PWA
// Cache version - update ini saat ada update app
const CACHE_NAME = 'inventaris-v2-20260818';

// File yang di-cache untuk offline
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@phosphor-icons/web'
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache local files (external CDN mungkin gagal, itu ok)
      return cache.addAll([
        './index.html',
        './manifest.json',
        './icons/icon-192x192.png',
        './icons/icon-512x512.png'
      ]).catch(() => {
        console.log('[SW] Some files failed to cache, continuing...');
      });
    })
  );
  self.skipWaiting();
});

// Activate: hapus cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first untuk JS/CSS, cache-first untuk assets statis
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Selalu ke network untuk Google Apps Script API calls
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Network-first untuk JS dan CSS (agar update langsung terlihat)
  if (event.request.url.endsWith('.js') || event.request.url.endsWith('.css')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  
  // Cache-first untuk aset lokal lainnya (gambar, manifest, dll)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache response baru untuk aset lokal
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: kembalikan index.html
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
