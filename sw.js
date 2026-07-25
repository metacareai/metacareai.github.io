const CACHE = 'metacare-v90';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  // 항상 네트워크에서 가져옴 (캐시 사용 안 함)
  e.respondWith(fetch(e.request).catch(function(){ return caches.match(e.request); }));
});
