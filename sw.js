const CACHE_NAME = 'cde-bim-v1';
// Danh sách các file bạn muốn lưu cache để chạy nhanh/offline (nếu cần)
const assets = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Kích hoạt Service Worker
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(assets);
    })
  );
});

// Phản hồi các yêu cầu mạng (Fetch)
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      return cachedResponse || fetch(e.request);
    })
  );
});
