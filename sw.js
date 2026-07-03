const CACHE = 'metacare-v19';
const ASSETS = [
  '/metacare-voice/',
  '/metacare-voice/index.html',
  '/metacare-voice/css/style.css',
  '/metacare-voice/js/app.js',
  '/metacare-voice/manifest.json',
  '/metacare-voice/icons/icon-192x192.png',
  '/metacare-voice/icons/icon-512x512.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  // Firebase/API 요청은 캐시 안 함
  if(e.request.url.includes('firebase') || e.request.url.includes('anthropic') || e.request.url.includes('googleapis')) return;
  e.respondWith(
    fetch(e.request).then(function(res){
      var clone = res.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
      return res;
    }).catch(function(){
      return caches.match(e.request);
    })
  );
});
