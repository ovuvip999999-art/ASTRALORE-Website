const CACHE_NAME = "astra-ai-shell-v1";
const APP_FILES = [
  "/astra.html",
  "/astra-page.css",
  "/astra-config.js",
  "/astra-page.js",
  "/astra-pwa.js",
  "/astra-manifest.webmanifest",
  "/astra-icon.svg",
  "/astra-icon-maskable.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("astra-ai-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Always try the live hosted version first. Cache is only a fallback,
  // so new GitHub/Cloudflare deployments reach installed users automatically.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return (await caches.match("/astra.html")) || Response.error();
        }
        return Response.error();
      })
  );
});