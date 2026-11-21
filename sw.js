/* 오프라인 캐시 – 안내 화면을 인터넷이 약해도 열 수 있게 함 (기록은 Supabase에 저장) */
const CACHE = 'tripmoa-sh2026-v7';
const ASSETS = ['./', 'index.html', 'css/style.css?v=7', 'js/config.js?v=7', 'js/data.js?v=7', 'js/app.js?v=7', 'manifest.webmanifest', 'icon.svg', 'img/logo-emblem.jpg', 'img/logo-wide.jpg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Supabase 요청은 캐시하지 않음
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
