/**
 * Hizmet çalışanı (service worker).
 *
 * Finansal veriler her zaman güncel olmalı; bu yüzden sayfa ve veri istekleri
 * ÖNCE AĞDAN alınır. Önbellek yalnızca ağ tamamen kesildiğinde devreye girer
 * ve o durumda kullanıcıya çevrimdışı olduğu açıkça söylenir.
 */

const CACHE = "myfinance-v1";
const SHELL = ["/offline.html", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Yalnızca GET önbelleğe alınabilir; form gönderimleri asla.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Sayfa gezinmeleri: ağ önce, kesilirse çevrimdışı sayfası.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
    return;
  }

  // Statik varlıklar: önbellekten hızlı ver, arka planda tazele.
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
